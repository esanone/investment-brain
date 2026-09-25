"""Hedging / Risk Engine — recommends portfolio *posture*, kept separate from stock selection."""
from __future__ import annotations

from datetime import date
from typing import Optional

import numpy as np
import pandas as pd

from .common import r, sigmoid_score, zscore_last

BASELINE = {"Equities": 65, "Treasuries": 12, "Cash": 8, "Gold": 5, "Credit": 5, "Commodities": 5}


def _breadth(prices: dict[str, pd.DataFrame], tickers: list[str]) -> Optional[float]:
    above = tot = 0
    for t in tickers:
        df = prices.get(t)
        if df is None or len(df) < 60:
            continue
        px = df["adj_close"]
        tot += 1
        above += int(px.iloc[-1] > px.iloc[-50:].mean())
    return None if tot == 0 else above / tot * 100


def _avg_correlation(prices: dict[str, pd.DataFrame], symbols: list[str], window: int = 60) -> Optional[float]:
    rets = {}
    for s in symbols:
        df = prices.get(s)
        if df is not None and len(df) > window + 5:
            rets[s] = df.set_index("date")["adj_close"].pct_change().iloc[-window:]
    if len(rets) < 4:
        return None
    c = pd.DataFrame(rets).corr().values
    n = c.shape[0]
    return float((c.sum() - n) / (n * (n - 1)))


def compute(prices: dict[str, pd.DataFrame], macro: dict[str, pd.Series], flows: dict, regime: dict,
            company_tickers: list[str], as_of: Optional[date] = None) -> dict:
    signals: list[dict] = []

    def add(name: str, value: Optional[float], z: Optional[float], weight: float, note: str):
        if value is None or z is None or not np.isfinite(z):
            return
        signals.append({"name": name, "value": r(value, 2), "z": r(z, 2), "risk_score": r(sigmoid_score(z), 0), "weight": weight, "note": note})

    vix = macro.get("VIXCLS")
    if vix is not None and len(vix) > 300:
        add("VIX level", float(vix.iloc[-1]), zscore_last(vix, 750), 1.0, "Implied volatility vs 3y history")
        add("VIX 1m change", float(vix.iloc[-1] - vix.iloc[-21]), zscore_last(vix.diff(21), 750), 0.6, "Rising vol = deteriorating")
    hy = macro.get("BAMLH0A0HYM2")
    if hy is not None and len(hy) > 300:
        add("HY credit spread", float(hy.iloc[-1]), zscore_last(hy, 750), 1.0, "Wider spreads = stress")
        add("HY spread 1m change", float(hy.iloc[-1] - hy.iloc[-21]), zscore_last(hy.diff(21), 750), 0.8, "Widening = deteriorating")
    curve = macro.get("T10Y3M")
    if curve is not None and len(curve) > 300:
        add("3m10y curve", float(curve.iloc[-1]), -zscore_last(curve, 2500), 0.6, "Inverted curve = recession risk")
    dxy = macro.get("DTWEXBGS")
    if dxy is not None and len(dxy) > 300:
        add("Dollar 3m change", float(dxy.iloc[-1] / dxy.iloc[-63] - 1) * 100, zscore_last(dxy.pct_change(63), 750), 0.5, "Strong dollar = tightening")

    breadth = _breadth(prices, company_tickers)
    if breadth is not None:
        add("Breadth (% above 50dma)", breadth, -(breadth - 55) / 20, 1.0, "Narrow breadth = fragile")
    spy = prices.get("SPY")
    if spy is not None and len(spy) > 220:
        px = spy["adj_close"]
        dist = float(px.iloc[-1] / px.iloc[-200:].mean() - 1) * 100
        add("SPY vs 200dma (%)", dist, -dist / 5, 1.0, "Below trend = risk-off")
        dd = float(px.iloc[-1] / px.iloc[-252:].max() - 1) * 100
        add("Drawdown from 52w high (%)", dd, -dd / 6, 0.7, "Deeper drawdown = stress")
    rsp, spyd = prices.get("RSP"), prices.get("SPY")
    if rsp is not None and spyd is not None and len(rsp) > 70 and len(spyd) > 70:
        rs = (rsp["adj_close"].iloc[-1] / rsp["adj_close"].iloc[-63]) / (spyd["adj_close"].iloc[-1] / spyd["adj_close"].iloc[-63]) - 1
        add("Equal-weight vs cap-weight (3m)", rs * 100, -rs * 100 / 3, 0.5, "Cap-weight leadership = narrow market")
    corr = _avg_correlation(prices, ["XLK", "XLV", "XLF", "XLY", "XLP", "XLE", "XLI", "XLB", "XLU", "XLRE", "XLC"])
    if corr is not None:
        add("Sector correlation (60d)", corr, (corr - 0.55) / 0.15, 0.6, "High correlation = macro-driven, fragile")
    liq = regime.get("dimensions", {}).get("liquidity", {}).get("score")
    if liq is not None:
        add("Liquidity regime", liq, -(liq - 50) / 15, 0.8, "Tight liquidity = risk")
    ra = flows.get("risk_appetite")
    if ra is not None:
        add("Risk appetite (flows)", ra, -ra / 40, 0.8, "Risk-off rotation")
    contraction = regime.get("regime", {}).get("probabilities", {}).get("Contraction")
    stag = regime.get("regime", {}).get("probabilities", {}).get("Stagflation")
    if contraction is not None:
        add("P(Contraction)+P(Stagflation)", contraction + (stag or 0), ((contraction + (stag or 0)) - 35) / 15, 0.8, "Adverse regime odds")

    if not signals:
        score = 50.0
    else:
        tot = sum(s["weight"] for s in signals)
        score = sum(s["risk_score"] * s["weight"] for s in signals) / tot
    label = "Benign" if score < 38 else "Stable" if score < 55 else "Deteriorating" if score < 72 else "Stress"

    # Posture: shift from baseline as risk rises above 50 (and modestly the other way when benign)
    k = max(-0.5, min(1.0, (score - 50) / 30))
    eq = BASELINE["Equities"] * (1 - 0.35 * k)
    tr = BASELINE["Treasuries"] + 10 * max(k, 0)
    cash = BASELINE["Cash"] + 8 * max(k, 0)
    gold = BASELINE["Gold"] + 5 * max(k, 0)
    credit = BASELINE["Credit"] * (1 - 0.6 * max(k, 0))
    comm = BASELINE["Commodities"]
    rec = {"Equities": eq, "Treasuries": tr, "Cash": cash, "Gold": gold, "Credit": credit, "Commodities": comm}
    tot = sum(rec.values())
    rec = {kk: r(v / tot * 100, 0) for kk, v in rec.items()}
    beta = r(1.10 - 0.45 * max(k, 0) + 0.10 * max(-k, 0), 2)

    return {
        "as_of": (as_of or date.today()).isoformat(),
        "risk_score": r(score, 0),
        "label": label,
        "signals": sorted(signals, key=lambda s: -s["weight"]),
        "posture": {"baseline": BASELINE, "recommended": rec, "beta_target": {"baseline": 1.10, "recommended": beta}},
        "hedges": [
            h for h in [
                "Raise cash and Treasury duration; trim highest-beta winners" if score >= 55 else None,
                "Consider index put spreads or collar on concentrated positions" if score >= 65 else None,
                "Gold as a liquidity/real-rate hedge" if score >= 55 else None,
                "Risk is benign: full equity exposure, favour cyclicals and small caps" if score < 38 else None,
            ] if h
        ],
        "notes": ["Posture is a recommendation to review, not an order. Options-based hedging is a later phase."],
    }
