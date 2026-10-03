#!/usr/bin/env bash
# Runner for one estate sidestr chain's producer (PRD-024 P1), [program:sidestr-producer] for
# sidestr:dreamlab (gate [sidechain].enabled) and [program:sidestr-producer-<name>] for each
# [sidechain.<name>] table (gate [sidechain.<name>].enabled, dominated by [sidechain].enabled).
# flake.nix passes --announce-mirror from the table's announce_mirror and the chain's settings as
# the environment below. Runs the upstream JS reference engine against the chain's parent node.
# Keys and RPC credentials are files under /var/lib/agentbox/secrets, never arguments.
#
# Which upstream runs (custody W5, design §2.7, owner Q7). The upstream code is consensus for the
# chain and the producer holds the chain's signing key, so by default it runs only code its own user
# cannot modify: the image's bake of the commits in upstream-pins (lib/sidestr-upstream.nix, linked
# at /opt/agentbox/sidestr/upstream, a read-only /nix/store tree). Each baked directory carries
# .pin-commit, written at build time; one that differs from upstream-pins is a stale bake and the
# runner refuses, as it does when any file in the bake is writable. A workspace checkout runs only
# under SIDESTR_ALLOW_UNPINNED=1, and every start then logs SIDESTR-UNPINNED. This default holds
# whether or not [security].role_isolation is on.
#
#   run-producer.sh [--announce-mirror https://host/path]
#
# Environment (all optional; the defaults are sidestr:dreamlab's, unchanged since 2026-09-22):
#   SIDESTR_CHAIN          the chain's name: config/sidechain/<name>/chain.json, the signer key
#                          /var/lib/agentbox/secrets/sidestr-<name>.key, state $WORKSPACE/sidestr/<name>
#   SIDESTR_UPSTREAM_BAKED the baked sidestr/spec, bitcoin-desktop/schema, bitcoin-blake/blaketestnode
#                          (default /opt/agentbox/sidestr/upstream)
#   SIDESTR_UPSTREAM       checkouts of the same three; read only under SIDESTR_ALLOW_UNPINNED=1
#                          (default $WORKSPACE/sidestr/upstream)
#   SIDESTR_STATE          the chain's block file directory (default: the workspace path above;
#                          /var/lib/agentbox/events/sidestr/<name> under [security].role_isolation)
#   SIDESTR_DOC            the sealed chain document
#   SIDESTR_KEY            the signer key file
#   SIDESTR_EXPECT_PARENT  the parent the manifest declares; a document naming another is a boot
#                          failure, never a silent preference for either side (ADR-2103 D3)
#   SIDESTR_PARENT_RPC     the parent node's RPC URL (LAN)
#   SIDESTR_PARENT_COOKIE  the parent RPC credential file (a node cookie, or user:password for an
#                          rpcauth user); read again by the engine on a 401
#   SIDESTR_PARENT_FROM    the parent height the peg-in scan starts from
#   SIDESTR_PARENT_WALLET  the parent wallet that pays peg-outs; empty: peg-outs are recorded, not paid
#   SIDESTR_PEG_SCRIPT     an output script hex announced as the peg (SPEC 6 Level 2) for a chain with no parent wallet
#   SIDESTR_CHECKPOINT_EVERY / SIDESTR_CHECKPOINT_WALLET
#                          write the tip into the parent every N blocks from that wallet (SPEC 11).
#                          0 (the default): no checkpoint, so nothing anchors the chain. N > 0 needs
#                          a wallet: the engine would otherwise skip every checkpoint without a word.
#   SIDESTR_PORT / SIDESTR_INTERVAL / SIDESTR_RELAYS
#   SIDESTR_ALLOW_UNPINNED=1  run the SIDESTR_UPSTREAM checkout instead of the bake, at any commit
#                          (upgrade tests only; logs SIDESTR-UNPINNED)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE="${WORKSPACE:-$HOME/workspace}"
NAME="${SIDESTR_CHAIN:-dreamlab}"
# Custody W4 (ADR-2122): under [security].role_isolation the state lives on the agentbox-events
# volume, owned by this chain's role (group devuser, so the mirror reads it); the role's HOME is on
# the /run/secrets tmpfs, so the workspace default would restart the chain every boot. The entrypoint
# seeds it once from the workspace copy, which stays. With the flag off again, a custody copy that
# has grown past the workspace copy means blocks were made under the flag: starting from the
# workspace would fork the chain, so refuse and say how to recover.
CUSTODY_STATE="${SIDESTR_CUSTODY_ROOT:-/var/lib/agentbox/events/sidestr}/$NAME"
if [ "${AGENTBOX_ROLE_ISOLATION:-0}" = 1 ]; then
  STATE="${SIDESTR_STATE:-$CUSTODY_STATE}"
  umask 027
else
  STATE="${SIDESTR_STATE:-$WORKSPACE/sidestr/$NAME}"
  if [ -z "${SIDESTR_STATE:-}" ] && [ -r "$CUSTODY_STATE/blocks.dat" ] \
     && [ "$(stat -c %s "$CUSTODY_STATE/blocks.dat")" -gt "$(stat -c %s "$STATE/blocks.dat" 2>/dev/null || echo 0)" ]; then
    echo "run-producer[$NAME]: CUSTODY-STATE-AHEAD: $CUSTODY_STATE/blocks.dat is longer than $STATE/blocks.dat (blocks made under role_isolation). Refusing to fork: copy the custody state into $STATE, or set SIDESTR_STATE=$CUSTODY_STATE." >&2
    exit 1
  fi
fi
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

PINS="$HERE/upstream-pins"
if [ "${SIDESTR_ALLOW_UNPINNED:-0}" = 1 ]; then
  UP="${SIDESTR_UPSTREAM:-$WORKSPACE/sidestr/upstream}"
  echo "run-producer[$NAME]: SIDESTR-UNPINNED: running consensus code from the writable checkout $UP, not the baked pins (SIDESTR_ALLOW_UNPINNED=1; upgrade tests only)" >&2
  while read -r dir want _; do
    case "$dir" in ''|'#'*) continue ;; esac
    have=$(git -C "$UP/$dir" rev-parse HEAD 2>/dev/null || echo none)
    dirty=""
    [ -n "$(git -C "$UP/$dir" status --porcelain --untracked-files=no 2>/dev/null)" ] && dirty=" with uncommitted edits"
    if [ "$have" != "$want" ] || [ -n "$dirty" ]; then
      echo "run-producer[$NAME]: SIDESTR-UNPINNED: $dir is at $have$dirty, pinned $want" >&2
    fi
  done < "$PINS"
else
  [ -z "${SIDESTR_UPSTREAM:-}" ] || die "SIDESTR_UPSTREAM=$SIDESTR_UPSTREAM names a checkout; a checkout runs only under SIDESTR_ALLOW_UNPINNED=1"
  UP="${SIDESTR_UPSTREAM_BAKED:-/opt/agentbox/sidestr/upstream}"
  [ -d "$UP/" ] || die "no baked upstream at $UP (this image does not ship one); rebuild, or run a checkout with SIDESTR_ALLOW_UNPINNED=1"
  while read -r dir want _; do
    case "$dir" in ''|'#'*) continue ;; esac
    have=$(cat "$UP/$dir/.pin-commit" 2>/dev/null || echo none)
    [ "$have" = "$want" ] || die "stale bake: $UP/$dir records $have but upstream-pins says $want; rebuild the image"
  done < "$PINS"
  # The bake is the producer's guarantee only while its user cannot change it.
  w="$(find "$UP/" -writable -print -quit 2>/dev/null)"
  [ -z "$w" ] || die "$w is writable by $(id -un); the baked upstream must be immutable to the producer"
fi
for f in "$KEY" "$COOKIE" "$DOC" "$UP/spec/siding/bin/siding.mjs" "$UP/schema/codec/kernel.js" "$UP/blaketestnode/lib/node.mjs"; do
  [ -r "$f" ] || die "missing $f"
done
# siding loads ethereumjs lazily, only for a chain whose document names the evm rule, so a missing
# package would surface blocks later. The bake carries no node_modules (no estate chain names the
# rule; lib/sidestr-upstream.nix): refuse such a chain here instead.
if node -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.exit((c.rules ?? []).some((r) => (typeof r === "string" ? r : r.name) === "evm") ? 0 : 1)' "$DOC"; then
  [ -d "$UP/spec/siding/node_modules/@ethereumjs/vm" ] || die "$DOC names the evm rule but $UP/spec/siding has no @ethereumjs packages"
fi

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
# SPEC 6 Level 2 for a single-signer chain: announce this output script as the peg and credit deposits
# paying it, with no parent wallet (peg-outs recorded, not paid). sidestr:dreamlab-txbt4 passes its challenge.
[ -n "${SIDESTR_PEG_SCRIPT:-}" ] && extra+=(--peg-script "$SIDESTR_PEG_SCRIPT")
# SPEC 0.0.5: the chain's published kind-3500 event (siding chain-event). The document lives in the
# read-only image, so the event sits in the writable state dir; produce verifies it and announces its
# id as the chain hash (`e` tag) with every tip. sidestr:dreamlab = 44eb8c91..., published 2026-10-03.
[ -f "$STATE/chain-event.json" ] && extra+=(--chain-event "$STATE/chain-event.json")
mkdir -p "$STATE"

exec env SCHEMA="$UP/schema" BLAKETESTNODE="$UP/blaketestnode" \
  node "$UP/spec/siding/bin/siding.mjs" produce \
    --chain "$DOC" --dir "$STATE" --key-file "$KEY" \
    --port "$PORT" --interval "$INTERVAL" --tx-interval 10 \
    --relay "$RELAYS" \
    --parent-rpc "$PARENT_RPC" --parent-cookie "$COOKIE" --parent-from "$PARENT_FROM" \
    "${extra[@]}" "$@"
