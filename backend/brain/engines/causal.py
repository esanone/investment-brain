"""Causal Futures Engine (Thesis v2) — a probabilistic thesis ledger.

Given what humans did under structurally similar conditions in the past, what is the probability they
behave a particular way now, and where does economic value accumulate if they do?

Pipeline per thesis: formalize -> decompose the causal mechanism -> retrieve historical analogues by
mechanism -> build a reference class (base rate = prior) -> weigh present evidence as likelihood ratios ->
posterior in log-odds (computed here, never stated by the model) -> stage of adoption -> value pools and
mapped companies -> ledger entry. Monthly: "what changed?" updates the posterior; resolved theses are
Brier-scored so the probabilities become calibrated over time.
"""
from __future__ import annotations

import math
from datetime import date, datetime
from typing import Optional

from ..llm import _call
from .common import r

LR = {"strong": 3.0, "moderate": 2.0, "weak": 1.3}
SIM_DIMS = ["motivation", "friction_removed", "behavior_change_required", "trust_dependency", "infrastructure_dependency",
            "network_effects", "economic_incentive", "adoption_demographics"]

_EVIDENCE_ITEM = {"type": "object", "properties": {
    "claim": {"type": "string"}, "direction": {"type": "string", "description": "supports | contradicts"},
    "strength": {"type": "string", "description": "strong | moderate | weak"},
    "quality": {"type": "number", "description": "0-1 data quality (survey size, source rigor, recency)"},
    "independence": {"type": "number", "description": "0-1: 1 = independent of the other evidence, lower if correlated/duplicative"},
    "source": {"type": "string"}, "date": {"type": "string"},
    "kind": {"type": "string", "description": "observed_fact | consensus_expectation | ai_inference | speculative_hypothesis"}},
    "required": ["claim", "direction", "strength", "quality", "independence", "source", "date", "kind"], "additionalProperties": False}

ANALYZE_A_SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "formalized": {"type": "object", "properties": {
            "statement": {"type": "string"}, "population": {"type": "string"}, "behavior": {"type": "string"}, "horizon_year": {"type": "integer"},
            "observable_outcome": {"type": "string"}, "measurable_metric": {"type": "string"}},
            "required": ["statement", "population", "behavior", "horizon_year", "observable_outcome", "measurable_metric"], "additionalProperties": False},
        "mechanism": {"type": "object", "properties": {k: {"type": "string"} for k in
            ["human_motivation", "friction_removed", "enabling_technology", "economic_incentive", "trust_requirement", "distribution_mechanism",
             "network_effects", "switching_costs", "regulatory_constraints"]},
            "required": ["human_motivation", "friction_removed", "enabling_technology", "economic_incentive", "trust_requirement", "distribution_mechanism",
                         "network_effects", "switching_costs", "regulatory_constraints"], "additionalProperties": False},
        "analogues": {"type": "array", "description": "10-20 historical transitions sharing the MECHANISM, not the surface technology.", "items": {"type": "object", "properties": {
            "name": {"type": "string"}, "period": {"type": "string"}, "mechanism": {"type": "string"},
            "similarity": {"type": "array", "items": {"type": "number"}, "description": "Eight 0-1 scores in this order: motivation, friction_removed, "
                           "behavior_change_required, trust_dependency, infrastructure_dependency, network_effects, economic_incentive, adoption_demographics"},
            "pattern_occurred": {"type": "boolean"}, "years_to_mainstream": {"type": "number"}, "lesson": {"type": "string"}},
            "required": ["name", "period", "mechanism", "similarity", "pattern_occurred", "years_to_mainstream", "lesson"], "additionalProperties": False}},
        "reference_class": {"type": "object", "properties": {"description": {"type": "string"}, "caveats": {"type": "string"}}, "required": ["description", "caveats"], "additionalProperties": False},
    },
    "required": ["title", "formalized", "mechanism", "analogues", "reference_class"], "additionalProperties": False,
}
ANALYZE_B_SCHEMA = {
    "type": "object",
    "properties": {
        "evidence": {"type": "array", "description": "Present-day evidence, supporting AND contradicting; 6-15 items.", "items": _EVIDENCE_ITEM},
        "stage": {"type": "object", "properties": {
            "current_stage": {"type": "string", "description": "one of: pre-adoption, innovators, early adopters, early majority, late majority, laggards"},
            "prerequisites_met": {"type": "array", "items": {"type": "string"}}, "prerequisites_missing": {"type": "array", "items": {"type": "string"}},
            "historical_pathway_position": {"type": "string"}}, "required": ["current_stage", "prerequisites_met", "prerequisites_missing", "historical_pathway_position"], "additionalProperties": False},
        "scenarios": {"type": "object", "properties": {k: {"type": "object", "properties": {"weight": {"type": "number"}, "description": {"type": "string"}},
                      "required": ["weight", "description"], "additionalProperties": False} for k in ("bull", "base", "bear")}, "required": ["bull", "base", "bear"], "additionalProperties": False},
        "indicators": {"type": "object", "properties": {
            "supporting": {"type": "array", "items": {"type": "string"}}, "contradictory": {"type": "array", "items": {"type": "string"}},
            "next_confirmation_signal": {"type": "string"}, "biggest_variables": {"type": "array", "items": {"type": "string"}}},
            "required": ["supporting", "contradictory", "next_confirmation_signal", "biggest_variables"], "additionalProperties": False},
        "value_pools": {"type": "array", "items": {"type": "object", "properties": {
            "layer": {"type": "string"}, "emerging_need": {"type": "string"}, "opportunity": {"type": "string"},
            "becomes": {"type": "string", "description": "one of: scarce, abundant, mandatory_infrastructure, new_risk, loses_pricing_power, gains_pricing_power"},
            "tickers": {"type": "array", "items": {"type": "string"}}},
            "required": ["layer", "emerging_need", "opportunity", "becomes", "tickers"], "additionalProperties": False}},
        "second_order_thesis": {"type": "string"},
        "losers": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["evidence", "stage", "scenarios", "indicators", "value_pools", "second_order_thesis", "losers"], "additionalProperties": False,
}
UPDATE_SCHEMA = {
    "type": "object",
    "properties": {
        "what_changed": {"type": "array", "items": {"type": "string"}, "description": "Only genuine changes since the last update; empty if nothing material."},
        "new_evidence": {"type": "array", "items": _EVIDENCE_ITEM},
        "retire_evidence": {"type": "array", "items": {"type": "integer"}, "description": "Indexes of existing evidence now superseded or invalidated."},
        "stage": {"type": "object", "properties": {"current_stage": {"type": "string", "description": "pre-adoption | innovators | early adopters | early majority | late majority | laggards"},
                  "prerequisites_met": {"type": "array", "items": {"type": "string"}}, "prerequisites_missing": {"type": "array", "items": {"type": "string"}},
                  "historical_pathway_position": {"type": "string"}}, "required": ["current_stage", "prerequisites_met", "prerequisites_missing", "historical_pathway_position"], "additionalProperties": False},
        "next_confirmation_signal": {"type": "string"},
        "should_change_mind": {"type": "string", "description": "Candid: does the balance of NEW evidence argue for moving the probability up, down, or not at all, and why?"},
    },
    "required": ["what_changed", "new_evidence", "retire_evidence", "stage", "next_confirmation_signal", "should_change_mind"], "additionalProperties": False,
}
ANALYZE_SYSTEM = (
    "You are the Causal Futures Engine of an investment research system: a probabilistic thesis engine built on causal historical "
    "analogies, reference-class forecasting and Bayesian updating. You NEVER state a probability yourself; the system computes it from "
    "the reference class and the evidence you provide. Formalize the thesis measurably. Decompose the causal mechanism. Retrieve 10-20 "
    "historical analogues that share the MECHANISM (complexity hidden behind an interface, trust infrastructure preceding convenience, "
    "control traded for access, etc.), not the surface technology; score each on the similarity dimensions honestly and say whether the "
    "hypothesised pattern actually occurred. Provide present-day evidence on BOTH sides with candid quality and independence scores "
    "(correlated survey results are not independent). Identify the adoption stage, scenarios, indicators to watch, and the value pools: "
    "what becomes scarce, abundant, mandatory infrastructure, a new risk, who gains or loses pricing power, and which universe tickers "
    "are exposed. Label statements by epistemic kind. No disclaimers. Return only the JSON object requested.")
UPDATE_SYSTEM = (
    "You are the Causal Futures Engine performing the monthly review of a recorded thesis. The question is 'what changed?', not 'can I "
    "find more support?'. Report only material changes since the last update, add genuinely new evidence on either side with honest "
    "quality/independence, retire evidence that is superseded, restate the adoption stage, and say candidly whether the new evidence "
    "argues for moving the probability up, down or not at all. You are rewarded for changing your mind correctly, not for defending the "
    "thesis. No disclaimers. Return only the JSON object requested.")


# ------------------------------------------------------------------ the probability engine
def _logit(p: float) -> float:
    p = min(max(p, 0.01), 0.99)
    return math.log(p / (1 - p))


def _sigmoid(x: float) -> float:
    return 1 / (1 + math.exp(-x))


def score(record: dict) -> dict:
    """Recompute analogy strength, prior, evidence weights, posterior and range from the record's inputs."""
    analogues = record.get("analogues", [])
    for a in analogues:
        sims = [float(a["similarity"].get(k, 0)) for k in SIM_DIMS]
        a["similarity_score"] = r(sum(sims) / len(sims) * 100, 0) if sims else None
    relevant = [a for a in analogues if (a.get("similarity_score") or 0) >= 40]
    n, occurred = len(relevant), sum(1 for a in relevant if a.get("pattern_occurred"))
    prior = (occurred + 1) / (n + 2)                       # Laplace-smoothed reference-class base rate
    analogy_strength = r(sum(a["similarity_score"] for a in relevant) / n, 0) if n else None

    active = [e for e in record.get("evidence", []) if not e.get("retired")]
    total_ll, sup_w, con_w, qualities = 0.0, 0.0, 0.0, []
    for e in active:
        lr = LR.get(e.get("strength", "weak"), 1.3)
        if e.get("direction") == "contradicts":
            lr = 1 / lr
        w = max(0.0, min(1.0, float(e.get("quality", 0.5)))) * max(0.0, min(1.0, float(e.get("independence", 0.5))))
        e["lr"], e["weight"], e["log_lr_weighted"] = r(lr, 2), r(w, 2), r(w * math.log(lr), 3)
        total_ll += w * math.log(lr)
        if e.get("direction") == "supports":
            sup_w += w * abs(math.log(lr))
        else:
            con_w += w * abs(math.log(lr))
        qualities.append(float(e.get("quality", 0.5)))
    post_lo = _logit(prior) + total_ll
    posterior = _sigmoid(post_lo)
    low, high = _sigmoid(_logit(prior) + 0.5 * total_ll), _sigmoid(_logit(prior) + 1.5 * total_ll)
    spread = 0.06 + 0.10 / math.sqrt(max(len(active), 1))       # thinner evidence -> wider band
    low, high = min(low, high) - spread, max(low, high) + spread
    evidence_strength = min(100, r((sup_w + con_w) * 40, 0))
    evidence_quality = r(sum(qualities) / len(qualities) * 100, 0) if qualities else None
    con_share = con_w / (sup_w + con_w) if (sup_w + con_w) else 0
    contradictory = "Low" if con_share < 0.2 else "Moderate" if con_share < 0.4 else "High"
    confidence = ("High" if n >= 8 and len(active) >= 8 and (evidence_quality or 0) >= 70
                  else "Medium" if n >= 5 and len(active) >= 5 else "Low")
    record["reference_class"] = {**record.get("reference_class", {}), "n": n, "occurred": occurred, "base_rate": r(prior, 3)}
    record["probability"] = {
        "prior": r(prior * 100, 1), "posterior": r(posterior * 100, 1),
        "range_low": r(max(1.0, low * 100), 0), "range_high": r(min(99.0, high * 100), 0),
        "log_odds_prior": r(_logit(prior), 3), "log_odds_evidence": r(total_ll, 3), "log_odds_posterior": r(post_lo, 3),
        "analogy_strength": analogy_strength, "evidence_strength": evidence_strength, "evidence_quality": evidence_quality,
        "contradictory_evidence": contradictory, "confidence": confidence, "n_evidence": len(active),
        "note": "Posterior log-odds = prior log-odds (reference-class base rate) + sum of quality x independence weighted log likelihood ratios. "
                "Research-informed estimate until enough theses resolve for Brier calibration.",
    }
    sc = record.get("scenarios") or {}
    tot = sum(float(v.get("weight", 0)) for v in sc.values()) or 1
    for k, v in sc.items():
        v["probability"] = r(float(v.get("weight", 0)) / tot * 100, 0)
    return record


# ------------------------------------------------------------------ ledger operations
def create(thesis_id: str, statement: str, universe: list[dict], themes: list[str], context: Optional[dict] = None) -> dict:
    pkg = {"thesis_statement": statement, "today": date.today().isoformat(), "themes": themes, "context": context or {}}
    a = _call(ANALYZE_SYSTEM + " In this call return ONLY: title, formalized, mechanism, analogues, reference_class.", pkg, ANALYZE_A_SCHEMA, "thesis_v2_a")
    if not a:
        raise RuntimeError("LLM analysis unavailable (no key or refused)")
    for an in a.get("analogues", []):
        sims = list(an.get("similarity") or [])
        an["similarity"] = {k: float(sims[i]) if i < len(sims) else 0.0 for i, k in enumerate(SIM_DIMS)}
    pkg_b = {**pkg, "universe": universe, "formalized": a["formalized"], "mechanism": a["mechanism"], "analogue_names": [x["name"] for x in a["analogues"]]}
    b = _call(ANALYZE_SYSTEM + " The thesis has been formalized (see 'formalized' and 'mechanism'). In this call return ONLY: evidence, stage, scenarios, indicators, value_pools, second_order_thesis, losers.",
              pkg_b, ANALYZE_B_SCHEMA, "thesis_v2_b")
    if not b:
        raise RuntimeError("LLM evidence analysis unavailable (no key or refused)")
    out = {**a, **b}
    universe_tickers = {u["ticker"] for u in universe}
    for vp in out.get("value_pools", []):
        vp["tickers"] = [t for t in vp.get("tickers", []) if t in universe_tickers]
    record = {
        "id": thesis_id, "raw_statement": statement, "created": date.today().isoformat(), "status": "open", "outcome": None,
        "horizon": f"{out['formalized']['horizon_year']}-12-31", **out,
        "updates": [], "probability_history": [], "brier": None,
    }
    score(record)
    record["probability_history"].append({"date": date.today().isoformat(), "posterior": record["probability"]["posterior"], "event": "created"})
    record["last_update"] = date.today().isoformat()
    return record


def update(record: dict, recent_context: dict) -> dict:
    pkg = {"today": date.today().isoformat(), "thesis": {k: record.get(k) for k in ("id", "title", "formalized", "mechanism", "stage", "indicators", "evidence", "probability", "updates")},
           "recent_context": recent_context}
    out = _call(UPDATE_SYSTEM, pkg, UPDATE_SCHEMA, "thesis_v2_update")
    if not out:
        raise RuntimeError("LLM update unavailable")
    before = record["probability"]["posterior"]
    for i in out.get("retire_evidence", []):
        if 0 <= i < len(record["evidence"]):
            record["evidence"][i]["retired"] = True
    for e in out.get("new_evidence", []):
        e["added"] = date.today().isoformat()
        record["evidence"].append(e)
    record["stage"] = out.get("stage", record.get("stage"))
    record.setdefault("indicators", {})["next_confirmation_signal"] = out.get("next_confirmation_signal") or record["indicators"].get("next_confirmation_signal")
    score(record)
    after = record["probability"]["posterior"]
    record["updates"].append({"date": date.today().isoformat(), "what_changed": out.get("what_changed", []), "new_evidence": len(out.get("new_evidence", [])),
                              "retired": len(out.get("retire_evidence", [])), "should_change_mind": out.get("should_change_mind"),
                              "posterior_before": before, "posterior_after": after})
    record["probability_history"].append({"date": date.today().isoformat(), "posterior": after, "event": "monthly update"})
    record["last_update"] = date.today().isoformat()
    return record


def resolve(record: dict, outcome: bool) -> dict:
    """Brier score of the final forecast and of the time-averaged forecast."""
    p_final = record["probability"]["posterior"] / 100
    hist = [h["posterior"] / 100 for h in record.get("probability_history", [])] or [p_final]
    y = 1.0 if outcome else 0.0
    record["status"], record["outcome"], record["resolved"] = "resolved", bool(outcome), date.today().isoformat()
    record["brier"] = {"final": r((p_final - y) ** 2, 4), "time_averaged": r(sum((p - y) ** 2 for p in hist) / len(hist), 4)}
    return record


def scoreboard(records: list[dict]) -> dict:
    resolved = [x for x in records if x.get("status") == "resolved" and x.get("brier")]
    bins: dict[str, dict] = {}
    for x in resolved:
        p = x["probability"]["posterior"]
        b = f"{int(p // 10) * 10}-{int(p // 10) * 10 + 10}"
        bins.setdefault(b, {"n": 0, "hits": 0, "avg_p": 0.0})
        bins[b]["n"] += 1; bins[b]["hits"] += int(bool(x["outcome"])); bins[b]["avg_p"] += p
    for b in bins.values():
        b["hit_rate"] = r(b["hits"] / b["n"] * 100, 0); b["avg_p"] = r(b["avg_p"] / b["n"], 0)
    return {"open": sum(1 for x in records if x.get("status") == "open"), "resolved": len(resolved),
            "mean_brier_final": r(sum(x["brier"]["final"] for x in resolved) / len(resolved), 4) if resolved else None,
            "mean_brier_time_averaged": r(sum(x["brier"]["time_averaged"] for x in resolved) / len(resolved), 4) if resolved else None,
            "calibration": bins,
            "note": "Brier 0 = perfect, 0.25 = coin flip. Calibration bins compare stated probability with realised frequency; "
                    "the hindcast harness (forecast from 1995/2000/... with later data hidden) is the next step."}


def summary(record: dict) -> dict:
    p = record.get("probability", {})
    return {"id": record["id"], "title": record.get("title"), "statement": record.get("formalized", {}).get("statement"), "status": record.get("status"),
            "created": record.get("created"), "horizon": record.get("horizon"), "last_update": record.get("last_update"),
            "posterior": p.get("posterior"), "prior": p.get("prior"), "range_low": p.get("range_low"), "range_high": p.get("range_high"),
            "confidence": p.get("confidence"), "stage": record.get("stage", {}).get("current_stage"),
            "next_confirmation_signal": record.get("indicators", {}).get("next_confirmation_signal"),
            "n_analogues": len(record.get("analogues", [])), "n_evidence": p.get("n_evidence"), "n_updates": len(record.get("updates", [])),
            "outcome": record.get("outcome"), "brier": record.get("brier")}
