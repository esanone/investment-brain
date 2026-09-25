"""Economic Regime Engine — "What environment are we in?"

Four independent dimensions (growth, inflation, liquidity, rates) scored 0-100 from
FRED series, then *probabilities* over four regimes rather than a hard label.
Each indicator contributes a level z-score (vs its own 10y history) and a momentum
z-score (3-month change), so the regime responds to direction, not just level.
"""
from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Optional

import numpy as np
import pandas as pd

from ..data.fred import MACRO_SERIES
from .common import r, sigmoid_score

REGIMES = ["Goldilocks", "Reflation", "Stagflation", "Contraction"]
REGIME_DESC = {
    "Goldilocks": "Growth improving while inflation cools: favours duration-sensitive growth, quality, small caps.",
    "Reflation": "Growth and inflation both rising: favours cyclicals, energy, materials, financials, commodities.",
    "Stagflation": "Growth slowing while inflation stays hot: favours energy, staples, pricing power, gold, short duration.",
    "Contraction": "Growth and inflation both falling: favours long Treasuries, defensives, cash, quality balance sheets.",
}
REGIME_BENEFICIARIES = {
    "Goldilocks": ["Technology", "Consumer Discretionary", "Communication Services", "Small caps", "Long-duration growth"],
    "Reflation": ["Energy", "Materials", "Industrials", "Financials", "Commodities", "Value"],
    "Stagflation": ["Energy", "Consumer Staples", "Utilities", "Gold", "Health Care", "Short-duration bonds"],
    "Contraction": ["Long Treasuries", "Consumer Staples", "Utilities", "Health Care", "Cash", "Quality"],
}


def _publication_lag_days(s: pd.Series) -> int:
    if len(s) < 3:
        return 30
    spacing = pd.Series(s.index).diff().dt.days.median()
    if spacing <= 4:
        return 1
    if spacing <= 8:
        return 5
    if spacing <= 40:
        return 35
    return 50


def _transform(s: pd.Series, how: str) -> pd.Series:
    """Turn a raw series into the quantity we score."""
    spacing = pd.Series(s.index).diff().dt.days.median() if len(s) > 2 else 30
    per_year = 252 if spacing <= 4 else 52 if spacing <= 8 else 12 if spacing <= 40 else 4
    if how == "yoy":
        return s.pct_change(per_year) * 100
    if how == "inv_yoy":
        return -s.pct_change(per_year) * 100
    if how == "yoy_3m":
        n = max(1, per_year // 4)
        return (s.pct_change(n) * (per_year / n)) * 100
    if how == "inv_diff_12m":
        return -(s - s.shift(per_year))
    if how == "inv_level":
        return -s
    return s  # level


def _momentum_window(s: pd.Series) -> int:
    spacing = pd.Series(s.index).diff().dt.days.median() if len(s) > 2 else 30
    return 63 if spacing <= 4 else 13 if spacing <= 8 else 3 if spacing <= 40 else 1


def _indicator(sid: str, meta: dict, raw: pd.Series, as_of: pd.Timestamp) -> Optional[dict]:
    lag = _publication_lag_days(raw)
    known = raw[raw.index <= as_of - pd.Timedelta(days=lag)]
    if len(known) < 24:
        return None
    x = _transform(known, meta["transform"]).dropna()
    if len(x) < 12:
        return None
    hist_window = 10 * (252 if _momentum_window(x) == 63 else 52 if _momentum_window(x) == 13 else 12 if _momentum_window(x) == 3 else 4)
    w = x.iloc[-hist_window:]
    sd = w.std()
    z_level = float((x.iloc[-1] - w.mean()) / sd) if sd and np.isfinite(sd) and sd > 0 else 0.0
    n = _momentum_window(x)
    ch = x.diff(n).dropna()
    chw = ch.iloc[-hist_window:]
    sd2 = chw.std()
    z_mom = float(ch.iloc[-1] / sd2) if len(ch) and sd2 and np.isfinite(sd2) and sd2 > 0 else 0.0
    z_level = max(-3.0, min(3.0, z_level))
    z_mom = max(-3.0, min(3.0, z_mom))
    if meta["dim"] == "rates":
        z = z_level  # rates dimension is a level (restrictiveness), momentum shown separately
    else:
        z = 0.55 * z_level + 0.45 * z_mom
    return {
        "id": sid, "name": meta["name"], "transform": meta["transform"],
        "value": r(x.iloc[-1], 2), "raw_value": r(known.iloc[-1], 2), "as_of": known.index[-1].date().isoformat(),
        "z_level": r(z_level, 2), "z_momentum": r(z_mom, 2), "score": r(sigmoid_score(z), 1), "weight": meta["weight"],
    }


def _dimensions(macro: dict[str, pd.Series], as_of: pd.Timestamp) -> dict:
    dims: dict[str, dict] = {d: {"indicators": []} for d in ("growth", "inflation", "liquidity", "rates")}
    for sid, meta in MACRO_SERIES.items():
        if meta["dim"] not in dims or sid not in macro:
            continue
        ind = _indicator(sid, meta, macro[sid], as_of)
        if ind:
            dims[meta["dim"]]["indicators"].append(ind)
    for d, node in dims.items():
        inds = node["indicators"]
        if inds:
            tot = sum(i["weight"] for i in inds)
            node["score"] = r(sum(i["score"] * i["weight"] for i in inds) / tot, 1)
            node["momentum"] = r(sum(i["z_momentum"] * i["weight"] for i in inds) / tot, 2)
        else:
            node["score"], node["momentum"] = 50.0, 0.0
    return dims


def _probabilities(dims: dict, temperature: float = 1.0) -> dict[str, float]:
    g = (dims["growth"]["score"] - 50) / 20.0
    i = (dims["inflation"]["score"] - 50) / 20.0
    liq = (dims["liquidity"]["score"] - 50) / 20.0
    logits = {
        "Goldilocks": g - i + 0.25 * liq,
        "Reflation": g + i,
        "Stagflation": -g + i - 0.25 * liq,
        "Contraction": -g - i,
    }
    m = max(logits.values())
    ex = {k: math.exp((v - m) / temperature) for k, v in logits.items()}
    tot = sum(ex.values())
    return {k: v / tot for k, v in ex.items()}


def _snapshot(macro: dict[str, pd.Series], as_of: pd.Timestamp) -> dict:
    dims = _dimensions(macro, as_of)
    probs = _probabilities(dims)
    return {"dims": dims, "probs": probs}


def compute(macro: dict[str, pd.Series], as_of: Optional[date] = None) -> dict:
    as_of_ts = pd.Timestamp(as_of or date.today())
    now = _snapshot(macro, as_of_ts)
    prev = _snapshot(macro, as_of_ts - pd.Timedelta(days=60))
    probs = now["probs"]
    label = max(probs, key=probs.get)
    dims = now["dims"]

    # Monthly history for the dashboard (24 months)
    history = []
    for k in range(24, -1, -1):
        d = (as_of_ts - pd.DateOffset(months=k)).normalize()
        snap = _snapshot(macro, d)
        history.append({"date": d.date().isoformat(),
                        "probabilities": {kk: r(v * 100, 1) for kk, v in snap["probs"].items()},
                        "dimensions": {kk: snap["dims"][kk]["score"] for kk in snap["dims"]}})

    # Plain-language regime headline, e.g. "Moderate Expansion / Disinflation"
    gs, is_, ls = dims["growth"]["score"], dims["inflation"]["score"], dims["liquidity"]["score"]
    g_word = "Strong Expansion" if gs >= 65 else "Moderate Expansion" if gs >= 50 else "Slowdown" if gs >= 35 else "Contraction"
    i_word = "Inflation Rising" if is_ >= 60 else "Sticky Inflation" if is_ >= 45 else "Disinflation"
    l_word = "Easy Liquidity" if ls >= 60 else "Neutral Liquidity" if ls >= 40 else "Tight Liquidity"

    return {
        "as_of": as_of_ts.date().isoformat(),
        "headline": f"{g_word} / {i_word} / {l_word}",
        "dimensions": {k: {"score": v["score"], "momentum": v["momentum"], "indicators": v["indicators"]} for k, v in dims.items()},
        "regime": {
            "label": label,
            "description": REGIME_DESC[label],
            "probabilities": {k: r(v * 100, 1) for k, v in probs.items()},
            "beneficiaries": REGIME_BENEFICIARIES[label],
        },
        "trend": {
            "window_days": 60,
            "probabilities_prior": {k: r(v * 100, 1) for k, v in prev["probs"].items()},
            "probability_delta": {k: r((probs[k] - prev["probs"][k]) * 100, 1) for k in probs},
            "dimension_delta": {k: r(dims[k]["score"] - prev["dims"][k]["score"], 1) for k in dims},
        },
        "history": history,
        "notes": [
            "Scores are point-in-time by observation date with a typical publication lag applied; "
            "data revisions are not yet vintage-aware (ALFRED integration is a Phase 2 item).",
            "Rates dimension scores the *level* of restrictiveness; the others blend level and 3-month momentum.",
        ],
    }
