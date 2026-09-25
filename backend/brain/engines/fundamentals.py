"""Company Intelligence Engine — behaves like an equity research analyst.

`analyze_company` builds a point-in-time model from EDGAR XBRL (growth, profitability,
cash generation, capital structure, returns with ROIC emphasised) and prices it
(market cap, EV, multiples vs the company's own 5y history).
`score_universe` then ranks Growth / Quality / Value cross-sectionally
(value is sector-relative) and derives Reality / Pricing inputs for the strategist.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

import numpy as np
import pandas as pd

from .common import clip, pct_of_history, pct_rank, r, safe_div, trailing_return, wmean

ORDER_DECAY = {1: 1.0, 2: 0.6, 3: 0.35}


# ------------------------------------------------------------------ point-in-time frames
def _ttm_frame(fdf: pd.DataFrame, as_of: pd.Timestamp) -> pd.DataFrame:
    """TTM metrics pivoted by period_end, only rows filed on/before as_of."""
    t = fdf[(fdf.period_type == "TTM") & (fdf.filed.notna()) & (pd.to_datetime(fdf.filed) <= as_of)]
    if t.empty:
        return pd.DataFrame()
    piv = t.pivot_table(index="period_end", columns="metric", values="value", aggfunc="last").sort_index()
    filed = t.groupby("period_end")["filed"].max()
    piv["_filed"] = filed
    return piv


def _instant_frame(fdf: pd.DataFrame, as_of: pd.Timestamp) -> pd.DataFrame:
    inst_metrics = ["cash", "short_investments", "debt_lt", "debt_st", "equity", "total_assets", "current_assets", "current_liabilities"]
    q = fdf[(fdf.period_type == "Q") & (fdf.metric.isin(inst_metrics)) & (pd.to_datetime(fdf.filed) <= as_of)]
    if q.empty:
        return pd.DataFrame()
    return q.pivot_table(index="period_end", columns="metric", values="value", aggfunc="last").sort_index()


def _nearest_instant(inst: pd.DataFrame, end: pd.Timestamp) -> pd.Series:
    if inst.empty:
        return pd.Series(dtype=float)
    idx = pd.to_datetime(inst.index)
    ok = inst[(idx <= end + pd.Timedelta(days=10)) & (idx >= end - pd.Timedelta(days=100))]
    return ok.iloc[-1] if len(ok) else pd.Series(dtype=float)


def _shares_known(fdf: pd.DataFrame, as_of: pd.Timestamp) -> Optional[float]:
    """Cover-page share count if it is fresh; otherwise the latest diluted weighted average.
    (Some filers stop reporting dei shares or report one class only.)"""
    so = fdf[(fdf.metric == "shares_out") & (pd.to_datetime(fdf.filed) <= as_of)].sort_values(["period_end", "filed"])
    d = fdf[(fdf.metric == "shares_diluted") & (fdf.period_type == "Q") & (pd.to_datetime(fdf.filed) <= as_of)].sort_values("period_end")
    if len(so):
        so_end = pd.Timestamp(so.iloc[-1].period_end)
        d_end = pd.Timestamp(d.iloc[-1].period_end) if len(d) else None
        stale = d_end is not None and (d_end - so_end).days > 200
        if not stale:
            # sanity: a cover-page count wildly different from the diluted average is a units/class error
            if not len(d) or float(d.iloc[-1].value) <= 0 or 0.5 < float(so.iloc[-1].value) / float(d.iloc[-1].value) < 2.5:
                return float(so.iloc[-1].value)
    return float(d.iloc[-1].value) if len(d) else None


def _reconcile_shares(shares: Optional[float], m: dict) -> Optional[float]:
    """Cross-check the share count against net income / EPS. Some filers report share
    counts in millions (McDonald's) or one class only; NI/EPS is unit-consistent."""
    ni, eps = m.get("net_income"), m.get("eps")
    implied = ni / eps if ni and eps and eps > 0 and ni > 0 else None
    if implied is None:
        return shares
    if shares is None or not (0.5 < shares / implied < 2.0):
        return implied
    return shares


def _g(row: pd.Series, k: str) -> Optional[float]:
    v = row.get(k) if row is not None else None
    return None if v is None or (isinstance(v, float) and not np.isfinite(v)) else float(v)


def _derive(ttm: pd.DataFrame, inst: pd.DataFrame, i: int, financial: bool = False) -> dict:
    """Derived metrics for TTM row i (needs row i-4 for growth).
    financial=True: EV, net debt, interest coverage and ROIC are not meaningful (banks, brokers)."""
    row = ttm.iloc[i]
    prev = ttm.iloc[i - 4] if i >= 4 else None
    prev1 = ttm.iloc[i - 1] if i >= 1 else None
    end = pd.Timestamp(ttm.index[i])
    bs = _nearest_instant(inst, end)
    bs_prev = _nearest_instant(inst, pd.Timestamp(ttm.index[i - 4])) if i >= 4 else pd.Series(dtype=float)

    rev, cogs, gp = _g(row, "revenue"), _g(row, "cogs"), _g(row, "gross_profit")
    if gp is None and rev is not None and cogs is not None:
        gp = rev - cogs
    op, ni, ocf, capex, da = (_g(row, k) for k in ("operating_income", "net_income", "ocf", "capex", "da"))
    op_estimated = False
    if op is None and _g(row, "pretax_income") is not None:
        # no OperatingIncomeLoss tag: approximate EBIT as pretax income + interest expense (pretax for financials)
        op = _g(row, "pretax_income") + (0.0 if financial else (_g(row, "interest_expense") or 0.0))
        op_estimated = True
    fcf = None if ocf is None else ocf - (capex or 0.0)
    ebitda = None if op is None else op + (da or 0.0)
    tax, pretax = _g(row, "tax"), _g(row, "pretax_income")
    tax_rate = clip(safe_div(tax, pretax), 0.05, 0.40) if pretax and pretax > 0 else None
    tax_rate = 0.21 if tax_rate is None else tax_rate
    nopat = None if op is None else op * (1 - tax_rate)

    cash = (_g(bs, "cash") or 0.0) + (_g(bs, "short_investments") or 0.0)
    debt = (_g(bs, "debt_lt") or 0.0) + (_g(bs, "debt_st") or 0.0)
    equity, assets = _g(bs, "equity"), _g(bs, "total_assets")
    ic = None if equity is None else max(equity + debt - cash, 1.0)
    cash_p = (_g(bs_prev, "cash") or 0.0) + (_g(bs_prev, "short_investments") or 0.0)
    debt_p = (_g(bs_prev, "debt_lt") or 0.0) + (_g(bs_prev, "debt_st") or 0.0)
    equity_p = _g(bs_prev, "equity")
    ic_p = None if equity_p is None else max(equity_p + debt_p - cash_p, 1.0)
    avg_ic = None if ic is None else (ic + ic_p) / 2 if ic_p else ic
    # Net-cash companies have tiny or negative invested capital; floor at 10% of assets so ROIC stays meaningful
    if avg_ic is not None and assets:
        avg_ic = max(avg_ic, 0.10 * assets)
    if financial:
        avg_ic = None

    rev_p = _g(prev, "revenue") if prev is not None else None
    ni_p = _g(prev, "net_income") if prev is not None else None
    eps, eps_p = _g(row, "eps_diluted"), (_g(prev, "eps_diluted") if prev is not None else None)
    ocf_p, capex_p = (_g(prev, "ocf"), _g(prev, "capex")) if prev is not None else (None, None)
    fcf_p = None if ocf_p is None else ocf_p - (capex_p or 0.0)
    op_p = _g(prev, "operating_income") if prev is not None else None
    if op_p is None and prev is not None and _g(prev, "pretax_income") is not None:
        op_p = _g(prev, "pretax_income") + (0.0 if financial else (_g(prev, "interest_expense") or 0.0))
    nopat_p = None if op_p is None else op_p * (1 - tax_rate)
    sh, sh_p = _g(row, "shares_diluted"), (_g(prev, "shares_diluted") if prev is not None else None)

    rev_growth = safe_div(rev, rev_p)
    rev_growth = None if rev_growth is None else rev_growth - 1
    rev_growth_prev = None
    if prev1 is not None and i >= 5:
        rg_prev = safe_div(_g(prev1, "revenue"), _g(ttm.iloc[i - 5], "revenue"))
        rev_growth_prev = None if rg_prev is None else rg_prev - 1
    inc_roic = None
    if nopat is not None and nopat_p is not None and ic is not None and ic_p is not None and ic_p > 0 and (ic - ic_p) > 0.02 * ic_p:
        inc_roic = clip((nopat - nopat_p) / (ic - ic_p), -5.0, 5.0)

    return {
        "period_end": end.date().isoformat(), "filed": str(row.get("_filed"))[:10],
        "revenue": rev, "gross_profit": gp, "operating_income": op, "net_income": ni, "ebitda": ebitda,
        "ocf": ocf, "capex": capex, "fcf": fcf, "eps": eps, "shares_diluted": sh,
        "cash": cash, "debt": debt, "net_debt": debt - cash, "equity": equity, "total_assets": assets,
        "rnd": _g(row, "rnd"), "sbc": _g(row, "sbc"), "buybacks": _g(row, "buybacks"), "dividends": _g(row, "dividends"),
        "gross_margin": safe_div(gp, rev), "operating_margin": safe_div(op, rev), "net_margin": safe_div(ni, rev),
        "fcf_margin": safe_div(fcf, rev), "fcf_conversion": safe_div(fcf, ni) if ni and ni > 0 else None,
        "revenue_growth": rev_growth, "revenue_growth_prev": rev_growth_prev,
        "revenue_acceleration": None if rev_growth is None or rev_growth_prev is None else rev_growth - rev_growth_prev,
        "eps_growth": (safe_div(eps, eps_p) - 1) if eps and eps_p and eps_p > 0 else None,
        "net_income_growth": (safe_div(ni, ni_p) - 1) if ni and ni_p and ni_p > 0 else None,
        "fcf_growth": (safe_div(fcf, fcf_p) - 1) if fcf and fcf_p and fcf_p > 0 else None,
        "operating_margin_change": None if op is None or op_p is None or not rev or not rev_p else safe_div(op, rev) - safe_div(op_p, rev_p),
        "roic": safe_div(nopat, avg_ic), "incremental_roic": None if financial else inc_roic,
        "operating_income_estimated": op_estimated, "financial": financial,
        "roe": safe_div(ni, equity) if equity and equity > 0 else None, "roa": safe_div(ni, assets),
        "net_debt_to_ebitda": safe_div(debt - cash, ebitda) if ebitda and ebitda > 0 and not financial else None,
        "interest_coverage": safe_div(op, _g(row, "interest_expense")) if _g(row, "interest_expense") and not financial else None,
        # |dilution| > 40% in a year is almost always a split artefact, not real issuance
        "dilution": (lambda d: None if d is None or abs(d) > 0.4 else d)((safe_div(sh, sh_p) - 1) if sh and sh_p else None),
        "sbc_pct_revenue": safe_div(_g(row, "sbc"), rev),
        "tax_rate": tax_rate,
    }


# ------------------------------------------------------------------ pricing
def _price_on(px: pd.DataFrame, d: pd.Timestamp) -> Optional[float]:
    s = px[px.date <= d]
    return float(s.close.iloc[-1]) if len(s) else None


def _cap(x: Optional[float], hi: float) -> Optional[float]:
    return None if x is None or x > hi or x < 0 else x


def _multiples(mcap: Optional[float], m: dict) -> dict:
    if not mcap:
        return {}
    financial = bool(m.get("financial"))
    ev = None if financial else mcap + (m.get("net_debt") or 0.0)
    ni, fcf, rev, ebitda = m.get("net_income"), m.get("fcf"), m.get("revenue"), m.get("ebitda")
    pe = _cap(safe_div(mcap, ni) if ni and ni > 0 else None, 500)
    eg = m.get("eps_growth")
    return {
        "market_cap": mcap, "enterprise_value": ev,
        "pe": pe, "ev_ebitda": _cap(safe_div(ev, ebitda), 500) if ev and ebitda and ebitda > 0 else None,
        "ev_sales": _cap(safe_div(ev, rev), 200) if ev and rev and rev > 0 else None,
        "p_fcf": _cap(safe_div(mcap, fcf), 500) if fcf and fcf > 0 and not financial else None,
        "fcf_yield": None if financial else safe_div(fcf, mcap), "earnings_yield": safe_div(ni, mcap),
        "peg": safe_div(pe, eg * 100) if pe and eg and eg > 0.02 else None,
        "buyback_yield": safe_div(m.get("buybacks"), mcap), "dividend_yield": safe_div(m.get("dividends"), mcap),
        "shareholder_yield": safe_div((m.get("buybacks") or 0) + (m.get("dividends") or 0), mcap),
    }


FINANCIAL_SECTORS = {"Financials"}


def analyze_company(ticker: str, fdf: pd.DataFrame, px: pd.DataFrame, as_of: Optional[date] = None, sector: Optional[str] = None) -> Optional[dict]:
    as_of_ts = pd.Timestamp(as_of or date.today())
    financial = sector in FINANCIAL_SECTORS
    if fdf is None or fdf.empty:
        return None
    fdf = fdf.copy()
    fdf["period_end"] = pd.to_datetime(fdf["period_end"])
    ttm = _ttm_frame(fdf, as_of_ts)
    if ttm.empty or "revenue" not in ttm.columns or len(ttm) < 2:
        return None
    inst = _instant_frame(fdf, as_of_ts)
    history = [_derive(ttm, inst, i, financial) for i in range(max(0, len(ttm) - 16), len(ttm))]
    latest = history[-1]

    px = px.sort_values("date") if px is not None and len(px) else pd.DataFrame(columns=["date", "close", "adj_close", "volume"])
    price = _price_on(px, as_of_ts)
    shares = _reconcile_shares(_shares_known(fdf, as_of_ts) or latest.get("shares_diluted"), latest)
    mcap = price * shares if price and shares else None
    val = _multiples(mcap, latest)

    # Valuation vs own history: monthly multiples over 5y using only what was known at each date
    hist_mult = {"pe": [], "ev_sales": [], "p_fcf": [], "ev_ebitda": []}
    if len(px) > 300 and len(history) >= 6:
        months = pd.date_range(end=as_of_ts - pd.DateOffset(months=1), periods=60, freq="ME")
        hist_rows = [(pd.Timestamp(h["filed"]) if h.get("filed") not in (None, "None", "NaT") else None, h) for h in history]
        for m in months:
            known = [h for f, h in hist_rows if f is not None and f <= m]
            p = _price_on(px, m)
            sh = _reconcile_shares(_shares_known(fdf, m), known[-1]) if known else None
            if not known or not p or not sh:
                continue
            mm = _multiples(p * sh, known[-1])
            for k in hist_mult:
                if mm.get(k) is not None:
                    hist_mult[k].append(mm[k])
    val_pct = {k: pct_of_history(val.get(k), v) for k, v in hist_mult.items()}
    avail = [v for v in val_pct.values() if v is not None]
    val["percentile_vs_history"] = {k: r(v, 0) for k, v in val_pct.items() if v is not None}
    val["cheapness_vs_history"] = r(100 - float(np.mean(avail)), 0) if avail else None
    val["history_median"] = {k: r(float(np.median(v)), 1) for k, v in hist_mult.items() if len(v) >= 6}

    mom = {}
    if len(px) > 260:
        s = px.set_index("date")["adj_close"]
        mom = {"return_1m": r((trailing_return(s, 21) or 0) * 100), "return_3m": r((trailing_return(s, 63) or 0) * 100),
               "return_6m": r((trailing_return(s, 126) or 0) * 100), "return_12m": r((trailing_return(s, 252) or 0) * 100),
               "pct_from_52w_high": r((s.iloc[-1] / s.iloc[-252:].max() - 1) * 100),
               "above_200dma": bool(s.iloc[-1] > s.iloc[-200:].mean()),
               "dist_200dma": r((s.iloc[-1] / s.iloc[-200:].mean() - 1) * 100)}

    return {
        "ticker": ticker, "as_of": as_of_ts.date().isoformat(), "price": r(price, 2), "shares": shares,
        "latest": latest, "history": history, "valuation": val, "momentum": mom,
        "data_quality": {"ttm_quarters": len(ttm), "has_ocf": latest.get("ocf") is not None,
                         "has_operating_income": latest.get("operating_income") is not None,
                         "last_filed": latest.get("filed")},
    }


# ------------------------------------------------------------------ cross-sectional scoring
def score_universe(analyses: dict[str, dict], companies: dict[str, dict], spy: Optional[pd.DataFrame]) -> dict[str, dict]:
    rows = []
    for t, a in analyses.items():
        if not a:
            continue
        L, V, M = a["latest"], a["valuation"], a["momentum"]
        rows.append({
            "ticker": t, "sector": companies[t]["sector"],
            "revenue_growth": L.get("revenue_growth"), "revenue_acceleration": L.get("revenue_acceleration"),
            "eps_growth": L.get("eps_growth"), "fcf_growth": L.get("fcf_growth"),
            "roic": L.get("roic") if L.get("roic") is not None else L.get("roe"), "incremental_roic": L.get("incremental_roic"),
            "gross_margin": L.get("gross_margin"),
            "fcf_margin": L.get("fcf_margin"), "operating_margin_change": L.get("operating_margin_change"),
            "net_debt_to_ebitda": L.get("net_debt_to_ebitda"), "interest_coverage": L.get("interest_coverage"),
            "dilution": L.get("dilution"), "fcf_conversion": L.get("fcf_conversion"),
            "pe": V.get("pe"), "ev_ebitda": V.get("ev_ebitda"), "ev_sales": V.get("ev_sales"), "fcf_yield": V.get("fcf_yield"),
            "peg": V.get("peg"), "cheapness_vs_history": V.get("cheapness_vs_history"),
            "return_3m": M.get("return_3m"), "return_6m": M.get("return_6m"), "return_12m": M.get("return_12m"),
            "pct_from_52w_high": M.get("pct_from_52w_high"),
        })
    df = pd.DataFrame(rows).set_index("ticker")
    if df.empty:
        return {}
    for c in df.columns:
        if c != "sector":
            df[c] = pd.to_numeric(df[c], errors="coerce")
    # winsorise the wild ones
    for c in ("revenue_growth", "eps_growth", "fcf_growth", "roic", "incremental_roic", "interest_coverage"):
        df[c] = df[c].clip(lower=df[c].quantile(0.03), upper=df[c].quantile(0.97))

    P = lambda c, asc=True: pct_rank(df[c], ascending=asc)  # noqa: E731
    growth = pd.concat([P("revenue_growth") * 0.35, P("revenue_acceleration") * 0.25, P("eps_growth") * 0.2, P("fcf_growth") * 0.2], axis=1)
    growth_score = growth.sum(axis=1) / growth.notna().mul([0.35, 0.25, 0.2, 0.2]).sum(axis=1)
    accel = pd.concat([P("revenue_acceleration") * 0.5, P("operating_margin_change") * 0.3, P("revenue_growth") * 0.2], axis=1)
    accel_score = accel.sum(axis=1) / accel.notna().mul([0.5, 0.3, 0.2]).sum(axis=1)
    quality = pd.concat([P("roic") * 0.3, P("gross_margin") * 0.15, P("fcf_margin") * 0.2, P("fcf_conversion") * 0.1,
                         P("net_debt_to_ebitda", asc=False) * 0.1, P("interest_coverage") * 0.05, P("dilution", asc=False) * 0.1], axis=1)
    quality_score = quality.sum(axis=1) / quality.notna().mul([0.3, 0.15, 0.2, 0.1, 0.1, 0.05, 0.1]).sum(axis=1)

    # Value: sector-relative multiples (cheaper = higher) blended with own-history cheapness
    def sector_rank(col: str, asc: bool) -> pd.Series:
        out = pd.Series(index=df.index, dtype=float)
        for sec, grp in df.groupby("sector"):
            base = grp if len(grp) >= 4 else df
            out.loc[grp.index] = pct_rank(base[col], ascending=asc).loc[grp.index]
        return out
    value = pd.concat([sector_rank("pe", False) * 0.25, sector_rank("ev_ebitda", False) * 0.2, sector_rank("ev_sales", False) * 0.15,
                       sector_rank("fcf_yield", True) * 0.2, df["cheapness_vs_history"] * 0.2], axis=1)
    value_score = value.sum(axis=1) / value.notna().mul([0.25, 0.2, 0.15, 0.2, 0.2]).sum(axis=1)

    pm = pd.concat([P("return_3m") * 0.4, P("return_6m") * 0.35, P("return_12m") * 0.25], axis=1)
    price_mom = pm.sum(axis=1) / pm.notna().mul([0.4, 0.35, 0.25]).sum(axis=1)

    out = {}
    for t in df.index:
        gs, qs, vs, ps, acs = (float(x.get(t)) if pd.notna(x.get(t)) else None for x in (growth_score, quality_score, value_score, price_mom, accel_score))
        # Reality = what is actually happening in the business (growth + quality + acceleration)
        reality = wmean([(gs, 0.4), (qs, 0.3), (acs, 0.3)])
        # Pricing = how much is already reflected (rich valuation, strong momentum, near highs)
        near_high = None if pd.isna(df.loc[t, "pct_from_52w_high"]) else float(np.clip(100 + df.loc[t, "pct_from_52w_high"] * 2, 0, 100))
        pricing = wmean([(None if vs is None else 100 - vs, 0.55), (ps, 0.3), (near_high, 0.15)])
        out[t] = {"growth": r(gs, 0), "quality": r(qs, 0), "value": r(vs, 0), "acceleration": r(acs, 0),
                  "price_momentum": r(ps, 0), "reality": r(reality, 0), "pricing": r(pricing, 0)}
    return out
