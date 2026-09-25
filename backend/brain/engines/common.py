"""Shared scoring helpers. Every engine maps evidence onto 0-100 scores with these,
so the scores are comparable across engines."""
from __future__ import annotations

import math
from typing import Iterable, Optional

import numpy as np
import pandas as pd


def sigmoid_score(z: float, k: float = 1.2) -> float:
    """z-score -> 0..100 (z=0 -> 50, z=+1.5 -> ~86)."""
    if z is None or not np.isfinite(z):
        return 50.0
    return float(100.0 / (1.0 + math.exp(-k * z)))


def tanh_score(x: float, scale: float) -> float:
    """x -> -100..100 with soft saturation at ~2*scale."""
    if x is None or not np.isfinite(x):
        return 0.0
    return float(100.0 * math.tanh(x / scale))


def zscore_last(s: pd.Series, window: int) -> float:
    s = s.dropna()
    if len(s) < 8:
        return float("nan")
    w = s.iloc[-window:]
    sd = w.std()
    if not sd or not np.isfinite(sd):
        return 0.0
    return float((s.iloc[-1] - w.mean()) / sd)


def pct_rank(values: pd.Series, ascending: bool = True) -> pd.Series:
    """Cross-sectional percentile rank 0..100 (NaN stays NaN)."""
    r = values.rank(pct=True, ascending=ascending)
    return r * 100.0


def pct_of_history(current: float, history: Iterable[float]) -> Optional[float]:
    h = np.array([x for x in history if x is not None and np.isfinite(x)])
    if current is None or not np.isfinite(current) or len(h) < 6:
        return None
    return float((h < current).mean() * 100.0)


def wmean(pairs: Iterable[tuple[Optional[float], float]]) -> Optional[float]:
    """Weighted mean ignoring None/NaN values; None if nothing available."""
    num = den = 0.0
    for v, w in pairs:
        if v is None or not np.isfinite(v) or w <= 0:
            continue
        num += v * w
        den += w
    return num / den if den > 0 else None


def clip(x: Optional[float], lo: float, hi: float) -> Optional[float]:
    if x is None or not np.isfinite(x):
        return None
    return float(min(hi, max(lo, x)))


def safe_div(a: Optional[float], b: Optional[float]) -> Optional[float]:
    if a is None or b is None or not np.isfinite(a) or not np.isfinite(b) or b == 0:
        return None
    return float(a / b)


def r(x: Optional[float], nd: int = 1) -> Optional[float]:
    if x is None or (isinstance(x, float) and not np.isfinite(x)):
        return None
    return round(float(x), nd)


def trailing_return(px: pd.Series, days: int) -> Optional[float]:
    if len(px) <= days:
        return None
    return float(px.iloc[-1] / px.iloc[-1 - days] - 1.0)
