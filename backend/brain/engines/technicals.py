"""Technical indicators for the chart endpoint and for the LLM's technical read."""
from __future__ import annotations

from typing import Optional

import numpy as np
import pandas as pd

RANGE_DAYS = {"1m": 31, "3m": 93, "6m": 186, "1y": 366, "2y": 732, "5y": 1830, "max": 100000}


def _nan_to_none(s: pd.Series) -> list:
    return [None if (x is None or (isinstance(x, float) and not np.isfinite(x))) else round(float(x), 4) for x in s]


def compute(df: pd.DataFrame, range_: str = "1y", interval: str = "1d") -> dict:
    """df: date, open, high, low, close, adj_close, volume (ascending, daily). Indicators are
    computed on the full daily history first (so SMA200 exists on a 1-month view), then sliced."""
    d = df.sort_values("date").reset_index(drop=True).copy()
    for c in ("open", "high", "low"):
        if c not in d or d[c].isna().all():
            d[c] = d["close"]
        d[c] = d[c].fillna(d["close"])
    c = d["close"]
    d["sma20"], d["sma50"], d["sma200"] = c.rolling(20).mean(), c.rolling(50).mean(), c.rolling(200).mean()
    d["ema21"] = c.ewm(span=21, adjust=False).mean()
    std20 = c.rolling(20).std()
    d["bb_upper"], d["bb_lower"] = d["sma20"] + 2 * std20, d["sma20"] - 2 * std20
    delta = c.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean()
    rs = gain / loss.replace(0, np.nan)
    d["rsi14"] = 100 - 100 / (1 + rs)
    ema12, ema26 = c.ewm(span=12, adjust=False).mean(), c.ewm(span=26, adjust=False).mean()
    d["macd"] = ema12 - ema26
    d["macd_signal"] = d["macd"].ewm(span=9, adjust=False).mean()
    d["macd_hist"] = d["macd"] - d["macd_signal"]
    d["avg_vol20"] = d["volume"].rolling(20).mean()

    last = d.iloc[-1]
    hi52 = float(c.iloc[-252:].max()) if len(c) else None
    prev_close = float(c.iloc[-2]) if len(c) > 1 else None
    first_in_range = d[d["date"] >= d["date"].iloc[-1] - pd.Timedelta(days=RANGE_DAYS.get(range_, 366))]
    signals = []
    if pd.notna(last["sma200"]):
        signals.append("Above 200-day" if last["close"] > last["sma200"] else "Below 200-day")
    if pd.notna(last["sma50"]) and pd.notna(last["sma200"]):
        prev50, prev200 = d["sma50"].iloc[-6], d["sma200"].iloc[-6]
        if last["sma50"] > last["sma200"] and prev50 <= prev200:
            signals.append("Golden cross (5d)")
        elif last["sma50"] < last["sma200"] and prev50 >= prev200:
            signals.append("Death cross (5d)")
        elif last["sma50"] > last["sma200"]:
            signals.append("50 > 200 uptrend")
    if pd.notna(last["rsi14"]):
        signals.append("RSI overbought" if last["rsi14"] >= 70 else "RSI oversold" if last["rsi14"] <= 30 else f"RSI {last['rsi14']:.0f}")
    if pd.notna(last["macd_hist"]):
        signals.append("MACD positive" if last["macd_hist"] > 0 else "MACD negative")
    if hi52 and last["close"] >= hi52 * 0.98:
        signals.append("At 52-week high")
    if pd.notna(last["bb_upper"]) and last["close"] > last["bb_upper"]:
        signals.append("Above upper Bollinger")
    if pd.notna(last["bb_lower"]) and last["close"] < last["bb_lower"]:
        signals.append("Below lower Bollinger")
    if pd.notna(last["avg_vol20"]) and last["avg_vol20"] and last["volume"] > 2 * last["avg_vol20"]:
        signals.append("Volume 2x average")

    latest = {
        "close": round(float(last["close"]), 2),
        "change_1d_pct": round((float(last["close"]) / prev_close - 1) * 100, 2) if prev_close else None,
        "change_range_pct": round((float(last["close"]) / float(first_in_range["close"].iloc[0]) - 1) * 100, 2) if len(first_in_range) > 1 else None,
        "sma20": None if pd.isna(last["sma20"]) else round(float(last["sma20"]), 2),
        "sma50": None if pd.isna(last["sma50"]) else round(float(last["sma50"]), 2),
        "sma200": None if pd.isna(last["sma200"]) else round(float(last["sma200"]), 2),
        "rsi14": None if pd.isna(last["rsi14"]) else round(float(last["rsi14"]), 1),
        "macd_hist": None if pd.isna(last["macd_hist"]) else round(float(last["macd_hist"]), 3),
        "above_200dma": None if pd.isna(last["sma200"]) else bool(last["close"] > last["sma200"]),
        "pct_from_52w_high": round((float(last["close"]) / hi52 - 1) * 100, 1) if hi52 else None,
        "avg_volume_20": None if pd.isna(last["avg_vol20"]) else round(float(last["avg_vol20"])),
        "signals": signals,
    }

    win = first_in_range.copy()
    if interval == "1w":
        g = win.set_index("date").resample("W-FRI")
        agg = pd.DataFrame({"open": g["open"].first(), "high": g["high"].max(), "low": g["low"].min(), "close": g["close"].last(),
                            "volume": g["volume"].sum()})
        for k in ("sma20", "sma50", "sma200", "ema21", "bb_upper", "bb_lower", "rsi14", "macd", "macd_signal", "macd_hist"):
            agg[k] = g[k].last()
        win = agg.dropna(subset=["close"]).reset_index()
    bars = [{"t": r.date.strftime("%Y-%m-%d"), "o": round(float(r.open), 4), "h": round(float(r.high), 4), "l": round(float(r.low), 4),
             "c": round(float(r.close), 4), "v": float(r.volume or 0)} for r in win.itertuples()]
    ind = {k: _nan_to_none(win[k]) for k in ("sma20", "sma50", "sma200", "ema21", "bb_upper", "bb_lower", "rsi14", "macd", "macd_signal", "macd_hist")}
    return {"range": range_, "interval": interval, "n": len(bars), "bars": bars, "indicators": ind, "latest": latest}


def technical_read(df: pd.DataFrame) -> Optional[dict]:
    """Compact technical summary for the LLM thesis package."""
    if df is None or len(df) < 60:
        return None
    return compute(df, "6m", "1d")["latest"]


# ------------------------------------------------------------------ long-term readiness
def atr(df: pd.DataFrame, n: int = 20) -> Optional[float]:
    d = df.sort_values("date").tail(n + 1)
    if len(d) < n + 1:
        return None
    h, l, c = d["high"].fillna(d["close"]), d["low"].fillna(d["close"]), d["close"]
    tr = pd.concat([h - l, (h - c.shift()).abs(), (l - c.shift()).abs()], axis=1).max(axis=1)
    return float(tr.iloc[1:].mean())


def trend_template(df: pd.DataFrame, bench: Optional[pd.DataFrame] = None) -> Optional[dict]:
    """Minervini-style trend template (8 criteria) -> readiness 0-100 for a long-term long entry.
    Requires ~1 year of daily bars; returns None if not enough history."""
    if df is None or len(df) < 210:
        return None
    d = df.sort_values("date").reset_index(drop=True)
    c = d["close"]
    sma50, sma150, sma200 = c.rolling(50).mean(), c.rolling(150).mean(), c.rolling(200).mean()
    last, s50, s150, s200 = float(c.iloc[-1]), float(sma50.iloc[-1]), float(sma150.iloc[-1]), float(sma200.iloc[-1])
    s200_prev = float(sma200.iloc[-23]) if len(sma200) > 23 and pd.notna(sma200.iloc[-23]) else None
    s150_prev = float(sma150.iloc[-21]) if len(sma150) > 21 and pd.notna(sma150.iloc[-21]) else None
    lo52, hi52 = float(c.iloc[-252:].min()), float(c.iloc[-252:].max())
    rs6 = None
    if bench is not None and len(bench) > 130:
        b = bench.sort_values("date")["adj_close"]
        rs6 = float((c.iloc[-1] / c.iloc[-126] - 1) - (b.iloc[-1] / b.iloc[-126] - 1)) * 100 if len(c) > 126 else None
    crit = {
        "above_150_200": last > s150 and last > s200,
        "150_above_200": s150 > s200,
        "200_rising_1m": s200_prev is not None and s200 > s200_prev,
        "50_above_150_200": s50 > s150 and s50 > s200,
        "above_50": last > s50,
        "25pct_above_52w_low": last >= 1.25 * lo52,
        "within_25pct_of_52w_high": last >= 0.75 * hi52,
        "rs_positive_6m": (rs6 is None) or rs6 >= 0,
    }
    passes = sum(crit.values())
    score = round(passes / 8 * 100)
    delta = c.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / 14, adjust=False).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / 14, adjust=False).mean()
    rsi = float((100 - 100 / (1 + gain / loss.replace(0, np.nan))).iloc[-1])
    a = atr(d)
    return {
        "score": score, "passes": passes, "criteria": crit,
        "ready": bool(passes >= 6 and crit["above_150_200"] and crit["200_rising_1m"]),
        "stage": "stage2_uptrend" if passes >= 7 else "emerging" if passes >= 5 else "basing_or_downtrend",
        "close": round(last, 2), "sma50": round(s50, 2), "sma150": round(s150, 2), "sma200": round(s200, 2),
        "sma150_prev4w": None if s150_prev is None else round(s150_prev, 2), "sma150_declining": bool(s150_prev is not None and s150 < s150_prev),
        "pct_above_52w_low": round((last / lo52 - 1) * 100, 1), "pct_from_52w_high": round((last / hi52 - 1) * 100, 1),
        "rs_6m": None if rs6 is None else round(rs6, 1), "rsi14": round(rsi, 1), "atr20": None if a is None else round(a, 3),
        "atr_pct": None if a is None else round(a / last * 100, 2), "overbought": rsi >= 75,
    }
