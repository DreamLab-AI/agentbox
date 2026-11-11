#!/usr/bin/env bash
# freeze_check.sh - "no frozen frames" gate. Lists every stretch where the picture stops moving.
#   bash freeze_check.sh <picture.mp4> [min_seconds=0.4] [ignore_after=<seconds>] [hud_px=90]
# The top and bottom hud_px rows are cropped out first, so corner counters do not count as motion. A hold on the end card is allowed: pass the
# time the end card starts as ignore_after. Exit 1 if anything else is frozen.
set -euo pipefail
V="$1"; D="${2:-0.4}"; IGN="${3:-999999}"; HUD="${4:-90}"
OUT=$(ffmpeg -hide_banner -i "$V" -vf "crop=iw:ih-2*$HUD:0:$HUD,freezedetect=n=0.00004:d=$D" -an -f null - 2>&1 | grep -E "freeze_(start|duration)" || true)
BAD=0; S=""
while read -r line; do
  [[ "$line" =~ freeze_start:\ ([0-9.]+) ]] && S="${BASH_REMATCH[1]}"
  if [[ "$line" =~ freeze_duration:\ ([0-9.]+) ]]; then
    if python3 -c "import sys; sys.exit(0 if float('$S') < float('$IGN') else 1)"; then echo "FROZEN  ${S}s for ${BASH_REMATCH[1]}s"; BAD=1; else echo "hold (allowed, end card)  ${S}s for ${BASH_REMATCH[1]}s"; fi
  fi
done <<< "$OUT"
[ $BAD = 0 ] && echo "freeze check OK" || { echo "freeze check FAILED: give each frozen stretch a move (a wind-up, a push, a secondary element)"; exit 1; }
