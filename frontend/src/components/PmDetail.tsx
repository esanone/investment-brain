import type { ErBand, Num, PmCatalyst, PmCatalystItem, PmEntry, PmExpectedReturn, PmMomentum } from "@/lib/types";
import { PM_COMPONENT_KEYS } from "@/lib/types";
import { num, pct, price, pts, ptsSigned, signClass, weight } from "@/lib/format";
import { ScoreBadge } from "./ScoreBadge";

/*
 * Building blocks for the portfolio-management layer (backend pm.py / portfolio.py `_pm_detail`).
 * No hooks, no browser APIs: usable from server pages and from the client HoldingsTable alike.
 */

/** Human labels for the six Entry Score components (pm.py WEIGHTS). */
export const PM_COMPONENT_LABELS: Record<string, string> = {
  fundamentals: "Fundamentals",
  valuation: "Valuation",
  momentum: "Momentum",
  catalyst: "Catalyst",
  regime: "Regime",
  flows: "Flows",
};

/** Human labels for the expected-return bands (pm.py ER_BANDS). */
export const ER_BAND_LABELS: Record<ErBand, string> = {
  accumulate: "accumulate",
  build: "build",
  hold: "hold",
  reduce: "reduce",
  exit_candidate: "exit candidate",
};

const ER_BAND_CLASS: Record<ErBand, string> = {
  accumulate: "border-pos bg-pos-soft text-pos",
  build: "border-pos bg-pos-soft text-pos",
  hold: "",
  reduce: "border-warn bg-warn-soft text-warn",
  exit_candidate: "border-neg bg-neg-soft text-neg",
};

/** Human labels for the momentum checks (pm.py `momentum_detail`). Order = display order; core checks first. */
export const PM_MOMENTUM_CHECKS: { key: string; label: string; core: boolean }[] = [
  { key: "above_200dma", label: "Above 200-day", core: true },
  { key: "50_above_200", label: "50 > 200-day", core: true },
  { key: "rs_3m_vs_spy_positive", label: "3m RS vs SPY positive", core: true },
  { key: "rs_6m_vs_spy_positive", label: "6m RS vs SPY positive", core: true },
  { key: "12m_positive", label: "12m return positive", core: true },
  { key: "rs_3m_vs_sector_positive", label: "3m RS vs sector positive", core: false },
  { key: "rs_6m_vs_sector_positive", label: "6m RS vs sector positive", core: false },
];

/** Human labels for catalyst kinds (pm.py `catalyst_score`). */
export const PM_CATALYST_KIND_LABELS: Record<string, string> = {
  scheduled: "scheduled",
  observed: "observed",
  thesis: "thesis",
  inferred: "inferred",
};

/** Expected-return band chip: accumulate/build green, hold muted, reduce amber, exit candidate red. */
export function ErBandChip({ band, title }: { band: ErBand | string | null | undefined; title?: string }) {
  if (!band) return <span className="chip">—</span>;
  const b = band as ErBand;
  return (
    <span className={`chip whitespace-nowrap ${ER_BAND_CLASS[b] ?? ""}`} title={title}>
      {ER_BAND_LABELS[b] ?? band.replace(/_/g, " ")}
    </span>
  );
}

/** Signed expected return in percent points, coloured, with the band chip beside it. */
export function ErCell({ value, band, title }: { value: Num | undefined; band: ErBand | string | null | undefined; title?: string }) {
  if ((value === null || value === undefined) && !band) return <>—</>;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={`font-medium ${signClass(value)}`}>{ptsSigned(value, 1)}</span>
      {band && <ErBandChip band={band} title={title} />}
    </span>
  );
}

/** Momentum score with a warnings-count badge when > 0. */
export function MomCell({ m }: { m: PmMomentum | null | undefined }) {
  if (!m) return <>—</>;
  const n = m.n_warnings ?? m.warnings?.length ?? 0;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={n > 0 ? m.warnings.join(" · ") : `${m.core_passes}/5 core checks · size ×${num(m.grade, 2)}`}>
      <ScoreBadge value={m.momentum_score} />
      {n > 0 && (
        <span className="inline-flex min-w-4 justify-center rounded-full border border-warn bg-warn-soft px-1 text-[10.5px] font-medium leading-4 text-warn">
          {n}
        </span>
      )}
    </span>
  );
}

/** Six components with their weights as small bars. `size="lg"` for the company page. */
export function EntryBreakdown({ entry, size = "sm" }: { entry: PmEntry; size?: "sm" | "lg" }) {
  const text = size === "lg" ? "text-[13px]" : "text-[12.5px]";
  const h = size === "lg" ? "h-2" : "h-1.5";
  return (
    <div className="flex flex-col gap-1.5">
      {PM_COMPONENT_KEYS.map((k) => {
        const v = entry.components?.[k] ?? null;
        const w = entry.weights?.[k];
        const missing = v === null || v === undefined || !Number.isFinite(v);
        return (
          <div key={k} className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-0.5 ${text}`}>
            <span className={`truncate ${missing ? "text-subtle" : ""}`}>{PM_COMPONENT_LABELS[k] ?? k}</span>
            <span className="num w-10 text-right text-[11px] text-subtle" title="Weight in the Entry Score">
              {weight(w)}
            </span>
            <span className={`num w-8 text-right font-medium ${missing ? "text-subtle" : ""}`}>{num(v, 0)}</span>
            <div className={`col-span-3 ${h} w-full overflow-hidden rounded-sm bg-[var(--meter-track)]`}>
              <div className="h-full rounded-sm bg-[var(--meter-fill)]" style={{ width: `${missing ? 0 : Math.max(0, Math.min(100, v as number))}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function clampPos(v: number, lo: number, hi: number): number {
  if (hi <= lo) return 50;
  return Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
}

/** Bear / base / bull scenario strip with probabilities and the current-price marker; upside/downside and the method text underneath. */
export function ScenarioStrip({ er, compact = false }: { er: PmExpectedReturn; compact?: boolean }) {
  const pxs = [er.bear, er.base, er.bull, er.price].filter((x): x is number => x !== null && x !== undefined && Number.isFinite(x));
  const lo0 = pxs.length ? Math.min(...pxs) : 0;
  const hi0 = pxs.length ? Math.max(...pxs) : 1;
  const pad = (hi0 - lo0) * 0.08 || 1;
  const lo = lo0 - pad;
  const hi = hi0 + pad;
  const probs = er.prob ?? [null, null, null];
  const scen: { key: string; label: string; v: Num; p: number | null; cls: string }[] = [
    { key: "bear", label: "Bear", v: er.bear, p: probs[0] ?? null, cls: "text-neg" },
    { key: "base", label: "Base", v: er.base, p: probs[1] ?? null, cls: "" },
    { key: "bull", label: "Bull", v: er.bull, p: probs[2] ?? null, cls: "text-pos" },
  ];
  const cur = er.price !== null && er.price !== undefined && Number.isFinite(er.price) ? er.price : null;
  const ev = er.expected_value;
  const text = compact ? "text-[12px]" : "text-[12.5px]";
  return (
    <div className={text}>
      <div className="relative mt-1 h-14">
        {/* track */}
        <div className="absolute inset-x-0 top-4 h-1.5 rounded-sm bg-[var(--meter-track)]" />
        {/* bear→bull range */}
        {scen[0].v !== null && scen[2].v !== null && (
          <div
            className="absolute top-4 h-1.5 rounded-sm bg-[var(--meter-fill)] opacity-60"
            style={{ left: `${clampPos(scen[0].v, lo, hi)}%`, width: `${Math.max(0, clampPos(scen[2].v, lo, hi) - clampPos(scen[0].v, lo, hi))}%` }}
          />
        )}
        {scen.map((s) =>
          s.v === null || s.v === undefined ? null : (
            <div key={s.key} className="absolute top-0 flex -translate-x-1/2 flex-col items-center" style={{ left: `${clampPos(s.v, lo, hi)}%` }}>
              <span className={`text-[10.5px] uppercase tracking-wide ${s.cls || "text-muted"}`}>{s.label}</span>
              <span className="mt-0.5 size-2.5 rounded-full border-2 border-surface bg-[var(--text)]" />
              <span className="num mt-0.5 whitespace-nowrap font-medium">{price(s.v)}</span>
              <span className="num whitespace-nowrap text-[11px] text-subtle">{pct(s.p, 0)}</span>
            </div>
          ),
        )}
        {cur !== null && (
          <div className="absolute top-2.5 flex -translate-x-1/2 flex-col items-center" style={{ left: `${clampPos(cur, lo, hi)}%` }} title={`Current price ${price(cur)}`}>
            <span className="h-4 w-0.5 bg-accent" />
            <span className="num mt-0.5 whitespace-nowrap text-[10.5px] text-accent">now {price(cur)}</span>
          </div>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span>
          <span className="text-muted">Expected</span> <span className="num font-medium">{price(ev)}</span>{" "}
          <span className={`num font-medium ${signClass(er.expected_return_pct)}`}>{ptsSigned(er.expected_return_pct, 1)}</span>
        </span>
        <span>
          <span className="text-muted">Upside to base</span> <span className={`num ${signClass(er.upside_base_pct)}`}>{ptsSigned(er.upside_base_pct, 1)}</span>
        </span>
        <span>
          <span className="text-muted">Downside to bear</span> <span className={`num ${signClass(er.downside_bear_pct)}`}>{ptsSigned(er.downside_bear_pct, 1)}</span>
        </span>
        <ErBandChip band={er.band} />
        <span className="text-[11px] text-subtle">
          {er.n_methods} method{er.n_methods === 1 ? "" : "s"} · ER score {num(er.score, 0)}
        </span>
      </div>
      {!compact && er.method && <div className="mt-1 text-[11.5px] text-muted">{er.method}</div>}
    </div>
  );
}

/** ✓/✗ list of the momentum checks (sector-relative ones show ○ when unavailable). */
export function MomentumChecks({ m, columns = 1 }: { m: PmMomentum; columns?: 1 | 2 }) {
  return (
    <ul className={`grid gap-x-6 gap-y-1 ${columns === 2 ? "sm:grid-cols-2" : ""}`}>
      {PM_MOMENTUM_CHECKS.map((c) => {
        const ok = m.checks?.[c.key];
        const na = ok === null || ok === undefined;
        return (
          <li key={c.key} className={`flex gap-2 text-[13px] ${na ? "text-subtle" : ""}`} title={c.core ? "Core check (70% of the momentum score)" : "Sector-relative check (30%)"}>
            <span className={`w-4 shrink-0 text-center ${ok === true ? "text-pos" : ok === false ? "text-neg" : "text-subtle"}`}>
              {ok === true ? "✓" : ok === false ? "✗" : "○"}
            </span>
            <span>
              {c.label}
              {na && <span className="ml-1 text-[11px]">(no sector ETF)</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function RelCell({ v }: { v: Num | undefined }) {
  return <span className={`num ${signClass(v)}`}>{ptsSigned(v, 1)}</span>;
}

/** Returns + relative-strength grid: 1m/3m/6m/12m absolute, 3m/6m vs SPY and vs sector. */
export function MomentumReturns({ m }: { m: PmMomentum }) {
  const keys = ["1m", "3m", "6m", "12m"] as const;
  const spy = m.relative?.spy;
  const sec = m.relative?.sector;
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th></th>
          {keys.map((k) => (
            <th key={k} className="num">
              {k}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="text-muted">Return</td>
          {keys.map((k) => (
            <td key={k} className="num">
              <RelCell v={m.returns?.[k]} />
            </td>
          ))}
        </tr>
        <tr>
          <td className="text-muted">vs SPY</td>
          <td className="num text-subtle">—</td>
          <td className="num"><RelCell v={spy?.["3m"]} /></td>
          <td className="num"><RelCell v={spy?.["6m"]} /></td>
          <td className="num text-subtle">—</td>
        </tr>
        <tr>
          <td className="text-muted">vs sector</td>
          <td className="num text-subtle">—</td>
          <td className="num">{sec ? <RelCell v={sec["3m"]} /> : <span className="text-subtle">—</span>}</td>
          <td className="num">{sec ? <RelCell v={sec["6m"]} /> : <span className="text-subtle">—</span>}</td>
          <td className="num text-subtle">—</td>
        </tr>
      </tbody>
    </table>
  );
}

/** Deterioration warnings list (graded exits); empty state when clean. */
export function MomentumWarnings({ m }: { m: PmMomentum }) {
  if (!m.warnings?.length) return <div className="text-[12.5px] text-muted">No deterioration warnings · full size.</div>;
  return (
    <ul className="flex flex-col gap-0.5 text-[12.5px]">
      {m.warnings.map((w, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-warn">·</span>
          <span>{w}</span>
        </li>
      ))}
      <li className="mt-0.5 text-[11.5px] text-muted">
        {m.n_warnings} warning{m.n_warnings === 1 ? "" : "s"} → position size ×{num(m.grade, 2)}
      </li>
    </ul>
  );
}

function CatalystRow({ it, isNext }: { it: PmCatalystItem; isNext: boolean }) {
  return (
    <tr className={isNext ? "font-medium" : ""}>
      <td>
        <div className="max-w-md whitespace-normal">
          {it.catalyst}
          {isNext && <span className="ml-1.5 chip border-accent bg-accent-soft text-accent">next</span>}
        </div>
      </td>
      <td className="num">{num(it.impact, 0)}</td>
      <td className="num">{pct(it.probability, 0)}</td>
      <td className="num">{it.days === null || it.days === undefined ? "—" : `${num(it.days, 0)}d`}</td>
      <td>
        <span className="chip">{PM_CATALYST_KIND_LABELS[it.kind] ?? it.kind}</span>
      </td>
    </tr>
  );
}

/** Catalyst list (impact 1-10, probability, days out, kind) with the next catalyst highlighted. */
export function CatalystTable({ c }: { c: PmCatalyst }) {
  const items = c.items ?? [];
  if (!items.length) return <div className="px-4 py-2 text-[12.5px] text-muted">No catalysts identified.</div>;
  const nextKey = c.next ? `${c.next.catalyst}|${c.next.days}` : null;
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>Catalyst</th>
          <th className="num" title="Impact 1-10">Impact</th>
          <th className="num">Prob.</th>
          <th className="num">Days</th>
          <th>Kind</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it, i) => (
          <CatalystRow key={`${it.catalyst}-${i}`} it={it} isNext={nextKey !== null && `${it.catalyst}|${it.days}` === nextKey} />
        ))}
      </tbody>
    </table>
  );
}

/** One-line "next catalyst" summary. */
export function NextCatalyst({ c, completed }: { c: PmCatalyst; completed?: boolean }) {
  const n = c.next;
  return (
    <div className="text-[12.5px]">
      <span className="text-muted">Next catalyst</span>{" "}
      {n ? (
        <>
          <span className="font-medium">{n.catalyst}</span>
          <span className="text-muted">
            {" "}
            · {n.days === null || n.days === undefined ? "date unknown" : `in ${num(n.days, 0)} days`} · impact {num(n.impact, 0)} · {pct(n.probability, 0)}
          </span>
        </>
      ) : (
        <span className="text-muted">none scheduled</span>
      )}
      {completed && (
        <span className="ml-2 chip border-warn bg-warn-soft text-warn" title="Scheduled catalyst has passed with nothing within 60 days">
          catalyst completed
        </span>
      )}
      <span className="ml-2 text-[11.5px] text-subtle">
        catalyst score {num(c.score, 0)} · {c.n} identified
      </span>
    </div>
  );
}

/** 60-day annualised volatility in percent points. */
export function volText(v: Num | undefined): string {
  return pts(v, 1);
}
