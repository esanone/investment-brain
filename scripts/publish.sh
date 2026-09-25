#!/usr/bin/env bash
# Export the latest snapshots to static JSON and push to GitHub (Vercel rebuilds the phone-friendly site).
# Safe to run without a remote: it just exports and commits locally.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend" && .venv/bin/python -m brain.export_static
cd "$ROOT"
git add -A frontend/public/data >/dev/null 2>&1 || true
if ! git diff --cached --quiet; then
  git commit -qm "data: snapshot export $(date '+%Y-%m-%d %H:%M')" || true
fi
if git remote get-url origin >/dev/null 2>&1; then
  git push -q origin HEAD && echo "pushed to $(git remote get-url origin)"
else
  echo "no git remote configured yet; exported and committed locally"
fi
