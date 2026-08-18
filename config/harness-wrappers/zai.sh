#!/usr/bin/env bash
# ============================================================================
# Agent-of-Empires command-override wrapper — Z.AI-routed Claude Code
# ----------------------------------------------------------------------------
# Registered as an AoE `custom_agents` entry (PRD-021 WS2 / ADR-042 D6): AoE
# execs this script in the session's tmux pane instead of the bare `claude`
# binary. Its whole job is to make the ADR-025 profile-isolation invariant
# (N-01) structural rather than a matter of test coverage:
#
#   * HOME and CLAUDE_CONFIG_DIR are BOTH pinned at $WORKSPACE/profiles/zai so
#     Claude Code reads that profile's runtime-written settings.local.json (its
#     own ANTHROPIC_BASE_URL + token) and never the global ~/.claude that
#     carries the direct-Anthropic key (tmux-autostart.sh:170-174, verbatim);
#   * the Z.AI redirect (api.z.ai/api/paas/v4, the subscription PaaS
#     endpoint) is asserted present and correct, and the wrapper
#     HARD-FAILS LOUDLY if it is missing or points anywhere other than z.ai —
#     turning the silent mis-billing failure mode (the top sprint risk) into an
#     immediate, visible launch failure.
#
# Then it execs claude. No key bytes are minted here; settings.local.json is the
# runtime source of truth, provisioned by scripts/aoe-seed-sessions.mjs.
# ============================================================================
set -euo pipefail

SLUG="zai"
PROVIDER="Z.AI"
EXPECT_HOST="z.ai"

WORKSPACE="${WORKSPACE:-/home/devuser/workspace}"
PROFILE="${WORKSPACE}/profiles/${SLUG}"
CLAUDE_DIR="${PROFILE}/.claude"
SETTINGS="${CLAUDE_DIR}/settings.local.json"

# --- loud, unmissable abort ------------------------------------------------
_die() {
  {
    echo ""
    echo "=================================================================="
    echo "  AGENTBOX HARNESS WRAPPER — FATAL (${PROVIDER} / ${SLUG})"
    echo "  Refusing to launch Claude Code: the profile redirect is not"
    echo "  safely configured. Launching now would bill the DIRECT-Anthropic"
    echo "  key instead of ${PROVIDER}. Fix the cause below and relaunch."
    echo "------------------------------------------------------------------"
    local _l
    for _l in "$@"; do echo "  ${_l}"; done
    echo "=================================================================="
    echo ""
  } >&2
  exit 1
}

# --- JSON field reader (jq → python3 → node), never fatal ------------------
_json_env_field() {
  # $1 = json file, $2 = key under .env; prints the value (or nothing).
  local file="$1" key="$2"
  if command -v jq >/dev/null 2>&1; then
    jq -r --arg k "$key" '.env[$k] // empty' "$file" 2>/dev/null
  elif command -v python3 >/dev/null 2>&1; then
    python3 - "$file" "$key" <<'PY' 2>/dev/null
import json, sys
try:
    with open(sys.argv[1]) as fh:
        data = json.load(fh)
    val = (data.get("env") or {}).get(sys.argv[2], "")
    sys.stdout.write(val if isinstance(val, str) else "")
except Exception:
    pass
PY
  elif command -v node >/dev/null 2>&1; then
    node -e 'try{const d=require(process.argv[1]);process.stdout.write(((d.env||{})[process.argv[2]])||"")}catch(e){}' "$file" "$key" 2>/dev/null
  fi
}

# --- assert profile + settings exist ---------------------------------------
[ -d "$PROFILE" ] || _die \
  "profile directory missing: ${PROFILE}" \
  "run the boot reconciler (scripts/aoe-seed-sessions.mjs) or rebuild the image."

[ -f "$SETTINGS" ] || _die \
  "settings.local.json missing: ${SETTINGS}" \
  "the redirect key was never provisioned — set ZAI_API_KEY (or" \
  "ZAI_ANTHROPIC_API_KEY) in .env and reboot to reprovision the profile."

# --- extract + validate the redirect ---------------------------------------
BASE_URL="$(_json_env_field "$SETTINGS" ANTHROPIC_BASE_URL || true)"
AUTH_TOKEN="$(_json_env_field "$SETTINGS" ANTHROPIC_AUTH_TOKEN || true)"

[ -n "$BASE_URL" ] || _die \
  "ANTHROPIC_BASE_URL is empty in ${SETTINGS}" \
  "the profile settings were written without a redirect endpoint."

[ -n "$AUTH_TOKEN" ] || _die \
  "ANTHROPIC_AUTH_TOKEN is empty in ${SETTINGS}" \
  "set ZAI_API_KEY in .env and reboot to reprovision the profile."

case "$BASE_URL" in
  *"$EXPECT_HOST"*) : ;;
  *) _die \
       "ANTHROPIC_BASE_URL does not point at ${EXPECT_HOST}:" \
       "  ${BASE_URL}" \
       "launching would mis-bill the direct-Anthropic key — aborting." ;;
esac

# --- pin the isolated profile + redirect, then hand off to claude ----------
export HOME="$PROFILE"
export CLAUDE_CONFIG_DIR="$CLAUDE_DIR"
export ANTHROPIC_BASE_URL="$BASE_URL"
export ANTHROPIC_AUTH_TOKEN="$AUTH_TOKEN"
export ANTHROPIC_API_KEY=""
# Per-session identity binding (ADR-043 D4.1): a distinct AGENTBOX_PROFILE
# yields a distinct persisted did:nostr for this session.
export AGENTBOX_PROFILE="${AGENTBOX_PROFILE:-$SLUG}"

echo "[harness-wrapper] ${PROVIDER} → ${BASE_URL} (profile ${SLUG}, isolated HOME=${PROFILE})"
exec claude "$@"
