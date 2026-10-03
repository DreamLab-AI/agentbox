#!/usr/bin/env bash
# Runner for the practice table's coach (kit crate nostr-bbs-poker-citizen,
# binary nostr-bbs-poker-coach), [program:poker-coach], gate [poker_coach].enabled.
# The coach answers the table's [poker-coach] DMs from an OpenAI-compatible
# model, on its own key. It holds no funds and deals nothing, so it needs no
# producer. Keys are files, never arguments: the Nostr key at
# POKER_COACH_KEY_FILE, an optional model bearer token at
# POKER_COACH_LLM_KEY_FILE (read into the environment the binary alone sees).
#
# Environment (flake.nix bakes these from [poker_coach]):
#   POKER_COACH_KEY_FILE     the coach's Nostr key (64 hex or nsec1…)
#   POKER_COACH_RELAY        the forum relay
#   POKER_COACH_LLM_URL      the model's OpenAI-compatible base URL (…/v1)
#   POKER_COACH_MODEL        the model name
#   POKER_COACH_LLM_EXTRA_FILE  a JSON object merged into every request
#                            (default: the coach-llm.json beside this script)
#   POKER_COACH_LLM_KEY_FILE a bearer token for the model, if it needs one
#   POKER_COACH_MAX_TOKENS / POKER_COACH_REPLY_SECS  as the binary's flags
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORKSPACE="${WORKSPACE:-$HOME/workspace}"
KEY="${POKER_COACH_KEY_FILE:-$WORKSPACE/sidestr/agents/poker-coach.key}"
RELAY="${POKER_COACH_RELAY:-wss://dreamlab-nostr-relay.solitary-paper-764d.workers.dev}"
EXTRA="${POKER_COACH_LLM_EXTRA_FILE:-$HERE/coach-llm.json}"
[ -r "$KEY" ] || { echo "run-coach: missing $KEY" >&2; exit 1; }
[ -n "${POKER_COACH_LLM_URL:-}" ] || { echo "run-coach: POKER_COACH_LLM_URL is unset" >&2; exit 1; }
[ -n "${POKER_COACH_MODEL:-}" ] || { echo "run-coach: POKER_COACH_MODEL is unset" >&2; exit 1; }
command -v nostr-bbs-poker-coach >/dev/null || { echo "run-coach: nostr-bbs-poker-coach not on PATH" >&2; exit 1; }
if [ -n "${POKER_COACH_LLM_KEY_FILE:-}" ] && [ -r "$POKER_COACH_LLM_KEY_FILE" ]; then
  POKER_COACH_LLM_KEY="$(tr -d '[:space:]' < "$POKER_COACH_LLM_KEY_FILE")"
  export POKER_COACH_LLM_KEY
fi
ARGS=(--key-file "$KEY" --relay "$RELAY" --llm-url "$POKER_COACH_LLM_URL" --model "$POKER_COACH_MODEL")
[ -r "$EXTRA" ] && ARGS+=(--llm-extra-file "$EXTRA")
exec nostr-bbs-poker-coach "${ARGS[@]}"
