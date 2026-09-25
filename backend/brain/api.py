"""FastAPI reader over the latest run's snapshots. Run: uvicorn brain.api:app --reload"""
from __future__ import annotations

from datetime import date
from typing import Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import desc, select

from .config import settings
from .db import init_db, session_scope
from .models import Snapshot

app = FastAPI(title="Investment Intelligence Engine", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",")] + ["*"],
                   allow_methods=["*"], allow_headers=["*"])
_run_state = {"running": False, "last_error": None, "running_brief": False}


@app.on_event("startup")
def _startup() -> None:
    init_db()


def _latest_run_id(s) -> Optional[str]:
    row = s.execute(select(Snapshot.run_id).where(Snapshot.kind == "meta").order_by(desc(Snapshot.id)).limit(1)).first()
    return row[0] if row else None


def _snaps(kind: str, key: Optional[str] = None, run_id: Optional[str] = None) -> list[dict]:
    with session_scope() as s:
        rid = run_id or _latest_run_id(s)
        if not rid:
            return []
        q = select(Snapshot).where(Snapshot.run_id == rid, Snapshot.kind == kind)
        if key is not None:
            q = q.where(Snapshot.key == key)
        return [x.payload for x in s.execute(q).scalars()]


def _one(kind: str, key: str = "", run_id: Optional[str] = None) -> dict:
    rows = _snaps(kind, key, run_id)
    if not rows:
        raise HTTPException(404, f"No {kind} snapshot yet. Run the pipeline: python -m brain.pipeline run")
    return rows[0]


def _company_row(p: dict) -> dict:
    st, sc, c, f = p["strategist"], p["scores"], p["company"], p["fundamentals"]
    return {
        "ticker": c["ticker"], "name": c["name"], "sector": c["sector"], "industry": c["industry"], "size": c["size"],
        "price": f["price"], "market_cap": f["valuation"].get("market_cap"),
        "quality": sc["quality"], "growth": sc["growth"], "value": sc["value"], "acceleration": sc["acceleration"],
        "theme": st["components"].get("structural_trend"), "flow": st["components"].get("capital_flow"),
        "total": st["opportunity_score"], "reality": st["reality"], "narrative": st["narrative"], "pricing": st["pricing"],
        "expectations_gap": st["expectations_gap"],
        "revenue_growth": f["latest"].get("revenue_growth"), "roic": f["latest"].get("roic"),
        "fcf_yield": f["valuation"].get("fcf_yield"), "pe": f["valuation"].get("pe"), "ev_sales": f["valuation"].get("ev_sales"),
        "return_3m": f["momentum"].get("return_3m"),
        "top_theme": st["theme_exposures"][0]["theme"] if st.get("theme_exposures") else None,
    }


@app.get("/api/health")
def health() -> dict:
    with session_scope() as s:
        rid = _latest_run_id(s)
    return {"ok": True, "latest_run": rid, "running": _run_state["running"], "running_brief": _run_state["running_brief"],
            "running_attention": _run_state.get("running_attention", False), "running_thesis_v2": _run_state.get("running_thesis_v2", False),
            "last_error": _run_state["last_error"]}


@app.get("/api/runs")
def runs() -> list[dict]:
    with session_scope() as s:
        rows = s.execute(select(Snapshot).where(Snapshot.kind == "meta").order_by(desc(Snapshot.id)).limit(30)).scalars()
        return [{"run_id": r.run_id, "as_of": r.as_of.isoformat(), "created_at": r.created_at.isoformat(), **r.payload} for r in rows]


@app.get("/api/overview")
def overview(run_id: Optional[str] = None) -> dict:
    regime, flows, risk = _one("regime", "", run_id), _one("flows", "", run_id), _one("risk", "", run_id)
    themes = sorted(_snaps("theme", None, run_id), key=lambda t: -(t["gap"] if t["gap"] is not None else -999))
    companies = sorted((_company_row(p) for p in _snaps("company", None, run_id)), key=lambda x: -(x["total"] or 0))
    meta = _one("meta", "", run_id)
    pf = _snaps("portfolio", "", run_id)
    return {
        "meta": meta,
        "portfolio": ({"positions": pf[0]["stats"]["positions"], "equity_weight": pf[0]["equity_weight"], "trades": len(pf[0]["trades"]),
                       "weighted_gap": pf[0]["stats"]["weighted_gap"], "top": [{"ticker": h["ticker"], "weight": h["weight"]} for h in pf[0]["holdings"][:6]]}
                      if pf else None),
        "regime": {"headline": regime["headline"], "label": regime["regime"]["label"], "probabilities": regime["regime"]["probabilities"],
                   "probability_delta": regime["trend"]["probability_delta"],
                   "dimensions": {k: v["score"] for k, v in regime["dimensions"].items()},
                   "dimension_delta": regime["trend"]["dimension_delta"], "as_of": regime["as_of"]},
        "risk": {"score": risk["risk_score"], "label": risk["label"], "posture": risk["posture"]},
        "rotation": flows["groups"]["sector"], "flow_summary": flows["summary"], "risk_appetite": flows["risk_appetite"],
        "themes": [{k: t[k] for k in ("id", "name", "trend", "pricing", "gap", "star", "n_companies", "horizon_years")} for t in themes],
        "top_companies": companies[:15],
        "biggest_gaps": sorted([c for c in companies if c["expectations_gap"] is not None], key=lambda x: -x["expectations_gap"])[:10],
    }


@app.get("/api/regime")
def regime(run_id: Optional[str] = None) -> dict:
    return _one("regime", "", run_id)


@app.get("/api/flows")
def flows(run_id: Optional[str] = None) -> dict:
    return _one("flows", "", run_id)


@app.get("/api/risk")
def risk(run_id: Optional[str] = None) -> dict:
    return _one("risk", "", run_id)


@app.get("/api/themes")
def themes(run_id: Optional[str] = None) -> list[dict]:
    rows = sorted(_snaps("theme", None, run_id), key=lambda t: -(t["gap"] if t["gap"] is not None else -999))
    att = _latest_attention()
    amap = {t["theme_id"]: t for t in (att or {}).get("themes", [])}
    return [{k: v for k, v in t.items() if k not in ("members", "children")} | {"top_members": t["members"][:5],
            "attention": (amap.get(t["id"]) or {}).get("attention"), "attention_not_priced": bool((amap.get(t["id"]) or {}).get("not_priced"))} for t in rows]


@app.get("/api/themes/{theme_id}")
def theme(theme_id: str, run_id: Optional[str] = None) -> dict:
    t = _one("theme", theme_id, run_id)
    att = _latest_attention()
    a = next((x for x in (att or {}).get("themes", []) if x["theme_id"] == theme_id), None)
    return {**t, "attention": a}


@app.get("/api/companies")
def companies(sector: Optional[str] = None, sort: str = Query("total"), limit: int = 500, run_id: Optional[str] = None) -> list[dict]:
    rows = [_company_row(p) for p in _snaps("company", None, run_id)]
    att = _latest_attention()
    amap = {c["ticker"]: c for c in (att or {}).get("companies", [])}
    for x in rows:
        a = amap.get(x["ticker"])
        x["attention"] = a["attention"] if a else None
        x["crowded"] = bool(a and a["crowded"]); x["not_priced"] = bool(a and a["not_priced"])
    if sector:
        rows = [x for x in rows if x["sector"] == sector]
    rows.sort(key=lambda x: -(x.get(sort) if isinstance(x.get(sort), (int, float)) else -1e9))
    return rows[:limit]


@app.get("/api/companies/{ticker}")
def company(ticker: str, run_id: Optional[str] = None) -> dict:
    p = _one("company", ticker.upper(), run_id)
    att = _latest_attention()
    a = next((c for c in (att or {}).get("companies", []) if c["ticker"] == ticker.upper()), None)
    return {**p, "attention": a}


@app.get("/api/search")
def search(q: str = Query("", min_length=0), limit: int = 12) -> list[dict]:
    """Ticker/name search over the universe; an unknown ticker is resolved through the SEC registry
    and returned with in_universe=false so the UI can offer on-demand analysis."""
    from .ondemand import search as _search
    try:
        return _search(q, limit)
    except Exception as e:
        raise HTTPException(502, f"search failed: {e}")


@app.post("/api/companies/{ticker}/analyze")
def analyze_company(ticker: str) -> dict:
    """Pull any SEC-registered ticker into the latest run (and all future runs)."""
    from .ondemand import analyze
    try:
        return analyze(ticker)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        raise HTTPException(500, f"analysis failed: {e}")


@app.get("/api/prices/{symbol}")
def prices(symbol: str, range: str = "1y", interval: str = "1d") -> dict:
    import pandas as pd
    from .engines.technicals import compute as compute_ta
    from .models import Price
    sym = symbol.upper()
    with session_scope() as s:
        df = pd.read_sql(select(Price).where(Price.symbol == sym), s.connection())
    if df.empty:
        raise HTTPException(404, f"No stored prices for {sym}. Analyze it on demand first.")
    df["date"] = pd.to_datetime(df["date"])
    out = compute_ta(df, range if range in ("1m", "3m", "6m", "1y", "2y", "5y", "max") else "1y", "1w" if interval == "1w" else "1d")
    return {"symbol": sym, **out}


@app.get("/api/brief")
def brief() -> dict:
    from .pipeline import load_briefs, load_narrative
    rows = load_briefs(1)
    if not rows:
        raise HTTPException(404, "No morning brief yet. Run: python -m brain.pipeline brief")
    return {**rows[0], "narrative": {"by_theme": load_narrative()}}


@app.get("/api/brief/history")
def brief_history() -> list[dict]:
    with session_scope() as s:
        rows = s.execute(select(Snapshot).where(Snapshot.kind == "brief").order_by(desc(Snapshot.id)).limit(60)).scalars()
        return [{"brief_id": x.run_id, "as_of": x.as_of.isoformat(), "generated_at": x.payload.get("generated_at"), "n_headlines": x.payload.get("n_headlines"),
                 "direction": (x.payload.get("llm") or {}).get("market_thesis", {}).get("direction"), "has_llm": bool(x.payload.get("llm"))} for x in rows]


@app.post("/api/brief/run")
def trigger_brief(background: BackgroundTasks) -> dict:
    if _run_state["running_brief"]:
        return {"started": False, "reason": "already running"}

    def _job():
        from .pipeline import run_brief
        _run_state["running_brief"], _run_state["last_error"] = True, None
        try:
            run_brief()
        except Exception as e:
            _run_state["last_error"] = str(e)
        finally:
            _run_state["running_brief"] = False

    background.add_task(_job)
    return {"started": True}


def _latest_attention() -> Optional[dict]:
    with session_scope() as s:
        row = s.execute(select(Snapshot).where(Snapshot.kind == "attention").order_by(desc(Snapshot.id)).limit(1)).scalar()
        return row.payload if row else None


@app.get("/api/thesis")
def thesis() -> dict:
    from .pipeline import load_prior
    lt = load_prior("longterm")
    if not lt:
        raise HTTPException(404, "No long-term thesis yet. Run: python -m brain.pipeline longterm")
    return lt


@app.get("/api/thesis/history")
def thesis_history() -> list[dict]:
    with session_scope() as s:
        rows = s.execute(select(Snapshot).where(Snapshot.kind == "longterm").order_by(desc(Snapshot.id)).limit(30)).scalars()
        return [{"id": x.run_id, "as_of": x.as_of.isoformat(), "n_briefs": x.payload.get("n_briefs"), "confidence": x.payload.get("confidence"),
                 "top_themes": [(t["theme"], t["conviction"]) for t in x.payload.get("theme_ranking", [])[:5]], "llm": x.payload.get("llm_provider")} for x in rows]


# ---------------------------------------------------------------- Thesis v2 (Causal Futures Engine)
from pydantic import BaseModel as _BM


class ThesisIn(_BM):
    statement: str


class ResolveIn(_BM):
    outcome: bool


@app.get("/api/thesis-v2")
def thesis_v2_list() -> dict:
    from .engines.causal import scoreboard, summary
    from .pipeline import _thesis_v2_records
    recs = list(_thesis_v2_records().values())
    recs.sort(key=lambda x: x["id"])
    return {"theses": [summary(x) for x in recs], "scoreboard": scoreboard(recs)}


@app.get("/api/thesis-v2/{thesis_id}")
def thesis_v2_get(thesis_id: str) -> dict:
    from .pipeline import _thesis_v2_records
    rec = _thesis_v2_records().get(thesis_id.upper())
    if not rec:
        raise HTTPException(404, f"No thesis {thesis_id}. Create one with POST /api/thesis-v2 or: python -m brain.pipeline thesis-v2 --seed")
    return rec


def _bg(flag: str, fn, *args) -> dict:
    if _run_state.get(flag):
        return {"started": False, "reason": "already running"}

    def _job():
        _run_state[flag], _run_state["last_error"] = True, None
        try:
            fn(*args)
        except Exception as e:
            _run_state["last_error"] = str(e)
        finally:
            _run_state[flag] = False
    return {"job": _job}


@app.post("/api/thesis-v2")
def thesis_v2_create(body: ThesisIn, background: BackgroundTasks) -> dict:
    from .pipeline import run_thesis_v2_new
    if len(body.statement.strip()) < 20:
        raise HTTPException(422, "Give the thesis as a full sentence (population, behaviour, horizon).")
    j = _bg("running_thesis_v2", run_thesis_v2_new, body.statement.strip())
    if "job" not in j:
        return j
    background.add_task(j["job"])
    return {"started": True}


@app.post("/api/thesis-v2/{thesis_id}/update")
def thesis_v2_update(thesis_id: str, background: BackgroundTasks) -> dict:
    from .pipeline import run_thesis_v2_update
    j = _bg("running_thesis_v2", run_thesis_v2_update, thesis_id.upper(), True)
    if "job" not in j:
        return j
    background.add_task(j["job"])
    return {"started": True}


@app.post("/api/thesis-v2/{thesis_id}/resolve")
def thesis_v2_resolve(thesis_id: str, body: ResolveIn) -> dict:
    from .pipeline import run_thesis_v2_resolve
    try:
        return run_thesis_v2_resolve(thesis_id.upper(), body.outcome)
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.get("/api/attention")
def attention() -> dict:
    a = _latest_attention()
    if not a:
        raise HTTPException(404, "No attention snapshot yet. Run: python -m brain.pipeline attention")
    return a


@app.post("/api/attention/run")
def trigger_attention(background: BackgroundTasks) -> dict:
    if _run_state.get("running_attention"):
        return {"started": False, "reason": "already running"}

    def _job():
        from .pipeline import run_attention
        _run_state["running_attention"], _run_state["last_error"] = True, None
        try:
            run_attention()
        except Exception as e:
            _run_state["last_error"] = str(e)
        finally:
            _run_state["running_attention"] = False

    background.add_task(_job)
    return {"started": True}


@app.get("/api/portfolio")
def portfolio(run_id: Optional[str] = None) -> dict:
    return _one("portfolio", "", run_id)


@app.get("/api/portfolio/history")
def portfolio_history() -> list[dict]:
    with session_scope() as s:
        rows = s.execute(select(Snapshot).where(Snapshot.kind == "portfolio").order_by(desc(Snapshot.id)).limit(52)).scalars()
        return [{"run_id": x.run_id, "as_of": x.as_of.isoformat(), "positions": x.payload["stats"]["positions"],
                 "equity_weight": x.payload["equity_weight"], "trades": len(x.payload["trades"]), "exits": len(x.payload["exits"]),
                 "weighted_opportunity": x.payload["stats"]["weighted_opportunity"], "weighted_gap": x.payload["stats"]["weighted_gap"],
                 "turnover": x.payload["stats"]["turnover"], "holdings": [h["ticker"] for h in x.payload["holdings"]],
                 "has_memo": "memo" in x.payload} for x in rows]


@app.post("/api/run")
def trigger_run(background: BackgroundTasks, limit: Optional[int] = None, skip_ingest: bool = False) -> dict:
    if _run_state["running"]:
        return {"started": False, "reason": "already running"}

    def _job():
        from .pipeline import run
        _run_state["running"], _run_state["last_error"] = True, None
        try:
            run(limit=limit, skip_ingest=skip_ingest)
        except Exception as e:  # surfaced via /api/health
            _run_state["last_error"] = str(e)
        finally:
            _run_state["running"] = False

    background.add_task(_job)
    return {"started": True}
