"""Capital Flow Engine — "Where is the money going?"

Phase 1 measures capital movement from price/volume behaviour of ETFs, which is
free and immediate: relative strength vs the S&P 500 at 1/3/6 months, RS acceleration,
relative dollar volume, and a net buying-pressure proxy. Everything maps to a
Capital Rotation Score in -100..+100. Actual fund-flow data (Intrinio ETF NAV/flows),
13F accumulation and insider filings plug into the same score later.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

import numpy as np
import pandas as pd

from .common import r, tanh_score, trailing_return

GROUP_ORDER = ["sector", "industry", "factor", "size", "region", "bond", "commodity", "crypto"]


def _dollar_volume(df: pd.DataFrame) -> pd.Series:
    return df["close"] * df["volume"]


def score_instrument(df: pd.DataFrame, bench: pd.DataFrame) -> Optional[dict]:
    if df is None or len(df) < 130 or bench is None or len(bench) < 130:
        return None
    px = df.set_index("date")["adj_close"]
    bx = bench.set_index("date")["adj_close"]
    joined = pd.concat([px.rename("p"), bx.rename("b")], axis=1).dropna()
    if len(joined) < 130:
        return None
    p, b = joined["p"], joined["b"]

    def rs(days: int) -> Optional[float]:
        a, c = trailing_return(p, days), trailing_return(b, days)
        return None if a is None or c is None else (a - c) * 100

    rs_1m, rs_3m, rs_6m = rs(21), rs(63), rs(126)
    ret_1m, ret_3m, ret_6m, ret_12m = (trailing_return(p, d) for d in (21, 63, 126, 252))
    # RS acceleration: recent month's RS vs the average monthly RS of the prior quarter
    rs_accel = None if rs_1m is None or rs_3m is None else rs_1m - (rs_3m - rs_1m) / 2.0

    dv = _dollar_volume(df.set_index("date")).reindex(joined.index).fillna(0)
    rel_volume = None
    if dv.iloc[-120:].mean() > 0:
        rel_volume = float(dv.iloc[-20:].mean() / dv.iloc[-120:].mean() - 1) * 100
    rets = p.pct_change()
    recent = dv.iloc[-20:]
    if recent.sum() > 0:
        money_flow = float((np.sign(rets.iloc[-20:]) * recent).sum() / recent.sum())  # -1..1
    else:
        money_flow = 0.0

    # Blend horizons on a comparable footing (scale each to ~quarterly magnitude)
    parts = [(rs_1m, 3.0 * 0.30), (rs_3m, 1.0 * 0.40), (rs_6m, 0.5 * 0.30)]
    blend = sum(v * w for v, w in parts if v is not None) / sum(w for v, w in parts if v is not None)
    raw = blend + 6.0 * money_flow + 0.05 * (rel_volume or 0.0)
    score = tanh_score(raw, scale=9.0)
    trend = "accelerating" if (rs_accel or 0) > 1.0 else "decelerating" if (rs_accel or 0) < -1.0 else "steady"
    above_200 = bool(p.iloc[-1] > p.iloc[-200:].mean()) if len(p) >= 200 else None
    return {
        "score": r(score, 0),
        "trend": trend,
        "rs_1m": r(rs_1m), "rs_3m": r(rs_3m), "rs_6m": r(rs_6m), "rs_accel": r(rs_accel),
        "return_1m": r((ret_1m or 0) * 100), "return_3m": r((ret_3m or 0) * 100),
        "return_6m": r((ret_6m or 0) * 100), "return_12m": r((ret_12m or 0) * 100) if ret_12m is not None else None,
        "rel_volume": r(rel_volume), "money_flow": r(money_flow, 2),
        "above_200dma": above_200,
        "last": r(float(p.iloc[-1]), 2), "last_date": joined.index[-1].date().isoformat(),
    }


def _sentences(groups: dict[str, list[dict]]) -> list[str]:
    out: list[str] = []
    sec = groups.get("sector", [])
    if sec:
        acc = [s["name"] for s in sec if s["trend"] == "accelerating" and s["score"] > 20]
        det = [s["name"] for s in sec if s["trend"] == "decelerating" and s["score"] < -20]
        if acc:
            out.append(f"{', '.join(acc[:3])} flows accelerating")
        if det:
            out.append(f"{', '.join(det[:3])} flows deteriorating")
    ind = groups.get("industry", [])
    tech = [i for i in ind if i.get("sector") == "Technology"]
    if len(tech) >= 2:
        out.append(" > ".join(i["name"] for i in sorted(tech, key=lambda x: -x["score"])[:3]))
    size = {s["name"]: s for s in groups.get("size", [])}
    if "Small Cap" in size:
        s = size["Small Cap"]
        out.append(f"Small-cap flows {'turning positive' if s['score'] > 10 else 'negative' if s['score'] < -10 else 'neutral'}")
    bonds = {b["name"]: b for b in groups.get("bond", [])}
    if "20+ Year Treasuries" in bonds:
        b = bonds["20+ Year Treasuries"]
        out.append(f"Long-duration Treasury flows {'increasing' if b['score'] > 10 else 'decreasing' if b['score'] < -10 else 'flat'}")
    fac = {f["name"]: f for f in groups.get("factor", [])}
    if "Growth" in fac and "Value" in fac:
        d = fac["Growth"]["score"] - fac["Value"]["score"]
        out.append(f"{'Growth' if d > 0 else 'Value'} leading {'Value' if d > 0 else 'Growth'} by {abs(d):.0f} pts")
    return out


def _risk_appetite(groups: dict[str, list[dict]]) -> Optional[float]:
    """Composite of risk-on pairs: HY vs IG, small vs large, growth vs value, EM vs US, crypto."""
    idx = {i["symbol"]: i for g in groups.values() for i in g}
    pairs = []
    if "HYG" in idx and "LQD" in idx:
        pairs.append(idx["HYG"]["score"] - idx["LQD"]["score"])
    if "IWM" in idx:
        pairs.append(idx["IWM"]["score"])
    if "VUG" in idx and "VTV" in idx:
        pairs.append((idx["VUG"]["score"] - idx["VTV"]["score"]) / 2)
    if "EEM" in idx:
        pairs.append(idx["EEM"]["score"] / 2)
    if "BTC-USD" in idx:
        pairs.append(idx["BTC-USD"]["score"] / 2)
    if "ARKK" in idx:
        pairs.append(idx["ARKK"]["score"] / 2)
    return r(float(np.mean(pairs)), 0) if pairs else None


def compute(prices: dict[str, pd.DataFrame], instruments: list[dict], as_of: Optional[date] = None) -> dict:
    bench = prices.get("SPY")
    groups: dict[str, list[dict]] = {g: [] for g in GROUP_ORDER}
    for inst in instruments:
        sym = inst["symbol"]
        if inst["group"] not in groups or sym == "SPY" or sym == "^VIX":
            continue
        sc = score_instrument(prices.get(sym), bench)
        if not sc:
            continue
        groups[inst["group"]].append({"symbol": sym, "name": inst["name"], "sector": inst.get("sector"), **sc})
    for g in groups:
        groups[g].sort(key=lambda x: -x["score"])
    rotation = {s["sector"]: s["score"] for s in groups["sector"] if s.get("sector")}
    bench_sc = score_instrument(bench, bench) if bench is not None else None
    return {
        "as_of": (as_of or date.today()).isoformat(),
        "benchmark": {"symbol": "SPY", "return_1m": bench_sc and bench_sc["return_1m"], "return_3m": bench_sc and bench_sc["return_3m"],
                      "return_12m": bench_sc and bench_sc["return_12m"], "above_200dma": bench_sc and bench_sc["above_200dma"]},
        "groups": groups,
        "sector_rotation": rotation,
        "risk_appetite": _risk_appetite(groups),
        "summary": _sentences(groups),
        "method": "Relative strength vs SPY (1/3/6m), RS acceleration, relative dollar volume and net buying pressure, "
                  "mapped to -100..+100. Fund-flow, 13F and insider data are Phase 2 inputs to the same score.",
    }
