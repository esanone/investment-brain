"""Portfolio-management layer — the institutional questions on top of "what should we own":
is this a favourable time to own it, how much, when do we reduce, and how do we protect the book.

  Entry Score   = 0.30 Fundamentals/thesis + 0.20 Valuation (expected return) + 0.20 Momentum (absolute + sector-
                  relative) + 0.15 Catalyst + 0.10 Regime + 0.05 Flows/sentiment            (0-100)
  Expected return: probability-weighted bear/base/bull fair values from the company's own multiple history and
                  sector multiples applied to forward metrics; bands drive accumulate / build / hold / reduce / exit.
  Exits         : thesis invalidation (frozen rules, elsewhere), valuation exit, graded momentum deterioration
                  (100 -> 75 -> 50%), catalyst completed, better opportunity (expected return per unit of risk).
  Construction  : realised-vol sizing, correlation clusters with caps, covariance portfolio volatility, vol targeting.
  Hedge engine  : portfolio beta and factor exposures, the vol -> trend -> credit staircase, matched hedge instruments,
                  options only around defined events. Recommendations, never execution.
Thresholds are research-informed defaults until the hindcast harness can backtest them.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

import numpy as np
import pandas as pd

from .common import r, sigmoid_score, wmean

WEIGHTS = {"fundamentals": 0.30, "valuation": 0.20, "momentum": 0.20, "catalyst": 0.15, "regime": 0.10, "flows": 0.05}
ER_BANDS = [(25, "accumulate"), (15, "build"), (7, "hold"), (0, "reduce"), (-999, "exit_candidate")]
RULES = {"entry_min": 60, "entry_build": 75, "cluster_corr": 0.70, "cluster_cap": 0.25, "target_vol": 0.12, "vol_floor_mult": 0.5,
         "momentum_grades": {0: 1.0, 1: 1.0, 2: 0.75, 3: 0.5}, "better_opp_ratio": 2.0, "catalyst_done_gain": 20.0}
SECTOR_HEDGE = {"Technology": "QQQ", "Communication Services": "QQQ", "Semiconductors": "SMH", "Energy": "XLE", "Financials": "XLF", "Health Care": "XLV",
                "Industrials": "XLI", "Consumer Discretionary": "XLY", "Utilities": "XLU", "Materials": "XLB", "Real Estate": "XLRE", "Consumer Staples": "XLP"}


# ------------------------------------------------------------------ expected return
def expected_return(analysis: dict, sector_medians: dict, regime_label: Optional[str]) -> Optional[dict]:
    """Scenario fair values from multiples applied to NORMALISED metrics (half current TTM, half the median of the last
    eight TTM readings, so peak-cycle earnings are not capitalised at trough-cycle multiples). Multiples: the company's
    own 5-year median, shrunk toward the sector median and capped at 1.5x sector. Bear = trough metric x 0.8 multiple,
    base = normalised metric x multiple, bull = base x 1.35. Probabilities tilt with the regime."""
    L, V, price = analysis.get("latest", {}), analysis.get("valuation", {}), analysis.get("price")
    if not price or not V.get("market_cap"):
        return None
    shares = V["market_cap"] / price
    hist = analysis.get("history") or []
    med = V.get("history_median") or {}
    net_debt = L.get("net_debt") or 0.0

    def norm(key: str) -> tuple[Optional[float], Optional[float]]:
        cur = L.get(key)
        past = [h.get(key) for h in hist[-8:] if h.get(key) is not None and h.get(key) > 0]
        if not cur or cur <= 0:
            return None, None
        if len(past) >= 4:
            return 0.5 * cur + 0.5 * float(np.median(past)), float(min(past))
        return cur, cur * 0.8

    def multiple(key: str) -> Optional[float]:
        own, sec = med.get(key), sector_medians.get(key)
        if own and sec:
            return min(0.6 * own + 0.4 * sec, 2.0 * sec)       # lean on the company's own history; sector caps the excess
        return own or sec

    def ev_to_price(ev: float) -> float:
        return max((ev - net_debt) / shares, 0.01)

    bases, bears = [], []
    for key, metric, via_ev in (("pe", "net_income", False), ("ev_ebitda", "ebitda", True), ("ev_sales", "revenue", True), ("p_fcf", "fcf", False)):
        m = multiple(key)
        nrm, trough = norm(metric)
        if not m or not nrm:
            continue
        b = m * nrm; t = 0.8 * m * (trough or nrm)
        bases.append(ev_to_price(b) if via_ev else b / shares)
        bears.append(ev_to_price(t) if via_ev else t / shares)
    bases = [v for v in bases if np.isfinite(v) and v > 0]; bears = [v for v in bears if np.isfinite(v) and v > 0]
    if len(bases) < (1 if L.get("financial") else 2):
        return None
    base = float(np.median(bases)); bull = base * 1.35
    bear = float(np.clip(min(bears), 0.4 * base, base))        # bear case floored at a 60% haircut to base
    p_bear, p_base, p_bull = {"Contraction": (0.30, 0.50, 0.20), "Stagflation": (0.30, 0.50, 0.20), "Reflation": (0.20, 0.50, 0.30)}.get(regime_label, (0.20, 0.55, 0.25))
    ev = p_bear * bear + p_base * base + p_bull * bull
    er = max(-90.0, min(150.0, (ev / price - 1) * 100))
    band = next(b for thr, b in ER_BANDS if er >= thr)
    return {"price": r(price, 2), "bear": r(bear, 2), "base": r(base, 2), "bull": r(bull, 2), "prob": [p_bear, p_base, p_bull],
            "expected_value": r(ev, 2), "expected_return_pct": r(er, 1), "band": band, "upside_base_pct": r((base / price - 1) * 100, 1),
            "downside_bear_pct": r((bear / price - 1) * 100, 1), "n_methods": len(bases),
            "score": r(sigmoid_score((er - 10) / 15, k=1.0), 0),
            "method": "normalised metrics (half current, half 8-quarter median) x blended own/sector multiples (60/40) capped at 2x sector"}


# ------------------------------------------------------------------ momentum (absolute + relative)
def momentum_detail(px: pd.DataFrame, spy: Optional[pd.DataFrame], sector_etf: Optional[pd.DataFrame], technical: Optional[dict]) -> Optional[dict]:
    if px is None or len(px) < 260:
        return None
    p = px.sort_values("date")["adj_close"].reset_index(drop=True)

    def ret(s: pd.Series, n: int) -> Optional[float]:
        return float(s.iloc[-1] / s.iloc[-1 - n] - 1) * 100 if len(s) > n else None

    rets = {k: ret(p, n) for k, n in (("1m", 21), ("3m", 63), ("6m", 126), ("12m", 252))}
    rel = {}
    for name, bench in (("spy", spy), ("sector", sector_etf)):
        if bench is not None and len(bench) > 130:
            b = bench.sort_values("date")["adj_close"].reset_index(drop=True)
            rel[name] = {k: r((ret(p, n) or 0) - (ret(b, n) or 0), 1) for k, n in (("3m", 63), ("6m", 126))}
    sma50, sma200 = p.iloc[-50:].mean(), p.iloc[-200:].mean()
    sma50_prev = p.iloc[-71:-21].mean()
    checks = {"above_200dma": bool(p.iloc[-1] > sma200), "50_above_200": bool(sma50 > sma200),
              "rs_3m_vs_spy_positive": bool((rel.get("spy", {}).get("3m") or 0) > 0), "rs_6m_vs_spy_positive": bool((rel.get("spy", {}).get("6m") or 0) > 0),
              "12m_positive": bool((rets.get("12m") or 0) > 0),
              "rs_3m_vs_sector_positive": bool((rel.get("sector", {}).get("3m") or 0) > 0) if "sector" in rel else None,
              "rs_6m_vs_sector_positive": bool((rel.get("sector", {}).get("6m") or 0) > 0) if "sector" in rel else None}
    core = sum(1 for k in ("above_200dma", "50_above_200", "rs_3m_vs_spy_positive", "rs_6m_vs_spy_positive", "12m_positive") if checks[k])
    sect = [v for k, v in checks.items() if k.startswith("rs_") and "sector" in k and v is not None]
    score = core / 5 * 70 + (sum(sect) / len(sect) * 30 if sect else 15)
    # deterioration warnings (for graded exits)
    warnings = []
    if not checks["above_200dma"]: warnings.append("below 200-day")
    if sma50 < sma50_prev: warnings.append("50-day declining")
    if (rel.get("spy", {}).get("3m") or 0) < -3: warnings.append("relative strength weakening vs market")
    if "sector" in rel and (rel["sector"].get("3m") or 0) < -3: warnings.append("lagging its sector")
    return {"returns": {k: r(v, 1) for k, v in rets.items()}, "relative": rel, "checks": checks, "momentum_score": r(score, 0),
            "core_passes": core, "trend_template": (technical or {}).get("score"), "warnings": warnings, "n_warnings": len(warnings),
            "grade": RULES["momentum_grades"].get(min(len(warnings), 3), 0.5)}


# ------------------------------------------------------------------ catalysts
def catalyst_score(ticker: str, strategist: dict, events_trigger: Optional[dict], hfe_candidate: Optional[dict], attention: Optional[dict],
                   earnings_this_week: list[dict], today: date) -> dict:
    items = []
    e = next((x for x in earnings_this_week if x.get("symbol") == ticker), None)
    if e:
        try:
            days = (date.fromisoformat(e["date"]) - today).days
        except Exception:
            days = None
        items.append({"catalyst": "Earnings report", "impact": 7, "probability": 1.0, "days": days, "kind": "scheduled"})
    fl = (events_trigger or {}).get("flags", []) if events_trigger else []
    if "insider_cluster_buy" in fl: items.append({"catalyst": "Insider cluster buying", "impact": 6, "probability": 0.7, "days": 30, "kind": "observed"})
    elif "insider_notable_buy" in fl: items.append({"catalyst": "Notable insider purchase", "impact": 4, "probability": 0.6, "days": 45, "kind": "observed"})
    if "results_filed" in fl: items.append({"catalyst": "Results just filed (post-earnings drift window)", "impact": 5, "probability": 0.6, "days": 45, "kind": "observed"})
    if hfe_candidate:
        for th in hfe_candidate.get("theses", [])[:2]:
            items.append({"catalyst": f"{th['thesis_id']} confirmation signal", "impact": 6, "probability": 0.5, "days": 180, "kind": "thesis"})
    if attention and attention.get("not_priced"): items.append({"catalyst": "Public attention rising while unpriced", "impact": 4, "probability": 0.5, "days": 60, "kind": "observed"})
    for c in (strategist.get("catalysts") or [])[:2]:
        if "quarterly report" not in c.lower():
            items.append({"catalyst": c[:90], "impact": 4, "probability": 0.4, "days": 120, "kind": "inferred"})
    def weight(it: dict) -> float:
        d = it.get("days") if it.get("days") is not None else 180
        timing = 1.0 if d <= 60 else 0.7 if d <= 180 else 0.4
        return it["impact"] / 10 * it["probability"] * timing
    raw = sum(weight(i) for i in items)
    score = r(min(100, 100 * (1 - np.exp(-raw / 1.2))), 0)
    nxt = min((i for i in items if i.get("days") is not None and i["days"] >= 0), key=lambda i: i["days"], default=None)
    return {"score": score, "items": items[:6], "next": nxt, "n": len(items)}


# ------------------------------------------------------------------ composite entry score
def entry_score(fund: Optional[float], val: Optional[float], mom: Optional[float], cat: Optional[float], reg: Optional[float], flows: Optional[float]) -> dict:
    parts = {"fundamentals": fund, "valuation": val, "momentum": mom, "catalyst": cat, "regime": reg, "flows": flows}
    score = wmean([(v, WEIGHTS[k]) for k, v in parts.items()])
    label = ("attractive entry / build" if score is not None and score >= RULES["entry_build"] else "accumulate slowly" if score is not None and score >= RULES["entry_min"]
             else "hold / watch" if score is not None and score >= 45 else "avoid for now")
    return {"score": r(score, 0), "label": label, "components": {k: r(v, 0) for k, v in parts.items()}, "weights": WEIGHTS}


# ------------------------------------------------------------------ correlation clusters, portfolio vol, beta
def returns_matrix(prices: dict[str, pd.DataFrame], tickers: list[str], window: int = 60) -> pd.DataFrame:
    cols = {}
    for t in tickers:
        df = prices.get(t)
        if df is not None and len(df) > window + 5:
            s = df.sort_values("date").set_index("date")["adj_close"].pct_change().iloc[-window:]
            cols[t] = s
    return pd.DataFrame(cols).dropna(how="all")


def clusters(ret: pd.DataFrame, threshold: float = RULES["cluster_corr"]) -> dict[str, int]:
    """Union-find over pairwise correlation > threshold -> cluster id per ticker."""
    if ret.empty:
        return {}
    c = ret.corr().fillna(0)
    parent = {t: t for t in c.columns}
    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]; x = parent[x]
        return x
    for i, a in enumerate(c.columns):
        for b in c.columns[i + 1:]:
            if c.loc[a, b] > threshold:
                parent[find(a)] = find(b)
    roots = {}
    return {t: roots.setdefault(find(t), len(roots) + 1) for t in c.columns}


def portfolio_vol(ret: pd.DataFrame, weights: dict[str, float]) -> Optional[float]:
    cols = [t for t in ret.columns if weights.get(t)]
    if not cols:
        return None
    w = np.array([weights[t] for t in cols])
    cov = ret[cols].cov().values * 252
    return float(np.sqrt(w @ cov @ w))


def beta_to(ret: pd.DataFrame, bench: pd.Series, weights: dict[str, float]) -> Optional[float]:
    cols = [t for t in ret.columns if weights.get(t)]
    if not cols or bench is None:
        return None
    port = (ret[cols] * np.array([weights[t] for t in cols])).sum(axis=1) / sum(weights[t] for t in cols)
    j = pd.concat([port.rename("p"), bench.rename("b")], axis=1).dropna()
    if len(j) < 30 or j["b"].var() == 0:
        return None
    return float(j["p"].cov(j["b"]) / j["b"].var())


# ------------------------------------------------------------------ hedge engine
def hedge_engine(holdings: list[dict], prices: dict[str, pd.DataFrame], risk: dict, regime: dict, flows: dict, portfolio_value: float,
                 window: int = 60) -> dict:
    weights = {h["ticker"]: h["weight"] for h in holdings}
    equity = sum(weights.values())
    ret = returns_matrix(prices, list(weights), window)
    bench = {}
    for sym in ("SPY", "QQQ", "SMH", "TLT", "XLE", "USO", "DXY"):
        df = prices.get(sym)
        if df is not None and len(df) > window + 5:
            bench[sym] = df.sort_values("date").set_index("date")["adj_close"].pct_change().iloc[-window:]
    pvol = portfolio_vol(ret, weights)
    betas = {sym: r(beta_to(ret, s, weights), 2) for sym, s in bench.items()}
    beta_spy = betas.get("SPY")
    sector_w: dict[str, float] = {}
    for h in holdings:
        sector_w[h["sector"]] = sector_w.get(h["sector"], 0) + h["weight"]
    cl = clusters(ret)
    cluster_w: dict[int, float] = {}
    for t, cid in cl.items():
        cluster_w[cid] = cluster_w.get(cid, 0) + weights.get(t, 0)
    cluster_members = {cid: [t for t, c in cl.items() if c == cid] for cid in cluster_w}
    # staircase: volatility -> trend -> credit
    risk_score = risk.get("risk_score") or 50
    vol_warning = bool(pvol and pvol > RULES["target_vol"] * 1.3)
    trend_bad = not (regime.get("index_gate") or {}).get("open", True)
    hy = next((s for s in risk.get("signals", []) if s["name"].startswith("HY spread 1m")), None)
    credit_bad = bool(hy and (hy.get("risk_score") or 50) >= 65)
    level = "normal"; target_exposure = 1.0
    if vol_warning: level, target_exposure = "volatility warning", 0.8
    if vol_warning and trend_bad: level, target_exposure = "volatility + trend deterioration", 0.65
    if vol_warning and trend_bad and credit_bad: level, target_exposure = "volatility + trend + credit deterioration", 0.5
    vol_mult = min(1.0, RULES["target_vol"] / pvol) if pvol else 1.0
    vol_mult = max(RULES["vol_floor_mult"], vol_mult)
    recs = []
    beta_target = (risk.get("posture", {}).get("beta_target", {}) or {}).get("recommended")
    if beta_spy and beta_target and beta_spy * equity > beta_target * 1.1:
        excess = (beta_spy * equity - beta_target) * portfolio_value
        recs.append({"risk": "Market beta", "instrument": "SPY (short, inverse, or index put spread)", "notional": r(excess, 0),
                     "why": f"Portfolio beta {beta_spy:.2f} on {equity:.0%} equity = {beta_spy * equity:.2f} vs target {beta_target:.2f}"})
    tech = sector_w.get("Technology", 0) + sector_w.get("Communication Services", 0)
    if tech > 0.30 and betas.get("QQQ"):
        recs.append({"risk": "Technology concentration", "instrument": "QQQ" if betas.get("SMH") is None else "QQQ / SMH", "notional": r((tech - 0.30) * portfolio_value, 0),
                     "why": f"Tech + comms = {tech:.0%} of the book (beta to QQQ {betas.get('QQQ')})"})
    for cid, w in cluster_w.items():
        if w > RULES["cluster_cap"]:
            recs.append({"risk": f"Correlation cluster {cid} ({', '.join(cluster_members[cid])})", "instrument": SECTOR_HEDGE.get(holdings[0]["sector"], "SPY") if holdings else "SPY",
                         "notional": r((w - RULES["cluster_cap"]) * portfolio_value, 0), "why": f"{w:.0%} in names moving together (corr > {RULES['cluster_corr']})"})
    if betas.get("TLT") is not None and abs(betas["TLT"]) > 0.6:
        recs.append({"risk": "Interest-rate sensitivity", "instrument": "TLT (or Treasury futures)", "notional": r(abs(betas["TLT"]) * equity * portfolio_value * 0.25, 0),
                     "why": f"Equity book beta to TLT {betas['TLT']:.2f}"})
    options_note = None
    if risk_score >= 70:
        options_note = "Risk score >= 70: a put-spread collar on SPY/QQQ (buy ~5% OTM put, sell ~15% OTM put, sell ~7% OTM call) fits a defined-risk window; avoid permanent put buying."
    return {"portfolio_vol_pct": r((pvol or 0) * 100, 1), "target_vol_pct": RULES["target_vol"] * 100, "vol_multiplier": r(vol_mult, 2),
            "betas": betas, "beta_target": beta_target, "sector_weights": {k: r(v, 3) for k, v in sorted(sector_w.items(), key=lambda x: -x[1])},
            "clusters": [{"id": cid, "weight": r(w, 3), "members": cluster_members[cid], "over_cap": w > RULES["cluster_cap"]} for cid, w in sorted(cluster_w.items(), key=lambda x: -x[1])],
            "staircase": {"level": level, "target_exposure": target_exposure, "vol_warning": vol_warning, "trend_deterioration": trend_bad, "credit_deterioration": credit_bad,
                          "risk_score": risk_score},
            "recommendations": recs, "options_note": options_note,
            "hierarchy": ["position sizing", "diversification (clusters)", "volatility scaling", "trend reduction", "factor/index hedge", "options/tail protection"],
            "note": "Recommendations only. Single-name trades stay on the monthly cadence; hedge sleeves may move whenever the staircase changes."}
