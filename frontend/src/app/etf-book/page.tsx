import type { Metadata } from "next";
import { api } from "@/lib/api";
import type { EtfBook, EtfRow, TradeAction } from "@/lib/types";
import { date, money, num, pct, price, pts, ptsSigned, signClass, yesNo } from "@/lib/format";
import { CommandEmptyState } from "@/components/CommandEmptyState";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { ScoreBadge } from "@/components/ScoreBadge";
import { Section } from "@/components/Section";

export * from "@/lib/segment-config";
export const metadata: Metadata = { title: "ETF Book" };

const RUN_COMMAND = "cd backend && .venv/bin/python -m brain.pipeline run --skip-ingest";

const ACTION_CLASS: Record<TradeAction, string> = {
  BUY: "text-pos",
  SELL: "text-neg",
  ADD: "text-muted",
  TRIM: "text-muted",
};

/** Labels for the RULES dict in backend/brain/engines/etf_book.py; unknown keys fall back to the key itself. */
const RULE_LABELS: Record<string, string> = {
  trend_days: "Trend filter (days)",
  core_share: "Core share of the equity sleeve",
  n_satellites: "Satellites",
  satellite_cap: "Per-satellite cap",
  cluster_cap: "Correlation-cluster cap",
  crypto_cap: "Crypto cap",
  target_vol: "Target volatility",
  weights: "Score weights",
};

const COMPONENTS: { key: keyof EtfRow["components"]; label: string; short: string }[] = [
  { key: "flow", label: "Capital flow", short: "F" },
  { key: "regime", label: "Regime fit", short: "R" },
  { key: "theme", label: "Theme conviction", short: "T" },
  { key: "momentum", label: "12m momentum", short: "M" },
];

/** Which holding roles fill each Risk-engine posture sleeve. */
const SLEEVE_ROLES: Record<string, string[]> = {
  Equities: ["core", "satellite"],
  Treasuries: ["treasuries"],
  Credit: ["credit"],
  Gold: ["gold"],
  Commodities: ["commodities"],
};

function ruleFmt(v: EtfBook["rules"][string] | undefined): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return yesNo(v);
  if (typeof v === "string") return v.replace(/_/g, " ");
  if (typeof v === "object") {
    // Nested lookup (the score `weights`): rendered inline.
    return Object.entries(v).map(([k, x]) => `${k.replace(/_/g, " ")} ${Math.abs(x) <= 1 ? pct(x, 0) : num(x, 0)}`).join(" · ") || "—";
  }
  return Math.abs(v) < 1 && v !== 0 ? pct(v, 0) : num(v, Number.isInteger(v) ? 0 : 2);
}

function groupLabel(g: string | null | undefined): string {
  return g || "—";
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

function RoleChip({ role }: { role: string }) {
  return <span className={`chip ${role === "core" ? "border-accent bg-accent-soft text-accent" : ""}`}>{role}</span>;
}

/** The four score components as labelled 0-100 mini bars; a missing component shows an empty track. */
function ComponentBars({ c }: { c: EtfRow["components"] }) {
  return (
    <div className="flex items-center gap-2">
      {COMPONENTS.map(({ key, label, short }) => {
        const v = c?.[key];
        const ok = v !== null && v !== undefined && Number.isFinite(v);
        return (
          <span key={key} className="inline-flex items-center gap-1" title={`${label} ${ok ? num(v, 0) : "not measured"}`}>
            <span className="text-[10.5px] text-subtle">{short}</span>
            <span className="inline-block h-1.5 w-8 rounded-sm bg-[var(--meter-track)]">
              {ok && <span className="block h-full rounded-sm bg-[var(--meter-fill)]" style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />}
            </span>
          </span>
        );
      })}
    </div>
  );
}

/** Last price against the 10-month average, with the signed distance. */
function TrendCell({ t }: { t: EtfRow["trend"] | null | undefined }) {
  if (!t) return <>—</>;
  return (
    <>
      {price(t.last)} <span className="text-subtle">vs</span> <span className="text-muted">{price(t.sma)}</span>{" "}
      <span className={`ml-1 font-medium ${signClass(t.dist_pct)}`}>{ptsSigned(t.dist_pct, 1)}</span>
    </>
  );
}

function Signed({ v }: { v: number | null | undefined }) {
  return <span className={signClass(v)}>{ptsSigned(v, 1)}</span>;
}

/** Target (posture) against actual weight for one sleeve: two aligned bars on a shared scale. */
function SleeveRow({ name, target, actual, max }: { name: string; target: number | null; actual: number | null; max: number }) {
  const w = (v: number | null) => `${Math.max(0, Math.min(100, ((v ?? 0) / max) * 100))}%`;
  const diff = target === null || actual === null ? null : (actual - target) * 100;
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-x-3 text-[12.5px]">
      <span className="truncate">{name}</span>
      <div className="flex flex-col gap-0.5" title={`${name}: posture ${pct(target, 1)} · actual ${pct(actual, 1)}`}>
        <div className="h-1.5 w-full rounded-sm bg-[var(--meter-track)]">
          <div className="h-full rounded-sm bg-[var(--border-strong)]" style={{ width: w(target) }} />
        </div>
        <div className="h-1.5 w-full rounded-sm bg-[var(--meter-track)]">
          <div className="h-full rounded-sm bg-[var(--meter-fill)]" style={{ width: w(actual) }} />
        </div>
      </div>
      <span className="num whitespace-nowrap">
        <span className="text-muted">{pct(target, 1)}</span> <span className="text-subtle">→</span> <span className="font-medium">{pct(actual, 1)}</span>
        <span className={`ml-2 inline-block w-14 text-right text-[11.5px] ${signClass(diff)}`}>{diff === null ? "—" : `${diff > 0 ? "+" : ""}${diff.toFixed(1)} pts`}</span>
      </span>
    </div>
  );
}

export default async function EtfBookPage() {
  const [res, histRes] = await Promise.all([api.etfBook(), api.etfBookHistory()]);
  if (!res.ok) {
    return (
      <>
        <PageHeader title="ETF Book" subtitle="ETF-only alternative built from the same engines · separate from the stock portfolio" />
        {res.status === 404 ? (
          <CommandEmptyState title="No ETF book yet" command={RUN_COMMAND} message={res.message}>
            The ETF book is built by the pipeline alongside the stock portfolio. Run it once to produce the first snapshot:
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
  const history = histRes.ok ? histRes.data : [];
  const holdings = [...(b.holdings ?? [])].sort((x, y) => (y.weight ?? 0) - (x.weight ?? 0));
  const maxW = Math.max(0.0001, ...holdings.map((h) => h.weight ?? 0));
  const trades = b.trades ?? [];
  const alerts = b.alerts ?? [];
  const candidates = (b.candidates ?? []).slice(0, 25);
  const excluded = b.excluded_by_trend ?? [];
  const held = new Set(holdings.map((h) => h.symbol));
  const targetVol = typeof b.rules?.target_vol === "number" ? b.rules.target_vol * 100 : null;
  const volOver = s?.portfolio_vol_pct !== null && s?.portfolio_vol_pct !== undefined && targetVol !== null && s.portfolio_vol_pct > targetVol;

  // Posture sleeves against what the book actually holds (cash absorbs every sleeve with no ETF in trend).
  const byRole = b.by_role ?? {};
  const sleeveNames = [...new Set([...Object.keys(b.sleeves ?? {}), "Cash"])].sort((x, y) => (b.sleeves?.[y] ?? 0) - (b.sleeves?.[x] ?? 0));
  const sleeveRows = sleeveNames.map((name) => {
    const actual = name === "Cash" ? b.cash_weight ?? null : (SLEEVE_ROLES[name] ?? [name.toLowerCase()]).reduce((sum, r) => sum + (byRole[r] ?? 0), 0);
    return { name, target: b.sleeves?.[name] ?? null, actual };
  });
  const sleeveMax = Math.max(0.0001, ...sleeveRows.flatMap((r) => [r.target ?? 0, r.actual ?? 0]));
  const roleRows = Object.entries(byRole).sort((x, y) => y[1] - x[1]);
  const roleMax = Math.max(0.0001, ...roleRows.map(([, w]) => w));
  const ruleKeys = Object.keys(b.rules ?? {}).sort((x, y) => Number(typeof b.rules[x] === "object") - Number(typeof b.rules[y] === "object"));

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span>ETF Book</span>
            <span className="text-[14px] font-medium text-muted">{money(b.portfolio_value, 1)}</span>
            {cadence &&
              (cadence.mode === "recalibrate" ? (
                <span className="chip border-accent bg-accent-soft text-accent">Recalibrated this run · next {date(cadence.next_recalibration)}</span>
              ) : (
                <span className="chip">Monitoring · next recalibration {date(cadence.next_recalibration)}</span>
              ))}
            {b.is_initial && <span className="chip">Initial book</span>}
          </span>
        }
        subtitle={
          <>
            ETF-only alternative built from the same engines · separate from the stock portfolio
            <div className="mt-0.5 text-[12px] text-subtle">
              {b.regime ?? "—"} regime · risk {b.risk_label ?? "—"}
              {cadence?.last_recalibration && <> · last recalibration {date(cadence.last_recalibration)}</>}
            </div>
          </>
        }
        meta={<>as of {date(b.as_of)} · trades on the first run of each month, marked to market in between</>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Positions" value={num(s?.positions ?? holdings.length, 0)} sub={<>turnover {pct(s?.turnover, 1)} this run</>} />
        <Tile label="Cash" value={pct(b.cash_weight, 1)} sub="posture cash + sleeves out of trend" />
        <Tile
          label="Portfolio vol"
          value={<span className={volOver ? "text-warn" : ""}>{pts(s?.portfolio_vol_pct, 1)}</span>}
          sub={<>target {pts(targetVol, 0)} · before targeting {pts(s?.vol_before_targeting_pct, 1)}</>}
        />
        <Tile
          label="Vol scale"
          value={s?.vol_scale === null || s?.vol_scale === undefined ? "—" : <>×{num(s.vol_scale, 2)}</>}
          cls={s?.vol_scale !== null && s?.vol_scale !== undefined && s.vol_scale < 1 ? "text-warn" : ""}
          sub="exposure multiplier from vol targeting"
        />
        <Tile label="Beta to SPY" value={num(s?.beta_spy, 2)} sub="whole book, 60-day" />
        <Tile label="Weighted score" value={num(s?.weighted_score, 0)} sub="weight-averaged ETF score" />
        <Tile label="NAV index" value={num(b.nav_index, 3)} sub={<>1.000 at inception · peak {num(b.nav_peak, 3)}</>} />
        <Tile
          label="Drawdown"
          value={ptsSigned(b.drawdown_pct, 1)}
          cls={b.drawdown_pct !== null && b.drawdown_pct !== undefined && b.drawdown_pct < 0 ? "text-neg" : ""}
          sub="from NAV peak"
        />
        <Tile
          label="Period return"
          value={ptsSigned(b.period_return_pct, 2)}
          cls={signClass(b.period_return_pct)}
          sub={b.prior_as_of ? <>book since {date(b.prior_as_of)}</> : "book since prior run"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Holdings"
          subtitle={`${holdings.length} ETFs · sorted by weight · components: F flow, R regime fit, T theme conviction, M 12-month momentum`}
          className="lg:col-span-2"
          flush
        >
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Group</th>
                  <th className="num">Weight</th>
                  <th></th>
                  <th className="num">$</th>
                  <th className="num">Shares</th>
                  <th className="num">Score</th>
                  <th>Components</th>
                  <th>Theme</th>
                  <th className="num" title="Last price vs the 10-month (210-day) average, and the distance between them">Last vs 10m avg</th>
                  <th className="num">3m</th>
                  <th className="num">12m</th>
                  <th className="num">Entry</th>
                  <th className="num">P&amp;L %</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((h) => (
                  <tr key={h.symbol}>
                    <td className="font-medium">{h.symbol}</td>
                    <td className="max-w-56 truncate text-muted">{h.name}</td>
                    <td>
                      <RoleChip role={h.role} />
                    </td>
                    <td className="text-muted">
                      {groupLabel(h.group)}
                      {h.sector && <span className="ml-1.5 text-subtle">{h.sector}</span>}
                    </td>
                    <td className="num font-medium">{pct(h.weight, 1)}</td>
                    <td>
                      {/* Fixed width on the bar itself: a percentage-width cell collapses once the table scrolls sideways. */}
                      <div className="h-1.5 w-20 rounded-sm bg-[var(--meter-track)]">
                        <div className="h-full rounded-sm bg-[var(--meter-fill)]" style={{ width: `${Math.max(0, Math.min(100, ((h.weight ?? 0) / maxW) * 100))}%` }} />
                      </div>
                    </td>
                    <td className="num">{money(h.dollars, 1)}</td>
                    <td className="num text-muted">{num(h.shares, 1)}</td>
                    <td className="num">
                      <ScoreBadge value={h.score} />
                    </td>
                    <td>
                      <ComponentBars c={h.components} />
                    </td>
                    <td className="max-w-48 truncate text-muted">{h.theme ?? "—"}</td>
                    <td className="num">
                      <TrendCell t={h.trend} />
                    </td>
                    <td className="num">
                      <Signed v={h.trend?.ret_3m} />
                    </td>
                    <td className="num">
                      <Signed v={h.trend?.ret_12m} />
                    </td>
                    <td className="num text-muted">{price(h.entry_price)}</td>
                    <td className="num font-medium">
                      <Signed v={h.pnl_pct} />
                    </td>
                    <td>
                      {h.status === "new" ? <span className="chip border-accent bg-accent-soft text-accent">new</span> : <span className="chip">held</span>}
                      <span className="ml-1.5 text-[11.5px] text-subtle">{date(h.entered)}</span>
                    </td>
                  </tr>
                ))}
                {!holdings.length && (
                  <tr>
                    <td colSpan={17} className="text-muted">No ETF is in trend: the book is in cash.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section
          title="Sleeves"
          subtitle="Risk-engine posture vs what the book holds · a sleeve with no ETF above its 10-month average sits in cash, and vol targeting scales everything down"
          className="lg:col-span-2"
        >
          <div className="grid gap-x-10 gap-y-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="eyebrow">Posture vs actual</span>
                <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
                  <span className="inline-block h-1.5 w-4 rounded-sm bg-[var(--border-strong)]" /> posture
                </span>
                <span className="flex items-center gap-1.5 text-[11.5px] text-muted">
                  <span className="inline-block h-1.5 w-4 rounded-sm bg-[var(--meter-fill)]" /> actual
                </span>
              </div>
              <div className="flex flex-col gap-2">
                {sleeveRows.map((r) => (
                  <SleeveRow key={r.name} name={r.name} target={r.target} actual={r.actual} max={sleeveMax} />
                ))}
              </div>
            </div>
            <div>
              <div className="eyebrow mb-2">Actual by role</div>
              {roleRows.length ? (
                <div className="flex flex-col gap-1.5">
                  {roleRows.map(([role, w]) => (
                    <div key={role} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 text-[12.5px]">
                      <span className="truncate">{role}</span>
                      <span className="num font-medium">{pct(w, 1)}</span>
                      <div className="col-span-2 h-1.5 w-full rounded-sm bg-[var(--meter-track)]">
                        <div className="h-full rounded-sm bg-[var(--meter-fill)]" style={{ width: `${(w / roleMax) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[12.5px] text-muted">No holdings.</div>
              )}
            </div>
          </div>
        </Section>

        <Section
          title="This run's trades"
          subtitle={
            cadence?.mode === "monitor"
              ? `Monitoring run · the book only trades at the monthly recalibration (next ${date(cadence.next_recalibration)})`
              : b.is_initial && !b.prior_as_of
                ? "Initial construction · every position is a BUY"
                : `${trades.length} trade${trades.length === 1 ? "" : "s"}${b.prior_as_of ? ` vs ${date(b.prior_as_of)}` : ""}`
          }
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
                    <td className={`num ${signClass(t.dollars)}`}>
                      {t.dollars === null || t.dollars === undefined ? "—" : `${t.dollars > 0 ? "+" : ""}${money(t.dollars, 1)}`}
                    </td>
                    <td className="max-w-md truncate text-[12.5px] text-muted" title={t.reason}>
                      {t.reason}
                    </td>
                  </tr>
                ))}
                {!trades.length && (
                  <tr>
                    <td colSpan={8} className="text-muted">No trades.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section
          title="Alerts"
          subtitle={
            alerts.length
              ? `${alerts.length} held ETF${alerts.length === 1 ? "" : "s"} below the 10-month average · exits wait for the next recalibration`
              : "Trend breaks on held ETFs, pending the next recalibration"
          }
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
                {!alerts.length && (
                  <tr>
                    <td colSpan={4} className="text-muted">No trend breaks pending.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Candidates" subtitle={`Top ${candidates.length} ETFs by score · ✓ = above the 10-month average and eligible to be held`} className="lg:col-span-2" flush>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th className="num w-8">#</th>
                  <th>Symbol</th>
                  <th>Name</th>
                  <th>Group</th>
                  <th className="num">Score</th>
                  <th>Components</th>
                  <th>Theme</th>
                  <th className="num">Last vs 10m avg</th>
                  <th className="num">1m</th>
                  <th className="num">3m</th>
                  <th className="num">12m</th>
                  <th>Eligible</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c, i) => (
                  <tr key={c.symbol}>
                    <td className="num text-subtle">{i + 1}</td>
                    <td className="font-medium">
                      {c.symbol}
                      {held.has(c.symbol) && <span className="ml-1.5 text-[11px] font-normal text-accent">held</span>}
                    </td>
                    <td className="max-w-56 truncate text-muted">{c.name}</td>
                    <td className="text-muted">{groupLabel(c.group)}</td>
                    <td className="num">
                      <ScoreBadge value={c.score} />
                    </td>
                    <td>
                      <ComponentBars c={c.components} />
                    </td>
                    <td className="max-w-48 truncate text-muted">{c.theme ?? "—"}</td>
                    <td className="num">
                      <TrendCell t={c.trend} />
                    </td>
                    <td className="num">
                      <Signed v={c.trend?.ret_1m} />
                    </td>
                    <td className="num">
                      <Signed v={c.trend?.ret_3m} />
                    </td>
                    <td className="num">
                      <Signed v={c.trend?.ret_12m} />
                    </td>
                    <td className={c.eligible ? "text-pos" : "text-neg"}>
                      <span className="mr-1">{c.eligible ? "✓" : "✗"}</span>
                      {c.eligible ? "in trend" : "below trend"}
                    </td>
                  </tr>
                ))}
                {!candidates.length && (
                  <tr>
                    <td colSpan={12} className="text-muted">No ETFs scored.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Excluded by trend" subtitle="Below the 10-month average, so not eligible whatever the score · best scores first" flush>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Name</th>
                  <th>Group</th>
                  <th className="num">vs 10m avg</th>
                  <th className="num">Score</th>
                </tr>
              </thead>
              <tbody>
                {excluded.map((x) => (
                  <tr key={x.symbol}>
                    <td className="font-medium">{x.symbol}</td>
                    <td className="max-w-56 truncate text-muted">{x.name}</td>
                    <td className="text-muted">{groupLabel(x.group)}</td>
                    <td className={`num ${signClass(x.dist_pct)}`}>{ptsSigned(x.dist_pct, 1)}</td>
                    <td className="num">
                      <ScoreBadge value={x.score} />
                    </td>
                  </tr>
                ))}
                {!excluded.length && (
                  <tr>
                    <td colSpan={5} className="text-muted">Every scored ETF is above its 10-month average.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Rules" subtitle="Construction constraints applied at every recalibration">
          <dl className="grid gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-2">
            {ruleKeys.map((k) => (
              <div key={k} className={`flex items-baseline justify-between gap-3 border-b border-line py-1 ${typeof b.rules[k] === "object" ? "sm:col-span-2" : ""}`}>
                <dt className="text-muted">{RULE_LABELS[k] ?? k.replace(/_/g, " ")}</dt>
                <dd className="text-right font-medium">{ruleFmt(b.rules[k])}</dd>
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
                  <th>Mode</th>
                  <th className="num">Positions</th>
                  <th className="num">Cash</th>
                  <th className="num">NAV index</th>
                  <th className="num">Drawdown</th>
                  <th className="num">Trades</th>
                  <th>Holdings</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => {
                  const shown = (h.holdings ?? []).slice(0, 12);
                  const rest = (h.holdings ?? []).length - shown.length;
                  return (
                    <tr key={h.run_id}>
                      <td className="mono">{date(h.as_of)}</td>
                      <td className={h.mode === "recalibrate" ? "" : "text-muted"}>{h.mode ?? "—"}</td>
                      <td className="num">{num(h.positions, 0)}</td>
                      <td className="num">{pct(h.cash_weight, 1)}</td>
                      <td className="num">{num(h.nav_index, 3)}</td>
                      <td className={`num ${h.drawdown_pct !== null && h.drawdown_pct !== undefined && h.drawdown_pct < 0 ? "text-neg" : "text-muted"}`}>{ptsSigned(h.drawdown_pct, 1)}</td>
                      <td className="num">{num(h.trades, 0)}</td>
                      <td className="mono max-w-md truncate text-muted" title={(h.holdings ?? []).join(", ")}>
                        {shown.join(", ")}
                        {rest > 0 && <span className="text-subtle"> +{rest}</span>}
                      </td>
                    </tr>
                  );
                })}
                {!history.length && (
                  <tr>
                    <td colSpan={8} className="text-muted">No ETF-book history yet.</td>
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
