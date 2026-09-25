#!/usr/bin/env bash
# Every weekday morning: read the news, write the brief (claims, market thesis, human-behaviour shifts,
# theme/ticker signals), then recalibrate the portfolio with today's narrative folded in.
#   30 6 * * 1-5  /path/to/investment-brain/scripts/morning.sh >> /path/to/investment-brain/backend/data/morning.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/../backend"
echo "=== morning $(date) ==="
.venv/bin/python -m brain.pipeline morning
cd "$(dirname "$0")" && ./publish.sh || echo "publish step skipped"
echo "=== done $(date) ==="
