import type { Num } from "@/lib/types";

/**
 * -100..100 bar around a centre line: green grows to the right, red to the left.
 * Rendered as inline-block so it sits cleanly inside a table cell.
 */
export function DivergingBar({
  value,
  width = 120,
  height = 8,
  max = 100,
}: {
  value: Num | undefined;
  width?: number;
  height?: number;
  max?: number;
}) {
  const v = value === null || value === undefined || !Number.isFinite(value) ? 0 : Math.max(-max, Math.min(max, value));
  const half = width / 2;
  const len = (Math.abs(v) / max) * half;
  const left = v >= 0 ? half : half - len;
  const color = v > 0 ? "var(--pos)" : v < 0 ? "var(--neg)" : "var(--border-strong)";
  return (
    <span
      className="relative inline-block align-middle rounded-sm bg-[var(--meter-track)]"
      style={{ width, height }}
      aria-hidden
    >
      <span className="absolute top-0 bottom-0 w-px bg-[var(--border-strong)]" style={{ left: half }} />
      <span
        className="absolute top-0 bottom-0 rounded-sm"
        style={{ left, width: Math.max(len, v === 0 ? 0 : 1), background: color, opacity: 0.85 }}
      />
    </span>
  );
}
