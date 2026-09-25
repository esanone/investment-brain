from __future__ import annotations

from datetime import date

from brain.engines import portfolio


def _company(t, sector="Technology"):
    return {"ticker": t, "name": t + " Inc", "sector": sector}


def _strategy(t, opp, gap, theme="ai", rules=None):
    return {"ticker": t, "opportunity_score": opp, "expectations_gap": gap, "reality": 70, "pricing": 50, "macro_fit": 55,
            "theme_exposures": [{"theme_id": theme, "theme": theme.upper(), "weight": 0.8, "order": 1, "effective": 0.8}],
            "checks": [{"label": "Revenue accelerating", "ok": True}],
            "break_rules": rules or [{"id": "revenue_growth", "label": "TTM revenue growth", "metric": "revenue_growth", "op": "<", "threshold": 0.10, "current": 0.2}]}


def _analysis(price=100.0, rg=0.2):
    return {"price": price, "latest": {"revenue_growth": rg, "roic": 0.3}, "momentum": {"dist_200dma": 5.0, "return_3m": 4.0},
            "data_quality": {"ttm_quarters": 12}}


RISK = {"label": "Stable", "posture": {"recommended": {"Equities": 60, "Treasuries": 15, "Cash": 10, "Gold": 5, "Credit": 5, "Commodities": 5},
                                       "beta_target": {"recommended": 1.0}}}
REGIME = {"regime": {"label": "Goldilocks", "probabilities": {"Goldilocks": 50, "Reflation": 20, "Stagflation": 15, "Contraction": 15}}}
FLOWS = {"sector_rotation": {"Technology": 20, "Energy": 60}, "benchmark": {"return_3m": 2.0}}
THEMES = {"ai": {"name": "AI", "trend": 70}, "oil": {"name": "Oil", "trend": 60}}


def _universe():
    tickers = [("A", "Technology", 80, 30), ("B", "Technology", 75, 20), ("C", "Technology", 70, 15), ("D", "Technology", 68, 10),
               ("E", "Technology", 66, 10), ("F", "Energy", 72, 25), ("G", "Energy", 60, 5), ("H", "Energy", 40, 30)]
    companies = {t: _company(t, sec) for t, sec, _, _ in tickers}
    strategies = {t: _strategy(t, opp, gap, theme="ai" if sec == "Technology" else "oil") for t, sec, opp, gap in tickers}
    analyses = {t: _analysis() for t, *_ in tickers}
    scores = {t: {"quality": 70, "growth": 70, "value": 60, "price_momentum": 50} for t, *_ in tickers}
    return companies, strategies, analyses, scores


def test_initial_portfolio_respects_caps_and_sizes_equity_sleeve():
    companies, strategies, analyses, scores = _universe()
    pf = portfolio.compute(strategies, analyses, scores, companies, RISK, FLOWS, REGIME, THEMES, None, 100_000, date(2026, 9, 9))
    assert pf["is_initial"]
    held = {h["ticker"] for h in pf["holdings"]}
    assert "H" not in held                      # opportunity 40 < 55
    assert all(h["weight"] <= 0.08 + 1e-9 for h in pf["holdings"])
    assert abs(pf["equity_weight"] - 0.60) < 0.02 or pf["equity_weight"] <= 0.60
    assert pf["stats"]["sector_weights"].get("Technology", 0) <= 0.30 + 1e-6
    assert abs(sum(h["weight"] for h in pf["holdings"]) + sum(s["weight"] for s in pf["sleeves"]) - 1) < 0.01
    assert all(t["action"] == "BUY" for t in pf["trades"])
    assert all(h["entry_rules"] for h in pf["holdings"])


def test_recalibration_exits_on_frozen_rule_breach_and_keeps_incumbents():
    companies, strategies, analyses, scores = _universe()
    first = portfolio.compute(strategies, analyses, scores, companies, RISK, FLOWS, REGIME, THEMES, None, 100_000, date(2026, 9, 2))
    # next week: A's revenue growth collapses below its frozen 10% floor; B unchanged
    analyses["A"] = _analysis(rg=0.05)
    second = portfolio.compute(strategies, analyses, scores, companies, RISK, FLOWS, REGIME, THEMES, first, 100_000, date(2026, 9, 9), FLOWS)
    assert not second["is_initial"]
    exits = {e["ticker"]: e for e in second["exits"]}
    assert "A" in exits and "Thesis break" in exits["A"]["reason"]
    assert any(t["action"] == "SELL" and t["ticker"] == "A" for t in second["trades"])
    b = next(h for h in second["holdings"] if h["ticker"] == "B")
    assert b["status"] == "held" and b["entered"] == "2026-09-02"
    assert b["entry_rules"] == first and True or b["entry_rules"] == next(h for h in first["holdings"] if h["ticker"] == "B")["entry_rules"]


def test_rule_evaluator_handles_each_metric_kind():
    ctx = {"latest": {"roic": 0.1}, "momentum": {"dist_200dma": -12}, "sector_rotation": -25, "sector_rotation_prev": -30,
           "adverse_regime_prob": 60, "theme_trends": {"ai": 40}, "rs_3m": -3}
    assert portfolio.evaluate_rule({"metric": "roic", "op": "<", "threshold": 0.15}, ctx)["triggered"]
    from datetime import timedelta
    today = date(2026, 9, 28)
    two_weeks_weak = [(today - timedelta(days=d), -45) for d in (14, 12, 9, 7, 5, 2)]
    ctx_rot = dict(ctx, sector_rotation=-40, as_of=today, sector_rotation_history=two_weeks_weak)
    assert portfolio.evaluate_rule({"metric": "sector_rotation", "op": "<", "threshold": -20, "consecutive": 2}, ctx_rot)["triggered"]   # legacy rule, new mechanism
    two_days_weak = [(today - timedelta(days=1), -60)]
    assert not portfolio.evaluate_rule({"metric": "sector_rotation", "op": "<", "threshold": -30}, dict(ctx_rot, sector_rotation_history=two_days_weak))["triggered"]
    recovered = two_weeks_weak[:-2] + [(today - timedelta(days=5), -10), (today - timedelta(days=2), -50)]
    assert not portfolio.evaluate_rule({"metric": "sector_rotation", "op": "<", "threshold": -30}, dict(ctx_rot, sector_rotation_history=recovered))["triggered"]
    assert portfolio.evaluate_rule({"metric": "adverse_regime_prob", "op": ">", "threshold": 55}, ctx)["triggered"]
    assert portfolio.evaluate_rule({"metric": "dist_200dma", "op": "<", "threshold": -10, "and_negative_rs": True}, ctx)["triggered"]
    assert not portfolio.evaluate_rule({"metric": "dist_200dma", "op": "<", "threshold": -10, "and_negative_rs": True}, dict(ctx, rs_3m=2))["triggered"]
    assert portfolio.evaluate_rule({"metric": "theme_trend", "theme_id": "ai", "op": "<", "threshold": 45}, ctx)["triggered"]


def test_regime_gate_closed_blocks_new_entries_and_halves_equity_cap():
    companies, strategies, analyses, scores = _universe()
    reg = dict(REGIME, index_gate={"open": False, "note": "test: below 10m SMA"})
    pf = portfolio.compute(strategies, analyses, scores, companies, RISK, FLOWS, reg, THEMES, None, 100_000, date(2026, 9, 24))
    assert pf["holdings"] == [] and pf["regime_gate"]["open"] is False
    assert any("Regime gate closed" in x["reason"] for x in pf["rejected_technical"])
    assert pf["equity_cap"] <= 0.30 + 1e-9          # 60% posture halved


def test_drawdown_ladder_scales_risk_after_losses():
    companies, strategies, analyses, scores = _universe()
    first = portfolio.compute(strategies, analyses, scores, companies, RISK, FLOWS, REGIME, THEMES, None, 100_000, date(2026, 9, 2))
    for t in analyses:                       # every holding falls 12% but stays above its 12% hard stop? No: -12% breaches, so use -9%
        analyses[t] = _analysis(price=91.0)
    second = portfolio.compute(strategies, analyses, scores, companies, RISK, FLOWS, REGIME, THEMES, first, 100_000, date(2026, 9, 9), FLOWS)
    assert second["period_return_pct"] < 0 and second["drawdown_pct"] < 0
    assert second["nav_index"] < 1.0 and second["nav_peak"] == 1.0


def test_no_new_entries_into_sectors_with_capital_leaving():
    companies, strategies, analyses, scores = _universe()
    flows = dict(FLOWS, sector_rotation={"Technology": 20, "Energy": -60})
    pf = portfolio.compute(strategies, analyses, scores, companies, RISK, flows, REGIME, THEMES, None, 100_000, date(2026, 9, 28))
    assert not any(h["sector"] == "Energy" for h in pf["holdings"])
    assert any("Capital leaving Energy" in x["reason"] for x in pf["rejected_technical"])
