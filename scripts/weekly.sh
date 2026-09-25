#!/usr/bin/env bash
# Weekly recalibration: refresh data, recompute every engine, re-evaluate each holding's
# frozen thesis-break rules, rebuild the portfolio and write the LLM memo.
# Run by hand (Monday morning) or from cron / launchd:
#   0 7 * * 1  /path/to/investment-brain/scripts/weekly.sh >> /path/to/investment-brain/backend/data/weekly.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/../backend"
echo "=== weekly recalibration $(date) ==="
.venv/bin/python -m brain.pipeline run
echo "=== done $(date) ==="
