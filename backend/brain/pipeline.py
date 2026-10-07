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
from .engines import etf_book as etf_engine, income_book as income_engine, portfolio as portfolio_engine, risk as risk_engine, strategist, themes as theme_engine, thesis_book as thesis_engine
from .llm import enrich_thesis, portfolio_memo, provider as llm_provider
from .models import AttentionObservation, Company, FilingEvent, Fundamental, InsiderTransaction, Instrument, MacroObservation, Price, Snapshot, Theme, ThemeExposure
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


def ingest_prices(symbols: list[str], workers: int = 4) -> None:
    """Fetch in a small thread pool (the network is the bottleneck), write from this thread."""
    from concurrent.futures import ThreadPoolExecutor
    price_src.register_etfs([sym for sym, (_, g, _) in INSTRUMENTS.items() if g != "crypto" and sym != "^VIX"])
    ok = 0

    def fetch(sym):
        try:
            return sym, price_src.fetch_history(sym)
        except Exception as e:  # one bad symbol must not stop the run
            log(f"prices: {sym} failed: {e}")
            return sym, None

    with session_scope() as s, ThreadPoolExecutor(max_workers=workers) as ex:
        for i, (sym, df) in enumerate(ex.map(fetch, symbols), 1):
            if df is None or df.empty:
                continue
            s.execute(delete(Price).where(Price.symbol == sym))
            s.bulk_insert_mappings(Price, [{"symbol": sym, "date": r.date.date(), "open": float(r.open), "high": float(r.high), "low": float(r.low),
                                            "close": float(r.close), "adj_close": float(r.adj_close), "volume": float(r.volume)} for r in df.itertuples()])
            ok += 1
            if i % 50 == 0:
                s.commit()
                log(f"prices: {i}/{len(symbols)}")
    log(f"prices: {ok}/{len(symbols)} symbols stored")


def fundamentals_due(tickers: list[str], priority: set[str], today: Optional[date] = None) -> list[str]:
    """Filings change quarterly, so the wide universe refreshes on a rolling weekly schedule (one fifth per weekday);
    holdings, top-ranked names and anything with no stored filings refresh every run."""
    import zlib
    today = today or date.today()
    with session_scope() as s:
        have = {x[0] for x in s.execute(select(Fundamental.ticker).distinct())}
    return [t for t in tickers if t in priority or t not in have or zlib.crc32(t.encode()) % 5 == today.weekday() % 5]


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


def load_rotation_history(n: int = 30) -> dict[str, list]:
    """{sector: [(as_of date, rotation score), ...]} oldest first, one reading per day, from prior flows snapshots."""
    from sqlalchemy import desc
    with session_scope() as s:
        rows = s.execute(select(Snapshot).where(Snapshot.kind == "flows").order_by(desc(Snapshot.id)).limit(n * 3)).scalars()
        seen, out = set(), {}
        for x in rows:
            if x.as_of in seen:
                continue
            seen.add(x.as_of)
            for sector, score in (x.payload.get("sector_rotation") or {}).items():
                out.setdefault(sector, []).append((x.as_of, score))
    return {k: sorted(v)[-n:] for k, v in out.items()}


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
    ev = load_prior("events") or {}
    events_summary = {"tape": [{k: x[k] for k in ("ticker", "in_portfolio", "flags", "headline")} for x in ev.get("tape", [])[:25]],
                      "earnings_today": [e.get("symbol") for e in ev.get("earnings", {}).get("today", [])][:20],
                      "gaps": [(g["ticker"], g["gap_pct"]) for g in ev.get("gaps", [])[:15]]} if ev else None
    b = brief_engine.build(regime, flows, portfolio, prior[0] if prior else None, companies, use_llm=use_llm, attention=attention_summary, events=events_summary)
    log(f"brief: {b['n_headlines']} headlines, {len(b['clusters'])} theme clusters, llm={b['llm_provider']}")
    with session_scope() as s:
        s.add(Snapshot(run_id=b["brief_id"], kind="brief", key="", as_of=date.fromisoformat(b["as_of"]), payload=b))
    if b.get("llm"):
        log(f"brief: direction {b['llm']['market_thesis']['direction']} | {b['llm']['summary'][:160]}")
    log(f"brief: done in {time.time() - t0:.0f}s")
    return b


def run_longterm_if_due(use_llm: bool = True) -> Optional[dict]:
    """Weekly cadence: rebuild on Mondays, when none exists, or when the last one is 7+ days old."""
    last = load_prior("longterm")
    today = date.today()
    due = last is None or today.weekday() == 0 or (today - date.fromisoformat(last["as_of"])).days >= 7
    if not due:
        log(f"longterm: current thesis from {last['as_of']} still fresh; next rebuild Monday")
        return None
    return run_longterm(use_llm=use_llm)


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


# ------------------------------------------------------------------ Thesis v2 (Causal Futures Engine)
T001 = ("By 2031, mainstream consumers will derive more practical value from AI systems that act, automate and protect on their "
        "behalf (trusted delegation: scheduling, purchasing, cancelling, protecting accounts, detecting scams, managing bills, travel, "
        "health information and vehicles) than from standalone AI systems primarily used to generate information or content. "
        "Convenience and security become inseparable: the limiting factor shifts from 'is the AI intelligent enough' to 'do I trust "
        "this system enough to let it act'.")


def _thesis_v2_records() -> dict[str, dict]:
    from sqlalchemy import desc
    with session_scope() as s:
        rows = s.execute(select(Snapshot).where(Snapshot.kind == "thesis_v2").order_by(desc(Snapshot.id))).scalars()
        out: dict[str, dict] = {}
        for x in rows:
            out.setdefault(x.key, x.payload)      # latest per thesis id
    return out


def _save_thesis_v2(record: dict) -> None:
    with session_scope() as s:
        s.add(Snapshot(run_id=f"t2-{datetime.now().strftime('%Y%m%d-%H%M%S')}", kind="thesis_v2", key=record["id"], as_of=date.today(), payload=record))


def _thesis_v2_context() -> dict:
    briefs = load_briefs(10)
    att = load_prior("attention") or {}
    return {"recent_briefs": [{"date": b["as_of"], "summary": (b.get("llm") or {}).get("summary"),
                               "human_behavior_long_term": (b.get("llm") or {}).get("human_behavior", {}).get("long_term", [])[:4],
                               "claims": [c["claim"] for c in (b.get("llm") or {}).get("claims", [])[:6]]} for b in briefs if b.get("llm")][:6],
            "attention_movers": {"themes_up": [(t["name"], t["wiki_vs_28d_pct"], t["rising_queries"][:5]) for t in att.get("movers", {}).get("themes_up", [])[:6]],
                                 "not_priced": [x.get("ticker") or x.get("name") for x in att.get("movers", {}).get("not_priced", [])][:10]},
            "long_term_thesis": (load_prior("longterm") or {}).get("thesis")}


def run_thesis_v2_new(statement: str, thesis_id: Optional[str] = None) -> dict:
    from .engines import causal
    init_db()
    existing = _thesis_v2_records()
    tid = thesis_id or f"T-{len(existing) + 1:03d}"
    with session_scope() as s:
        universe = [{"ticker": c.ticker, "name": c.name, "sector": c.sector, "industry": c.industry} for c in s.execute(select(Company)).scalars()]
    from .engines.themes import load_graph
    log(f"thesis-v2: analysing {tid}: {statement[:80]}...")
    t0 = time.time()
    rec = causal.create(tid, statement, universe, [n["name"] for n in load_graph()], _thesis_v2_context())
    _save_thesis_v2(rec)
    log(f"thesis-v2: {tid} '{rec['title']}' prior {rec['probability']['prior']}% -> posterior {rec['probability']['posterior']}% "
        f"[{rec['probability']['range_low']}-{rec['probability']['range_high']}] from {len(rec['analogues'])} analogues, {len(rec['evidence'])} evidence ({time.time() - t0:.0f}s)")
    return rec


def run_thesis_v2_update(thesis_id: Optional[str] = None, force: bool = False) -> list[dict]:
    """Monthly 'what changed?' review. Without an id, updates every open thesis not yet reviewed this month."""
    from .engines import causal
    init_db()
    out = []
    for tid, rec in _thesis_v2_records().items():
        if thesis_id and tid != thesis_id:
            continue
        if rec.get("status") != "open":
            continue
        last = rec.get("last_update") or rec.get("created")
        if not force and not thesis_id and last and last[:7] == date.today().isoformat()[:7]:
            continue
        log(f"thesis-v2: monthly review of {tid}")
        rec = causal.update(rec, _thesis_v2_context())
        _save_thesis_v2(rec)
        u = rec["updates"][-1]
        log(f"thesis-v2: {tid} posterior {u['posterior_before']}% -> {u['posterior_after']}%; changed: {u['what_changed'][:2]}")
        out.append(rec)
    return out


def run_thesis_v2_from_briefs(max_new: int = 8, workers: int = 3) -> dict:
    """Consolidate every brief's long-term human-behaviour bullets into theses, analyse each, then rank stocks."""
    from concurrent.futures import ThreadPoolExecutor
    from .engines import causal
    from .engines.themes import load_graph
    init_db()
    bullets = []
    for b in sorted(load_briefs(60), key=lambda x: x.get("as_of", "")):
        for text in (b.get("llm") or {}).get("human_behavior", {}).get("long_term", []):
            bullets.append({"date": b["as_of"], "text": text})
    existing = list(_thesis_v2_records().values())
    log(f"thesis-v2: consolidating {len(bullets)} long-term bullets from {len({b['date'] for b in bullets})} briefs ({len(existing)} theses on the ledger)")
    clusters = causal.cluster_bullets(bullets, existing)
    ex_by_id = {e["id"]: e for e in existing}
    for c in clusters:
        if c["existing_id"] and c["existing_id"] in ex_by_id:
            rec = ex_by_id[c["existing_id"]]
            rec.setdefault("source_bullets", [])
            known = {x["text"] for x in rec["source_bullets"]}
            rec["source_bullets"] += [x for x in c["source_bullets"] if x["text"] not in known]
            _save_thesis_v2(rec)
    new = [c for c in clusters if not c["existing_id"]][:max_new]
    log(f"thesis-v2: {len(clusters)} clusters -> {len(new)} new theses to analyse: " + "; ".join(c["title"][:40] for c in new))
    with session_scope() as s:
        universe = [{"ticker": c.ticker, "name": c.name, "sector": c.sector, "industry": c.industry} for c in s.execute(select(Company)).scalars()]
    themes = [n["name"] for n in load_graph()]
    ctx = _thesis_v2_context()
    next_n = len(existing) + 1

    def analyse(i_c):
        i, c = i_c
        tid = f"T-{next_n + i:03d}"
        try:
            rec = causal.create(tid, c["statement"], universe, themes, ctx)
            rec["source_bullets"], rec["origin"] = c["source_bullets"], "briefs"
            return rec
        except Exception as e:
            log(f"thesis-v2: {tid} failed: {e}")
            return None

    with ThreadPoolExecutor(max_workers=workers) as pool:
        for rec in pool.map(analyse, list(enumerate(new))):
            if rec:
                _save_thesis_v2(rec)
                log(f"thesis-v2: {rec['id']} '{rec['title'][:60]}' prior {rec['probability']['prior']}% -> posterior {rec['probability']['posterior']}%")
    return run_thesis_v2_opportunities()


def run_thesis_v2_opportunities(use_llm: bool = True) -> dict:
    """Rank stocks by posterior-weighted value-pool exposure across all open theses, filtered by entry discipline."""
    from .engines import causal
    init_db()
    records = list(_thesis_v2_records().values())
    with session_scope() as s:
        rid = _latest_run_id(s)
        comps = [x.payload for x in s.execute(select(Snapshot).where(Snapshot.run_id == rid, Snapshot.kind == "company")).scalars()] if rid else []
    rows = {p["company"]["ticker"]: {"name": p["company"]["name"], "sector": p["company"]["sector"], "total": p["strategist"]["opportunity_score"],
                                     "expectations_gap": p["strategist"]["expectations_gap"], "pricing": p["strategist"]["pricing"],
                                     "reality": p["strategist"]["reality"], "narrative": p["strategist"]["narrative"]} for p in comps}
    technicals = {p["company"]["ticker"]: p.get("technical") for p in comps if p.get("technical")}
    att = {c["ticker"]: c for c in (load_prior("attention") or {}).get("companies", [])}
    out = causal.opportunities(records, rows, technicals, att)
    if use_llm and out["candidates"]:
        memo = causal.opportunity_memo(out["candidates"][:15], records)
        if memo:
            out["memo"] = memo
    with session_scope() as s:
        s.add(Snapshot(run_id=f"t2o-{datetime.now().strftime('%Y%m%d-%H%M%S')}", kind="thesis_v2_opportunities", key="", as_of=date.today(), payload=out))
    log("thesis-v2: opportunities -> " + ", ".join(f"{c['ticker']} {c['score']} ({c['buy_readiness']})" for c in out["candidates"][:10]))
    return out


def run_thesis_v2_expand(max_add: int = 25) -> dict:
    """Theme-driven universe expansion: the engine nominates 10-K filers outside the universe for each thesis's value
    pools; each is pulled in via the on-demand path, attached to the pool, and the ranking reruns."""
    from .engines import causal
    from . import ondemand
    init_db()
    records = list(_thesis_v2_records().values())
    with session_scope() as s:
        universe = {c.ticker for c in s.execute(select(Company)).scalars()}
    log(f"thesis-v2: asking for value-pool nominees outside the {len(universe)}-name universe")
    nominees = causal.nominate_expansions(records, universe)
    log(f"thesis-v2: {len(nominees)} nominees: " + ", ".join(n["ticker"] for n in nominees))
    added, skipped = [], []
    by_id = {r["id"]: r for r in records}
    for n in nominees[:max_add]:
        t = n["ticker"]
        try:
            ondemand.analyze(t)
            added.append(n)
            rec = by_id.get(n["thesis_id"])
            if rec:
                for vp in rec.get("value_pools", []):
                    if vp["layer"] == n["layer"] and t not in vp.get("tickers", []):
                        vp.setdefault("tickers", []).append(t)
                rec.setdefault("expansions", []).append({"ticker": t, "name": n["name"], "layer": n["layer"], "why": n["why"], "added": date.today().isoformat()})
        except Exception as e:
            skipped.append({"ticker": t, "reason": str(e)[:160]})
    for rec in by_id.values():
        if rec.get("expansions"):
            _save_thesis_v2(rec)
    log(f"thesis-v2: added {len(added)} companies ({', '.join(n['ticker'] for n in added)}); skipped {len(skipped)}: " + "; ".join(f"{x['ticker']}: {x['reason'][:60]}" for x in skipped[:6]))
    if added:
        run_thesis_v2_remap()
    out = run_thesis_v2_opportunities()
    out["expansion"] = {"added": added, "skipped": skipped, "as_of": date.today().isoformat()}
    with session_scope() as s:
        s.add(Snapshot(run_id=f"t2x-{datetime.now().strftime('%Y%m%d-%H%M%S')}", kind="thesis_v2_expansion", key="", as_of=date.today(), payload=out["expansion"]))
    return out


def run_thesis_v2_remap() -> int:
    """Re-map every open thesis's value pools over the current universe (Sonnet, one call per thesis)."""
    from .engines import causal
    init_db()
    with session_scope() as s:
        universe = [{"ticker": c.ticker, "name": c.name, "sector": c.sector, "industry": c.industry} for c in s.execute(select(Company)).scalars()]
    n = 0
    for tid, rec in _thesis_v2_records().items():
        if rec.get("status") != "open":
            continue
        before = sum(len(vp.get("tickers", [])) for vp in rec.get("value_pools", []))
        rec = causal.remap_pools(rec, universe)
        after = sum(len(vp.get("tickers", [])) for vp in rec.get("value_pools", []))
        _save_thesis_v2(rec); n += 1
        log(f"thesis-v2: {tid} pools re-mapped over {len(universe)} names: {before} -> {after} ticker slots")
    return n


def run_theme_map(force: bool = False, batch: int = 45, workers: int = 3) -> int:
    """Map every universe name that themes.yaml does not cover to the theme graph (Sonnet, ~45 names per call)."""
    from concurrent.futures import ThreadPoolExecutor
    from .engines import theme_mapper as TM
    init_db()
    graph = theme_engine.load_graph(with_extra=False)
    curated = {t for n in graph for t in theme_engine._all_exposures(n)}
    themes = [{"id": n["id"], "name": n["name"], "description": n.get("description"), "sub_themes": [c["name"] for c in n.get("children") or []]} for n in graph]
    existing = {} if force else TM.load_extra()
    with session_scope() as s:
        todo = [{"ticker": c.ticker, "name": c.name, "sector": c.sector, "industry": c.industry} for c in s.execute(select(Company)).scalars()
                if c.ticker not in curated and c.ticker not in existing]
    if not todo:
        log("themes-map: nothing to map")
        return 0
    chunks = [todo[i:i + batch] for i in range(0, len(todo), batch)]
    log(f"themes-map: mapping {len(todo)} names in {len(chunks)} calls ({len(curated)} curated, {len(existing)} already mapped)")
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for i, res in enumerate(ex.map(lambda ch: TM.map_batch(ch, themes), chunks), 1):
            existing.update(res)
            log(f"themes-map: {i}/{len(chunks)} batches, {sum(1 for v in existing.values() if v)} names with a theme so far")
    TM.save_extra(existing)
    seed_reference(settings.universe_limit)
    log(f"themes-map: done; {sum(1 for v in existing.values() if v)}/{len(existing)} mapped names carry at least one theme")
    return len(todo)


def run_thesis_v2_resolve(thesis_id: str, outcome: bool) -> dict:
    from .engines import causal
    rec = _thesis_v2_records().get(thesis_id)
    if not rec:
        raise ValueError(f"unknown thesis {thesis_id}")
    rec = causal.resolve(rec, outcome)
    _save_thesis_v2(rec)
    return rec


# ------------------------------------------------------------------ Events (Form 4, 8-K, earnings, gaps)
def run_events(lookback_days: int = 45) -> dict:
    from datetime import timedelta
    from .data import edgar_events as EE, finnhub as FH
    from .engines import events as events_engine
    init_db()
    t0 = time.time()
    since = date.today() - timedelta(days=lookback_days)
    with session_scope() as s:
        companies = {c.ticker: {"ticker": c.ticker, "name": c.name, "sector": c.sector, "cik": c.cik} for c in s.execute(select(Company)).scalars() if c.cik}
        known_f4 = {x[0] for x in s.execute(select(InsiderTransaction.accession).distinct())}
        known_8k = {x[0] for x in s.execute(select(FilingEvent.accession))}
    log(f"events: scanning EDGAR for {len(companies)} companies (Form 4 + 8-K since {since})")
    new_tx, new_8k, n_f4 = [], [], 0

    def scan(item):
        t, c = item
        try:
            f4s = [f for f in EE.recent_filings(c["cik"], ("4", "4/A"), since) if f["accession"] not in known_f4]
            txs_ = [{**tx, "ticker": t} for f in f4s for tx in EE.form4_transactions(c["cik"], f)]
            k8 = [{"accession": f["accession"], "ticker": t, "form": f["form"], "filed": f["filed"], "items": f["items"] or "", "url": f["url"]}
                  for f in EE.recent_filings(c["cik"], ("8-K", "8-K/A"), since) if f["accession"] not in known_8k]
            return txs_, k8, len(f4s)
        except Exception as e:
            log(f"events: {t}: {e}")
            return [], [], 0

    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=4) as ex:   # EDGAR calls share one throttle (see data/edgar.py)
        for i, (txs_, k8, n) in enumerate(ex.map(scan, companies.items()), 1):
            new_tx += txs_; new_8k += k8; n_f4 += n
            if i % 100 == 0:
                log(f"events: {i}/{len(companies)} companies, {n_f4} new Form 4s so far")
    with session_scope() as s:
        for tx in new_tx:
            s.add(InsiderTransaction(accession=tx["accession"], ticker=tx["ticker"], filed=date.fromisoformat(tx["filed"]), date=date.fromisoformat(tx["date"][:10]),
                                     code=tx["code"] or "?", acquired=tx["acquired"], shares=tx["shares"], price=tx["price"], value=tx["value"], owner=tx["owner"][:120],
                                     title=(tx["title"] or "")[:120], is_director=tx["is_director"], is_officer=tx["is_officer"], is_ten_pct=tx["is_ten_pct"],
                                     rule_10b5_1=tx["rule_10b5_1"], shares_after=tx["shares_after"], url=tx["url"][:300]))
        for f in new_8k:
            s.merge(FilingEvent(accession=f["accession"], ticker=f["ticker"], form=f["form"], filed=date.fromisoformat(f["filed"]), items=f["items"][:120], url=f["url"][:300]))
    with session_scope() as s:
        txs = [{"ticker": x.ticker, "filed": x.filed, "date": x.date, "code": x.code, "acquired": x.acquired, "shares": x.shares, "price": x.price, "value": x.value,
                "owner": x.owner, "title": x.title, "is_director": x.is_director, "is_officer": x.is_officer, "is_ten_pct": x.is_ten_pct, "rule_10b5_1": x.rule_10b5_1, "url": x.url}
               for x in s.execute(select(InsiderTransaction).where(InsiderTransaction.date >= since)).scalars()]
        fils = [{"ticker": x.ticker, "form": x.form, "filed": x.filed.isoformat(), "items": x.items, "url": x.url}
                for x in s.execute(select(FilingEvent).where(FilingEvent.filed >= since)).scalars()]
    log(f"events: {len(new_tx)} new insider transactions from {n_f4} Form 4s, {len(new_8k)} new 8-Ks; {len(txs)} transactions and {len(fils)} 8-Ks in window")
    holdings = {h["ticker"] for h in (load_prior("portfolio") or {}).get("holdings", [])}
    earnings = FH.earnings_calendar(date.today() - timedelta(days=3), date.today() + timedelta(days=7))
    quotes = {}
    if FH._key():
        watch = sorted(holdings | {t for t in companies if any(e.get("symbol") == t for e in earnings)})[:80]
        for t in watch:
            q = FH.quote(t)
            if q:
                quotes[t] = q
    out = events_engine.compute(companies, txs, fils, earnings, quotes, holdings, date.today())
    with session_scope() as s:
        s.add(Snapshot(run_id=f"ev-{datetime.now().strftime('%Y%m%d-%H%M%S')}", kind="events", key="", as_of=date.today(), payload=out))
    log(f"events: tape {len(out['tape'])} names; cluster buys {[x['ticker'] for x in out['insider']['cluster_buys']]}; "
        f"high-severity 8-Ks {[x['ticker'] for x in out['filings']['high']]}; gaps {len(out['gaps'])}; earnings today {len(out['earnings']['today'])} ({time.time() - t0:.0f}s)")
    return out


def run_attention() -> dict:
    """Attention Engine: Wikipedia / Stocktwits / app charts / GitHub / autocomplete -> attention snapshot."""
    from .engines import attention as attention_engine
    init_db()
    t0 = time.time()
    with session_scope() as s:
        # Attention is read for the thematic universe plus whatever the book holds or ranks highly; the index-wide
        # names stay out (one Wikipedia + one Stocktwits call each would triple the morning run for little signal).
        prior_pf, prior_run = load_prior("portfolio") or {}, load_prior("meta") or {}
        keep = {h["ticker"] for h in prior_pf.get("holdings", [])} | set((prior_run.get("ranked_tickers") or [])[:60])
        companies = {c.ticker: {"ticker": c.ticker, "name": c.name, "sector": c.sector} for c in s.execute(select(Company)).scalars()
                     if c.source != "index" or c.ticker in keep}
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
def load_yields(instruments: list[dict], prices: dict, as_of: date) -> dict[str, dict]:
    """Distribution summaries for the income universe (income group + bond ETFs + rate-sensitive sectors); cached a day per symbol."""
    from concurrent.futures import ThreadPoolExecutor
    from .data import dividends as DV
    syms = [i["symbol"] for i in instruments if i["group"] in ("income", "bond")] + ["XLU", "XLRE", "XLE", "SPY"]

    def one(sym):
        df = prices.get(sym)
        price = float(df.sort_values("date")["close"].iloc[-1]) if df is not None and len(df) else None
        try:
            return sym, DV.summarize(sym, price, as_of)
        except Exception as e:
            log(f"dividends: {sym}: {e}")
            return sym, None

    with ThreadPoolExecutor(max_workers=4) as ex:
        out = {sym: d for sym, d in ex.map(one, syms) if d}
    log(f"dividends: distribution data for {len(out)}/{len(syms)} income instruments")
    return out


def compute_all(frames: dict, as_of: date, use_llm: bool, llm_top_n: Optional[int] = None, force_enrich: bool = False, fresh: bool = False, fresh_thesis: bool = False) -> dict:
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
    from .data.prices import nasdaq_market_cap
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=6) as ex:   # one quote call per company; cached for a day
        caps = dict(zip(companies, ex.map(nasdaq_market_cap, list(companies))))
    for t in companies:
        a = fund_engine.analyze_company(t, frames["fundamentals"].get(t), prices.get(t), as_of, sector=companies[t]["sector"],
                                        market_cap_override=caps.get(t))
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

    prior_pf, prior_flows = (None if fresh else load_prior("portfolio")), load_prior("flows")
    from .engines.technicals import trend_template
    technicals = {t: trend_template(prices.get(t), prices.get("SPY")) for t in analyses}
    technicals = {t: v for t, v in technicals.items() if v}
    longterm, attention = load_prior("longterm"), load_prior("attention")
    log(f"engine: portfolio (long-term mode; {sum(1 for v in technicals.values() if v['ready'])}/{len(technicals)} names pass the trend template; "
        f"long-term thesis {'from ' + longterm['as_of'] if longterm else 'not built yet'})")
    rotation_history = load_rotation_history(30)
    from .universe import SECTOR_ETF
    from .engines import pm as pm_engine
    sector_medians: dict = {}
    for sec in {c["sector"] for c in companies.values()}:
        vals = {k: [analyses[t]["valuation"].get(k) for t in analyses if companies[t]["sector"] == sec and analyses[t]["valuation"].get(k)] for k in ("pe", "ev_ebitda", "ev_sales", "p_fcf")}
        sector_medians[sec] = {k: float(pd.Series(v).median()) for k, v in vals.items() if len(v) >= 3}
    ev_prior = load_prior("events") or {}
    pm_inputs = {"prices": prices, "sector_etf": {sec: prices.get(etf) for sec, etf in SECTOR_ETF.items()}, "sector_medians": sector_medians,
                 "earnings_week": ev_prior.get("earnings", {}).get("this_week", [])}
    portfolio = portfolio_engine.compute(strategies, analyses, scores, companies, risk, flows, regime, themes_by_id,
                                         prior_pf, settings.portfolio_value, as_of, prior_flows,
                                         technicals=technicals, longterm=longterm, attention=attention, briefs=load_briefs(5),
                                         rotation_history=rotation_history, hfe_ranking=load_prior("thesis_v2_opportunities"),
                                         events=load_prior("events"), pm_inputs=pm_inputs)
    # per-company portfolio-management detail (entry score, expected return, momentum, catalysts) for the company pages
    from .engines.portfolio import _pm_detail
    hfe_c = {c["ticker"]: c for c in (load_prior("thesis_v2_opportunities") or {}).get("candidates", [])}
    att_c = {c["ticker"]: c for c in (attention or {}).get("companies", [])}
    pm_detail = {}
    for t, a in analyses.items():
        try:
            pm_detail[t] = _pm_detail(t, a, strategies[t], scores[t], companies[t], technicals.get(t) or {}, pm_inputs, ev_prior, hfe_c.get(t), att_c.get(t), regime, flows, as_of)
        except Exception as e:
            log(f"pm: {t}: {e}")
    log(f"engine: entry scores computed for {len(pm_detail)} names; attractive entries: "
        + ", ".join(f"{t} {d['entry']['score']}" for t, d in sorted(pm_detail.items(), key=lambda x: -(x[1]['entry']['score'] or 0))[:8]))
    log(f"engine: portfolio = {portfolio['stats']['positions']} positions, equity {portfolio['equity_weight']:.0%} (cap {portfolio['equity_cap']:.0%}, "
        f"cash {portfolio['cash_weight']:.0%}), {len(portfolio['trades'])} trades, {len(portfolio['exits'])} exits, "
        f"{len(portfolio['rejected_technical'])} rejected by the technical gate" + (" (initial)" if portfolio["is_initial"] else ""))

    recal_day = portfolio.get("cadence", {}).get("mode", "recalibrate") == "recalibrate"
    if use_llm and llm_provider() and not (recal_day or force_enrich):
        # Monitor day: no LLM spend. Carry the last enriched theses forward so company pages keep their reads.
        carried = 0
        with session_scope() as s:
            rid = _latest_run_id(s)
            prev = {x.key: x.payload for x in s.execute(select(Snapshot).where(Snapshot.run_id == rid, Snapshot.kind == "company")).scalars()} if rid else {}
        for t, st in strategies.items():
            pl = (prev.get(t) or {}).get("strategist", {})
            if pl.get("llm"):
                st["llm"], st["llm_enriched"], st["llm_from"] = pl["llm"], True, pl.get("llm_from") or (prev[t].get("as_of") or rid[:8] if rid else None)
                carried += 1
        log(f"llm: monitor day — no enrichment (next at the {portfolio['cadence'].get('next_recalibration')} recalibration); carried {carried} prior theses forward")
    if use_llm and llm_provider() and (recal_day or force_enrich):
        holdings = [h["ticker"] for h in portfolio["holdings"]]
        targets = list(dict.fromkeys(holdings + [x["ticker"] for x in ranked[:llm_top_n]]))
        log(f"llm: enriching {len(targets)} theses via {llm_provider()} ({settings.anthropic_bulk_model if llm_provider() == 'anthropic' else settings.openai_model}; "
            f"brief/thesis/memo stay on {settings.anthropic_model})")
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

    etf = etf_engine.compute(prices, frames["instruments"], regime, flows, risk, longterm, graph, None if fresh else load_prior("etf_book"),
                             settings.portfolio_value, as_of)
    log(f"engine: ETF book = {etf['stats']['positions'] if 'stats' in etf else len(etf['holdings'])} ETFs, cash {etf.get('cash_weight', 0):.0%}, "
        f"mode {etf['cadence']['mode']}: " + ", ".join(f"{h['symbol']} {h['weight']:.0%}" for h in etf["holdings"][:8]))
    thesis_bk = thesis_engine.compute(strategies, analyses, companies, technicals, pm_detail, flows, regime, risk, longterm, load_briefs(5),
                                      list(_thesis_v2_records().values()), prices, None if (fresh or fresh_thesis) else load_prior("thesis_book"), settings.portfolio_value, as_of,
                                      other_book=[h["ticker"] for h in portfolio["holdings"]])
    if thesis_bk["cadence"]["mode"] == "recalibrate":
        f = thesis_bk["funnel"]
        log(f"engine: thesis book funnel: {f['favoured']} favoured -> above bull {f['above_bull']}, market gate {f['market_gate']}, sector gate {f['sector_gate']}, "
            f"trend gate {f['trend_gate']}, earnings {f['earnings']}, caps {f['caps']} -> {f['selected']} selected")
    log(f"engine: thesis book = {len(thesis_bk['holdings'])} positions, equity {thesis_bk['equity_weight']:.0%}, mode {thesis_bk['cadence']['mode']}: "
        + ", ".join(f"{h['ticker']} {h['weight']:.1%}" for h in thesis_bk["holdings"][:12]))
    income = income_engine.compute(prices, frames["instruments"], load_yields(frames["instruments"], prices, as_of), regime, flows, risk, macro,
                                   None if fresh else load_prior("income_book"), settings.portfolio_value, as_of)
    log(f"engine: income book = {len(income['holdings'])} ETFs, blended yield {income['income']['blended_yield_pct']}% (${income['income']['monthly_avg']}/month), "
        f"mode {income['cadence']['mode']}, triggers active: {[t['id'] for t in income['triggers'] if t['active']]}")
    return {"etf_book": etf, "thesis_book": thesis_bk, "income_book": income, "regime": regime, "flows": flows, "themes": themes, "analyses": analyses, "scores": scores,
            "strategies": strategies, "ranked": ranked, "risk": risk, "portfolio": portfolio, "technicals": technicals, "pm_detail": pm_detail}


def persist(results: dict, frames: dict, as_of: date) -> str:
    run_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:6]
    companies = frames["companies"]
    with session_scope() as s:
        s.add(Snapshot(run_id=run_id, kind="regime", key="", as_of=as_of, payload=results["regime"]))
        s.add(Snapshot(run_id=run_id, kind="flows", key="", as_of=as_of, payload=results["flows"]))
        s.add(Snapshot(run_id=run_id, kind="risk", key="", as_of=as_of, payload=results["risk"]))
        s.add(Snapshot(run_id=run_id, kind="portfolio", key="", as_of=as_of, payload=results["portfolio"]))
        s.add(Snapshot(run_id=run_id, kind="etf_book", key="", as_of=as_of, payload=results["etf_book"]))
        s.add(Snapshot(run_id=run_id, kind="thesis_book", key="", as_of=as_of, payload=results["thesis_book"]))
        s.add(Snapshot(run_id=run_id, kind="income_book", key="", as_of=as_of, payload=results["income_book"]))
        for th in results["themes"]:
            s.add(Snapshot(run_id=run_id, kind="theme", key=th["id"], as_of=as_of, payload=th))
        for t, st in results["strategies"].items():
            a = results["analyses"][t]
            payload = {"as_of": as_of.isoformat(), "company": companies[t], "scores": results["scores"][t], "strategist": st, "technical": results.get("technicals", {}).get(t),
                       "pm": results.get("pm_detail", {}).get(t),
                       "fundamentals": {"latest": a["latest"], "history": a["history"], "valuation": a["valuation"],
                                        "momentum": a["momentum"], "price": a["price"], "data_quality": a["data_quality"]}}
            s.add(Snapshot(run_id=run_id, kind="company", key=t, as_of=as_of, payload=payload))
        s.add(Snapshot(run_id=run_id, kind="meta", key="", as_of=as_of, payload={
            "run_id": run_id, "as_of": as_of.isoformat(), "companies": len(results["strategies"]), "themes": len(results["themes"]),
            "llm_provider": llm_provider(), "universe_limit": settings.universe_limit,
            "portfolio_positions": results["portfolio"]["stats"]["positions"], "portfolio_trades": len(results["portfolio"]["trades"]),
            "top": [{"ticker": x["ticker"], "opportunity": x["opportunity_score"], "gap": x["expectations_gap"]} for x in results["ranked"][:10]],
            "ranked_tickers": [x["ticker"] for x in results["ranked"][:80]],
        }))
    return run_id


# ------------------------------------------------------------------ CLI
def run(limit: Optional[int] = None, skip_ingest: bool = False, use_llm: bool = True, as_of: Optional[date] = None, force_enrich: bool = False, fresh: bool = False,
        fresh_thesis: bool = False) -> str:
    t0 = time.time()
    init_db()
    limit = limit or settings.universe_limit
    seed_reference(limit)
    from .ondemand import custom_tickers
    tickers = list(dict.fromkeys(company_tickers(limit) + custom_tickers()))   # seeded universe + names added via search
    if not skip_ingest:
        ingest_macro()
        ingest_prices(list(INSTRUMENTS) + tickers)
        prior_pf, prior_run = load_prior("portfolio") or {}, load_prior("meta") or {}
        priority = {h["ticker"] for h in prior_pf.get("holdings", [])} | {w["ticker"] for w in prior_pf.get("watchlist", []) if isinstance(w, dict) and w.get("ticker")}
        priority |= set((prior_run.get("ranked_tickers") or [])[:60])
        due = fundamentals_due(tickers, priority)
        log(f"edgar: {len(due)}/{len(tickers)} companies due for a filings refresh today")
        ingest_fundamentals(due)
    if use_llm and llm_provider():
        try:
            run_theme_map()            # no-op unless names were added since the last mapping
        except Exception as e:
            log(f"themes-map: failed ({e}); continuing")
    frames = load_frames(tickers)
    as_of = as_of or date.today()
    results = compute_all(frames, as_of, use_llm, force_enrich=force_enrich, fresh=fresh, fresh_thesis=fresh_thesis)
    run_id = persist(results, frames, as_of)
    log(f"done: run {run_id} in {time.time() - t0:.0f}s; top: " +
        ", ".join(f"{x['ticker']} {x['opportunity_score']} (gap {x['expectations_gap']:+.0f})" for x in results["ranked"][:8] if x["expectations_gap"] is not None))
    return run_id


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["run", "ingest", "brief", "morning", "attention", "longterm", "thesis-v2", "events", "themes-map"])
    ap.add_argument("--new", type=str, default=None, help="thesis-v2: statement of a new thesis")
    ap.add_argument("--update", type=str, default=None, help="thesis-v2: id to review, or 'all'")
    ap.add_argument("--resolve", type=str, default=None, help="thesis-v2: 'T-001:true|false'")
    ap.add_argument("--seed", action="store_true", help="thesis-v2: create T-001 (trusted delegation)")
    ap.add_argument("--from-briefs", action="store_true", help="thesis-v2: consolidate the briefs' long-term bullets into theses, analyse, rank stocks")
    ap.add_argument("--opportunities", action="store_true", help="thesis-v2: re-rank stocks from the current ledger")
    ap.add_argument("--expand", action="store_true", help="thesis-v2: theme-driven universe expansion from the theses' value pools")
    ap.add_argument("--remap", action="store_true", help="thesis-v2: re-map value pools over the current universe, then re-rank")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--skip-ingest", action="store_true")
    ap.add_argument("--no-llm", action="store_true")
    ap.add_argument("--as-of", type=str, default=None)
    ap.add_argument("--enrich", action="store_true", help="run: force LLM enrichment even on a monitor day")
    ap.add_argument("--fresh", action="store_true", help="run: rebuild the portfolio from scratch (ignore the prior book; entry prices reset to today)")
    ap.add_argument("--fresh-thesis", action="store_true", help="run: rebuild only the thesis-driven portfolio from scratch")
    a = ap.parse_args()
    if a.cmd == "attention":
        run_attention()
        return
    if a.cmd == "themes-map":
        run_theme_map(force=a.fresh)
        return
    if a.cmd == "events":
        run_events()
        return
    if a.cmd == "longterm":
        run_longterm(use_llm=not a.no_llm)
        return
    if a.cmd == "thesis-v2":
        if a.remap:
            run_thesis_v2_remap(); run_thesis_v2_opportunities()
        elif a.expand:
            run_thesis_v2_expand()
        elif a.from_briefs:
            run_thesis_v2_from_briefs()
        elif a.opportunities:
            run_thesis_v2_opportunities(use_llm=not a.no_llm)
        elif a.seed:
            run_thesis_v2_new(T001, "T-001")
        elif a.new:
            run_thesis_v2_new(a.new)
        elif a.update:
            run_thesis_v2_update(None if a.update == "all" else a.update, force=True)
        elif a.resolve:
            tid, val = a.resolve.split(":")
            run_thesis_v2_resolve(tid, val.lower() == "true")
        return
    if a.cmd == "brief":
        run_brief(use_llm=not a.no_llm)
        return
    if a.cmd == "morning":   # attention -> brief -> recalibration, so today's interest and narrative feed the book
        try:
            run_attention()
        except Exception as e:
            log(f"attention: failed ({e}); continuing")
        try:
            run_events()
        except Exception as e:
            log(f"events: failed ({e}); continuing")
        run_brief(use_llm=not a.no_llm)
        try:
            run_longterm_if_due(use_llm=not a.no_llm)
        except Exception as e:
            log(f"longterm: failed ({e}); continuing with the previous thesis")
        if not a.no_llm:
            try:
                reviewed = run_thesis_v2_update()          # only theses not yet reviewed this calendar month
                if reviewed:
                    run_thesis_v2_expand()                 # nominees for the reviewed theses' value pools, then re-rank
            except Exception as e:
                log(f"thesis-v2: monthly review failed ({e}); continuing")
        run(a.limit, a.skip_ingest, not a.no_llm, force_enrich=a.enrich)
        return
    if a.cmd == "ingest":
        init_db()
        tickers = company_tickers(a.limit or settings.universe_limit)
        seed_reference(a.limit or settings.universe_limit)
        ingest_macro()
        ingest_prices(list(INSTRUMENTS) + tickers)
        ingest_fundamentals(tickers)
    else:
        run(a.limit, a.skip_ingest, not a.no_llm, date.fromisoformat(a.as_of) if a.as_of else None, force_enrich=a.enrich, fresh=a.fresh, fresh_thesis=a.fresh_thesis)


if __name__ == "__main__":
    main()
