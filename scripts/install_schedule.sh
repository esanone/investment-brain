#!/usr/bin/env bash
# Installs the weekday 06:15 morning job as a macOS LaunchAgent (runs when the Mac is awake and you are logged in).
# Undo with:  launchctl bootout gui/$(id -u)/com.investmentbrain.morning
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)/launchd/com.investmentbrain.morning.plist"
DST="$HOME/Library/LaunchAgents/com.investmentbrain.morning.plist"
mkdir -p "$HOME/Library/LaunchAgents"
cp "$SRC" "$DST"
launchctl bootout "gui/$(id -u)/com.investmentbrain.morning" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DST"
launchctl print "gui/$(id -u)/com.investmentbrain.morning" | grep -E "state|last exit" || true
echo "Installed. To keep the Mac awake for it: sudo pmset repeat wakeorpoweron MTWRF 06:10:00"
