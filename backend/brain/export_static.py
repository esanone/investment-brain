"""Dump every read endpoint of the API to JSON files so the dashboard can be built as a static
site (Vercel) that works on a phone without a running backend:

    python -m brain.export_static [--out ../frontend/public/data]

Files mirror the API paths: /api/overview -> api/overview.json, /api/companies/NVDA -> api/companies/NVDA.json,
prices as api/prices/NVDA__1y_1d.json and api/prices/NVDA__5y_1w.json.
"""
from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from fastapi.testclient import TestClient

from .api import app


def _write(root: Path, rel: str, obj) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, separators=(",", ":"), default=str))


def export(out: Path) -> dict:
    c = TestClient(app)
    api = out / "api"
    if api.exists():
        shutil.rmtree(api)
    counts = {"files": 0, "failed": []}

    def get(path: str, rel: str) -> object:
        r = c.get(path)
        if r.status_code != 200:
            counts["failed"].append((path, r.status_code))
            return None
        _write(out, rel, r.json())
        counts["files"] += 1
        return r.json()

    for ep in ("health", "overview", "regime", "flows", "risk", "runs", "themes", "companies", "portfolio", "portfolio/history",
               "brief", "brief/history", "attention", "thesis", "thesis/history"):
        get(f"/api/{ep}", f"api/{ep}.json")
    themes = c.get("/api/themes").json() if c.get("/api/themes").status_code == 200 else []
    for t in themes:
        get(f"/api/themes/{t['id']}", f"api/themes/{t['id']}.json")
    companies = c.get("/api/companies").json() if c.get("/api/companies").status_code == 200 else []
    for row in companies:
        tk = row["ticker"]
        get(f"/api/companies/{tk}", f"api/companies/{tk}.json")
        get(f"/api/prices/{tk}?range=1y&interval=1d", f"api/prices/{tk}__1y_1d.json")
        get(f"/api/prices/{tk}?range=5y&interval=1w", f"api/prices/{tk}__5y_1w.json")
    _write(out, "api/_manifest.json", {"files": counts["files"], "companies": len(companies), "themes": len(themes),
                                       "generated_at": __import__("datetime").datetime.now().isoformat(timespec="seconds")})
    return counts


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path(__file__).resolve().parent.parent.parent / "frontend" / "public" / "data"))
    a = ap.parse_args()
    out = Path(a.out)
    counts = export(out)
    size = sum(p.stat().st_size for p in out.rglob("*.json")) / 1e6
    print(f"exported {counts['files']} files ({size:.1f} MB) to {out}; failed: {counts['failed'][:5]}")


if __name__ == "__main__":
    main()
