#!/usr/bin/env bash
# Runner for one estate sidestr chain's producer (PRD-024 P1), [program:sidestr-producer] for
# sidestr:dreamlab (gate [sidechain].enabled) and [program:sidestr-producer-<name>] for each
# [sidechain.<name>] table (gate [sidechain.<name>].enabled, dominated by [sidechain].enabled).
# flake.nix passes --announce-mirror from the table's announce_mirror and the chain's settings as
# the environment below. Runs the upstream JS reference engine from durable checkouts under
# $WORKSPACE/sidestr/upstream against the chain's parent node. Keys and RPC credentials are files
# under /var/lib/agentbox/secrets, never arguments.
#
#   run-producer.sh [--announce-mirror https://host/path]
#
# Environment (all optional; the defaults are sidestr:dreamlab's, unchanged since 2026-09-22):
#   SIDESTR_CHAIN          the chain's name: config/sidechain/<name>/chain.json, the signer key
#                          /var/lib/agentbox/secrets/sidestr-<name>.key, state $WORKSPACE/sidestr/<name>
#   SIDESTR_UPSTREAM       checkouts of sidestr/spec, bitcoin-desktop/schema, bitcoin-blake/blaketestnode
#   SIDESTR_STATE          the chain's block file directory
#   SIDESTR_DOC            the sealed chain document
#   SIDESTR_KEY            the signer key file
#   SIDESTR_EXPECT_PARENT  the parent the manifest declares; a document naming another is a boot
#                          failure, never a silent preference for either side (ADR-2103 D3)
#   SIDESTR_PARENT_RPC     the parent node's RPC URL (LAN)
#   SIDESTR_PARENT_COOKIE  the parent RPC credential file (a node cookie, or user:password for an
#                          rpcauth user); read again by the engine on a 401
#   SIDESTR_PARENT_FROM    the parent height the peg-in scan starts from
#   SIDESTR_PARENT_WALLET  the parent wallet that pays peg-outs; empty: peg-outs are recorded, not paid
#   SIDESTR_CHECKPOINT_EVERY / SIDESTR_CHECKPOINT_WALLET
#                          write the tip into the parent every N blocks from that wallet (SPEC 11).
#                          0 (the default): no checkpoint, so nothing anchors the chain. N > 0 needs
#                          a wallet: the engine would otherwise skip every checkpoint without a word.
#   SIDESTR_PORT / SIDESTR_INTERVAL / SIDESTR_RELAYS
#   SIDESTR_ALLOW_UNPINNED=1  run an upstream checkout other than upstream-pins (upgrade tests only)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE="${WORKSPACE:-$HOME/workspace}"
NAME="${SIDESTR_CHAIN:-dreamlab}"
UP="${SIDESTR_UPSTREAM:-$WORKSPACE/sidestr/upstream}"
STATE="${SIDESTR_STATE:-$WORKSPACE/sidestr/$NAME}"
DOC="${SIDESTR_DOC:-$HERE/$NAME/chain.json}"
KEY="${SIDESTR_KEY:-/var/lib/agentbox/secrets/sidestr-$NAME.key}"
COOKIE="${SIDESTR_PARENT_COOKIE:-/var/lib/agentbox/secrets/sidestr-tbtc4.cookie}"
PARENT_RPC="${SIDESTR_PARENT_RPC:-http://192.168.2.27:48332/}"
PARENT_FROM="${SIDESTR_PARENT_FROM:-153500}"   # sidestr:dreamlab: the peg wallet was funded after this height
PARENT_WALLET="${SIDESTR_PARENT_WALLET-sidestr-peg}"
CHECKPOINT_EVERY="${SIDESTR_CHECKPOINT_EVERY:-0}"
CHECKPOINT_WALLET="${SIDESTR_CHECKPOINT_WALLET:-}"
PORT="${SIDESTR_PORT:-3450}"
INTERVAL="${SIDESTR_INTERVAL:-600}"
RELAYS="${SIDESTR_RELAYS:-wss://nos.lol,wss://relay.damus.io,wss://relay.primal.net,wss://nostr.mom,wss://nostr.oxtr.dev}"

die() { echo "run-producer[$NAME]: $*" >&2; exit 1; }

for f in "$KEY" "$COOKIE" "$DOC" "$UP/spec/siding/bin/siding.mjs" "$UP/schema/codec/kernel.js" "$UP/blaketestnode/lib/node.mjs"; do
  [ -r "$f" ] || die "missing $f"
done
# The upstream code is consensus for this chain: run only the commits recorded in upstream-pins.
PINS="$HERE/upstream-pins"
while read -r dir want _; do
  case "$dir" in ''|'#'*) continue ;; esac
  have=$(git -C "$UP/$dir" rev-parse HEAD 2>/dev/null || echo none)
  if [ "$have" != "$want" ]; then
    if [ "${SIDESTR_ALLOW_UNPINNED:-0}" = 1 ]; then
      echo "run-producer[$NAME]: WARNING $dir is at $have, pinned $want (SIDESTR_ALLOW_UNPINNED=1)" >&2
    else
      die "$UP/$dir is at $have but upstream-pins says $want; check it out or bump the pin"
    fi
  fi
done < "$PINS"

# ADR-2103 D3: the sealed document says which parent this chain sits beside; the manifest only
# repeats it. A disagreement is a boot failure.
parent="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).parent ?? ""))' "$DOC")"
if [ -n "${SIDESTR_EXPECT_PARENT:-}" ] && [ "$parent" != "$SIDESTR_EXPECT_PARENT" ]; then
  die "the manifest declares parent $SIDESTR_EXPECT_PARENT but $DOC is sealed beside $parent"
fi

# ADR-2103 D3a: a BLAKE2b fork shares its genesis, magic and port with the stock chain, so a
# wrong-branch parent view looks healthy. Beside a BLAKE2b parent, the node must return the
# fork hash at the fork height (sidestr/spec siding/lib/parents.mjs) before any block is made.
fork_height="" fork_hash=""
case "$parent" in
  txbt4|btc:testnet4-blake2b) fork_height=150308 fork_hash=000000000000b9d1b7e1bb0e77215ee92c6ef7ec8f4473e23908380649e779b6 ;;
  xbt|btc:mainnet-blake2b)    fork_height=961640 fork_hash=0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb ;;
esac
if [ -n "$fork_height" ]; then
  got="$(node - "$PARENT_RPC" "$COOKIE" "$fork_height" <<'JS'
const [url, cookieFile, height] = process.argv.slice(2);
const auth = 'Basic ' + Buffer.from(require('fs').readFileSync(cookieFile, 'utf8').trim()).toString('base64');
fetch(url, { method: 'POST', headers: { 'content-type': 'text/plain', authorization: auth },
  body: JSON.stringify({ jsonrpc: '1.0', id: 'fork-check', method: 'getblockhash', params: [Number(height)] }),
  signal: AbortSignal.timeout(20000) })
  .then(async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); const j = await r.json(); if (j.error) throw new Error(j.error.message); process.stdout.write(String(j.result)); })
  .catch((e) => { process.stderr.write(`getblockhash ${height}: ${e.message}\n`); process.exit(1); });
JS
)" || die "cannot read the parent's block at the fork height from $PARENT_RPC (exit; supervisord retries)"
  [ "$got" = "$fork_hash" ] || die "parent $PARENT_RPC is on the wrong branch: block $fork_height is $got, the $parent fork is $fork_hash"
fi

# SPEC 11 checkpoints are the only thing that anchors the chain to its parent.
extra=()
case "$CHECKPOINT_EVERY" in ''|*[!0-9]*) die "SIDESTR_CHECKPOINT_EVERY must be a whole number, not '$CHECKPOINT_EVERY'" ;; esac
if [ "$CHECKPOINT_EVERY" -gt 0 ]; then
  [ -n "$CHECKPOINT_WALLET" ] || die "SIDESTR_CHECKPOINT_EVERY=$CHECKPOINT_EVERY needs SIDESTR_CHECKPOINT_WALLET: without one the engine skips every checkpoint silently"
  extra+=(--checkpoint-every "$CHECKPOINT_EVERY" --checkpoint-wallet "$CHECKPOINT_WALLET")
else
  echo "run-producer[$NAME]: checkpoints off: no block of $NAME is anchored in $parent" >&2
fi
[ -n "$PARENT_WALLET" ] && extra+=(--parent-wallet "$PARENT_WALLET")
mkdir -p "$STATE"

exec env SCHEMA="$UP/schema" BLAKETESTNODE="$UP/blaketestnode" \
  node "$UP/spec/siding/bin/siding.mjs" produce \
    --chain "$DOC" --dir "$STATE" --key-file "$KEY" \
    --port "$PORT" --interval "$INTERVAL" --tx-interval 10 \
    --relay "$RELAYS" \
    --parent-rpc "$PARENT_RPC" --parent-cookie "$COOKIE" --parent-from "$PARENT_FROM" \
    "${extra[@]}" "$@"
