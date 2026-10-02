"""Thesis-driven portfolio — a separate book that starts from the theses, not from valuation.

Order of operations (the reverse of the valuation-trend book):
  1. Thesis favour  : every name gets a thesis score from three sources
                        ledger      (40%) posterior-weighted exposure to the open theses' value pools (Human Futures Engine ledger)
                        structural  (35%) exposure to the themes behind the long-term thesis' structural shifts (confidence x trend)
                        brief       (25%) the morning briefs' theme and ticker convictions over the last five briefs
                      and a thesis probability (the chance the thesis behind the position plays out) that sizes it.
  2. Valuation      : the only valuation test is the fair-value ceiling: a name is excluded when its price is above the BULL scenario.
  3. Other gates    : market gate (index regime), sector gate (capital rotation), trend gate (trend template), earnings blackout.
  4. Sizing         : weight = thesis probability x max weight, never more than the 1%-risk-to-stop size, under sector / theme /
                      correlation-cluster caps and the equity cap from the risk posture; volatility-targeted.
Exits: stop (initial / Chandelier trail), Stage-4 or trend-template failure, the thesis no longer favouring the name
(score decay, headwind, thesis resolved false), or price above the bull scenario. Monthly cadence; daily runs monitor.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from . import pm
from .brief import narrative_by_theme
from .causal import BECOMES_WEIGHT
from .common import r, wmean
from .portfolio import RULES as PF_RULES, _stop_levels

RULES = {
    "weights": {"ledger": 0.40, "structural": 0.35, "brief": 0.25},
    "min_thesis_score": 45,            # favoured = at least this, and backed by the ledger or a strong structural shift
    "min_structural": 0.5,
    "exit_thesis_score": 35,           # an incumbent leaves when the thesis score decays below this
    "full_exposure": 0.6,              # effective theme exposure at which a name counts as fully exposed
    "max_positions": 20, "max_weight": 0.08, "min_weight": 0.02,
    "sector_cap": 0.30, "theme_cap": 0.40, "cluster_cap": 0.30,
    "risk_per_position_pct": 1.0, "target_vol": 0.14, "vol_floor_mult": 0.5,
    "technical_min_score": 75, "rotation_entry_min": -30, "earnings_blackout_days": 5, "trend_fail_runs": 2,
    "valuation_rule": "exclude only when price is above the bull fair-value scenario",
    "recalibration_cadence": "monthly", "intra_month_exits": "hard_stop",
}
TREND_MULT = {"strengthening": 1.0, "accelerating": 1.0, "stable": 0.9, "steady": 0.9, "emerging": 0.9, "weakening": 0.6, "fading": 0.6}


def _next_month(d: date) -> str:
    return date(d.year + (d.month == 12), d.month % 12 + 1, 1).isoformat()


# ------------------------------------------------------------------ thesis sources
def theme_strength(longterm: Optional[dict]) -> tuple[dict[str, float], dict[str, dict]]:
    """Per theme: 0..1 strength from the structural shifts (confidence x trend) blended with the long-term theme conviction,
    and the strongest shift behind it."""
    conv = (longterm or {}).get("theme_conviction", {}) or {}
    best: dict[str, tuple[float, dict]] = {}
    for sh in (longterm or {}).get("structural_shifts", []) or []:
        v = float(sh.get("confidence") or 0.5) * TREND_MULT.get(str(sh.get("trend") or "").lower(), 0.85)
        for th in sh.get("themes") or []:
            if th not in best or v > best[th][0]:
                best[th] = (v, sh)
    out, src = {}, {}
    for th in set(conv) | set(best):
        parts = [x for x in (conv.get(th), best[th][0] if th in best else None) if x is not None]
        out[th] = sum(parts) / len(parts)
        if th in best:
            src[th] = best[th][1]
    return out, src


def ledger_exposure(records: list[dict]) -> dict[str, dict]:
    """Per ticker: posterior-weighted exposure to the open theses' value pools, the probability behind it and any headwind."""
    out: dict[str, dict] = {}
    for rec in records:
        if rec.get("status") != "open":
            continue
        post = (rec.get("probability", {}).get("posterior") or 50) / 100
        for vp in rec.get("value_pools", []):
            w = BECOMES_WEIGHT.get(vp.get("becomes"), 0.5)
            for t in vp.get("tickers", []):
                x = out.setdefault(t, {"pos": 0.0, "neg": 0.0, "theses": {}, "roles": []})
                if w >= 0:
                    x["pos"] += post * w
                    x["theses"][rec["id"]] = x["theses"].get(rec["id"], 0.0) + post * w
                else:
                    x["neg"] += post * w
                x["roles"].append({"thesis_id": rec["id"], "title": rec.get("title"), "layer": vp.get("layer"), "becomes": vp.get("becomes"), "posterior": r(post * 100, 1)})
    post_by_id = {rec["id"]: (rec.get("probability", {}).get("posterior") or 50) / 100 for rec in records}
    for x in out.values():
        tot = sum(x["theses"].values())
        x["prob"] = sum(post_by_id[k] * v for k, v in x["theses"].items()) / tot if tot > 0 else None
    return out


def brief_signals(briefs: list[dict]) -> tuple[dict[str, float], dict[str, dict]]:
    """Theme narrative 0..1 from the last five briefs and a recency-weighted ticker signal in [-1, 1]."""
    recent = [b for b in briefs if b.get("llm")][:5]
    themes = {k: (v or 50) / 100 for k, v in narrative_by_theme(recent, 5).items()}
    acc: dict[str, list[tuple[float, float, str]]] = {}
    for i, b in enumerate(recent):
        w = 1.0 / (1 + 0.35 * i)
        for sig in b["llm"].get("ticker_signals", []):
            v = 1.0 if sig.get("direction") == "bullish" else -1.0 if sig.get("direction") == "bearish" else 0.0
            acc.setdefault(sig["ticker"], []).append((v, w, f"{b.get('as_of')}: {sig.get('direction')} — {(sig.get('evidence') or '')[:160]}"))
    tick = {t: {"signal": sum(v * w for v, w, _ in xs) / sum(w for _, w, _ in xs), "n": len(xs), "latest": xs[0][2]} for t, xs in acc.items()}
    return themes, tick


def score_universe(strategies: dict[str, dict], companies: dict[str, dict], longterm: Optional[dict], briefs: list[dict], records: list[dict]) -> dict[str, dict]:
    strength, shift_src = theme_strength(longterm)
    led = ledger_exposure(records)
    b_theme, b_tick = brief_signals(briefs)
    pos = sorted(x["pos"] for x in led.values() if x["pos"] > 0)
    led_ref = pos[int(len(pos) * 0.9)] if pos else 1.0          # 90th percentile exposure counts as full strength
    W = RULES["weights"]
    out = {}
    for t, st in strategies.items():
        exps = st.get("theme_exposures") or []
        drivers = []
        # structural shifts via theme exposure
        s_best, s_theme = None, None
        for e in exps:
            if e["theme_id"] in strength:
                v = min(e["effective"] / RULES["full_exposure"], 1.0) * strength[e["theme_id"]]
                if s_best is None or v > s_best:
                    s_best, s_theme = v, e
        if s_theme is not None and s_best >= 0.2:
            sh = shift_src.get(s_theme["theme_id"])
            drivers.append({"kind": "structural", "label": s_theme["theme"], "strength": r(s_best, 2),
                            "detail": (sh["shift"][:220] if sh else "long-term theme conviction"), "confidence": r(strength[s_theme["theme_id"]], 2)})
        # ledger
        lx = led.get(t)
        l_str = min(lx["pos"] / led_ref, 1.0) if lx and lx["pos"] > 0 and led_ref > 0 else None
        if lx and lx["pos"] > 0:
            for tid, c in sorted(lx["theses"].items(), key=lambda z: -z[1])[:3]:
                role = next((ro for ro in lx["roles"] if ro["thesis_id"] == tid), {})
                drivers.append({"kind": "ledger", "label": f"{tid} {role.get('title') or ''}".strip()[:110], "strength": r(min(c / led_ref, 1.0), 2),
                                "detail": f"{role.get('layer')} ({role.get('becomes')})", "confidence": r((role.get("posterior") or 50) / 100, 2)})
        headwind = bool(lx and lx["neg"] < -0.3 and lx["pos"] + lx["neg"] <= 0)
        # briefs
        bt = None
        for e in exps:
            if e["theme_id"] in b_theme:
                v = min(e["effective"] / RULES["full_exposure"], 1.0) * b_theme[e["theme_id"]]
                bt = v if bt is None or v > bt else bt
        tk = b_tick.get(t)
        b_str = None
        if bt is not None or tk:
            b_str = wmean([(bt, 0.7), ((0.5 + 0.5 * tk["signal"]) if tk else None, 0.3)])
        if tk:
            drivers.append({"kind": "brief", "label": "Morning brief ticker signal", "strength": r(0.5 + 0.5 * tk["signal"], 2), "detail": tk["latest"], "confidence": None})
        score = 100 * (W["ledger"] * (l_str or 0) + W["structural"] * (s_best or 0) + W["brief"] * (b_str or 0))
        prob = wmean([(lx["prob"] if lx and lx.get("prob") else None, 0.5), (strength[s_theme["theme_id"]] if s_theme else None, 0.35), (b_str, 0.15)])
        favoured = score >= RULES["min_thesis_score"] and ((l_str or 0) > 0 or (s_best or 0) >= RULES["min_structural"]) and not headwind
        out[t] = {"thesis_score": r(score, 0), "thesis_probability": r(prob, 2), "favoured": favoured, "headwind": headwind,
                  "components": {"ledger": r((l_str or 0) * 100, 0), "structural": r((s_best or 0) * 100, 0), "brief": r((b_str or 0) * 100, 0)},
                  "drivers": sorted(drivers, key=lambda d: -(d["strength"] or 0))[:5], "theses": sorted(lx["theses"], key=lambda k: -lx["theses"][k])[:4] if lx else [],
                  "top_theme": exps[0]["theme"] if exps else None, "themes": {e["theme"]: e["effective"] for e in exps[:4]}}
    return out


def _valuation(er: Optional[dict], price: Optional[float]) -> dict:
    if not er or not price:
        return {"price": r(price, 2) if price else None, "position": "no_model", "above_bull": False}
    base, bull = er.get("base"), er.get("bull")
    posn = "above_bull" if bull and price > bull else "base_to_bull" if base and price > base else "below_base"
    return {"price": r(price, 2), "bear": er.get("bear"), "base": base, "bull": bull, "expected_return_pct": er.get("expected_return_pct"),
            "position": posn, "above_bull": posn == "above_bull", "pct_to_bull": r((bull / price - 1) * 100, 1) if bull else None,
            "confidence": er.get("confidence")}


# ------------------------------------------------------------------ construction
def compute(strategies: dict[str, dict], analyses: dict[str, dict], companies: dict[str, dict], technicals: dict[str, dict], pm_detail: dict[str, dict],
            flows: dict, regime: dict, risk: dict, longterm: Optional[dict], briefs: list[dict], records: list[dict], prices: dict,
            prior: Optional[dict], portfolio_value: float, as_of: Optional[date] = None, other_book: Optional[list[str]] = None) -> dict:
    today = as_of or date.today()
    ts = score_universe(strategies, companies, longterm, briefs, records)
    rot = flows.get("sector_rotation", {})
    gate = regime.get("index_gate") or {}
    gate_open = bool(gate.get("open", True))
    prior_h = {h["ticker"]: h for h in (prior or {}).get("holdings", [])}
    last_recal = date.fromisoformat(prior["last_recalibration"]) if prior and prior.get("last_recalibration") else None
    recalibrate = prior is None or last_recal is None or (today.year, today.month) != (last_recal.year, last_recal.month)

    def px(t):
        a = analyses.get(t)
        return float(a["price"]) if a and a.get("price") else None

    def val(t):
        return _valuation((pm_detail.get(t) or {}).get("expected_return"), px(t))

    def tech(t):
        ta = technicals.get(t) or {}
        return {"passes": ta.get("passes"), "score": ta.get("score"), "stage": ta.get("stage"), "ready": bool(ta.get("ready")), "rsi14": ta.get("rsi14")}

    # --- book NAV (approximate: weighted returns of the names held between runs; cash flat)
    prior_nav, prior_peak = float((prior or {}).get("nav_index") or 1.0), float((prior or {}).get("nav_peak") or 1.0)
    period_ret = sum((px(t) / float(h["price"]) - 1) * h["weight"] for t, h in prior_h.items() if px(t) and h.get("price"))
    nav = prior_nav * (1 + period_ret)
    nav_peak = max(prior_peak, nav)
    market = ((briefs[0].get("llm") or {}).get("market_thesis") if briefs else None) or {}
    header = {
        "as_of": today.isoformat(), "portfolio_value": portfolio_value, "rules": RULES, "regime": regime.get("regime", {}).get("label"), "risk_label": risk.get("label"),
        "regime_gate": {"open": gate_open, "note": gate.get("note")},
        "market_thesis": {"direction": market.get("direction"), "confidence": market.get("confidence"), "long_term": market.get("long_term"),
                          "as_of": briefs[0].get("as_of") if briefs else None},
        "sources": {"ledger": {"n_theses": sum(1 for x in records if x.get("status") == "open")},
                    "structural": {"as_of": (longterm or {}).get("as_of"), "n_shifts": len((longterm or {}).get("structural_shifts", []) or [])},
                    "briefs": {"n": len([b for b in briefs if b.get("llm")][:5]), "latest": briefs[0].get("as_of") if briefs else None}},
        "nav_index": r(nav, 4), "nav_peak": r(nav_peak, 4), "drawdown_pct": r((nav / nav_peak - 1) * 100, 2), "period_return_pct": r(period_ret * 100, 2),
    }

    # --- monitor mode: no trades, only the hard stop can force an exit
    if not recalibrate:
        held, alerts, exits = [], [], []
        for t, h in prior_h.items():
            p = px(t)
            if not p:
                held.append(h); continue
            entry = float(h.get("entry_price") or p)
            trail_high = max(float(h.get("trail_high") or entry), p)
            ta = technicals.get(t) or {}
            stops = _stop_levels(entry, ta.get("atr20"), p, trail_high, (p / entry - 1) * 100)
            x, v = ts.get(t, {}), val(t)
            if p <= stops["hard_stop"]:
                exits.append({"ticker": t, "name": h.get("name"), "prior_weight": h["weight"], "reason": f"Hard stop: {p:.2f} at or below {stops['hard_stop']:.2f}",
                              "entry_price": r(entry, 2), "exit_price": r(p, 2), "pnl_pct": r((p / entry - 1) * 100, 1)})
                continue
            pend = []
            if p <= stops["active_stop"]:
                pend.append(f"Below its stop {stops['active_stop']:.2f}: exit at the next recalibration")
            if v["above_bull"]:
                pend.append(f"Price above the bull scenario ({v['bull']}): exit at the next recalibration")
            if x and (x.get("thesis_score") or 0) < RULES["exit_thesis_score"]:
                pend.append(f"Thesis score fell to {x.get('thesis_score')}: exit at the next recalibration")
            if ta and ta.get("sma150") and ta.get("sma150_prev4w") and p < ta["sma150"] and ta["sma150"] < ta["sma150_prev4w"]:
                pend.append("Stage-4 break: below a declining 30-week average")
            for a_ in pend:
                alerts.append({"ticker": t, "name": h.get("name"), "weight": h["weight"], "alert": a_})
            held.append({**h, "price": r(p, 2), "trail_high": r(trail_high, 2), "pnl_pct": r((p / entry - 1) * 100, 1), "stops": stops, "valuation": v, "technical": tech(t),
                         "thesis_score": x.get("thesis_score", h.get("thesis_score")), "thesis_probability": x.get("thesis_probability", h.get("thesis_probability")),
                         "components": x.get("components", h.get("components")), "drivers": x.get("drivers", h.get("drivers")), "pending_actions": pend, "status": "held"})
        eq = sum(h["weight"] for h in held)
        return {**prior, **header, "holdings": held, "trades": [{"action": "SELL", "ticker": e["ticker"], "name": e["name"], "from": e["prior_weight"], "to": 0.0,
                                                                 "dollars": r(-e["prior_weight"] * portfolio_value, 0), "reason": e["reason"]} for e in exits],
                "exits": exits, "alerts": alerts, "equity_weight": r(eq, 4), "cash_weight": r(1 - eq, 4), "is_initial": False,
                "stats": {**(prior.get("stats") or {}), "positions": len(held), "weighted_thesis_score": r(wmean([(h.get("thesis_score"), h["weight"]) for h in held]), 0),
                          "weighted_probability": r(wmean([(h.get("thesis_probability"), h["weight"]) for h in held]), 2)},
                "cadence": {"mode": "monitor", "last_recalibration": last_recal.isoformat(), "next_recalibration": _next_month(today)}}

    # --- 1. incumbents: stops, trend, thesis decay, bull ceiling
    exits, keep = [], {}
    for t, h in prior_h.items():
        p, x, ta = px(t), ts.get(t), technicals.get(t) or {}
        if not p or not x:
            exits.append({"ticker": t, "name": h.get("name"), "prior_weight": h["weight"], "reason": "No longer scored (data gap)"}); continue
        entry = float(h.get("entry_price") or p)
        trail_high = max(float(h.get("trail_high") or entry), p)
        gain = (p / entry - 1) * 100
        stops = _stop_levels(entry, ta.get("atr20"), p, trail_high, gain)
        v = val(t)
        fails = (int(h.get("tech_fail_runs") or 0) + 1) if ta and (ta.get("score") or 100) < 50 else 0
        why = []
        if p <= stops["active_stop"]:
            why.append(f"Price {p:.2f} closed below its stop {stops['active_stop']:.2f} ({gain:+.1f}%)")
        if ta and ta.get("sma150") and ta.get("sma150_prev4w") and p < ta["sma150"] and ta["sma150"] < ta["sma150_prev4w"]:
            why.append(f"Stage-4 break: {p:.2f} below a declining 30-week average ({ta['sma150']:.2f})")
        if fails >= RULES["trend_fail_runs"]:
            why.append(f"Trend template failed {fails} runs in a row")
        if x["headwind"]:
            why.append("The thesis ledger now lists this name as a net loser")
        elif (x["thesis_score"] or 0) < RULES["exit_thesis_score"]:
            why.append(f"Thesis score {x['thesis_score']} below {RULES['exit_thesis_score']}: the theses no longer favour it")
        if v["above_bull"]:
            why.append(f"Price {p:.2f} above the bull scenario {v['bull']}")
        if why:
            exits.append({"ticker": t, "name": h.get("name"), "prior_weight": h["weight"], "reason": " | ".join(why), "entry_price": r(entry, 2), "exit_price": r(p, 2), "pnl_pct": r(gain, 1)})
        else:
            keep[t] = {"entry": entry, "trail_high": trail_high, "stops": stops, "fails": fails, "entered": h.get("entered")}

    # --- 2. thesis favour first, then the bull ceiling, then market / sector / trend gates
    funnel = {"universe": len(ts), "favoured": 0, "headwind": 0, "above_bull": 0, "market_gate": 0, "sector_gate": 0, "trend_gate": 0, "earnings": 0, "caps": 0, "selected": 0}
    cand_rows, passed = [], []
    exited = {e["ticker"] for e in exits}
    for t, x in sorted(ts.items(), key=lambda kv: -(kv[1]["thesis_score"] or 0)):
        if x["headwind"] and (x["thesis_score"] or 0) >= RULES["min_thesis_score"]:
            funnel["headwind"] += 1
        if not x["favoured"] and t not in keep:
            continue
        p, c = px(t), companies[t]
        if not p or t in exited:
            continue
        funnel["favoured"] += 1
        v, tk, ta = val(t), tech(t), technicals.get(t) or {}
        row = {"ticker": t, "name": c["name"], "sector": c["sector"], **{k: x[k] for k in ("thesis_score", "thesis_probability", "components", "drivers", "theses", "top_theme")},
               "valuation": v, "technical": tk, "incumbent": t in keep}
        status, reason = "passed", None
        if t not in keep:
            if v["above_bull"]:
                status, reason = "above_bull", f"Price {v['price']} above the bull scenario {v['bull']}"
            elif not gate_open:
                status, reason = "market_gate", "Market gate closed: index below its 10-month average and behind T-bills"
            elif rot.get(c["sector"]) is not None and rot[c["sector"]] < RULES["rotation_entry_min"]:
                status, reason = "sector_gate", f"Capital leaving {c['sector']} (rotation {rot[c['sector']]:+.0f})"
            elif ta and (not ta.get("ready") or (ta.get("score") or 0) < RULES["technical_min_score"]):
                status, reason = "trend_gate", f"Trend gate: {ta.get('stage')} ({ta.get('passes')}/8 criteria)"
            else:
                filed = (analyses[t].get("latest") or {}).get("filed")
                try:
                    days = 91 - (today - date.fromisoformat(str(filed)[:10])).days if filed else None
                except ValueError:
                    days = None
                if days is not None and 0 <= days <= RULES["earnings_blackout_days"]:
                    status, reason = "earnings", f"Earnings expected in ~{days} days; entry deferred"
        if status != "passed":
            funnel[status] += 1
        row["status"], row["reason"] = status, reason
        cand_rows.append(row)
        if status == "passed":
            passed.append(row)

    # --- 3. sizing by thesis probability under risk and concentration caps
    equity_cap = (risk.get("posture", {}).get("recommended", {}).get("Equities") or 65) / 100 * (1.0 if gate_open else 0.5)
    cl_map = pm.clusters(pm.returns_matrix(prices, [c["ticker"] for c in passed[:60]])) if prices else {}
    chosen, sector_w, theme_w, cluster_w = [], {}, {}, {}
    for c in passed:
        t = c["ticker"]
        if len(chosen) >= RULES["max_positions"]:
            c["status"], c["reason"] = "caps", f"Book full at {RULES['max_positions']} positions"; funnel["caps"] += 1; continue
        p, ta, k = px(t), technicals.get(t) or {}, keep.get(t)
        entry = k["entry"] if k else p
        stops = k["stops"] if k else _stop_levels(entry, ta.get("atr20"), p, p, 0.0)
        dist = stops["stop_distance_pct"] / 100 if stops.get("stop_distance_pct") and stops["stop_distance_pct"] > 0 else 0.12
        risk_w = RULES["risk_per_position_pct"] / 100 / dist
        prob = c["thesis_probability"] or 0.5
        w = min(RULES["max_weight"] * prob, risk_w)
        if (ta.get("overbought")) and not k:
            w *= 0.5
        why = None
        if w < RULES["min_weight"]:
            why = f"Size below {RULES['min_weight']:.0%} (probability {prob:.0%}, stop {dist:.0%} away)"
        elif sector_w.get(c["sector"], 0) + w > RULES["sector_cap"]:
            why = f"{c['sector']} sector cap {RULES['sector_cap']:.0%}"
        elif any(theme_w.get(th, 0) + w * e > RULES["theme_cap"] for th, e in ts[t]["themes"].items()):
            why = f"Theme cap {RULES['theme_cap']:.0%}"
        elif cl_map.get(t) is not None and cluster_w.get(cl_map[t], 0) + w > RULES["cluster_cap"]:
            why = f"Correlation cluster cap {RULES['cluster_cap']:.0%}"
        elif sum(x["weight"] for x in chosen) + w > equity_cap:
            w = equity_cap - sum(x["weight"] for x in chosen)
            if w < RULES["min_weight"]:
                why = f"Equity cap {equity_cap:.0%} reached"
        if why:
            c["status"], c["reason"] = "caps", why; funnel["caps"] += 1
            if k:   # an incumbent squeezed out by a cap is sold
                exits.append({"ticker": t, "name": c["name"], "prior_weight": prior_h[t]["weight"], "reason": why, "entry_price": r(entry, 2), "exit_price": r(p, 2),
                              "pnl_pct": r((p / entry - 1) * 100, 1)})
            continue
        sector_w[c["sector"]] = sector_w.get(c["sector"], 0) + w
        for th, e in ts[t]["themes"].items():
            theme_w[th] = theme_w.get(th, 0) + w * e
        if cl_map.get(t) is not None:
            cluster_w[cl_map[t]] = cluster_w.get(cl_map[t], 0) + w
        notes = [f"Thesis probability {prob:.0%} -> target {RULES['max_weight'] * prob:.1%}" + (f", cut to {w:.1%} by the 1% risk rule (stop {dist:.0%} away)" if risk_w < RULES["max_weight"] * prob else "")]
        if c["valuation"]["position"] == "base_to_bull":
            notes.append(f"Priced between base ({c['valuation']['base']}) and bull ({c['valuation']['bull']}): the thesis has to be right for this to work")
        if c["valuation"]["position"] == "no_model":
            notes.append("No fair-value model for this name; the bull ceiling could not be checked")
        chosen.append({**c, "weight": w, "entry_price": entry, "stops": stops, "trail_high": k["trail_high"] if k else p, "tech_fail_runs": k["fails"] if k else 0,
                       "entered": (k or {}).get("entered") or today.isoformat(), "status": "held" if k else "new", "notes": notes})
        c["status"] = "selected"
    # volatility targeting on the equity book
    weights = {c["ticker"]: c["weight"] for c in chosen}
    vol = pm.portfolio_vol(pm.returns_matrix(prices, list(weights)), weights) if prices and weights else None
    scale = 1.0
    if vol and vol > RULES["target_vol"]:
        scale = max(RULES["vol_floor_mult"], RULES["target_vol"] / vol)
        for c in chosen:
            c["weight"] *= scale
            c["notes"].append(f"Volatility targeting x{scale:.2f}")
    weights = {c["ticker"]: c["weight"] for c in chosen}
    vol_after = pm.portfolio_vol(pm.returns_matrix(prices, list(weights)), weights) if prices and weights else None
    funnel["selected"] = len(chosen)

    holdings = []
    for c in sorted(chosen, key=lambda z: -z["weight"]):
        t, p = c["ticker"], px(c["ticker"])
        prev = prior_h.get(t)
        holdings.append({k: v for k, v in c.items() if k not in ("incumbent", "reason")} | {
            "weight": r(c["weight"], 4), "dollars": r(c["weight"] * portfolio_value, 0), "shares": r(c["weight"] * portfolio_value / p, 1),
            "price": r(p, 2), "entry_price": r(c["entry_price"], 2), "pnl_pct": r((p / c["entry_price"] - 1) * 100, 1), "prior_weight": prev["weight"] if prev else None})
    trades = [{"action": "SELL", "ticker": e["ticker"], "name": e.get("name"), "from": e["prior_weight"], "to": 0.0, "reason": e["reason"]} for e in exits]
    for h in holdings:
        if h["status"] == "new":
            d = h["drivers"][0] if h["drivers"] else None
            trades.append({"action": "BUY", "ticker": h["ticker"], "name": h["name"], "from": 0.0, "to": h["weight"],
                           "reason": f"Thesis score {h['thesis_score']}, probability {(h['thesis_probability'] or 0):.0%}" + (f" · {d['label']}" if d else "") + f" · stop {h['stops']['active_stop']}"})
        elif abs(h["weight"] - h["prior_weight"]) >= 0.01:
            trades.append({"action": "ADD" if h["weight"] > h["prior_weight"] else "TRIM", "ticker": h["ticker"], "name": h["name"], "from": h["prior_weight"], "to": h["weight"],
                           "reason": f"Re-sized to thesis probability {(h['thesis_probability'] or 0):.0%}"})
    for tr in trades:
        tr["dollars"] = r((tr["to"] - tr["from"]) * portfolio_value, 0)
    eq = sum(h["weight"] for h in holdings)
    thesis_w: dict[str, float] = {}
    for h in holdings:
        for tid in h.get("theses") or []:
            thesis_w[tid] = thesis_w.get(tid, 0) + h["weight"]
    titles = {rec["id"]: rec for rec in records}
    strength, shift_src = theme_strength(longterm)
    held_themes = {th for h in holdings for th in ts[h["ticker"]]["themes"]}
    theme_names = {e["theme_id"]: e["theme"] for st in strategies.values() for e in st.get("theme_exposures") or []}
    shifts = []
    for sh in sorted((longterm or {}).get("structural_shifts", []) or [], key=lambda s: -(s.get("confidence") or 0))[:10]:
        names = [theme_names.get(x, x) for x in sh.get("themes") or []]
        shifts.append({"shift": sh.get("shift"), "confidence": sh.get("confidence"), "trend": sh.get("trend"), "themes": names,
                       "held": sorted(h["ticker"] for h in holdings if any(n in ts[h["ticker"]]["themes"] for n in names))})
    return {
        **header, "is_initial": prior is None, "prior_as_of": (prior or {}).get("as_of"), "last_recalibration": today.isoformat(),
        "cadence": {"mode": "recalibrate", "last_recalibration": today.isoformat(), "next_recalibration": _next_month(today)},
        "equity_weight": r(eq, 4), "equity_cap": r(equity_cap, 4), "cash_weight": r(1 - eq, 4),
        "holdings": holdings, "trades": trades, "exits": exits, "alerts": [], "funnel": funnel,
        "candidates": cand_rows[:80],
        "theses": [{"id": k, "title": titles[k].get("title"), "posterior": titles[k].get("probability", {}).get("posterior"), "horizon": titles[k].get("horizon"),
                    "weight": r(thesis_w.get(k, 0), 4), "held": sorted(h["ticker"] for h in holdings if k in (h.get("theses") or []))}
                   for k in sorted(titles, key=lambda k: -thesis_w.get(k, 0)) if titles[k].get("status") == "open"],
        "shifts": shifts,
        "stats": {"positions": len(holdings), "weighted_thesis_score": r(wmean([(h["thesis_score"], h["weight"]) for h in holdings]), 0),
                  "weighted_probability": r(wmean([(h["thesis_probability"], h["weight"]) for h in holdings]), 2),
                  "portfolio_vol_pct": r((vol_after or 0) * 100, 1), "vol_before_targeting_pct": r((vol or 0) * 100, 1), "vol_scale": r(scale, 2),
                  "avg_stop_distance_pct": r(wmean([(h["stops"]["stop_distance_pct"], h["weight"]) for h in holdings]), 1),
                  "sector_weights": {k: r(v * scale, 4) for k, v in sorted(sector_w.items(), key=lambda z: -z[1])},
                  "theme_weights": [[k, r(v * scale, 4)] for k, v in sorted(theme_w.items(), key=lambda z: -z[1])[:8]],
                  "between_base_and_bull": sum(1 for h in holdings if h["valuation"]["position"] == "base_to_bull"),
                  "overlap_with_valuation_book": sorted(set(weights) & set(other_book or [])),
                  "turnover": r(sum(abs(tr["to"] - tr["from"]) for tr in trades) / 2, 3)},
    }
