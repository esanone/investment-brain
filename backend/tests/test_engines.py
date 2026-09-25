"""Fast unit tests that need no network. Run: cd backend && .venv/bin/python -m pytest -q"""
from __future__ import annotations

from datetime import date

import numpy as np
import pandas as pd

from brain.data.edgar import extract_financials
from brain.engines import regime, strategist
from brain.engines.common import sigmoid_score, tanh_score, wmean


def _fact(val, start, end, filed, form="10-Q"):
    return {"val": val, "start": start, "end": end, "filed": filed, "form": form, "fy": 2024, "fp": "Q1"}


def _facts(metric_tag: str, rows: list[dict], unit="USD") -> dict:
    return {"cik": 1, "entityName": "Test", "facts": {"us-gaap": {metric_tag: {"units": {unit: rows}}}}}


def test_q4_is_fy_minus_three_quarters_and_ttm_sums():
    rows = [
        _fact(100, "2023-01-01", "2023-03-31", "2023-05-01"),
        _fact(110, "2023-04-01", "2023-06-30", "2023-08-01"),
        _fact(120, "2023-07-01", "2023-09-30", "2023-11-01"),
        _fact(480, "2023-01-01", "2023-12-31", "2024-02-15", form="10-K"),
        # comparative restated in a later filing must NOT override the earliest value
        _fact(999, "2023-01-01", "2023-03-31", "2024-05-01"),
    ]
    out = extract_financials(_facts("Revenues", rows))
    q = {f.period_end: f.value for f in out if f.metric == "revenue" and f.period_type == "Q"}
    assert q[date(2023, 3, 31)] == 100
    assert q[date(2023, 12, 31)] == 480 - 330
    ttm = {f.period_end: f.value for f in out if f.metric == "revenue" and f.period_type == "TTM"}
    assert ttm[date(2023, 12, 31)] == 480


def test_share_count_uses_average_semantics_and_latest_filing():
    rows = [
        _fact(1000, "2023-01-01", "2023-03-31", "2023-05-01"),
        _fact(1000, "2023-04-01", "2023-06-30", "2023-08-01"),
        _fact(1000, "2023-07-01", "2023-09-30", "2023-11-01"),
        _fact(1000, "2023-01-01", "2023-12-31", "2024-02-15", form="10-K"),
        # post-split restatement of Q1 in a later filing wins for per-share data
        _fact(10000, "2023-01-01", "2023-03-31", "2024-05-01"),
        _fact(10000, "2024-01-01", "2024-03-31", "2024-05-01"),
    ]
    out = extract_financials(_facts("WeightedAverageNumberOfDilutedSharesOutstanding", rows, unit="shares"))
    q = {f.period_end: f.value for f in out if f.metric == "shares_diluted" and f.period_type == "Q"}
    assert q[date(2023, 3, 31)] == 10000          # latest filing (split-adjusted)
    assert q[date(2023, 12, 31)] == 4 * 1000 - (10000 + 1000 + 1000)  # average semantics, not a flow


def test_regime_probabilities_sum_to_one_and_prefer_goldilocks_when_growth_up_inflation_down():
    idx = pd.date_range("2010-01-01", "2026-09-01", freq="MS")
    n = len(idx)
    macro = {
        "INDPRO": pd.Series(np.linspace(90, 110, n) + np.r_[np.zeros(n - 6), np.linspace(0, 4, 6)], index=idx),
        "CPIAUCSL": pd.Series(np.linspace(200, 320, n) * np.r_[np.ones(n - 12), np.linspace(1, 0.985, 12)], index=idx),
        "WALCL": pd.Series(np.linspace(2e6, 8e6, n), index=idx),
        "DGS10": pd.Series(np.linspace(3.5, 4.0, n), index=idx),
    }
    out = regime.compute(macro, date(2026, 9, 8))
    probs = out["regime"]["probabilities"]
    assert abs(sum(probs.values()) - 100) < 0.5
    assert set(probs) == {"Goldilocks", "Reflation", "Stagflation", "Contraction"}
    assert len(out["history"]) == 25


def test_strategist_renormalises_missing_phase2_weights():
    company = {"ticker": "T", "name": "Test Co", "sector": "Technology"}
    analysis = {"latest": {"revenue_growth": 0.2, "revenue_growth_prev": 0.15, "revenue_acceleration": 0.05, "fcf_growth": 0.1,
                           "roic": 0.3, "incremental_roic": 0.4, "operating_margin": 0.25, "operating_margin_change": 0.01,
                           "net_debt_to_ebitda": 0.5, "dilution": 0.0, "filed": "2026-08-01"},
                "valuation": {"cheapness_vs_history": 60, "ev_sales": 5.0, "pe": 20.0, "fcf_yield": 0.04, "percentile_vs_history": {}},
                "momentum": {"return_12m": 10.0, "pct_from_52w_high": -5.0, "dist_200dma": 3.0},
                "data_quality": {"ttm_quarters": 12}}
    scores = {"growth": 70, "quality": 80, "value": 60, "acceleration": 75, "price_momentum": 55, "reality": 74, "pricing": 45}
    themes = {"ai": {"trend": 70, "pricing": 50, "name": "AI", "constraints": []}}
    exposures = [{"theme_id": "ai", "theme": "AI", "weight": 0.8, "order": 1, "effective": 0.8}]
    reg = {"regime": {"label": "Goldilocks", "probabilities": {"Goldilocks": 60, "Reflation": 20, "Stagflation": 10, "Contraction": 10}}}
    flows = {"sector_rotation": {"Technology": 30}}
    out = strategist.compute(company, analysis, scores, exposures, themes, reg, flows)
    assert out["coverage"] == 0.75
    assert 0 <= out["opportunity_score"] <= 100
    assert out["expectations_gap"] == out["reality"] - out["pricing"]
    assert out["narrative"] is None
    assert any(c["ok"] is None for c in out["checks"])         # unmeasured checks are shown, not hidden
    assert len(out["thesis_break_conditions"]) >= 5


def test_common_helpers():
    assert sigmoid_score(0) == 50
    assert sigmoid_score(3) > 90
    assert tanh_score(0, 10) == 0
    assert wmean([(None, 1), (80, 1), (60, 3)]) == 65


def test_sic_to_sector_mapping():
    from brain.ondemand import sic_to_sector
    assert sic_to_sector(3674)[0] == "Technology"        # semiconductors
    assert sic_to_sector(3829)[0] == "Technology"        # measuring / semicap
    assert sic_to_sector(4911)[0] == "Utilities"
    assert sic_to_sector(6022)[0] == "Financials"
    assert sic_to_sector(6798)[0] == "Real Estate"
    assert sic_to_sector(2834)[0] == "Health Care"
    assert sic_to_sector(1311)[0] == "Energy"
    assert sic_to_sector(5411)[0] == "Consumer Staples"
    assert sic_to_sector(None)[0] == "Industrials"


def test_attention_series_stats_detects_acceleration_from_low_base():
    from brain.engines.attention import series_stats
    import pandas as pd, numpy as np
    idx = pd.date_range("2025-09-01", periods=380, freq="D")
    flat = pd.Series(100.0 + np.random.default_rng(0).normal(0, 3, 380), index=idx)
    rising = flat.copy(); rising.iloc[-7:] = 220.0
    a, b = series_stats(flat), series_stats(rising)
    assert a["score"] < 60 and abs(a["vs_28d_pct"]) < 10
    assert b["score"] > 85 and b["vs_28d_pct"] > 80 and b["z"] > 2
    assert series_stats(pd.Series([1.0, 2.0])) is None            # too short


def test_causal_posterior_is_computed_from_reference_class_and_evidence():
    from brain.engines import causal
    sims = {k: 0.8 for k in causal.SIM_DIMS}
    rec = {"analogues": [{"similarity": sims, "pattern_occurred": i < 8} for i in range(10)],
           "evidence": [{"direction": "supports", "strength": "strong", "quality": 0.9, "independence": 0.9},
                        {"direction": "contradicts", "strength": "strong", "quality": 0.9, "independence": 0.9}],
           "scenarios": {"bull": {"weight": 1}, "base": {"weight": 2}, "bear": {"weight": 1}}}
    causal.score(rec)
    p = rec["probability"]
    assert p["prior"] == 75.0                                  # (8+1)/(10+2)
    assert abs(p["posterior"] - p["prior"]) < 0.2              # equal and opposite evidence cancels in log-odds
    assert p["range_low"] < p["posterior"] < p["range_high"]
    assert rec["scenarios"]["base"]["probability"] == 50.0
    rec["evidence"][1]["retired"] = True
    causal.score(rec)
    assert rec["probability"]["posterior"] > 75.0             # retiring the contradiction moves it up
    resolved = causal.resolve(dict(rec), True)
    assert 0 <= resolved["brier"]["final"] <= 1 and resolved["status"] == "resolved"
