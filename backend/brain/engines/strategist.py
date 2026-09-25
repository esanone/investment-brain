"""Investment Strategist — "What appears materially underappreciated by the market?"

Combines regime, flows, fundamentals and themes into:
  * Opportunity Score (spec weights; unavailable Phase-2 inputs are renormalised and disclosed)
  * Reality / Narrative / Pricing scores and the Expectations Gap (Reality - Pricing,
    minus Narrative once the Narrative engine exists)
  * a deterministic thesis: why the model likes it, what the market appears to expect,
    what it may be missing, catalysts, risks and explicit thesis-break conditions.
"""
from __future__ import annotations

from typing import Optional

from .common import r, wmean
from .regime import REGIME_BENEFICIARIES

WEIGHTS = {
    "structural_trend": 0.20, "capital_flow": 0.10, "acceleration": 0.15, "quality": 0.15, "valuation": 0.15,
    "estimate_revisions": 0.10, "management_commentary": 0.05, "narrative_acceleration": 0.05, "insider_institutional": 0.05,
}
PHASE2 = {"estimate_revisions": "Estimate-revision feed (Phase 2)", "management_commentary": "Earnings Intelligence Engine (Phase 2)",
          "narrative_acceleration": "Narrative Intelligence Engine (Phase 2)", "insider_institutional": "Form 4 / 13F ingestion (Phase 2)"}

REGIME_SECTOR_FIT = {
    "Goldilocks": {"Technology": 80, "Communication Services": 75, "Consumer Discretionary": 75, "Industrials": 60, "Financials": 60,
                   "Health Care": 55, "Real Estate": 60, "Materials": 50, "Energy": 40, "Consumer Staples": 40, "Utilities": 40},
    "Reflation": {"Energy": 85, "Materials": 80, "Industrials": 80, "Financials": 75, "Consumer Discretionary": 55, "Technology": 50,
                  "Communication Services": 45, "Health Care": 45, "Real Estate": 45, "Consumer Staples": 40, "Utilities": 35},
    "Stagflation": {"Energy": 85, "Consumer Staples": 75, "Utilities": 70, "Health Care": 70, "Materials": 60, "Industrials": 45,
                    "Financials": 40, "Technology": 35, "Communication Services": 35, "Consumer Discretionary": 30, "Real Estate": 40},
    "Contraction": {"Consumer Staples": 80, "Utilities": 80, "Health Care": 75, "Real Estate": 55, "Technology": 45, "Communication Services": 45,
                    "Financials": 35, "Industrials": 35, "Consumer Discretionary": 30, "Materials": 30, "Energy": 30},
}


def _pct(x: Optional[float], nd: int = 1) -> str:
    return "n/a" if x is None else f"{x * 100:+.{nd}f}%"


def _macro_fit(sector: str, regime: dict) -> Optional[float]:
    probs = regime.get("regime", {}).get("probabilities", {})
    if not probs:
        return None
    return sum(REGIME_SECTOR_FIT[k].get(sector, 50) * v / 100 for k, v in probs.items())


def compute(company: dict, analysis: dict, scores: dict, exposures: list[dict], themes_by_id: dict[str, dict],
            regime: dict, flows: dict) -> dict:
    t, sector = company["ticker"], company["sector"]
    L, V, M = analysis["latest"], analysis["valuation"], analysis["momentum"]

    # ---- component scores (0..100)
    theme_pairs = [(themes_by_id[e["theme_id"]]["trend"], e["effective"]) for e in exposures if e["theme_id"] in themes_by_id]
    structural = wmean(theme_pairs)
    theme_pricing = wmean([(themes_by_id[e["theme_id"]]["pricing"], e["effective"]) for e in exposures if e["theme_id"] in themes_by_id])
    sector_rot = flows.get("sector_rotation", {}).get(sector)
    capital_flow = wmean([(None if sector_rot is None else (sector_rot + 100) / 2, 0.5), (scores.get("price_momentum"), 0.5)])
    components = {
        "structural_trend": structural, "capital_flow": capital_flow, "acceleration": scores.get("acceleration"),
        "quality": scores.get("quality"), "valuation": scores.get("value"),
        "estimate_revisions": None, "management_commentary": None, "narrative_acceleration": None, "insider_institutional": None,
    }
    avail = {k: v for k, v in components.items() if v is not None}
    coverage = sum(WEIGHTS[k] for k in avail)
    opportunity = sum(v * WEIGHTS[k] for k, v in avail.items()) / coverage if coverage else None

    macro_fit = _macro_fit(sector, regime)
    reality = wmean([(scores.get("reality"), 0.6), (macro_fit, 0.15), (capital_flow, 0.25)])
    # Narrative = exposure-weighted theme narrative from the Morning Brief engine (None until briefs exist)
    narrative = wmean([(themes_by_id[e["theme_id"]].get("narrative"), e["effective"]) for e in exposures
                       if e["theme_id"] in themes_by_id and themes_by_id[e["theme_id"]].get("narrative") is not None])
    pricing = wmean([(scores.get("pricing"), 0.7), (theme_pricing, 0.3)])
    gap = None if reality is None or pricing is None else reality - pricing

    # ---- "why the model likes it" checklist (deterministic, evidence-backed)
    rg, ra = L.get("revenue_growth"), L.get("revenue_acceleration")
    checks = [
        {"label": "Revenue accelerating", "ok": bool(ra is not None and ra > 0.005), "evidence": f"TTM growth {_pct(rg)} vs {_pct(L.get('revenue_growth_prev'))} prior quarter"},
        {"label": "FCF improving", "ok": bool((L.get("fcf_growth") or -1) > 0.05), "evidence": f"FCF growth {_pct(L.get('fcf_growth'))}, FCF margin {_pct(L.get('fcf_margin'))}"},
        {"label": "ROIC expanding", "ok": bool(L.get("incremental_roic") is not None and L.get("roic") is not None and L["incremental_roic"] > L["roic"]),
         "evidence": f"ROIC {_pct(L.get('roic'))}, incremental ROIC {_pct(L.get('incremental_roic'))}"},
        {"label": "Margins expanding", "ok": bool((L.get("operating_margin_change") or 0) > 0.003), "evidence": f"Operating margin {_pct(L.get('operating_margin'))} ({(L.get('operating_margin_change') or 0) * 1e4:+.0f} bps YoY)"},
        {"label": "Theme exposure strengthening", "ok": bool(structural is not None and structural >= 60), "evidence": f"Exposure-weighted theme trend {r(structural, 0)}"},
        {"label": "Capital rotating toward sector", "ok": bool(sector_rot is not None and sector_rot > 15), "evidence": f"{sector} rotation score {sector_rot:+.0f}" if sector_rot is not None else "no sector ETF"},
        {"label": "Valuation below own history", "ok": bool((V.get("cheapness_vs_history") or 0) >= 55), "evidence": f"Cheapness vs 5y history {V.get('cheapness_vs_history')}/100"},
        {"label": "Valuation below sector peers", "ok": bool((scores.get("value") or 0) >= 55), "evidence": f"Sector-relative value score {scores.get('value')}"},
        {"label": "Balance sheet strong", "ok": bool((L.get("net_debt_to_ebitda") is None and (L.get('net_debt') or 0) <= 0) or (L.get("net_debt_to_ebitda") or 0) < 1.5),
         "evidence": f"Net debt/EBITDA {r(L.get('net_debt_to_ebitda'), 1) if L.get('net_debt_to_ebitda') is not None else 'n/a'}"},
        {"label": "Not diluting shareholders", "ok": bool((L.get("dilution") or 0) <= 0.01), "evidence": f"Diluted share count {_pct(L.get('dilution'))} YoY"},
        {"label": "Analyst estimates moving higher", "ok": None, "evidence": "Estimate-revision feed not connected (Phase 2)"},
        {"label": "Management guidance increasing", "ok": None, "evidence": "Earnings Intelligence Engine not built (Phase 2)"},
    ]

    # ---- what the market appears to expect (from multiples)
    exp_lines = []
    if V.get("ev_sales"):
        exp_lines.append(f"EV/Sales {V['ev_sales']:.1f}x" + (f" ({V['percentile_vs_history'].get('ev_sales')}th pct of own 5y range)" if V.get("percentile_vs_history", {}).get("ev_sales") is not None else ""))
    if V.get("pe"):
        exp_lines.append(f"P/E {V['pe']:.0f}x" + (f" ({V['percentile_vs_history'].get('pe')}th pct of own history)" if V.get("percentile_vs_history", {}).get("pe") is not None else ""))
    if V.get("fcf_yield") is not None:
        exp_lines.append(f"FCF yield {V['fcf_yield'] * 100:.1f}%")
    if V.get("peg"):
        exp_lines.append(f"PEG {V['peg']:.1f}")
    rich = (scores.get("pricing") or 50)
    if rich >= 70:
        expectation = "Priced for sustained high growth and margin expansion; little room for disappointment."
    elif rich >= 50:
        expectation = "Priced roughly in line with its own history and peers; the market expects the current trajectory to continue."
    else:
        expectation = "Priced for stagnation or deterioration; the market is not paying for improvement."
    if M.get("return_12m") is not None:
        exp_lines.append(f"12m return {M['return_12m']:+.0f}%, {M.get('pct_from_52w_high', 0):+.0f}% from 52w high")

    # ---- what the market may be missing (only where evidence supports it)
    missing = []
    if gap is not None and gap >= 10:
        missing.append(f"Reality ({r(reality, 0)}) is running ahead of what is priced ({r(pricing, 0)}): an expectations gap of {gap:+.0f} pts.")
    if ra and ra > 0.01 and rich < 60:
        missing.append(f"Revenue growth is accelerating ({_pct(rg)} TTM, {ra * 100:+.1f} pts) while the multiple has not re-rated.")
    if (L.get("operating_margin_change") or 0) > 0.01 and (scores.get("value") or 0) > 50:
        missing.append("Operating leverage is showing up in margins faster than in the valuation.")
    if structural and structural >= 65 and theme_pricing and theme_pricing < structural - 10:
        top = max(exposures, key=lambda e: e["effective"]) if exposures else None
        if top:
            missing.append(f"Its main theme ({top['theme']}) has trend {themes_by_id[top['theme_id']]['trend']} vs pricing {themes_by_id[top['theme_id']]['pricing']}: the theme itself is under-owned.")
    if sector_rot is not None and sector_rot > 20 and (scores.get("price_momentum") or 50) < 50:
        missing.append(f"Capital is rotating into {sector} ({sector_rot:+.0f}) but this stock has not yet participated.")
    if not missing:
        missing.append("No clear expectations gap: the market appears to have priced what the fundamentals show." if (gap or 0) < 5
                        else "Modest gap; monitor for acceleration before it is recognised.")

    # ---- catalysts / risks / break conditions
    catalysts = ["Next quarterly report (roughly 90 days after the last filing on " + str(L.get("filed"))[:10] + ")"]
    for e in exposures[:2]:
        th = themes_by_id.get(e["theme_id"], {})
        for c in th.get("constraints", [])[:1]:
            catalysts.append(f"{th['name']}: evidence that '{c.get('constraint')}' is easing via {c.get('solution')}")
    if sector_rot is not None and sector_rot > 0:
        catalysts.append(f"Continued rotation into {sector}")

    regime_label = regime.get("regime", {}).get("label")
    risks = []
    if regime_label and sector not in REGIME_SECTOR_FIT.get(regime_label, {}) or (macro_fit or 50) < 45:
        risks.append(f"Sector is not a natural beneficiary of the current regime ({regime_label}); macro fit {r(macro_fit, 0)}/100.")
    if (L.get("net_debt_to_ebitda") or 0) > 3:
        risks.append(f"Leverage: net debt/EBITDA {L['net_debt_to_ebitda']:.1f}x.")
    if rich >= 75:
        risks.append("Valuation leaves little room for execution slips.")
    if (L.get("dilution") or 0) > 0.03:
        risks.append(f"Share count rising {_pct(L.get('dilution'))} YoY.")
    if (L.get("sbc_pct_revenue") or 0) > 0.15:
        risks.append(f"Stock-based compensation is {L['sbc_pct_revenue'] * 100:.0f}% of revenue.")
    if analysis["data_quality"]["ttm_quarters"] < 8:
        risks.append("Short reported history: fewer than 8 TTM observations.")
    if not risks:
        risks.append("No engine-flagged risks; standard execution and macro risk apply.")

    # Thesis-break conditions: human-readable text plus machine-evaluable rules.
    # Rules are frozen at portfolio entry and re-evaluated every run by the Portfolio engine.
    breaks, rules = [], []
    if rg is not None:
        floor = rg * 100 - max(5.0, abs(rg * 100) * 0.3)
        breaks.append(f"TTM revenue growth falls below {floor:.0f}% (currently {rg * 100:.1f}%)")
        rules.append({"id": "revenue_growth", "label": "TTM revenue growth", "metric": "revenue_growth", "op": "<", "threshold": round(floor / 100, 4), "current": round(rg, 4)})
    if L.get("roic") is not None:
        floor = L['roic'] * 100 - max(4.0, abs(L['roic'] * 100) * 0.25)
        breaks.append(f"ROIC falls below {floor:.0f}% (currently {L['roic'] * 100:.1f}%)")
        rules.append({"id": "roic", "label": "ROIC", "metric": "roic", "op": "<", "threshold": round(floor / 100, 4), "current": round(L["roic"], 4)})
    if L.get("operating_margin") is not None:
        # relative to the entry reading: a name already compressing at entry must compress a further 200 bps to break
        m_now = L.get("operating_margin_change") or 0.0
        m_thr = round(min(-0.02, m_now - 0.02), 4)
        breaks.append(f"Operating margin YoY change falls below {m_thr * 100:+.1f} pts (currently {m_now * 100:+.1f} pts)")
        rules.append({"id": "margin", "label": "Operating margin change YoY", "metric": "operating_margin_change", "op": "<", "threshold": m_thr, "current": L.get("operating_margin_change")})
    if sector_rot is not None:
        breaks.append(f"{sector} rotation score stays below -30 for two consecutive weeks (currently {sector_rot:+.0f})")
        rules.append({"id": "rotation", "label": f"{sector} rotation score", "metric": "sector_rotation", "op": "<", "threshold": -30, "consecutive_weeks": 2, "current": sector_rot})
    breaks.append("Adverse regime (Stagflation + Contraction) probability exceeds 55%")
    rules.append({"id": "regime", "label": "P(Stagflation)+P(Contraction)", "metric": "adverse_regime_prob", "op": ">", "threshold": 55,
                  "current": sum(regime.get("regime", {}).get("probabilities", {}).get(k, 0) for k in ("Stagflation", "Contraction"))})
    if M.get("dist_200dma") is not None:
        breaks.append("Price closes >10% below its 200-day average with negative relative strength")
        rules.append({"id": "trend", "label": "Distance from 200dma", "metric": "dist_200dma", "op": "<", "threshold": -10, "and_negative_rs": True, "current": M.get("dist_200dma")})
    if exposures:
        breaks.append(f"{exposures[0]['theme']} theme trend drops below 45")
        rules.append({"id": "theme", "label": f"{exposures[0]['theme']} theme trend", "metric": "theme_trend", "theme_id": exposures[0]["theme_id"], "op": "<", "threshold": 45,
                      "current": themes_by_id.get(exposures[0]["theme_id"], {}).get("trend")})

    thesis = (f"{company['name']} ({t}) screens at opportunity {r(opportunity, 0)} with an expectations gap of {r(gap, 0)}. "
              f"Reality {r(reality, 0)} reflects {_pct(rg)} TTM revenue growth, {_pct(L.get('operating_margin'))} operating margin and {_pct(L.get('roic'))} ROIC; "
              f"pricing {r(pricing, 0)} reflects {'a rich' if rich >= 65 else 'a fair' if rich >= 40 else 'a depressed'} multiple and "
              f"{'strong' if (scores.get('price_momentum') or 50) >= 65 else 'weak' if (scores.get('price_momentum') or 50) <= 35 else 'neutral'} price momentum. "
              + (f"Primary theme exposure: {exposures[0]['theme']} (trend {themes_by_id[exposures[0]['theme_id']]['trend']}). " if exposures and exposures[0]['theme_id'] in themes_by_id else "")
              + f"Macro fit for {sector} in a {regime_label} regime is {r(macro_fit, 0)}/100.")

    return {
        "ticker": t,
        "opportunity_score": r(opportunity, 0),
        "components": {k: r(v, 0) for k, v in components.items()},
        "weights": WEIGHTS, "coverage": r(coverage, 2),
        "unavailable": PHASE2,
        "reality": r(reality, 0), "narrative": r(narrative, 0), "pricing": r(pricing, 0), "expectations_gap": r(gap, 0),
        "macro_fit": r(macro_fit, 0), "sector_rotation": sector_rot, "theme_pricing": r(theme_pricing, 0),
        "checks": checks,
        "thesis": thesis,
        "market_expectation": {"summary": expectation, "evidence": exp_lines},
        "what_market_misses": missing,
        "catalysts": catalysts, "risks": risks, "thesis_break_conditions": breaks, "break_rules": rules,
        "narrative_note": ("Narrative from the last 7 morning briefs' theme signals (exposure-weighted)." if narrative is not None
                           else "Narrative not yet measured: generate morning briefs (needs an LLM key) to populate it. Gap = Reality - Pricing."),
        "llm_enriched": False,
    }
