"""Daily prices with a provider chain, all key-free:

  1. Yahoo Finance chart endpoint (adjusted closes, but aggressive IP rate limits)
  2. Nasdaq's public historical endpoint (split-adjusted closes, stocks/ETFs/crypto)
  3. FRED for index levels we only need as a series (VIX -> VIXCLS)

Every provider returns the same frame: date, close, adj_close, volume.
Swap in a paid vendor (Intrinio, Polygon) by adding a provider here.
"""
from __future__ import annotations

import json
import time
from datetime import date, timedelta

import httpx
import pandas as pd

from ..config import settings
from .http import cached_get, cached_get_json

_BROWSER_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
               "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
COLS = ["date", "open", "high", "low", "close", "adj_close", "volume"]
_EMPTY = pd.DataFrame(columns=COLS)

# symbol -> (provider, provider symbol, asset class)
_SPECIAL = {
    "^VIX": ("fred", "VIXCLS", None),
    "BTC-USD": ("nasdaq", "BTC", "crypto"),
    "ETH-USD": ("nasdaq", "ETH", "crypto"),
}
_ETFS_HINT: set[str] = set()   # filled by pipeline so Nasdaq gets the right asset class
_yahoo_blocked_until = 0.0
_yahoo_client: httpx.Client | None = None


def register_etfs(symbols: list[str]) -> None:
    _ETFS_HINT.update(symbols)


def _range_days(range_: str) -> int:
    n, unit = int(range_[:-1]), range_[-1]
    return n * 365 if unit == "y" else n * 30 if unit == "m" else n


# ---------------------------------------------------------------- Yahoo
def _yahoo(symbol: str, range_: str) -> pd.DataFrame:
    global _yahoo_blocked_until, _yahoo_client
    if time.monotonic() < _yahoo_blocked_until:
        raise RuntimeError("yahoo temporarily blocked")
    if _yahoo_client is None:
        _yahoo_client = httpx.Client(headers={"User-Agent": _BROWSER_UA, "Accept": "*/*"},
                                     follow_redirects=True, timeout=settings.http_timeout)
        try:
            _yahoo_client.get("https://fc.yahoo.com")  # sets consent cookies
        except httpx.HTTPError:
            pass
    r = _yahoo_client.get(f"https://query2.finance.yahoo.com/v8/finance/chart/{symbol}",
                          params={"range": range_, "interval": "1d", "events": "div,splits"})
    if r.status_code == 429:
        _yahoo_blocked_until = time.monotonic() + 600  # back off for 10 minutes, use Nasdaq
        raise RuntimeError("yahoo 429")
    r.raise_for_status()
    data = r.json()
    res = data["chart"]["result"][0]
    ts = res["timestamp"]
    quote = res["indicators"]["quote"][0]
    adj = res["indicators"].get("adjclose", [{}])[0].get("adjclose", quote["close"])
    df = pd.DataFrame({
        "date": pd.to_datetime(ts, unit="s", utc=True).tz_convert("America/New_York").normalize().tz_localize(None),
        "open": quote.get("open"), "high": quote.get("high"), "low": quote.get("low"),
        "close": quote["close"], "adj_close": adj, "volume": quote.get("volume"),
    })
    time.sleep(0.2)
    return df


# ---------------------------------------------------------------- Nasdaq
def _nasdaq(symbol: str, range_: str, asset_class: str | None = None) -> pd.DataFrame:
    if asset_class is None:
        asset_class = "etf" if symbol in _ETFS_HINT else "stocks"
    end = date.today()
    start = end - timedelta(days=_range_days(range_))
    text = cached_get(
        f"https://api.nasdaq.com/api/quote/{symbol}/historical",
        namespace="prices_nasdaq", key=f"{symbol}_{range_}", ttl_hours=12,
        headers={"User-Agent": _BROWSER_UA, "Accept": "application/json", "Accept-Language": "en-US,en;q=0.9"},
        params={"assetclass": asset_class, "fromdate": start.isoformat(), "todate": end.isoformat(), "limit": 9999},
    )
    data = json.loads(text).get("data") or {}
    rows = (data.get("tradesTable") or {}).get("rows") or []
    if not rows:
        raise RuntimeError(f"nasdaq: no rows for {symbol} ({asset_class})")

    def num(s: str) -> float:
        s = (s or "").replace("$", "").replace(",", "").strip()
        return float(s) if s not in ("", "N/A", "--") else float("nan")

    df = pd.DataFrame({
        "date": pd.to_datetime([r["date"] for r in rows], format="%m/%d/%Y"),
        "open": [num(r.get("open", "")) for r in rows], "high": [num(r.get("high", "")) for r in rows], "low": [num(r.get("low", "")) for r in rows],
        "close": [num(r["close"]) for r in rows],
        "volume": [num(r.get("volume", "0")) for r in rows],
    })
    df["adj_close"] = df["close"]   # split-adjusted, not dividend-adjusted
    time.sleep(0.25)
    return df.sort_values("date")


# ---------------------------------------------------------------- FRED
def _fred_level(series_id: str, range_: str) -> pd.DataFrame:
    from .fred import fetch_series
    s = fetch_series(series_id, start=(date.today() - timedelta(days=_range_days(range_))).isoformat())
    return pd.DataFrame({"date": s.index, "open": s.values, "high": s.values, "low": s.values, "close": s.values, "adj_close": s.values, "volume": 0.0})


# ---------------------------------------------------------------- public
def _clean(df: pd.DataFrame) -> pd.DataFrame:
    if df is None or df.empty:
        return _EMPTY.copy()
    df = df.dropna(subset=["close"]).drop_duplicates("date", keep="last").sort_values("date")
    df["volume"] = pd.to_numeric(df["volume"], errors="coerce").fillna(0)
    df["adj_close"] = df["adj_close"].fillna(df["close"])
    for c in ("open", "high", "low"):
        if c not in df.columns:
            df[c] = df["close"]
        df[c] = pd.to_numeric(df[c], errors="coerce").fillna(df["close"])
    return df[COLS].reset_index(drop=True)


def fetch_history(symbol: str, range_: str | None = None) -> pd.DataFrame:
    """Columns: date, close, adj_close, volume. Empty frame if every provider fails."""
    range_ = range_ or settings.price_range
    if symbol in _SPECIAL:
        provider, psym, cls = _SPECIAL[symbol]
        try:
            if provider == "fred":
                return _clean(_fred_level(psym, range_))
            return _clean(_nasdaq(psym, range_, cls))
        except Exception as e:
            print(f"[prices] {symbol}: {e}")
            return _EMPTY.copy()
    errors = []
    for provider in (_yahoo, _nasdaq):
        try:
            return _clean(provider(symbol, range_))
        except Exception as e:  # noqa: PERF203
            errors.append(f"{provider.__name__}: {e}")
    print(f"[prices] {symbol}: all providers failed ({'; '.join(errors)})")
    return _EMPTY.copy()
