import type { Num } from "@/lib/types";
import { num } from "@/lib/format";

function clamp(v: Num | undefined): number | null {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(100, v));
}

/**
 * 0-100 track showing a Thesis v2 probability: the reasonable range as a band,
 * the posterior as an accent marker and the reference-class prior as a thin tick.
 * All inputs are percent points.
 */
export function ProbabilityRange({
  low,
  high,
  prior,
  posterior,
  className = "w-28",
}: {
  low: Num | undefined;
  high: Num | undefined;
  prior: Num | undefined;
  posterior: Num | undefined;
  className?: string;
}) {
  const lo = clamp(low);
  const hi = clamp(high);
  const pr = clamp(prior);
  const po = clamp(posterior);
  const title = `posterior ${num(posterior, 1)}% · range ${num(low, 0)}–${num(high, 0)}% · prior ${num(prior, 1)}%`;
  return (
    <div className={`relative h-1.5 shrink-0 rounded-sm bg-[var(--meter-track)] ${className}`} title={title} aria-label={title} role="img">
      {lo !== null && hi !== null && hi >= lo && (
        <div className="absolute inset-y-0 rounded-sm bg-[var(--meter-fill)] opacity-40" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
      )}
      {pr !== null && (
        <div className="absolute -top-0.5 h-2.5 w-px bg-[var(--text-subtle)]" style={{ left: `${pr}%` }} />
      )}
      {po !== null && (
        <div className="absolute -top-0.5 h-2.5 w-0.5 -translate-x-1/2 rounded-sm bg-accent" style={{ left: `${po}%` }} />
      )}
    </div>
  );
}
