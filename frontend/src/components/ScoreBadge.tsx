import type { Num } from "@/lib/types";
import { num } from "@/lib/format";

/**
 * 0-100 score in a small tinted pill. The tint is scaled: warm below 40, neutral in
 * the middle, cool-green above 60. Kept low-chroma so tables stay calm.
 */
export function ScoreBadge({ value, size = "sm" }: { value: Num | undefined; size?: "sm" | "lg" }) {
  const v = value === null || value === undefined || !Number.isFinite(value) ? null : value;
  let style: React.CSSProperties = { background: "var(--surface-2)", color: "var(--text-muted)" };
  if (v !== null) {
    if (v >= 60) {
      const a = Math.min(1, (v - 60) / 40);
      style = { background: `color-mix(in srgb, var(--pos) ${8 + a * 22}%, var(--surface-2))`, color: "var(--text)" };
    } else if (v < 40) {
      const a = Math.min(1, (40 - v) / 40);
      style = { background: `color-mix(in srgb, var(--neg) ${8 + a * 22}%, var(--surface-2))`, color: "var(--text)" };
    } else {
      style = { background: "var(--surface-3)", color: "var(--text)" };
    }
  }
  const cls =
    size === "lg"
      ? "inline-flex min-w-12 justify-center rounded px-2 py-0.5 text-[15px] font-semibold"
      : "inline-flex min-w-8 justify-center rounded px-1.5 py-px text-[12px] font-medium";
  return (
    <span className={cls} style={style}>
      {num(v, 0)}
    </span>
  );
}
