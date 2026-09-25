"""Key-free news ingestion from RSS/Atom feeds (Narrative engine, Phase 2 - step 1).

Feeds: Google News topic queries, CNBC, MarketWatch, Yahoo Finance, the Federal Reserve,
WSJ Markets and FT Markets. Headlines + summaries only (no article scraping), which is
enough for claim extraction and is safe from a terms-of-use standpoint.
"""
from __future__ import annotations

import html
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Optional

import httpx

from ..config import settings

_GN = "https://news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en"
FEEDS: list[tuple[str, str]] = [
    ("CNBC Top News", "https://www.cnbc.com/id/100003114/device/rss/rss.html"),
    ("CNBC Markets", "https://www.cnbc.com/id/20910258/device/rss/rss.html"),
    ("MarketWatch Top Stories", "https://feeds.content.dowjones.io/public/rss/mw_topstories"),
    ("Yahoo Finance", "https://finance.yahoo.com/news/rssindex"),
    ("WSJ Markets", "https://feeds.a.dj.com/rss/RSSMarketsMain.xml"),
    ("FT Markets", "https://www.ft.com/markets?format=rss"),
    ("Federal Reserve", "https://www.federalreserve.gov/feeds/press_all.xml"),
    ("Google News: stock market", _GN.format(q="stock+market+when:1d")),
    ("Google News: Federal Reserve", _GN.format(q="Federal+Reserve+OR+inflation+OR+Treasury+yields+when:1d")),
    ("Google News: AI infrastructure", _GN.format(q="AI+datacenter+OR+Nvidia+OR+semiconductor+when:1d")),
    ("Google News: energy & power", _GN.format(q="oil+prices+OR+natural+gas+OR+electricity+demand+OR+nuclear+power+when:1d")),
    ("Google News: earnings", _GN.format(q="earnings+guidance+OR+raised+guidance+OR+cut+guidance+when:1d")),
    ("Google News: consumer & economy", _GN.format(q="consumer+spending+OR+jobs+report+OR+housing+market+when:1d")),
    ("Google News: geopolitics & trade", _GN.format(q="tariffs+OR+sanctions+OR+China+trade+OR+geopolitical+when:1d")),
]
_HEADERS = {"User-Agent": settings.sec_user_agent, "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8"}
_TAG_RE = re.compile(r"<[^>]+>")


def _text(el: Optional[ET.Element]) -> str:
    return html.unescape(_TAG_RE.sub("", (el.text or "") if el is not None else "")).strip()


def _parse_date(s: str) -> Optional[datetime]:
    if not s:
        return None
    try:
        return parsedate_to_datetime(s).astimezone(timezone.utc)
    except Exception:
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc)
        except Exception:
            return None


def parse_feed(xml_text: str, source: str) -> list[dict]:
    root = ET.fromstring(xml_text)
    ns = {"atom": "http://www.w3.org/2005/Atom", "media": "http://search.yahoo.com/mrss/"}
    items = []
    for it in root.iter("item"):                       # RSS 2.0
        title = _text(it.find("title"))
        link = _text(it.find("link")) or (it.find("guid").text if it.find("guid") is not None else "")
        desc = _text(it.find("description"))
        pub = _parse_date(_text(it.find("pubDate")))
        src_el = it.find("source")
        src = _text(src_el) if src_el is not None and _text(src_el) else source
        if title:
            items.append({"title": title, "url": link.strip(), "summary": desc[:400], "published": pub, "source": src, "feed": source})
    for it in root.findall(".//atom:entry", ns):     # Atom
        title = _text(it.find("atom:title", ns))
        link_el = it.find("atom:link", ns)
        link = link_el.get("href", "") if link_el is not None else ""
        desc = _text(it.find("atom:summary", ns)) or _text(it.find("atom:content", ns))
        pub = _parse_date(_text(it.find("atom:updated", ns)) or _text(it.find("atom:published", ns)))
        if title:
            items.append({"title": title, "url": link, "summary": desc[:400], "published": pub, "source": source, "feed": source})
    return items


def fetch_all(hours: int = 36) -> tuple[list[dict], list[dict]]:
    """-> (headlines newest first, per-source status). Dedupes near-identical titles."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    out, status = [], []
    with httpx.Client(headers=_HEADERS, timeout=20, follow_redirects=True) as c:
        for name, url in FEEDS:
            try:
                r = c.get(url)
                r.raise_for_status()
                items = parse_feed(r.text, name)
                fresh = [i for i in items if i["published"] is None or i["published"] >= cutoff]
                out.extend(fresh)
                status.append({"name": name, "url": url, "n": len(fresh), "ok": True})
            except Exception as e:  # noqa: PERF203
                status.append({"name": name, "url": url, "n": 0, "ok": False, "error": str(e)[:120]})
    seen: set[str] = set()
    deduped = []
    for h in sorted(out, key=lambda x: x["published"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True):
        key = re.sub(r"[^a-z0-9 ]", "", h["title"].lower())
        key = " ".join(key.split()[:9])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(h)
    return deduped, status
