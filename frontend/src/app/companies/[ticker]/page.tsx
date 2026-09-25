import Link from "next/link";
import { api } from "@/lib/api";
import { IS_STATIC } from "@/lib/static";
import type { ComponentKey, EpistemicKind, MultipleKey } from "@/lib/types";
import { TREND_CRITERIA } from "@/lib/types";
import {
  ATTENTION_SOURCE_LABELS,
  COMPONENT_LABELS,
  EPISTEMIC_LABELS,
  bps,
  date,
  money,
  multiple,
  num,
  pct,
  pctSigned,
  price as fmtPrice,
  pts,
  ptsSigned,
  signed,
  signClass,
  weight,
  yesNo,
} from "@/lib/format";
import { AnalyzeTicker } from "@/components/AnalyzeTicker";
import { AttentionFlags } from "@/components/AttentionFlags";
import { EmptyState } from "@/components/EmptyState";
import { StageChip } from "@/components/HoldingsTable";
import { Meter } from "@/components/Meter";
import { PageHeader } from "@/components/PageHeader";
import { PriceChart } from "@/components/PriceChart";
import { ScoreBadge } from "@/components/ScoreBadge";
import { Section } from "@/components/Section";
import { Sparkline } from "@/components/Sparkline";

export * from "@/lib/segment-config-dynamic-route";

/** Static export: one page per ticker in the exported universe (public/data/api/companies.json). Live mode renders on demand. */
export async function generateStaticParams(): Promise<{ ticker: string }[]> {
  if (!IS_STATIC) return [];
  const res = await api.companies();
  return res.ok ? res.data.map((c) => ({ ticker: c.ticker })) : [];
}

export async function generateMetadata({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  return { title: ticker.toUpperCase() };
}

const COMPONENT_ORDER: ComponentKey[] = [
  "structural_trend",
  "capital_flow",
  "acceleration",
  "quality",
  "valuation",
  "estimate_revisions",
  "management_commentary",
  "narrative_acceleration",
  "insider_institutional",
];

const EPISTEMIC_ORDER: EpistemicKind[] = ["observed_fact", "consensus_expectation", "ai_inference", "speculative_hypothesis"];

const MULTIPLES: { key: MultipleKey; label: string }[] = [
  { key: "pe", label: "P/E" },
  { key: "ev_ebitda", label: "EV/EBITDA" },
  { key: "ev_sales", label: "EV/Sales" },
  { key: "p_fcf", label: "P/FCF" },
];

function Tile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "muted" }) {
  return (
    <div className="rounded border border-line bg-surface-2 px-3 py-2.5">
      <div className="eyebrow">{label}</div>
      <div className={`mt-1 text-[22px] font-semibold leading-none ${tone === "muted" ? "text-subtle" : ""}`}>{value}</div>
      {sub && <div className="mt-1.5 text-[11.5px] text-muted">{sub}</div>}
    </div>
  );
}

function KV({ label, value, cls = "" }: { label: string; value: React.ReactNode; cls?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 text-[13px] last:border-b-0">
      <span className="text-muted">{label}</span>
      <span className={`font-medium ${cls}`}>{value}</span>
    </div>
  );
}

function Bullets({ items, empty = "Nothing flagged." }: { items: (string | null | undefined)[] | null | undefined; empty?: string }) {
  const list = (items ?? []).filter((x): x is string => !!x);
  if (!list.length) return <div className="text-[12.5px] text-muted">{empty}</div>;
  return (
    <ul className="flex flex-col gap-1 text-[13px]">
      {list.map((s, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-subtle">·</span>
          <span>{s}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function CompanyPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const res = await api.company(ticker);
  if (!res.ok) {
    return (
      <>
        <PageHeader title={ticker.toUpperCase()} />
        {res.status === 404 ? (
          // Ticker is simply not in the run: offer on-demand analysis. Anything else (API down, 5xx) keeps the run commands.
          <AnalyzeTicker ticker={ticker.toUpperCase()} message={res.message} />
        ) : (
          <EmptyState message={res.message} />
        )}
      </>
    );
  }
  const { company, scores, strategist: st, fundamentals: f, on_demand, analyzed_at } = res.data;
  const att = res.data.attention ?? null;
  const ta = res.data.technical ?? null;
  // On-demand rows are scored against the latest run's universe; show which one.
  const runAsOf = on_demand ? await api.runs().then((r) => (r.ok && r.data[0] ? date(r.data[0].as_of) : null)) : null;
  const L = f?.latest ?? {};
  const V = f?.valuation ?? {};
  const M = f?.momentum ?? {};
  const hist = f?.history ?? [];
  const llm = st.llm ?? null;
  const gap = st.expectations_gap;
  const coveragePct = st.coverage === null || st.coverage === undefined ? null : Math.round(st.coverage * 100);

  const labelsByKind = EPISTEMIC_ORDER.map((k) => ({
    kind: k,
    items: (llm?.epistemic_labels ?? []).filter((e) => e.kind === k),
  })).filter((g) => g.items.length);

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-baseline gap-x-3">
            <span>{company.name}</span>
            <span className="mono text-[14px] text-muted">{company.ticker}</span>
          </span>
        }
        subtitle={
          <>
            {company.sector} · {company.industry} · {company.size}
            {company.cik && <span className="mono text-subtle"> · CIK {company.cik}</span>}
            {on_demand && <span className="chip ml-2 align-[1px]">Added on demand · {date(analyzed_at)}</span>}
            {on_demand && (
              <div className="mt-0.5 text-[12px] text-subtle">
                Scored against the {runAsOf ?? "latest"} universe; included in every future weekly run.
              </div>
            )}
          </>
        }
        meta={
          <>
            <Link href="/companies" className="hover:text-accent">companies</Link> / {company.ticker} · price {fmtPrice(f?.price)} · mkt cap{" "}
            {money(V.market_cap)} · EV {money(V.enterprise_value)}
          </>
        }
        actions={
          <div className="flex items-center gap-3 rounded border border-line bg-surface px-4 py-2">
            <div className="text-right">
              <div className="eyebrow">Opportunity</div>
              <div className="text-[11.5px] text-muted">{coveragePct === null ? "" : `${coveragePct}% of weights available`}</div>
            </div>
            <span className="text-[36px] font-semibold leading-none">{num(st.opportunity_score, 0)}</span>
          </div>
        }
      />

      {/* Reality / Narrative / Pricing */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Reality" value={num(st.reality, 0)} sub={<>growth {num(scores?.growth, 0)} · quality {num(scores?.quality, 0)} · accel {num(scores?.acceleration, 0)} · macro fit {num(st.macro_fit, 0)}</>} />
        <Tile
          label="Narrative"
          value={st.narrative === null || st.narrative === undefined ? "not yet measured" : num(st.narrative, 0)}
          tone={st.narrative === null || st.narrative === undefined ? "muted" : undefined}
          sub={st.narrative === null || st.narrative === undefined ? st.narrative_note : undefined}
        />
        <Tile label="Pricing" value={num(st.pricing, 0)} sub={<>value {num(scores?.value, 0)} · momentum {num(scores?.price_momentum, 0)} · theme pricing {num(st.theme_pricing, 0)}</>} />
        <div className="rounded border border-line bg-surface px-3 py-2.5">
          <div className="eyebrow">Expectations gap</div>
          <div className={`mt-1 text-[22px] font-semibold leading-none ${signClass(gap)}`}>{signed(gap, 0)}</div>
          <div className="mt-1.5 text-[11.5px] text-muted">Reality − Pricing · higher = more underappreciated</div>
        </div>
      </div>

      {/* Price chart */}
      <div className="mb-4">
        <PriceChart symbol={company.ticker} />
      </div>

      {/* Trend template (portfolio technical gate) */}
      {ta && (
        <div className="mb-4">
          <Section
            title="Trend template"
            subtitle={
              <>
                Minervini-style 8-criteria read · the portfolio&apos;s technical gate keys off this score and the <span className="mono">ready</span> flag
                {ta.overbought && <span className="ml-2 text-warn">· RSI extended, half-sized on entry</span>}
              </>
            }
            actions={
              <div className="flex items-center gap-2">
                <StageChip stage={ta.stage} />
                <span className={`chip ${ta.ready ? "border-pos bg-pos-soft text-pos" : ""}`}>{ta.ready ? "ready" : "not ready"}</span>
                <span className="text-[22px] font-semibold leading-none">
                  {num(ta.score, 0)}
                  <span className="ml-1 text-[12px] font-normal text-subtle">{ta.passes}/8</span>
                </span>
              </div>
            }
          >
            <div className="grid gap-x-8 gap-y-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                {TREND_CRITERIA.map((c) => {
                  const ok = ta.criteria?.[c.key];
                  return (
                    <li key={c.key} className={`flex gap-2 text-[13px] ${ok === undefined ? "text-subtle" : ""}`}>
                      <span className={`w-4 shrink-0 text-center ${ok === true ? "text-pos" : ok === false ? "text-neg" : "text-subtle"}`}>
                        {ok === true ? "✓" : ok === false ? "✗" : "○"}
                      </span>
                      <span>{c.label}</span>
                    </li>
                  );
                })}
                {/* Weinstein warning: a declining 30-week average is a fail (✗), not part of the 8-point score. */}
                <li className={`flex gap-2 text-[13px] ${ta.sma150_declining === undefined ? "text-subtle" : ""}`} title="Not part of the 8-criteria score · exits when price is below a falling 30-week average">
                  <span className={`w-4 shrink-0 text-center ${ta.sma150_declining === false ? "text-pos" : ta.sma150_declining === true ? "text-neg" : "text-subtle"}`}>
                    {ta.sma150_declining === false ? "✓" : ta.sma150_declining === true ? "✗" : "○"}
                  </span>
                  <span>
                    30-week average {ta.sma150_declining === true ? "declining" : ta.sma150_declining === false ? "not declining" : "declining"}
                    {ta.sma150_prev4w !== null && ta.sma150_prev4w !== undefined && <span className="ml-1 text-[11.5px] text-subtle">4w ago {fmtPrice(ta.sma150_prev4w)}</span>}
                  </span>
                </li>
              </ul>
              <div>
                <KV label="RSI 14" value={num(ta.rsi14, 0)} cls={ta.rsi14 !== null && ta.rsi14 !== undefined && ta.rsi14 >= 75 ? "text-warn" : ""} />
                <KV label="ATR 20" value={<>{fmtPrice(ta.atr20)} <span className="text-[11.5px] text-muted">{pts(ta.atr_pct, 2)}</span></>} />
                <KV label="6m RS vs SPY" value={ptsSigned(ta.rs_6m)} cls={signClass(ta.rs_6m)} />
                <KV label="Close · 50 / 150 / 200-day" value={<span className="text-[12px]">{fmtPrice(ta.close)} · {fmtPrice(ta.sma50)} / {fmtPrice(ta.sma150)} / {fmtPrice(ta.sma200)}</span>} />
                <KV label="Above 52w low / from high" value={<><span className={signClass(ta.pct_above_52w_low)}>{ptsSigned(ta.pct_above_52w_low)}</span> <span className="text-subtle">/</span> <span className={signClass(ta.pct_from_52w_high)}>{ptsSigned(ta.pct_from_52w_high)}</span></>} />
              </div>
            </div>
          </Section>
        </div>
      )}

      {/* Attention */}
      {att && (
        <div className="mb-4">
          <Section
            title="Attention"
            subtitle={
              <>
                <Link href="/attention" className="hover:text-accent">Wikipedia pageviews + Stocktwits · {att.breadth} of {Object.keys(att.sources ?? {}).length} sources contributing</Link>
                {att.wiki_title && <span className="mono text-subtle"> · {att.wiki_title}</span>}
              </>
            }
            actions={<AttentionFlags notPriced={att.not_priced} crowded={att.crowded} />}
          >
            <div className="grid gap-x-8 gap-y-4 md:grid-cols-3">
              <div>
                <Meter label="Attention" value={att.attention} hint={<>blend of per-source scores · breadth {att.breadth}</>} />
                <div className="mt-3">
                  <div className="eyebrow mb-1.5">Per-source scores</div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(att.sources ?? {}).map(([k, v]) => (
                      <span key={k} className="chip">
                        {ATTENTION_SOURCE_LABELS[k] ?? k} <span className="font-medium text-ink">{num(v, 0)}</span>
                      </span>
                    ))}
                    {!Object.keys(att.sources ?? {}).length && <span className="text-muted">—</span>}
                  </div>
                </div>
              </div>
              <div>
                <div className="eyebrow mb-1">Wikipedia</div>
                <KV label="7d avg pageviews" value={num(att.wiki_7d, 0)} />
                <KV label="vs 28d" value={ptsSigned(att.wiki_vs_28d_pct)} cls={signClass(att.wiki_vs_28d_pct)} />
                <KV label="vs 1y" value={ptsSigned(att.wiki_vs_1y_pct)} cls={signClass(att.wiki_vs_1y_pct)} />
                <KV label="z vs own history" value={signed(att.wiki_z, 2)} cls={signClass(att.wiki_z)} />
              </div>
              <div>
                <div className="eyebrow mb-1">Stocktwits</div>
                <KV label="Watchers" value={num(att.st_watchers, 0)} />
                <KV label="Watchers vs 28d" value={ptsSigned(att.st_watchers_vs_28d_pct)} cls={signClass(att.st_watchers_vs_28d_pct)} />
                <KV label="Messages / day" value={num(att.st_msgs_per_day, 1)} />
                <KV label="Bullish share" value={pct(att.st_bullish_share, 0)} />
                <KV label="History" value={att.st_history_days === null || att.st_history_days === undefined ? "—" : `${num(att.st_history_days, 0)} days`} />
              </div>
            </div>
          </Section>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Score breakdown */}
        <Section title="Score breakdown" subtitle={coveragePct === null ? "Spec weights" : `Spec weights · ${coveragePct}% of weights available, renormalised`} flush>
          <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Component</th>
                <th className="num">Weight</th>
                <th className="num">Score</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {COMPONENT_ORDER.map((k) => {
                const v = st.components?.[k] ?? null;
                const w = st.weights?.[k] ?? null;
                const unavailable = st.unavailable?.[k];
                const off = v === null;
                return (
                  <tr key={k} className={off ? "dim" : ""}>
                    <td>
                      {COMPONENT_LABELS[k] ?? k}
                      {off && unavailable && <span className="ml-2 text-[11.5px]">— {unavailable}</span>}
                    </td>
                    <td className="num">{weight(w)}</td>
                    <td className="num">{off ? "—" : <ScoreBadge value={v} />}</td>
                    <td className="w-32">
                      {!off && (
                        <div className="h-1.5 w-full rounded-sm bg-[var(--meter-track)]">
                          <div className="h-full rounded-sm bg-[var(--meter-fill)]" style={{ width: `${Math.max(0, Math.min(100, v ?? 0))}%` }} />
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </Section>

        {/* Checks */}
        <Section title="Why the model likes it" subtitle="Deterministic, evidence-backed checks · ○ = not measured yet" flush>
          <ul className="divide-y divide-line">
            {(st.checks ?? []).map((c, i) => (
              <li key={i} className={`flex gap-3 px-4 py-1.5 text-[13px] ${c.ok === null ? "text-subtle" : ""}`}>
                <span className={`w-4 shrink-0 text-center ${c.ok === true ? "text-pos" : c.ok === false ? "text-neg" : "text-subtle"}`}>
                  {c.ok === true ? "✓" : c.ok === false ? "✗" : "○"}
                </span>
                <span className="w-36 shrink-0 sm:w-56">{c.label}</span>
                <span className="min-w-0 text-muted">{c.evidence}</span>
              </li>
            ))}
            {!st.checks?.length && <li className="px-4 py-3 text-[12.5px] text-muted">No checks.</li>}
          </ul>
        </Section>

        {/* Thesis sections */}
        <Section
          title="Model thesis"
          subtitle={llm ? <span className="text-accent">LLM-enriched{llm.confidence !== null && llm.confidence !== undefined ? ` · confidence ${pct(llm.confidence, 0)}` : ""}</span> : "Deterministic draft"}
          className="lg:col-span-2"
        >
          <p className="text-[13.5px] leading-relaxed">{llm?.thesis ?? st.thesis}</p>
          {llm && (
            <details className="mt-2 text-[12.5px] text-muted">
              <summary className="cursor-pointer">Deterministic draft</summary>
              <p className="mt-1 leading-relaxed">{st.thesis}</p>
            </details>
          )}
        </Section>

        <Section title="What the market appears to expect">
          <p className="text-[13px]">{llm?.market_expectation ?? st.market_expectation?.summary}</p>
          {st.market_expectation?.evidence?.length > 0 && (
            <div className="mt-2">
              <div className="eyebrow mb-1">Evidence</div>
              <Bullets items={st.market_expectation.evidence} />
            </div>
          )}
        </Section>

        <Section title="What we think the market is missing">
          <Bullets items={llm?.what_market_misses ?? st.what_market_misses} />
        </Section>

        <Section title="Catalysts">
          <Bullets items={llm?.catalysts ?? st.catalysts} />
        </Section>

        <Section title="Risks">
          <Bullets items={llm?.risks ?? st.risks} />
        </Section>

        <Section title="Thesis break conditions" className={llm ? "" : "lg:col-span-2"}>
          <Bullets items={llm?.thesis_break_conditions ?? st.thesis_break_conditions} />
        </Section>

        {llm && (
          <Section title="Second-order beneficiaries" subtitle="Who profits from solving this company's constraints">
            <Bullets items={llm.second_order_beneficiaries} empty="None identified." />
          </Section>
        )}

        {llm && labelsByKind.length > 0 && (
          <Section title="Epistemic labels" subtitle="Every LLM statement tagged by how it is known" className="lg:col-span-2">
            <div className="grid gap-4 md:grid-cols-2">
              {labelsByKind.map((g) => (
                <div key={g.kind}>
                  <div className="eyebrow mb-1.5">{EPISTEMIC_LABELS[g.kind] ?? g.kind}</div>
                  <Bullets items={g.items.map((e) => e.statement)} />
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Theme exposures */}
        <Section title="Theme exposures" subtitle="Weight = share of the story tied to the theme · order 1 = first-order beneficiary" className="lg:col-span-2" flush>
          {(st.theme_exposures ?? []).length ? (
            <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Theme</th>
                  <th className="num">Weight</th>
                  <th className="num">Order</th>
                  <th className="num">Effective</th>
                </tr>
              </thead>
              <tbody>
                {st.theme_exposures.map((e) => (
                  <tr key={e.theme_id}>
                    <td>
                      <Link href={`/themes/${e.theme_id}`} className="font-medium">{e.theme}</Link>
                    </td>
                    <td className="num">{weight(e.weight)}</td>
                    <td className="num text-muted">{e.order}</td>
                    <td className="num text-muted">{num(e.effective, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <div className="px-4 py-3 text-[12.5px] text-muted">Not mapped to any theme in the knowledge graph.</div>
          )}
        </Section>

        {/* Fundamentals */}
        <Section title="Key metrics" subtitle={<>TTM to {date(L.period_end)} · filed {date(L.filed)}</>}>
          <div className="grid gap-x-8 sm:grid-cols-2">
            <div>
              <KV label="Revenue" value={money(L.revenue)} />
              <KV label="Revenue growth" value={pctSigned(L.revenue_growth)} cls={signClass(L.revenue_growth)} />
              <KV label="Revenue acceleration" value={L.revenue_acceleration === null || L.revenue_acceleration === undefined ? "—" : `${signed((L.revenue_acceleration ?? 0) * 100, 1)} pts`} cls={signClass(L.revenue_acceleration)} />
              <KV label="Gross margin" value={pct(L.gross_margin)} />
              <KV label="Operating margin" value={<>{pct(L.operating_margin)} <span className={`text-[11.5px] ${signClass(L.operating_margin_change)}`}>{bps(L.operating_margin_change)}</span></>} />
              <KV label="FCF margin" value={pct(L.fcf_margin)} />
              <KV label="FCF" value={<>{money(L.fcf)} <span className={`text-[11.5px] ${signClass(L.fcf_growth)}`}>{pctSigned(L.fcf_growth)}</span></>} />
            </div>
            <div>
              <KV label="ROIC" value={pct(L.roic)} />
              <KV label="Incremental ROIC" value={pct(L.incremental_roic)} />
              <KV label="ROE" value={pct(L.roe)} />
              <KV label="Net debt" value={money(L.net_debt)} cls={L.net_debt !== null && L.net_debt !== undefined && L.net_debt < 0 ? "text-pos" : ""} />
              <KV label="Net debt / EBITDA" value={multiple(L.net_debt_to_ebitda)} />
              <KV label="Interest coverage" value={multiple(L.interest_coverage, 0)} />
              <KV label="Dilution (YoY)" value={pctSigned(L.dilution)} cls={L.dilution !== null && L.dilution !== undefined && L.dilution > 0.01 ? "text-neg" : ""} />
              <KV label="SBC % revenue" value={pct(L.sbc_pct_revenue)} />
            </div>
          </div>
        </Section>

        <Section title="Valuation" subtitle={<>Cheapness vs own 5y history {num(V.cheapness_vs_history, 0)}/100</>} flush>
          <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Multiple</th>
                <th className="num">Now</th>
                <th className="num">Pct vs history</th>
                <th className="num">5y median</th>
              </tr>
            </thead>
            <tbody>
              {MULTIPLES.map((m) => {
                const p = V.percentile_vs_history?.[m.key];
                return (
                  <tr key={m.key}>
                    <td>{m.label}</td>
                    <td className="num font-medium">{multiple(V[m.key])}</td>
                    <td className="num">
                      {p === null || p === undefined ? (
                        "—"
                      ) : (
                        <span className={p >= 75 ? "text-neg" : p <= 25 ? "text-pos" : ""}>{num(p, 0)}th</span>
                      )}
                    </td>
                    <td className="num text-muted">{multiple(V.history_median?.[m.key])}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <div className="grid gap-x-8 px-4 py-2 sm:grid-cols-2">
            <div>
              <KV label="FCF yield" value={pct(V.fcf_yield)} />
              <KV label="Earnings yield" value={pct(V.earnings_yield)} />
              <KV label="PEG" value={num(V.peg, 2)} />
            </div>
            <div>
              <KV label="Buyback yield" value={pct(V.buyback_yield)} />
              <KV label="Dividend yield" value={pct(V.dividend_yield)} />
              <KV label="Shareholder yield" value={pct(V.shareholder_yield)} />
            </div>
          </div>
        </Section>

        {/* History + sparklines */}
        <Section title="TTM history" subtitle={`${hist.length} trailing-twelve-month observations`} className="lg:col-span-2" flush>
          <div className="grid gap-x-6 gap-y-2 border-b border-line px-4 py-3 sm:grid-cols-3">
            {[
              { label: "Revenue", values: hist.map((h) => h.revenue ?? null), fmt: money(L.revenue) },
              { label: "Operating margin", values: hist.map((h) => h.operating_margin ?? null), fmt: pct(L.operating_margin) },
              { label: "ROIC", values: hist.map((h) => h.roic ?? null), fmt: pct(L.roic) },
            ].map((s) => (
              <div key={s.label} className="flex items-center justify-between gap-3">
                <div>
                  <div className="eyebrow">{s.label}</div>
                  <div className="text-[13px] font-medium">{s.fmt}</div>
                </div>
                <Sparkline values={s.values} width={150} height={34} />
              </div>
            ))}
          </div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Period end</th>
                  <th className="num">Revenue</th>
                  <th className="num">Rev growth</th>
                  <th className="num">Op margin</th>
                  <th className="num">FCF margin</th>
                  <th className="num">FCF</th>
                  <th className="num">ROIC</th>
                  <th className="num">EPS</th>
                  <th className="num">Net debt</th>
                </tr>
              </thead>
              <tbody>
                {[...hist].reverse().map((h, i) => (
                  <tr key={h.period_end ?? i}>
                    <td className="text-muted">{date(h.period_end)}</td>
                    <td className="num">{money(h.revenue)}</td>
                    <td className={`num ${signClass(h.revenue_growth)}`}>{pctSigned(h.revenue_growth)}</td>
                    <td className="num">{pct(h.operating_margin)}</td>
                    <td className="num">{pct(h.fcf_margin)}</td>
                    <td className="num">{money(h.fcf)}</td>
                    <td className="num">{pct(h.roic)}</td>
                    <td className="num">{num(h.eps, 2)}</td>
                    <td className="num">{money(h.net_debt)}</td>
                  </tr>
                ))}
                {!hist.length && (
                  <tr>
                    <td colSpan={9} className="text-muted">No TTM history.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        {/* Momentum */}
        <Section title="Price momentum" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "1m", v: M.return_1m },
              { label: "3m", v: M.return_3m },
              { label: "6m", v: M.return_6m },
              { label: "12m", v: M.return_12m },
            ].map((x) => (
              <div key={x.label}>
                <div className="eyebrow">{x.label} return</div>
                <div className={`text-[16px] font-semibold ${signClass(x.v)}`}>{ptsSigned(x.v)}</div>
              </div>
            ))}
            <div>
              <div className="eyebrow">From 52w high</div>
              <div className={`text-[16px] font-semibold ${signClass(M.pct_from_52w_high)}`}>{ptsSigned(M.pct_from_52w_high)}</div>
            </div>
            <div>
              <div className="eyebrow">Above 200dma</div>
              <div className="text-[16px] font-semibold">
                {yesNo(M.above_200dma)} <span className={`text-[12px] ${signClass(M.dist_200dma)}`}>{ptsSigned(M.dist_200dma)}</span>
              </div>
            </div>
          </div>
          <div className="mt-3 max-w-sm">
            <Meter label={<span className="text-muted">Price momentum percentile</span>} value={scores?.price_momentum} size="sm" />
          </div>
        </Section>
      </div>

      <footer className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[11.5px] text-subtle">
        <span>ttm_quarters {f?.data_quality?.ttm_quarters ?? "—"}</span>
        <span>last_filed {date(f?.data_quality?.last_filed)}</span>
        <span>has_ocf {yesNo(f?.data_quality?.has_ocf)}</span>
        <span>has_operating_income {yesNo(f?.data_quality?.has_operating_income)}</span>
        <span>llm_enriched {yesNo(st.llm_enriched)}</span>
      </footer>
    </>
  );
}
