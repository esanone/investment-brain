"""Search and on-demand analysis for tickers outside the seeded universe.

Any SEC-registered company can be pulled in: we resolve it through the SEC ticker map,
classify its sector from the SIC code, ingest its filings and prices, then score it
against the latest run's universe (the cross-sectional percentiles are rebuilt from the
run's stored company snapshots, so the new name lands on the same scale) and persist it
into that run. It also joins the universe for every future weekly run.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

import pandas as pd
from sqlalchemy import desc, select

from .data import edgar, prices as price_src
from .data.http import cached_get_json
from .db import session_scope
from .engines import fundamentals as fund_engine, strategist, themes as theme_engine
from .models import Company, Fundamental, Price, Snapshot
from .universe import COMPANIES


def sic_to_sector(sic: Optional[int], desc_: str = "") -> tuple[str, str]:
    """Rough SIC -> GICS-like sector. Returns (sector, industry description)."""
    d = desc_ or "SIC unknown"
    if sic is None:
        return "Industrials", d
    s = int(sic)
    if 1000 <= s < 1100 or 1400 <= s < 1500 or 2400 <= s < 2700 or 2800 <= s < 2900 and not 2833 <= s <= 2836 or 3000 <= s < 3100 or 3200 <= s < 3400:
        return "Materials", d
    if 1300 <= s < 1400 or 2900 <= s < 3000:
        return "Energy", d
    if 1500 <= s < 1800 or 3400 <= s < 3570 or 3580 <= s < 3600 or 3700 <= s < 3800 and s != 3711 or 4000 <= s < 4800 or 5000 <= s < 5200 or 8700 <= s < 8800 or 3800 <= s < 3820:
        return "Industrials", d
    if 2000 <= s < 2200 or 2840 <= s < 2850 or s in (5400, 5411, 5912, 5331):
        return "Consumer Staples", d
    if 2200 <= s < 2400 or 3100 <= s < 3200 or s in (3711, 3630) or 3900 <= s < 4000 or 5200 <= s < 6000 or 7000 <= s < 7100 or 7900 <= s < 8000 or 5900 <= s < 6000:
        return "Consumer Discretionary", d
    if 2711 <= s < 2800 or 4800 <= s < 4900 or 7800 <= s < 7900 or s in (7370, 7371, 7372, 7373, 7374, 7375) and "internet" in d.lower():
        return "Communication Services", d
    if 2833 <= s <= 2836 or 3840 <= s < 3860 or 8000 <= s < 8100 or s == 8731:
        return "Health Care", d
    if 3570 <= s < 3580 or 3600 <= s < 3700 or 3820 <= s < 3840 or 7370 <= s < 7380 or s == 3577:
        return "Technology", d
    if 4900 <= s < 5000:
        return "Utilities", d
    if s == 6798 or 6500 <= s < 6600:
        return "Real Estate", d
    if 6000 <= s < 6800:
        return "Financials", d
    return "Industrials", d


def resolve(ticker: str) -> Optional[dict]:
    t = ticker.upper().strip()
    if t in COMPANIES:
        name, sector, industry, size = COMPANIES[t]
        return {"ticker": t, "name": name, "sector": sector, "industry": industry, "size": size, "in_universe": True}
    with session_scope() as s:
        c = s.get(Company, t)
        if c:
            return {"ticker": t, "name": c.name, "sector": c.sector, "industry": c.industry, "size": c.size, "cik": c.cik, "in_universe": True}
    tm = edgar.load_ticker_map()
    m = tm.get(t)
    if not m:
        return None
    sub = cached_get_json(f"https://data.sec.gov/submissions/CIK{m['cik']:010d}.json", namespace="edgar", key=f"sub_{m['cik']}",
                          ttl_hours=168, headers=edgar._HEADERS)
    sector, industry = sic_to_sector(sub.get("sic"), sub.get("sicDescription") or "")
    forms = set(sub.get("filings", {}).get("recent", {}).get("form", []))
    return {"ticker": t, "name": m["title"].title() if m["title"].isupper() else m["title"], "cik": m["cik"], "sector": sector,
            "industry": industry, "size": "mid", "in_universe": False,
            "files_10k": bool(forms & {"10-K", "10-Q"}), "foreign_filer": bool(forms & {"20-F", "40-F"}) and not (forms & {"10-K", "10-Q"})}


def search(q: str, limit: int = 12) -> list[dict]:
    q = q.strip().upper()
    if not q:
        return []
    with session_scope() as s:
        rows = list(s.execute(select(Company)).scalars())
    out = []
    for c in rows:
        name = (c.name or "").upper()
        if c.ticker.startswith(q):
            out.append((0, c))
        elif q in c.ticker or name.startswith(q):
            out.append((1, c))
        elif q in name:
            out.append((2, c))
    out.sort(key=lambda x: (x[0], x[1].ticker))
    results = [{"ticker": c.ticker, "name": c.name, "sector": c.sector, "in_universe": True} for _, c in out[:limit]]
    # Fall through to the SEC registry (~10k names) so any listed company is reachable
    if len(results) < limit:
        seen = {r["ticker"] for r in results}
        ext = []
        for tk, m in edgar.load_ticker_map().items():
            if tk in seen:
                continue
            title = m["title"].upper()
            if tk == q:
                ext.append((0, tk, m["title"]))
            elif tk.startswith(q):
                ext.append((1, tk, m["title"]))
            elif len(q) >= 3 and title.startswith(q):
                ext.append((2, tk, m["title"]))
            elif len(q) >= 4 and q in title:
                ext.append((3, tk, m["title"]))
        ext.sort(key=lambda x: (x[0], len(x[1]), x[1]))
        for _, tk, title in ext[: limit - len(results)]:
            results.append({"ticker": tk, "name": title.title() if title.isupper() else title, "sector": None, "in_universe": False})
        results.sort(key=lambda r: (0 if r["ticker"] == q else 1 if r["ticker"].startswith(q) else 2, not r["in_universe"], r["ticker"]))
    return results


def _latest_run(s) -> Optional[str]:
    row = s.execute(select(Snapshot.run_id).where(Snapshot.kind == "meta").order_by(desc(Snapshot.id)).limit(1)).first()
    return row[0] if row else None


def analyze(ticker: str) -> dict:
    """Ingest + score one ticker against the latest run; persist into that run. Returns the company payload."""
    meta = resolve(ticker)
    if not meta:
        raise ValueError(f"{ticker.upper()} is not in the SEC ticker registry")
    t = meta["ticker"]
    if meta.get("foreign_filer"):
        raise ValueError(f"{t} files 20-F/40-F (foreign private issuer); XBRL coverage is not supported yet")
    cik = meta.get("cik") or edgar.load_ticker_map().get(t, {}).get("cik")

    # 1. ingest this ticker
    facts = edgar.fetch_companyfacts(cik)
    rows = edgar.extract_financials(facts)
    px = price_src.fetch_history(t)
    with session_scope() as s:
        s.execute(Fundamental.__table__.delete().where(Fundamental.ticker == t))
        s.bulk_insert_mappings(Fundamental, [{"ticker": t, "period_type": f.period_type, "period_end": f.period_end, "metric": f.metric,
                                              "value": f.value, "filed": f.filed} for f in rows])
        if not px.empty:
            s.execute(Price.__table__.delete().where(Price.symbol == t))
            s.bulk_insert_mappings(Price, [{"symbol": t, "date": r.date.date(), "open": float(r.open), "high": float(r.high), "low": float(r.low),
                                            "close": float(r.close), "adj_close": float(r.adj_close), "volume": float(r.volume)} for r in px.itertuples()])

    # 2. load the latest run's context
    with session_scope() as s:
        run_id = _latest_run(s)
        if not run_id:
            raise RuntimeError("No pipeline run yet; run the pipeline first")
        snaps = {k: [x.payload for x in s.execute(select(Snapshot).where(Snapshot.run_id == run_id, Snapshot.kind == k)).scalars()]
                 for k in ("regime", "flows", "theme", "company")}
        fdf = pd.read_sql(select(Fundamental).where(Fundamental.ticker == t), s.connection())
    regime, flows = snaps["regime"][0], snaps["flows"][0]
    as_of = date.fromisoformat(regime["as_of"])
    themes_by_id = {th["id"]: th for th in snaps["theme"]}
    companies = {p["company"]["ticker"]: p["company"] for p in snaps["company"]}
    analyses = {p["company"]["ticker"]: {"latest": p["fundamentals"]["latest"], "valuation": p["fundamentals"]["valuation"],
                                         "momentum": p["fundamentals"]["momentum"]} for p in snaps["company"]}
    company = {"ticker": t, "name": meta["name"], "sector": meta["sector"], "industry": meta.get("industry"), "size": meta.get("size", "mid"), "cik": cik}
    companies[t] = company

    # 3. analyse + score on the same cross-sectional scale
    fdf["period_end"] = pd.to_datetime(fdf["period_end"]); fdf["filed"] = pd.to_datetime(fdf["filed"])
    px["date"] = pd.to_datetime(px["date"]) if not px.empty else px
    a = fund_engine.analyze_company(t, fdf, px, as_of, sector=meta["sector"])
    if not a:
        has_rev = bool(len(fdf[(fdf.metric == "revenue")]))
        why = ("no revenue reported in its XBRL filings (pre-revenue company)" if not has_rev
               else "fewer than two trailing-twelve-month periods of revenue on file")
        raise ValueError(f"{t} ({meta['name']}) cannot be scored yet: {why}. The engines need revenue history to compute growth, "
                         f"quality and valuation; it will become scoreable once it reports revenue for five consecutive quarters.")
    analyses[t] = a
    scores = fund_engine.score_universe(analyses, companies, None)
    graph = theme_engine.load_graph()
    exp = theme_engine.company_theme_exposure(graph, t)
    st = strategist.compute(company, a, scores[t], exp, themes_by_id, regime, flows)
    st["theme_exposures"] = exp
    payload = {"company": company, "scores": scores[t], "strategist": st, "on_demand": True, "analyzed_at": date.today().isoformat(),
               "fundamentals": {"latest": a["latest"], "history": a["history"], "valuation": a["valuation"], "momentum": a["momentum"],
                                "price": a["price"], "data_quality": a["data_quality"]}}
    with session_scope() as s:
        s.merge(Company(ticker=t, name=meta["name"], cik=cik, sector=meta["sector"], industry=meta.get("industry"), size=meta.get("size", "mid"),
                        source="seed" if t in COMPANIES else "custom"))   # joins every future run
        s.execute(Snapshot.__table__.delete().where(Snapshot.run_id == run_id, Snapshot.kind == "company", Snapshot.key == t))
        s.add(Snapshot(run_id=run_id, kind="company", key=t, as_of=as_of, payload=payload))
    return payload


def custom_tickers() -> list[str]:
    with session_scope() as s:
        return [c.ticker for c in s.execute(select(Company).where(Company.source == "custom")).scalars()]
