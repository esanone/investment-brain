"use client";

import { useEffect, useRef, useState } from "react";
import { num } from "@/lib/format";

export interface EquityPoint {
  date: string;
  strategy: number | null;
  benchmark: number | null;
}

type SeriesKey = "strategy" | "benchmark";

/**
 * Fixed series -> colour mapping (colour follows the entity). Strategy wears the accent,
 * the benchmark a second hue and a dashed stroke, so the pair never relies on colour alone.
 */
const SERIES: { key: SeriesKey; label: string; color: string; dash?: string }[] = [
  { key: "strategy", label: "Strategy", color: "var(--accent)" },
  { key: "benchmark", label: "Benchmark", color: "var(--regime-reflation)", dash: "5 4" },
];

const HEIGHT = 280;
const PAD = { top: 12, right: 96, bottom: 24, left: 40 };

function finite(v: number | null | undefined): v is number {
  return v !== null && v !== undefined && Number.isFinite(v);
}

/** "Nice" tick step for roughly `count` ticks across `span`. */
function niceStep(span: number, count: number): number {
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

/**
 * Strategy vs benchmark, both rebased to 100 at the first point so they share one axis.
 * Inline SVG sized to its container; hover (or focus + arrow keys) moves a crosshair
 * with both values. A table of the same numbers sits under the chart.
 */
export function EquityCurve({ points }: { points: EquityPoint[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  // Unknown until the container has been measured; the SVG stays hidden (and out of flow) until then.
  const [measured, setMeasured] = useState<number | null>(null);
  const width = measured ?? 720;
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setMeasured(Math.max(280, Math.round(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Rebase each series to 100 at its first finite value.
  const base: Record<SeriesKey, number | null> = { strategy: null, benchmark: null };
  for (const s of SERIES) base[s.key] = points.find((p) => finite(p[s.key]) && p[s.key] !== 0)?.[s.key] ?? null;
  const rows = points.map((p) => ({
    date: p.date,
    strategy: finite(p.strategy) && base.strategy ? (p.strategy / base.strategy) * 100 : null,
    benchmark: finite(p.benchmark) && base.benchmark ? (p.benchmark / base.benchmark) * 100 : null,
  }));
  const values = rows.flatMap((r) => [r.strategy, r.benchmark]).filter(finite);

  if (rows.length < 2 || values.length < 2) {
    return <div className="text-[12.5px] text-muted">Not enough points to draw the equity curve.</div>;
  }

  const narrow = width < 480;
  const pad = { ...PAD, right: narrow ? 12 : PAD.right };
  const plotW = width - pad.left - pad.right;
  const plotH = HEIGHT - pad.top - pad.bottom;
  const step = niceStep(Math.max(...values, 100) - Math.min(...values, 100) || 1, 4);
  const lo = Math.floor(Math.min(...values, 100) / step) * step;
  const hi = Math.ceil(Math.max(...values, 100) / step) * step;
  const x = (i: number) => pad.left + (i / (rows.length - 1)) * plotW;
  const y = (v: number) => pad.top + (1 - (v - lo) / (hi - lo || 1)) * plotH;
  const ticks: number[] = [];
  for (let t = lo; t <= hi + step / 2; t += step) ticks.push(t);

  // One x label per year change, thinned so they never collide.
  const yearIdx = rows.map((r, i) => (i === 0 || r.date.slice(0, 4) !== rows[i - 1].date.slice(0, 4) ? i : -1)).filter((i) => i >= 0);
  const every = Math.max(1, Math.ceil(yearIdx.length / Math.max(2, Math.floor(plotW / 56))));
  const xTicks = yearIdx.filter((_, k) => k % every === 0);

  const path = (key: SeriesKey) => {
    let d = "";
    let pen = false;
    rows.forEach((r, i) => {
      const v = r[key];
      if (!finite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };

  // Direct end labels, nudged apart when the two lines finish close together.
  const ends = SERIES.map((s) => {
    const i = rows.findLastIndex((r) => finite(r[s.key]));
    const v = i >= 0 ? (rows[i][s.key] as number) : null;
    return { ...s, i, v, ly: v === null ? 0 : y(v) };
  }).filter((e) => e.v !== null);
  if (ends.length === 2 && Math.abs(ends[0].ly - ends[1].ly) < 26) {
    const [top, bottom] = ends[0].ly <= ends[1].ly ? [ends[0], ends[1]] : [ends[1], ends[0]];
    const mid = (top.ly + bottom.ly) / 2;
    top.ly = mid - 13;
    bottom.ly = mid + 13;
  }

  const active = hover === null ? null : rows[hover];
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - pad.left) / plotW) * (rows.length - 1));
    setHover(Math.max(0, Math.min(rows.length - 1, i)));
  };
  const onKey = (e: React.KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setHover((h) => Math.max(0, Math.min(rows.length - 1, (h ?? rows.length - 1) + (e.key === "ArrowLeft" ? -1 : 1))));
  };
  const tipLeft = hover === null ? 0 : Math.max(0, Math.min(width - 168, x(hover) + (x(hover) > width / 2 ? -176 : 12)));

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5">
            <svg width={22} height={8} aria-hidden>
              <line x1={0} x2={22} y1={4} y2={4} stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} />
            </svg>
            {s.label}
          </span>
        ))}
        <span className="text-subtle">index, 100 at {rows[0].date.slice(0, 10)}</span>
      </div>

      {/* The SVG is absolutely positioned so its pixel width can never widen the card (and the page) on a phone. */}
      <div ref={wrapRef} className="relative w-full" style={{ height: HEIGHT }}>
        <svg
          width={width}
          height={HEIGHT}
          style={{ position: "absolute", left: 0, top: 0, visibility: measured === null ? "hidden" : "visible" }}
          role="img"
          aria-label={`Equity curve, strategy vs benchmark, indexed to 100 at ${rows[0].date.slice(0, 10)}. Arrow keys move the readout.`}
          tabIndex={0}
          className="block touch-pan-y select-none"
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
          onBlur={() => setHover(null)}
          onKeyDown={onKey}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={pad.left + plotW} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth={1} strokeDasharray={t === 100 ? undefined : "2 3"} />
              <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-muted)">
                {num(t, step < 1 ? 1 : 0)}
              </text>
            </g>
          ))}
          {xTicks.map((i) => (
            <text key={i} x={x(i)} y={HEIGHT - 6} textAnchor={i === 0 ? "start" : "middle"} fontSize={11} fill="var(--text-muted)">
              {rows[i].date.slice(0, 4)}
            </text>
          ))}

          {SERIES.map((s) => (
            <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />
          ))}

          {ends.map((e) => (
            <g key={e.key}>
              <circle cx={x(e.i)} cy={y(e.v as number)} r={4} fill={e.color} stroke="var(--surface)" strokeWidth={2} />
              {!narrow && (
                <>
                  <text x={x(e.i) + 10} y={e.ly - 2} fontSize={11} fill="var(--text-muted)">
                    {e.label}
                  </text>
                  <text x={x(e.i) + 10} y={e.ly + 11} fontSize={12} fontWeight={600} fill="var(--text)">
                    {num(e.v, 1)}
                  </text>
                </>
              )}
            </g>
          ))}

          {active && hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={pad.top} y2={pad.top + plotH} stroke="var(--border-strong)" strokeWidth={1} />
              {SERIES.map((s) => {
                const v = active[s.key];
                return finite(v) ? <circle key={s.key} cx={x(hover)} cy={y(v)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} /> : null;
              })}
            </g>
          )}
        </svg>

        {active && (
          <div
            className="pointer-events-none absolute top-2 w-40 rounded border border-line-strong bg-surface px-2.5 py-1.5 text-[12px] shadow-lg"
            style={{ left: tipLeft }}
            role="status"
          >
            <div className="mono text-[11.5px] text-muted">{active.date.slice(0, 10)}</div>
            {SERIES.map((s) => (
              <div key={s.key} className="mt-0.5 flex items-center gap-1.5">
                <svg width={14} height={8} aria-hidden>
                  <line x1={0} x2={14} y1={4} y2={4} stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} />
                </svg>
                <span className="text-muted">{s.label}</span>
                <span className="ml-auto font-medium">{num(active[s.key], 1)}</span>
              </div>
            ))}
            {finite(active.strategy) && finite(active.benchmark) && (
              <div className="mt-0.5 flex border-t border-line pt-0.5 text-muted">
                <span>Gap</span>
                <span className="ml-auto font-medium text-ink">
                  {active.strategy - active.benchmark > 0 ? "+" : ""}
                  {num(active.strategy - active.benchmark, 1)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <details className="mt-2 text-[12px] text-muted">
        <summary className="cursor-pointer">Show the data ({rows.length} points)</summary>
        <div className="tbl-wrap mt-2 max-h-72 overflow-y-auto rounded border border-line">
          <table className="tbl">
            <thead>
              <tr>
                <th>Date</th>
                <th className="num">Strategy</th>
                <th className="num">Benchmark</th>
                <th className="num">Gap</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const gap = finite(r.strategy) && finite(r.benchmark) ? r.strategy - r.benchmark : null;
                return (
                  <tr key={r.date}>
                    <td className="mono">{r.date.slice(0, 10)}</td>
                    <td className="num">{num(r.strategy, 1)}</td>
                    <td className="num">{num(r.benchmark, 1)}</td>
                    <td className="num">{gap === null ? "—" : `${gap > 0 ? "+" : ""}${gap.toFixed(1)}`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
