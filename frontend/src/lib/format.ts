/** Number formatting helpers. Every helper renders "—" for null/undefined/NaN. */
import type { Num } from "./types";

export const DASH = "—";

function bad(v: Num | undefined): v is null | undefined {
  return v === null || v === undefined || !Number.isFinite(v);
}

/** Plain number with fixed decimals. */
export function num(v: Num | undefined, digits = 0): string {
  if (bad(v)) return DASH;
  return v.toFixed(digits);
}

/** Signed number: +84, -46, +3.2 */
export function signed(v: Num | undefined, digits = 0): string {
  if (bad(v)) return DASH;
  const s = v.toFixed(digits);
  return v > 0 ? `+${s}` : s;
}

/** Fraction -> percent: 0.834 -> "83.4%" */
export function pct(v: Num | undefined, digits = 1): string {
  if (bad(v)) return DASH;
  return `${(v * 100).toFixed(digits)}%`;
}

/** Fraction -> signed percent: 0.034 -> "+3.4%" */
export function pctSigned(v: Num | undefined, digits = 1): string {
  if (bad(v)) return DASH;
  const s = `${(v * 100).toFixed(digits)}%`;
  return v > 0 ? `+${s}` : s;
}

/** Value already in percent points (12.3) -> "+12.3%" */
export function ptsSigned(v: Num | undefined, digits = 1): string {
  if (bad(v)) return DASH;
  const s = `${v.toFixed(digits)}%`;
  return v > 0 ? `+${s}` : s;
}

/** Value already in percent points (48.2) -> "48.2%" */
export function pts(v: Num | undefined, digits = 1): string {
  if (bad(v)) return DASH;
  return `${v.toFixed(digits)}%`;
}

/** Valuation multiple: 18.04 -> "18.0x" */
export function multiple(v: Num | undefined, digits = 1): string {
  if (bad(v)) return DASH;
  return `${v.toFixed(digits)}x`;
}

/** Compact currency: 5.4e12 -> "$5.4T", 1.2e9 -> "$1.2B", -3e8 -> "-$300M" */
export function money(v: Num | undefined, digits = 1): string {
  if (bad(v)) return DASH;
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [div, suffix] of units) {
    if (a >= div) return `${sign}$${(a / div).toFixed(digits)}${suffix}`;
  }
  return `${sign}$${a.toFixed(digits)}`;
}

/** Share price: 187.43 -> "$187.43" */
export function price(v: Num | undefined): string {
  if (bad(v)) return DASH;
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Basis points from a fraction change: 0.0123 -> "+123 bps" */
export function bps(v: Num | undefined): string {
  if (bad(v)) return DASH;
  const b = Math.round(v * 1e4);
  return `${b > 0 ? "+" : ""}${b} bps`;
}

/** Yes/no for booleans, dash for null. */
export function yesNo(v: boolean | null | undefined): string {
  if (v === null || v === undefined) return DASH;
  return v ? "yes" : "no";
}

/** Short ISO date: keep as-is but guard nulls. */
export function date(v: string | null | undefined): string {
  if (!v || v === "None" || v === "NaT") return DASH;
  return v.slice(0, 10);
}

/** Weight 0.2 -> "20%" */
export function weight(v: Num | undefined): string {
  if (bad(v)) return DASH;
  return `${Math.round(v * 100)}%`;
}

/** Tailwind class for a signed value: green for positive, red for negative. */
export function signClass(v: Num | undefined): string {
  if (bad(v) || v === 0) return "text-muted";
  return v > 0 ? "text-pos" : "text-neg";
}

/** Human labels for strategist component keys. */
export const COMPONENT_LABELS: Record<string, string> = {
  structural_trend: "Structural trend",
  capital_flow: "Capital flow",
  acceleration: "Acceleration",
  quality: "Quality",
  valuation: "Valuation",
  estimate_revisions: "Estimate revisions",
  management_commentary: "Management commentary",
  narrative_acceleration: "Narrative acceleration",
  insider_institutional: "Insider / institutional",
};

export const DIM_LABELS: Record<string, string> = {
  growth: "Growth",
  inflation: "Inflation",
  liquidity: "Liquidity",
  rates: "Rates",
};

export const GROUP_LABELS: Record<string, string> = {
  sector: "Sectors",
  industry: "Industries",
  factor: "Factors",
  size: "Size",
  region: "Regions",
  bond: "Bonds",
  commodity: "Commodities",
  crypto: "Crypto",
};

export const EPISTEMIC_LABELS: Record<string, string> = {
  observed_fact: "Observed fact",
  consensus_expectation: "Consensus expectation",
  ai_inference: "AI inference",
  speculative_hypothesis: "Speculative hypothesis",
};

/** Human labels for attention-engine source keys (status chips and per-source scores). */
export const ATTENTION_SOURCE_LABELS: Record<string, string> = {
  wikipedia: "Wikipedia",
  stocktwits: "Stocktwits",
  stocktwits_watchers: "ST watchers",
  stocktwits_msgs: "ST messages",
  youtube: "YouTube",
  apple: "App Store",
  github: "GitHub",
  autocomplete: "Autocomplete",
};

/** Human labels for the Thesis v2 causal-mechanism fields (causal.py ANALYZE_A_SCHEMA `mechanism`). */
export const MECHANISM_LABELS: Record<string, string> = {
  human_motivation: "Human motivation",
  friction_removed: "Friction removed",
  enabling_technology: "Enabling technology",
  economic_incentive: "Economic incentive",
  trust_requirement: "Trust requirement",
  distribution_mechanism: "Distribution mechanism",
  network_effects: "Network effects",
  switching_costs: "Switching costs",
  regulatory_constraints: "Regulatory constraints",
};

/** Human labels for the Thesis v2 analogue-similarity dimensions (causal.py SIM_DIMS). */
export const SIM_DIM_LABELS: Record<string, string> = {
  motivation: "Motivation",
  friction_removed: "Friction removed",
  behavior_change_required: "Behaviour change required",
  trust_dependency: "Trust dependency",
  infrastructure_dependency: "Infrastructure dependency",
  network_effects: "Network effects",
  economic_incentive: "Economic incentive",
  adoption_demographics: "Adoption demographics",
};

/** Human labels for the Thesis v2 value-pool `becomes` field. */
export const BECOMES_LABELS: Record<string, string> = {
  scarce: "becomes scarce",
  abundant: "becomes abundant",
  mandatory_infrastructure: "mandatory infrastructure",
  new_risk: "new risk",
  loses_pricing_power: "loses pricing power",
  gains_pricing_power: "gains pricing power",
};
