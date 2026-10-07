"""Income portfolio — an ETF book built for monthly / quarterly cash distributions.

Design (from the 2026-10-06 brief): with T-bills near 4% and the 10-year above 5%, the book is paid to hold short paper,
so it does not reach for yield. Floating-rate and short Treasuries plus AAA CLOs form the base; duration is added only
when the rate trend turns; covered-call equity income rides the sector with the inflows; midstream energy carries the
gas-to-data-centre thesis; rate-sensitive income (utilities, REITs, preferreds) and high yield wait for their triggers.

Rules
  Targets          : sleeve weights below; the reserve funds the triggers
  Trend filter     : equity-income ETFs must be above their 10-month average to be bought; otherwise their weight sits in T-bills
  Triggers         : duration add (10y yield below its 200-day average), high-yield add (HY spread > 4.5%),
                     rate-sensitive add (XLU / PFF / VNQ above trend), covered-call cut (Tech flow < 0 or Contraction > 40%)
  Stops            : an equity-income position down 10% from entry goes to T-bills
  Reinvest or cash : reinvest while the index regime gate is open, hold distributions as cash when it closes
  Cadence          : monthly trades, daily monitoring (distribution calendar and alerts refresh daily)
"""
from __future__ import annotations

from datetime import date
from typing import Optional

import numpy as np
import pandas as pd

from .common import r, wmean

RULES = {
    "targets": {   # symbol: (weight, sleeve)
        "SGOV": (0.15, "Floating & short"), "USFR": (0.10, "Floating & short"), "JAAA": (0.15, "Floating & short"),
        "IEF": (0.10, "Term"), "LQD": (0.05, "Term"),
        "JEPQ": (0.12, "Equity income"), "JEPI": (0.10, "Equity income"), "MLPX": (0.08, "Equity income"), "SCHD": (0.05, "Equity income"),
    },
    "reserve": 0.10, "reserve_symbol": "SGOV", "cash_symbol": "SGOV",
    "equity_income": ["JEPQ", "JEPI", "MLPX", "SCHD", "XLU", "PFF", "VNQ", "SPYI", "DGRO", "VYM", "AMLP", "BIZD"],
    "trend_days": 210,
    "duration_add": {"symbol": "IEF", "add": 0.10}, "hy_add": {"symbol": "HYG", "add": 0.10, "spread_min": 4.5},
    "rate_sensitive_add": {"symbols": ["XLU", "PFF", "VNQ"], "add_each": 0.05},
    "covered_call_cut": {"symbols": ["JEPQ", "JEPI"], "tech_flow_min": 0, "contraction_max": 40},
    "hard_stop_pct": -10.0,
    "recalibration_cadence": "monthly",
}
SUBSTITUTES = {"SGOV": ["BIL"], "USFR": ["TFLO"], "MLPX": ["AMLP"], "SCHD": ["DGRO", "VYM"], "JEPI": ["SPYI"]}


def _next_month(d: date) -> str:
    return date(d.year + (d.month == 12), d.month % 12 + 1, 1).isoformat()


def _trend(df: Optional[pd.DataFrame], days: int) -> Optional[dict]:
    if df is None or len(df) < 40:
        return None
    px = df.sort_values("date")["adj_close"]
    n = min(days, len(px))
    sma = float(px.iloc[-n:].mean()); last = float(px.iloc[-1])
    return {"last": r(last, 2), "sma": r(sma, 2), "dist_pct": r((last / sma - 1) * 100, 1), "above": bool(last > sma),
            "ret_12m": r((last / float(px.iloc[-252]) - 1) * 100, 1) if len(px) > 252 else None}


def _rates(macro: dict) -> dict:
    out = {}
    s10 = macro.get("DGS10")
    if s10 is not None and len(s10.dropna()) > 40:
        s10 = s10.dropna()
        n = min(200, len(s10))
        out["dgs10"] = r(float(s10.iloc[-1]), 2); out["dgs10_200d"] = r(float(s10.iloc[-n:].mean()), 2)
        out["dgs10_below_200d"] = bool(s10.iloc[-1] < s10.iloc[-n:].mean())
    for sid, key in (("DGS2", "dgs2"), ("FEDFUNDS", "fedfunds"), ("BAMLH0A0HYM2", "hy_spread"), ("VIXCLS", "vix"), ("DFII10", "real_10y"), ("T10Y2Y", "curve_10y2y")):
        s = macro.get(sid)
        if s is not None and len(s.dropna()):
            out[key] = r(float(s.dropna().iloc[-1]), 2)
    return out


def compute(prices: dict, instruments: list[dict], yields: dict[str, dict], regime: dict, flows: dict, risk: dict, macro: dict,
            prior: Optional[dict], portfolio_value: float, as_of: Optional[date] = None) -> dict:
    today = as_of or date.today()
    names = {i["symbol"]: i["name"] for i in instruments}
    probs = regime.get("regime", {}).get("probabilities", {}) or {}
    gate = regime.get("index_gate") or {}
    gate_open = bool(gate.get("open", True))
    flow_idx = {i["symbol"]: i for g in flows.get("groups", {}).values() for i in g}
    rates = _rates(macro)
    trend = {s: _trend(prices.get(s), RULES["trend_days"]) for s in set(RULES["targets"]) | set(RULES["equity_income"]) | set(yields) | {"HYG", "BIL", "TFLO"} if s in prices}

    def px(s):
        t = trend.get(s)
        return t["last"] if t else None

    def y(s):
        d = yields.get(s) or {}
        return d.get("yield_ttm_pct")

    # --- triggers
    tech_flow = (flow_idx.get("XLK") or {}).get("score")
    contraction = probs.get("Contraction") or 0
    triggers = [
        {"id": "duration_add", "label": "Add duration (IEF to 20%)", "active": bool(rates.get("dgs10_below_200d")),
         "detail": f"10-year {rates.get('dgs10')}% vs its 200-day average {rates.get('dgs10_200d')}%", "action": "IEF +10% from the reserve when the 10-year is below its 200-day average"},
        {"id": "hy_add", "label": "Add high yield (HYG 10%)", "active": bool((rates.get("hy_spread") or 0) > RULES["hy_add"]["spread_min"]),
         "detail": f"High-yield spread {rates.get('hy_spread')}% vs {RULES['hy_add']['spread_min']}% needed", "action": "HYG +10% from the reserve when spreads exceed 4.5%"},
        {"id": "covered_call_cut", "label": "Halve covered-call income", "active": bool((tech_flow is not None and tech_flow < RULES["covered_call_cut"]["tech_flow_min"]) or contraction > RULES["covered_call_cut"]["contraction_max"]),
         "detail": f"Tech flow {tech_flow}, Contraction probability {contraction}%", "action": "JEPQ and JEPI halved into T-bills when Tech flows turn negative or Contraction passes 40%"},
    ]
    for s in RULES["rate_sensitive_add"]["symbols"]:
        t = trend.get(s)
        triggers.append({"id": f"rate_sensitive_{s}", "label": f"Add {s} (rate-sensitive income)", "active": bool(t and t["above"]),
                         "detail": f"{s} {t['dist_pct']:+.1f}% vs its 10-month average" if t else f"{s}: no price history", "action": f"{s} +5% from the reserve when back above its 10-month average"})
    reinvest = gate_open
    active = {t["id"] for t in triggers if t["active"]}

    # --- target weights after triggers and the trend filter
    targets = {s: w for s, (w, _) in RULES["targets"].items()}
    sleeve_of = {s: sl for s, (_, sl) in RULES["targets"].items()}
    reserve = RULES["reserve"]
    notes: dict[str, list[str]] = {s: [] for s in targets}
    if "duration_add" in active and reserve >= RULES["duration_add"]["add"]:
        targets["IEF"] += RULES["duration_add"]["add"]; reserve -= RULES["duration_add"]["add"]; notes["IEF"].append("Duration trigger: +10%")
    if "hy_add" in active and reserve >= RULES["hy_add"]["add"]:
        targets["HYG"] = RULES["hy_add"]["add"]; sleeve_of["HYG"] = "Term"; reserve -= RULES["hy_add"]["add"]; notes["HYG"] = ["High-yield trigger: spreads wide enough"]
    for s in RULES["rate_sensitive_add"]["symbols"]:
        if f"rate_sensitive_{s}" in active and reserve >= RULES["rate_sensitive_add"]["add_each"]:
            targets[s] = targets.get(s, 0) + RULES["rate_sensitive_add"]["add_each"]; sleeve_of[s] = "Equity income"; reserve -= RULES["rate_sensitive_add"]["add_each"]
            notes.setdefault(s, []).append("Back above its 10-month average")
    if "covered_call_cut" in active:
        for s in RULES["covered_call_cut"]["symbols"]:
            cut = targets[s] / 2; targets[s] -= cut; targets[RULES["cash_symbol"]] += cut; notes[s].append("Covered-call cut: halved into T-bills")
    targets[RULES["reserve_symbol"]] = targets.get(RULES["reserve_symbol"], 0) + reserve
    if reserve > 0:
        notes.setdefault(RULES["reserve_symbol"], []).append(f"Includes the {reserve:.0%} reserve that funds the triggers")
    parked = {}   # equity-income names below trend: reported so the page can show what is waiting in T-bills
    sleeve_of["RESERVE"] = "Reserve"
    # trend filter and substitutes
    final: dict[str, float] = {}
    for s, w in targets.items():
        if w <= 0:
            continue
        sym = s
        if px(sym) is None or y(sym) is None:
            for alt in SUBSTITUTES.get(s, []):
                if px(alt) is not None and y(alt) is not None:
                    notes.setdefault(alt, []).append(f"Stands in for {s} (no price or distribution data)"); sym = alt; break
        if px(sym) is None:
            notes.setdefault(RULES["cash_symbol"], []).append(f"{s}: no data, weight held in T-bills"); final[RULES["cash_symbol"]] = final.get(RULES["cash_symbol"], 0) + w; continue
        if sym in RULES["equity_income"] and trend.get(sym) and not trend[sym]["above"]:
            notes.setdefault(sym, []).append(f"Below its 10-month average ({trend[sym]['dist_pct']:+.1f}%): weight parked in T-bills until it recovers")
            notes.setdefault(RULES["cash_symbol"], []).append(f"Holds {sym}'s {w:.0%} until {sym} is back above its 10-month average ({trend[sym]['dist_pct']:+.1f}%)")
            final[RULES["cash_symbol"]] = final.get(RULES["cash_symbol"], 0) + w; parked[sym] = {"weight": w, "dist_pct": trend[sym]["dist_pct"]}; continue
        final[sym] = final.get(sym, 0) + w
        sleeve_of.setdefault(sym, sleeve_of.get(s, "Equity income"))

    # --- cadence
    prior_h = {h["symbol"]: h for h in (prior or {}).get("holdings", [])}
    last_recal = date.fromisoformat(prior["last_recalibration"]) if prior and prior.get("last_recalibration") else None
    recalibrate = prior is None or last_recal is None or (today.year, today.month) != (last_recal.year, last_recal.month)
    prior_nav = float((prior or {}).get("nav_index") or 1.0)
    period_ret = sum((px(s) / h["price"] - 1) * h["weight"] for s, h in prior_h.items() if px(s) and h.get("price")) if prior_h else 0.0
    nav = prior_nav * (1 + period_ret)
    nav_peak = max(float((prior or {}).get("nav_peak") or 1.0), nav)

    def income_fields(s: str, w: float) -> dict:
        d = yields.get(s) or {}
        dollars = w * portfolio_value
        annual = dollars * (d.get("yield_ttm_pct") or 0) / 100
        return {"yield_ttm_pct": d.get("yield_ttm_pct"), "yield_forward_pct": d.get("yield_forward_pct"), "frequency": d.get("frequency"), "last_amount": d.get("last_amount"),
                "last_ex_date": d.get("last_ex_date"), "next_pay_est": d.get("next_pay_est"), "payout_trend_pct": d.get("payout_trend_pct"), "pay_months": d.get("pay_months"),
                "annual_income": r(annual, 0), "monthly_income": r(annual / 12, 0)}

    def calendar(hold: list[dict]) -> list[dict]:
        out = []
        for k in range(12):
            m = (today.month - 1 + k) % 12 + 1
            yr = today.year + (today.month - 1 + k) // 12
            inc = 0.0
            for h in hold:
                pm = h.get("pay_months") or []
                per = {"monthly": 12, "quarterly": 4, "semi-annual": 2, "annual": 1}.get(h.get("frequency") or "", 12)
                if m in pm:
                    inc += (h["annual_income"] or 0) / per
            out.append({"month": f"{yr}-{m:02d}", "income": r(inc, 0)})
        return out

    if not recalibrate:
        held, alerts = [], []
        for s, h in prior_h.items():
            p = px(s)
            row = {**h, **income_fields(s, h["weight"]), "price": p or h.get("price"), "trend": trend.get(s) or h.get("trend"),
                   "pnl_pct": r((p / h["entry_price"] - 1) * 100, 1) if p and h.get("entry_price") else h.get("pnl_pct"), "status": "held"}
            if s in RULES["equity_income"] and row["pnl_pct"] is not None and row["pnl_pct"] <= RULES["hard_stop_pct"]:
                alerts.append({"symbol": s, "name": h["name"], "weight": h["weight"], "alert": f"Down {row['pnl_pct']:.1f}% from entry: sell to T-bills at the next recalibration (hard stop)"})
            if s in RULES["equity_income"] and trend.get(s) and not trend[s]["above"]:
                alerts.append({"symbol": s, "name": h["name"], "weight": h["weight"], "alert": f"Below its 10-month average ({trend[s]['dist_pct']:+.1f}%)"})
            held.append(row)
        for t in triggers:
            was = {x["id"]: x["active"] for x in (prior or {}).get("triggers", [])}
            if t["active"] and not was.get(t["id"]):
                alerts.append({"symbol": "—", "name": t["label"], "weight": None, "alert": f"Trigger now active: {t['detail']} -> {t['action']} at the next recalibration"})
        annual = sum(h["annual_income"] or 0 for h in held)
        return {**prior, "as_of": today.isoformat(), "holdings": held, "trades": [], "alerts": alerts, "triggers": triggers, "rates": rates,
                "reinvest": {"recommendation": "reinvest" if reinvest else "hold as cash", "why": "index regime gate open" if reinvest else "index regime gate closed"},
                "income": {**prior.get("income", {}), "annual": r(annual, 0), "monthly_avg": r(annual / 12, 0), "blended_yield_pct": r(annual / portfolio_value * 100, 2),
                           "by_month": calendar(held), "monthly_share_pct": r(sum(h["annual_income"] or 0 for h in held if h.get("frequency") == "monthly") / annual * 100, 0) if annual else None},
                "cadence": {"mode": "monitor", "last_recalibration": last_recal.isoformat(), "next_recalibration": _next_month(today)},
                "nav_index": r(nav, 4), "nav_peak": r(nav_peak, 4), "drawdown_pct": r((nav / nav_peak - 1) * 100, 2), "period_return_pct": r(period_ret * 100, 2),
                "regime": regime.get("regime", {}).get("label"), "risk_label": risk.get("label"), "regime_gate": {"open": gate_open, "note": gate.get("note")}}

    # --- recalibration: apply hard stops, build holdings and trades
    stopped = []
    for s, h in prior_h.items():
        p = px(s)
        if s in RULES["equity_income"] and p and h.get("entry_price") and (p / h["entry_price"] - 1) * 100 <= RULES["hard_stop_pct"] and s in final:
            stopped.append(s); final[RULES["cash_symbol"]] = final.get(RULES["cash_symbol"], 0) + final.pop(s)
            notes.setdefault(RULES["cash_symbol"], []).append(f"{s} stopped out ({(p / h['entry_price'] - 1) * 100:.1f}%): weight moved to T-bills")
    holdings = []
    for s, w in sorted(final.items(), key=lambda kv: -kv[1]):
        p, prev = px(s), prior_h.get(s)
        entry = prev.get("entry_price") if prev else p
        holdings.append({"symbol": s, "name": names.get(s, s), "sleeve": sleeve_of.get(s, "Equity income"), "weight": r(w, 4), "dollars": r(w * portfolio_value, 0),
                         "shares": r(w * portfolio_value / p, 1) if p else None, "price": p, "entry_price": entry, "entered": prev.get("entered") if prev else today.isoformat(),
                         "pnl_pct": r((p / entry - 1) * 100, 1) if p and entry else 0.0, "status": "held" if prev else "new", "prior_weight": prev["weight"] if prev else None,
                         "trend": trend.get(s), "flow": (flow_idx.get(s) or {}).get("score"), "notes": notes.get(s, []), **income_fields(s, w)})
    trades = []
    now = {h["symbol"]: h for h in holdings}
    for s, h in prior_h.items():
        if s not in now:
            trades.append({"action": "SELL", "symbol": s, "name": h["name"], "from": h["weight"], "to": 0.0, "reason": "Stopped out" if s in stopped else "Dropped by the rules (trend filter or trigger reversal)"})
    for s, h in now.items():
        if h["status"] == "new":
            trades.append({"action": "BUY", "symbol": s, "name": h["name"], "from": 0.0, "to": h["weight"], "reason": f"{h['sleeve']}: yield {h['yield_ttm_pct']}% ({h['frequency']})" + (" · " + h["notes"][0] if h["notes"] else "")})
        elif abs(h["weight"] - h["prior_weight"]) >= 0.01:
            trades.append({"action": "ADD" if h["weight"] > h["prior_weight"] else "TRIM", "symbol": s, "name": h["name"], "from": h["prior_weight"], "to": h["weight"], "reason": "; ".join(h["notes"]) or "Rebalance"})
    for t in trades:
        t["dollars"] = r((t["to"] - t["from"]) * portfolio_value, 0)
    annual = sum(h["annual_income"] or 0 for h in holdings)
    sleeves: dict[str, float] = {}
    for h in holdings:
        sleeves[h["sleeve"]] = sleeves.get(h["sleeve"], 0) + h["weight"]
    cands = []
    for s in sorted(set(trend) | set(yields)):
        if s in ("SPY",):
            continue
        d = yields.get(s) or {}
        cands.append({"symbol": s, "name": names.get(s, s), "yield_ttm_pct": d.get("yield_ttm_pct"), "yield_forward_pct": d.get("yield_forward_pct"), "frequency": d.get("frequency"),
                      "payout_trend_pct": d.get("payout_trend_pct"), "trend": trend.get(s), "flow": (flow_idx.get(s) or {}).get("score"), "held": s in now})
    cands.sort(key=lambda c: -(c["yield_ttm_pct"] or 0))
    return {
        "as_of": today.isoformat(), "portfolio_value": portfolio_value, "rules": RULES, "is_initial": prior is None, "prior_as_of": (prior or {}).get("as_of"),
        "last_recalibration": today.isoformat(), "cadence": {"mode": "recalibrate", "last_recalibration": today.isoformat(), "next_recalibration": _next_month(today)},
        "regime": regime.get("regime", {}).get("label"), "risk_label": risk.get("label"), "regime_gate": {"open": gate_open, "note": gate.get("note")}, "rates": rates,
        "holdings": holdings, "trades": trades, "alerts": [], "triggers": triggers, "sleeves": {k: r(v, 4) for k, v in sleeves.items()},
        "reinvest": {"recommendation": "reinvest" if reinvest else "hold as cash", "why": "index regime gate open: distributions are reinvested at the next recalibration" if reinvest else "index regime gate closed: distributions stay in cash"},
        "income": {"annual": r(annual, 0), "monthly_avg": r(annual / 12, 0), "blended_yield_pct": r(annual / portfolio_value * 100, 2), "by_month": calendar(holdings),
                   "monthly_share_pct": r(sum(h["annual_income"] or 0 for h in holdings if h.get("frequency") == "monthly") / annual * 100, 0) if annual else None,
                   "equity_income_share_pct": r(sum(h["annual_income"] or 0 for h in holdings if h["sleeve"] == "Equity income") / annual * 100, 0) if annual else None},
        "parked": [{"symbol": k, "name": names.get(k, k), **v} for k, v in parked.items()],
        "candidates": cands, "stats": {"positions": len(holdings), "weighted_yield_pct": r(wmean([(h["yield_ttm_pct"], h["weight"]) for h in holdings]), 2),
                                        "turnover": r(sum(abs(t["to"] - t["from"]) for t in trades) / 2, 3)},
        "nav_index": r(nav, 4), "nav_peak": r(nav_peak, 4), "drawdown_pct": r((nav / nav_peak - 1) * 100, 2), "period_return_pct": r(period_ret * 100, 2),
    }
