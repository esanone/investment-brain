"""Distribution feed for income ETFs (key-free).

Primary: Nasdaq's dividend endpoint (Nasdaq-listed ETFs). Fallback: stockanalysis.com dividend history (NYSE Arca funds
such as SGOV, JEPI, SCHD, MLPX). Both are cached for a day. Returns the trailing-twelve-month sum, the payment
frequency, the last amount and an estimate of the next pay date.
"""
from __future__ import annotations

import io
import json
import time
from datetime import date, timedelta
from typing import Optional

import pandas as pd

from .http import cached_get
from .prices import _BROWSER_UA

_JSON = {"User-Agent": _BROWSER_UA, "Accept": "application/json"}
_HTML = {"User-Agent": _BROWSER_UA, "Accept": "text/html,application/xhtml+xml"}


def _num(s) -> Optional[float]:
    try:
        v = str(s).replace("$", "").replace(",", "").strip()
        return float(v) if v not in ("", "N/A", "--", "nan") else None
    except ValueError:
        return None


def _nasdaq(symbol: str) -> list[dict]:
    text = cached_get(f"https://api.nasdaq.com/api/quote/{symbol.replace('-', '.')}/dividends", namespace="dividends", key=f"nasdaq_{symbol}_{date.today():%Y%m%d}",
                      ttl_hours=24, headers=_JSON, params={"assetclass": "etf"})
    rows = (((json.loads(text).get("data") or {}).get("dividends") or {}).get("rows")) or []
    out = []
    for r_ in rows:
        amt = _num(r_.get("amount"))
        if amt is None or r_.get("type", "Cash") != "Cash":
            continue
        try:
            ex = pd.to_datetime(r_["exOrEffDate"]).date()
            pay = pd.to_datetime(r_.get("paymentDate")).date() if r_.get("paymentDate") not in (None, "N/A", "") else None
        except (ValueError, TypeError):
            continue
        out.append({"ex_date": ex, "pay_date": pay, "amount": amt})
    time.sleep(0.2)
    return out


def _stockanalysis(symbol: str) -> list[dict]:
    text = cached_get(f"https://stockanalysis.com/etf/{symbol.lower()}/dividend/", namespace="dividends", key=f"sa_{symbol}_{date.today():%Y%m%d}",
                      ttl_hours=24, headers=_HTML, suffix=".html")
    out = []
    for t in pd.read_html(io.StringIO(text)):
        cols = {c.lower(): c for c in t.columns}
        exc, amc = cols.get("ex-dividend date"), cols.get("cash amount")
        if not exc or not amc:
            continue
        payc = cols.get("pay date")
        for _, row in t.iterrows():
            amt = _num(row[amc])
            try:
                ex = pd.to_datetime(row[exc]).date()
                pay = pd.to_datetime(row[payc]).date() if payc and str(row[payc]) not in ("nan", "-", "") else None
            except (ValueError, TypeError):
                continue
            if amt is not None:
                out.append({"ex_date": ex, "pay_date": pay, "amount": amt})
        break
    time.sleep(0.5)
    return out


def distributions(symbol: str) -> list[dict]:
    """Cash distributions, newest first."""
    for fn in (_nasdaq, _stockanalysis):
        try:
            rows = fn(symbol)
            if rows:
                return sorted(rows, key=lambda x: x["ex_date"], reverse=True)
        except Exception as e:  # noqa: PERF203
            print(f"[dividends] {symbol} via {fn.__name__}: {e}")
    return []


def summarize(symbol: str, price: Optional[float], today: Optional[date] = None) -> Optional[dict]:
    today = today or date.today()
    rows = distributions(symbol)
    if not rows:
        return None
    cutoff = today - timedelta(days=366)
    ttm = [x for x in rows if x["ex_date"] > cutoff and x["ex_date"] <= today]
    n = len(ttm)
    freq = "monthly" if n >= 11 else "quarterly" if 3 <= n <= 5 else "semi-annual" if n == 2 else "annual" if n == 1 else "irregular"
    per_year = {"monthly": 12, "quarterly": 4, "semi-annual": 2, "annual": 1}.get(freq, max(n, 1))
    ttm_sum = sum(x["amount"] for x in ttm)
    last = rows[0]
    recent = [x["amount"] for x in ttm[:3]]
    earlier = [x["amount"] for x in ttm[3:]]
    trend_pct = ((sum(recent) / len(recent)) / (sum(earlier) / len(earlier)) - 1) * 100 if recent and earlier else None
    gap_days = 365 / per_year
    next_pay = (last["pay_date"] or last["ex_date"]) + timedelta(days=round(gap_days))
    while next_pay < today:
        next_pay += timedelta(days=round(gap_days))
    return {"symbol": symbol, "n_12m": n, "frequency": freq, "ttm_sum": round(ttm_sum, 4), "last_amount": last["amount"], "last_ex_date": last["ex_date"].isoformat(),
            "last_pay_date": last["pay_date"].isoformat() if last["pay_date"] else None, "next_pay_est": next_pay.isoformat(),
            "yield_ttm_pct": round(ttm_sum / price * 100, 2) if price else None,
            "yield_forward_pct": round(last["amount"] * per_year / price * 100, 2) if price else None,
            "payout_trend_pct": round(trend_pct, 1) if trend_pct is not None else None,
            "pay_months": _pay_months(freq, per_year, (last["pay_date"] or last["ex_date"]).month)}


def _pay_months(freq: str, per_year: int, last_month: int) -> list[int]:
    """Regular payers: project the schedule from the latest pay month (a special or a shifted payment must not create a 5th month)."""
    if freq == "monthly":
        return list(range(1, 13))
    if freq in ("quarterly", "semi-annual", "annual"):
        step = 12 // per_year
        return sorted({(last_month - 1 + k * step) % 12 + 1 for k in range(per_year)})
    return [last_month]
