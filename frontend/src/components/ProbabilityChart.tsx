import type { RegimeHistoryPoint, RegimeName } from "@/lib/types";
import { REGIME_NAMES } from "@/lib/types";

export const REGIME_COLORS: Record<RegimeName, string> = {
  Goldilocks: "var(--regime-goldilocks)",
  Reflation: "var(--regime-reflation)",
  Stagflation: "var(--regime-stagflation)",
  Contraction: "var(--regime-contraction)",
};

/** Stacked-area chart of the four regime probabilities over the monthly history. Inline SVG, no library. */
export function ProbabilityChart({
  history,
  width = 760,
  height = 220,
}: {
  history: RegimeHistoryPoint[];
  width?: number;
  height?: number;
}) {
  const pts = history.filter((h) => h && h.probabilities);
  if (pts.length < 2) return <div className="text-[12.5px] text-muted">Not enough history to chart.</div>;

  const padL = 34;
  const padR = 8;
  const padT = 8;
  const padB = 22;
  const w = width - padL - padR;
  const h = height - padT - padB;
  const x = (i: number) => padL + (i / (pts.length - 1)) * w;
  const y = (v: number) => padT + h - (Math.max(0, Math.min(100, v)) / 100) * h;

  // Stack in the declared regime order (bottom -> top).
  const stacks: Record<RegimeName, { lo: number; hi: number }[]> = {
    Goldilocks: [],
    Reflation: [],
    Stagflation: [],
    Contraction: [],
  };
  pts.forEach((p) => {
    let acc = 0;
    for (const r of REGIME_NAMES) {
      const v = p.probabilities[r] ?? 0;
      stacks[r].push({ lo: acc, hi: acc + (v ?? 0) });
      acc += v ?? 0;
    }
  });

  const area = (r: RegimeName) => {
    const s = stacks[r];
    const top = s.map((d, i) => `${x(i).toFixed(1)},${y(d.hi).toFixed(1)}`);
    const bottom = s.map((d, i) => `${x(i).toFixed(1)},${y(d.lo).toFixed(1)}`).reverse();
    return `M${top.join(" L")} L${bottom.join(" L")} Z`;
  };

  const tickEvery = Math.max(1, Math.round(pts.length / 6));
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full min-w-[520px]" role="img" aria-label="Regime probability history">
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line x1={padL} x2={width - padR} y1={y(g)} y2={y(g)} stroke="var(--border)" />
            <text x={padL - 6} y={y(g) + 3.5} fontSize={10} textAnchor="end" fill="var(--text-subtle)">
              {g}%
            </text>
          </g>
        ))}
        {REGIME_NAMES.map((r) => (
          <path key={r} d={area(r)} fill={REGIME_COLORS[r]} fillOpacity={0.55} stroke={REGIME_COLORS[r]} strokeWidth={1} />
        ))}
        {pts.map((p, i) =>
          i % tickEvery === 0 || i === pts.length - 1 ? (
            <text key={p.date} x={x(i)} y={height - 6} fontSize={10} textAnchor={i === pts.length - 1 ? "end" : "middle"} fill="var(--text-subtle)">
              {p.date.slice(0, 7)}
            </text>
          ) : null,
        )}
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
        {REGIME_NAMES.map((r) => (
          <span key={r} className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2 rounded-sm" style={{ background: REGIME_COLORS[r] }} />
            {r}
          </span>
        ))}
      </div>
    </div>
  );
}
