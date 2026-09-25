import type { Num } from "@/lib/types";
import { num, signed, signClass } from "@/lib/format";

/**
 * Horizontal 0-100 bar with a label on the left and the value (plus an optional
 * signed delta) on the right. Neutral fill; the delta is the only coloured part.
 */
export function Meter({
  label,
  value,
  delta,
  deltaSuffix = "",
  hint,
  size = "md",
}: {
  label: React.ReactNode;
  value: Num | undefined;
  delta?: Num;
  deltaSuffix?: string;
  hint?: React.ReactNode;
  size?: "sm" | "md";
}) {
  const v = value === null || value === undefined || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, value));
  const h = size === "sm" ? "h-1.5" : "h-2";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0 truncate text-[13px]">{label}</div>
        <div className="flex shrink-0 items-baseline gap-2">
          <span className="text-[13px] font-medium">{num(v, 0)}</span>
          {delta !== undefined && (
            <span className={`text-[11.5px] ${signClass(delta)}`}>
              {signed(delta, 1)}
              {deltaSuffix}
            </span>
          )}
        </div>
      </div>
      <div className={`${h} w-full overflow-hidden rounded-sm bg-[var(--meter-track)]`}>
        <div className="h-full rounded-sm bg-[var(--meter-fill)]" style={{ width: `${v ?? 0}%` }} />
      </div>
      {hint && <div className="text-[11.5px] text-muted">{hint}</div>}
    </div>
  );
}
