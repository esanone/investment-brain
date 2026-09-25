"""Morning Brief — Narrative Intelligence Engine, step 1.

Every morning: ingest key-free news feeds, map headlines to the theme graph and the
universe, and (with an LLM key) extract *claims about the future*, a market thesis,
short/long-term human-behaviour shifts, theme/ticker signals and portfolio implications.
Theme narrative scores (0-100) are rolled up from the last 7 briefs and flow into the
Themes and Strategist engines as the spec's Narrative score.
"""
from __future__ import annotations

import re
import uuid
from datetime import date, datetime
from typing import Optional

from ..data import news
from ..llm import _call
from ..universe import COMPANIES
from .common import r
from .themes import load_graph

# theme_id -> keywords (lowercase). The theme graph's names/descriptions are added automatically.
THEME_KEYWORDS: dict[str, list[str]] = {
    "ai-infrastructure": ["nvidia", "datacenter", "data center", "gpu", "hyperscaler", "ai chip", "ai spending", "capex", "openai", "anthropic", "hbm", "tsmc", "broadcom", "micron"],
    "edge-ai": ["on-device", "edge ai", "ai pc", "ai phone", "qualcomm", "apple intelligence"],
    "ai-software-agents": ["ai agent", "agentic", "copilot", "chatgpt", "llm", "software stocks", "salesforce", "servicenow", "palantir"],
    "cybersecurity": ["cyber", "hack", "breach", "ransomware", "crowdstrike", "palo alto", "zscaler", "fortinet"],
    "grid-modernization": ["grid", "transmission", "transformer", "utility capex", "interconnection", "eaton", "quanta"],
    "power-demand": ["electricity demand", "power demand", "electricity prices", "power prices", "constellation", "vistra", "nrg", "gas turbine"],
    "nuclear-power": ["nuclear", "reactor", "smr", "uranium", "oklo", "nuscale"],
    "robotics-automation": ["robot", "humanoid", "automation", "optimus", "factory automation"],
    "autonomous-transport": ["robotaxi", "self-driving", "autonomous", "waymo", "tesla fsd", "cruise"],
    "glp1-obesity": ["glp-1", "ozempic", "wegovy", "zepbound", "obesity drug", "eli lilly", "novo nordisk"],
    "longevity": ["longevity", "aging", "diagnostic", "continuous glucose", "dexcom"],
    "medical-devices": ["medical device", "surgical", "intuitive surgical", "stryker", "boston scientific"],
    "semicap": ["semiconductor equipment", "applied materials", "lam research", "kla", "asml", "fab", "foundry"],
    "reshoring-capex": ["reshoring", "onshoring", "manufacturing investment", "factory", "industrial policy", "chips act", "megaproject"],
    "defense-modernization": ["defense", "pentagon", "missile", "lockheed", "northrop", "rearm", "nato", "military spending"],
    "space-economy": ["space", "rocket lab", "spacex", "starlink", "satellite", "launch"],
    "digital-payments": ["payments", "visa", "mastercard", "paypal", "stablecoin", "fintech", "block inc"],
    "crypto-digital-assets": ["bitcoin", "crypto", "ethereum", "coinbase", "etf inflows crypto", "tokeniz"],
    "cloud-computing": ["cloud", "azure", "aws", "google cloud", "oracle cloud", "snowflake", "datadog"],
    "streaming-media": ["netflix", "streaming", "disney", "roblox", "box office", "gaming"],
    "ecommerce-logistics": ["amazon", "e-commerce", "ecommerce", "ups", "fedex", "logistics", "shipping rates"],
    "housing-shortage": ["housing", "homebuilder", "mortgage rate", "home sales", "housing starts", "lennar", "d.r. horton", "home depot"],
    "travel-experiences": ["travel", "airline", "cruise", "hotel", "booking", "airbnb", "marriott", "delta air"],
    "gold-hard-assets": ["gold", "bullion", "newmont", "central bank buying", "silver"],
    "copper-electrification": ["copper", "freeport", "mining", "metals"],
    "lng-energy-security": ["oil", "opec", "crude", "natural gas", "lng", "exxon", "chevron", "energy security", "brent", "wti"],
    "value-retail": ["walmart", "costco", "consumer spending", "retail sales", "tjx", "trade down", "discount"],
    "market-structure": ["retail investor", "brokerage", "schwab", "robinhood", "interactive brokers", "ipo", "exchange volumes", "blackrock"],
    "advertising-attention": ["advertising", "ad spend", "meta", "alphabet", "google search", "trade desk", "reddit", "applovin"],
}
MACRO_KEYWORDS = {
    "fed-rates": ["fed", "federal reserve", "rate cut", "rate hike", "fomc", "powell", "treasury yield", "bond yields"],
    "inflation": ["inflation", "cpi", "pce", "prices rose", "price pressures", "tariff prices"],
    "growth-jobs": ["jobs report", "payrolls", "unemployment", "gdp", "recession", "ism", "pmi", "consumer confidence"],
    "geopolitics-trade": ["tariff", "sanction", "china", "trade war", "geopolit", "ukraine", "middle east", "taiwan"],
    "market-breadth": ["s&p 500", "nasdaq", "dow", "record high", "sell-off", "selloff", "rally", "volatility", "vix"],
}
_TICKER_RE = re.compile(r"\b([A-Z]{2,5})\b")
_GENERIC = {"bank", "american", "general", "united", "first", "southern", "digital", "american", "advanced", "walt", "eli", "home", "the",
            "block", "royal", "delta", "simon", "builders", "comfort", "boston", "texas", "regeneron", "realty", "air", "eog", "coca-cola", "toll",
            "intuitive", "interactive", "charles", "morgan", "goldman", "wells", "citigroup", "cme", "ice", "s&p", "d.r.", "l3harris", "ge", "nvent"}

BRIEF_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "5-8 sentence morning summary of what matters for markets today."},
        "market_thesis": {"type": "object", "properties": {
            "direction": {"type": "string", "enum": ["risk-on", "neutral", "risk-off"]},
            "short_term": {"type": "string", "description": "Days to weeks."},
            "medium_term": {"type": "string", "description": "Months."},
            "long_term": {"type": "string", "description": "Years: structural."},
            "confidence": {"type": "number"}}, "required": ["direction", "short_term", "medium_term", "long_term", "confidence"], "additionalProperties": False},
        "human_behavior": {"type": "object", "properties": {
            "short_term": {"type": "array", "items": {"type": "string"}, "description": "How consumers/investors/firms are changing behaviour now."},
            "long_term": {"type": "array", "items": {"type": "string"}, "description": "Structural shifts in what people need/want and how they satisfy it."}},
            "required": ["short_term", "long_term"], "additionalProperties": False},
        "claims": {"type": "array", "items": {"type": "object", "properties": {
            "claim": {"type": "string"}, "horizon": {"type": "string"},
            "beneficiaries": {"type": "array", "items": {"type": "string"}}, "risks": {"type": "array", "items": {"type": "string"}},
            "confidence": {"type": "number"},
            "kind": {"type": "string", "enum": ["observed_fact", "consensus_expectation", "ai_inference", "speculative_hypothesis"]}},
            "required": ["claim", "horizon", "beneficiaries", "risks", "confidence", "kind"], "additionalProperties": False}},
        "theme_signals": {"type": "array", "items": {"type": "object", "properties": {
            "theme_id": {"type": "string"}, "theme": {"type": "string"},
            "direction": {"type": "string", "enum": ["bullish", "bearish", "neutral"]}, "strength": {"type": "number"}, "evidence": {"type": "string"}},
            "required": ["theme_id", "theme", "direction", "strength", "evidence"], "additionalProperties": False}},
        "ticker_signals": {"type": "array", "items": {"type": "object", "properties": {
            "ticker": {"type": "string"}, "direction": {"type": "string", "enum": ["bullish", "bearish", "neutral"]}, "evidence": {"type": "string"}},
            "required": ["ticker", "direction", "evidence"], "additionalProperties": False}},
        "portfolio_implications": {"type": "array", "items": {"type": "object", "properties": {
            "ticker": {"type": "string"}, "action": {"type": "string", "enum": ["hold", "review", "add", "trim"]}, "why": {"type": "string"}},
            "required": ["ticker", "action", "why"], "additionalProperties": False}},
        "watch_today": {"type": "array", "items": {"type": "string"}},
        "what_changed_since_yesterday": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "market_thesis", "human_behavior", "claims", "theme_signals", "ticker_signals", "portfolio_implications",
                 "watch_today", "what_changed_since_yesterday"],
    "additionalProperties": False,
}
BRIEF_SYSTEM = (
    "You are the Narrative Intelligence Engine of an investment research system. You receive this morning's headlines "
    "(grouped by theme), the current macro regime, capital-flow summary, the model portfolio and yesterday's brief. "
    "Do not do sentiment scoring. Extract CLAIMS ABOUT THE FUTURE with horizon, beneficiaries, risks and confidence, and label "
    "each as observed fact, consensus expectation, your inference or a speculative hypothesis. Then state where the market is "
    "headed (short/medium/long term) and how human behaviour is shifting (what people need: time, money, status, security, health, "
    "convenience, entertainment, connection, mobility, housing, food, energy, knowledge, productivity). Give theme signals using "
    "ONLY the provided theme_ids, ticker signals for the universe, and concrete implications for the portfolio holdings. Be candid, "
    "specific, and grounded only in the headlines and data provided. No disclaimers. Return only the JSON object requested.")


def _keyword_index() -> dict[str, list[str]]:
    idx = {k: list(v) for k, v in THEME_KEYWORDS.items()}
    for n in load_graph():
        idx.setdefault(n["id"], []).append(n["name"].lower())
    return idx


def tag_headlines(headlines: list[dict], tickers: dict[str, str]) -> list[dict]:
    idx = _keyword_index()
    name_idx = {t: n.lower() for t, n in tickers.items()}
    out = []
    for h in headlines:
        text = f"{h['title']} {h.get('summary', '')}".lower()
        themes = [tid for tid, kws in idx.items() if any(k in text for k in kws)]
        macro = [m for m, kws in MACRO_KEYWORDS.items() if any(k in text for k in kws)]
        found = set()
        for t, n in name_idx.items():
            words = n.split(" ")
            first = words[0]
            # full name, or a distinctive first word (skip generic corporate words)
            if n in text or (len(first) >= 5 and first not in _GENERIC and first in text) or (len(words) >= 2 and " ".join(words[:2]) in text and first not in _GENERIC):
                found.add(t)
        for m in _TICKER_RE.findall(h["title"]):
            if m in tickers and m not in ("CEO", "IPO", "ETF", "GDP", "CPI", "FED", "AI", "US", "UK", "EU", "LNG", "XYZ", "NOW", "FIX", "MOD", "APP", "NET", "KEY", "ALL", "ONE", "BIG", "LOW", "MA", "O", "C", "V", "GE", "DE", "SO", "PM"):
                found.add(m)
        out.append({"title": h["title"], "source": h["source"], "url": h["url"], "published": h["published"].isoformat() if h.get("published") else None,
                    "tickers": sorted(found), "themes": themes, "macro": macro})
    return out


def build(regime: Optional[dict], flows: Optional[dict], portfolio: Optional[dict], prior_brief: Optional[dict],
          companies: dict[str, dict], use_llm: bool = True, hours: int = 36, attention: Optional[dict] = None) -> dict:
    raw, status = news.fetch_all(hours=hours)
    tickers = {t: c["name"] for t, c in companies.items()} or {t: v[0] for t, v in COMPANIES.items()}
    headlines = tag_headlines(raw, tickers)
    graph = {n["id"]: n["name"] for n in load_graph()}
    clusters: dict[str, list[dict]] = {}
    for h in headlines:
        for tid in h["themes"]:
            clusters.setdefault(tid, []).append({"title": h["title"], "source": h["source"], "url": h["url"]})
    macro_clusters: dict[str, list[dict]] = {}
    for h in headlines:
        for m in h["macro"]:
            macro_clusters.setdefault(m, []).append({"title": h["title"], "source": h["source"], "url": h["url"]})
    holdings = {h["ticker"] for h in (portfolio or {}).get("holdings", [])}
    counts: dict[str, int] = {}
    for h in headlines:
        for t in h["tickers"]:
            counts[t] = counts.get(t, 0) + 1
    mentions = sorted(({"ticker": t, "name": tickers.get(t, t), "n": n, "in_portfolio": t in holdings} for t, n in counts.items()),
                      key=lambda x: (-x["in_portfolio"], -x["n"]))[:40]
    cluster_rows = sorted(({"theme_id": k, "theme": graph.get(k, k), "n": len(v), "headlines": v[:12]} for k, v in clusters.items()), key=lambda x: -x["n"])
    macro_rows = sorted(({"topic": k, "n": len(v), "headlines": v[:12]} for k, v in macro_clusters.items()), key=lambda x: -x["n"])

    brief = {
        "brief_id": datetime.now().strftime("%Y%m%d-%H%M") + "-" + uuid.uuid4().hex[:4],
        "as_of": date.today().isoformat(), "generated_at": datetime.now().isoformat(timespec="seconds"),
        "llm_provider": None, "sources": status, "n_headlines": len(headlines), "headlines": headlines[:150],
        "clusters": cluster_rows, "macro_clusters": macro_rows, "ticker_mentions": mentions, "llm": None,
    }
    if use_llm:
        from ..llm import provider
        prov = provider()
        if prov:
            pkg = {
                "date": brief["as_of"],
                "theme_ids": {k: v for k, v in graph.items()},
                "headlines_by_theme": [{"theme_id": c["theme_id"], "theme": c["theme"], "headlines": [h["title"] + " (" + h["source"] + ")" for h in c["headlines"][:10]]} for c in cluster_rows[:18]],
                "macro_headlines": [{"topic": c["topic"], "headlines": [h["title"] + " (" + h["source"] + ")" for h in c["headlines"][:10]]} for c in macro_rows],
                "other_headlines": [h["title"] + " (" + h["source"] + ")" for h in headlines if not h["themes"] and not h["macro"]][:40],
                "ticker_mentions": mentions[:25],
                "regime": {"headline": regime.get("headline"), "probabilities": regime["regime"]["probabilities"], "trend": regime["trend"]["probability_delta"]} if regime else None,
                "flows_summary": (flows or {}).get("summary"), "sector_rotation": (flows or {}).get("sector_rotation"),
                "portfolio_holdings": [{"ticker": h["ticker"], "name": h["name"], "weight": h["weight"], "top_theme": h["top_theme"], "rationale": h["rationale"]}
                                       for h in (portfolio or {}).get("holdings", [])],
                "yesterday": {k: (prior_brief or {}).get("llm", {}).get(k) for k in ("summary", "market_thesis", "watch_today")} if prior_brief and prior_brief.get("llm") else None,
                "public_attention": attention,   # what people are searching/watching/installing (Attention engine), for the human-behaviour read
            }
            out = _call(BRIEF_SYSTEM, pkg, BRIEF_SCHEMA, "brief")
            if out:
                out["theme_signals"] = [t for t in out.get("theme_signals", []) if t.get("theme_id") in graph]
                brief["llm"], brief["llm_provider"] = out, prov
    return brief


def narrative_by_theme(briefs: list[dict], days: int = 7) -> dict[str, float]:
    """0-100 narrative score per theme from the last `days` briefs' LLM theme signals
    (bullish strength adds, bearish subtracts; recency-weighted)."""
    acc: dict[str, list[tuple[float, float]]] = {}
    recent = [b for b in briefs if b.get("llm")][:days]
    for i, b in enumerate(recent):
        w = 1.0 / (1 + 0.35 * i)
        for sig in b["llm"].get("theme_signals", []):
            s = float(sig.get("strength") or 0.5)
            v = s if sig["direction"] == "bullish" else -s if sig["direction"] == "bearish" else 0.0
            acc.setdefault(sig["theme_id"], []).append((v, w))
    out = {}
    for tid, pairs in acc.items():
        num = sum(v * w for v, w in pairs)
        den = sum(w for _, w in pairs)
        out[tid] = r(50 + 50 * (num / den if den else 0), 0)
    return out
