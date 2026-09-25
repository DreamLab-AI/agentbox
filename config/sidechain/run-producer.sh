#!/usr/bin/env bash
# Interim runner for the sidestr:dreamlab producer (PRD-024 P1) until the supervised
# [program:sidestr-producer] exists (ADR-2098 D3). Runs the upstream JS reference engine
# from durable checkouts under $WORKSPACE/sidestr/upstream against the estate's testnet4
# node. Keys and RPC credentials are files under /var/lib/agentbox/secrets, never arguments.
#
#   run-producer.sh [--announce-mirror https://host/path]
#
# Environment (all optional):
#   SIDESTR_UPSTREAM   checkouts of sidestr/spec, bitcoin-desktop/schema, bitcoin-blake/blaketestnode
#   SIDESTR_STATE      the chain's block file directory
#   SIDESTR_DOC        the sealed chain document
#   SIDESTR_PARENT_RPC the parent node's RPC URL (LAN, testnet4)
#   SIDESTR_ALLOW_UNPINNED=1  run an upstream checkout other than upstream-pins (upgrade tests only)
set -euo pipefail

WORKSPACE="${WORKSPACE:-$HOME/workspace}"
UP="${SIDESTR_UPSTREAM:-$WORKSPACE/sidestr/upstream}"
STATE="${SIDESTR_STATE:-$WORKSPACE/sidestr/dreamlab}"
DOC="${SIDESTR_DOC:-$(cd "$(dirname "$0")" && pwd)/dreamlab/chain.json}"
KEY=/var/lib/agentbox/secrets/sidestr-dreamlab.key
COOKIE=/var/lib/agentbox/secrets/sidestr-tbtc4.cookie
PARENT_RPC="${SIDESTR_PARENT_RPC:-http://192.168.2.27:48332/}"
PARENT_FROM="${SIDESTR_PARENT_FROM:-153500}"   # the peg wallet was funded after this height
PORT="${SIDESTR_PORT:-3450}"
INTERVAL="${SIDESTR_INTERVAL:-600}"
RELAYS="${SIDESTR_RELAYS:-wss://nos.lol,wss://relay.damus.io,wss://relay.primal.net,wss://nostr.mom,wss://nostr.oxtr.dev}"

for f in "$KEY" "$COOKIE" "$DOC" "$UP/spec/siding/bin/siding.mjs" "$UP/schema/codec/kernel.js" "$UP/blaketestnode/lib/node.mjs"; do
  [ -r "$f" ] || { echo "run-producer: missing $f" >&2; exit 1; }
done
# The upstream code is consensus for this chain: run only the commits recorded in upstream-pins.
PINS="$(cd "$(dirname "$0")" && pwd)/upstream-pins"
while read -r dir want _; do
  case "$dir" in ''|'#'*) continue ;; esac
  have=$(git -C "$UP/$dir" rev-parse HEAD 2>/dev/null || echo none)
  if [ "$have" != "$want" ]; then
    if [ "${SIDESTR_ALLOW_UNPINNED:-0}" = 1 ]; then
      echo "run-producer: WARNING $dir is at $have, pinned $want (SIDESTR_ALLOW_UNPINNED=1)" >&2
    else
      echo "run-producer: $UP/$dir is at $have but upstream-pins says $want; check it out or bump the pin" >&2; exit 1
    fi
  fi
done < "$PINS"
mkdir -p "$STATE"

exec env SCHEMA="$UP/schema" BLAKETESTNODE="$UP/blaketestnode" \
  node "$UP/spec/siding/bin/siding.mjs" produce \
    --chain "$DOC" --dir "$STATE" --key-file "$KEY" \
    --port "$PORT" --interval "$INTERVAL" --tx-interval 10 \
    --relay "$RELAYS" \
    --parent-rpc "$PARENT_RPC" --parent-cookie "$COOKIE" --parent-from "$PARENT_FROM" --parent-wallet sidestr-peg \
    "$@"
