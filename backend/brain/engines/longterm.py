"""Long-Term Thesis Engine — the cumulative view of where human behaviour is going.

Every morning brief contributes a "human behaviour: long term" section and multi-year claims.
This engine reads all of them, has the model reconcile them into one durable thesis (what people
will need, which structural shifts are compounding, which are fading), ranks the theme graph by
long-term conviction, and names beneficiary profiles. The Portfolio engine uses the theme ranking
as its primary conviction input in long-term mode.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from ..llm import _call
from .brief import THEME_KEYWORDS
from .common import r
from .themes import load_graph

HUMAN_NEEDS = ["time", "money", "status", "security", "health", "convenience", "entertainment", "connection",
               "mobility", "housing", "food", "energy", "knowledge", "productivity"]

SCHEMA = {
    "type": "object",
    "properties": {
        "thesis": {"type": "string", "description": "The cumulative long-term thesis in 2-4 paragraphs: how human needs and behaviour are shifting over 3-10 years and what that means for capital."},
        "structural_shifts": {"type": "array", "items": {"type": "object", "properties": {
            "shift": {"type": "string"}, "human_need": {"type": "string", "enum": HUMAN_NEEDS}, "horizon_years": {"type": "string"},
            "confidence": {"type": "number"}, "trend": {"type": "string", "enum": ["strengthening", "stable", "fading"]},
            "themes": {"type": "array", "items": {"type": "string"}}, "evidence": {"type": "array", "items": {"type": "string"}},
            "kind": {"type": "string", "enum": ["observed_fact", "consensus_expectation", "ai_inference", "speculative_hypothesis"]}},
            "required": ["shift", "human_need", "horizon_years", "confidence", "trend", "themes", "evidence", "kind"], "additionalProperties": False}},
        "theme_ranking": {"type": "array", "items": {"type": "object", "properties": {
            "theme_id": {"type": "string"}, "conviction": {"type": "number", "description": "0-1 long-term conviction"}, "why": {"type": "string"}},
            "required": ["theme_id", "conviction", "why"], "additionalProperties": False}},
        "beneficiary_profiles": {"type": "array", "items": {"type": "string"}, "description": "What kind of company benefits: constraint owner, toll road, picks-and-shovels, etc."},
        "not_priced_candidates": {"type": "array", "items": {"type": "object", "properties": {
            "ticker": {"type": "string"}, "why": {"type": "string"}}, "required": ["ticker", "why"], "additionalProperties": False},
            "description": "Universe tickers whose long-term exposure looks under-appreciated given the scores provided."},
        "anti_theses": {"type": "array", "items": {"type": "string"}, "description": "Long-term ideas that are popular but that the evidence does not support."},
        "what_would_change": {"type": "array", "items": {"type": "string"}},
        "confidence": {"type": "number"},
    },
    "required": ["thesis", "structural_shifts", "theme_ranking", "beneficiary_profiles", "not_priced_candidates", "anti_theses", "what_would_change", "confidence"],
    "additionalProperties": False,
}
SYSTEM = (
    "You are the Human Future Engine of an investment research system. You receive every morning brief's long-term "
    "human-behaviour observations and multi-year claims (dated), the theme graph, current theme scores (trend / pricing / "
    "narrative / attention) and the universe's best-scoring companies. Reason from first principles about fundamental human "
    "needs (time, money, status, security, health, convenience, entertainment, connection, mobility, housing, food, energy, "
    "knowledge, productivity): which technologies or shifts substantially cut the cost, time or friction of satisfying them? "
    "Reconcile the daily observations into ONE cumulative thesis: weight recurring, strengthening shifts over one-off headlines; "
    "label each shift as fact, consensus, inference or speculative hypothesis; rank the provided theme_ids by long-term conviction; "
    "and name universe companies whose long-term exposure the scores suggest is not yet priced (attention rising, pricing low). "
    "Be specific and candid. No disclaimers. Return only the JSON object requested.")


def _fallback(briefs: list[dict], graph: dict[str, str]) -> dict:
    """No LLM: count long-term statements by theme keyword and rank themes."""
    counts: dict[str, int] = {}
    for b in briefs:
        for st in (b.get("llm") or {}).get("human_behavior", {}).get("long_term", []):
            t = st.lower()
            for tid, kws in THEME_KEYWORDS.items():
                if any(k in t for k in kws):
                    counts[tid] = counts.get(tid, 0) + 1
    mx = max(counts.values()) if counts else 1
    ranking = sorted(({"theme_id": k, "conviction": round(v / mx, 2), "why": f"{v} long-term observations mention it"} for k, v in counts.items()), key=lambda x: -x["conviction"])
    return {"thesis": "Headlines-only mode: theme conviction is the frequency of long-term human-behaviour observations per theme across the briefs.",
            "structural_shifts": [], "theme_ranking": ranking, "beneficiary_profiles": [], "not_priced_candidates": [], "anti_theses": [],
            "what_would_change": [], "confidence": 0.3}


def build(briefs: list[dict], themes: list[dict], attention: Optional[dict], top_companies: list[dict], use_llm: bool = True) -> dict:
    graph = {n["id"]: n["name"] for n in load_graph()}
    observations = []
    for b in sorted(briefs, key=lambda x: x.get("as_of", "")):
        L = b.get("llm") or {}
        if not L:
            continue
        observations.append({
            "date": b["as_of"], "direction": L.get("market_thesis", {}).get("direction"),
            "long_term_market": L.get("market_thesis", {}).get("long_term"),
            "human_behavior_long_term": L.get("human_behavior", {}).get("long_term", []),
            "human_behavior_short_term": L.get("human_behavior", {}).get("short_term", [])[:3],
            "multi_year_claims": [{k: c.get(k) for k in ("claim", "horizon", "beneficiaries", "confidence", "kind")}
                                  for c in L.get("claims", []) if any(k in (c.get("horizon") or "").lower() for k in ("year", "decade", "structural"))],
        })
    att_themes = {t["theme_id"]: t for t in (attention or {}).get("themes", [])}
    theme_rows = [{"theme_id": t["id"], "name": t["name"], "trend": t.get("trend"), "pricing": t.get("pricing"), "narrative": t.get("narrative"),
                   "attention": (att_themes.get(t["id"]) or {}).get("attention"), "attention_not_priced": (att_themes.get(t["id"]) or {}).get("not_priced"),
                   "human_needs": t.get("human_needs"), "horizon_years": t.get("horizon_years")} for t in themes]
    out = {"as_of": date.today().isoformat(), "generated_at": datetime.now().isoformat(timespec="seconds"), "n_briefs": len(observations),
           "observation_dates": [o["date"] for o in observations], "llm_provider": None}
    llm = None
    if use_llm and observations:
        from ..llm import provider
        prov = provider()
        if prov:
            pkg = {"theme_ids": graph, "observations": observations, "theme_scores": theme_rows,
                   "top_companies": top_companies[:60],
                   "attention_not_priced": [x.get("ticker") or x.get("theme_id") for x in (attention or {}).get("movers", {}).get("not_priced", [])][:15]}
            llm = _call(SYSTEM, pkg, SCHEMA, "longterm")
            if llm:
                llm["theme_ranking"] = [t for t in llm.get("theme_ranking", []) if t.get("theme_id") in graph]
                out["llm_provider"] = prov
    result = llm or _fallback(briefs, graph)
    result["theme_ranking"] = sorted(result.get("theme_ranking", []), key=lambda x: -(x.get("conviction") or 0))
    for t in result["theme_ranking"]:
        t["theme"] = graph.get(t["theme_id"], t["theme_id"])
    out.update(result)
    out["theme_conviction"] = {t["theme_id"]: r(float(t["conviction"]), 2) for t in result["theme_ranking"]}
    return out
