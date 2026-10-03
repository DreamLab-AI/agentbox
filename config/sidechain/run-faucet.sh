#!/usr/bin/env bash
# Runner for one estate chain's faucet: [program:sidestr-faucet] for sidestr:dreamlab (gate
# [sidechain].faucet; DREAM units and sats) and [program:sidestr-faucet-<name>] for each
# [sidechain.<name>] table (plain sats; SIDESTR_FAUCET_ASSET set empty). Answers kind-23501
# requests from member wallets (dreamlab-ai-website, forum ADR-2015) for this chain only, once
# per script per window, paid from the chain's treasury key through the local producer.
# sidestr-agent is baked into the image (lib/sidestr-agent.nix) and serves a chain beside a
# stock-header parent. A chain beside a BLAKE2b parent (txbt4, xbt) is served instead by
# nostr-bbs-sidestr-admin's faucet (forum kit, baked by lib/poker-citizen.nix): sidestr-agent's
# replay cannot read Blake2bV2 headers. Same flags, same request protocol, same grant ledger.
#
#   run-faucet.sh
#
# Environment (all optional; the defaults are sidestr:dreamlab's):
#   SIDESTR_CHAIN         the chain's name; picks the default key and grant ledger below
#   SIDESTR_FAUCET_KEY    the treasury key file (64 hex or nsec1…), never an argument
#                         (dreamlab: agents/treasury.key; another chain: agents/treasury-<name>.key)
#   SIDESTR_FAUCET_STATE  where grants are remembered across restarts (one ledger per chain)
#   SIDESTR_FAUCET_ASSET  the asset granted beside the sats; set empty for sats only
#   SIDESTR_FAUCET_UNITS / _SATS / _PER_ADDRESS_HOURS / _PER_HOUR   the grant policy
#   SIDESTR_PORT          the local producer's port
set -euo pipefail

WORKSPACE="${WORKSPACE:-$HOME/workspace}"
NAME="${SIDESTR_CHAIN:-dreamlab}"
if [ "$NAME" = dreamlab ]; then
  KEY="${SIDESTR_FAUCET_KEY:-$WORKSPACE/sidestr/agents/treasury.key}"
  STATE="${SIDESTR_FAUCET_STATE:-$WORKSPACE/sidestr/agents/faucet.json}"
else
  KEY="${SIDESTR_FAUCET_KEY:-$WORKSPACE/sidestr/agents/treasury-$NAME.key}"
  STATE="${SIDESTR_FAUCET_STATE:-$WORKSPACE/sidestr/agents/faucet-$NAME.json}"
fi
# Custody W4: under [security].role_isolation the grant ledger is on the agentbox-events volume,
# owned by this faucet's role (its HOME is on the /run/secrets tmpfs: a workspace-default ledger
# would be empty every boot and re-grant every claimant). Seeded once from the workspace ledger,
# which stays. Flag off again with a custody ledger longer than the workspace one: refuse, since
# the workspace ledger has forgotten grants made under the flag.
CUSTODY_LEDGER="${SIDESTR_CUSTODY_ROOT:-/var/lib/agentbox/events/sidestr}/faucet-$NAME/faucet.json"
if [ "${AGENTBOX_ROLE_ISOLATION:-0}" = 1 ]; then
  [ -n "${SIDESTR_FAUCET_STATE:-}" ] || STATE="$CUSTODY_LEDGER"
  umask 027
elif [ -z "${SIDESTR_FAUCET_STATE:-}" ] && [ -r "$CUSTODY_LEDGER" ] \
     && [ "$(stat -c %s "$CUSTODY_LEDGER")" -gt "$(stat -c %s "$STATE" 2>/dev/null || echo 0)" ]; then
  echo "run-faucet[$NAME]: CUSTODY-STATE-AHEAD: $CUSTODY_LEDGER is longer than $STATE (grants made under role_isolation). Refusing to re-grant: copy it over $STATE, or set SIDESTR_FAUCET_STATE." >&2
  exit 1
fi
PRODUCER="http://127.0.0.1:${SIDESTR_PORT:-3450}"
ASSET="${SIDESTR_FAUCET_ASSET-DREAM}"   # unset: DREAM; set empty: sats only

[ -r "$KEY" ] || { echo "run-faucet[$NAME]: missing $KEY" >&2; exit 1; }

# The header family decides the faucet: read the parent from the sealed chain document, as
# run-producer.sh does. An unreadable document is a boot failure, not a guess.
HERE="$(cd "$(dirname "$0")" && pwd)"
DOC="${SIDESTR_DOC:-$HERE/$NAME/chain.json}"
[ -r "$DOC" ] || { echo "run-faucet[$NAME]: missing $DOC" >&2; exit 1; }
read -r CHAIN_ID PARENT < <(node -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); process.stdout.write(`${c.id ?? ""} ${c.parent ?? ""}\n`)' "$DOC") && [ -n "$CHAIN_ID" ] \
  || { echo "run-faucet[$NAME]: $DOC is not a chain document" >&2; exit 1; }
case "$PARENT" in
  txbt4|btc:testnet4-blake2b|xbt|btc:mainnet-blake2b) FAUCET=(nostr-bbs-sidestr-admin --url "http://127.0.0.1:${SIDESTR_PORT:-3450}" --chain-id "$CHAIN_ID" --key-file "$KEY" faucet) ;;
  *) FAUCET=(sidestr-agent --url "http://127.0.0.1:${SIDESTR_PORT:-3450}" --key-file "$KEY" faucet) ;;
esac
command -v "${FAUCET[0]}" >/dev/null || { echo "run-faucet[$NAME]: ${FAUCET[0]} not on PATH (parent $PARENT)" >&2; exit 1; }

# Grants spend through the producer: wait for it rather than burn supervisor retries at boot.
until curl -fs --max-time 5 -o /dev/null "$PRODUCER/tip"; do
  echo "run-faucet[$NAME]: waiting for the producer at $PRODUCER" >&2; sleep 15
done

asset=()
[ -n "$ASSET" ] && asset=(--asset "$ASSET" --units "${SIDESTR_FAUCET_UNITS:-100}")
echo "run-faucet[$NAME]: ${FAUCET[0]} for $CHAIN_ID beside $PARENT" >&2
exec "${FAUCET[@]}" \
  "${asset[@]}" \
  --sats "${SIDESTR_FAUCET_SATS:-1000}" \
  --per-address-hours "${SIDESTR_FAUCET_PER_ADDRESS_HOURS:-24}" \
  --per-hour "${SIDESTR_FAUCET_PER_HOUR:-20}" \
  --state "$STATE"
