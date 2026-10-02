from datetime import date

from brain.engines import thesis_book as tb


def _world():
    exp = lambda th, w: [{"theme_id": th, "theme": th.title(), "weight": w, "order": 1, "effective": w}]
    strategies = {"AAA": {"theme_exposures": exp("power", 0.8)}, "BBB": {"theme_exposures": exp("power", 0.7)}, "CCC": {"theme_exposures": exp("power", 0.8)},
                  "DDD": {"theme_exposures": exp("power", 0.8)}, "EEE": {"theme_exposures": []}, "FFF": {"theme_exposures": exp("retail", 0.8)}}
    companies = {t: {"name": t, "sector": "Industrials" if t != "DDD" else "Energy"} for t in strategies}
    analyses = {t: {"price": 100.0, "latest": {"filed": "2026-08-20"}} for t in strategies}
    tech_ok = {"ready": True, "score": 88, "passes": 7, "stage": "stage2_uptrend", "atr20": 3.0, "sma150": 80.0, "sma150_prev4w": 78.0}
    technicals = {t: dict(tech_ok) for t in strategies}
    technicals["CCC"] = {**tech_ok, "ready": False, "score": 50, "passes": 4, "stage": "basing_or_downtrend"}
    er = lambda bull: {"expected_return": {"bear": 60.0, "base": bull / 1.35, "bull": bull, "expected_return_pct": 0.0, "confidence": "normal"}}
    pm_detail = {"AAA": er(150.0), "BBB": er(90.0), "CCC": er(150.0), "DDD": er(150.0), "EEE": er(150.0), "FFF": er(150.0)}
    longterm = {"as_of": "2026-09-28", "theme_conviction": {"power": 0.9, "retail": 0.3},
                "structural_shifts": [{"shift": "Electricity is the binding constraint", "confidence": 0.85, "trend": "strengthening", "themes": ["power"]}]}
    briefs = [{"as_of": "2026-10-01", "llm": {"market_thesis": {"direction": "neutral", "confidence": 0.6, "long_term": "x"},
                                              "theme_signals": [{"theme_id": "power", "direction": "bullish", "strength": 0.8}],
                                              "ticker_signals": [{"ticker": "AAA", "direction": "bullish", "evidence": "orders"}]}}]
    records = [{"id": "T-1", "title": "Power", "status": "open", "horizon": "2032", "probability": {"posterior": 80.0},
                "value_pools": [{"layer": "generation", "becomes": "scarce", "tickers": ["AAA", "BBB", "CCC", "DDD"]},
                                {"layer": "old retail", "becomes": "loses_pricing_power", "tickers": ["FFF"]}]}]
    flows = {"sector_rotation": {"Industrials": 10, "Energy": -45}}
    regime = {"regime": {"label": "Goldilocks"}, "index_gate": {"open": True, "note": "open"}}
    risk = {"label": "Stable", "posture": {"recommended": {"Equities": 60}}}
    return strategies, analyses, companies, technicals, pm_detail, flows, regime, risk, longterm, briefs, records


def _run(prior=None, as_of=date(2026, 10, 1), **over):
    s, a, c, t, pmd, fl, rg, rk, lt, br, rec = _world()
    w = dict(strategies=s, analyses=a, companies=c, technicals=t, pm_detail=pmd, flows=fl, regime=rg, risk=rk, longterm=lt, briefs=br, records=rec)
    w.update(over)
    return tb.compute(w["strategies"], w["analyses"], w["companies"], w["technicals"], w["pm_detail"], w["flows"], w["regime"], w["risk"], w["longterm"], w["briefs"],
                      w["records"], {}, prior, 100000.0, as_of)


def test_thesis_first_then_bull_ceiling_then_gates():
    out = _run()
    status = {c["ticker"]: c["status"] for c in out["candidates"]}
    assert status["AAA"] == "selected"
    assert status["BBB"] == "above_bull"       # price 100 above bull 90: the only valuation exclusion
    assert status["CCC"] == "trend_gate"
    assert status["DDD"] == "sector_gate"      # Energy rotation -45
    assert "EEE" not in status and "FFF" not in status   # no thesis support / thesis headwind never reach the gates
    assert [h["ticker"] for h in out["holdings"]] == ["AAA"]
    assert out["funnel"]["favoured"] == 4 and out["funnel"]["selected"] == 1


def test_size_follows_thesis_probability_and_risk_cap():
    h = _run()["holdings"][0]
    assert 0.02 <= h["weight"] <= tb.RULES["max_weight"]
    assert h["weight"] <= tb.RULES["max_weight"] * h["thesis_probability"] + 1e-9
    assert h["valuation"]["position"] == "below_base" and h["stops"]["active_stop"] < 100


def test_market_gate_blocks_new_entries():
    s, a, c, t, pmd, fl, rg, rk, lt, br, rec = _world()
    out = _run(regime={"regime": {"label": "Contraction"}, "index_gate": {"open": False, "note": "closed"}})
    assert out["holdings"] == [] and out["funnel"]["market_gate"] >= 1


def test_monitor_mode_holds_and_exit_on_thesis_decay_next_month():
    first = _run()
    mon = _run(prior=first, as_of=date(2026, 10, 15))
    assert mon["cadence"]["mode"] == "monitor" and [h["ticker"] for h in mon["holdings"]] == ["AAA"] and mon["trades"] == []
    s, a, c, t, pmd, fl, rg, rk, lt, br, rec = _world()
    rec[0]["status"] = "resolved"                      # thesis closed: ledger support disappears
    lt = {"as_of": "2026-10-26", "theme_conviction": {"power": 0.2}, "structural_shifts": []}
    nxt = _run(prior=first, as_of=date(2026, 11, 2), records=rec, longterm=lt, briefs=[])
    assert nxt["cadence"]["mode"] == "recalibrate" and nxt["holdings"] == []
    assert "no longer favour" in nxt["exits"][0]["reason"]
