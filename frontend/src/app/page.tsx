import Link from "next/link";
import { api } from "@/lib/api";
import { DIM_KEYS, REGIME_NAMES, isCompanyAttention } from "@/lib/types";
import { DIM_LABELS, num, pct, signed, signClass } from "@/lib/format";
import { CompanyRowsTable } from "@/components/CompanyRowsTable";
import { DirectionChip } from "@/components/DirectionChip";
import { DivergingBar } from "@/components/DivergingBar";
import { EmptyState } from "@/components/EmptyState";
import { Meter } from "@/components/Meter";
import { PageHeader } from "@/components/PageHeader";
import { REGIME_COLORS } from "@/components/ProbabilityChart";
import { RunButton } from "@/components/RunButton";
import { ScoreBadge } from "@/components/ScoreBadge";
import { Section } from "@/components/Section";
import { ReadinessChip, ThesisRefChip } from "@/components/ThesisV2Chips";

export * from "@/lib/segment-config";

const TREND_GLYPH: Record<string, string> = { accelerating: "▲", steady: "→", decelerating: "▼" };

export default async function DashboardPage() {
  const [ov, health, briefRes, attRes, thesisRes, oppRes] = await Promise.all([
    api.overview(),
    api.health(),
    api.brief(),
    api.attention(),
    api.thesis(),
    api.thesisV2Opportunities(),
  ]);
  const running = health.ok ? health.data.running : false;
  // Morning brief card is optional: nothing renders until a brief has been generated.
  const brief = briefRes.ok ? briefRes.data : null;
  const briefSummary = brief?.llm?.summary ?? null;
  const briefSignals = [...(brief?.llm?.theme_signals ?? [])].sort((a, b) => (b.strength ?? 0) - (a.strength ?? 0)).slice(0, 3);
  // Attention card is optional: nothing renders until the attention engine has run.
  const attention = attRes.ok ? attRes.data : null;
  const attNotPriced = (attention?.movers?.not_priced ?? []).slice(0, 3);
  const attCrowded = (attention?.movers?.crowded ?? []).slice(0, 3);
  // Long-term thesis line is optional: nothing renders until the Human Future Engine has built one.
  const thesis = thesisRes.ok && thesisRes.data.thesis ? thesisRes.data : null;
  const thesisText = thesis?.thesis ?? "";
  const thesisTop = [...(thesis?.theme_ranking ?? [])].sort((a, b) => (b.conviction ?? 0) - (a.conviction ?? 0)).slice(0, 3);
  // Thesis v2 picks card is optional: nothing renders until the opportunity ranking has been built.
  const opps = oppRes.ok ? oppRes.data : null;
  const oppCandidates = opps?.candidates ?? [];
  const oppPicks = oppCandidates
    .filter((c) => c.buy_readiness === "ready")
    .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity))
    .slice(0, 5);
  const oppWatch = oppCandidates.filter((c) => c.buy_readiness === "watch").length;

  if (!ov.ok) {
    return (
      <>
        <PageHeader title="Dashboard" actions={<RunButton initialRunning={running} />} />
        <EmptyState message={ov.message} />
      </>
    );
  }

  const d = ov.data;
  const regime = d.regime;
  const posture = d.risk.posture;
  const rotation = [...(d.rotation ?? [])].sort((a, b) => b.score - a.score);
  const themes = [...(d.themes ?? [])].sort((a, b) => (b.gap ?? -999) - (a.gap ?? -999));

  return (
    <>
      <PageHeader
        title="Dashboard"
        meta={
          <>
            run {d.meta?.run_id ?? "—"} · as of {d.meta?.as_of ?? "—"} · {d.meta?.companies ?? 0} companies ·{" "}
            {d.meta?.themes ?? 0} themes · llm {d.meta?.llm_provider ?? "off"}
          </>
        }
        actions={<RunButton initialRunning={running} />}
      />

      <div className="grid gap-4 lg:grid-cols-5">
        {/* MORNING BRIEF */}
        {brief && (
          <Section
            title="Morning brief"
            subtitle={<Link href="/brief" className="hover:text-accent">as of {brief.as_of} · {brief.headlines?.length ?? 0} headlines · llm {brief.llm_provider ?? "off"}</Link>}
            className="lg:col-span-5"
            actions={<DirectionChip direction={brief.llm?.market_thesis?.direction ?? null} />}
          >
            <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
              <p className="min-w-0 flex-1 text-[13px] leading-relaxed">
                {briefSummary ? (
                  <>
                    {briefSummary.length > 240 ? `${briefSummary.slice(0, 240).trimEnd()}…` : briefSummary}{" "}
                    <Link href="/brief" className="text-accent hover:underline">Read the brief</Link>
                  </>
                ) : (
                  <span className="text-muted">
                    Headlines only — no LLM thesis. <Link href="/brief" className="text-accent hover:underline">See the clusters</Link>
                  </span>
                )}
              </p>
              {briefSignals.length > 0 && (
                <div className="w-full sm:w-72">
                  <div className="eyebrow mb-1.5">Top theme signals</div>
                  <ul className="flex flex-col gap-1 text-[12.5px]">
                    {briefSignals.map((t) => (
                      <li key={t.theme_id} className="flex items-center gap-2">
                        <span className={`w-14 shrink-0 text-[11.5px] ${t.direction === "bullish" ? "text-pos" : t.direction === "bearish" ? "text-neg" : "text-muted"}`}>
                          {t.direction}
                        </span>
                        <Link href={`/themes/${t.theme_id}`} className="min-w-0 truncate hover:text-accent">{t.theme}</Link>
                        <span className="ml-auto shrink-0 text-muted">{num(t.strength <= 1 ? t.strength * 100 : t.strength, 0)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Section>
        )}

        {/* ATTENTION */}
        {attention && (
          <Section
            title="Attention"
            subtitle={<Link href="/attention" className="hover:text-accent">as of {attention.as_of} · {attention.movers?.not_priced?.length ?? 0} not priced · {attention.movers?.crowded?.length ?? 0} crowded</Link>}
            className="lg:col-span-5"
          >
            <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              <div>
                <div className="eyebrow mb-1.5">Not yet priced</div>
                {attNotPriced.length ? (
                  <ul className="flex flex-col gap-1 text-[12.5px]">
                    {attNotPriced.map((e) => (
                      <li key={isCompanyAttention(e) ? `c-${e.ticker}` : `t-${e.theme_id}`} className="flex items-center gap-2">
                        <Link href={isCompanyAttention(e) ? `/companies/${e.ticker}` : `/themes/${e.theme_id}`} className="min-w-0 flex-1 truncate hover:text-accent">
                          {isCompanyAttention(e) ? <><span className="mono font-medium">{e.ticker}</span> <span className="text-muted">{e.name}</span></> : e.name}
                        </Link>
                        <span className="text-[11.5px] text-muted">pricing {num(e.pricing, 0)}</span>
                        <ScoreBadge value={e.attention} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-[12.5px] text-muted">No entities meet the not-priced condition today</div>
                )}
              </div>
              <div>
                <div className="eyebrow mb-1.5">Crowded</div>
                {attCrowded.length ? (
                  <ul className="flex flex-col gap-1 text-[12.5px]">
                    {attCrowded.map((c) => (
                      <li key={c.ticker} className="flex items-center gap-2">
                        <Link href={`/companies/${c.ticker}`} className="min-w-0 flex-1 truncate hover:text-accent">
                          <span className="mono font-medium">{c.ticker}</span> <span className="text-muted">{c.name}</span>
                        </Link>
                        <span className="text-[11.5px] text-muted">momentum {num(c.price_momentum, 0)}</span>
                        <ScoreBadge value={c.attention} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-[12.5px] text-muted">Nothing is crowded today.</div>
                )}
              </div>
            </div>
            <div className="mt-2 text-[12px]">
              <Link href="/attention" className="text-accent hover:underline">Open the attention page</Link>
            </div>
          </Section>
        )}

        {/* THESIS V2 PICKS */}
        {opps && (
          <Section
            title="Human Futures Engine picks"
            subtitle={
              <Link href="/thesis-v2" className="hover:text-accent">
                Stocks positioned for the open theses · {opps.n_theses} open thes{opps.n_theses === 1 ? "is" : "es"} · as of {opps.as_of}
              </Link>
            }
            className="lg:col-span-5"
          >
            {oppPicks.length ? (
              <ul className="flex flex-col gap-1 text-[12.5px]">
                {oppPicks.map((c) => (
                  <li key={c.ticker} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Link href={`/companies/${c.ticker}`} className="min-w-0 flex-1 truncate hover:text-accent">
                      <span className="mono font-medium">{c.ticker}</span> <span className="text-muted">{c.name}</span>
                    </Link>
                    <span className="flex flex-wrap gap-1">
                      {c.theses.slice(0, 3).map((x) => (
                        <ThesisRefChip key={x.thesis_id} id={x.thesis_id} contribution={x.contribution} />
                      ))}
                    </span>
                    <span className="w-12 text-right font-medium" title="Rank score">
                      {num(c.score, 2)}
                    </span>
                    <ReadinessChip value={c.buy_readiness} />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-[12.5px] text-muted">
                No candidate passes the entry gate today — {oppWatch} on watch of {oppCandidates.length} ranked.
              </div>
            )}
            <div className="mt-2 text-[12px]">
              <Link href="/thesis-v2" className="text-accent hover:underline">Open the full ranking</Link>
            </div>
          </Section>
        )}

        {/* MARKET REGIME */}
        <Section
          title="Market regime"
          subtitle={<Link href="/regime" className="hover:text-accent">{regime.headline}</Link>}
          className="lg:col-span-3"
        >
          <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {DIM_KEYS.map((k) => (
              <Meter
                key={k}
                label={DIM_LABELS[k]}
                value={regime.dimensions?.[k] ?? null}
                delta={regime.dimension_delta?.[k] ?? null}
                deltaSuffix=" / 60d"
              />
            ))}
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[12px] text-muted">Regime probabilities</span>
              <span className="text-[12px]">
                Most likely: <span className="font-medium">{regime.label}</span>
              </span>
            </div>
            <div className="flex h-3 w-full overflow-hidden rounded-sm bg-[var(--meter-track)]">
              {REGIME_NAMES.map((r) => {
                const p = regime.probabilities?.[r] ?? 0;
                return (
                  <div
                    key={r}
                    title={`${r} ${num(p, 1)}%`}
                    style={{ width: `${Math.max(0, p ?? 0)}%`, background: REGIME_COLORS[r] }}
                  />
                );
              })}
            </div>
            <div className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {REGIME_NAMES.map((r) => {
                const p = regime.probabilities?.[r] ?? null;
                const dl = regime.probability_delta?.[r] ?? null;
                return (
                  <div key={r} className="flex items-baseline gap-2 text-[12.5px]">
                    <span className="inline-block size-2 shrink-0 rounded-sm" style={{ background: REGIME_COLORS[r] }} />
                    <span className="w-24">{r}</span>
                    <span className="w-12 text-right font-medium">{num(p, 1)}%</span>
                    <span className={`${signClass(dl)}`}>
                      {dl === null ? "—" : `${dl > 0 ? "↑" : dl < 0 ? "↓" : "→"} ${Math.abs(dl).toFixed(1)} pts`}
                      <span className="text-subtle"> over 60 days</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </Section>

        {/* RISK */}
        <Section
          title="Risk"
          subtitle={<Link href="/risk" className="hover:text-accent">Posture recommendation</Link>}
          className="lg:col-span-2"
        >
          <div className="flex items-baseline gap-3">
            <span className="text-[32px] font-semibold leading-none">{num(d.risk.score, 0)}</span>
            <span className="text-[14px] font-medium">{d.risk.label}</span>
            <span className="ml-auto text-[12px] text-muted">
              risk appetite <span className={signClass(d.risk_appetite)}>{signed(d.risk_appetite, 0)}</span>
            </span>
          </div>
          <div className="mt-2">
            <Meter label={<span className="text-muted">Risk score</span>} value={d.risk.score} size="sm" />
          </div>
          <div className="tbl-wrap mt-3">
          <table className="tbl">
            <thead>
              <tr>
                <th>Asset</th>
                <th className="num">Baseline</th>
                <th className="num"></th>
                <th className="num">Recommended</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(posture?.baseline ?? {}).map((k) => {
                const b = posture.baseline[k];
                const r = posture.recommended?.[k] ?? null;
                const diff = r === null ? null : r - b;
                return (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="num text-muted">{num(b, 0)}%</td>
                    <td className="num text-subtle">→</td>
                    <td className={`num font-medium ${signClass(diff)}`}>{num(r, 0)}%</td>
                  </tr>
                );
              })}
              <tr>
                <td>Beta target</td>
                <td className="num text-muted">{num(posture?.beta_target?.baseline, 2)}</td>
                <td className="num text-subtle">→</td>
                <td className="num font-medium">{num(posture?.beta_target?.recommended, 2)}</td>
              </tr>
            </tbody>
          </table>
          </div>
        </Section>

        {/* PORTFOLIO */}
        {d.portfolio && (
          <Section
            title="Portfolio"
            subtitle={<Link href="/portfolio" className="hover:text-accent">Rules-based model portfolio · recalibrated every run</Link>}
            className="lg:col-span-5"
          >
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              <div>
                <div className="eyebrow">Positions</div>
                <div className="text-[20px] font-semibold leading-none">{d.portfolio.positions}</div>
              </div>
              <div>
                <div className="eyebrow">Equity weight</div>
                <div className="text-[20px] font-semibold leading-none">{pct(d.portfolio.equity_weight, 1)}</div>
              </div>
              <div>
                <div className="eyebrow">Wtd gap</div>
                <div className={`text-[20px] font-semibold leading-none ${signClass(d.portfolio.weighted_gap)}`}>{signed(d.portfolio.weighted_gap, 0)}</div>
              </div>
              <div>
                <div className="eyebrow">Trades this run</div>
                <div className="text-[20px] font-semibold leading-none">{d.portfolio.trades}</div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="eyebrow mb-1">Top holdings</div>
                <div className="flex flex-wrap gap-1.5">
                  {d.portfolio.top.map((h) => (
                    <Link key={h.ticker} href={`/companies/${h.ticker}`} className="chip hover:text-accent">
                      <span className="font-medium text-ink">{h.ticker}</span> {pct(h.weight, 1)}
                    </Link>
                  ))}
                  {!d.portfolio.top.length && <span className="text-[12.5px] text-muted">No equity holdings.</span>}
                </div>
              </div>
            </div>
            {thesis && (
              <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-2 border-t border-line pt-3">
                <div className="min-w-0 flex-1">
                  <div className="eyebrow mb-1">Long-term thesis</div>
                  <p className="text-[13px] leading-relaxed">
                    {thesisText.length > 200 ? `${thesisText.slice(0, 200).trimEnd()}…` : thesisText}{" "}
                    <Link href="/thesis" className="text-accent hover:underline">Read the thesis</Link>
                  </p>
                </div>
                {thesisTop.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 sm:pt-5">
                    {thesisTop.map((t) => (
                      <Link key={t.theme_id} href={`/themes/${t.theme_id}`} className="chip hover:text-accent" title={t.why}>
                        {t.theme} <span className="font-medium text-ink">{pct(t.conviction, 0)}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Section>
        )}

        {/* CAPITAL ROTATION */}
        <Section
          title="Capital rotation"
          subtitle={<Link href="/flows" className="hover:text-accent">Sector ETFs vs SPY · -100..+100</Link>}
          className="lg:col-span-2"
          flush
        >
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Sector</th>
                  <th></th>
                  <th className="num">Score</th>
                  <th>Trend</th>
                </tr>
              </thead>
              <tbody>
                {rotation.map((s) => (
                  <tr key={s.symbol}>
                    <td>
                      <span className="font-medium">{s.sector ?? s.name}</span>
                      <span className="ml-1.5 text-subtle">{s.symbol}</span>
                    </td>
                    <td>
                      <DivergingBar value={s.score} width={100} />
                    </td>
                    <td className={`num font-medium ${signClass(s.score)}`}>{signed(s.score, 0)}</td>
                    <td className="text-muted">
                      <span className="mr-1 text-subtle">{TREND_GLYPH[s.trend] ?? ""}</span>
                      {s.trend}
                    </td>
                  </tr>
                ))}
                {!rotation.length && (
                  <tr>
                    <td colSpan={4} className="text-muted">No sector instruments scored.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {d.flow_summary?.length > 0 && (
            <ul className="border-t border-line px-4 py-2.5 text-[12.5px] text-muted">
              {d.flow_summary.map((s, i) => (
                <li key={i} className="py-0.5">
                  · {s}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* THEMES */}
        <Section
          title="Themes"
          subtitle={<Link href="/themes" className="hover:text-accent">Trend vs market pricing · ★ = trend ≫ pricing</Link>}
          className="lg:col-span-3"
          flush
        >
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Theme</th>
                  <th className="num">Trend</th>
                  <th className="num">Market pricing</th>
                  <th className="num">Gap</th>
                  <th className="num">Cos.</th>
                  <th className="num">Horizon</th>
                </tr>
              </thead>
              <tbody>
                {themes.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link href={`/themes/${t.id}`}>
                        {t.star && <span className="mr-1.5 text-warn" title="Trend well ahead of pricing">★</span>}
                        {t.name}
                      </Link>
                    </td>
                    <td className="num">{num(t.trend, 0)}</td>
                    <td className="num">{num(t.pricing, 0)}</td>
                    <td className={`num font-medium ${signClass(t.gap)}`}>{signed(t.gap, 0)}</td>
                    <td className="num text-muted">{t.n_companies}</td>
                    <td className="num text-muted">{t.horizon_years ?? "—"}y</td>
                  </tr>
                ))}
                {!themes.length && (
                  <tr>
                    <td colSpan={6} className="text-muted">No themes scored.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        {/* COMPANIES */}
        <Section
          title="Companies · top 15 by opportunity"
          subtitle={<Link href="/companies" className="hover:text-accent">Full sortable universe</Link>}
          className="lg:col-span-5"
          flush
        >
          <CompanyRowsTable rows={d.top_companies ?? []} />
        </Section>

        <Section title="Biggest expectations gaps" subtitle="Reality − Pricing · higher = more underappreciated" className="lg:col-span-5" flush>
          <CompanyRowsTable rows={d.biggest_gaps ?? []} showRank={false} />
        </Section>
      </div>
    </>
  );
}
