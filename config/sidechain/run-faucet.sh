#!/usr/bin/env bash
# Runner for the sidestr:dreamlab DREAM faucet, [program:sidestr-faucet] (gate [sidechain].faucet).
# Answers kind-23501 requests from the forum's member wallets (dreamlab-ai-website, forum ADR-2015)
# with DREAM units and plain sats, once per script per window, paid from the treasury key through
# the local producer. sidestr-agent is baked into the image (lib/sidestr-agent.nix).
#
#   run-faucet.sh
#
# Environment (all optional):
#   SIDESTR_FAUCET_KEY    the treasury key file (64 hex or nsec1…), never an argument
#   SIDESTR_FAUCET_STATE  where grants are remembered across restarts
#   SIDESTR_FAUCET_ASSET / _UNITS / _SATS / _PER_ADDRESS_HOURS / _PER_HOUR   the grant policy
#   SIDESTR_PORT          the local producer's port
set -euo pipefail

WORKSPACE="${WORKSPACE:-$HOME/workspace}"
KEY="${SIDESTR_FAUCET_KEY:-$WORKSPACE/sidestr/agents/treasury.key}"
STATE="${SIDESTR_FAUCET_STATE:-$WORKSPACE/sidestr/agents/faucet.json}"
PRODUCER="http://127.0.0.1:${SIDESTR_PORT:-3450}"

[ -r "$KEY" ] || { echo "run-faucet: missing $KEY" >&2; exit 1; }
command -v sidestr-agent >/dev/null || { echo "run-faucet: sidestr-agent not on PATH" >&2; exit 1; }

# Grants spend through the producer: wait for it rather than burn supervisor retries at boot.
until curl -fs --max-time 5 -o /dev/null "$PRODUCER/tip"; do
  echo "run-faucet: waiting for the producer at $PRODUCER" >&2; sleep 15
done

exec sidestr-agent --url "$PRODUCER" --key-file "$KEY" faucet \
  --asset "${SIDESTR_FAUCET_ASSET:-DREAM}" --units "${SIDESTR_FAUCET_UNITS:-100}" \
  --sats "${SIDESTR_FAUCET_SATS:-1000}" \
  --per-address-hours "${SIDESTR_FAUCET_PER_ADDRESS_HOURS:-24}" \
  --per-hour "${SIDESTR_FAUCET_PER_HOUR:-20}" \
  --state "$STATE"
