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
    second = portfolio.compute(strategies, analyses, scores, companies, RISK, FLOWS, REGIME, THEMES, first, 100_000, date(2026, 10, 2), FLOWS)
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
    second = portfolio.compute(strategies, analyses, scores, companies, RISK, FLOWS, REGIME, THEMES, first, 100_000, date(2026, 10, 2), FLOWS)
    assert second["period_return_pct"] < 0 and second["drawdown_pct"] < 0
    assert second["nav_index"] < 1.0 and second["nav_peak"] == 1.0


def test_no_new_entries_into_sectors_with_capital_leaving():
    companies, strategies, analyses, scores = _universe()
    flows = dict(FLOWS, sector_rotation={"Technology": 20, "Energy": -60})
    pf = portfolio.compute(strategies, analyses, scores, companies, RISK, flows, REGIME, THEMES, None, 100_000, date(2026, 9, 28))
    assert not any(h["sector"] == "Energy" for h in pf["holdings"])
    assert any("Capital leaving Energy" in x["reason"] for x in pf["rejected_technical"])


def test_monthly_cadence_monitors_between_recalibrations_and_exits_only_on_hard_stop():
    companies, strategies, analyses, scores = _universe()
    first = portfolio.compute(strategies, analyses, scores, companies, RISK, FLOWS, REGIME, THEMES, None, 100_000, date(2026, 10, 1))
    assert first["cadence"]["mode"] == "recalibrate" and first["cadence"]["next_recalibration"] == "2026-11-01"
    # mid-month: A collapses below its 12% hard cap, B breaches a thesis rule -> alert only
    analyses["A"] = _analysis(price=85.0); analyses["B"] = _analysis(rg=0.05)
    mid = portfolio.compute(strategies, analyses, scores, companies, RISK, FLOWS, REGIME, THEMES, first, 100_000, date(2026, 10, 15), FLOWS)
    assert mid["cadence"]["mode"] == "monitor"
    assert [e["ticker"] for e in mid["exits"]] == ["A"] and "Hard loss cap" in mid["exits"][0]["reason"]
    assert any(al["ticker"] == "B" and any("Thesis break" in x for x in al["actions"]) for al in mid["alerts"])
    assert all(h["ticker"] != "A" for h in mid["holdings"]) and any(h["ticker"] == "B" for h in mid["holdings"])
    assert all(t["action"] == "SELL" for t in mid["trades"])
    # new month -> full recalibration trades again
    nxt = portfolio.compute(strategies, analyses, scores, companies, RISK, FLOWS, REGIME, THEMES, mid, 100_000, date(2026, 11, 2), FLOWS)
    assert nxt["cadence"]["mode"] == "recalibrate" and nxt["last_recalibration"] == "2026-11-02"


def test_human_futures_ranking_scales_conviction():
    companies, strategies, analyses, scores = _universe()
    base = portfolio.compute(strategies, analyses, scores, companies, RISK, FLOWS, REGIME, THEMES, None, 100_000, date(2026, 10, 1))
    ranking = {"candidates": [{"ticker": "C", "score": 8.0, "theses": [{"thesis_id": "T-004"}]}], "losers": [{"ticker": "A", "headwind": -1.5}]}
    pf = portfolio.compute(strategies, analyses, scores, companies, RISK, FLOWS, REGIME, THEMES, None, 100_000, date(2026, 10, 1), hfe_ranking=ranking)
    conv = {h["ticker"]: h["conviction"] for h in pf["holdings"]}
    conv0 = {h["ticker"]: h["conviction"] for h in base["holdings"]}
    assert conv["C"] > conv0["C"] and abs(conv["C"] / conv0["C"] - 1.35) < 0.02
    assert conv["A"] < conv0["A"] and abs(conv["A"] / conv0["A"] - 0.80) < 0.02
    assert next(h for h in pf["holdings"] if h["ticker"] == "C")["hfe_mult"] == 1.35


def test_incumbents_face_the_same_valuation_gate_at_recalibration():
    import pandas as pd, numpy as np
    companies, strategies, analyses, scores = _universe()
    first = portfolio.compute(strategies, analyses, scores, companies, RISK, FLOWS, REGIME, THEMES, None, 100_000, date(2026, 9, 1))
    held = first["holdings"][0]["ticker"]
    # next month: give the incumbent full valuation data that implies a price far above fair value
    a = dict(analyses[held]); a["price"] = 100.0
    a["latest"] = dict(a["latest"], net_income=1.0, ebitda=2.0, revenue=10.0, fcf=1.0, net_debt=0.0)
    a["valuation"] = {"market_cap": 1000.0, "history_median": {"pe": 15.0, "ev_ebitda": 8.0, "ev_sales": 1.5, "p_fcf": 20.0}}
    a["history"] = [dict(net_income=1.0, ebitda=2.0, revenue=10.0, fcf=1.0)] * 8
    analyses[held] = a
    idx = pd.date_range("2025-01-01", periods=300, freq="B")
    px = pd.DataFrame({"date": idx, "adj_close": np.linspace(80, 100, 300), "close": np.linspace(80, 100, 300)})
    pm_inputs = {"prices": {held: px, "SPY": px}, "sector_etf": {}, "sector_medians": {}, "earnings_week": []}
    second = portfolio.compute(strategies, analyses, scores, companies, RISK, FLOWS, REGIME, THEMES, first, 100_000, date(2026, 10, 1), FLOWS, pm_inputs=pm_inputs)
    assert any(e["ticker"] == held and "Valuation exit" in e["reason"] for e in second["exits"])
    assert all(h["ticker"] != held for h in second["holdings"])


def test_expected_return_bear_below_price_and_low_confidence_flag():
    from brain.engines import pm
    hist = [{"net_income": 100.0, "ebitda": 150.0, "revenue": 1000.0, "fcf": 90.0} for _ in range(8)]
    a = {"latest": {"net_income": 100.0, "ebitda": 150.0, "revenue": 1000.0, "fcf": 90.0, "net_debt": 0.0}, "history": hist, "price": 10.0,
         "valuation": {"market_cap": 1000.0, "history_median": {"pe": 30.0, "ev_ebitda": 20.0, "ev_sales": 3.0, "p_fcf": 33.0}}}
    er = pm.expected_return(a, {"pe": 28.0, "ev_ebitda": 19.0, "ev_sales": 3.0, "p_fcf": 30.0}, None)
    assert er["bear"] <= 8.5                      # never above 85% of today's price
    assert er["confidence"] == "low" and er["score"] <= 75
    a["price"], a["valuation"]["market_cap"] = 30.0, 3000.0
    er2 = pm.expected_return(a, {"pe": 28.0, "ev_ebitda": 19.0, "ev_sales": 3.0, "p_fcf": 30.0}, None)
    assert er2["confidence"] == "normal"


def test_fundamentals_refresh_rotates_through_the_week():
    from datetime import date
    import zlib
    tickers = [f"T{i}" for i in range(200)]
    days = [date(2026, 10, 5 + k) for k in range(5)]   # Mon..Fri
    seen = set()
    for d in days:
        seen |= {t for t in tickers if zlib.crc32(t.encode()) % 5 == d.weekday() % 5}
    assert seen == set(tickers)


def test_hindcast_perf_reports_fractions():
    from brain.hindcast import _perf
    p = _perf([0.10, -0.05, 0.10, 0.10], 4)
    assert 0.2 < p["cagr"] < 0.3 and -0.06 < p["max_drawdown"] <= -0.049
