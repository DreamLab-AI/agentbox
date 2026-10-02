#!/usr/bin/env bash
# Sidechain demo witness (ADR-2103 interim receipt, amended 2026-10-02).
# Emits a JSON receipt for one agent-to-agent sidechain payment and exits
# non-zero unless every required element is present and agrees.
#
#   scripts/activation/sidechain-demo-witness.sh \
#       [--chain sidestr:<name>] --agent <hex pubkey A> --agent <hex pubkey B> \
#       --payment <txid> [--payment <txid>]... [--hitch-session <id>] [options]
#
# The first line of output is the anchoring state. Today it is
#   NOT ANCHORED: no checkpoint of sidestr:<name> exists in <parent> (checkpoints are off; ...)
# (the wording of scripts/sidechain/preflight-liquidity.sh), then
#   checkpoints=off reason="checkpoints off, cost; open" (owner decision 2026-10-02, SC5 ...)
#
# Inputs
#   --chain ID          sidestr:<name>, or the 64-hex id of its kind-3500 chain event;
#                       default sidestr:$SIDESTR_CHAIN, else the demo chain
#                       sidestr:dreamlab-txbt4 (owner SC1)
#   --agent HEX         an agent's x-only pubkey (exactly two; the Nostr key is the wallet)
#   --payment TXID      a payment transaction on the sidechain (repeatable); each must
#                       spend one agent's coin and pay the other (check P1)
#   --funding TXID      the funding transaction(s); default: what the payment spends
#   --close TXID        the close; with --hitch-session and no --close, the spender of
#                       the funding output is taken as the close
#   --hitch-session ID  a Hitch session: makes the close required, and derives the
#                       journal session URN (urn:agentbox:meta:session-<harness>-<id>)
#   --session-urn URN   the journal session URN, when it is not derived
#   --harness NAME      the harness the session was journalled under (default sidestr-agent)
#   --mirror URL        the public mirror; default: discovered from the chain signer's
#                       kind-33333 tip announcement, else the producer's own files
#                       (noted in the receipt: not re-runnable by a stranger)
#   --producer URL      the producer, read for checkpoints.json (default: the chain's
#                       loopback producer, from [sidechain.<name>].port, when it answers)
#   --relays a,b        relays to ask (default: the five the producer announces to)
#   --nostr-capture F   JSONL of signed events captured while the session ran. Kinds
#                       23500 and 23600 are NIP-01 ephemeral (20000-29999): relays
#                       forward and never store them, so a later query finds none.
#                       Every event is re-verified (id, signature) and embedded whole
#   --events-dir DIR    the journal (default $AGENTBOX_EVENTS_DIR or $WORKSPACE/events)
#   --public-only       skip the journal: what a stranger without the box can check
#   --out FILE          receipt path (default .claude/evidence/sidechain/<UTC>.json)
#
# Required elements (each a check in the receipt; any FAIL or NOT-RUN exits 1)
#   R1 sidestr-core replays the mirror's block file from genesis to a tip hash
#   R2 the mirror's blocks.json names that same hash at that height
#   S1 every payment is in the replayed chain (height, block hash, position)
#   P1 each payment spends one agent's coin and pays the other (payer, payee, amount)
#   S2 its funding is in the replayed chain
#   S3 with a Hitch session, the close is in the replayed chain
#   A1 anchoring is stated: a parent checkpoint at or above the highest height
#      cited, or "anchored": false with the owner's reason verbatim
#      ("checkpoints off, cost; open", owner decision 2026-10-02, SC5)
#   N1 a kind-33333 tip announcement by the chain signer at or above that height
#   N2, N3 kind-23500/23600 events signed by each agent key (signatures verified),
#      from the relays or --nostr-capture
#   J1 a matched started/completed journal pair for every side effect under the
#      session URN, none unpaired or orphaned (as C2 of adr-2087-check.sh);
#      waived only by --public-only, and the receipt then says so
#
# Re-running as a stranger: an agentbox checkout (for this script and the
# replay helper), node >= 22 with nostr-tools, cargo with crates.io access,
# and network access to the Pages mirror and the relays. Pass --public-only.
# The replay helper builds from scripts/activation/sidechain-witness-replay
# against crates.io sidestr-core at the exact version its Cargo.lock pins.
#
# Read-only: never signs, broadcasts or spends; reads no key file.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HELPER_DIR="$REPO/scripts/activation/sidechain-witness-replay"

usage() { sed -n '2,66p' "$0" | sed 's/^# \{0,1\}//'; }

ARGS=()
OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --out) OUT="$2"; shift 2 ;;
    --public-only) ARGS+=("$1"); shift ;;
    --*) [ $# -ge 2 ] || { echo "sidechain-demo-witness: $1 needs a value" >&2; exit 2; }
         ARGS+=("$1" "$2"); shift 2 ;;
    *) echo "sidechain-demo-witness: unexpected argument $1" >&2; usage >&2; exit 2 ;;
  esac
done

command -v node >/dev/null 2>&1 || { echo "sidechain-demo-witness: node not on PATH" >&2; exit 2; }

# The independent replay: a prebuilt helper, else build it with cargo.
REPLAY_BIN="${SIDECHAIN_REPLAY_BIN:-$HELPER_DIR/target/release/sidechain-witness-replay}"
if [ ! -x "$REPLAY_BIN" ]; then
  command -v cargo >/dev/null 2>&1 || { echo "sidechain-demo-witness: no replay helper at $REPLAY_BIN and no cargo to build it" >&2; exit 2; }
  echo "building the replay helper (crates.io sidestr-core) ..." >&2
  cargo build --release --locked --quiet --manifest-path "$HELPER_DIR/Cargo.toml" >&2
fi

[ -n "$OUT" ] || OUT="$REPO/.claude/evidence/sidechain/$(date -u +%Y%m%dT%H%M%SZ).json"

exec node "$REPO/scripts/activation/sidechain-witness.cjs" "${ARGS[@]}" --replay-bin "$REPLAY_BIN" --out "$OUT"
