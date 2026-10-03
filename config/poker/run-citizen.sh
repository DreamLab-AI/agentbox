#!/usr/bin/env bash
# Runner for [program:poker-citizen]: the forum poker table's house seat
# (nostr-rust-forum `nostr-bbs-poker-citizen`, forum ADR-2020). Deals DREAM
# hands to members over the forum relay, plays the house bot, settles each
# hand on sidestr:dreamlab through the local producer. Gate: [poker_citizen].enabled.
# The binary is baked (lib/poker-citizen.nix), never built from the workspace.
#
#   run-citizen.sh
#
# Environment (all optional; the defaults are DreamLab's):
#   POKER_CITIZEN_KEY_FILE  the house key file (64 hex or nsec1…), never an argument
#   POKER_CITIZEN_RELAY     the forum relay (wss://…)
#   POKER_CITIZEN_STATE     the ledger file (what members owe, what the house owes)
#   POKER_STAKES_BB / POKER_BUYIN_BB / POKER_BOT_PROFILE / POKER_DAILY_CAP
#   SIDESTR_PORT            the local producer's port
set -euo pipefail

WORKSPACE="${WORKSPACE:-$HOME/workspace}"
KEY="${POKER_CITIZEN_KEY_FILE:-$WORKSPACE/sidestr/agents/poker-citizen.key}"
STATE="${POKER_CITIZEN_STATE:-$WORKSPACE/sidestr/agents/poker-citizen.json}"
RELAY="${POKER_CITIZEN_RELAY:-wss://dreamlab-nostr-relay.solitary-paper-764d.workers.dev}"
PRODUCER="http://127.0.0.1:${SIDESTR_PORT:-3450}"

[ -r "$KEY" ] || { echo "run-citizen: missing $KEY" >&2; exit 1; }
command -v nostr-bbs-poker-citizen >/dev/null || { echo "run-citizen: nostr-bbs-poker-citizen not on PATH" >&2; exit 1; }

# Settlements spend through the producer: wait for it rather than burn supervisor retries at boot.
until curl -fs --max-time 5 -o /dev/null "$PRODUCER/tip"; do
  echo "run-citizen: waiting for the producer at $PRODUCER" >&2; sleep 15
done

exec nostr-bbs-poker-citizen \
  --key-file "$KEY" \
  --relay "$RELAY" \
  --producer "$PRODUCER" \
  --state "$STATE" \
  --stakes-bb "${POKER_STAKES_BB:-2,10,20,100,200}" \
  --buyin-bb "${POKER_BUYIN_BB:-100}" \
  --profile "${POKER_BOT_PROFILE:-tag}" \
  --daily-cap "${POKER_DAILY_CAP:-20000}"
