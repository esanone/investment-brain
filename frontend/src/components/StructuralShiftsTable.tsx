"use client";

import { useState } from "react";
import Link from "next/link";
import type { ShiftTrend, StructuralShift } from "@/lib/types";
import { EPISTEMIC_LABELS, pct } from "@/lib/format";

const TREND_CLASS: Record<ShiftTrend, string> = {
  strengthening: "border-pos bg-pos-soft text-pos",
  fading: "border-neg bg-neg-soft text-neg",
  stable: "",
};

const KIND_CLASS: Record<string, string> = {
  observed_fact: "border-pos bg-pos-soft text-pos",
  consensus_expectation: "",
  ai_inference: "border-accent bg-accent-soft text-accent",
  speculative_hypothesis: "border-warn bg-warn-soft text-warn",
};

const COLS = 8;

/**
 * Structural shifts from the long-term thesis with an expandable evidence row.
 * `themeNames` maps theme_id -> name so the LLM's theme strings can be linked
 * whether it returned ids or names; anything unknown renders as a plain chip.
 */
export function StructuralShiftsTable({ rows, themeNames }: { rows: StructuralShift[]; themeNames: Record<string, string> }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set());
  const nameToId = Object.fromEntries(Object.entries(themeNames).map(([id, name]) => [name.toLowerCase(), id]));

  if (!rows.length) return <div className="px-4 py-3 text-[12.5px] text-muted">No structural shifts recorded (headlines-only mode).</div>;

  const toggle = (i: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  const themeLink = (t: string, i: number) => {
    const id = themeNames[t] ? t : nameToId[t.toLowerCase()];
    if (!id) return <span key={`${t}-${i}`} className="chip">{t}</span>;
    return (
      <Link key={`${id}-${i}`} href={`/themes/${id}`} className="chip hover:text-accent">
        {themeNames[id] ?? t}
      </Link>
    );
  };

  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th className="w-6"></th>
            <th>Shift</th>
            <th>Human need</th>
            <th className="num">Horizon</th>
            <th>Trend</th>
            <th className="num">Conf.</th>
            <th>Kind</th>
            <th>Themes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const isOpen = open.has(i);
            return (
              <StructuralShiftRow key={i} r={r} isOpen={isOpen} onToggle={() => toggle(i)} themeLink={themeLink} />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StructuralShiftRow({
  r,
  isOpen,
  onToggle,
  themeLink,
}: {
  r: StructuralShift;
  isOpen: boolean;
  onToggle: () => void;
  themeLink: (t: string, i: number) => React.ReactNode;
}) {
  const conf = r.confidence === null || r.confidence === undefined ? null : r.confidence <= 1 ? r.confidence : r.confidence / 100;
  return (
    <>
      <tr className="align-top">
        <td className="text-subtle">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? "Hide" : "Show"} evidence`}
            className="grid size-5 place-items-center rounded text-[11px] hover:bg-surface-3 hover:text-ink"
          >
            {isOpen ? "▾" : "▸"}
          </button>
        </td>
        <td>
          <div className="max-w-md whitespace-normal">{r.shift}</div>
        </td>
        <td>
          <span className="chip">{r.human_need || "—"}</span>
        </td>
        <td className="num text-muted">{r.horizon_years ? `${r.horizon_years}y` : "—"}</td>
        <td>
          <span className={`chip ${TREND_CLASS[r.trend] ?? ""}`}>{r.trend ?? "—"}</span>
        </td>
        <td className="num">{pct(conf, 0)}</td>
        <td>
          <span className={`chip ${KIND_CLASS[r.kind] ?? ""}`}>{EPISTEMIC_LABELS[r.kind] ?? r.kind}</span>
        </td>
        <td>
          <div className="flex max-w-64 flex-wrap gap-1 whitespace-normal">{(r.themes ?? []).length ? r.themes.map(themeLink) : <span className="text-muted">—</span>}</div>
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-surface-2">
          <td colSpan={COLS} className="p-0" style={{ whiteSpace: "normal" }}>
            <div className="border-l-2 border-line-strong px-3 py-2 text-[12.5px]">
              <div className="eyebrow mb-1">Evidence</div>
              {r.evidence?.length ? (
                <ul className="flex flex-col gap-0.5">
                  {r.evidence.map((e, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-subtle">·</span>
                      <span>{e}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="text-muted">No evidence recorded.</div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
