"use client";

import { useState } from "react";
import type { ThesisV2Analogue } from "@/lib/types";
import { SIM_DIMS } from "@/lib/types";
import { SIM_DIM_LABELS, num } from "@/lib/format";
import { ScoreBadge } from "./ScoreBadge";

/** Analogues below this similarity are excluded from the reference class (causal.py `score()`). */
export const SIMILARITY_CUTOFF = 40;

const COLS = 8;

/**
 * Historical analogues of a Thesis v2 record, sorted by similarity, with an
 * expandable row showing the eight similarity dimensions as tiny bars. Rows
 * below the cutoff are dimmed: they are shown for transparency but do not
 * enter the base rate.
 */
export function AnaloguesTable({ rows }: { rows: ThesisV2Analogue[] }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const sorted = rows
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (y.a.similarity_score ?? -1) - (x.a.similarity_score ?? -1));

  if (!sorted.length) return <div className="px-4 py-3 text-[12.5px] text-muted">No analogues recorded.</div>;

  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th className="w-6"></th>
            <th>Analogue</th>
            <th>Period</th>
            <th>Mechanism</th>
            <th className="num" title={`Mean of the eight similarity dimensions, 0-100 · ≥ ${SIMILARITY_CUTOFF} enters the reference class`}>
              Similarity
            </th>
            <th>Occurred</th>
            <th className="num" title="Years from first availability to mainstream adoption">Yrs to mainstream</th>
            <th>Lesson</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ a, i }) => (
            <AnalogueRow key={i} a={a} isOpen={open.has(i)} onToggle={() => toggle(i)} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AnalogueRow({ a, isOpen, onToggle }: { a: ThesisV2Analogue; isOpen: boolean; onToggle: () => void }) {
  const excluded = (a.similarity_score ?? 0) < SIMILARITY_CUTOFF;
  return (
    <>
      <tr className={excluded ? "dim" : ""} title={excluded ? `Below the ${SIMILARITY_CUTOFF} similarity cutoff · not in the reference class` : undefined}>
        <td className="text-subtle">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? "Hide" : "Show"} similarity dimensions for ${a.name}`}
            className="grid size-5 place-items-center rounded text-[11px] hover:bg-surface-3 hover:text-ink"
          >
            {isOpen ? "▾" : "▸"}
          </button>
        </td>
        <td className="font-medium">
          <div className="w-56 whitespace-normal">{a.name}</div>
        </td>
        <td className="mono text-muted">{a.period || "—"}</td>
        <td className="max-w-72 truncate text-[12.5px] text-muted" title={a.mechanism}>
          {a.mechanism || "—"}
        </td>
        <td className="num">
          <ScoreBadge value={a.similarity_score} />
        </td>
        <td className={a.pattern_occurred ? "text-pos" : "text-neg"}>
          <span className="mr-1">{a.pattern_occurred ? "✓" : "✗"}</span>
          {a.pattern_occurred ? "yes" : "no"}
        </td>
        <td className="num">{num(a.years_to_mainstream, 0)}</td>
        <td className="max-w-md truncate text-[12.5px] text-muted" title={a.lesson}>
          {a.lesson || "—"}
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-surface-2">
          <td colSpan={COLS} className="p-0" style={{ whiteSpace: "normal" }}>
            <div className="border-l-2 border-line-strong px-3 py-2 text-[12.5px]">
              <div className="eyebrow mb-1.5">Similarity dimensions</div>
              <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-4">
                {SIM_DIMS.map((k) => {
                  const v = a.similarity?.[k];
                  const w = v === null || v === undefined || !Number.isFinite(v) ? 0 : Math.max(0, Math.min(1, v)) * 100;
                  return (
                    <div key={k} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5">
                      <span className="truncate text-[11.5px] text-muted">{SIM_DIM_LABELS[k] ?? k}</span>
                      <span className="num text-[11.5px] font-medium">{num(v, 2)}</span>
                      <div className="col-span-2 h-1 w-full rounded-sm bg-[var(--meter-track)]">
                        <div className="h-full rounded-sm bg-[var(--meter-fill)]" style={{ width: `${w}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 grid gap-x-6 gap-y-2 lg:grid-cols-2">
                <div>
                  <div className="eyebrow mb-1">Mechanism</div>
                  <p>{a.mechanism || <span className="text-muted">—</span>}</p>
                </div>
                <div>
                  <div className="eyebrow mb-1">Lesson</div>
                  <p>{a.lesson || <span className="text-muted">—</span>}</p>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
