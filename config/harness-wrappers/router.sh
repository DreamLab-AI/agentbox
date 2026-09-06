#!/usr/bin/env bash
# ============================================================================
# Agent-of-Empires custom-agent wrapper — the model-router console (ADR-2080)
# ----------------------------------------------------------------------------
# Registered as the AoE `custom_agents.router` entry by scripts/aoe-seed-sessions.mjs
# (WRAPPER_SLUGS) for the `router` session seed. AoE execs this in the session's
# tmux pane; it asserts the preconditions LOUDLY and then hands off to
# config/model-router/console.mjs, which embeds each task offline, asks the
# metaharness router inside the baked ruflo closure for the cheapest model above
# the quality bar, executes through OpenRouter, and writes a labelled receipt.
#
# Invariants this wrapper makes structural (ADR-2079 §4/§6, ADR-2080):
#   * PUBLIC WORK ONLY — the console refuses any privacy tier other than
#     `public`; we pin it here so a session cannot inherit something else.
#   * The ADR-2026 egress switch is honoured: AGENTBOX_EGRESS=0 forces dry-run.
#   * No provider credential is minted or printed here. OPENROUTER_API_KEY is
#     forwarded by AoE's config.toml `environment=` list (PRD-021 WS2); absence
#     is a visible launch failure, not a silent fallback to another billing key.
#   * Nothing in the AoE or ruflo trees is patched; the router env is scoped to
#     this process (never exported by the entrypoint — ADR-2080 D3).
# ============================================================================
set -euo pipefail

SLUG="router"
WORKSPACE="${WORKSPACE:-/home/devuser/workspace}"

_die() {
  {
    echo ""
    echo "=================================================================="
    echo "  AGENTBOX HARNESS WRAPPER — FATAL (model-router / ${SLUG})"
    echo "  Refusing to launch the router console. Fix the cause below."
    echo "------------------------------------------------------------------"
    local _l
    for _l in "$@"; do echo "  ${_l}"; done
    echo "=================================================================="
    echo ""
  } >&2
  exit 1
}

case "${BASH_SOURCE[0]}" in
  */*) _HERE="${BASH_SOURCE[0]%/*}" ;;
  *)   _HERE="." ;;
esac
CONSOLE="${AGENTBOX_MODEL_ROUTER_CONSOLE:-${_HERE}/../model-router/console.mjs}"
[ -r "$CONSOLE" ] || _die \
  "console missing: ${CONSOLE}" \
  "config/model-router/console.mjs must sit beside the wrappers — reinstall or rebuild."

command -v node >/dev/null 2>&1 || _die "node is not on PATH."
command -v ruflo >/dev/null 2>&1 || [ -n "${RUFLO_NODE_MODULES:-}" ] || _die \
  "ruflo is not on PATH and RUFLO_NODE_MODULES is unset —" \
  "the console imports the router from the baked ruflo closure (ADR-2080)."

# Artefacts: baked dir first, pre-rebuild fallback second. The console does the
# strict per-file check; this is the early, readable hint.
_ASSETS="${AGENTBOX_MODEL_ROUTER_DIR:-}"
if [ -z "$_ASSETS" ]; then
  for _d in /opt/agentbox/model-router "${WORKSPACE}/.agentbox/model-router"; do
    [ -f "${_d}/seed-router.krr.json" ] && { _ASSETS="$_d"; break; }
  done
fi
[ -n "$_ASSETS" ] || _die \
  "router artefacts not found (seed corpus, KRR model, calibrator, MiniLM embedder)." \
  "Populate the fallback dir now:   ./agentbox.sh model-router fetch" \
  "or rebuild with [model_routing.neural].enabled = true (bakes /opt/agentbox/model-router)."

_PROVIDER="${AGENTBOX_MODEL_ROUTER_PROVIDER:-openrouter}"
if [ "$_PROVIDER" = "openrouter" ] && [ -z "${OPENROUTER_API_KEY:-}" ] && [ "${AGENTBOX_EGRESS:-1}" != "0" ]; then
  _die \
    "OPENROUTER_API_KEY is empty in this session's environment." \
    "Set it in .env and reboot (AoE forwards it via config.toml environment=)," \
    "or export AGENTBOX_EGRESS=0 to run the console in dry-run (route only)."
fi

# Per-session identity binding (ADR-043 D4.1) + the structural privacy pin.
export AGENTBOX_PROFILE="${AGENTBOX_PROFILE:-$SLUG}"
export AGENTBOX_MODEL_ROUTER_PRIVACY_TIER="public"
export AGENTBOX_MODEL_ROUTER_DIR="$_ASSETS"
export AGENTBOX_MODEL_ROUTER_STATE_DIR="${AGENTBOX_MODEL_ROUTER_STATE_DIR:-${WORKSPACE}/.agentbox/model-router-state}"

echo "[harness-wrapper] model-router console → provider ${_PROVIDER} (artefacts ${_ASSETS}, tier public, egress ${AGENTBOX_EGRESS:-1}, profile ${SLUG})"
exec node "$CONSOLE" "$@"
