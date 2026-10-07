from datetime import date

import numpy as np
import pandas as pd

from brain.engines import income_book as ib


def _px(start, end, n=300, up=True):
    d = pd.bdate_range(end=date(2026, 10, 6), periods=n)
    v = np.linspace(start, end, n)
    return pd.DataFrame({"date": d, "close": v, "adj_close": v})


def _world(dgs10_last=5.3, hy=3.1, tech=85, contraction=28):
    syms = ["SGOV", "USFR", "JAAA", "IEF", "LQD", "JEPQ", "JEPI", "MLPX", "SCHD", "XLU", "PFF", "VNQ", "HYG"]
    prices = {s: _px(90, 100) for s in syms}
    for s in ("XLU", "PFF", "VNQ"):
        prices[s] = _px(100, 85)                 # rate-sensitive income below trend
    yields = {s: {"yield_ttm_pct": 5.0, "yield_forward_pct": 5.0, "frequency": "monthly", "pay_months": list(range(1, 13)), "last_amount": 0.4} for s in syms}
    yields["MLPX"] = {**yields["MLPX"], "frequency": "quarterly", "pay_months": [2, 5, 8, 11]}
    instruments = [{"symbol": s, "name": s, "group": "income"} for s in syms]
    macro = {"DGS10": pd.Series(np.r_[np.full(199, 5.0), dgs10_last], index=pd.bdate_range(end=date(2026, 10, 6), periods=200)),
             "BAMLH0A0HYM2": pd.Series([hy], index=[pd.Timestamp("2026-10-02")])}
    regime = {"regime": {"label": "Goldilocks", "probabilities": {"Contraction": contraction}}, "index_gate": {"open": True, "note": "open"}}
    flows = {"groups": {"sector": [{"symbol": "XLK", "score": tech}]}}
    return prices, instruments, yields, regime, flows, {"label": "Stable"}, macro


def test_targets_and_calendar():
    out = ib.compute(*_world(), None, 100000.0, date(2026, 10, 6))
    w = {h["symbol"]: h["weight"] for h in out["holdings"]}
    assert abs(sum(w.values()) - 1.0) < 1e-6
    assert w["SGOV"] > 0.24                       # 15% target + 10% reserve
    assert "XLU" not in w and "HYG" not in w       # triggers inactive
    assert out["income"]["blended_yield_pct"] == 5.0 and len(out["income"]["by_month"]) == 12
    assert out["reinvest"]["recommendation"] == "reinvest"


def test_triggers_move_reserve_and_cut_covered_calls():
    out = ib.compute(*_world(dgs10_last=4.5, hy=5.0, tech=-20), None, 100000.0, date(2026, 10, 6))
    w = {h["symbol"]: h["weight"] for h in out["holdings"]}
    active = {t["id"] for t in out["triggers"] if t["active"]}
    assert {"duration_add", "hy_add", "covered_call_cut"} <= active
    assert w["IEF"] > 0.19 or w.get("HYG", 0) == 0.10     # the reserve funds triggers in order until it runs out
    assert w["JEPQ"] == 0.06 and w["JEPI"] == 0.05


def test_below_trend_equity_income_parks_in_tbills():
    prices, inst, yields, regime, flows, risk, macro = _world()
    prices["JEPQ"] = _px(100, 85)
    out = ib.compute(prices, inst, yields, regime, flows, risk, macro, None, 100000.0, date(2026, 10, 6))
    w = {h["symbol"]: h["weight"] for h in out["holdings"]}
    assert "JEPQ" not in w and w["SGOV"] > 0.36


def test_monitor_mode_alerts_on_hard_stop():
    first = ib.compute(*_world(), None, 100000.0, date(2026, 10, 6))
    prices, inst, yields, regime, flows, risk, macro = _world()
    prices["MLPX"] = _px(100, 88)
    mon = ib.compute(prices, inst, yields, regime, flows, risk, macro, first, 100000.0, date(2026, 10, 20))
    assert mon["cadence"]["mode"] == "monitor" and mon["trades"] == []
    assert any("hard stop" in a["alert"] for a in mon["alerts"] if a["symbol"] == "MLPX")
