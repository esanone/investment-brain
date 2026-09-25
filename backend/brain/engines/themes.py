"""Theme Knowledge Graph — Trend strength vs what the market appears to price.

Theme Trend (reality) = exposure-weighted Reality of the companies carrying the theme
                        (+ capital-flow score of the theme's related ETFs).
Theme Pricing          = exposure-weighted Pricing of the same companies
                        (valuation richness, momentum, proximity to highs).
Expectations gap       = Trend - Pricing.  Stars mark Trend >> Pricing.
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

import yaml

from .common import r, wmean
from .fundamentals import ORDER_DECAY

STAR_GAP = 12.0


def load_graph(path: Optional[Path] = None) -> list[dict]:
    p = path or Path(__file__).resolve().parent.parent / "themes.yaml"
    return yaml.safe_load(p.read_text())["themes"]


def flatten(graph: list[dict]) -> tuple[list[dict], list[dict]]:
    """-> (theme rows, exposure rows) for persistence."""
    themes, exposures = [], []

    def walk(node: dict, parent: Optional[str]):
        themes.append({"id": node["id"], "name": node["name"], "parent_id": parent, "description": node.get("description"),
                       "human_needs": node.get("human_needs"), "horizon_years": node.get("horizon_years"),
                       "constraints": node.get("constraints"), "related_etfs": node.get("related_etfs")})
        for t, (w, order) in (node.get("exposures") or {}).items():
            exposures.append({"theme_id": node["id"], "ticker": t, "weight": float(w), "order": int(order)})
        for ch in node.get("children") or []:
            walk(ch, node["id"])

    for n in graph:
        walk(n, None)
    return themes, exposures


def _all_exposures(node: dict) -> dict[str, tuple[float, int]]:
    """Exposures of a node including its children (max weight per ticker)."""
    out: dict[str, tuple[float, int]] = {}
    for t, (w, order) in (node.get("exposures") or {}).items():
        if t not in out or w > out[t][0]:
            out[t] = (float(w), int(order))
    for ch in node.get("children") or []:
        for t, (w, order) in _all_exposures(ch).items():
            if t not in out or w > out[t][0]:
                out[t] = (w, order)
    return out


def _score_node(node: dict, scores: dict[str, dict], flows: dict, companies: dict[str, dict], narrative: Optional[dict] = None) -> dict:
    exp = _all_exposures(node)
    trend_pairs, pricing_pairs, growth_pairs, members = [], [], [], []
    for t, (w, order) in exp.items():
        s = scores.get(t)
        if not s:
            continue
        eff = w * ORDER_DECAY.get(order, 0.35)
        trend_pairs.append((s.get("reality"), eff))
        pricing_pairs.append((s.get("pricing"), eff))
        growth_pairs.append((s.get("growth"), eff))
        members.append({"ticker": t, "name": companies.get(t, {}).get("name", t), "weight": w, "order": order,
                        "reality": s.get("reality"), "pricing": s.get("pricing"), "growth": s.get("growth"),
                        "quality": s.get("quality"), "value": s.get("value")})
    members.sort(key=lambda m: (-m["weight"] * ORDER_DECAY.get(m["order"], 0.35)))
    company_trend = wmean(trend_pairs)
    # related ETF flow (map -100..100 -> 0..100)
    idx = {i["symbol"]: i for g in flows.get("groups", {}).values() for i in g}
    etf_scores = [(idx[e]["score"] + 100) / 2 for e in (node.get("related_etfs") or []) if e in idx]
    etf_flow = sum(etf_scores) / len(etf_scores) if etf_scores else None
    trend = wmean([(company_trend, 0.75), (etf_flow, 0.25)])
    pricing = wmean(pricing_pairs)
    gap = None if trend is None or pricing is None else trend - pricing
    return {
        "id": node["id"], "name": node["name"], "description": node.get("description"),
        "human_needs": node.get("human_needs") or [], "horizon_years": node.get("horizon_years"),
        "constraints": node.get("constraints") or [], "related_etfs": node.get("related_etfs") or [],
        "trend": r(trend, 0), "pricing": r(pricing, 0), "gap": r(gap, 0), "star": bool(gap is not None and gap >= STAR_GAP),
        "narrative": (narrative or {}).get(node["id"]),
        "company_trend": r(company_trend, 0), "etf_flow": r(etf_flow, 0), "growth": r(wmean(growth_pairs), 0),
        "n_companies": len(members), "members": members,
        "children": [_score_node(ch, scores, flows, companies, narrative) for ch in (node.get("children") or [])],
    }


def compute(graph: list[dict], scores: dict[str, dict], flows: dict, companies: dict[str, dict], narrative: Optional[dict] = None) -> list[dict]:
    out = [_score_node(n, scores, flows, companies, narrative) for n in graph]
    out.sort(key=lambda t: -(t["gap"] if t["gap"] is not None else -999))
    return out


def company_theme_exposure(graph: list[dict], ticker: str) -> list[dict]:
    """Top-level themes a company is exposed to, with effective weight."""
    out = []
    for n in graph:
        exp = _all_exposures(n)
        if ticker in exp:
            w, order = exp[ticker]
            out.append({"theme_id": n["id"], "theme": n["name"], "weight": w, "order": order, "effective": w * ORDER_DECAY.get(order, 0.35)})
    return sorted(out, key=lambda x: -x["effective"])
