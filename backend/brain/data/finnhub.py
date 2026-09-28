"""Finnhub (free tier, 60 calls/min): earnings calendar with surprises, per-ticker news, quotes for the gap scan.
Everything here is optional; without FINNHUB_API_KEY the events engine simply lacks these sections."""
from __future__ import annotations

import time
from datetime import date, timedelta
from typing import Optional

from ..config import settings
from .http import cached_get_json

_BASE = "https://finnhub.io/api/v1"


def _key() -> Optional[str]:
    return getattr(settings, "finnhub_api_key", None)


def earnings_calendar(start: date, end: date) -> list[dict]:
    if not _key():
        return []
    try:
        d = cached_get_json(f"{_BASE}/calendar/earnings", namespace="finnhub", key=f"earnings_{start}_{end}_{date.today()}", ttl_hours=6,
                            params={"from": start.isoformat(), "to": end.isoformat(), "token": _key()})
        return d.get("earningsCalendar", []) or []
    except Exception as e:
        print(f"[events] finnhub earnings: {e}")
        return []


def company_news(symbol: str, start: date, end: date) -> list[dict]:
    if not _key():
        return []
    try:
        d = cached_get_json(f"{_BASE}/company-news", namespace="finnhub", key=f"news_{symbol}_{end}", ttl_hours=6,
                            params={"symbol": symbol, "from": start.isoformat(), "to": end.isoformat(), "token": _key()})
        time.sleep(1.05)   # 60/min
        return d if isinstance(d, list) else []
    except Exception as e:
        print(f"[events] finnhub news {symbol}: {e}")
        return []


def quote(symbol: str) -> Optional[dict]:
    """c current (includes pre/post-market on US stocks), pc previous close, dp percent change."""
    if not _key():
        return None
    try:
        d = cached_get_json(f"{_BASE}/quote", namespace="finnhub", key=f"quote_{symbol}_{date.today()}_{time.strftime('%H')}", ttl_hours=1,
                            params={"symbol": symbol, "token": _key()})
        time.sleep(1.05)
        return d if d and d.get("c") else None
    except Exception as e:
        print(f"[events] finnhub quote {symbol}: {e}")
        return None
