import Link from "next/link";
import type { EvidenceDirection, Num, ThesisV2BuyReadiness, ThesisV2Confidence, ThesisV2Contradictory, ThesisV2Status } from "@/lib/types";
import { BECOMES_LABELS, EPISTEMIC_LABELS, num, signed } from "@/lib/format";

/** Small chip set for the Thesis v2 pages. Green/red only where the value is a signed judgement. */

const CONFIDENCE_CLASS: Record<ThesisV2Confidence, string> = {
  High: "border-pos bg-pos-soft text-pos",
  Medium: "",
  Low: "border-warn bg-warn-soft text-warn",
};

export function ConfidenceChip({ value }: { value: ThesisV2Confidence | string | null | undefined }) {
  if (!value) return <span className="chip">—</span>;
  return <span className={`chip font-medium ${CONFIDENCE_CLASS[value as ThesisV2Confidence] ?? ""}`}>{value}</span>;
}

const CONTRADICTORY_CLASS: Record<ThesisV2Contradictory, string> = {
  Low: "border-pos bg-pos-soft text-pos",
  Moderate: "border-warn bg-warn-soft text-warn",
  High: "border-neg bg-neg-soft text-neg",
};

export function ContradictoryChip({ value }: { value: ThesisV2Contradictory | string | null | undefined }) {
  if (!value) return <span className="chip">—</span>;
  return <span className={`chip font-medium ${CONTRADICTORY_CLASS[value as ThesisV2Contradictory] ?? ""}`}>{value}</span>;
}

/** open = accent; resolved = green/red by outcome. */
export function ThesisStatusChip({ status, outcome }: { status: ThesisV2Status | string | null | undefined; outcome: boolean | null | undefined }) {
  if (status === "resolved") {
    const cls = outcome === true ? "border-pos bg-pos-soft text-pos" : outcome === false ? "border-neg bg-neg-soft text-neg" : "";
    return (
      <span className={`chip font-medium ${cls}`}>
        resolved · {outcome === null || outcome === undefined ? "—" : String(outcome)}
      </span>
    );
  }
  if (status === "open") return <span className="chip border-accent bg-accent-soft text-accent">open</span>;
  return <span className="chip">{status ?? "—"}</span>;
}

/** Adoption stage (pre-adoption … laggards). Neutral chip; the stage is a position, not a judgement. */
export function AdoptionStageChip({ stage, className = "" }: { stage: string | null | undefined; className?: string }) {
  if (!stage) return <span className={`chip ${className}`}>—</span>;
  return <span className={`chip ${className}`}>{stage}</span>;
}

const DIRECTION_CLASS: Record<EvidenceDirection, string> = {
  supports: "border-pos bg-pos-soft text-pos",
  contradicts: "border-neg bg-neg-soft text-neg",
};

export function EvidenceDirectionChip({ direction }: { direction: EvidenceDirection | string | null | undefined }) {
  if (!direction) return <span className="chip">—</span>;
  return <span className={`chip font-medium ${DIRECTION_CLASS[direction as EvidenceDirection] ?? ""}`}>{direction}</span>;
}

const KIND_CLASS: Record<string, string> = {
  observed_fact: "border-pos bg-pos-soft text-pos",
  consensus_expectation: "",
  ai_inference: "border-accent bg-accent-soft text-accent",
  speculative_hypothesis: "border-warn bg-warn-soft text-warn",
};

export function KindChip({ kind }: { kind: string | null | undefined }) {
  if (!kind) return <span className="chip">—</span>;
  return <span className={`chip ${KIND_CLASS[kind] ?? ""}`}>{EPISTEMIC_LABELS[kind] ?? kind}</span>;
}

const BECOMES_CLASS: Record<string, string> = {
  scarce: "border-pos bg-pos-soft text-pos",
  gains_pricing_power: "border-pos bg-pos-soft text-pos",
  mandatory_infrastructure: "border-accent bg-accent-soft text-accent",
  abundant: "",
  new_risk: "border-warn bg-warn-soft text-warn",
  loses_pricing_power: "border-neg bg-neg-soft text-neg",
};

export function BecomesChip({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="chip">—</span>;
  return <span className={`chip ${BECOMES_CLASS[value] ?? ""}`}>{BECOMES_LABELS[value] ?? value.replace(/_/g, " ")}</span>;
}

/** Tooltip-only labels; the chip itself stays short. */
function becomesLabel(value: string): string {
  return BECOMES_LABELS[value] ?? value.replace(/_/g, " ");
}

/**
 * `layer · becomes` role of a ticker in one thesis's value pool (opportunities
 * ranking). Tinted like BecomesChip; the thesis id and its posterior go in the tooltip.
 */
export function RoleChip({ layer, becomes, thesisId, posterior }: { layer: string; becomes: string; thesisId?: string; posterior?: Num }) {
  const title = [thesisId, posterior !== undefined ? `posterior ${num(posterior, 0)}%` : null, `${layer} · ${becomesLabel(becomes)}`].filter(Boolean).join(" · ");
  return (
    <span className={`chip max-w-64 truncate align-bottom ${BECOMES_CLASS[becomes] ?? ""}`} title={title}>
      <span className="text-ink">{layer}</span> · {becomesLabel(becomes)}
    </span>
  );
}

/** `T-00x` link to a thesis record; a negative contribution (headwind) turns the chip red. */
export function ThesisRefChip({ id, contribution }: { id: string; contribution?: Num }) {
  const neg = contribution !== null && contribution !== undefined && contribution < 0;
  const title = contribution === undefined ? id : `${id} · contribution ${signed(contribution, 2)} (posterior × value-pool weight)`;
  return (
    <Link href={`/thesis-v2/${id}`} className={`chip mono hover:text-accent ${neg ? "border-neg bg-neg-soft text-neg" : ""}`} title={title}>
      {id}
    </Link>
  );
}

/** ready = passes the entry gate today (green) · watch = neutral · not yet = dimmed. */
const READINESS_CLASS: Record<ThesisV2BuyReadiness, string> = {
  ready: "border-pos bg-pos-soft text-pos font-medium",
  watch: "",
  "not yet": "border-dashed text-subtle",
};

export function ReadinessChip({ value }: { value: ThesisV2BuyReadiness | string | null | undefined }) {
  if (!value) return <span className="chip">—</span>;
  return <span className={`chip whitespace-nowrap ${READINESS_CLASS[value as ThesisV2BuyReadiness] ?? ""}`}>{value}</span>;
}
