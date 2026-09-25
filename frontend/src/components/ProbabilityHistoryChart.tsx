import type { Num, ThesisV2HistoryPoint } from "@/lib/types";
import { num } from "@/lib/format";

/**
 * Posterior probability of one Thesis v2 record over its updates. Inline SVG,
 * no library. The current reasonable range is drawn as a light band and the
 * reference-class prior as a dashed line, so the line can be read against both.
 */
export function ProbabilityHistoryChart({
  history,
  prior,
  rangeLow,
  rangeHigh,
  width = 760,
  height = 200,
}: {
  history: ThesisV2HistoryPoint[];
  prior?: Num;
  rangeLow?: Num;
  rangeHigh?: Num;
  width?: number;
  height?: number;
}) {
  const pts = history.filter((h) => h && h.posterior !== null && h.posterior !== undefined && Number.isFinite(h.posterior));
  if (!pts.length) return <div className="text-[12.5px] text-muted">No probability history yet.</div>;

  const padL = 34;
  const padR = 10;
  const padT = 10;
  const padB = 22;
  const w = width - padL - padR;
  const h = height - padT - padB;
  const x = (i: number) => (pts.length === 1 ? padL + w / 2 : padL + (i / (pts.length - 1)) * w);
  const y = (v: number) => padT + h - (Math.max(0, Math.min(100, v)) / 100) * h;
  const ok = (v: Num | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);

  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.posterior as number).toFixed(1)}`).join(" ");
  const tickEvery = Math.max(1, Math.round(pts.length / 6));
  const last = pts[pts.length - 1];

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full min-w-[520px]" role="img" aria-label="Posterior probability history">
        {ok(rangeLow) && ok(rangeHigh) && rangeHigh >= rangeLow && (
          <rect x={padL} width={w} y={y(rangeHigh)} height={Math.max(0, y(rangeLow) - y(rangeHigh))} fill="var(--accent)" fillOpacity={0.08} />
        )}
        {[0, 25, 50, 75, 100].map((g) => (
          <g key={g}>
            <line x1={padL} x2={width - padR} y1={y(g)} y2={y(g)} stroke="var(--border)" />
            <text x={padL - 6} y={y(g) + 3.5} fontSize={10} textAnchor="end" fill="var(--text-subtle)">
              {g}%
            </text>
          </g>
        ))}
        {ok(prior) && (
          <g>
            <line x1={padL} x2={width - padR} y1={y(prior)} y2={y(prior)} stroke="var(--text-subtle)" strokeDasharray="3 3" />
            <text x={width - padR} y={y(prior) - 4} fontSize={10} textAnchor="end" fill="var(--text-subtle)">
              prior {num(prior, 1)}%
            </text>
          </g>
        )}
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle key={`${p.date}-${i}`} cx={x(i)} cy={y(p.posterior as number)} r={i === pts.length - 1 ? 3 : 2.2} fill="var(--accent)">
            <title>{`${p.date} · ${num(p.posterior, 1)}% · ${p.event}`}</title>
          </circle>
        ))}
        <text x={Math.min(x(pts.length - 1) + 6, width - padR)} y={y(last.posterior as number) + 3.5} fontSize={10.5} fontWeight={600} textAnchor={x(pts.length - 1) + 40 > width - padR ? "end" : "start"} fill="var(--text)">
          {num(last.posterior, 1)}%
        </text>
        {pts.map((p, i) =>
          i % tickEvery === 0 || i === pts.length - 1 ? (
            <text key={`t-${p.date}-${i}`} x={x(i)} y={height - 6} fontSize={10} textAnchor={pts.length === 1 ? "middle" : i === pts.length - 1 ? "end" : i === 0 ? "start" : "middle"} fill="var(--text-subtle)">
              {p.date.slice(0, 10)}
            </text>
          ) : null,
        )}
      </svg>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 rounded-sm bg-accent" />
          posterior
        </span>
        {ok(rangeLow) && ok(rangeHigh) && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block size-2 rounded-sm bg-accent opacity-20" />
            current range {num(rangeLow, 0)}–{num(rangeHigh, 0)}%
          </span>
        )}
        {ok(prior) && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-3 border-t border-dashed border-[var(--text-subtle)]" />
            reference-class prior
          </span>
        )}
      </div>
    </div>
  );
}
