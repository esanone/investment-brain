import type { EventFlag } from "@/lib/types";
import { EVENT_FLAG_LABELS } from "@/lib/format";

/** Chip tint per tape flag: green = bullish, red = bearish / high severity, amber = watch, muted otherwise. */
const FLAG_CLASS: Partial<Record<EventFlag, string>> = {
  insider_cluster_buy: "border-pos bg-pos-soft text-pos",
  insider_notable_buy: "border-pos bg-pos-soft text-pos",
  gap_up: "border-pos bg-pos-soft text-pos",
  "8k_high_severity": "border-neg bg-neg-soft text-neg",
  gap_down: "border-neg bg-neg-soft text-neg",
  officer_change: "border-warn bg-warn-soft text-warn",
  earnings_today: "border-warn bg-warn-soft text-warn",
};

const FLAG_TITLE: Partial<Record<EventFlag, string>> = {
  insider_cluster_buy: "Two or more insiders bought on the open market in the last 14 days",
  insider_notable_buy: "One officer or director bought at least $250k in the last 45 days",
  "8k_high_severity": "8-K with a high-severity item (restatement, bankruptcy, default, delisting)",
  officer_change: "8-K item 5.02: departure or appointment of officers or directors",
  results_filed: "8-K item 2.02: results of operations filed",
  earnings_today: "Reports earnings today (Finnhub calendar)",
  gap_up: "Pre-market gap up of at least 4% vs the previous close",
  gap_down: "Pre-market gap down of at least 4% vs the previous close",
};

/** Event-tape flags as tinted chips, shared by the events page, the company page and the dashboard card. */
export function EventFlagChips({ flags, empty = false, max }: { flags: (EventFlag | string)[] | null | undefined; empty?: boolean; max?: number }) {
  const list = (flags ?? []).filter(Boolean);
  const shown = max ? list.slice(0, max) : list;
  if (!shown.length) return empty ? <span className="text-subtle">—</span> : null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {shown.map((f) => (
        <span key={f} className={`chip whitespace-nowrap ${FLAG_CLASS[f as EventFlag] ?? ""}`} title={FLAG_TITLE[f as EventFlag]}>
          {EVENT_FLAG_LABELS[f] ?? f.replace(/_/g, " ")}
        </span>
      ))}
      {max && list.length > max && <span className="text-[11.5px] text-subtle">+{list.length - max}</span>}
    </span>
  );
}

/** Red / amber / muted severity label for an 8-K row. */
export function SeverityChip({ severity }: { severity: string }) {
  const cls =
    severity === "high" ? "border-neg bg-neg-soft text-neg" : severity === "medium" ? "border-warn bg-warn-soft text-warn" : "";
  return <span className={`chip ${cls}`}>{severity}</span>;
}
