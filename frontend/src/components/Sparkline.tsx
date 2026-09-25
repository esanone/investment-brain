import type { Num } from "@/lib/types";

/** Tiny inline SVG line chart. Nulls break the line; a zero baseline is drawn when the range crosses it. */
export function Sparkline({
  values,
  width = 120,
  height = 28,
  stroke = "var(--accent)",
}: {
  values: (Num | undefined)[];
  width?: number;
  height?: number;
  stroke?: string;
}) {
  const pts = values.map((v) => (v === null || v === undefined || !Number.isFinite(v) ? null : v));
  const valid = pts.filter((v): v is number => v !== null);
  if (valid.length < 2) {
    return (
      <svg width={width} height={height} className="align-middle" aria-hidden>
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="var(--border-strong)" strokeDasharray="2 3" />
      </svg>
    );
  }
  const lo = Math.min(...valid);
  const hi = Math.max(...valid);
  const span = hi - lo || 1;
  const pad = 2;
  const x = (i: number) => (pts.length === 1 ? width / 2 : (i / (pts.length - 1)) * (width - pad * 2) + pad);
  const y = (v: number) => height - pad - ((v - lo) / span) * (height - pad * 2);

  const segments: string[] = [];
  let cur: string[] = [];
  pts.forEach((v, i) => {
    if (v === null) {
      if (cur.length) segments.push(cur.join(" "));
      cur = [];
    } else {
      cur.push(`${cur.length ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    }
  });
  if (cur.length) segments.push(cur.join(" "));
  const last = [...pts].reverse().find((v) => v !== null);
  const lastIdx = pts.length - 1 - [...pts].reverse().findIndex((v) => v !== null);

  return (
    <svg width={width} height={height} className="align-middle" aria-hidden>
      {lo < 0 && hi > 0 && (
        <line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke="var(--border-strong)" strokeDasharray="2 3" />
      )}
      {segments.map((d, i) => (
        <path key={i} d={d} fill="none" stroke={stroke} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
      ))}
      {last !== null && last !== undefined && <circle cx={x(lastIdx)} cy={y(last)} r={1.8} fill={stroke} />}
    </svg>
  );
}
