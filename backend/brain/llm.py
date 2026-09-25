"""Optional LLM enrichment (structured output only). The model never invents numbers:
it receives the engines' evidence and must label statements as observed fact /
consensus expectation / inference / speculative hypothesis.

Provider: Anthropic (claude-opus-5, adaptive thinking, server-side refusal fallbacks)
or OpenAI; chosen from whichever key is present (LLM_PROVIDER overrides).
"""
from __future__ import annotations

import json
from typing import Any, Optional

from .config import settings

THESIS_SCHEMA = {
    "type": "object",
    "properties": {
        "thesis": {"type": "string", "description": "3-5 sentence investment thesis grounded only in the provided evidence."},
        "fundamental_read": {"type": "string", "description": "2-4 sentences: what the growth, margins, cash generation, ROIC and balance sheet say."},
        "technical_read": {"type": "string", "description": "2-3 sentences on trend, momentum and levels from the technical indicators provided."},
        "market_expectation": {"type": "string", "description": "What the current valuation and momentum imply the market expects."},
        "what_market_misses": {"type": "array", "items": {"type": "string"}},
        "catalysts": {"type": "array", "items": {"type": "string"}},
        "risks": {"type": "array", "items": {"type": "string"}},
        "thesis_break_conditions": {"type": "array", "items": {"type": "string"}},
        "second_order_beneficiaries": {"type": "array", "items": {"type": "string"},
                                       "description": "If this company's constraints or growth create demand elsewhere, who makes money solving it?"},
        "epistemic_labels": {"type": "array", "items": {"type": "object", "properties": {
            "statement": {"type": "string"},
            "kind": {"type": "string", "enum": ["observed_fact", "consensus_expectation", "ai_inference", "speculative_hypothesis"]}},
            "required": ["statement", "kind"], "additionalProperties": False}},
        "confidence": {"type": "number", "description": "0-1 confidence that the thesis is materially right."},
    },
    "required": ["thesis", "fundamental_read", "technical_read", "market_expectation", "what_market_misses", "catalysts", "risks", "thesis_break_conditions",
                 "second_order_beneficiaries", "epistemic_labels", "confidence"],
    "additionalProperties": False,
}

MEMO_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "One paragraph: what this portfolio is betting on and why, given the regime and flows."},
        "key_bets": {"type": "array", "items": {"type": "object", "properties": {
            "ticker": {"type": "string"}, "why": {"type": "string"}}, "required": ["ticker", "why"], "additionalProperties": False}},
        "concentrations": {"type": "array", "items": {"type": "string"}, "description": "Sector/theme/factor concentrations worth knowing about."},
        "biggest_risks": {"type": "array", "items": {"type": "string"}},
        "what_would_change_our_mind": {"type": "array", "items": {"type": "string"}},
        "hedging_note": {"type": "string"},
        "watchlist": {"type": "array", "items": {"type": "string"}, "description": "Names just outside the portfolio worth monitoring, with the trigger."},
        "confidence": {"type": "number"},
    },
    "required": ["summary", "key_bets", "concentrations", "biggest_risks", "what_would_change_our_mind", "hedging_note", "watchlist", "confidence"],
    "additionalProperties": False,
}

THESIS_SYSTEM = (
    "You are the Investment Strategist of a multi-engine research system. You receive quantitative evidence "
    "(fundamentals, valuation, capital flows, macro regime, theme exposure) and a deterministic draft thesis. "
    "Write a sharper thesis using ONLY the evidence provided. Never invent figures. Separate observed facts, consensus "
    "expectations, your inferences and speculative hypotheses. Focus on where reality may differ from what is priced, "
    "and on second-order beneficiaries: if this company has a constraint, who profits from solving it? "
    "Return only the JSON object requested.")

MEMO_SYSTEM = (
    "You are the portfolio manager writing the weekly memo for a rules-based portfolio produced by a research system. "
    "You receive the holdings with their scores and rationale, the macro regime, risk posture, capital-flow summary and "
    "starred themes. Write a candid memo grounded ONLY in the evidence: what the portfolio is betting on, where it is "
    "concentrated, what would make the system wrong, and what to watch before next week's recalibration. Do not add "
    "disclaimers. Return only the JSON object requested.")


def provider() -> Optional[str]:
    p = settings.llm_provider.lower()
    if p == "none":
        return None
    if p == "openai" and settings.openai_api_key:
        return "openai"
    if p == "anthropic" and settings.anthropic_api_key:
        return "anthropic"
    if p == "auto":
        if settings.anthropic_api_key:
            return "anthropic"
        if settings.openai_api_key:
            return "openai"
    return None


def _anthropic_json(system: str, user: str, schema: dict) -> Optional[dict]:
    from anthropic import Anthropic
    client = Anthropic(api_key=settings.anthropic_api_key)
    # Thinking tokens count against max_tokens on Opus 5, so give long structured outputs plenty of room (streaming avoids timeouts).
    with client.beta.messages.stream(
        model=settings.anthropic_model, max_tokens=64000, system=system,
        messages=[{"role": "user", "content": user}],
        output_config={"format": {"type": "json_schema", "schema": schema}},
        betas=["server-side-fallback-2026-07-01"], fallbacks="default",
    ) as stream:
        resp = stream.get_final_message()
    if resp.stop_reason == "refusal":
        print("[llm] request refused")
        return None
    if resp.stop_reason == "max_tokens":
        print(f"[llm] output truncated at max_tokens (in={resp.usage.input_tokens}, out={resp.usage.output_tokens})")
        return None
    text = next((b.text for b in resp.content if getattr(b, "type", "") == "text"), None)
    return json.loads(text) if text else None


def _openai_json(system: str, user: str, schema: dict, name: str) -> Optional[dict]:
    from openai import OpenAI
    client = OpenAI(api_key=settings.openai_api_key)
    resp = client.chat.completions.create(
        model=settings.openai_model, temperature=0.2,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        response_format={"type": "json_schema", "json_schema": {"name": name, "schema": schema, "strict": True}},
    )
    return json.loads(resp.choices[0].message.content)


def _call(system: str, package: Any, schema: dict, name: str) -> Optional[dict]:
    prov = provider()
    if not prov:
        return None
    user = "EVIDENCE (JSON):\n" + json.dumps(package, default=str)[:60000]
    try:
        if prov == "anthropic":
            return _anthropic_json(system, user, schema)
        return _openai_json(system, user, schema, name)
    except Exception as e:  # never let enrichment break the pipeline
        print(f"[llm] {name} failed: {e}")
        return None


def enrich_thesis(package: dict) -> Optional[dict]:
    return _call(THESIS_SYSTEM, package, THESIS_SCHEMA, "thesis")


def portfolio_memo(package: dict) -> Optional[dict]:
    return _call(MEMO_SYSTEM, package, MEMO_SCHEMA, "memo")
