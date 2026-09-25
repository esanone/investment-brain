"""FRED macro backbone.

With FRED_API_KEY set, uses the official API (supports ALFRED vintages later).
Without a key, falls back to FRED's public CSV export, which needs no key.
"""
from __future__ import annotations

import io

import pandas as pd

from ..config import settings
from .http import cached_get, cached_get_json

# Series used by the regime + risk engines, with the transformation the engines apply.
# transform: yoy | yoy_3m (3m annualised) | level | diff_3m | inv_yoy (lower is better)
MACRO_SERIES: dict[str, dict] = {
    # --- Growth ---
    "INDPRO": {"name": "Industrial Production", "dim": "growth", "transform": "yoy", "weight": 1.0},
    "PAYEMS": {"name": "Nonfarm Payrolls", "dim": "growth", "transform": "yoy_3m", "weight": 1.0},
    "ICSA": {"name": "Initial Jobless Claims", "dim": "growth", "transform": "inv_yoy", "weight": 1.0},
    "RSXFS": {"name": "Retail Sales ex Food Services", "dim": "growth", "transform": "yoy", "weight": 0.8},
    "GDPC1": {"name": "Real GDP", "dim": "growth", "transform": "yoy", "weight": 0.8},
    "UNRATE": {"name": "Unemployment Rate", "dim": "growth", "transform": "inv_diff_12m", "weight": 1.0},
    "HOUST": {"name": "Housing Starts", "dim": "growth", "transform": "yoy", "weight": 0.5},
    "CFNAI": {"name": "Chicago Fed National Activity Index", "dim": "growth", "transform": "level", "weight": 1.0},
    # --- Inflation ---
    "CPIAUCSL": {"name": "CPI", "dim": "inflation", "transform": "yoy", "weight": 1.0},
    "CPILFESL": {"name": "Core CPI", "dim": "inflation", "transform": "yoy", "weight": 1.0},
    "PCEPILFE": {"name": "Core PCE", "dim": "inflation", "transform": "yoy", "weight": 1.2},
    "PPIACO": {"name": "PPI All Commodities", "dim": "inflation", "transform": "yoy", "weight": 0.6},
    "AHETPI": {"name": "Avg Hourly Earnings", "dim": "inflation", "transform": "yoy", "weight": 0.8},
    "T5YIE": {"name": "5y Breakeven Inflation", "dim": "inflation", "transform": "level", "weight": 0.8},
    # --- Liquidity (higher score = easier conditions) ---
    "WALCL": {"name": "Fed Balance Sheet", "dim": "liquidity", "transform": "yoy", "weight": 1.0},
    "M2SL": {"name": "M2 Money Supply", "dim": "liquidity", "transform": "yoy", "weight": 1.0},
    "NFCI": {"name": "Chicago Fed Financial Conditions", "dim": "liquidity", "transform": "inv_level", "weight": 1.2},
    "BAMLH0A0HYM2": {"name": "High Yield OAS", "dim": "liquidity", "transform": "inv_level", "weight": 1.0},
    "DTWEXBGS": {"name": "Broad Dollar Index", "dim": "liquidity", "transform": "inv_yoy", "weight": 0.6},
    "DFII10": {"name": "10y Real Yield", "dim": "liquidity", "transform": "inv_level", "weight": 0.8},
    "TOTBKCR": {"name": "Bank Credit", "dim": "liquidity", "transform": "yoy", "weight": 0.8},
    # --- Rates ---
    "FEDFUNDS": {"name": "Fed Funds Rate", "dim": "rates", "transform": "level", "weight": 1.0},
    "DGS2": {"name": "2y Treasury", "dim": "rates", "transform": "level", "weight": 1.0},
    "DGS10": {"name": "10y Treasury", "dim": "rates", "transform": "level", "weight": 1.0},
    "T10Y2Y": {"name": "2s10s Curve", "dim": "rates", "transform": "level", "weight": 1.0},
    "T10Y3M": {"name": "3m10y Curve", "dim": "rates", "transform": "level", "weight": 0.6},
    # --- Risk-only inputs ---
    "VIXCLS": {"name": "VIX", "dim": "risk", "transform": "level", "weight": 1.0},
}


def fetch_series(series_id: str, start: str = "2000-01-01") -> pd.Series:
    """Return a pd.Series indexed by date (float values, NaNs dropped)."""
    if settings.fred_api_key:
        data = cached_get_json(
            "https://api.stlouisfed.org/fred/series/observations",
            namespace="fred", key=f"{series_id}_api", ttl_hours=12,
            params={"series_id": series_id, "api_key": settings.fred_api_key,
                    "file_type": "json", "observation_start": start},
        )
        obs = data.get("observations", [])
        df = pd.DataFrame(obs)[["date", "value"]] if obs else pd.DataFrame(columns=["date", "value"])
    else:
        text = cached_get(
            f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={series_id}",
            namespace="fred", key=f"{series_id}_csv", ttl_hours=12, suffix=".csv",
        )
        df = pd.read_csv(io.StringIO(text))
        df.columns = ["date", "value"]
    df["date"] = pd.to_datetime(df["date"])
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    s = df.dropna().set_index("date")["value"].sort_index()
    return s[s.index >= pd.Timestamp(start)]


def fetch_all(start: str = "2000-01-01") -> dict[str, pd.Series]:
    out: dict[str, pd.Series] = {}
    for sid in MACRO_SERIES:
        try:
            out[sid] = fetch_series(sid, start)
        except Exception as e:  # keep going; the engine degrades gracefully
            print(f"[fred] {sid}: {e}")
    return out
