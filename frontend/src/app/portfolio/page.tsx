import type { Metadata } from "next";
import Link from "next/link";
import { api } from "@/lib/api";
import type { RuleValue, TradeAction } from "@/lib/types";
import { date, money, num, pct, price, pts, ptsSigned, signed, signClass, yesNo } from "@/lib/format";
import { EmptyState } from "@/components/EmptyState";
import { HoldingsTable, RulesTable } from "@/components/HoldingsTable";
import { Meter } from "@/components/Meter";
import { PageHeader } from "@/components/PageHeader";
import { ScoreBadge } from "@/components/ScoreBadge";
import { Section } from "@/components/Section";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Portfolio" };

const ACTION_CLASS: Record<TradeAction, string> = {
  BUY: "text-pos",
  SELL: "text-neg",
  ADD: "text-muted",
  TRIM: "text-muted",
};

/** Labels + formatting for the RULES dict in backend/brain/engines/portfolio.py. `pts` = already in percent points. */
const RULE_LABELS: Record<string, { label: string; kind: "int" | "pct" | "score" | "x" | "pts" | "str" | "bool" | "ladder" }> = {
  mode: { label: "Mode", kind: "str" },
  max_positions: { label: "Max positions", kind: "int" },
  min_positions: { label: "Min positions", kind: "int" },
  max_weight: { label: "Per-position cap", kind: "pct" },
  initial_max_weight: { label: "Per-position cap (new)", kind: "pct" },
  min_weight: { label: "Min position", kind: "pct" },
  sector_cap: { label: "Sector cap", kind: "pct" },
  theme_cap: { label: "Theme cap", kind: "pct" },
  min_opportunity: { label: "Min opportunity (new)", kind: "score" },
  min_opportunity_incumbent: { label: "Min opportunity (incumbent)", kind: "score" },
  min_gap: { label: "Min expectations gap", kind: "score" },
  min_ttm_quarters: { label: "Min TTM quarters", kind: "int" },
  incumbency_bonus: { label: "Incumbency bonus", kind: "x" },
  falling_knife_factor: { label: "Falling-knife factor", kind: "x" },
  attention_not_priced_bonus: { label: "Not-priced bonus", kind: "x" },
  crowded_penalty: { label: "Crowded penalty", kind: "x" },
  technical_required: { label: "Technical gate required", kind: "bool" },
  technical_min_score: { label: "Technical gate min score", kind: "score" },
  risk_per_position_pct: { label: "Risk per position", kind: "pts" },
  initial_stop_atr_mult: { label: "Initial stop (× ATR)", kind: "x" },
  initial_stop_min_pct: { label: "Initial stop min", kind: "pts" },
  hard_loss_cap_pct: { label: "Hard loss cap", kind: "pts" },
  trail_activation_gain_pct: { label: "Trail activates at gain", kind: "pts" },
  trail_atr_mult: { label: "Trailing stop (× ATR)", kind: "x" },
  time_stop_weeks: { label: "Time stop (weeks)", kind: "int" },
  trend_fail_runs: { label: "Trend-template fails → exit", kind: "int" },
  regime_gate: { label: "Regime gate (SPY 10m SMA + 12m vs T-bills)", kind: "bool" },
  drawdown_ladder: { label: "Drawdown ladder", kind: "ladder" },
  trim_gain_pct: { label: "Trim at gain", kind: "pts" },
  trim_rsi: { label: "Trim when RSI ≥", kind: "int" },
  trim_fraction: { label: "Trim fraction", kind: "pct" },
  brief_trim_consecutive: { label: "Brief flags → trim", kind: "int" },
  brief_exit_consecutive: { label: "Brief flags → exit", kind: "int" },
  earnings_blackout_days: { label: "Earnings blackout (days)", kind: "int" },
  cooldown_stopouts: { label: "Cool-down after stop-outs", kind: "int" },
};

function ruleFmt(key: string, v: RuleValue | undefined): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return yesNo(v);
  if (typeof v === "string") return v.replace(/_/g, " ");
  if (Array.isArray(v)) {
    // Turtle ladder: [book drawdown %, risk-per-position multiplier, equity-cap multiplier]
    return v.map((step) => `${pts(step[0], 0)} → risk ×${num(step[1], 2)}, cap ×${num(step[2], 2)}`).join(" · ") || "—";
  }
  const kind = RULE_LABELS[key]?.kind ?? (Math.abs(v) < 1 && v !== 0 ? "pct" : "int");
  if (kind === "pct") return pct(v, 0);
  if (kind === "pts") return pts(v, v % 1 === 0 ? 0 : 1);
  if (kind === "x") return `${num(v, 2)}x`;
  return num(v, 0);
}

/** First ~N characters of a paragraph, cut at a word boundary. */
function excerpt(text: string, n: number): string {
  if (text.length <= n) return text;
  const cut = text.slice(0, n);
  const at = cut.lastIndexOf(" ");
  return `${(at > n * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

function Tile({ label, value, sub, cls = "" }: { label: string; value: React.ReactNode; sub?: React.ReactNode; cls?: string }) {
  return (
    <div className="rounded border border-line bg-surface-2 px-3 py-2.5">
      <div className="eyebrow">{label}</div>
      <div className={`mt-1 text-[22px] font-semibold leading-none ${cls}`}>{value}</div>
      {sub && <div className="mt-1.5 text-[11.5px] text-muted">{sub}</div>}
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

function WeightBars({ rows, empty }: { rows: [string, number][]; empty: string }) {
  if (!rows.length) return <div className="text-[12.5px] text-muted">{empty}</div>;
  const max = Math.max(0.0001, ...rows.map(([, w]) => w ?? 0));
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map(([name, w]) => (
        <div key={name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 text-[12.5px]">
          <span className="truncate">{name}</span>
          <span className="num font-medium">{pct(w, 1)}</span>
          <div className="col-span-2 h-1.5 w-full rounded-sm bg-[var(--meter-track)]">
            <div className="h-full rounded-sm bg-[var(--meter-fill)]" style={{ width: `${((w ?? 0) / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default async function PortfolioPage() {
  const [res, histRes] = await Promise.all([api.portfolio(), api.portfolioHistory()]);
  if (!res.ok) {
    return (
      <>
        <PageHeader title="Model portfolio" />
        <EmptyState title={res.status === 404 ? "No portfolio snapshot yet" : "No data yet"} message={res.message} />
      </>
    );
  }
  const p = res.data;
  const s = p.stats;
  const memo = p.memo ?? null;
  const gate = p.regime_gate ?? null;
  const history = histRes.ok ? histRes.data : [];
  const sectorRows: [string, number][] = Object.entries(s?.sector_weights ?? {}).sort((a, b) => b[1] - a[1]);
  const themeRows: [string, number][] = [...(s?.theme_weights ?? [])];
  const confidence = memo?.confidence === null || memo?.confidence === undefined ? null : memo.confidence <= 1 ? memo.confidence * 100 : memo.confidence;
  const ruleKeys = Object.keys(p.rules ?? {}).sort((a, b) => {
    const ia = Object.keys(RULE_LABELS).indexOf(a);
    const ib = Object.keys(RULE_LABELS).indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-baseline gap-x-3">
            <span>Model portfolio</span>
            <span className="text-[14px] font-medium text-muted">{money(p.portfolio_value, 1)}</span>
            {p.is_initial ? (
              <span className="chip border-accent bg-accent-soft text-accent">Initial portfolio</span>
            ) : (
              <span className="chip">Recalibrated vs {date(p.prior_as_of)}</span>
            )}
            {p.cooldown && (
              <span
                className="chip border-warn bg-warn-soft text-warn"
                title={`${p.stopouts ?? 0} stop-outs this run reached the cool-down threshold; no new entries until the next run`}
              >
                Cool-down · {p.stopouts ?? 0} stop-outs · new entries paused
              </span>
            )}
            {p.ladder_note && (
              <span className="chip border-warn bg-warn-soft text-warn" title={p.ladder_note}>
                Drawdown ladder · {p.ladder_note}
              </span>
            )}
            {gate && (
              <span
                className={`chip ${gate.open ? "border-pos bg-pos-soft text-pos" : "border-neg bg-neg-soft text-neg"}`}
                title={`${gate.note}${gate.applied ? "" : " · reported only, not enforced (rules.regime_gate off)"}`}
              >
                Regime gate {gate.open ? "OPEN" : "CLOSED"}
                {!gate.applied && <span className="ml-1 opacity-70">· not enforced</span>}
              </span>
            )}
          </span>
        }
        subtitle={
          <>
            {p.regime ?? "—"} regime · risk {p.risk_label ?? "—"} · equity {pct(p.equity_weight, 1)}
            {p.equity_cap !== null && p.equity_cap !== undefined && <> of {pct(p.equity_cap, 0)} cap</>} · cash {pct(p.cash_weight, 1)} · beta target{" "}
            {num(p.beta_target, 2)} · {s?.positions ?? 0} positions
            {typeof p.rules?.mode === "string" && <> · {p.rules.mode.replace(/_/g, " ")} mode</>}
            {gate && (
              <div className="mt-0.5 text-[12px] text-subtle">
                Regime gate: {gate.note}
                {gate.applied === false && <> · reported only, not enforced</>}
              </div>
            )}
          </>
        }
        meta={<>as of {date(p.as_of)} · rules-based, recalibrated every run</>}
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Wtd opportunity" value={num(s?.weighted_opportunity, 0)} sub="weight-averaged strategist score" />
        <Tile label="Wtd expectations gap" value={signed(s?.weighted_gap, 0)} cls={signClass(s?.weighted_gap)} sub="reality − pricing" />
        <Tile
          label="Wtd reality vs pricing"
          value={
            <>
              {num(s?.weighted_reality, 0)} <span className="text-[14px] text-subtle">vs</span> {num(s?.weighted_pricing, 0)}
            </>
          }
        />
        <Tile label="Wtd quality" value={num(s?.weighted_quality, 0)} />
        <Tile label="Turnover" value={pct(s?.turnover, 1)} sub="½ Σ |Δ weight| this run" />
        <Tile label="Equity cap" value={pct(p.equity_cap, 0)} sub={<>Risk-engine ceiling · invested {pct(p.equity_weight, 1)}</>} />
        <Tile label="Cash" value={pct(p.cash_weight, 1)} sub="unfilled equity + cash sleeve" />
        <Tile label="Book P&L" value={ptsSigned(s?.book_pnl_pct, 1)} cls={signClass(s?.book_pnl_pct)} sub="weight-averaged since entry" />
        <Tile label="Avg stop distance" value={pts(s?.avg_stop_distance_pct, 1)} sub="weight-averaged to active stop" />
        <Tile label="Wtd LT conviction" value={pct(s?.weighted_lt_conviction, 0)} sub="long-term thesis conviction of the book" />
        <Tile
          label="NAV index"
          value={num(p.nav_index, 3)}
          sub={<>1.000 at inception · peak {num(p.nav_peak, 3)}</>}
        />
        <Tile
          label="Drawdown"
          value={ptsSigned(p.drawdown_pct, 1)}
          cls={p.drawdown_pct !== null && p.drawdown_pct !== undefined && p.drawdown_pct < 0 ? "text-neg" : ""}
          sub={p.ladder_note ? <span className="text-warn">ladder step in effect</span> : "from NAV peak"}
        />
        <Tile label="Period return" value={ptsSigned(p.period_return_pct, 2)} cls={signClass(p.period_return_pct)} sub={p.prior_as_of ? <>book since {date(p.prior_as_of)}</> : "book since prior run"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {p.longterm_thesis && (
          <Section
            title="Long-term thesis"
            subtitle={<Link href="/thesis" className="hover:text-accent">Human Future Engine · reconciled from the morning briefs · sizes the LT column</Link>}
            className="lg:col-span-2"
            actions={<Link href="/thesis" className="text-[12px] text-accent hover:underline">Open the thesis</Link>}
          >
            <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
              <p className="min-w-0 flex-1 text-[13px] leading-relaxed">{excerpt(p.longterm_thesis, 300)}</p>
              {(p.longterm_top_themes ?? []).length > 0 && (
                <div className="w-full sm:w-80">
                  <div className="eyebrow mb-1.5">Top long-term themes</div>
                  <ul className="flex flex-col gap-1 text-[12.5px]">
                    {(p.longterm_top_themes ?? []).map(([name, conviction]) => (
                      <li key={name} className="flex items-center gap-2">
                        <span className="min-w-0 flex-1 truncate">{name}</span>
                        <div className="h-1.5 w-16 shrink-0 rounded-sm bg-[var(--meter-track)]">
                          <div className="h-full rounded-sm bg-[var(--meter-fill)]" style={{ width: `${Math.max(0, Math.min(100, (conviction ?? 0) * 100))}%` }} />
                        </div>
                        <span className="w-9 shrink-0 text-right font-medium">{pct(conviction, 0)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Section>
        )}

        {memo && (
          <Section
            title="Weekly memo"
            subtitle={<span className="text-accent">LLM memo · grounded in this snapshot only</span>}
            className="lg:col-span-2"
            actions={
              <div className="w-40">
                <Meter label={<span className="text-muted">Confidence</span>} value={confidence} size="sm" />
              </div>
            }
          >
            <p className="text-[13.5px] leading-relaxed">{memo.summary}</p>
            <div className="mt-4 grid gap-x-8 gap-y-4 md:grid-cols-2">
              <div>
                <div className="eyebrow mb-1.5">Key bets</div>
                {memo.key_bets?.length ? (
                  <ul className="flex flex-col gap-1.5 text-[13px]">
                    {memo.key_bets.map((b, i) => (
                      <li key={`${b.ticker}-${i}`} className="flex gap-2">
                        <Link href={`/companies/${b.ticker}`} className="mono shrink-0 font-medium hover:text-accent">
                          {b.ticker}
                        </Link>
                        <span className="text-muted">{b.why}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="text-[12.5px] text-muted">None listed.</div>
                )}
              </div>
              <div>
                <div className="eyebrow mb-1.5">Concentrations</div>
                <Bullets items={memo.concentrations} />
              </div>
              <div>
                <div className="eyebrow mb-1.5">Biggest risks</div>
                <Bullets items={memo.biggest_risks} />
              </div>
              <div>
                <div className="eyebrow mb-1.5">What would change our mind</div>
                <Bullets items={memo.what_would_change_our_mind} />
              </div>
              <div>
                <div className="eyebrow mb-1.5">Hedging note</div>
                <p className="text-[13px]">{memo.hedging_note || <span className="text-muted">—</span>}</p>
              </div>
              <div>
                <div className="eyebrow mb-1.5">Watchlist</div>
                <Bullets items={memo.watchlist} empty="Nothing on watch." />
              </div>
            </div>
          </Section>
        )}

        <Section
          title="Holdings"
          subtitle={`${p.holdings?.length ?? 0} equity positions · sorted by weight · expand a row for stops, trend template, brief flags and frozen entry rules`}
          className="lg:col-span-2"
          flush
        >
          <HoldingsTable rows={p.holdings ?? []} />
        </Section>

        <Section
          title="This week's trades"
          subtitle={p.is_initial ? "Initial construction · every position is a BUY" : `${p.trades?.length ?? 0} trades vs ${date(p.prior_as_of)}`}
          className="lg:col-span-2"
          flush
        >
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Ticker</th>
                  <th>Name</th>
                  <th className="num">From</th>
                  <th className="num"></th>
                  <th className="num">To</th>
                  <th className="num">$</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {(p.trades ?? []).map((t, i) => (
                  <tr key={`${t.action}-${t.ticker}-${i}`}>
                    <td className={`font-semibold ${ACTION_CLASS[t.action] ?? "text-muted"}`}>{t.action}</td>
                    <td>
                      <Link href={`/companies/${t.ticker}`} className="font-medium">
                        {t.ticker}
                      </Link>
                    </td>
                    <td className="max-w-56 truncate text-muted">{t.name ?? "—"}</td>
                    <td className="num text-muted">{pct(t.from, 1)}</td>
                    <td className="num text-subtle">→</td>
                    <td className="num font-medium">{pct(t.to, 1)}</td>
                    <td className={`num ${signClass(t.dollars)}`}>
                      {t.dollars === null || t.dollars === undefined ? "—" : `${t.dollars > 0 ? "+" : ""}${money(t.dollars, 1)}`}
                    </td>
                    <td className="max-w-md truncate text-[12.5px] text-muted" title={t.reason}>
                      {t.reason}
                    </td>
                  </tr>
                ))}
                {!p.trades?.length && (
                  <tr>
                    <td colSpan={8} className="text-muted">No trades.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="border-t border-line px-4 py-3">
            <div className="eyebrow mb-1.5">Exits {p.exits?.length ? `· ${p.exits.length}` : ""}</div>
            {p.exits?.length ? (
              <ul className="flex flex-col gap-3">
                {p.exits.map((e, i) => (
                  <li key={`${e.ticker}-${i}`}>
                    <div className="flex flex-wrap items-baseline gap-x-3 text-[13px]">
                      <Link href={`/companies/${e.ticker}`} className="mono font-medium hover:text-accent">
                        {e.ticker}
                      </Link>
                      <span className="text-muted">{e.name ?? ""}</span>
                      <span className="text-[11.5px] text-subtle">prior weight {pct(e.prior_weight, 1)}</span>
                      {(e.entry_price !== null && e.entry_price !== undefined) || (e.exit_price !== null && e.exit_price !== undefined) ? (
                        <span className="text-[11.5px] text-subtle">
                          entry {price(e.entry_price)} <span className="text-subtle">→</span> exit {price(e.exit_price)} ·{" "}
                          <span className={`font-medium ${signClass(e.pnl_pct)}`}>{ptsSigned(e.pnl_pct, 1)}</span>
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-0.5 text-[13px] text-neg">{e.reason}</div>
                    {e.rules?.length ? (
                      <div className="mt-1.5 max-w-3xl overflow-x-auto rounded border border-line bg-surface-2">
                        <RulesTable rules={e.rules} evaluated />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-[12.5px] text-muted">No exits this run.</div>
            )}
          </div>
        </Section>

        <Section title="Allocation" subtitle="Equity sleeve by sector and theme · theme weights are effective exposures, not additive" className="lg:col-span-2">
          <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
            <div>
              <div className="eyebrow mb-2">Sector weights</div>
              <WeightBars rows={sectorRows} empty="No sector weights." />
            </div>
            <div>
              <div className="eyebrow mb-2">Theme weights</div>
              <WeightBars rows={themeRows} empty="No theme weights." />
            </div>
          </div>
          <div className="mt-4 rounded border border-line">
            <div className="border-b border-line px-3 py-2 text-[12px] text-muted">
              Non-equity sleeves · {pct(1 - (p.equity_weight ?? 0), 1)} of the book, split by the Risk engine&apos;s posture
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Name</th>
                  <th>Sleeve</th>
                  <th className="num">Weight</th>
                </tr>
              </thead>
              <tbody>
                {(p.sleeves ?? []).map((sl) => (
                  <tr key={sl.symbol}>
                    <td className="font-medium">{sl.symbol}</td>
                    <td className="text-muted">{sl.name}</td>
                    <td className="text-muted">{sl.sleeve}</td>
                    <td className="num font-medium">{pct(sl.weight, 1)}</td>
                  </tr>
                ))}
                {!p.sleeves?.length && (
                  <tr>
                    <td colSpan={4} className="text-muted">Fully invested in equities.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Watchlist" subtitle="Next names up · passed the filters, outside the book" flush>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Name</th>
                  <th className="num">Opp</th>
                  <th className="num">Gap</th>
                  <th className="num">Conviction</th>
                  <th className="num" title="Trend-template score (0-100)">Tech</th>
                  <th className="num" title="Long-term theme conviction (0-1)">LT</th>
                </tr>
              </thead>
              <tbody>
                {(p.watchlist ?? []).map((w) => (
                  <tr key={w.ticker}>
                    <td>
                      <Link href={`/companies/${w.ticker}`} className="font-medium">
                        {w.ticker}
                      </Link>
                    </td>
                    <td className="max-w-56 truncate text-muted">{w.name}</td>
                    <td className="num"><ScoreBadge value={w.opportunity} /></td>
                    <td className={`num ${signClass(w.gap)}`}>{signed(w.gap, 0)}</td>
                    <td className="num">{num(w.conviction, 1)}</td>
                    <td className="num">{w.technical_score === null || w.technical_score === undefined ? "—" : <ScoreBadge value={w.technical_score} />}</td>
                    <td className="num">{pct(w.lt_conviction, 0)}</td>
                  </tr>
                ))}
                {!p.watchlist?.length && (
                  <tr>
                    <td colSpan={7} className="text-muted">Nothing on watch.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Skipped by caps" subtitle="Qualified on conviction but blocked by a sector or theme cap" flush>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {(p.skipped ?? []).map((k, i) => (
                  <tr key={`${k.ticker}-${i}`}>
                    <td>
                      <Link href={`/companies/${k.ticker}`} className="font-medium">
                        {k.ticker}
                      </Link>
                    </td>
                    <td className="text-muted">{k.reason}</td>
                  </tr>
                ))}
                {!p.skipped?.length && (
                  <tr>
                    <td colSpan={2} className="text-muted">No candidates were capped out.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section
          title="Rejected by the technical gate"
          subtitle={`Qualified on conviction but not in a confirmed uptrend · ${p.rejected_technical?.length ?? 0} names · gate = trend-template score ≥ ${ruleFmt("technical_min_score", p.rules?.technical_min_score)} and ready`}
          className="lg:col-span-2"
          flush
        >
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Reason</th>
                  <th className="num">Tech score</th>
                </tr>
              </thead>
              <tbody>
                {(p.rejected_technical ?? []).map((k, i) => (
                  <tr key={`${k.ticker}-${i}`}>
                    <td>
                      <Link href={`/companies/${k.ticker}`} className="font-medium">
                        {k.ticker}
                      </Link>
                    </td>
                    <td className="text-muted">
                      <div className="max-w-xl whitespace-normal">{k.reason}</div>
                    </td>
                    <td className="num">{k.score === null || k.score === undefined ? "—" : <ScoreBadge value={k.score} />}</td>
                  </tr>
                ))}
                {!p.rejected_technical?.length && (
                  <tr>
                    <td colSpan={3} className="text-muted">{p.rejected_technical === undefined ? "Not recorded in this snapshot (pre-v2)." : "No candidates were rejected by the technical gate."}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Rules" subtitle="Construction constraints applied on every run" className="lg:col-span-2">
          <dl className="grid gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-2 lg:grid-cols-4">
            {ruleKeys.map((k) => (
              <div key={k} className={`flex items-baseline justify-between gap-3 border-b border-line py-1 ${Array.isArray(p.rules[k]) ? "sm:col-span-2" : ""}`}>
                <dt className="text-muted">{RULE_LABELS[k]?.label ?? k}</dt>
                <dd className="text-right font-medium">{ruleFmt(k, p.rules[k])}</dd>
              </div>
            ))}
            {!ruleKeys.length && <div className="text-muted">No rules recorded.</div>}
          </dl>
        </Section>

        <Section title="History" subtitle={histRes.ok ? `${history.length} runs · newest first` : histRes.message} className="lg:col-span-2" flush>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>As of</th>
                  <th className="num">Positions</th>
                  <th className="num">Equity</th>
                  <th className="num">Trades</th>
                  <th className="num">Exits</th>
                  <th className="num">Wtd opp</th>
                  <th className="num">Wtd gap</th>
                  <th className="num">Turnover</th>
                  <th>Memo</th>
                  <th>Holdings</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const shown = h.holdings.slice(0, 12);
                  const rest = h.holdings.length - shown.length;
                  return (
                    <tr key={h.run_id}>
                      <td className="mono">{date(h.as_of)}</td>
                      <td className="num">{h.positions}</td>
                      <td className="num">{pct(h.equity_weight, 1)}</td>
                      <td className="num">{h.trades}</td>
                      <td className={`num ${h.exits > 0 ? "text-neg" : "text-muted"}`}>{h.exits}</td>
                      <td className="num">{num(h.weighted_opportunity, 0)}</td>
                      <td className={`num ${signClass(h.weighted_gap)}`}>{signed(h.weighted_gap, 0)}</td>
                      <td className="num">{pct(h.turnover, 1)}</td>
                      <td className="text-muted">{h.has_memo ? "yes" : "—"}</td>
                      <td className="mono max-w-md truncate text-muted" title={h.holdings.join(", ")}>
                        {shown.join(", ")}
                        {rest > 0 && <span className="text-subtle"> +{rest}</span>}
                      </td>
                    </tr>
                  );
                })}
                {!history.length && (
                  <tr>
                    <td colSpan={10} className="text-muted">No portfolio history yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </div>
    </>
  );
}
