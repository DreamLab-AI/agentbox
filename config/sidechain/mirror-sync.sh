#!/usr/bin/env bash
# Interim mirror for sidestr:dreamlab (SPEC 11): copies the producer's chain.json, blocks.dat
# and blocks.json into a GitHub Pages checkout and pushes when they changed. GitHub Pages
# serves them with open CORS and Range support, which is all a mirror is. Replace with the
# supervised mirror on :9097 behind the nip98 proxy (ADR-2098 D3) when that exists.
#
#   mirror-sync.sh <pages checkout> [interval seconds, default 120]
set -euo pipefail

WORKSPACE="${WORKSPACE:-$HOME/workspace}"
STATE="${SIDESTR_STATE:-$WORKSPACE/sidestr/dreamlab}"
PRODUCER="${SIDESTR_PRODUCER_URL:-http://127.0.0.1:${SIDESTR_PORT:-3450}}"
PAGES="${1:?pages checkout}"; EVERY="${2:-120}"

while :; do
  if curl -fsS --max-time 10 "$PRODUCER/chain.json" -o "$PAGES/chain.json.tmp" 2>/dev/null; then
    mv "$PAGES/chain.json.tmp" "$PAGES/chain.json"
  fi
  cp -f "$STATE/blocks.dat" "$PAGES/blocks.dat"; cp -f "$STATE/blocks.json" "$PAGES/blocks.json"
  if ! git -C "$PAGES" diff --quiet -- chain.json blocks.dat blocks.json || [ -n "$(git -C "$PAGES" ls-files --others --exclude-standard)" ]; then
    tip="$(python3 -c 'import json,sys; i=json.load(open(sys.argv[1])); print(i.get("to"))' "$PAGES/blocks.json")"
    git -C "$PAGES" add chain.json blocks.dat blocks.json
    git -C "$PAGES" commit -q -m "mirror: tip $tip" && git -C "$PAGES" push -q origin HEAD 2>/dev/null \
      && echo "$(date -u +%H:%M:%S) pushed tip $tip" || echo "$(date -u +%H:%M:%S) push failed; will retry"
  fi
  sleep "$EVERY"
done
