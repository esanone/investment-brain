"""End-to-end run: ingest (macro, prices, fundamentals) -> engines -> snapshots.

    python -m brain.pipeline run [--limit N] [--skip-ingest] [--no-llm]
    python -m brain.pipeline ingest
"""
from __future__ import annotations

import argparse
import time
import uuid
from datetime import date, datetime
from typing import Optional

import pandas as pd
from sqlalchemy import delete, select

from .config import settings
from .data import edgar, fred, prices as price_src
from .db import init_db, session_scope
from .engines import flows as flows_engine, fundamentals as fund_engine, regime as regime_engine
from .engines import portfolio as portfolio_engine, risk as risk_engine, strategist, themes as theme_engine
from .llm import enrich_thesis, portfolio_memo, provider as llm_provider
from .models import AttentionObservation, Company, Fundamental, Instrument, MacroObservation, Price, Snapshot, Theme, ThemeExposure
from .universe import COMPANIES, INSTRUMENTS, company_tickers


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


# ------------------------------------------------------------------ seeding
def seed_reference(limit: Optional[int]) -> None:
    graph = theme_engine.load_graph()
    themes, exposures = theme_engine.flatten(graph)
    with session_scope() as s:
        for sym, (name, group, sector) in INSTRUMENTS.items():
            s.merge(Instrument(symbol=sym, name=name, group=group, sector=sector))
        for t in company_tickers(limit):
            name, sector, industry, size = COMPANIES[t]
            existing = s.get(Company, t)
            s.merge(Company(ticker=t, name=name, sector=sector, industry=industry, size=size, cik=existing.cik if existing else None, source="seed"))
        s.execute(delete(ThemeExposure))
        s.execute(delete(Theme))
        s.flush()
        for th in themes:
            s.add(Theme(**th))
        s.flush()
        for e in exposures:
            s.add(ThemeExposure(**e))


# ------------------------------------------------------------------ ingestion
def ingest_macro() -> None:
    log("macro: fetching FRED series")
    series = fred.fetch_all()
    with session_scope() as s:
        for sid, ser in series.items():
            s.execute(delete(MacroObservation).where(MacroObservation.series_id == sid))
            s.bulk_insert_mappings(MacroObservation, [{"series_id": sid, "date": d.date(), "value": float(v)} for d, v in ser.items()])
    log(f"macro: {len(series)} series stored")


def ingest_prices(symbols: list[str]) -> None:
    price_src.register_etfs([sym for sym, (_, g, _) in INSTRUMENTS.items() if g != "crypto" and sym != "^VIX"])
    ok = 0
    with session_scope() as s:
        for i, sym in enumerate(symbols, 1):
            df = price_src.fetch_history(sym)
            if df.empty:
                continue
            s.execute(delete(Price).where(Price.symbol == sym))
            s.bulk_insert_mappings(Price, [{"symbol": sym, "date": r.date.date(), "open": float(r.open), "high": float(r.high), "low": float(r.low),
                                            "close": float(r.close), "adj_close": float(r.adj_close), "volume": float(r.volume)} for r in df.itertuples()])
            ok += 1
            if i % 25 == 0:
                s.commit()
                log(f"prices: {i}/{len(symbols)}")
    log(f"prices: {ok}/{len(symbols)} symbols stored")


def ingest_fundamentals(tickers: list[str]) -> None:
    tmap = edgar.load_ticker_map()
    ok = 0
    with session_scope() as s:
        for i, t in enumerate(tickers, 1):
            meta = tmap.get(t)
            if not meta:
                log(f"edgar: no CIK for {t}")
                continue
            try:
                facts = edgar.fetch_companyfacts(meta["cik"])
                rows = edgar.extract_financials(facts)
            except Exception as e:
                log(f"edgar: {t} failed: {e}")
                continue
            c = s.get(Company, t)
            if c:
                c.cik = meta["cik"]
            s.execute(delete(Fundamental).where(Fundamental.ticker == t))
            s.bulk_insert_mappings(Fundamental, [{"ticker": t, "period_type": f.period_type, "period_end": f.period_end,
                                                  "metric": f.metric, "value": f.value, "filed": f.filed} for f in rows])
            ok += 1
            if i % 10 == 0:
                s.commit()
                log(f"edgar: {i}/{len(tickers)}")
    log(f"edgar: {ok}/{len(tickers)} companies stored")


# ------------------------------------------------------------------ loading
def load_frames(tickers: list[str]) -> dict:
    with session_scope() as s:
        companies = {c.ticker: {"ticker": c.ticker, "name": c.name, "sector": c.sector, "industry": c.industry, "size": c.size, "cik": c.cik}
                     for c in s.execute(select(Company)).scalars() if c.ticker in tickers}
        instruments = [{"symbol": i.symbol, "name": i.name, "group": i.group, "sector": i.sector} for i in s.execute(select(Instrument)).scalars()]
        px = pd.read_sql(select(Price), s.connection())
        macro_df = pd.read_sql(select(MacroObservation), s.connection())
        fdf = pd.read_sql(select(Fundamental).where(Fundamental.ticker.in_(tickers)), s.connection())
    px["date"] = pd.to_datetime(px["date"])
    prices = {sym: g.sort_values("date").reset_index(drop=True) for sym, g in px.groupby("symbol")}
    macro_df["date"] = pd.to_datetime(macro_df["date"])
    macro = {sid: g.set_index("date")["value"].sort_index() for sid, g in macro_df.groupby("series_id")}
    fdf["period_end"] = pd.to_datetime(fdf["period_end"])
    fdf["filed"] = pd.to_datetime(fdf["filed"])
    fundamentals = {t: g for t, g in fdf.groupby("ticker")}
    return {"companies": companies, "instruments": instruments, "prices": prices, "macro": macro, "fundamentals": fundamentals}


def index_gate(spy: Optional[pd.DataFrame], fedfunds: Optional[pd.Series]) -> dict:
    """Faber (price > 10-month SMA) and Antonacci (12-month return > T-bills) on the S&P 500. Both must hold for the gate to be open."""
    if spy is None or len(spy) < 260:
        return {"open": True, "note": "not enough index history; gate open by default"}
    px = spy.sort_values("date")["adj_close"]
    sma10m = float(px.iloc[-210:].mean())
    last = float(px.iloc[-1])
    ret12 = float(last / px.iloc[-252] - 1) * 100
    tbill = float(fedfunds.dropna().iloc[-1]) if fedfunds is not None and len(fedfunds.dropna()) else 0.0
    faber, antonacci = last > sma10m, ret12 > tbill
    return {"open": bool(faber and antonacci), "price": round(last, 2), "sma_10m": round(sma10m, 2), "above_sma": faber,
            "return_12m_pct": round(ret12, 1), "tbill_pct": round(tbill, 2), "beats_tbills": antonacci,
            "note": f"SPY {last:.0f} vs 10m SMA {sma10m:.0f} ({'above' if faber else 'below'}); 12m {ret12:+.1f}% vs T-bills {tbill:.2f}% ({'ahead' if antonacci else 'behind'})"}


def load_prior(kind: str) -> Optional[dict]:
    """Latest persisted snapshot of a kind (from the previous run)."""
    from sqlalchemy import desc
    with session_scope() as s:
        row = s.execute(select(Snapshot).where(Snapshot.kind == kind).order_by(desc(Snapshot.id)).limit(1)).scalar()
        return row.payload if row else None


def load_briefs(limit: int = 7) -> list[dict]:
    from sqlalchemy import desc
    with session_scope() as s:
        rows = s.execute(select(Snapshot).where(Snapshot.kind == "brief").order_by(desc(Snapshot.id)).limit(limit)).scalars()
        return [x.payload for x in rows]


def load_narrative() -> dict:
    from .engines.brief import narrative_by_theme
    return narrative_by_theme(load_briefs(7))


def run_brief(use_llm: bool = True) -> dict:
    """Morning Brief: news -> claims -> thesis -> narrative signals. Persists a 'brief' snapshot."""
    from .engines import brief as brief_engine
    init_db()
    t0 = time.time()
    with session_scope() as s:
        companies = {c.ticker: {"ticker": c.ticker, "name": c.name, "sector": c.sector} for c in s.execute(select(Company)).scalars()}
    regime, flows, portfolio = load_prior("regime"), load_prior("flows"), load_prior("portfolio")
    prior = load_briefs(1)
    att = load_prior("attention")
    attention_summary = None
    if att:
        attention_summary = {"themes_rising": [{"theme": t["name"], "attention": t["attention"], "wiki_vs_28d_pct": t["wiki_vs_28d_pct"], "rising_queries": t["rising_queries"][:6]}
                                               for t in att["movers"]["themes_up"][:8]],
                             "companies_rising": [{"ticker": c["ticker"], "attention": c["attention"], "wiki_vs_28d_pct": c["wiki_vs_28d_pct"], "pricing": c["pricing"]} for c in att["movers"]["companies_up"][:8]],
                             "not_priced": [x.get("ticker") or x.get("name") for x in att["movers"]["not_priced"][:10]],
                             "crowded": [c["ticker"] for c in att["movers"]["crowded"][:10]]}
    log("brief: fetching news feeds")
    b = brief_engine.build(regime, flows, portfolio, prior[0] if prior else None, companies, use_llm=use_llm, attention=attention_summary)
    log(f"brief: {b['n_headlines']} headlines, {len(b['clusters'])} theme clusters, llm={b['llm_provider']}")
    with session_scope() as s:
        s.add(Snapshot(run_id=b["brief_id"], kind="brief", key="", as_of=date.fromisoformat(b["as_of"]), payload=b))
    if b.get("llm"):
        log(f"brief: direction {b['llm']['market_thesis']['direction']} | {b['llm']['summary'][:160]}")
    log(f"brief: done in {time.time() - t0:.0f}s")
    return b


def run_longterm(use_llm: bool = True) -> dict:
    """Human Future engine: reconcile every brief's long-term observations into one thesis + theme conviction."""
    from .engines import longterm as lt_engine
    init_db()
    t0 = time.time()
    briefs = load_briefs(60)
    with session_scope() as s:
        run_id = _latest_run_id(s)
        themes = [x.payload for x in s.execute(select(Snapshot).where(Snapshot.run_id == run_id, Snapshot.kind == "theme")).scalars()] if run_id else []
        comps = [x.payload for x in s.execute(select(Snapshot).where(Snapshot.run_id == run_id, Snapshot.kind == "company")).scalars()] if run_id else []
    top = sorted(({"ticker": p["company"]["ticker"], "name": p["company"]["name"], "sector": p["company"]["sector"],
                   "opportunity": p["strategist"]["opportunity_score"], "gap": p["strategist"]["expectations_gap"], "pricing": p["strategist"]["pricing"],
                   "top_theme": p["strategist"]["theme_exposures"][0]["theme"] if p["strategist"].get("theme_exposures") else None} for p in comps),
                 key=lambda x: -(x["opportunity"] or 0))
    log(f"longterm: reconciling {sum(1 for b in briefs if b.get('llm'))} briefs of long-term observations")
    out = lt_engine.build(briefs, themes, load_prior("attention"), top, use_llm=use_llm)
    with session_scope() as s:
        s.add(Snapshot(run_id=f"lt-{out['generated_at'][:16]}", kind="longterm", key="", as_of=date.today(), payload=out))
    log(f"longterm: done in {time.time() - t0:.0f}s; top themes: " + ", ".join(f"{t['theme']} {t['conviction']:.2f}" for t in out["theme_ranking"][:5]))
    return out


def run_attention() -> dict:
    """Attention Engine: Wikipedia / Stocktwits / app charts / GitHub / autocomplete -> attention snapshot."""
    from .engines import attention as attention_engine
    init_db()
    t0 = time.time()
    with session_scope() as s:
        companies = {c.ticker: {"ticker": c.ticker, "name": c.name, "sector": c.sector} for c in s.execute(select(Company)).scalars()}
        history = pd.read_sql(select(AttentionObservation), s.connection())
        run_id = _latest_run_id(s)
        comp_snaps = [x.payload for x in s.execute(select(Snapshot).where(Snapshot.run_id == run_id, Snapshot.kind == "company")).scalars()] if run_id else []
        theme_snaps = [x.payload for x in s.execute(select(Snapshot).where(Snapshot.run_id == run_id, Snapshot.kind == "theme")).scalars()] if run_id else []
    if not history.empty:
        history["date"] = pd.to_datetime(history["date"])
    company_scores = {p["company"]["ticker"]: {**p["scores"], "opportunity": p["strategist"]["opportunity_score"], "gap": p["strategist"]["expectations_gap"]} for p in comp_snaps}
    themes_by_id = {t["id"]: t for t in theme_snaps}
    log(f"attention: {len(companies)} companies, {len(themes_by_id)} themes (this takes a few minutes: ~200 Wikipedia + Stocktwits calls)")
    payload, obs = attention_engine.compute(companies, company_scores, themes_by_id, history, date.today(), log)
    with session_scope() as s:
        for o in obs:
            s.merge(AttentionObservation(**o))
        s.add(Snapshot(run_id=f"att-{payload['generated_at'][:16]}", kind="attention", key="", as_of=date.today(), payload=payload))
    np_ = payload["movers"]["not_priced"]
    log(f"attention: done in {time.time() - t0:.0f}s; not-priced candidates: " + ", ".join(x.get("ticker") or x.get("theme_id") for x in np_[:8]))
    return payload


def _latest_run_id(s) -> Optional[str]:
    from sqlalchemy import desc
    row = s.execute(select(Snapshot.run_id).where(Snapshot.kind == "meta").order_by(desc(Snapshot.id)).limit(1)).first()
    return row[0] if row else None


# ------------------------------------------------------------------ compute
def compute_all(frames: dict, as_of: date, use_llm: bool, llm_top_n: Optional[int] = None) -> dict:
    llm_top_n = llm_top_n or settings.llm_top_n
    companies, prices, macro = frames["companies"], frames["prices"], frames["macro"]
    log("engine: economic regime")
    regime = regime_engine.compute(macro, as_of)
    log(f"engine: regime = {regime['regime']['label']} {regime['regime']['probabilities']}")
    regime["index_gate"] = index_gate(prices.get("SPY"), macro.get("FEDFUNDS"))
    log(f"engine: index gate {'OPEN' if regime['index_gate']['open'] else 'CLOSED'} ({regime['index_gate']['note']})")
    log("engine: capital flows")
    flows = flows_engine.compute(prices, frames["instruments"], as_of)
    log(f"engine: flows summary = {flows['summary']}")

    log(f"engine: fundamentals for {len(companies)} companies")
    analyses = {}
    for t in companies:
        a = fund_engine.analyze_company(t, frames["fundamentals"].get(t), prices.get(t), as_of, sector=companies[t]["sector"])
        if a:
            analyses[t] = a
    scores = fund_engine.score_universe(analyses, companies, prices.get("SPY"))
    log(f"engine: scored {len(scores)} companies")

    graph = theme_engine.load_graph()
    narrative = load_narrative()
    themes = theme_engine.compute(graph, scores, flows, companies, narrative or None)
    if narrative:
        log(f"engine: narrative scores for {len(narrative)} themes from recent briefs")
    themes_by_id = {th["id"]: th for th in themes}
    log("engine: themes -> " + ", ".join(f"{th['name']} {th['trend']}/{th['pricing']}{'★' if th['star'] else ''}" for th in themes[:5]))

    strategies = {}
    for t, a in analyses.items():
        exp = theme_engine.company_theme_exposure(graph, t)
        strategies[t] = strategist.compute(companies[t], a, scores[t], exp, themes_by_id, regime, flows)
        strategies[t]["theme_exposures"] = exp
    ranked = sorted(strategies.values(), key=lambda x: -(x["opportunity_score"] or 0))

    log("engine: risk posture")
    risk = risk_engine.compute(prices, macro, flows, regime, list(companies), as_of)
    log(f"engine: risk = {risk['label']} ({risk['risk_score']})")

    prior_pf, prior_flows = load_prior("portfolio"), load_prior("flows")
    from .engines.technicals import trend_template
    technicals = {t: trend_template(prices.get(t), prices.get("SPY")) for t in analyses}
    technicals = {t: v for t, v in technicals.items() if v}
    longterm, attention = load_prior("longterm"), load_prior("attention")
    log(f"engine: portfolio (long-term mode; {sum(1 for v in technicals.values() if v['ready'])}/{len(technicals)} names pass the trend template; "
        f"long-term thesis {'from ' + longterm['as_of'] if longterm else 'not built yet'})")
    portfolio = portfolio_engine.compute(strategies, analyses, scores, companies, risk, flows, regime, themes_by_id,
                                         prior_pf, settings.portfolio_value, as_of, prior_flows,
                                         technicals=technicals, longterm=longterm, attention=attention, briefs=load_briefs(5))
    log(f"engine: portfolio = {portfolio['stats']['positions']} positions, equity {portfolio['equity_weight']:.0%} (cap {portfolio['equity_cap']:.0%}, "
        f"cash {portfolio['cash_weight']:.0%}), {len(portfolio['trades'])} trades, {len(portfolio['exits'])} exits, "
        f"{len(portfolio['rejected_technical'])} rejected by the technical gate" + (" (initial)" if portfolio["is_initial"] else ""))

    if use_llm and llm_provider():
        holdings = [h["ticker"] for h in portfolio["holdings"]]
        targets = list(dict.fromkeys(holdings + [x["ticker"] for x in ranked[:llm_top_n]]))
        log(f"llm: enriching {len(targets)} theses via {llm_provider()} ({settings.anthropic_model if llm_provider() == 'anthropic' else settings.openai_model})")
        from concurrent.futures import ThreadPoolExecutor
        from .engines.technicals import technical_read

        def _package(t: str) -> dict:
            st, a = strategies[t], analyses[t]
            return {"company": companies[t], "strategist": {k: v for k, v in st.items() if k not in ("weights", "unavailable", "break_rules")},
                    "latest_fundamentals": a["latest"], "valuation": a["valuation"], "momentum": a["momentum"],
                    "technicals": technical_read(prices.get(t)),
                    "regime": {"label": regime["regime"]["label"], "probabilities": regime["regime"]["probabilities"], "headline": regime["headline"]},
                    "sector_rotation": flows["sector_rotation"]}

        with ThreadPoolExecutor(max_workers=4) as pool:
            for i, (t, enriched) in enumerate(zip(targets, pool.map(lambda t: enrich_thesis(_package(t)), targets)), 1):
                if enriched:
                    strategies[t]["llm"] = enriched
                    strategies[t]["llm_enriched"] = True
                if i % 5 == 0:
                    log(f"llm: {i}/{len(targets)}")
        memo_pkg = {"portfolio": {k: v for k, v in portfolio.items() if k in ("holdings", "sleeves", "trades", "exits", "stats", "equity_weight", "beta_target", "watchlist")},
                    "regime": {"headline": regime["headline"], "probabilities": regime["regime"]["probabilities"], "trend": regime["trend"]},
                    "risk": {"score": risk["risk_score"], "label": risk["label"], "posture": risk["posture"]},
                    "flows_summary": flows["summary"], "starred_themes": [{"name": th["name"], "trend": th["trend"], "pricing": th["pricing"]} for th in themes if th["star"]],
                    "holding_theses": {h["ticker"]: strategies[h["ticker"]].get("llm", {}).get("thesis") or strategies[h["ticker"]]["thesis"] for h in portfolio["holdings"]}}
        memo = portfolio_memo(memo_pkg)
        if memo:
            portfolio["memo"] = memo
            log("llm: portfolio memo written")

    return {"regime": regime, "flows": flows, "themes": themes, "analyses": analyses, "scores": scores,
            "strategies": strategies, "ranked": ranked, "risk": risk, "portfolio": portfolio, "technicals": technicals}


def persist(results: dict, frames: dict, as_of: date) -> str:
    run_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    companies = frames["companies"]
    with session_scope() as s:
        s.add(Snapshot(run_id=run_id, kind="regime", key="", as_of=as_of, payload=results["regime"]))
        s.add(Snapshot(run_id=run_id, kind="flows", key="", as_of=as_of, payload=results["flows"]))
        s.add(Snapshot(run_id=run_id, kind="risk", key="", as_of=as_of, payload=results["risk"]))
        s.add(Snapshot(run_id=run_id, kind="portfolio", key="", as_of=as_of, payload=results["portfolio"]))
        for th in results["themes"]:
            s.add(Snapshot(run_id=run_id, kind="theme", key=th["id"], as_of=as_of, payload=th))
        for t, st in results["strategies"].items():
            a = results["analyses"][t]
            payload = {"company": companies[t], "scores": results["scores"][t], "strategist": st, "technical": results.get("technicals", {}).get(t),
                       "fundamentals": {"latest": a["latest"], "history": a["history"], "valuation": a["valuation"],
                                        "momentum": a["momentum"], "price": a["price"], "data_quality": a["data_quality"]}}
            s.add(Snapshot(run_id=run_id, kind="company", key=t, as_of=as_of, payload=payload))
        s.add(Snapshot(run_id=run_id, kind="meta", key="", as_of=as_of, payload={
            "run_id": run_id, "as_of": as_of.isoformat(), "companies": len(results["strategies"]), "themes": len(results["themes"]),
            "llm_provider": llm_provider(), "universe_limit": settings.universe_limit,
            "portfolio_positions": results["portfolio"]["stats"]["positions"], "portfolio_trades": len(results["portfolio"]["trades"]),
            "top": [{"ticker": x["ticker"], "opportunity": x["opportunity_score"], "gap": x["expectations_gap"]} for x in results["ranked"][:10]],
        }))
    return run_id


# ------------------------------------------------------------------ CLI
def run(limit: Optional[int] = None, skip_ingest: bool = False, use_llm: bool = True, as_of: Optional[date] = None) -> str:
    t0 = time.time()
    init_db()
    limit = limit or settings.universe_limit
    seed_reference(limit)
    from .ondemand import custom_tickers
    tickers = list(dict.fromkeys(company_tickers(limit) + custom_tickers()))   # seeded universe + names added via search
    if not skip_ingest:
        ingest_macro()
        ingest_prices(list(INSTRUMENTS) + tickers)
        ingest_fundamentals(tickers)
    frames = load_frames(tickers)
    as_of = as_of or date.today()
    results = compute_all(frames, as_of, use_llm)
    run_id = persist(results, frames, as_of)
    log(f"done: run {run_id} in {time.time() - t0:.0f}s; top: " +
        ", ".join(f"{x['ticker']} {x['opportunity_score']} (gap {x['expectations_gap']:+.0f})" for x in results["ranked"][:8] if x["expectations_gap"] is not None))
    return run_id


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["run", "ingest", "brief", "morning", "attention", "longterm"])
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--skip-ingest", action="store_true")
    ap.add_argument("--no-llm", action="store_true")
    ap.add_argument("--as-of", type=str, default=None)
    a = ap.parse_args()
    if a.cmd == "attention":
        run_attention()
        return
    if a.cmd == "longterm":
        run_longterm(use_llm=not a.no_llm)
        return
    if a.cmd == "brief":
        run_brief(use_llm=not a.no_llm)
        return
    if a.cmd == "morning":   # attention -> brief -> recalibration, so today's interest and narrative feed the book
        try:
            run_attention()
        except Exception as e:
            log(f"attention: failed ({e}); continuing")
        run_brief(use_llm=not a.no_llm)
        try:
            run_longterm(use_llm=not a.no_llm)
        except Exception as e:
            log(f"longterm: failed ({e}); continuing with the previous thesis")
        run(a.limit, a.skip_ingest, not a.no_llm)
        return
    if a.cmd == "ingest":
        init_db()
        tickers = company_tickers(a.limit or settings.universe_limit)
        seed_reference(a.limit or settings.universe_limit)
        ingest_macro()
        ingest_prices(list(INSTRUMENTS) + tickers)
        ingest_fundamentals(tickers)
    else:
        run(a.limit, a.skip_ingest, not a.no_llm, date.fromisoformat(a.as_of) if a.as_of else None)


if __name__ == "__main__":
    main()
