import type { Metadata } from "next";
import { api } from "@/lib/api";
import type { IncomeBook, IncomeFrequency, IncomeHolding, IncomeTrend, Num, TradeAction } from "@/lib/types";
import { date, money, num, pct, pts, ptsSigned, signClass, usd } from "@/lib/format";
import { CommandEmptyState } from "@/components/CommandEmptyState";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export * from "@/lib/segment-config";
export const metadata: Metadata = { title: "Income Portfolio" };

const RUN_COMMAND = "cd backend && .venv/bin/python -m brain.pipeline run --skip-ingest";

const SUBTITLE =
  "ETF book built for cash distributions. Floating-rate and short Treasuries plus AAA CLOs are the base; duration, high yield and rate-sensitive income are added only on their triggers; covered-call equity income rides the sector with the inflows.";

const ACTION_CLASS: Record<TradeAction, string> = {
  BUY: "text-pos",
  SELL: "text-neg",
  ADD: "text-muted",
  TRIM: "text-muted",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Sleeve display order; anything the backend adds later lands after these, by weight. */
const SLEEVE_ORDER = ["Floating & short", "Term", "Equity income"];

/** One fill colour per sleeve, in SLEEVE_ORDER; extra sleeves cycle. All theme tokens, so they hold in dark mode. */
const SLEEVE_FILL = ["bg-[var(--meter-fill)]", "bg-[var(--border-strong)]", "bg-accent"];

const FREQ_SHORT: Record<IncomeFrequency, string> = {
  monthly: "monthly",
  quarterly: "quarterly",
  "semi-annual": "semi-annual",
  annual: "annual",
  irregular: "irregular",
};

/** "2026-10" -> "Oct" */
function monthLabel(ym: string): string {
  const m = Number(ym.slice(5, 7));
  return MONTHS[m - 1] ?? ym;
}

/** "2026-10" -> "Oct 2026" */
function monthLong(ym: string): string {
  return `${monthLabel(ym)} ${ym.slice(0, 4)}`;
}

function sleeveRank(name: string): number {
  const i = SLEEVE_ORDER.indexOf(name);
  return i === -1 ? SLEEVE_ORDER.length : i;
}

function Tile({ label, value, sub, cls = "" }: { label: string; value: React.ReactNode; sub?: React.ReactNode; cls?: string }) {
  return (
    <div className="min-w-0 rounded border border-line bg-surface-2 px-3 py-2.5">
      <div className="eyebrow">{label}</div>
      <div className={`mt-1 truncate text-[22px] font-semibold leading-none ${cls}`}>{value}</div>
      {sub && <div className="mt-1.5 text-[11.5px] text-muted">{sub}</div>}
    </div>
  );
}

function Signed({ v, digits = 1 }: { v: Num | undefined; digits?: number }) {
  return <span className={signClass(v)}>{ptsSigned(v, digits)}</span>;
}

function SleeveChip({ sleeve }: { sleeve: string }) {
  return <span className={`chip whitespace-nowrap ${sleeve === "Equity income" ? "border-accent bg-accent-soft text-accent" : ""}`}>{sleeve}</span>;
}

function FrequencyChip({ f }: { f: IncomeFrequency | null | undefined }) {
  if (!f) return <>—</>;
  return <span className={`chip ${f === "monthly" ? "border-pos bg-pos-soft text-pos" : ""}`}>{FREQ_SHORT[f] ?? f}</span>;
}

/** Signed distance from the 10-month average, with the levels in the tooltip. */
function TrendCell({ t }: { t: IncomeTrend | null | undefined }) {
  if (!t) return <span className="text-muted">—</span>;
  return (
    <span title={`${num(t.last, 2)} vs 10-month average ${num(t.sma, 2)} · 12m ${ptsSigned(t.ret_12m, 1)}`} className={`font-medium ${signClass(t.dist_pct)}`}>
      {ptsSigned(t.dist_pct, 1)}
    </span>
  );
}

/** Twelve bars, one per projected month; months above the average are highlighted (that is where the quarterly payers land). */
function IncomeCalendar({ rows, avg }: { rows: IncomeBook["income"]["by_month"]; avg: Num }) {
  const values = rows.map((r) => r.income ?? 0);
  const max = Math.max(0.0001, ...values);
  const avgPct = avg === null || avg === undefined ? null : Math.max(0, Math.min(100, (avg / max) * 100));
  return (
    <div>
      <div className="grid grid-cols-6 gap-x-2 gap-y-4 sm:grid-cols-12 sm:gap-x-3">
        {rows.map((r) => {
          const v = r.income ?? 0;
          const above = avg !== null && avg !== undefined && v > avg + 0.5;
          return (
            <div key={r.month} className="flex min-w-0 flex-col items-center gap-1" title={`${monthLong(r.month)}: ${usd(v)}${above ? " · above average" : ""}`}>
              <span className={`num text-[10.5px] leading-none ${above ? "font-semibold text-accent" : "text-muted"}`}>{usd(v)}</span>
              <div className="relative flex h-[78px] w-full items-end">
                {/* The average is drawn per column at the same height, so it reads as one dashed line across the chart. */}
                {avgPct !== null && <div className="pointer-events-none absolute -inset-x-1 border-t border-dashed border-[var(--border-strong)]" style={{ bottom: `${avgPct}%` }} aria-hidden />}
                <div className={`w-full rounded-sm ${above ? "bg-accent" : "bg-[var(--meter-fill)]"}`} style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
              </div>
              <span className={`text-[10.5px] leading-none ${above ? "font-medium text-ink" : "text-muted"}`}>{monthLabel(r.month)}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-sm bg-accent" /> above the {usd(avg)} monthly average
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-sm bg-[var(--meter-fill)]" /> at or below
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 border-t border-dashed border-[var(--border-strong)]" /> average
        </span>
      </div>
    </div>
  );
}

/** One stacked bar across the sleeves, with a legend underneath. */
function SleevesBar({ sleeves }: { sleeves: Record<string, number> }) {
  const rows = Object.entries(sleeves).sort((x, y) => sleeveRank(x[0]) - sleeveRank(y[0]) || y[1] - x[1]);
  const total = Math.max(0.0001, rows.reduce((s, [, w]) => s + (w ?? 0), 0));
  if (!rows.length) return <div className="text-[12.5px] text-muted">No sleeves recorded.</div>;
  return (
    <div>
      <div className="flex h-3 w-full overflow-hidden rounded-sm bg-[var(--meter-track)]">
        {rows.map(([name, w], i) => (
          <div key={name} className={SLEEVE_FILL[i % SLEEVE_FILL.length]} style={{ width: `${((w ?? 0) / total) * 100}%` }} title={`${name} ${pct(w, 1)}`} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px]">
        {rows.map(([name, w], i) => (
          <span key={name} className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-3 rounded-sm ${SLEEVE_FILL[i % SLEEVE_FILL.length]}`} />
            <span>{name}</span>
            <span className="num font-medium">{pct(w, 1)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default async function IncomeBookPage() {
  const [res, histRes] = await Promise.all([api.incomeBook(), api.incomeBookHistory()]);
  if (!res.ok) {
    return (
      <>
        <PageHeader title="Income portfolio" subtitle={SUBTITLE} />
        {res.status === 404 ? (
          <CommandEmptyState title="No income portfolio yet" command={RUN_COMMAND} message={res.message}>
            The income portfolio is built by the pipeline alongside the other books. Run it once to produce the first snapshot:
          </CommandEmptyState>
        ) : (
          <EmptyState message={res.message} />
        )}
      </>
    );
  }

  const b = res.data;
  const s = b.stats ?? null;
  const inc = b.income;
  const cadence = b.cadence ?? null;
  const gate = b.regime_gate ?? null;
  const rates = b.rates ?? null;
  const reinvest = b.reinvest ?? null;
  const history = histRes.ok ? histRes.data : [];
  const holdings = [...(b.holdings ?? [])].sort((x, y) => sleeveRank(x.sleeve) - sleeveRank(y.sleeve) || (y.weight ?? 0) - (x.weight ?? 0));
  const maxW = Math.max(0.0001, ...holdings.map((h) => h.weight ?? 0));
  // Group header per sleeve, rendered as a spanning row before its first holding.
  const sleeveGroups: { sleeve: string; weight: number; rows: IncomeHolding[] }[] = [];
  for (const h of holdings) {
    const g = sleeveGroups.find((x) => x.sleeve === h.sleeve);
    if (g) {
      g.rows.push(h);
      g.weight += h.weight ?? 0;
    } else sleeveGroups.push({ sleeve: h.sleeve, weight: h.weight ?? 0, rows: [h] });
  }
  const trades = b.trades ?? [];
  const alerts = b.alerts ?? [];
  const triggers = b.triggers ?? [];
  const activeTriggers = triggers.filter((t) => t.active).length;
  const parked = b.parked ?? [];
  const candidates = [...(b.candidates ?? [])].sort((x, y) => (y.yield_ttm_pct ?? -Infinity) - (x.yield_ttm_pct ?? -Infinity));
  const byMonth = inc?.by_month ?? [];
  const monthlyAvg = inc?.monthly_avg ?? null;
  const drawdownNeg = b.drawdown_pct !== null && b.drawdown_pct !== undefined && b.drawdown_pct < 0;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span>Income portfolio</span>
            <span className="text-[14px] font-medium text-muted">{money(b.portfolio_value, 1)}</span>
            {cadence &&
              (cadence.mode === "recalibrate" ? (
                <span className="chip border-accent bg-accent-soft text-accent">Recalibrated today · next {date(cadence.next_recalibration)}</span>
              ) : (
                <span className="chip">Monitoring · next {date(cadence.next_recalibration)}</span>
              ))}
            {gate && (
              <span className={`chip ${gate.open ? "border-pos bg-pos-soft text-pos" : "border-warn bg-warn-soft text-warn"}`} title={gate.note}>
                Regime gate {gate.open ? "open" : "closed"}
              </span>
            )}
            {b.is_initial && <span className="chip">Initial book</span>}
          </span>
        }
        subtitle={
          <>
            {SUBTITLE}
            <div className="mt-0.5 text-[12px] text-subtle">
              {b.regime ?? "—"} regime · risk {b.risk_label ?? "—"}
              {gate?.note && <> · gate: {gate.note}</>}
              {cadence?.last_recalibration && <> · last recalibration {date(cadence.last_recalibration)}</>}
            </div>
          </>
        }
        meta={<>as of {date(b.as_of)} · trades on the first run of each month, marked to market in between</>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          label="Monthly income"
          value={usd(monthlyAvg)}
          sub={
            <>
              annual {usd(inc?.annual)} · blended yield {pts(inc?.blended_yield_pct, 2)}
            </>
          }
        />
        <Tile label="Blended yield" value={pts(inc?.blended_yield_pct, 2)} sub={<>trailing-12m distributions / value · weighted {pts(s?.weighted_yield_pct, 2)}</>} />
        <Tile label="Paid monthly" value={pts(inc?.monthly_share_pct, 0)} sub="of income arrives monthly" />
        <Tile label="Equity-income share" value={pts(inc?.equity_income_share_pct, 0)} sub="of income from covered-call and dividend equity" />
        <Tile label="Positions" value={num(s?.positions ?? holdings.length, 0)} sub={<>turnover {pct(s?.turnover, 1)} this run</>} />
        <Tile
          label="Reinvest or cash"
          value={reinvest ? <span className={reinvest.recommendation === "reinvest" ? "text-pos" : "text-warn"}>{reinvest.recommendation === "reinvest" ? "Reinvest" : "Hold as cash"}</span> : "—"}
          sub={reinvest?.why ?? "No recommendation recorded"}
        />
        <Tile
          label="NAV / drawdown"
          value={
            <>
              {num(b.nav_index, 3)} <span className={`text-[14px] ${drawdownNeg ? "text-neg" : "text-muted"}`}>{ptsSigned(b.drawdown_pct, 1)}</span>
            </>
          }
          sub={
            <>
              peak {num(b.nav_peak, 3)} · period <Signed v={b.period_return_pct} digits={2} />
              {b.prior_as_of && <> since {date(b.prior_as_of)}</>}
            </>
          }
        />
        <Tile
          label="Rates"
          value={
            <>
              {pts(rates?.dgs10, 2)} <span className="text-[14px] text-muted">10-year</span>
            </>
          }
          cls={rates?.dgs10_below_200d ? "text-pos" : ""}
          sub={
            <>
              vs 200-day {pts(rates?.dgs10_200d, 2)} · fed funds {pts(rates?.fedfunds, 2)} · HY spread {pts(rates?.hy_spread, 1)}
              {rates?.curve_10y2y !== null && rates?.curve_10y2y !== undefined && <> · 10y-2y {ptsSigned(rates.curve_10y2y, 2)}</>}
            </>
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Income calendar"
          subtitle={`Projected distributions by month · ${usd(inc?.annual)} over the next 12 months · quarterly payers lift the highlighted months`}
          className="lg:col-span-2"
        >
          {byMonth.length ? <IncomeCalendar rows={byMonth} avg={monthlyAvg} /> : <div className="text-[12.5px] text-muted">No projected distributions.</div>}
        </Section>

        <Section
          title="Holdings"
          subtitle={`${holdings.length} ETFs · grouped by sleeve, then weight · yields are trailing 12 months with forward in grey · trend is the distance from the 10-month average`}
          className="lg:col-span-2"
          flush
        >
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Name</th>
                  <th>Sleeve</th>
                  <th className="num">Weight</th>
                  <th></th>
                  <th className="num">$</th>
                  <th className="num" title="Trailing-12m yield, forward yield in grey">Yield</th>
                  <th>Frequency</th>
                  <th>Next pay</th>
                  <th className="num">Monthly $</th>
                  <th className="num" title="Trailing-12m distributions vs the prior 12 months">Payout trend</th>
                  <th className="num" title="Last price vs the 10-month (210-day) average">vs 10m</th>
                  <th className="num">P&amp;L</th>
                  <th>Status</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {sleeveGroups.map((g) => (
                  <GroupRows key={g.sleeve} group={g} maxW={maxW} />
                ))}
                {!holdings.length && (
                  <tr>
                    <td colSpan={15} className="text-muted">No holdings: the book is in cash.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section
          title="Triggers"
          subtitle={`${activeTriggers} of ${triggers.length} active · each adds from the ${pct(typeof b.rules?.reserve === "number" ? b.rules.reserve : null, 0)} T-bill reserve or cuts into it · parked equity-income targets wait in T-bills until back above trend`}
          className="lg:col-span-2"
          flush
        >
          <ul className="divide-y divide-line">
            {triggers.map((t) => (
              <li key={t.id} className="grid gap-x-6 gap-y-1 px-4 py-2 text-[12.5px] md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
                <div className="flex min-w-0 items-center gap-2">
                  <span className={`chip shrink-0 ${t.active ? "border-accent bg-accent-soft text-accent" : ""}`}>{t.active ? "active" : "inactive"}</span>
                  <span className={`truncate font-medium ${t.active ? "" : "text-muted"}`} title={t.label}>
                    {t.label}
                  </span>
                </div>
                <div className="min-w-0 md:flex md:flex-wrap md:items-baseline md:gap-x-3">
                  <span className={t.active ? "text-ink" : "text-muted"}>{t.detail}</span>
                  <span className="block text-[11.5px] text-subtle md:inline">{t.action}</span>
                </div>
              </li>
            ))}
            {!triggers.length && <li className="px-4 py-3 text-[12.5px] text-muted">No triggers recorded.</li>}
          </ul>
          {parked.length > 0 && (
            <div className="border-t border-line px-4 py-2.5">
              <div className="eyebrow mb-1.5">Parked in T-bills</div>
              <ul className="flex flex-col gap-1 text-[12.5px]">
                {parked.map((p) => (
                  <li key={p.symbol} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{p.symbol}</span>
                    <span className="text-muted">{p.name}</span>
                    <span className="num">
                      {pct(p.weight, 1)} <span className="text-subtle">target</span>
                    </span>
                    <span className="num">
                      <Signed v={p.dist_pct} /> <span className="text-subtle">vs 10-month average</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Section>

        {trades.length > 0 && (
          <Section
            title="This run's trades"
            subtitle={
              b.is_initial && !b.prior_as_of
                ? "Initial construction · every position is a BUY"
                : `${trades.length} trade${trades.length === 1 ? "" : "s"}${b.prior_as_of ? ` vs ${date(b.prior_as_of)}` : ""}`
            }
            className={alerts.length ? "" : "lg:col-span-2"}
            flush
          >
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Symbol</th>
                    <th>Name</th>
                    <th className="num">From</th>
                    <th className="num"></th>
                    <th className="num">To</th>
                    <th className="num">$</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t, i) => (
                    <tr key={`${t.action}-${t.symbol}-${i}`}>
                      <td className={`font-semibold ${ACTION_CLASS[t.action] ?? "text-muted"}`}>{t.action}</td>
                      <td className="font-medium">{t.symbol}</td>
                      <td className="max-w-48 truncate text-muted">{t.name ?? "—"}</td>
                      <td className="num text-muted">{pct(t.from, 1)}</td>
                      <td className="num text-subtle">→</td>
                      <td className="num font-medium">{pct(t.to, 1)}</td>
                      <td className={`num ${signClass(t.dollars)}`}>{t.dollars === null || t.dollars === undefined ? "—" : `${t.dollars > 0 ? "+" : ""}${usd(t.dollars)}`}</td>
                      <td className="max-w-md truncate text-[12.5px] text-muted" title={t.reason}>
                        {t.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {alerts.length > 0 && (
          <Section
            title="Alerts"
            subtitle={`${alerts.length} held ETF${alerts.length === 1 ? "" : "s"} flagged · acted on at the next recalibration`}
            className={trades.length ? "" : "lg:col-span-2"}
            flush
          >
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Name</th>
                    <th className="num">Weight</th>
                    <th>Alert</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((a, i) => (
                    <tr key={`${a.symbol}-${i}`} className="align-top">
                      <td className="font-medium">{a.symbol}</td>
                      <td className="max-w-48 truncate text-muted">{a.name ?? "—"}</td>
                      <td className="num font-medium">{pct(a.weight, 1)}</td>
                      <td>
                        <div className="flex max-w-md gap-2 whitespace-normal text-[12.5px]">
                          <span className="text-warn">·</span>
                          <span>{a.alert}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        <Section
          title="Income universe"
          subtitle={`${candidates.length} income ETFs · sorted by trailing yield · trend is the distance from the 10-month average, flow the sector-flow score where one applies`}
          className="lg:col-span-2"
          flush
        >
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="num w-8">#</th>
                  <th>Symbol</th>
                  <th>Name</th>
                  <th className="num">Yield TTM</th>
                  <th className="num">Forward</th>
                  <th>Frequency</th>
                  <th className="num">Payout trend</th>
                  <th className="num">vs 10m</th>
                  <th className="num">12m</th>
                  <th className="num">Flow</th>
                  <th>Held</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c, i) => (
                  <tr key={c.symbol} className={c.held ? "" : "text-muted"}>
                    <td className="num text-subtle">{i + 1}</td>
                    <td className="font-medium text-ink">{c.symbol}</td>
                    <td className="max-w-56 truncate text-muted">{c.name}</td>
                    <td className="num font-medium text-ink">{pts(c.yield_ttm_pct, 2)}</td>
                    <td className="num text-muted">{pts(c.yield_forward_pct, 2)}</td>
                    <td>
                      <FrequencyChip f={c.frequency} />
                    </td>
                    <td className="num">
                      <Signed v={c.payout_trend_pct} />
                    </td>
                    <td className="num">
                      <TrendCell t={c.trend} />
                    </td>
                    <td className="num">
                      <Signed v={c.trend?.ret_12m} />
                    </td>
                    <td className="num text-muted">{num(c.flow, 0)}</td>
                    <td>{c.held ? <span className="chip border-accent bg-accent-soft text-accent">held</span> : <span className="text-subtle">—</span>}</td>
                  </tr>
                ))}
                {!candidates.length && (
                  <tr>
                    <td colSpan={11} className="text-muted">No income ETFs scored.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Sleeves" subtitle="Share of the book by sleeve · the T-bill reserve and anything parked out of trend count as Floating & short">
          <SleevesBar sleeves={b.sleeves ?? {}} />
        </Section>

        <Section title="History" subtitle={histRes.ok ? `${history.length} run${history.length === 1 ? "" : "s"} · newest first` : histRes.message} flush>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>As of</th>
                  <th>Mode</th>
                  <th className="num">Positions</th>
                  <th className="num">Yield</th>
                  <th className="num">Monthly $</th>
                  <th className="num">NAV</th>
                  <th>Trades</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const ts = h.trades ?? [];
                  const summary = ts.map((t) => `${t.action} ${t.symbol} ${pct(t.to, 0)}`).join(", ");
                  return (
                    <tr key={h.run_id}>
                      <td className="mono">{date(h.as_of)}</td>
                      <td className={h.mode === "recalibrate" ? "" : "text-muted"}>{h.mode ?? "—"}</td>
                      <td className="num">{num(h.positions, 0)}</td>
                      <td className="num">{pts(h.blended_yield_pct, 2)}</td>
                      <td className="num">{usd(h.monthly_avg)}</td>
                      <td className="num">{num(h.nav_index, 3)}</td>
                      <td className="max-w-xs truncate text-muted" title={summary}>
                        {ts.length ? (
                          <>
                            <span className="font-medium text-ink">{ts.length}</span> <span className="text-subtle">·</span> {summary}
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!history.length && (
                  <tr>
                    <td colSpan={7} className="text-muted">No income-portfolio history yet.</td>
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

/** A sleeve header row followed by its holdings. */
function GroupRows({ group, maxW }: { group: { sleeve: string; weight: number; rows: IncomeHolding[] }; maxW: number }) {
  return (
    <>
      <tr className="dim">
        <td colSpan={15} className="bg-surface-2 py-1 text-[11px] uppercase tracking-wider">
          <span className="font-semibold text-muted">{group.sleeve}</span> <span className="num ml-2">{pct(group.weight, 1)}</span>
        </td>
      </tr>
      {group.rows.map((h) => (
        <tr key={h.symbol} className="align-top">
          <td className="font-medium">{h.symbol}</td>
          <td className="max-w-56 truncate text-muted" title={h.name}>
            {h.name}
          </td>
          <td>
            <SleeveChip sleeve={h.sleeve} />
          </td>
          <td className="num font-medium">{pct(h.weight, 1)}</td>
          <td>
            {/* Fixed width on the bar itself: a percentage-width cell collapses once the table scrolls sideways. */}
            <div className="mt-1.5 h-1.5 w-20 rounded-sm bg-[var(--meter-track)]">
              <div className="h-full rounded-sm bg-[var(--meter-fill)]" style={{ width: `${Math.max(0, Math.min(100, ((h.weight ?? 0) / maxW) * 100))}%` }} />
            </div>
          </td>
          <td className="num">{usd(h.dollars)}</td>
          <td className="num">
            <span className="font-medium">{pts(h.yield_ttm_pct, 2)}</span> <span className="text-[11.5px] text-muted">{pts(h.yield_forward_pct, 2)}</span>
          </td>
          <td>
            <FrequencyChip f={h.frequency} />
          </td>
          <td className="text-muted" title={h.last_ex_date ? `last ex-date ${date(h.last_ex_date)} · ${usd(h.last_amount, 4)}/share` : undefined}>
            {date(h.next_pay_est)}
          </td>
          <td className="num font-medium">{usd(h.monthly_income)}</td>
          <td className="num">
            <Signed v={h.payout_trend_pct} />
          </td>
          <td className="num">
            <TrendCell t={h.trend} />
          </td>
          <td className="num font-medium">
            <Signed v={h.pnl_pct} />
          </td>
          <td>
            {h.status === "new" ? <span className="chip border-accent bg-accent-soft text-accent">new</span> : <span className="chip">held</span>}
            <span className="ml-1.5 text-[11.5px] text-subtle">{date(h.entered)}</span>
          </td>
          <td className="min-w-56 max-w-sm whitespace-normal text-[11.5px] leading-snug text-muted">
            {h.notes?.length ? h.notes.map((n, i) => <div key={i}>{n}</div>) : <span className="text-subtle">—</span>}
          </td>
        </tr>
      ))}
    </>
  );
}
