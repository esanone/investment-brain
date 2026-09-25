"""Attention data: what people look up, watch, install and build. All key-free except YouTube (optional key)."""
from __future__ import annotations

import json
import time
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from urllib.parse import quote

import httpx
import pandas as pd

from ..config import settings
from .http import cached_get, cached_get_json

_UA = {"User-Agent": settings.sec_user_agent}
_BROWSER = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36"}


def wikipedia_daily(title: str, days: int = 400) -> pd.Series:
    """Daily user pageviews for an English Wikipedia article (official Wikimedia API, no key)."""
    end = date.today() - timedelta(days=1)
    start = end - timedelta(days=days)
    t = quote(title.replace(" ", "_"), safe="")
    url = f"https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/{t}/daily/{start:%Y%m%d}/{end:%Y%m%d}"
    try:
        data = cached_get_json(url, namespace="wiki", key=f"{title}_{end:%Y%m%d}", ttl_hours=20, headers=_UA)
    except Exception as e:
        print(f"[attention] wikipedia {title!r}: {e}")
        return pd.Series(dtype=float)
    items = data.get("items", [])
    if not items:
        return pd.Series(dtype=float)
    s = pd.Series({pd.Timestamp(i["timestamp"][:8]): float(i["views"]) for i in items}).sort_index()
    time.sleep(0.05)
    return s


def stocktwits(symbol: str) -> Optional[dict]:
    """Watchers (a stock of attention) and message velocity (a flow) from the public symbol stream."""
    try:
        text = cached_get(f"https://api.stocktwits.com/api/2/streams/symbol/{symbol}.json", namespace="stocktwits",
                          key=f"{symbol}_{date.today():%Y%m%d}", ttl_hours=12, headers=_BROWSER)
        d = json.loads(text)
    except Exception as e:
        print(f"[attention] stocktwits {symbol}: {e}")
        return None
    sym, msgs = d.get("symbol") or {}, d.get("messages") or []
    if not msgs:
        return {"watchers": sym.get("watchlist_count"), "msgs_per_day": 0.0, "bullish_share": None}
    ts = [datetime.fromisoformat(m["created_at"].replace("Z", "+00:00")) for m in msgs]
    span_h = max((max(ts) - min(ts)).total_seconds() / 3600, 0.25)
    labelled = [((m.get("entities") or {}).get("sentiment") or {}).get("basic") for m in msgs]
    labelled = [x for x in labelled if x]
    time.sleep(0.2)
    return {"watchers": sym.get("watchlist_count"), "msgs_per_day": round(len(msgs) / span_h * 24, 1),
            "bullish_share": round(sum(1 for x in labelled if x == "Bullish") / len(labelled), 2) if labelled else None}


def apple_top_free(n: int = 100) -> list[tuple[int, str]]:
    try:
        d = cached_get_json(f"https://rss.marketingtools.apple.com/api/v2/us/apps/top-free/{n}/apps.json", namespace="apple",
                            key=f"top_free_{date.today():%Y%m%d}", ttl_hours=12)
        return [(i + 1, r["name"]) for i, r in enumerate(d["feed"]["results"])]
    except Exception as e:
        print(f"[attention] apple charts: {e}")
        return []


def github_topic(topic: str) -> Optional[dict]:
    """Repository count for a topic and stars of the top 30 (developer adoption)."""
    try:
        d = cached_get_json("https://api.github.com/search/repositories", namespace="github", key=f"{topic}_{date.today():%Y%m%d}", ttl_hours=20,
                            headers={**_UA, "Accept": "application/vnd.github+json"}, params={"q": f"topic:{topic}", "sort": "stars", "per_page": 30})
        time.sleep(6.5)  # unauthenticated search: 10 requests/minute
        return {"repos": d.get("total_count"), "top_stars": sum(r["stargazers_count"] for r in d.get("items", []))}
    except Exception as e:
        print(f"[attention] github {topic}: {e}")
        return None


def autocomplete(seed: str) -> list[str]:
    """Google's suggestion endpoint: what people are typing after a seed term (rising sub-topics)."""
    try:
        text = cached_get("https://suggestqueries.google.com/complete/search", namespace="autocomplete", key=f"{seed}_{date.today():%Y%m%d}",
                          ttl_hours=20, headers=_BROWSER, params={"client": "firefox", "q": seed, "hl": "en"}, suffix=".json")
        return [s for s in json.loads(text)[1] if s.lower() != seed.lower()][:10]
    except Exception as e:
        print(f"[attention] autocomplete {seed!r}: {e}")
        return []


def youtube_counts(query: str) -> Optional[dict]:
    """Videos published in the last 7 days vs the prior 28 (needs YOUTUBE_API_KEY; 100 quota units per call)."""
    key = getattr(settings, "youtube_api_key", None)
    if not key:
        return None
    now = datetime.now(timezone.utc)

    def count(after: datetime, before: datetime) -> Optional[int]:
        try:
            d = cached_get_json("https://www.googleapis.com/youtube/v3/search", namespace="youtube",
                                key=f"{query}_{after:%Y%m%d}_{before:%Y%m%d}", ttl_hours=20,
                                params={"part": "id", "type": "video", "q": query, "maxResults": 50, "order": "date",
                                        "publishedAfter": after.strftime("%Y-%m-%dT%H:%M:%SZ"), "publishedBefore": before.strftime("%Y-%m-%dT%H:%M:%SZ"), "key": key})
            return d.get("pageInfo", {}).get("totalResults")
        except Exception as e:
            print(f"[attention] youtube {query!r}: {e}")
            return None

    last7 = count(now - timedelta(days=7), now)
    prior28 = count(now - timedelta(days=35), now - timedelta(days=7))
    return {"last7": last7, "prior28_weekly": (prior28 / 4) if prior28 is not None else None}
