"""ETF Book — an alternative, ETF-only portfolio built from the same engines (regime, flows, long-term themes,
risk posture). It is a separate book and a benchmark for the single-name portfolio: if it keeps up, the
stock-picking layer is not earning its complexity.

Rules
  Trend filter   : an ETF is eligible only above its 10-month (210-day) average (Faber); otherwise its sleeve goes to cash.
  Score          : 0.40 capital-flow rotation + 0.25 regime fit + 0.20 long-term theme conviction + 0.15 12-month momentum.
  Sleeves        : the Risk engine's posture (equities / Treasuries / cash / gold / credit / commodities).
  Equity sleeve  : core S&P 500 (30% of the sleeve, if in trend) + the top satellites by score, 12% cap each,
                   25% cap per correlation cluster; crypto at most 3% and only in trend with positive flows.
  Volatility     : whole-book target 10%; exposure scales down when realised volatility is above it.
  Cadence        : trades on the first run of each month; daily runs mark to market and flag trend breaks.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

import numpy as np
import pandas as pd

from . import pm
from .common import r, wmean
from .strategist import REGIME_SECTOR_FIT

RULES = {"trend_days": 210, "core_share": 0.30, "n_satellites": 7, "satellite_cap": 0.12, "cluster_cap": 0.25, "crypto_cap": 0.03,
         "target_vol": 0.10, "weights": {"flow": 0.40, "regime": 0.25, "theme": 0.20, "momentum": 0.15}}
ASSET_FIT = {   # regime -> fit 0-100 by ETF symbol / group
    "Goldilocks": {"VUG": 80, "QUAL": 70, "MTUM": 75, "IWM": 75, "IJH": 70, "VTV": 50, "USMV": 40, "EFA": 60, "EEM": 65, "TLT": 55, "IEF": 55, "SHY": 35, "TIP": 40,
                   "LQD": 60, "HYG": 70, "GLD": 45, "SLV": 50, "DBC": 45, "USO": 40, "CPER": 60, "BTC-USD": 70, "ETH-USD": 70},
    "Reflation": {"VUG": 50, "QUAL": 55, "MTUM": 60, "IWM": 70, "IJH": 65, "VTV": 80, "USMV": 35, "EFA": 65, "EEM": 75, "TLT": 20, "IEF": 30, "SHY": 45, "TIP": 70,
                  "LQD": 45, "HYG": 60, "GLD": 60, "SLV": 70, "DBC": 85, "USO": 85, "CPER": 85, "BTC-USD": 60, "ETH-USD": 60},
    "Stagflation": {"VUG": 30, "QUAL": 55, "MTUM": 45, "IWM": 30, "IJH": 35, "VTV": 60, "USMV": 70, "EFA": 45, "EEM": 40, "TLT": 25, "IEF": 35, "SHY": 70, "TIP": 80,
                    "LQD": 35, "HYG": 30, "GLD": 85, "SLV": 70, "DBC": 80, "USO": 80, "CPER": 55, "BTC-USD": 40, "ETH-USD": 35},
    "Contraction": {"VUG": 40, "QUAL": 65, "MTUM": 40, "IWM": 25, "IJH": 30, "VTV": 45, "USMV": 80, "EFA": 40, "EEM": 30, "TLT": 85, "IEF": 80, "SHY": 70, "TIP": 50,
                    "LQD": 55, "HYG": 25, "GLD": 75, "SLV": 45, "DBC": 30, "USO": 25, "CPER": 30, "BTC-USD": 30, "ETH-USD": 25},
}
SLEEVE_OF = {"bond": "Treasuries", "commodity": "Commodities", "crypto": "Equities"}
SLEEVE_ETFS = {"Treasuries": ["TLT", "IEF", "TIP", "SHY"], "Credit": ["LQD", "HYG"], "Gold": ["GLD"], "Commodities": ["DBC", "USO", "CPER", "SLV"]}
EQUITY_GROUPS = ("sector", "industry", "factor", "size", "region")


def _trend(df: Optional[pd.DataFrame], days: int) -> Optional[dict]:
    if df is None or len(df) < days + 5:
        return None
    p = df.sort_values("date")["adj_close"]
    sma = float(p.iloc[-days:].mean()); last = float(p.iloc[-1])
    ret = lambda n: float(last / p.iloc[-1 - n] - 1) * 100 if len(p) > n else None  # noqa: E731
    return {"last": r(last, 2), "sma": r(sma, 2), "above": last > sma, "dist_pct": r((last / sma - 1) * 100, 1),
            "ret_1m": r(ret(21), 1), "ret_3m": r(ret(63), 1), "ret_12m": r(ret(252), 1)}


def compute(prices: dict[str, pd.DataFrame], instruments: list[dict], regime: dict, flows: dict, risk: dict, longterm: Optional[dict],
            graph: list[dict], prior: Optional[dict], portfolio_value: float, as_of: Optional[date] = None) -> dict:
    today = as_of or date.today()
    probs = regime.get("regime", {}).get("probabilities", {})
    flow_idx = {i["symbol"]: i for g in flows.get("groups", {}).values() for i in g}
    lt = (longterm or {}).get("theme_conviction", {})
    etf_theme: dict[str, tuple[float, str]] = {}
    for n in graph:
        conv = lt.get(n["id"])
        if conv is None:
            continue
        for e in n.get("related_etfs") or []:
            if e not in etf_theme or conv > etf_theme[e][0]:
                etf_theme[e] = (conv, n["name"])

    rows = {}
    for inst in instruments:
        sym, group = inst["symbol"], inst["group"]
        if sym == "^VIX":
            continue
        tr = _trend(prices.get(sym), RULES["trend_days"])
        if not tr:
            continue
        f = flow_idx.get(sym, {})
        flow = None if f.get("score") is None else (f["score"] + 100) / 2
        if group == "sector" and inst.get("sector"):
            fit = sum(REGIME_SECTOR_FIT[k].get(inst["sector"], 50) * v / 100 for k, v in probs.items()) if probs else 50
        else:
            fit = sum(ASSET_FIT[k].get(sym, 55) * v / 100 for k, v in probs.items()) if probs else 55
        th = etf_theme.get(sym)
        theme = th[0] * 100 if th else None
        mom = None if tr["ret_12m"] is None else float(np.clip(50 + tr["ret_12m"] * 1.2, 0, 100))
        W = RULES["weights"]
        score = wmean([(flow, W["flow"]), (fit, W["regime"]), (theme, W["theme"]), (mom, W["momentum"])])
        rows[sym] = {"symbol": sym, "name": inst["name"], "group": group, "sector": inst.get("sector"), "score": r(score, 0),
                     "components": {"flow": r(flow, 0), "regime": r(fit, 0), "theme": r(theme, 0), "momentum": r(mom, 0)},
                     "theme": th[1] if th else None, "trend": tr, "eligible": bool(tr["above"])}

    posture = risk.get("posture", {}).get("recommended", {}) or {"Equities": 65, "Treasuries": 12, "Cash": 8, "Gold": 5, "Credit": 5, "Commodities": 5}
    tot = sum(posture.values()) or 100
    sleeve_w = {k: v / tot for k, v in posture.items()}
    holdings: list[dict] = []
    cash = sleeve_w.get("Cash", 0.0)

    def add(sym: str, w: float, role: str):
        if w <= 0.0005:
            return
        row = rows[sym]
        holdings.append({**row, "weight": w, "role": role})

    # --- equity sleeve: core + satellites
    eq = sleeve_w.get("Equities", 0.0)
    core = rows.get("SPY")
    core_w = eq * RULES["core_share"] if core and core["eligible"] else 0.0
    if core_w:
        add("SPY", core_w, "core")
    else:
        cash += eq * RULES["core_share"]
    sat_budget = eq - eq * RULES["core_share"]
    cands = sorted((x for x in rows.values() if x["group"] in EQUITY_GROUPS and x["eligible"] and x["score"] is not None), key=lambda x: -x["score"])
    ret = pm.returns_matrix(prices, [c["symbol"] for c in cands[:25]])
    cl = pm.clusters(ret, 0.85)
    cluster_w: dict[int, float] = {}
    chosen = []
    for c in cands:
        if len(chosen) >= RULES["n_satellites"]:
            break
        cid = cl.get(c["symbol"])
        if cid is not None and cluster_w.get(cid, 0) >= 2:      # at most two satellites from one correlation cluster
            continue
        chosen.append(c)
        if cid is not None:
            cluster_w[cid] = cluster_w.get(cid, 0) + 1
    if chosen:
        tot_s = sum(max(c["score"] - 40, 5) for c in chosen)
        for c in chosen:
            w = min(RULES["satellite_cap"], sat_budget * max(c["score"] - 40, 5) / tot_s)
            add(c["symbol"], w, "satellite")
        cash += sat_budget - sum(h["weight"] for h in holdings if h["role"] == "satellite")
    else:
        cash += sat_budget
    # crypto: tiny, only in trend with positive flow
    for sym in ("BTC-USD",):
        c = rows.get(sym)
        if c and c["eligible"] and (c["components"]["flow"] or 0) > 60 and cash >= RULES["crypto_cap"]:
            add(sym, RULES["crypto_cap"], "satellite"); cash -= RULES["crypto_cap"]
    # --- other sleeves: best eligible ETF(s) of the sleeve, else cash
    for sleeve, syms in SLEEVE_ETFS.items():
        w = sleeve_w.get(sleeve, 0.0)
        elig = sorted((rows[s] for s in syms if s in rows and rows[s]["eligible"] and rows[s]["score"] is not None), key=lambda x: -x["score"])
        if not elig:
            cash += w; continue
        if len(elig) >= 2 and sleeve in ("Treasuries", "Commodities"):
            add(elig[0]["symbol"], w * 0.6, sleeve.lower()); add(elig[1]["symbol"], w * 0.4, sleeve.lower())
        else:
            add(elig[0]["symbol"], w, sleeve.lower())
    # --- volatility targeting on the whole book
    weights = {h["symbol"]: h["weight"] for h in holdings}
    vol = pm.portfolio_vol(pm.returns_matrix(prices, list(weights)), weights)
    scale = 1.0
    if vol and vol > RULES["target_vol"]:
        scale = max(0.5, RULES["target_vol"] / vol)
        for h in holdings:
            h["weight"] *= scale
        cash += (1 - scale) * sum(weights.values())
    weights = {h["symbol"]: h["weight"] for h in holdings}
    vol_after = pm.portfolio_vol(pm.returns_matrix(prices, list(weights)), weights)
    bench = prices.get("SPY")
    beta = None
    if bench is not None and weights:
        b = bench.sort_values("date").set_index("date")["adj_close"].pct_change().iloc[-60:]
        retm = pm.returns_matrix(prices, list(weights))
        beta_eq = pm.beta_to(retm, b, weights)
        beta = None if beta_eq is None else beta_eq * sum(weights.values())

    # --- cadence: monthly trades, daily monitoring
    prior_h = {h["symbol"]: h for h in (prior or {}).get("holdings", [])}
    last_recal = date.fromisoformat(prior["last_recalibration"]) if prior and prior.get("last_recalibration") else None
    recalibrate = prior is None or last_recal is None or (today.year, today.month) != (last_recal.year, last_recal.month)
    prior_nav = float((prior or {}).get("nav_index") or 1.0)
    period_ret = sum((rows[s]["trend"]["last"] / h["trend"]["last"] - 1) * h["weight"] for s, h in prior_h.items()
                     if s in rows and h.get("trend", {}).get("last")) if prior_h else 0.0
    nav = prior_nav * (1 + period_ret)
    nav_peak = max(float((prior or {}).get("nav_peak") or 1.0), nav)
    if not recalibrate:
        alerts = [{"symbol": s, "name": h["name"], "weight": h["weight"], "alert": f"Below its 10-month average ({rows[s]['trend']['dist_pct']:+.1f}%): exit at the next recalibration"}
                  for s, h in prior_h.items() if s in rows and not rows[s]["eligible"]]
        held = [{**h, "trend": rows[h["symbol"]]["trend"] if h["symbol"] in rows else h.get("trend"),
                 "score": rows[h["symbol"]]["score"] if h["symbol"] in rows else h.get("score"),
                 "pnl_pct": r((rows[h["symbol"]]["trend"]["last"] / h["entry_price"] - 1) * 100, 1) if h["symbol"] in rows and h.get("entry_price") else None}
                for h in prior.get("holdings", [])]
        return {**prior, "as_of": today.isoformat(), "holdings": held, "trades": [], "alerts": alerts, "candidates": sorted(rows.values(), key=lambda x: -(x["score"] or 0))[:25],
                "cadence": {"mode": "monitor", "last_recalibration": last_recal.isoformat(), "next_recalibration": date(today.year + (today.month == 12), today.month % 12 + 1, 1).isoformat()},
                "nav_index": r(nav, 4), "nav_peak": r(nav_peak, 4), "drawdown_pct": r((nav / nav_peak - 1) * 100, 2), "period_return_pct": r(period_ret * 100, 2),
                "risk_label": risk.get("label"), "regime": regime.get("regime", {}).get("label")}

    out_h = []
    for h in sorted(holdings, key=lambda x: -x["weight"]):
        prev = prior_h.get(h["symbol"])
        out_h.append({**h, "weight": r(h["weight"], 4), "dollars": r(h["weight"] * portfolio_value, 0),
                      "shares": r(h["weight"] * portfolio_value / h["trend"]["last"], 1) if h["trend"]["last"] else None,
                      "entry_price": prev.get("entry_price") if prev else h["trend"]["last"], "entered": prev.get("entered") if prev else today.isoformat(),
                      "pnl_pct": r((h["trend"]["last"] / prev["entry_price"] - 1) * 100, 1) if prev and prev.get("entry_price") else 0.0,
                      "status": "held" if prev else "new", "prior_weight": prev["weight"] if prev else None})
    trades = []
    now = {h["symbol"]: h for h in out_h}
    for s, h in prior_h.items():
        if s not in now:
            trades.append({"action": "SELL", "symbol": s, "name": h["name"], "from": h["weight"], "to": 0.0,
                           "reason": "Below its 10-month average" if s in rows and not rows[s]["eligible"] else "Replaced by a higher-scoring ETF"})
    for s, h in now.items():
        if h["status"] == "new":
            trades.append({"action": "BUY", "symbol": s, "name": h["name"], "from": 0.0, "to": h["weight"], "reason": f"{h['role']}: score {h['score']}, in trend"})
        elif abs(h["weight"] - h["prior_weight"]) >= 0.01:
            trades.append({"action": "ADD" if h["weight"] > h["prior_weight"] else "TRIM", "symbol": s, "name": h["name"], "from": h["prior_weight"], "to": h["weight"], "reason": "Rebalance"})
    for t in trades:
        t["dollars"] = r((t["to"] - t["from"]) * portfolio_value, 0)
    cash = max(0.0, 1 - sum(h["weight"] for h in out_h))
    by_role: dict[str, float] = {}
    for h in out_h:
        by_role[h["role"]] = by_role.get(h["role"], 0) + h["weight"]
    return {
        "as_of": today.isoformat(), "portfolio_value": portfolio_value, "rules": RULES, "is_initial": prior is None,
        "cadence": {"mode": "recalibrate", "last_recalibration": today.isoformat(), "next_recalibration": date(today.year + (today.month == 12), today.month % 12 + 1, 1).isoformat()},
        "last_recalibration": today.isoformat(), "holdings": out_h, "trades": trades, "alerts": [],
        "cash_weight": r(cash, 4), "sleeves": {k: r(v, 4) for k, v in sleeve_w.items()}, "by_role": {k: r(v, 4) for k, v in by_role.items()},
        "stats": {"positions": len(out_h), "portfolio_vol_pct": r((vol_after or 0) * 100, 1), "vol_before_targeting_pct": r((vol or 0) * 100, 1), "vol_scale": r(scale, 2),
                  "beta_spy": r(beta, 2), "weighted_score": r(wmean([(h["score"], h["weight"]) for h in out_h]), 0), "turnover": r(sum(abs(t["to"] - t["from"]) for t in trades) / 2, 3)},
        "candidates": sorted(rows.values(), key=lambda x: -(x["score"] or 0))[:25],
        "excluded_by_trend": [{"symbol": x["symbol"], "name": x["name"], "group": x["group"], "dist_pct": x["trend"]["dist_pct"], "score": x["score"]}
                              for x in sorted(rows.values(), key=lambda x: -(x["score"] or 0)) if not x["eligible"]][:20],
        "nav_index": r(nav, 4), "nav_peak": r(nav_peak, 4), "drawdown_pct": r((nav / nav_peak - 1) * 100, 2), "period_return_pct": r(period_ret * 100, 2),
        "risk_label": risk.get("label"), "regime": regime.get("regime", {}).get("label"), "prior_as_of": (prior or {}).get("as_of"),
    }
