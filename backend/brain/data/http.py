"""Tiny HTTP + disk-cache helper shared by the fetchers."""
from __future__ import annotations

import hashlib
import json
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import httpx

from ..config import settings


def _cache_path(namespace: str, key: str, suffix: str) -> Path:
    d = settings.cache_dir / namespace
    d.mkdir(parents=True, exist_ok=True)
    safe = key.replace("/", "_").replace("^", "_")
    if len(safe) > 80:
        safe = hashlib.sha1(key.encode()).hexdigest()
    return d / f"{safe}{suffix}"


def cached_get(url: str, *, namespace: str, key: str, ttl_hours: float, headers: dict | None = None,
               params: dict | None = None, suffix: str = ".json", retries: int = 3) -> str:
    """GET with an on-disk cache. Returns response text."""
    p = _cache_path(namespace, key, suffix)
    if p.exists():
        age = datetime.now() - datetime.fromtimestamp(p.stat().st_mtime)
        if age < timedelta(hours=ttl_hours):
            return p.read_text()
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            with httpx.Client(timeout=settings.http_timeout, follow_redirects=True) as c:
                r = c.get(url, headers=headers, params=params)
                if r.status_code == 429 or r.status_code >= 500:
                    raise httpx.HTTPStatusError(f"{r.status_code}", request=r.request, response=r)
                r.raise_for_status()
                p.write_text(r.text)
                return r.text
        except (httpx.HTTPError, httpx.TransportError) as e:  # noqa: PERF203
            last_err = e
            time.sleep(1.5 * (attempt + 1))
    if p.exists():  # stale cache beats no data
        return p.read_text()
    raise RuntimeError(f"GET {url} failed: {last_err}")


def cached_get_json(url: str, **kw: Any) -> Any:
    return json.loads(cached_get(url, **kw))
