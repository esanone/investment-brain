"""Portfolio Engine (v2, long-term mode) — turns the research into a rules-based book and
recalibrates it every run.

Conviction (what to own)   = opportunity x expectations gap x long-term theme conviction
                             (Human Future engine) x attention flags x macro fit
Entry gate (when to buy)   = Minervini-style trend template: stage-2 uptrend, price above rising
                             150/200-day averages, within 25% of the 52-week high, positive
                             6-month relative strength; no entries inside an earnings window
Sizing (how much)          = equal-risk: 1% of the book at risk per position, so the weight is
                             risk budget / stop distance, capped per position/sector/theme
Exits (when to sell)       = frozen thesis-break rules; initial stop = max(2.5 x ATR, 10%); a
                             Chandelier trailing stop (3 x ATR below the highest close) once the
                             position is up 15%; hard loss cap 20%; 26-week time stop if under
                             water and below the 200-day; two consecutive "trim" calls in the
                             morning briefs halve the position, three exit it
Book-level risk            = the Risk engine's posture sets the equity CAP; cash is the default
                             when too few names pass the gate; after 3+ stop-outs in one run new
                             entries are half-sized (cool-down)
Everything is auditable: every holding carries its entry price, stop, trailing high, P&L, the
rules that were frozen at entry, and the reason it is in (or out) this week.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

from .common import r, wmean
from .fundamentals import ORDER_DECAY

RULES = {
    "mode": "long_term",
    "max_positions": 20, "min_positions": 8, "max_weight": 0.08, "initial_max_weight": 0.05, "min_weight": 0.02,
    "sector_cap": 0.25, "theme_cap": 0.35,
    "min_opportunity": 55, "min_opportunity_incumbent": 50, "min_gap": 0, "min_ttm_quarters": 8,
    "technical_min_score": 75, "technical_required": True,
    "risk_per_position_pct": 1.0, "initial_stop_atr_mult": 2.0, "initial_stop_min_pct": 8.0, "hard_loss_cap_pct": 12.0,
    "trail_activation_gain_pct": 0.0, "trail_atr_mult": 3.0, "time_stop_weeks": 26, "trend_fail_runs": 2,
    "trim_gain_pct": 35.0, "trim_rsi": 75, "trim_fraction": 0.33,
    "regime_gate": True, "drawdown_ladder": [[-10.0, 0.5, 0.8], [-20.0, 0.25, 0.64]],   # [book drawdown %, risk-per-position multiplier, equity-cap multiplier]
    "brief_trim_consecutive": 2, "brief_exit_consecutive": 3,
    "earnings_blackout_days": 5, "cooldown_stopouts": 3,
    "rotation_break_threshold": -30, "rotation_break_days": 12,
    "rotation_entry_min": -30,       # no new entries into a sector whose rotation score is below this
    # Cadence: trades only at the monthly recalibration (first run of each calendar month); daily runs monitor.
    # Between recalibrations only the hard loss cap can force an exit. Trims into strength wait for long-term
    # capital-gains treatment (>= 365 days held) unless a rule fires.
    "recalibration_cadence": "monthly", "intra_month_exits": "hard_stop", "long_term_holding_days": 365,   # sector rotation must stay below -30 for two consecutive weeks of readings
    "incumbency_bonus": 1.10, "attention_not_priced_bonus": 1.15, "crowded_penalty": 0.75,
}
SLEEVE_PROXIES = {
    "Treasuries": [("IEF", "7-10y Treasuries", 0.6), ("TLT", "20+y Treasuries", 0.4)],
    "Cash": [("CASH", "Cash / T-bills (SHY proxy)", 1.0)],
    "Gold": [("GLD", "Gold", 1.0)],
    "Credit": [("LQD", "Investment-grade credit", 1.0)],
    "Commodities": [("DBC", "Broad commodities", 1.0)],
}


# ------------------------------------------------------------------ rule evaluation
def evaluate_rule(rule: dict, ctx: dict) -> dict:
    """ctx: latest fundamentals, momentum, sector_rotation, sector_rotation_prev, adverse_regime_prob, theme_trends, rs_3m."""
    m = rule["metric"]
    if m == "sector_rotation":
        # Mechanism-level rule (applies to legacy frozen rules too): the sector's rotation score must stay below the
        # threshold for every reading across at least `rotation_break_days` days, i.e. two consecutive weeks of runs.
        cur = ctx.get("sector_rotation")
        thr = RULES["rotation_break_threshold"]
        hist = [(d, v) for d, v in (ctx.get("sector_rotation_history") or []) if v is not None]
        if cur is not None:
            hist = hist + [(ctx.get("as_of"), cur)] if not hist or hist[-1][0] != ctx.get("as_of") else hist
        hit = False
        if cur is not None and cur < thr and len(hist) >= 2:
            from datetime import date as _date
            last = hist[-1][0]
            window = [(d, v) for d, v in hist if d and last and (last - d).days <= RULES["rotation_break_days"] + 2]
            span = (window[-1][0] - window[0][0]).days if len(window) >= 2 else 0
            hit = span >= RULES["rotation_break_days"] and all(v < thr for _, v in window)
        rule = {**rule, "threshold": thr, "label": rule.get("label", "sector rotation") + " (2 consecutive weeks)"}
    elif m == "adverse_regime_prob":
        cur = ctx.get("adverse_regime_prob")
        hit = cur is not None and cur > rule["threshold"]
    elif m == "dist_200dma":
        cur = ctx.get("momentum", {}).get("dist_200dma")
        hit = cur is not None and cur < rule["threshold"] and (not rule.get("and_negative_rs") or (ctx.get("rs_3m") or 0) < 0)
    elif m == "theme_trend":
        cur = ctx.get("theme_trends", {}).get(rule.get("theme_id"))
        hit = cur is not None and cur < rule["threshold"]
    else:
        cur = ctx.get("latest", {}).get(m)
        if cur is None:
            hit = False
        elif rule["op"] == "<":
            hit = cur < rule["threshold"]
        else:
            hit = cur > rule["threshold"]
    return {**rule, "current": r(cur, 4) if isinstance(cur, float) else cur, "triggered": bool(hit)}


def _next_recalibration(today: date) -> str:
    y, m = (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
    return date(y, m, 1).isoformat()


def _monitor(prior: dict, strategies: dict, analyses: dict, companies: dict, risk: dict, flows: dict, regime: dict,
             themes_by_id: dict, technicals: dict, briefs: list, rotation_history: Optional[dict], portfolio_value: float,
             today: date, prior_flows: Optional[dict], last_recal: date) -> dict:
    """Between monthly recalibrations: carry the book, mark to market, re-evaluate every rule and stop, and record
    ALERTS (what would trade at the next recalibration). Only the hard loss cap forces an exit now."""
    probs = regime.get("regime", {}).get("probabilities", {})
    adverse = (probs.get("Stagflation") or 0) + (probs.get("Contraction") or 0)
    rot = flows.get("sector_rotation", {})
    rot_prev = (prior_flows or {}).get("sector_rotation", {}) if prior_flows else {}
    theme_trends = {k: v.get("trend") for k, v in themes_by_id.items()}
    bench_3m = flows.get("benchmark", {}).get("return_3m") or 0
    holdings, trades, alerts, exits = [], [], [], []
    for h in prior.get("holdings", []):
        t = h["ticker"]
        a = analyses.get(t)
        price = float(a["price"]) if a and a.get("price") else float(h.get("price") or 0)
        entry = float(h.get("entry_price") or price)
        trail_high = max(float(h.get("trail_high") or entry), price)
        gain = (price / entry - 1) * 100 if entry else 0.0
        ta = (technicals or {}).get(t) or {}
        stops = _stop_levels(entry, ta.get("atr20"), price, trail_high, gain) if price else h.get("stops")
        pending = []
        rule_status = h.get("rule_status")
        if a:
            ctx = {"latest": a["latest"], "momentum": a["momentum"], "sector_rotation": rot.get(companies.get(t, {}).get("sector")),
                   "sector_rotation_prev": rot_prev.get(companies.get(t, {}).get("sector")), "adverse_regime_prob": adverse, "as_of": today,
                   "sector_rotation_history": (rotation_history or {}).get(companies.get(t, {}).get("sector"), []),
                   "theme_trends": theme_trends, "rs_3m": (a["momentum"].get("return_3m") or 0) - bench_3m}
            rule_status = [evaluate_rule(r, ctx) for r in h.get("entry_rules", [])]
            for e in rule_status:
                if e["triggered"]:
                    pending.append(f"Thesis break: {e['label']} {e['op']} {e['threshold']} (now {e['current']})")
        if stops and price and price <= stops["active_stop"]:
            pending.append(f"Below {'trailing' if stops.get('trailing_stop') and stops['active_stop'] == stops['trailing_stop'] else 'initial'} stop {stops['active_stop']:.2f}")
        n_flags, flag_notes = _brief_flags(briefs or [], t)
        if n_flags >= RULES["brief_exit_consecutive"]:
            pending.append(f"Briefs flagged trim/review {n_flags} days running")
        hard_hit = bool(stops and price and price <= stops["hard_stop"])
        row = {**h, "price": price, "pnl_pct": r(gain, 1), "trail_high": r(trail_high, 2), "stops": stops, "rule_status": rule_status,
               "brief_flags": n_flags, "brief_notes": flag_notes, "status": "held", "prior_weight": h["weight"],
               "held_days": (today - date.fromisoformat(h["entered"])).days if h.get("entered") else None,
               "long_term_gain_eligible": bool(h.get("entered") and (today - date.fromisoformat(h["entered"])).days >= RULES["long_term_holding_days"]),
               "pending_actions": pending, "dollars": r(h["weight"] * portfolio_value, 0)}
        if hard_hit:
            exits.append({"ticker": t, "name": h.get("name"), "prior_weight": h["weight"], "entry_price": r(entry, 2), "exit_price": r(price, 2), "pnl_pct": r(gain, 1),
                          "reason": f"Hard loss cap: {price:.2f} is {gain:+.1f}% vs entry, below {stops['hard_stop']:.2f} (intra-month exit)"})
            trades.append({"action": "SELL", "ticker": t, "name": h.get("name"), "from": h["weight"], "to": 0.0, "reason": exits[-1]["reason"],
                           "dollars": r(-h["weight"] * portfolio_value, 0)})
            continue
        if pending:
            alerts.append({"ticker": t, "name": h.get("name"), "weight": h["weight"], "pnl_pct": r(gain, 1), "actions": pending,
                           "long_term_gain_eligible": row["long_term_gain_eligible"]})
        holdings.append(row)
    freed = sum(e["prior_weight"] for e in exits)
    sleeves = [dict(x) for x in prior.get("sleeves", [])]
    if freed > 0:
        cash = next((x for x in sleeves if x["symbol"] == "CASH"), None)
        if cash:
            cash["weight"] = r(cash["weight"] + freed, 4)
        else:
            sleeves.append({"symbol": "CASH", "name": "Cash / T-bills (SHY proxy)", "sleeve": "Cash", "weight": r(freed, 4)})
    prior_nav, prior_peak = float(prior.get("nav_index") or 1.0), float(prior.get("nav_peak") or 1.0)
    pairs = [(float(analyses[h["ticker"]]["price"]) / float(h["price"]) - 1, h["weight"]) for h in prior.get("holdings", [])
             if analyses.get(h["ticker"]) and analyses[h["ticker"]].get("price") and h.get("price")]
    period_ret = sum(rt * w for rt, w in pairs) if pairs else 0.0
    nav_index = prior_nav * (1 + period_ret)
    nav_peak = max(prior_peak, nav_index)
    out = {**prior, "as_of": today.isoformat(), "portfolio_value": portfolio_value, "rules": RULES,
           "cadence": {"mode": "monitor", "last_recalibration": last_recal.isoformat(), "next_recalibration": _next_recalibration(today),
                       "note": "Monthly cadence: positions trade only at the first run of each month (capital-gains awareness); "
                               "between runs the book is marked to market and rules are evaluated into alerts. Only the 12% hard loss cap exits intra-month."},
           "last_recalibration": last_recal.isoformat(),
           "holdings": holdings, "sleeves": sleeves, "trades": trades, "exits": exits, "alerts": alerts,
           "equity_weight": r(sum(h["weight"] for h in holdings), 4), "cash_weight": r(sum(x["weight"] for x in sleeves if x["sleeve"] == "Cash"), 4),
           "nav_index": r(nav_index, 4), "nav_peak": r(nav_peak, 4), "drawdown_pct": r((nav_index / nav_peak - 1) * 100, 2), "period_return_pct": r(period_ret * 100, 2),
           "risk_label": risk.get("label"), "regime": regime.get("regime", {}).get("label"),
           "is_initial": False, "prior_as_of": prior.get("as_of")}
    out["stats"] = {**prior.get("stats", {}), "positions": len(holdings), "book_pnl_pct": r(wmean([(h.get("pnl_pct"), h["weight"]) for h in holdings]), 1),
                    "turnover": r(freed, 3), "pending_alerts": len(alerts)}
    out.pop("memo", None)   # the memo belongs to the recalibration snapshot; the daily monitor keeps a pointer instead
    out["memo_from"] = prior.get("memo_from") or prior.get("as_of")
    out["memo"] = prior.get("memo")
    return out


def _theme_weights(exposures: list[dict]) -> dict[str, float]:
    return {e["theme_id"]: e["effective"] for e in exposures if e.get("effective")}


def _stop_levels(entry: float, atr_val: Optional[float], price_now: float, trail_high: float, gain_pct: float) -> dict:
    """Initial stop, trailing stop and the active stop for a position."""
    atr_dist = (RULES["initial_stop_atr_mult"] * atr_val) if atr_val else entry * RULES["initial_stop_min_pct"] / 100
    initial = entry - max(atr_dist, entry * RULES["initial_stop_min_pct"] / 100)
    hard = entry * (1 - RULES["hard_loss_cap_pct"] / 100)
    initial = max(initial, hard)
    trailing = None
    if gain_pct >= RULES["trail_activation_gain_pct"] and atr_val:
        trailing = trail_high - RULES["trail_atr_mult"] * atr_val       # Chandelier: highest close since entry - 3 x ATR, never lowered
    active = max([x for x in (initial, trailing) if x is not None])
    return {"initial_stop": r(initial, 2), "trailing_stop": r(trailing, 2), "active_stop": r(active, 2), "hard_stop": r(hard, 2),
            "stop_distance_pct": r((price_now - active) / price_now * 100, 1) if price_now else None}


def _brief_flags(briefs: list[dict], ticker: str) -> tuple[int, list[str]]:
    """Consecutive most-recent briefs that told us to trim/review this holding."""
    n, notes = 0, []
    for b in briefs:                       # newest first
        impl = {p["ticker"]: p for p in (b.get("llm") or {}).get("portfolio_implications", [])}
        p = impl.get(ticker)
        if p and p["action"] in ("trim", "review"):
            n += 1
            notes.append(f"{b['as_of']}: {p['action']} — {p['why'][:90]}")
        else:
            break
    return n, notes


# ------------------------------------------------------------------ construction
def compute(strategies: dict[str, dict], analyses: dict[str, dict], scores: dict[str, dict], companies: dict[str, dict],
            risk: dict, flows: dict, regime: dict, themes_by_id: dict[str, dict], prior: Optional[dict],
            portfolio_value: float, as_of: Optional[date] = None, prior_flows: Optional[dict] = None,
            technicals: Optional[dict[str, dict]] = None, longterm: Optional[dict] = None, attention: Optional[dict] = None,
            briefs: Optional[list[dict]] = None, rotation_history: Optional[dict[str, list]] = None) -> dict:
    """rotation_history: {sector: [(date, rotation_score), ...]} from prior flows snapshots (oldest first)."""
    today = as_of or date.today()
    technicals, briefs = technicals or {}, briefs or []
    probs = regime.get("regime", {}).get("probabilities", {})
    adverse = (probs.get("Stagflation") or 0) + (probs.get("Contraction") or 0)
    rot = flows.get("sector_rotation", {})
    rot_prev = (prior_flows or {}).get("sector_rotation", {}) if prior_flows else {}
    theme_trends = {k: v.get("trend") for k, v in themes_by_id.items()}
    lt_conv = (longterm or {}).get("theme_conviction", {})
    att_c = {c["ticker"]: c for c in (attention or {}).get("companies", [])}
    prior_holdings = {h["ticker"]: h for h in (prior or {}).get("holdings", [])}
    bench_3m = flows.get("benchmark", {}).get("return_3m") or 0
    prior_as_of = date.fromisoformat(prior["as_of"]) if prior and prior.get("as_of") else None
    last_recal = date.fromisoformat(prior["last_recalibration"]) if prior and prior.get("last_recalibration") else prior_as_of
    if RULES["recalibration_cadence"] == "monthly" and prior is not None and last_recal is not None:
        recalibrate = (today.year, today.month) != (last_recal.year, last_recal.month)
    else:
        recalibrate = True
    if not recalibrate:
        return _monitor(prior, strategies, analyses, companies, risk, flows, regime, themes_by_id, technicals, briefs,
                        rotation_history, portfolio_value, today, prior_flows, last_recal)

    # 0. Book-level: NAV index since inception (approximate: weighted returns of the names held between runs),
    #    Turtle drawdown ladder, and the Faber/Antonacci regime gate on the index
    prior_nav, prior_peak = float((prior or {}).get("nav_index") or 1.0), float((prior or {}).get("nav_peak") or 1.0)
    period_ret_pairs = []
    for t, h in prior_holdings.items():
        a = analyses.get(t)
        if a and a.get("price") and h.get("price"):
            period_ret_pairs.append((float(a["price"]) / float(h["price"]) - 1, h["weight"]))
    period_ret = sum(rt * w for rt, w in period_ret_pairs) if period_ret_pairs else 0.0   # cash/sleeves assumed flat
    nav_index = prior_nav * (1 + period_ret)
    nav_peak = max(prior_peak, nav_index)
    drawdown_pct = (nav_index / nav_peak - 1) * 100
    risk_mult, cap_mult, ladder_note = 1.0, 1.0, None
    for dd, rm, cm in RULES["drawdown_ladder"]:
        if drawdown_pct <= dd:
            risk_mult, cap_mult = rm, cm
            ladder_note = f"Book drawdown {drawdown_pct:.1f}% from peak: risk per position x{rm}, equity cap x{cm}"
    gate = (regime.get("index_gate") or {})
    gate_open = bool(gate.get("open", True)) if RULES["regime_gate"] else True
    if not gate_open:
        cap_mult *= 0.5

    # 1. Incumbents: frozen thesis rules, stops, time stop, brief flags
    exits: list[dict] = []
    trims: dict[str, dict] = {}
    incumbents_ok: dict[str, dict] = {}
    stopouts = 0
    for t, h in prior_holdings.items():
        st, a = strategies.get(t), analyses.get(t)
        if not st or not a or not a.get("price"):
            exits.append({"ticker": t, "name": h.get("name"), "reason": "No longer scored (data gap)", "prior_weight": h["weight"]})
            continue
        price = float(a["price"])
        entry = float(h.get("entry_price") or price)
        trail_high = max(float(h.get("trail_high") or entry), price)
        gain = (price / entry - 1) * 100
        ta = technicals.get(t) or {}
        stops = _stop_levels(entry, ta.get("atr20"), price, trail_high, gain)
        ctx = {"latest": a["latest"], "momentum": a["momentum"], "sector_rotation": rot.get(companies[t]["sector"]),
               "sector_rotation_prev": rot_prev.get(companies[t]["sector"]), "adverse_regime_prob": adverse, "as_of": today,
               "sector_rotation_history": (rotation_history or {}).get(companies[t]["sector"], []),
               "theme_trends": theme_trends, "rs_3m": (a["momentum"].get("return_3m") or 0) - bench_3m}
        evaluated = [evaluate_rule(rule, ctx) for rule in h.get("entry_rules", [])]
        triggered = [e for e in evaluated if e["triggered"]]
        reasons = []
        if triggered:
            reasons.append("Thesis break: " + "; ".join(f"{e['label']} {e['op']} {e['threshold']} (now {e['current']})" for e in triggered))
        if price <= stops["active_stop"]:
            kind = "trailing stop" if stops["trailing_stop"] and stops["active_stop"] == stops["trailing_stop"] else "initial stop"
            reasons.append(f"Price {price:.2f} closed below {kind} {stops['active_stop']:.2f} (entry {entry:.2f}, {gain:+.1f}%)")
            stopouts += 1
        entered = date.fromisoformat(h["entered"]) if h.get("entered") else today
        if (today - entered).days >= RULES["time_stop_weeks"] * 7 and gain < 0 and not a["momentum"].get("above_200dma", True):
            reasons.append(f"Time stop: {RULES['time_stop_weeks']} weeks in, {gain:+.1f}% and below the 200-day")
        # Weinstein: weekly close below a declining 30-week (150-day) average = Stage 4, exit
        if ta and ta.get("sma150") and ta.get("sma150_prev4w") and price < ta["sma150"] and ta["sma150"] < ta["sma150_prev4w"]:
            reasons.append(f"Stage-4 break: {price:.2f} below a declining 30-week average ({ta['sma150']:.2f})")
        tech_fails = int(h.get("tech_fail_runs") or 0) + (1 if ta and ta.get("score", 100) < 50 else 0) if ta else 0
        if ta and ta.get("score", 100) >= 50:
            tech_fails = 0
        if tech_fails >= RULES["trend_fail_runs"]:
            reasons.append(f"Trend template failed {tech_fails} runs in a row ({ta.get('passes')}/8 criteria)")
        n_flags, flag_notes = _brief_flags(briefs, t)
        if n_flags >= RULES["brief_exit_consecutive"]:
            reasons.append(f"Morning briefs flagged trim/review {n_flags} days running: " + flag_notes[0])
        if reasons:
            exits.append({"ticker": t, "name": h.get("name"), "prior_weight": h["weight"], "reason": " | ".join(reasons), "rules": evaluated,
                          "entry_price": r(entry, 2), "exit_price": r(price, 2), "pnl_pct": r(gain, 1)})
            continue
        info = {"rules": evaluated, "entry_price": entry, "trail_high": trail_high, "gain_pct": gain, "stops": stops, "flags": n_flags, "flag_notes": flag_notes,
                "tech_fail_runs": tech_fails}
        if n_flags >= RULES["brief_trim_consecutive"]:
            info["trim"] = {"fraction": 0.5, "reason": f"Briefs flagged trim/review {n_flags} days running: " + flag_notes[0]}
        elif gain >= RULES["trim_gain_pct"] and (ta.get("rsi14") or 0) >= RULES["trim_rsi"]:
            held_days = (today - entered).days
            if held_days >= RULES["long_term_holding_days"]:
                info["trim"] = {"fraction": RULES["trim_fraction"], "reason": f"Sell into strength: {gain:+.0f}% since entry with RSI {ta.get('rsi14'):.0f}"}
            else:
                info["deferred_trim"] = f"Trim into strength deferred: {gain:+.0f}% but held {held_days} days (< {RULES['long_term_holding_days']} for long-term gains)"
        incumbents_ok[t] = info
    cooldown = stopouts >= RULES["cooldown_stopouts"]

    # 2. Candidates with long-term conviction + technical gate
    cands, rejected = [], []
    for t, st in strategies.items():
        a, sc = analyses.get(t), scores.get(t, {})
        if not a or st.get("opportunity_score") is None or st.get("expectations_gap") is None:
            continue
        if t in {e["ticker"] for e in exits}:
            continue
        incumbent = t in incumbents_ok
        if not incumbent and not gate_open:
            rejected.append({"ticker": t, "reason": "Regime gate closed: index below its 10-month average and behind T-bills; no new entries", "score": None})
            continue
        sec_rot = rot.get(companies[t]["sector"])
        if not incumbent and sec_rot is not None and sec_rot < RULES["rotation_entry_min"]:
            rejected.append({"ticker": t, "reason": f"Capital leaving {companies[t]['sector']} (rotation {sec_rot:+.0f}); entry deferred", "score": None})
            continue
        min_opp = RULES["min_opportunity_incumbent"] if incumbent else RULES["min_opportunity"]
        if st["opportunity_score"] < min_opp or st["expectations_gap"] < RULES["min_gap"]:
            continue
        if a["data_quality"]["ttm_quarters"] < RULES["min_ttm_quarters"]:
            continue
        ta = technicals.get(t)
        notes = []
        if not incumbent and RULES["technical_required"] and ta is not None:
            if not ta["ready"] or ta["score"] < RULES["technical_min_score"]:
                rejected.append({"ticker": t, "reason": f"Technical gate: {ta['stage']} ({ta['passes']}/8 criteria)", "score": ta["score"]})
                continue
            if ta.get("overbought"):
                notes.append(f"Extended: RSI {ta['rsi14']:.0f}, half-sized until it cools")
        # earnings blackout: ~91 days after the last filing, entries wait until the print is out
        filed = a["latest"].get("filed")
        if not incumbent and filed and filed not in ("None", "NaT"):
            try:
                days_to_print = 91 - (today - date.fromisoformat(str(filed)[:10])).days
                if 0 <= days_to_print <= RULES["earnings_blackout_days"]:
                    rejected.append({"ticker": t, "reason": f"Earnings expected in ~{days_to_print} days; entry deferred", "score": None})
                    continue
            except ValueError:
                pass
        opp, gap = st["opportunity_score"], st["expectations_gap"]
        conviction = (opp - 50) * (1 + max(gap, 0) / 50)
        macro_fit = st.get("macro_fit") or 50
        conviction *= 1 + 0.2 * (macro_fit - 50) / 50
        exps = st.get("theme_exposures", [])
        lt = wmean([(lt_conv.get(e["theme_id"]), e["effective"]) for e in exps if e["theme_id"] in lt_conv])
        lt_mult = 0.7 + 0.6 * lt if lt is not None else 0.85
        conviction *= lt_mult
        if lt is not None:
            notes.append(f"Long-term theme conviction {lt:.2f} (x{lt_mult:.2f})")
        ac = att_c.get(t)
        if ac and ac.get("not_priced"):
            conviction *= RULES["attention_not_priced_bonus"]; notes.append("Attention rising, not yet priced")
        if ac and ac.get("crowded"):
            conviction *= RULES["crowded_penalty"]; notes.append("Crowded: attention and momentum both extreme")
        if incumbent:
            conviction *= RULES["incumbency_bonus"]
        if not incumbent and cooldown:
            conviction *= 0.5; notes.append("Cool-down: 3+ stop-outs this run, new entries half-sized")
        if ta and ta.get("overbought") and not incumbent:
            conviction *= 0.5
        cands.append({"ticker": t, "name": companies[t]["name"], "sector": companies[t]["sector"], "conviction": conviction,
                      "opportunity": opp, "gap": gap, "reality": st.get("reality"), "narrative": st.get("narrative"), "pricing": st.get("pricing"),
                      "quality": sc.get("quality"), "growth": sc.get("growth"), "value": sc.get("value"), "macro_fit": macro_fit,
                      "lt_conviction": r(lt, 2), "attention": (ac or {}).get("attention"), "price": a.get("price"), "notes": notes, "incumbent": incumbent,
                      "technical": ta, "themes": _theme_weights(exps), "top_theme": exps[0]["theme"] if exps else None,
                      "rationale": [c["label"] for c in st.get("checks", []) if c.get("ok")][:4]})
    cands.sort(key=lambda c: -c["conviction"])

    # 3. Equal-risk sizing under caps; equity posture is a cap, cash absorbs the rest
    equity_cap = (risk.get("posture", {}).get("recommended", {}).get("Equities") or 65) / 100 * cap_mult
    risk_budget = RULES["risk_per_position_pct"] / 100 * risk_mult
    chosen, skipped = [], []
    sector_w: dict[str, float] = {}
    theme_w: dict[str, float] = {}
    top_conv = cands[0]["conviction"] if cands else 1.0
    for c in cands:
        if len(chosen) >= RULES["max_positions"]:
            break
        ta = c["technical"] or {}
        price = c["price"] or 0
        entry = float(prior_holdings[c["ticker"]].get("entry_price") or price) if c["incumbent"] else price
        stops = _stop_levels(entry, ta.get("atr20"), price, max(entry, price), (price / entry - 1) * 100 if entry else 0) if price else None
        stop_dist = (stops["stop_distance_pct"] / 100) if stops and stops["stop_distance_pct"] and stops["stop_distance_pct"] > 0 else 0.12
        risk_w = risk_budget / stop_dist                         # weight such that a stop-out costs 1% of the book
        conv_scalar = 0.5 + 0.5 * (c["conviction"] / top_conv if top_conv > 0 else 0.5)
        w = min(RULES["max_weight"] if c["incumbent"] else RULES["initial_max_weight"], risk_w * conv_scalar)
        if w < RULES["min_weight"]:
            skipped.append({"ticker": c["ticker"], "reason": f"Size below {RULES['min_weight']:.0%} at 1% risk (stop {stop_dist:.0%} away)"})
            continue
        if sector_w.get(c["sector"], 0) + w > RULES["sector_cap"]:
            skipped.append({"ticker": c["ticker"], "reason": f"{c['sector']} sector cap {RULES['sector_cap']:.0%}"}); continue
        if any(theme_w.get(k, 0) + w * v > RULES["theme_cap"] for k, v in c["themes"].items()):
            skipped.append({"ticker": c["ticker"], "reason": "theme cap"}); continue
        if sum(x["weight"] for x in chosen) + w > equity_cap:
            w = max(0.0, equity_cap - sum(x["weight"] for x in chosen))
            if w < RULES["min_weight"]:
                skipped.append({"ticker": c["ticker"], "reason": f"Equity cap {equity_cap:.0%} reached"}); break
        chosen.append(dict(c, weight=w, entry_price=entry, stops=stops))
        sector_w[c["sector"]] = sector_w.get(c["sector"], 0) + w
        for k, v in c["themes"].items():
            theme_w[k] = theme_w.get(k, 0) + w * v
    for c in chosen:                      # apply trims decided in step 1
        tr = incumbents_ok.get(c["ticker"], {}).get("trim")
        if tr:
            c["weight"] = c["weight"] * (1 - tr["fraction"]); c["notes"].append("Trim: " + tr["reason"])
    equity_actual = sum(c["weight"] for c in chosen)
    cash_from_gate = max(0.0, equity_cap - equity_actual)

    # 4. Non-equity sleeves from posture; unused equity budget stays in cash
    posture = risk.get("posture", {}).get("recommended", {})
    sleeves = []
    other_total = sum(v for k, v in posture.items() if k != "Equities") or 1
    remaining = 1 - equity_cap
    for asset, proxies in SLEEVE_PROXIES.items():
        share = (posture.get(asset) or 0) / other_total * remaining
        if asset == "Cash":
            share += cash_from_gate
        for sym, name, frac in proxies:
            if share * frac > 0.001:
                sleeves.append({"symbol": sym, "name": name, "sleeve": asset, "weight": r(share * frac, 4)})

    # 5. Holdings
    holdings = []
    for c in chosen:
        st = strategies[c["ticker"]]
        prev = prior_holdings.get(c["ticker"])
        inc = incumbents_ok.get(c["ticker"], {})
        entry_rules = prev["entry_rules"] if prev and prev.get("entry_rules") else st.get("break_rules", [])
        dollars = c["weight"] * portfolio_value
        price = c["price"]
        holdings.append({
            "ticker": c["ticker"], "name": c["name"], "sector": c["sector"], "top_theme": c["top_theme"],
            "weight": r(c["weight"], 4), "dollars": r(dollars, 0), "shares": r(dollars / price, 1) if price else None, "price": price,
            "entry_price": r(c["entry_price"], 2), "pnl_pct": r((price / c["entry_price"] - 1) * 100, 1) if price and c["entry_price"] else None,
            "trail_high": r(inc.get("trail_high") or price, 2), "stops": c["stops"],
            "conviction": r(c["conviction"], 1), "lt_conviction": c["lt_conviction"], "attention": c["attention"],
            "opportunity": c["opportunity"], "gap": c["gap"], "reality": c["reality"], "narrative": c["narrative"], "pricing": c["pricing"],
            "quality": c["quality"], "growth": c["growth"], "value": c["value"], "macro_fit": r(c["macro_fit"], 0),
            "technical": {k: c["technical"][k] for k in ("score", "passes", "stage", "ready", "rsi14", "atr_pct", "rs_6m", "pct_from_52w_high")} if c["technical"] else None,
            "rationale": c["rationale"], "notes": c["notes"] + ([inc["deferred_trim"]] if inc.get("deferred_trim") else []),
            "brief_flags": inc.get("flags", 0), "brief_notes": inc.get("flag_notes", []),
            "tech_fail_runs": inc.get("tech_fail_runs", 0),
            "held_days": (today - date.fromisoformat(prev["entered"])).days if prev and prev.get("entered") else 0,
            "long_term_gain_eligible": bool(prev and prev.get("entered") and (today - date.fromisoformat(prev["entered"])).days >= RULES["long_term_holding_days"]),
            "status": "held" if prev else "new", "entered": prev.get("entered") if prev else today.isoformat(),
            "entry_rules": entry_rules, "rule_status": inc.get("rules"), "prior_weight": prev["weight"] if prev else None,
        })
    holdings.sort(key=lambda h: -h["weight"])

    # 6. Trades
    trades = []
    for e in exits:
        trades.append({"action": "SELL", "ticker": e["ticker"], "name": e.get("name"), "from": e["prior_weight"], "to": 0.0, "reason": e["reason"]})
    held_now = {h["ticker"] for h in holdings}
    for t, h in prior_holdings.items():
        if t not in held_now and t not in {e["ticker"] for e in exits}:
            why = next((s["reason"] for s in skipped if s["ticker"] == t), next((s["reason"] for s in rejected if s["ticker"] == t), "Fell out of the ranking"))
            trades.append({"action": "SELL", "ticker": t, "name": h.get("name"), "from": h["weight"], "to": 0.0, "reason": why})
    for h in holdings:
        if h["status"] == "new":
            trades.append({"action": "BUY", "ticker": h["ticker"], "name": h["name"], "from": 0.0, "to": h["weight"],
                           "reason": "Entered: " + ", ".join(h["rationale"][:3]) + (f" · stop {h['stops']['active_stop']}" if h.get("stops") else "")})
        elif h["prior_weight"] is not None and abs(h["weight"] - h["prior_weight"]) >= 0.01:
            trades.append({"action": "ADD" if h["weight"] > h["prior_weight"] else "TRIM", "ticker": h["ticker"], "name": h["name"],
                           "from": h["prior_weight"], "to": h["weight"], "reason": next((n for n in h["notes"] if n.startswith("Trim")), "Rebalance to risk-adjusted weight")})
    for tr in trades:
        tr["dollars"] = r((tr["to"] - tr["from"]) * portfolio_value, 0)

    def w_avg(key: str) -> Optional[float]:
        return r(wmean([(h.get(key), h["weight"]) for h in holdings]), 0)

    theme_exposure: dict[str, float] = {}
    for h in holdings:
        for e in strategies[h["ticker"]].get("theme_exposures", [])[:3]:
            theme_exposure[e["theme_id"]] = theme_exposure.get(e["theme_id"], 0) + h["weight"] * e["effective"]
    top_themes = sorted(((themes_by_id.get(k, {}).get("name", k), r(v, 3)) for k, v in theme_exposure.items()), key=lambda x: -x[1])[:8]
    cash_total = sum(s["weight"] for s in sleeves if s["sleeve"] == "Cash")

    return {
        "as_of": today.isoformat(), "portfolio_value": portfolio_value, "rules": RULES,
        "cadence": {"mode": "recalibrate", "last_recalibration": today.isoformat(), "next_recalibration": _next_recalibration(today),
                    "note": "Monthly cadence: this run rebalanced the book; daily runs until the next month only monitor and alert."},
        "last_recalibration": today.isoformat(), "alerts": [],
        "equity_weight": r(equity_actual, 4), "equity_cap": r(equity_cap, 4), "cash_weight": r(cash_total, 4),
        "beta_target": risk.get("posture", {}).get("beta_target", {}).get("recommended"),
        "risk_label": risk.get("label"), "regime": regime.get("regime", {}).get("label"),
        "longterm_thesis": (longterm or {}).get("thesis"), "longterm_top_themes": [(t["theme"], t["conviction"]) for t in (longterm or {}).get("theme_ranking", [])[:6]],
        "holdings": holdings, "sleeves": sleeves, "trades": trades, "exits": exits, "skipped": skipped[:15], "rejected_technical": rejected[:25],
        "cooldown": cooldown, "stopouts": stopouts,
        "nav_index": r(nav_index, 4), "nav_peak": r(nav_peak, 4), "drawdown_pct": r(drawdown_pct, 2), "period_return_pct": r(period_ret * 100, 2),
        "ladder_note": ladder_note, "regime_gate": {**gate, "open": gate_open, "applied": RULES["regime_gate"]},
        "watchlist": [{"ticker": c["ticker"], "name": c["name"], "opportunity": c["opportunity"], "gap": c["gap"], "conviction": r(c["conviction"], 1),
                       "technical_score": (c["technical"] or {}).get("score"), "lt_conviction": c["lt_conviction"]} for c in cands if c["ticker"] not in held_now][:12],
        "stats": {"positions": len(holdings), "weighted_opportunity": w_avg("opportunity"), "weighted_gap": w_avg("gap"),
                  "weighted_reality": w_avg("reality"), "weighted_pricing": w_avg("pricing"), "weighted_quality": w_avg("quality"),
                  "weighted_lt_conviction": r(wmean([(h.get("lt_conviction"), h["weight"]) for h in holdings]), 2),
                  "avg_stop_distance_pct": r(wmean([((h.get("stops") or {}).get("stop_distance_pct"), h["weight"]) for h in holdings]), 1),
                  "book_pnl_pct": r(wmean([(h.get("pnl_pct"), h["weight"]) for h in holdings]), 1),
                  "sector_weights": {k: r(v, 3) for k, v in sorted(sector_w.items(), key=lambda x: -x[1])},
                  "theme_weights": top_themes, "turnover": r(sum(abs(t["to"] - t["from"]) for t in trades) / 2, 3)},
        "is_initial": prior is None, "prior_as_of": (prior or {}).get("as_of"),
    }
