"""Attention Engine — what people are looking up, watching, installing and building,
measured as *acceleration from a low base* and compared with what price already reflects.

Sources (phase 1, key-free): Wikipedia pageviews (companies + theme articles), Stocktwits watchers and
message velocity (tickers), Apple top-free chart ranks (consumer platforms), GitHub topic adoption
(developer themes), Google autocomplete (rising sub-topics), YouTube video velocity (optional key).

Per entity and source: z-score of the last 7 days vs its own trailing year, and a 4-week slope.
Attention = weighted blend (0-100). Breadth = how many sources are rising at once.
  not_priced : attention rising from a low base while Pricing is still low   -> early interest
  crowded    : extreme attention + extreme price momentum                    -> late, crowded
Sources without history (Apple, GitHub, Stocktwits) accumulate from our own daily observations.
"""
from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
import yaml

from ..data import attention as src
from .common import r, sigmoid_score, wmean

SOURCE_WEIGHTS = {"wikipedia": 1.0, "stocktwits_watchers": 0.7, "stocktwits_msgs": 0.5, "youtube": 0.8, "apple": 0.6, "github": 0.5}
CROWDED_ATTENTION, CROWDED_MOMENTUM = 80, 80
NOT_PRICED_ATTENTION, NOT_PRICED_PRICING = 62, 45


def load_maps() -> tuple[dict[str, str], dict[str, dict]]:
    base = Path(__file__).resolve().parent.parent
    companies = json.loads((base / "attention_companies.json").read_text())
    themes = yaml.safe_load((base / "attention_themes.yaml").read_text())
    return companies, themes


# ------------------------------------------------------------------ series scoring
def series_stats(s: pd.Series) -> Optional[dict]:
    """7-day level vs trailing history: z-score, % vs prior 28d, % vs 1y, and a 0-100 score."""
    s = s.dropna()
    if len(s) < 21:
        return None
    last7 = s.iloc[-7:].mean()
    prior28 = s.iloc[-35:-7].mean() if len(s) >= 35 else None
    year = s.iloc[-372:-7] if len(s) >= 60 else s.iloc[:-7]
    roll = s.rolling(7).mean().dropna()
    base = roll.iloc[-365:-7] if len(roll) > 60 else roll.iloc[:-7]
    # denominator floored at 15% of the typical level so day-to-day noise on a flat series does not read as acceleration
    denom = max(float(base.std()) if len(base) > 10 else 0.0, 0.15 * float(base.mean()) if len(base) else 1.0, 1e-9)
    z = float((last7 - base.mean()) / denom) if len(base) > 10 else 0.0
    slope = float(last7 / prior28 - 1) if prior28 and prior28 > 0 else 0.0
    vs_1y = float(last7 / year.mean() - 1) if len(year) and year.mean() > 0 else None
    zc, sc = max(-3.0, min(3.0, z)), max(-1.5, min(1.5, slope * 3))
    score = sigmoid_score(0.5 * zc + 0.5 * sc, k=1.2)
    return {"last7": r(last7, 1), "vs_28d_pct": r(slope * 100, 1), "vs_1y_pct": r(vs_1y * 100, 1) if vs_1y is not None else None,
            "z": r(z, 2), "score": r(score, 0), "n": int(len(s))}


def _append(s: pd.Series, d: date, v: Optional[float]) -> pd.Series:
    if v is None:
        return s
    point = pd.Series({pd.Timestamp(d): float(v)})
    return point if s.empty else pd.concat([s, point]).sort_index()


def _obs_series(history: pd.DataFrame, source: str, key: str, metric: str) -> pd.Series:
    if history is None or history.empty:
        return pd.Series(dtype=float)
    h = history[(history.source == source) & (history.key == key) & (history.metric == metric)]
    return h.set_index("date")["value"].sort_index() if len(h) else pd.Series(dtype=float)


def _blend(parts: dict[str, Optional[dict]]) -> tuple[Optional[float], int]:
    pairs = [(p["score"], SOURCE_WEIGHTS[k]) for k, p in parts.items() if p and p.get("score") is not None]
    rising = sum(1 for _, p in parts.items() if p and (p.get("vs_28d_pct") or 0) > 10)
    return wmean(pairs), rising


# ------------------------------------------------------------------ main
def compute(companies: dict[str, dict], company_scores: dict[str, dict], themes_by_id: dict[str, dict],
            history: pd.DataFrame, as_of: Optional[date] = None, log=print) -> tuple[dict, list[dict]]:
    """Returns (payload, new_observations). Observations are (source, key, metric, date, value) rows to persist."""
    today = as_of or date.today()
    cmap, tmap = load_maps()
    obs: list[dict] = []
    status = {}

    def add_obs(source: str, key: str, metric: str, value: Optional[float], d: date = today):
        if value is not None and np.isfinite(value):
            obs.append({"source": source, "key": key, "metric": metric, "date": d, "value": float(value)})

    # ---- companies
    apple = src.apple_top_free()
    apple_lc = [(rank, name.lower()) for rank, name in apple]
    status["apple"] = {"ok": bool(apple), "n": len(apple)}
    comp_rows = []
    wiki_ok = st_ok = 0
    for t, c in companies.items():
        parts: dict[str, Optional[dict]] = {}
        title = cmap.get(t)
        wiki = src.wikipedia_daily(title) if title else pd.Series(dtype=float)
        if len(wiki):
            wiki_ok += 1
            parts["wikipedia"] = series_stats(wiki)
        st = src.stocktwits(t)
        st_w = st_m = None
        if st:
            st_ok += 1
            add_obs("stocktwits", t, "watchers", st.get("watchers"))
            add_obs("stocktwits", t, "msgs_per_day", st.get("msgs_per_day"))
            add_obs("stocktwits", t, "bullish_share", st.get("bullish_share"))
            hw = _append(_obs_series(history, "stocktwits", t, "watchers"), today, st.get("watchers"))
            st_w = series_stats(hw)
            hm = _append(_obs_series(history, "stocktwits", t, "msgs_per_day"), today, st.get("msgs_per_day"))
            st_m = series_stats(hm)
            parts["stocktwits_watchers"], parts["stocktwits_msgs"] = st_w, st_m
        sc = company_scores.get(t, {})
        att, breadth = _blend(parts)
        pricing, pm = sc.get("pricing"), sc.get("price_momentum")
        w = parts.get("wikipedia") or {}
        comp_rows.append({
            "ticker": t, "name": c["name"], "sector": c["sector"], "attention": r(att, 0), "breadth": breadth,
            "pricing": pricing, "price_momentum": pm, "opportunity": sc.get("opportunity"), "gap": sc.get("gap"),
            "crowded": bool(att is not None and att >= CROWDED_ATTENTION and (pm or 0) >= CROWDED_MOMENTUM),
            "not_priced": bool(att is not None and att >= NOT_PRICED_ATTENTION and pricing is not None and pricing <= NOT_PRICED_PRICING and (w.get("vs_28d_pct") or 0) > 0),
            "wiki_title": title, "wiki_7d": w.get("last7"), "wiki_vs_28d_pct": w.get("vs_28d_pct"), "wiki_vs_1y_pct": w.get("vs_1y_pct"), "wiki_z": w.get("z"),
            "st_watchers": st.get("watchers") if st else None, "st_msgs_per_day": st.get("msgs_per_day") if st else None,
            "st_bullish_share": st.get("bullish_share") if st else None,
            "st_watchers_vs_28d_pct": (st_w or {}).get("vs_28d_pct"), "st_history_days": (st_w or {}).get("n"),
            "sources": {k: (p or {}).get("score") for k, p in parts.items()},
        })
    status["wikipedia"] = {"ok": wiki_ok > 0, "n": wiki_ok}
    status["stocktwits"] = {"ok": st_ok > 0, "n": st_ok}

    # ---- themes
    theme_rows = []
    gh_calls = 0
    for tid, m in tmap.items():
        th = themes_by_id.get(tid, {})
        parts = {}
        wiki_total = pd.Series(dtype=float)
        for title in m.get("wikipedia") or []:
            s = src.wikipedia_daily(title)
            if len(s):
                wiki_total = s if wiki_total.empty else wiki_total.add(s, fill_value=0)
        if len(wiki_total):
            parts["wikipedia"] = series_stats(wiki_total)
        # apps: best rank among mapped apps (lower is better) -> observation + score via history
        ranks = []
        for app in m.get("apps") or []:
            pat = re.compile(r"(?<![a-z0-9])" + re.escape(app.lower()) + r"(?![a-z0-9])")   # whole-word: "Ro" must not match "from"
            hit = next((rank for rank, name in apple_lc if pat.search(name)), None)
            ranks.append({"name": app, "rank": hit})
        present = [x["rank"] for x in ranks if x["rank"]]
        if ranks:
            best = min(present) if present else 101
            add_obs("apple", tid, "best_rank", best)
            hr = _append(_obs_series(history, "apple", tid, "best_rank"), today, best)
            parts["apple"] = series_stats(101 - hr) if len(hr) >= 21 else None  # invert so higher = more attention
        # github: repos per topic, accumulate daily
        gh_repos = None
        if m.get("github") and gh_calls < 25:
            total = 0
            for topic in m["github"][:2]:
                g = src.github_topic(topic)
                gh_calls += 1
                if g and g.get("repos"):
                    total += g["repos"]
            if total:
                gh_repos = total
                add_obs("github", tid, "repos", total)
                hg = _append(_obs_series(history, "github", tid, "repos"), today, total)
                parts["github"] = series_stats(hg) if len(hg) >= 21 else None
        # youtube (optional key)
        yt = None
        if m.get("youtube"):
            counts = [src.youtube_counts(q) for q in m["youtube"][:2]]
            counts = [c for c in counts if c and c.get("last7") is not None and c.get("prior28_weekly")]
            if counts:
                last7 = sum(c["last7"] for c in counts)
                prior = sum(c["prior28_weekly"] for c in counts)
                slope = last7 / prior - 1 if prior else 0
                yt = {"last7": last7, "vs_28d_pct": r(slope * 100, 1), "score": r(sigmoid_score(max(-1.5, min(1.5, slope * 3))), 0)}
                parts["youtube"] = yt
        rising = []
        for seed in (m.get("seeds") or [])[:2]:
            rising.extend(src.autocomplete(seed))
        att, breadth = _blend(parts)
        w = parts.get("wikipedia") or {}
        pricing = th.get("pricing")
        theme_rows.append({
            "theme_id": tid, "name": th.get("name", tid), "attention": r(att, 0), "breadth": breadth,
            "trend": th.get("trend"), "pricing": pricing, "narrative": th.get("narrative"), "gap": th.get("gap"),
            "not_priced": bool(att is not None and att >= NOT_PRICED_ATTENTION and pricing is not None and pricing <= NOT_PRICED_PRICING and (w.get("vs_28d_pct") or 0) > 0),
            "wiki_7d": w.get("last7"), "wiki_vs_28d_pct": w.get("vs_28d_pct"), "wiki_vs_1y_pct": w.get("vs_1y_pct"), "wiki_z": w.get("z"),
            "wiki_articles": m.get("wikipedia") or [], "app_ranks": ranks, "gh_repos": gh_repos, "youtube": yt,
            "rising_queries": list(dict.fromkeys(rising))[:12],
            "sources": {k: (p or {}).get("score") for k, p in parts.items()},
        })
    status["github"] = {"ok": gh_calls > 0, "n": gh_calls}
    status["youtube"] = {"ok": any(t["youtube"] for t in theme_rows), "n": sum(1 for t in theme_rows if t["youtube"])}
    status["autocomplete"] = {"ok": any(t["rising_queries"] for t in theme_rows), "n": sum(len(t["rising_queries"]) for t in theme_rows)}

    comp_rows.sort(key=lambda x: -(x["attention"] if x["attention"] is not None else -1))
    theme_rows.sort(key=lambda x: -(x["attention"] if x["attention"] is not None else -1))
    payload = {
        "as_of": today.isoformat(), "generated_at": pd.Timestamp.now().isoformat(timespec="seconds"),
        "sources": status, "weights": SOURCE_WEIGHTS,
        "companies": comp_rows, "themes": theme_rows,
        "movers": {
            "companies_up": sorted([c for c in comp_rows if c["wiki_vs_28d_pct"] is not None], key=lambda x: -x["wiki_vs_28d_pct"])[:10],
            "companies_down": sorted([c for c in comp_rows if c["wiki_vs_28d_pct"] is not None], key=lambda x: x["wiki_vs_28d_pct"])[:10],
            "themes_up": sorted([t for t in theme_rows if t["wiki_vs_28d_pct"] is not None], key=lambda x: -x["wiki_vs_28d_pct"])[:8],
            "not_priced": [c for c in comp_rows if c["not_priced"]][:15] + [t for t in theme_rows if t["not_priced"]],
            "crowded": [c for c in comp_rows if c["crowded"]][:15],
        },
        "method": "Attention = weighted blend of per-source scores; each score = sigmoid of (z of last-7d vs own trailing year, 4-week slope). "
                  "not_priced = attention >= 62 while Pricing <= 45 and rising; crowded = attention >= 80 with price momentum >= 80.",
    }
    return payload, obs
