import type { BriefDirection } from "@/lib/types";

const DIRECTION_CLASS: Record<BriefDirection, string> = {
  "risk-on": "border-pos bg-pos-soft text-pos",
  "risk-off": "border-neg bg-neg-soft text-neg",
  neutral: "",
};

/** Morning-brief market direction as a coloured chip: risk-on green, risk-off red, neutral muted. */
export function DirectionChip({ direction }: { direction: BriefDirection | string | null | undefined }) {
  if (!direction) return <span className="chip">—</span>;
  const cls = DIRECTION_CLASS[direction as BriefDirection] ?? "";
  return <span className={`chip font-medium ${cls}`}>{direction}</span>;
}
