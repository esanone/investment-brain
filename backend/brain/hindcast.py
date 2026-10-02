"""Hindcast harness — replay the quantitative engines at past anchor dates using only what was knowable then,
and measure what happened next.

    python -m brain.hindcast [--start 2017-01-01] [--step 3] [--limit N]

For every anchor date T: fundamentals filed on or before T, prices up to T, macro observations up to T.
Outputs: information coefficient and quintile spread of each signal vs forward excess returns, regime-probability
calibration (Brier), a rules-based strategy equity curve vs the S&P 500, and rule ablation (what each gate adds).

Not hindcast: the LLM engines (brief, long-term thesis, Human Futures Engine) — the model knows how the past
turned out, so replaying them would be contaminated. They are validated prospectively through the thesis ledger.
"""
from __future__ import annotations

import argparse
import time
from datetime import date, datetime
from typing import Optional

import numpy as np
import pandas as pd
from sqlalchemy import select

from .data import prices as price_src
from .db import init_db, session_scope
from .engines import fundamentals as fund_engine, pm, regime as regime_engine
from .engines.technicals import trend_template
from .models import Company, Fundamental, MacroObservation, Snapshot
from .universe import INSTRUMENTS, SECTOR_ETF

HORIZONS = {"3m": 63, "6m": 126, "12m": 252}
SIGNALS = {"quality": "Quality", "growth": "Growth", "value": "Value (sector-relative + own history)", "acceleration": "Fundamental acceleration",
           "price_momentum": "Price momentum", "expectations_gap": "Expectations gap (Reality - Pricing)", "trend_template": "Trend template (0-100)",
           "expected_return": "Scenario expected return"}


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


def _load(limit: Optional[int], price_range: str) -> dict:
    with session_scope() as s:
        companies = {c.ticker: {"ticker": c.ticker, "name": c.name, "sector": c.sector} for c in s.execute(select(Company)).scalars()}
        have = {x[0] for x in s.execute(select(Fundamental.ticker).distinct())}
        macro_df = pd.read_sql(select(MacroObservation), s.connection())
    tickers = [t for t in companies if t in have][: limit or None]
    with session_scope() as s:
        fdf = pd.read_sql(select(Fundamental).where(Fundamental.ticker.in_(tickers)), s.connection())
    fdf["period_end"] = pd.to_datetime(fdf["period_end"]); fdf["filed"] = pd.to_datetime(fdf["filed"])
    fundamentals = {t: g for t, g in fdf.groupby("ticker")}
    macro_df["date"] = pd.to_datetime(macro_df["date"])
    macro = {sid: g.set_index("date")["value"].sort_index() for sid, g in macro_df.groupby("series_id")}
    price_src.register_etfs([sym for sym, (_, g, _) in INSTRUMENTS.items() if g != "crypto" and sym != "^VIX"])
    prices = {}
    syms = tickers + ["SPY"] + list(SECTOR_ETF.values())
    log(f"hindcast: loading {price_range} prices for {len(syms)} symbols (cached after the first run)")
    from concurrent.futures import ThreadPoolExecutor

    def fetch(sym):
        try:
            return sym, price_src.fetch_history(sym, price_range)
        except Exception:
            return sym, None

    with ThreadPoolExecutor(max_workers=4) as ex:
        for i, (sym, df) in enumerate(ex.map(fetch, syms), 1):
            if df is not None and not df.empty:
                df["date"] = pd.to_datetime(df["date"]); prices[sym] = df.sort_values("date").reset_index(drop=True)
            if i % 100 == 0:
                log(f"hindcast: prices {i}/{len(syms)}")
    return {"companies": {t: companies[t] for t in tickers}, "fundamentals": fundamentals, "macro": macro, "prices": prices}


def _fwd(px: pd.DataFrame, T: pd.Timestamp, days: int) -> Optional[float]:
    p = px[px.date <= T]
    f = px[px.date > T]
    if len(p) < 1 or len(f) < days:
        return None
    return float(f.close.iloc[days - 1] / p.close.iloc[-1] - 1)


def _anchor(T: pd.Timestamp, data: dict) -> Optional[pd.DataFrame]:
    companies, prices = data["companies"], data["prices"]
    analyses = {}
    for t, c in companies.items():
        px = prices.get(t)
        if px is None:
            continue
        pxt = px[px.date <= T]
        if len(pxt) < 260:
            continue
        a = fund_engine.analyze_company(t, data["fundamentals"].get(t), pxt, T.date(), sector=c["sector"])
        if a:
            analyses[t] = a
    if len(analyses) < 40:
        return None
    scores = fund_engine.score_universe(analyses, companies, None)
    spy = prices["SPY"]
    spy_t = spy[spy.date <= T]
    sector_medians = {}
    for sec in {companies[t]["sector"] for t in analyses}:
        vals = {k: [analyses[t]["valuation"].get(k) for t in analyses if companies[t]["sector"] == sec and analyses[t]["valuation"].get(k)] for k in ("pe", "ev_ebitda", "ev_sales", "p_fcf")}
        sector_medians[sec] = {k: float(np.median(v)) for k, v in vals.items() if len(v) >= 3}
    rows = []
    for t, a in analyses.items():
        px = prices[t]; pxt = px[px.date <= T]
        tt = trend_template(pxt, spy_t)
        er = pm.expected_return(a, sector_medians.get(companies[t]["sector"], {}), None)
        sc = scores.get(t, {})
        row = {"ticker": t, "sector": companies[t]["sector"], **{k: sc.get(k) for k in ("quality", "growth", "value", "acceleration", "price_momentum")},
               "expectations_gap": None if sc.get("reality") is None or sc.get("pricing") is None else sc["reality"] - sc["pricing"],
               "reality": sc.get("reality"), "trend_template": (tt or {}).get("score"), "trend_ready": bool((tt or {}).get("ready")),
               "expected_return": (er or {}).get("expected_return_pct"), "er_band": (er or {}).get("band")}
        for h, d in HORIZONS.items():
            f, fs = _fwd(px, T, d), _fwd(spy, T, d)
            row[f"fwd_{h}"] = None if f is None else f * 100
            row[f"xs_{h}"] = None if f is None or fs is None else (f - fs) * 100
        rows.append(row)
    return pd.DataFrame(rows)


_DATA: dict = {}


def _anchor_worker(T: pd.Timestamp):
    import warnings
    warnings.filterwarnings("ignore")
    return T, _anchor(T, _DATA)


def _regime_worker(T: pd.Timestamp) -> Optional[float]:
    try:
        pr = regime_engine.compute(_DATA["macro"], T.date())["regime"]["probabilities"]
        return (pr["Stagflation"] + pr["Contraction"]) / 100
    except Exception:
        return None


def _spearman(a: pd.Series, b: pd.Series) -> Optional[float]:
    j = pd.concat([a, b], axis=1).dropna()
    if len(j) < 25:
        return None
    return float(j.iloc[:, 0].rank().corr(j.iloc[:, 1].rank()))


def _perf(rets: list[float], periods_per_year: float) -> dict:
    if not rets:
        return {"cagr": None, "max_drawdown": None, "sharpe": None}
    eq = np.cumprod([1 + x for x in rets])
    years = len(rets) / periods_per_year
    cagr = eq[-1] ** (1 / years) - 1 if years > 0 else None
    peak = np.maximum.accumulate(eq)
    dd = float((eq / peak - 1).min())
    sd = np.std(rets)
    sharpe = float(np.mean(rets) / sd * np.sqrt(periods_per_year)) if sd > 0 else None
    return {"cagr": round(float(cagr), 4) if cagr is not None else None, "max_drawdown": round(dd, 4), "sharpe": round(sharpe, 2) if sharpe is not None else None}


def _strategy(frames: dict[pd.Timestamp, pd.DataFrame], data: dict, step_m: int, use_trend: bool, use_regime: bool, use_valuation: bool) -> dict:
    """Quarterly-rebalanced, equal-weight top names by expectations gap among reality >= 55; gates switchable for ablation."""
    spy = data["prices"]["SPY"]
    anchors = sorted(frames)
    rets, bench, univ, held_prev, turn = [], [], [], set(), []
    for T, T2 in zip(anchors[:-1], anchors[1:]):
        df = frames[T]
        c = df[(df.reality >= 55) & (df.expectations_gap >= 0)]
        if use_trend:
            c = c[c.trend_ready]
        if use_valuation:
            c = c[~c.er_band.isin(["reduce", "exit_candidate"])]
        c = c.sort_values("expectations_gap", ascending=False).head(20)
        spy_t = spy[spy.date <= T]
        gate = True
        if use_regime and len(spy_t) > 260:
            gate = bool(spy_t.close.iloc[-1] > spy_t.close.iloc[-210:].mean() and spy_t.close.iloc[-1] > spy_t.close.iloc[-252])
        w = min(0.05, 1 / max(len(c), 1)) if len(c) else 0
        invest = (len(c) * w) * (1.0 if gate else 0.5)
        r_names = []
        for t in c.ticker:
            px = data["prices"][t]
            p0 = px[px.date <= T].close.iloc[-1]; p1s = px[px.date <= T2]
            if len(p1s):
                r_names.append(float(p1s.close.iloc[-1] / p0 - 1))
        port = (np.mean(r_names) if r_names else 0.0) * invest
        s0 = spy[spy.date <= T].close.iloc[-1]; s1 = spy[spy.date <= T2].close.iloc[-1]
        rets.append(port); bench.append(float(s1 / s0 - 1))
        u = []
        for t in df.ticker:   # every name scoreable at T, equal weight: carries the same survivorship as the strategy
            px = data["prices"][t]; a_, b_ = px[px.date <= T], px[px.date <= T2]
            if len(a_) and len(b_):
                u.append(float(b_.close.iloc[-1] / a_.close.iloc[-1] - 1))
        univ.append(float(np.mean(u)) if u else 0.0)
        now = set(c.ticker)
        turn.append(len(now ^ held_prev) / max(len(now | held_prev), 1)); held_prev = now
    ppy = 12 / step_m
    out = _perf(rets, ppy); out["turnover"] = round(float(np.mean(turn)) * ppy, 2) if turn else None   # annualised, 1.0 = the whole book replaced each year
    b = _perf(bench, ppy)
    eq_s, eq_b = np.cumprod([1 + x for x in rets]) * 100, np.cumprod([1 + x for x in bench]) * 100
    curve = [{"date": anchors[0].date().isoformat(), "strategy": 100.0, "benchmark": 100.0}] + [
        {"date": T.date().isoformat(), "strategy": round(float(a), 1), "benchmark": round(float(bb), 1)} for T, a, bb in zip(anchors[1:], eq_s, eq_b)]
    hit = float(np.mean([1 if a > bb else 0 for a, bb in zip(rets, bench)])) if rets else None
    return {"perf": out, "bench": b, "universe": _perf(univ, ppy), "curve": curve, "hit_rate": hit,
            "avg_invested": None}


def run(start: str = "2017-01-01", step_m: int = 3, limit: Optional[int] = None, price_range: str = "15y", workers: int = 4) -> dict:
    init_db()
    t0 = time.time()
    data = _load(limit, price_range)
    spy = data["prices"]["SPY"]
    first = max(pd.Timestamp(start), spy.date.iloc[0] + pd.Timedelta(days=400))
    last = spy.date.iloc[-1] - pd.Timedelta(days=95)
    anchors = [d for d in pd.date_range(first, last, freq=f"{step_m}MS")]
    log(f"hindcast: {len(anchors)} anchors from {anchors[0].date()} to {anchors[-1].date()}, {len(data['companies'])} companies")
    frames: dict[pd.Timestamp, pd.DataFrame] = {}
    global _DATA
    _DATA = data   # inherited by forked workers; nothing is pickled on the way in
    import multiprocessing as mp
    with mp.get_context("fork").Pool(workers) as pool:
        for i, (T, df) in enumerate(pool.imap(_anchor_worker, anchors), 1):
            if df is not None:
                frames[T] = df
            log(f"hindcast: anchor {i}/{len(anchors)} {T.date()} -> {0 if df is None else len(df)} names ({time.time() - t0:.0f}s)")
        regime_anchors = list(pd.date_range("2004-01-01", pd.Timestamp(date.today()) - pd.DateOffset(months=7), freq="3MS"))
        regime_probs = pool.map(_regime_worker, regime_anchors) if "INDPRO" in data["macro"] else []
    # --- signal information
    signals = []
    for name, label in SIGNALS.items():
        ic, quint = {}, {}
        for h in HORIZONS:
            vals, qs = [], []
            for T, df in frames.items():
                v = _spearman(df[name], df[f"xs_{h}"])
                if v is not None:
                    vals.append(v)
                j = df[[name, f"fwd_{h}"]].dropna()
                if len(j) >= 40:
                    j["q"] = pd.qcut(j[name].rank(method="first"), 5, labels=False)
                    qs.append(j.groupby("q")[f"fwd_{h}"].mean().values)
            if vals:
                m, sd = float(np.mean(vals)), float(np.std(vals))
                ic[h] = {"mean_ic": round(m, 3), "t_stat": round(m / sd * np.sqrt(len(vals)), 2) if sd > 0 else None, "hit_rate": round(float(np.mean([x > 0 for x in vals])), 2), "n": len(vals)}
            if qs:
                quint[h] = [round(float(x), 1) for x in np.mean(qs, axis=0)]
        signals.append({"name": name, "label": label, "ic": ic, "quintiles": quint})
    # --- regime calibration: P(Stagflation)+P(Contraction) vs industrial production falling over the next 6 months
    reg = None
    indpro = data["macro"].get("INDPRO")
    if indpro is not None:
        preds = []
        for T, p in zip(regime_anchors, regime_probs):
            now, fut = indpro[indpro.index <= T], indpro[indpro.index <= T + pd.DateOffset(months=6)]
            if p is not None and len(now) and len(fut) and fut.index[-1] > now.index[-1]:
                preds.append((p, 1.0 if fut.iloc[-1] < now.iloc[-1] else 0.0))
        if preds:
            P = pd.DataFrame(preds, columns=["p", "y"])
            P["bin"] = pd.cut(P.p, [0, 0.3, 0.4, 0.5, 0.6, 1.0], labels=["<30%", "30-40%", "40-50%", "50-60%", ">60%"])
            cal = [{"bin": str(b), "n": int(len(g)), "predicted": round(float(g.p.mean()), 3), "realised": round(float(g.y.mean()), 3)} for b, g in P.groupby("bin", observed=True) if len(g)]
            reg = {"brier": round(float(((P.p - P.y) ** 2).mean()), 3), "calibration": cal, "event": "industrial production lower six months later", "n": len(P), "window": "quarterly since 2004"}
    # --- strategy + ablation
    base = _strategy(frames, data, step_m, True, True, True)
    rules = []
    for name, label, kw in (("trend", "Trend-template entry gate", dict(use_trend=False, use_regime=True, use_valuation=True)),
                            ("regime", "Index regime gate (half exposure when closed)", dict(use_trend=True, use_regime=False, use_valuation=True)),
                            ("valuation", "Expected-return valuation gate", dict(use_trend=True, use_regime=True, use_valuation=False))):
        alt = _strategy(frames, data, step_m, **kw)
        d = (base["perf"]["cagr"] or 0) - (alt["perf"]["cagr"] or 0)
        dd = (base["perf"]["max_drawdown"] or 0) - (alt["perf"]["max_drawdown"] or 0)
        rules.append({"name": name, "label": label, "with_rule": base["perf"], "without_rule": alt["perf"],
                      "delta_note": f"With the rule: CAGR {d * 100:+.1f} pts, max drawdown {dd * 100:+.1f} pts (positive = shallower)"})
    out = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "config": {"start": anchors[0].date().isoformat(), "end": anchors[-1].date().isoformat(), "step_months": step_m, "horizons_months": [3, 6, 12],
                   "universe_size": len(data["companies"]),
                   "note": "Point-in-time: fundamentals by SEC filing date, prices and macro by observation date. Equal-weight top 20 by expectations gap among Reality >= 55, rebalanced each anchor."},
        "anchors": len(frames), "signals": signals, "regime": reg, "rules": rules, "equity_curve": base["curve"],
        "summary": {"cagr": base["perf"]["cagr"], "benchmark_cagr": base["bench"]["cagr"], "max_drawdown": base["perf"]["max_drawdown"],
                    "benchmark_max_drawdown": base["bench"]["max_drawdown"], "universe_cagr": base["universe"]["cagr"],
                    "universe_max_drawdown": base["universe"]["max_drawdown"], "sharpe": base["perf"]["sharpe"],
                    "hit_rate": None if base["hit_rate"] is None else round(base["hit_rate"], 2), "turnover": base["perf"]["turnover"]},
        "caveats": [
            "Survivorship: the universe is today's list; companies that failed or were removed are missing, which flatters results. "
            "Judge the strategy against the equal-weight universe (same bias), not only against the S&P 500.",
            "Drawdowns are measured at rebalance dates only, so intra-quarter falls (March 2020) are understated.",
            "Share counts before today come from XBRL filings, which are unreliable for multi-class companies; live runs use exchange market caps instead.",
            "Macro series use observation dates without revision vintages (ALFRED would fix this).",
            "Stops, intra-period exits, transaction costs and taxes are not simulated; positions are held between anchors.",
            "The LLM engines (brief, theses, Human Futures Engine) are not hindcast: the model knows the past. They are scored prospectively in the thesis ledger.",
            "A short window with few anchors gives wide error bars: treat information coefficients with |t| below 2 as unproven.",
        ],
    }
    with session_scope() as s:
        s.add(Snapshot(run_id=f"hc-{datetime.now().strftime('%Y%m%d-%H%M%S')}", kind="hindcast", key="", as_of=date.today(), payload=out))
    log(f"hindcast: done in {time.time() - t0:.0f}s; strategy CAGR {out['summary']['cagr']} vs benchmark {out['summary']['benchmark_cagr']}; "
        + "; ".join(f"{sg['name']} IC12m {sg['ic'].get('12m', {}).get('mean_ic')}" for sg in signals))
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default="2017-01-01"); ap.add_argument("--step", type=int, default=3); ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--range", default="15y")
    a = ap.parse_args()
    run(a.start, a.step, a.limit, a.range)
