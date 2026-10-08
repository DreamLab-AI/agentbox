#!/usr/bin/env bash
# Mirror for one estate chain (SPEC 11): [program:sidestr-mirror] for sidestr:dreamlab (gate
# [sidechain].mirror) and [program:sidestr-mirror-<name>] for each [sidechain.<name>] table. Copies
# the producer's chain.json, blocks.dat and blocks.json into a Git checkout and pushes
# when they changed. GitHub's raw file endpoint serves them with open CORS and Range support,
# without starting a Pages build for every block. The loopback mirror on :9097 behind
# the nip98 proxy (ADR-2098 D3) is still unbuilt.
#
# chain-event.json (SPEC 0.0.5 section 3, ADR-2098 amended 2026-10-02): the chain document as a
# signed kind-3500 event, whose id is the chain's hash. A client that has the hash from a tip's
# `e` tag reads it from a mirror's chain-event.json when no relay has it. It is copied when it
# exists beside the chain document (where `siding chain-event` writes it and the producer reads
# it) and is absent today, which is not an error. It is copied only into a checkout that has none:
# a chain's hash never changes, so a different event over a published one is refused, never
# swapped in. The checks here are structural (kind, id shape, alias against chain.json); the
# signature is checked by every client that reads it.
#
#   mirror-sync.sh <git checkout> [interval seconds, default 120]
#
# Environment: SIDESTR_CHAIN (default dreamlab) names the chain; SIDESTR_STATE, SIDESTR_DOC and
# SIDESTR_PORT / SIDESTR_PRODUCER_URL override what it implies. One checkout per chain: this loop
# never pulls, so a second writer on the same repository would wedge every later push.
set -euo pipefail

WORKSPACE="${WORKSPACE:-$HOME/workspace}"
NAME="${SIDESTR_CHAIN:-dreamlab}"
# Custody W4: under [security].role_isolation the producer's state is on the agentbox-events
# volume, owned by its role with group devuser (2750); this devuser loop reads it through the group.
if [ "${AGENTBOX_ROLE_ISOLATION:-0}" = 1 ]; then STATE="${SIDESTR_STATE:-${SIDESTR_CUSTODY_ROOT:-/var/lib/agentbox/events/sidestr}/$NAME}"
else STATE="${SIDESTR_STATE:-$WORKSPACE/sidestr/$NAME}"; fi
PRODUCER="${SIDESTR_PRODUCER_URL:-http://127.0.0.1:${SIDESTR_PORT:-3450}}"
DOC="${SIDESTR_DOC:-$(cd "$(dirname "$0")" && pwd)/$NAME/chain.json}"
# Beside the document first; the image's document dir is read-only, so the event normally sits in
# the writable state dir (where run-producer also reads it).
CHAIN_EVENT="${SIDESTR_CHAIN_EVENT:-$(dirname "$DOC")/chain-event.json}"
[ -z "${SIDESTR_CHAIN_EVENT:-}" ] && [ ! -f "$CHAIN_EVENT" ] && CHAIN_EVENT="$STATE/chain-event.json"
PAGES="${1:?pages checkout}"; EVERY="${2:-120}"
refused=""

# Copy chain-event.json into the checkout when it is there to copy and the checkout has none.
sync_chain_event() {
  [ -f "$CHAIN_EVENT" ] || return 0
  local alias have want
  alias="$(jq -r '.id // empty' "$PAGES/chain.json" 2>/dev/null || true)"
  want="$(jq -r --arg alias "$alias" '
    select(.kind == 3500
      and (.id | type == "string" and test("^[0-9a-f]{64}$"))
      and (.pubkey | type == "string" and test("^[0-9a-f]{64}$"))
      and (.sig | type == "string" and test("^[0-9a-f]{128}$"))
      and ($alias != "")
      and ((.content | fromjson | .id) == $alias)) | .id' "$CHAIN_EVENT" 2>/dev/null || true)"
  if [ -z "$want" ]; then
    [ "$refused" = "malformed" ] || echo "$(date -u +%H:%M:%S) $CHAIN_EVENT is not a kind-3500 event for ${alias:-the chain in chain.json}; not mirrored" >&2
    refused=malformed; return 0
  fi
  if [ -f "$PAGES/chain-event.json" ]; then
    have="$(jq -r '.id // empty' "$PAGES/chain-event.json" 2>/dev/null || true)"
    if [ "$have" != "$want" ] && [ "$refused" != "$want" ]; then
      echo "$(date -u +%H:%M:%S) the mirror already serves chain event ${have:-(unreadable)}; refusing to replace it with $want" >&2
      refused="$want"
    fi
    return 0
  fi
  cp -f "$CHAIN_EVENT" "$PAGES/chain-event.json.tmp" && mv "$PAGES/chain-event.json.tmp" "$PAGES/chain-event.json"
  refused=""
}

while :; do
  if curl -fsS --max-time 10 "$PRODUCER/chain.json" -o "$PAGES/chain.json.tmp" 2>/dev/null; then
    mv "$PAGES/chain.json.tmp" "$PAGES/chain.json"
  fi
  cp -f "$STATE/blocks.dat" "$PAGES/blocks.dat"; cp -f "$STATE/blocks.json" "$PAGES/blocks.json"
  sync_chain_event
  files=(chain.json blocks.dat blocks.json)
  [ -f "$PAGES/chain-event.json" ] && files+=(chain-event.json)
  if ! git -C "$PAGES" diff --quiet -- "${files[@]}" || [ -n "$(git -C "$PAGES" ls-files --others --exclude-standard -- "${files[@]}")" ]; then
    tip="$(jq -r '.to' "$PAGES/blocks.json")"
    git -C "$PAGES" add -- "${files[@]}"
    git -C "$PAGES" commit -q -m "mirror: tip $tip" --only -- "${files[@]}"
  fi
  # A successful commit followed by a failed push leaves a clean tree. Retry
  # that outstanding commit even when the producer has not made another block.
  if [ -n "$(git -C "$PAGES" log --format=%H '@{upstream}..HEAD')" ]; then
    git -C "$PAGES" push -q origin HEAD 2>/dev/null \
      && echo "$(date -u +%H:%M:%S) mirror synchronized" || echo "$(date -u +%H:%M:%S) push failed; will retry"
  fi
  sleep "$EVERY"
done
