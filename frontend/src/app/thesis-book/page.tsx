import type { Metadata } from "next";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Num, ThesisBook, TradeAction } from "@/lib/types";
import { companyHref, date, money, num, pct, price, pts, ptsSigned, signClass } from "@/lib/format";
import { CommandEmptyState } from "@/components/CommandEmptyState";
import { DirectionChip } from "@/components/DirectionChip";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";
import { ThesisCandidatesTable, ThesisHoldingsTable } from "@/components/ThesisBookTables";
import { ThesisRefChip } from "@/components/ThesisV2Chips";

export * from "@/lib/segment-config";
export const metadata: Metadata = { title: "Thesis-driven portfolio" };

const TITLE = "Thesis-driven portfolio";
const SUBTITLE =
  "Positions start from the theses (ledger, structural shifts, morning briefs). Valuation only excludes names priced above their bull scenario; market, sector and trend gates apply afterwards.";
const RUN_COMMAND = "python -m brain.pipeline run --skip-ingest";

const ACTION_CLASS: Record<TradeAction, string> = {
  BUY: "text-pos",
  SELL: "text-neg",
  ADD: "text-muted",
  TRIM: "text-muted",
};

const SOURCE_LABELS: [keyof NonNullable<NonNullable<ThesisBook["rules"]>["weights"]>, string][] = [
  ["ledger", "Ledger"],
  ["structural", "Structural shifts"],
  ["brief", "Morning briefs"],
];

/** Gates in the order the engine applies them; each count is the number of favoured names that gate stopped. */
const GATES: { key: "above_bull" | "market_gate" | "sector_gate" | "trend_gate" | "earnings" | "caps"; label: string; title: string }[] = [
  { key: "above_bull", label: "Above bull (excluded)", title: "Priced above the bull fair-value scenario: the only valuation test" },
  { key: "market_gate", label: "Market gate", title: "Index below its 10-month average and behind T-bills: no new entries" },
  { key: "sector_gate", label: "Sector gate", title: "Capital is rotating out of the name's sector" },
  { key: "trend_gate", label: "Trend gate", title: "Trend template not ready or below the minimum score" },
  { key: "earnings", label: "Earnings", title: "Earnings expected within the blackout window; entry deferred" },
  { key: "caps", label: "Caps", title: "Book full, size below the minimum, or a sector / theme / cluster / equity cap" },
];

function ok(v: Num | undefined): v is number {
  return v !== null && v !== undefined && Number.isFinite(v);
}

/** Probability-like value that should be a fraction; tolerates a 0-100 value. */
function frac(v: Num | undefined): number | null {
  if (!ok(v)) return null;
  return v > 1 ? v / 100 : v;
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
            <div className="h-full rounded-sm bg-[var(--meter-fill)]" style={{ width: `${Math.max(0, Math.min(100, ((w ?? 0) / max) * 100))}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TickerLinks({ tickers, empty = "—" }: { tickers: string[] | null | undefined; empty?: string }) {
  if (!tickers?.length) return <span className="text-subtle">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-x-2 gap-y-0.5">
      {tickers.map((t) => (
        <Link key={t} href={companyHref(t)} className="mono font-medium hover:text-accent">
          {t}
        </Link>
      ))}
    </span>
  );
}

/** One box of the selection funnel. Gates show how many names they stopped and how many were left afterwards. */
function FunnelStep({ label, value, sub, title, tone = "" }: { label: string; value: React.ReactNode; sub?: React.ReactNode; title?: string; tone?: string }) {
  return (
    <div className={`min-w-24 flex-1 rounded border px-2.5 py-2 ${tone || "border-line bg-surface-2"}`} title={title}>
      <div className="text-[11px] leading-tight text-muted">{label}</div>
      <div className="mt-1 text-[18px] font-semibold leading-none">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-subtle">{sub}</div>}
    </div>
  );
}

export default async function ThesisBookPage() {
  const [res, histRes] = await Promise.all([api.thesisBook(), api.thesisBookHistory()]);
  if (!res.ok) {
    return (
      <>
        <PageHeader title={TITLE} subtitle={SUBTITLE} />
        {res.status === 404 ? (
          <CommandEmptyState title="No thesis-driven portfolio yet" command={RUN_COMMAND} message={res.message}>
            The thesis-driven book is built by the pipeline alongside the valuation-trend portfolio. Run it once to produce the first snapshot:
          </CommandEmptyState>
        ) : (
          <EmptyState message={res.message} />
        )}
      </>
    );
  }

  const b = res.data;
  const s = b.stats ?? null;
  const cadence = b.cadence ?? null;
  const gate = b.regime_gate ?? null;
  const rules = b.rules ?? null;
  const funnel = b.funnel ?? null;
  const sources = b.sources ?? null;
  const mt = b.market_thesis ?? null;
  const history = histRes.ok ? histRes.data : [];
  const holdings = b.holdings ?? [];
  const trades = b.trades ?? [];
  const exits = b.exits ?? [];
  const alerts = b.alerts ?? [];
  const candidates = b.candidates ?? [];
  const theses = b.theses ?? [];
  const shifts = b.shifts ?? [];
  const notHeld = candidates.filter((c) => c.status !== "selected").length;
  const monitoring = cadence?.mode === "monitor";

  const targetVol = typeof rules?.target_vol === "number" ? rules.target_vol * 100 : null;
  // The engine writes 0.0 when it has no price history to measure volatility from.
  const vol = ok(s?.portfolio_vol_pct) && s.portfolio_vol_pct > 0 ? s.portfolio_vol_pct : null;
  const volBefore = ok(s?.vol_before_targeting_pct) && s.vol_before_targeting_pct > 0 ? s.vol_before_targeting_pct : null;
  const scaled = ok(s?.vol_scale) && s.vol_scale < 1;
  const maxPositions = typeof rules?.max_positions === "number" ? rules.max_positions : null;
  const minScore = typeof rules?.min_thesis_score === "number" ? rules.min_thesis_score : null;

  // Running count of favoured names still alive after each gate.
  const gateSteps = GATES.reduce<{ key: string; label: string; title: string; stopped: number | null; left: number | null }[]>((acc, g) => {
    const before = acc.length ? acc[acc.length - 1].left : ok(funnel?.favoured) ? funnel.favoured : null;
    const stopped = ok(funnel?.[g.key]) ? funnel[g.key] : null;
    acc.push({ ...g, stopped, left: before === null ? null : before - (stopped ?? 0) });
    return acc;
  }, []);

  const sectorRows: [string, number][] = Object.entries(s?.sector_weights ?? {}).sort((x, y) => y[1] - x[1]);
  const themeRows: [string, number][] = [...(s?.theme_weights ?? [])];
  const overlap = s?.overlap_with_valuation_book ?? [];
  const caps: [string, Num | undefined][] = [
    ["max weight", typeof rules?.max_weight === "number" ? rules.max_weight : null],
    ["sector cap", typeof rules?.sector_cap === "number" ? rules.sector_cap : null],
    ["theme cap", typeof rules?.theme_cap === "number" ? rules.theme_cap : null],
    ["cluster cap", typeof rules?.cluster_cap === "number" ? rules.cluster_cap : null],
  ];

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span>{TITLE}</span>
            <span className="text-[14px] font-medium text-muted">{money(b.portfolio_value, 1)}</span>
            {cadence &&
              (cadence.mode === "recalibrate" ? (
                <span className="chip border-accent bg-accent-soft text-accent" title={`Next recalibration ${date(cadence.next_recalibration)}`}>
                  Recalibrated today
                </span>
              ) : (
                <span className="chip" title={`Last recalibration ${date(cadence.last_recalibration)} · only the hard stop exits in between`}>
                  Monitoring · next {date(cadence.next_recalibration)}
                </span>
              ))}
            {gate && (
              <span className={`chip ${gate.open ? "border-pos bg-pos-soft text-pos" : "border-neg bg-neg-soft text-neg"}`} title={gate.note ?? undefined}>
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
              {gate?.note && <> · {gate.note}</>}
            </div>
          </>
        }
        meta={
          <>
            as of {date(b.as_of)} · monthly recalibration · last {date(cadence?.last_recalibration ?? b.last_recalibration)} · next {date(cadence?.next_recalibration)}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          label="Positions"
          value={num(holdings.length, 0)}
          sub={
            <>
              {maxPositions !== null && <>max {num(maxPositions, 0)} · </>}
              {num(s?.between_base_and_bull, 0)} between base and bull
            </>
          }
        />
        <Tile label="Equity" value={pct(b.equity_weight, 1)} sub={<>cap {pct(b.equity_cap, 0)} from the risk posture</>} />
        <Tile label="Cash" value={pct(b.cash_weight, 1)} sub={<>turnover {pct(s?.turnover, 1)} at the last recalibration</>} />
        <Tile label="Wtd thesis score" value={num(s?.weighted_thesis_score, 0)} sub={minScore !== null ? <>0-100 · favoured from {num(minScore, 0)}</> : "0-100, weight-averaged"} />
        <Tile label="Wtd thesis probability" value={pct(frac(s?.weighted_probability), 0)} sub="chance the theses behind the book play out" />
        <Tile
          label="Book volatility"
          value={<span className={vol !== null && targetVol !== null && vol > targetVol ? "text-warn" : ""}>{pts(vol, 1)}</span>}
          sub={
            <>
              vol scale <span className={scaled ? "text-warn" : ""}>×{num(s?.vol_scale, 2)}</span> · target {pts(targetVol, 0)}
              {volBefore !== null && scaled && <> · {pts(volBefore, 1)} before</>}
            </>
          }
        />
        <Tile label="Avg stop distance" value={pts(s?.avg_stop_distance_pct, 1)} sub="weight-averaged to the active stop" />
        <Tile
          label="NAV index"
          value={num(b.nav_index, 3)}
          sub={
            <>
              drawdown <span className={ok(b.drawdown_pct) && b.drawdown_pct < 0 ? "text-neg" : ""}>{ptsSigned(b.drawdown_pct, 1)}</span> · peak {num(b.nav_peak, 3)} · period{" "}
              <span className={signClass(b.period_return_pct)}>{ptsSigned(b.period_return_pct, 2)}</span>
            </>
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="How names were selected"
          subtitle={
            monitoring
              ? `Funnel from the ${date(cadence?.last_recalibration)} recalibration · thesis favour first, then the bull ceiling, then the gates`
              : "Thesis favour first, then the bull ceiling, then the market, sector and trend gates"
          }
          className="lg:col-span-2"
        >
          <div className="flex flex-wrap items-stretch gap-1.5">
            <FunnelStep
              label="Favoured by thesis"
              value={num(funnel?.favoured, 0)}
              sub={<>of {num(funnel?.universe, 0)} scored</>}
              title={`Thesis score at or above ${minScore ?? "the minimum"}, backed by the ledger or a strong structural shift, and not a net loser in the ledger`}
              tone="border-accent bg-accent-soft"
            />
            {gateSteps.map((g) => (
              <FunnelStep
                key={g.key}
                label={g.label}
                value={g.stopped === null ? "—" : g.stopped > 0 ? <>−{g.stopped}</> : <span className="text-subtle">0</span>}
                sub={g.left === null ? undefined : <>{g.left} left</>}
                title={g.title}
              />
            ))}
            <FunnelStep label="Selected" value={num(funnel?.selected, 0)} sub="in the book" tone="border-pos bg-pos-soft" />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px]">
            <span>
              <span className="text-muted">Thesis score = </span>
              {SOURCE_LABELS.map(([k, l], i) => (
                <span key={k}>
                  {i > 0 && <span className="text-subtle"> + </span>}
                  <span className="font-medium">{pct(rules?.weights?.[k], 0)}</span> {l}
                </span>
              ))}
            </span>
            <span className="text-muted">
              Sources: {num(sources?.ledger?.n_theses, 0)} open theses · {num(sources?.structural?.n_shifts, 0)} structural shifts as of {date(sources?.structural?.as_of)} ·{" "}
              {num(sources?.briefs?.n, 0)} briefs to {date(sources?.briefs?.latest)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-subtle">
            {typeof rules?.valuation_rule === "string" && <span>Valuation: {rules.valuation_rule}</span>}
            <span>
              Caps:{" "}
              {caps.map(([l, v], i) => (
                <span key={l}>
                  {i > 0 && " · "}
                  {l} {pct(v, 0)}
                </span>
              ))}
            </span>
            {ok(funnel?.headwind) && funnel.headwind > 0 && <span>{funnel.headwind} high-scoring names dropped as net losers in the ledger</span>}
          </div>
        </Section>

        <Section
          title="Holdings"
          subtitle={`${holdings.length} positions · sorted by weight · L / S / B = ledger, structural, brief scores · expand a row for every driver, sizing notes and stops`}
          className="lg:col-span-2"
          flush
        >
          <ThesisHoldingsTable rows={holdings} />
        </Section>

        {trades.length > 0 && (
          <Section
            title="This run's trades"
            subtitle={
              b.is_initial && !b.prior_as_of
                ? "Initial construction · every position is a BUY"
                : `${trades.length} trade${trades.length === 1 ? "" : "s"}${b.prior_as_of ? ` vs ${date(b.prior_as_of)}` : ""}`
            }
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
                  {trades.map((t, i) => (
                    <tr key={`${t.action}-${t.ticker}-${i}`}>
                      <td className={`font-semibold ${ACTION_CLASS[t.action] ?? "text-muted"}`}>{t.action}</td>
                      <td>
                        <Link href={companyHref(t.ticker)} className="font-medium">
                          {t.ticker}
                        </Link>
                      </td>
                      <td className="max-w-48 truncate text-muted">{t.name ?? "—"}</td>
                      <td className="num text-muted">{pct(t.from, 1)}</td>
                      <td className="num text-subtle">→</td>
                      <td className="num font-medium">{pct(t.to, 1)}</td>
                      <td className={`num ${signClass(t.dollars)}`}>{ok(t.dollars) ? `${t.dollars > 0 ? "+" : ""}${money(t.dollars, 1)}` : "—"}</td>
                      <td className="max-w-xl truncate text-[12.5px] text-muted" title={t.reason}>
                        {t.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        {exits.length > 0 && (
          <Section
            title="Exits"
            subtitle={`${exits.length} position${exits.length === 1 ? "" : "s"} closed this run`}
            className={alerts.length ? "" : "lg:col-span-2"}
            flush
          >
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th className="num">Prior weight</th>
                    <th className="num">Entry → exit</th>
                    <th className="num">P&amp;L</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {exits.map((e, i) => (
                    <tr key={`${e.ticker}-${i}`} className="align-top">
                      <td>
                        <Link href={companyHref(e.ticker)} className="font-medium">
                          {e.ticker}
                        </Link>
                        <div className="max-w-40 truncate text-[11.5px] text-muted">{e.name ?? ""}</div>
                      </td>
                      <td className="num">{pct(e.prior_weight, 1)}</td>
                      <td className="num text-muted">
                        {price(e.entry_price)} → {price(e.exit_price)}
                      </td>
                      <td className={`num font-medium ${signClass(e.pnl_pct)}`}>{ptsSigned(e.pnl_pct, 1)}</td>
                      <td>
                        <div className="w-64 whitespace-normal text-[12.5px] sm:w-80">{e.reason}</div>
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
            subtitle={`${alerts.length} rule outcome${alerts.length === 1 ? "" : "s"} on held positions · acted on at the next recalibration (${date(cadence?.next_recalibration)})`}
            className={exits.length ? "" : "lg:col-span-2"}
            flush
          >
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th className="num">Weight</th>
                    <th>Alert</th>
                  </tr>
                </thead>
                <tbody>
                  {alerts.map((a, i) => (
                    <tr key={`${a.ticker}-${i}`} className="align-top">
                      <td>
                        <Link href={companyHref(a.ticker)} className="font-medium">
                          {a.ticker}
                        </Link>
                        <div className="max-w-40 truncate text-[11.5px] text-muted">{a.name ?? ""}</div>
                      </td>
                      <td className="num font-medium">{pct(a.weight, 1)}</td>
                      <td>
                        <div className="flex w-64 gap-2 whitespace-normal text-[12.5px] sm:w-80">
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
          title="Theses behind the book"
          subtitle={
            <Link href="/thesis-v2" className="hover:text-accent">
              Open theses from the Human Futures Engine ledger · book weight = holdings tied to each thesis (a name can count towards several)
            </Link>
          }
          flush
        >
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Thesis</th>
                  <th>Title</th>
                  <th className="num" title="Posterior probability that the thesis plays out">Posterior</th>
                  <th className="num">Horizon</th>
                  <th className="num">Book weight</th>
                  <th>Held</th>
                </tr>
              </thead>
              <tbody>
                {theses.map((t) => (
                  <tr key={t.id} className={`align-top ${ok(t.weight) && t.weight > 0 ? "" : "dim"}`}>
                    <td>
                      <ThesisRefChip id={t.id} />
                    </td>
                    <td>
                      <Link href={`/thesis-v2/${t.id}`} className="block w-56 whitespace-normal text-[12.5px] sm:w-64">
                        {t.title ?? "—"}
                      </Link>
                    </td>
                    <td className="num font-medium">{pts(t.posterior, 0)}</td>
                    <td className="num text-muted">{t.horizon ? date(t.horizon).slice(0, 4) : "—"}</td>
                    <td className="num font-medium">{pct(t.weight, 1)}</td>
                    <td>
                      <div className="w-40 whitespace-normal">
                        <TickerLinks tickers={t.held} />
                      </div>
                    </td>
                  </tr>
                ))}
                {!theses.length && (
                  <tr>
                    <td colSpan={6} className="text-muted">No open theses in the ledger.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section
          title="Structural shifts"
          subtitle={
            <Link href="/thesis" className="hover:text-accent">
              From the long-term thesis · strongest first · held = positions exposed to the shift&apos;s themes
            </Link>
          }
        >
          {shifts.length ? (
            <ul className="flex flex-col gap-3">
              {shifts.map((sh, i) => (
                <li key={i} className="border-b border-line pb-3 text-[12.5px] last:border-b-0 last:pb-0">
                  <p className="leading-relaxed">{sh.shift ?? "—"}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
                    <span>
                      confidence <span className="font-medium text-ink">{pct(frac(sh.confidence), 0)}</span>
                    </span>
                    {sh.trend && <span>{sh.trend}</span>}
                    {(sh.themes ?? []).map((th) => (
                      <span key={th} className="chip">
                        {th}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-[11.5px]">
                    <span className="text-muted">held</span>
                    <TickerLinks tickers={sh.held} empty="none" />
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-[12.5px] text-muted">No structural shifts recorded.</div>
          )}
        </Section>

        <Section
          title="Favoured by thesis but not held"
          subtitle={`${notHeld} of the top ${candidates.length} names by thesis score · the gate that stopped each one, and why${monitoring ? ` · as of the ${date(cadence?.last_recalibration)} recalibration` : ""}`}
          className="lg:col-span-2"
          flush
        >
          <ThesisCandidatesTable rows={candidates} />
        </Section>

        <Section title="Exposure" subtitle="Book weight by sector and theme · theme weights are effective exposures, not additive" className="lg:col-span-2">
          <div className="grid gap-x-8 gap-y-4 md:grid-cols-3">
            <div>
              <div className="eyebrow mb-2">Sector weights</div>
              <WeightBars rows={sectorRows} empty="No sector weights." />
            </div>
            <div>
              <div className="eyebrow mb-2">Theme weights</div>
              <WeightBars rows={themeRows} empty="No theme weights." />
            </div>
            <div>
              <div className="eyebrow mb-2">
                Overlap with the{" "}
                <Link href="/portfolio" className="hover:text-accent">
                  valuation-trend book
                </Link>
              </div>
              {overlap.length ? (
                <>
                  <div className="text-[12.5px]">
                    <span className="font-medium">{overlap.length}</span> of {holdings.length} positions are in both books
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {overlap.map((t) => (
                      <Link key={t} href={companyHref(t)} className="chip hover:text-accent">
                        <span className="font-medium text-ink">{t}</span>
                      </Link>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-[12.5px] text-muted">No position is shared with the valuation-trend book.</div>
              )}
            </div>
          </div>
        </Section>

        <Section
          title="Market thesis"
          subtitle={
            <Link href="/brief" className="hover:text-accent">
              From the morning brief{mt?.as_of ? ` of ${date(mt.as_of)}` : ""} · long-term view
            </Link>
          }
          actions={<DirectionChip direction={mt?.direction ?? null} />}
        >
          {mt?.long_term ? <p className="text-[13px] leading-relaxed">{mt.long_term}</p> : <div className="text-[12.5px] text-muted">The latest brief carries no long-term market thesis.</div>}
          <div className="mt-2 text-[11.5px] text-muted">
            confidence <span className="font-medium text-ink">{pct(frac(mt?.confidence), 0)}</span>
          </div>
        </Section>

        <Section title="History" subtitle={histRes.ok ? `${history.length} runs · newest first` : histRes.message} flush>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>As of</th>
                  <th>Mode</th>
                  <th className="num">Positions</th>
                  <th className="num">Equity</th>
                  <th className="num">NAV index</th>
                  <th>Trades</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const list = h.trades ?? [];
                  const shown = list.slice(0, 6);
                  const text = (ts: typeof list) => ts.map((t) => `${t.action} ${t.ticker}${t.action === "SELL" ? "" : ` ${pct(t.to, 1)}`}`).join(", ");
                  return (
                    <tr key={h.run_id}>
                      <td className="mono">{date(h.as_of)}</td>
                      <td className={h.mode === "recalibrate" ? "" : "text-muted"}>{h.mode ?? "—"}</td>
                      <td className="num">{num(h.positions, 0)}</td>
                      <td className="num">{pct(h.equity_weight, 1)}</td>
                      <td className="num">{num(h.nav_index, 3)}</td>
                      <td className="mono max-w-xs truncate text-muted" title={text(list)}>
                        {list.length ? text(shown) : "—"}
                        {list.length > shown.length && <span className="text-subtle"> +{list.length - shown.length}</span>}
                      </td>
                    </tr>
                  );
                })}
                {!history.length && (
                  <tr>
                    <td colSpan={6} className="text-muted">No thesis-book history yet.</td>
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
