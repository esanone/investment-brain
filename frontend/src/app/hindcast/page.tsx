import type { Metadata } from "next";
import { api } from "@/lib/api";
import type { HindcastPerf, Num } from "@/lib/types";
import { date, num, pct, ptsSigned, signed, signClass } from "@/lib/format";
import { CommandEmptyState } from "@/components/CommandEmptyState";
import { EmptyState } from "@/components/EmptyState";
import { EquityCurve } from "@/components/EquityCurve";
import { PageHeader } from "@/components/PageHeader";
import { Section } from "@/components/Section";

export * from "@/lib/segment-config";
export const metadata: Metadata = { title: "Hindcast" };

const RUN_COMMAND = "cd backend && .venv/bin/python -m brain.hindcast";

function ok(v: Num | undefined): v is number {
  return v !== null && v !== undefined && Number.isFinite(v);
}

/** "3m" -> 3, for ordering horizon keys. */
function horizonMonths(h: string): number {
  const n = parseFloat(h);
  return Number.isFinite(n) ? n : 0;
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

/**
 * Mean forward return of the five signal quintiles as a small bar chart around a zero line.
 * One series, so one hue; every bar carries its value (five marks) and a native tooltip.
 * A signal that works steps up from Q1 to Q5.
 */
function QuintileBars({ values, label }: { values: Num[]; label: string }) {
  const vals = [0, 1, 2, 3, 4].map((i) => (ok(values?.[i]) ? (values[i] as number) : null));
  const finite = vals.filter((v): v is number => v !== null);
  if (!finite.length) return <span className="text-muted">—</span>;
  const W = 190;
  const top = 14;
  const plot = 44;
  const bottom = 16;
  const lo = Math.min(0, ...finite);
  const hi = Math.max(0, ...finite);
  const span = hi - lo || 1;
  // Labels of negative bars sit under the bar, so keep a strip for them above the Q1..Q5 row.
  const below = lo < 0 ? 12 : 0;
  const y = (v: number) => top + ((hi - v) / span) * (plot - below);
  const band = W / 5;
  const bw = band - 10;
  return (
    <svg width={W} height={top + plot + bottom} role="img" aria-label={`${label}: mean forward return by quintile, ${vals.map((v, i) => `Q${i + 1} ${ptsSigned(v, 1)}`).join(", ")}`}>
      {vals.map((v, i) => {
        const cx = i * band + band / 2;
        if (v === null) {
          return (
            <text key={i} x={cx} y={y(0) - 4} textAnchor="middle" fontSize={10.5} fill="var(--text-subtle)">
              —
            </text>
          );
        }
        const h = Math.max(1, Math.abs(y(v) - y(0)));
        const yTop = v >= 0 ? y(v) : y(0);
        return (
          <g key={i}>
            <title>{`Q${i + 1}: ${ptsSigned(v, 2)}`}</title>
            <rect x={cx - bw / 2} y={yTop} width={bw} height={h} rx={Math.min(3, h / 2)} fill="var(--accent)" />
            <text x={cx} y={v >= 0 ? yTop - 3 : yTop + h + 10} textAnchor="middle" fontSize={10.5} fill="var(--text)">
              {signed(v, 1)}
            </text>
          </g>
        );
      })}
      <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" strokeWidth={1} />
      {vals.map((_, i) => (
        <text key={i} x={i * band + band / 2} y={top + plot + bottom - 3} textAnchor="middle" fontSize={10.5} fill="var(--text-muted)">
          Q{i + 1}
        </text>
      ))}
    </svg>
  );
}

function PerfCells({ p, dim = false }: { p: HindcastPerf | null | undefined; dim?: boolean }) {
  const cls = dim ? "num text-muted" : "num";
  return (
    <>
      <td className={`${cls} ${dim ? "" : "font-medium"}`.trim()}>{pct(p?.cagr, 1)}</td>
      <td className={cls}>{pct(p?.max_drawdown, 1)}</td>
      <td className={cls}>{num(p?.sharpe, 2)}</td>
      <td className={cls}>{pct(p?.turnover, 0)}</td>
    </>
  );
}

export default async function HindcastPage() {
  const res = await api.hindcast();
  if (!res.ok) {
    return (
      <>
        <PageHeader title="Hindcast" subtitle="Point-in-time replay of the signals and the portfolio rules" />
        {res.status === 404 ? (
          <CommandEmptyState title="No hindcast yet" command={RUN_COMMAND} message={res.message}>
            The hindcast replays the signals and rules over past dates. It is not part of the daily pipeline; run it once:
          </CommandEmptyState>
        ) : (
          <EmptyState message={res.message} />
        )}
      </>
    );
  }

  const h = res.data;
  const cfg = h.config ?? null;
  const sum = h.summary ?? null;
  const signals = h.signals ?? [];
  const rules = h.rules ?? [];
  const caveats = (h.caveats ?? []).filter(Boolean);
  const calibration = h.regime?.calibration ?? [];

  // Horizon columns: the configured ones, plus any key a signal reports that the config does not list.
  const horizonSet = new Set<string>((cfg?.horizons_months ?? []).map((m) => `${m}m`));
  for (const s of signals) for (const k of [...Object.keys(s.ic ?? {}), ...Object.keys(s.quintiles ?? {})]) horizonSet.add(k);
  const horizons = [...horizonSet].sort((a, b) => horizonMonths(a) - horizonMonths(b));
  const longest = horizons[horizons.length - 1] ?? null;

  const excess = ok(sum?.cagr) && ok(sum?.benchmark_cagr) ? (sum.cagr - sum.benchmark_cagr) * 100 : null;

  return (
    <>
      <PageHeader
        title="Hindcast"
        subtitle={
          <>
            Point-in-time replay of the signals and the portfolio rules · {num(h.anchors, 0)} anchor date{h.anchors === 1 ? "" : "s"}
            {cfg?.note && <div className="mt-0.5 text-[12px] text-subtle">{cfg.note}</div>}
          </>
        }
        meta={
          <>
            {date(cfg?.start)} → {date(cfg?.end)} · every {cfg?.step_months ?? "—"} month{cfg?.step_months === 1 ? "" : "s"} · horizons{" "}
            {(cfg?.horizons_months ?? []).map((m) => `${m}m`).join(" / ") || "—"} · universe {num(cfg?.universe_size, 0)} · generated {date(h.generated_at)}
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile
          label="CAGR"
          value={pct(sum?.cagr, 1)}
          sub={
            <>
              S&amp;P 500 {pct(sum?.benchmark_cagr, 1)}
              {excess !== null && <span className={`ml-1 ${signClass(excess)}`}>{`${excess > 0 ? "+" : ""}${excess.toFixed(1)} pts`}</span>}
              {ok(sum?.universe_cagr) && <span className="block">equal-weight universe {pct(sum?.universe_cagr, 1)}</span>}
            </>
          }
        />
        <Tile label="Max drawdown" value={pct(sum?.max_drawdown, 1)} sub={<>S&amp;P 500 {pct(sum?.benchmark_max_drawdown, 1)}, at rebalance dates</>} />
        <Tile label="Sharpe" value={num(sum?.sharpe, 2)} sub="annualised, strategy" />
        <Tile label="Turnover" value={pct(sum?.turnover, 0)} sub="strategy, annualised" />
        <Tile label="Hit rate" value={pct(sum?.hit_rate, 0)} sub="periods ahead of the benchmark" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Equity curve" subtitle="Strategy vs benchmark · both rebased to 100 at the first anchor" className="lg:col-span-2">
          <EquityCurve points={h.equity_curve ?? []} />
        </Section>

        <Section
          title="Signal information"
          subtitle={
            <>
              Rank IC of each signal against forward returns · t-stat in brackets · hit = share of anchors with a positive IC
              {longest && <> · quintile bars show the mean {longest} forward return (%) from the lowest (Q1) to the highest (Q5) signal bucket</>}
            </>
          }
          className="lg:col-span-2"
          flush
        >
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th rowSpan={2}>Signal</th>
                  {horizons.map((hz) => (
                    <th key={hz} colSpan={3} className="num border-l border-line">
                      {hz} forward
                    </th>
                  ))}
                  {longest && <th rowSpan={2} className="border-l border-line">Quintiles · {longest}</th>}
                </tr>
                <tr>
                  {horizons.map((hz) => (
                    <FragmentCols key={hz} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {signals.map((s) => (
                  <tr key={s.name}>
                    <td>
                      <span className="font-medium">{s.label ?? s.name}</span>
                      {s.label && s.label !== s.name && <span className="ml-2 mono text-subtle">{s.name}</span>}
                    </td>
                    {horizons.map((hz) => {
                      const ic = s.ic?.[hz];
                      return (
                        <IcCells key={hz} meanIc={ic?.mean_ic} tStat={ic?.t_stat} hitRate={ic?.hit_rate} n={ic?.n} />
                      );
                    })}
                    {longest && (
                      <td className="border-l border-line">
                        <QuintileBars values={s.quintiles?.[longest] ?? []} label={s.label ?? s.name} />
                      </td>
                    )}
                  </tr>
                ))}
                {!signals.length && (
                  <tr>
                    <td colSpan={2 + horizons.length * 3} className="text-muted">No signals measured.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section
          title="Regime calibration"
          subtitle={`Predicted probability of a growth-negative regime (Stagflation + Contraction) vs how often ${h.regime?.event ?? "it was realised"}${h.regime?.window ? `, ${h.regime.window}` : ""}`}
          actions={
            <div className="text-right">
              <div className="eyebrow">Brier</div>
              <div className="text-[18px] font-semibold leading-none">{num(h.regime?.brier, 3)}</div>
            </div>
          }
          flush
        >
          {h.regime ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Bin</th>
                    <th className="num">n</th>
                    <th className="num">Predicted</th>
                    <th className="num">Realised</th>
                    <th className="num" title="Realised − predicted, percentage points">Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {calibration.map((c, i) => {
                    const gap = ok(c.predicted) && ok(c.realised) ? (c.realised - c.predicted) * 100 : null;
                    return (
                      <tr key={`${c.bin}-${i}`}>
                        <td className="mono">{c.bin}</td>
                        <td className="num text-muted">{num(c.n, 0)}</td>
                        <td className="num">{pct(c.predicted, 0)}</td>
                        <td className="num font-medium">{pct(c.realised, 0)}</td>
                        <td className="num text-muted">{gap === null ? "—" : `${gap > 0 ? "+" : ""}${gap.toFixed(0)} pts`}</td>
                      </tr>
                    );
                  })}
                  {!calibration.length && (
                    <tr>
                      <td colSpan={5} className="text-muted">No calibration bins.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-4 py-3 text-[12.5px] text-muted">Regime calibration was not measured in this hindcast.</div>
          )}
        </Section>

        <Section title="Caveats" subtitle="What this replay cannot tell you">
          {caveats.length ? (
            <ul className="flex flex-col gap-1 text-[13px]">
              {caveats.map((c, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-warn">·</span>
                  <span>{c}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-[12.5px] text-muted">None recorded.</div>
          )}
        </Section>

        <Section title="Rule ablation" subtitle="The replay with each rule on vs the same replay with only that rule switched off" className="lg:col-span-2" flush>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th rowSpan={2}>Rule</th>
                  <th colSpan={4} className="num border-l border-line">With the rule</th>
                  <th colSpan={4} className="num border-l border-line">Without it</th>
                  <th rowSpan={2} className="border-l border-line">Note</th>
                </tr>
                <tr>
                  {["with", "without"].map((k) => (
                    <PerfHead key={k} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.name} className="align-top">
                    <td>
                      <span className="font-medium">{r.label ?? r.name}</span>
                    </td>
                    <PerfCells p={r.with_rule} />
                    <PerfCells p={r.without_rule} dim />
                    <td className="text-muted">
                      <div className="max-w-md whitespace-normal text-[12.5px]">{r.delta_note || "—"}</div>
                    </td>
                  </tr>
                ))}
                {!rules.length && (
                  <tr>
                    <td colSpan={10} className="text-muted">No rules ablated.</td>
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

function FragmentCols() {
  return (
    <>
      <th className="num border-l border-line">IC (t)</th>
      <th className="num">Hit</th>
      <th className="num">n</th>
    </>
  );
}

function PerfHead() {
  return (
    <>
      <th className="num border-l border-line">CAGR</th>
      <th className="num">Max DD</th>
      <th className="num">Sharpe</th>
      <th className="num">Turnover</th>
    </>
  );
}

/** IC with its t-stat, hit rate and sample size for one horizon. IC is green when positive, red when negative. */
function IcCells({ meanIc, tStat, hitRate, n }: { meanIc: Num | undefined; tStat: Num | undefined; hitRate: Num | undefined; n: Num | undefined }) {
  return (
    <>
      <td className="num border-l border-line">
        <span className={`font-medium ${signClass(meanIc)}`}>{signed(meanIc, 3)}</span>
        <span className="ml-1 text-[11.5px] text-subtle">({num(tStat, 1)})</span>
      </td>
      <td className="num text-muted">{pct(hitRate, 0)}</td>
      <td className="num text-muted">{num(n, 0)}</td>
    </>
  );
}
