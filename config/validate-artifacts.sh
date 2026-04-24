#!/usr/bin/env bash
# validate-artifacts.sh — Phase 5 artifact validation gate.
#
# Reads config/artifact-probes.json and runs each probe command.
# Required probes (required_for_readiness=true) that fail cause exit 1.
# Optional probes that fail emit a warning and continue.
#
# Emits pino-compatible JSON log lines to stdout; supervisord captures them.
# Tag: agentbox.stage = "bootstrap"
#
# Called from config/entrypoint-unified.sh immediately before exec supervisord.

set -euo pipefail

_PROBES_FILE="${AGENTBOX_PROBES_FILE:-/opt/agentbox/config/artifact-probes.json}"
_TS() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

_log() {
  local level="$1"; shift
  local event="$1"; shift
  # Build a minimal pino-style JSON line; remaining args are key=value pairs.
  local extra=''
  for kv in "$@"; do
    local key="${kv%%=*}"
    local val="${kv#*=}"
    extra="${extra}, \"${key}\": \"${val}\""
  done
  printf '{"level":"%s","time":"%s","agentbox.stage":"bootstrap","event":"%s"%s}\n' \
    "$level" "$(_TS)" "$event" "$extra"
}

if [ ! -f "$_PROBES_FILE" ]; then
  _log "error" "ProbesFileMissing" "path=${_PROBES_FILE}"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  _log "error" "MissingDependency" "tool=jq" "reason=jq required to parse artifact-probes.json"
  exit 1
fi

# Read all entries once.
mapfile -t CAPABILITY_IDS   < <(jq -r '.[].capability_id'        "$_PROBES_FILE")
mapfile -t ENTRYPOINTS      < <(jq -r '.[].entrypoint_path'       "$_PROBES_FILE")
mapfile -t REQUIRED_FLAGS   < <(jq -r '.[].required_for_readiness' "$_PROBES_FILE")
mapfile -t PROBE_COMMANDS   < <(jq -r '.[].probe_command'          "$_PROBES_FILE")

FAILED=0

for i in "${!CAPABILITY_IDS[@]}"; do
  cap_id="${CAPABILITY_IDS[$i]}"
  required="${REQUIRED_FLAGS[$i]}"
  probe_cmd="${PROBE_COMMANDS[$i]}"

  # Skip probes that reference path templates not yet substituted by flake.nix
  # (indicated by the @...@ placeholder pattern). These are optional pre-packaged
  # CLIs whose store paths are injected at build time; if the placeholder survived
  # into the runtime image it means the feature was disabled at build time.
  if [[ "$probe_cmd" == *"@"*"@"* ]] || [[ "${ENTRYPOINTS[$i]}" == *"@"*"@"* ]]; then
    if [ "$required" = "true" ]; then
      _log "error" "MissingArtifactDetected" \
        "capability=${cap_id}" \
        "reason=entrypoint path contains unresolved build-time placeholder — feature not packaged"
      FAILED=1
    fi
    continue
  fi

  if eval "$probe_cmd" >/dev/null 2>&1; then
    _log "info" "CapabilityValidated" "capability=${cap_id}"
  else
    if [ "$required" = "true" ]; then
      _log "error" "MissingArtifactDetected" \
        "capability=${cap_id}" \
        "reason=probe failed: ${probe_cmd}"
      FAILED=1
    else
      _log "warn" "OptionalArtifactMissing" \
        "capability=${cap_id}" \
        "reason=probe failed (non-fatal): ${probe_cmd}"
    fi
  fi
done

if [ "$FAILED" -ne 0 ]; then
  _log "fatal" "BootstrapFailed" \
    "reason=one or more required artifact probes failed — see MissingArtifactDetected events above"
  exit 1
fi

_log "info" "RuntimeClosureValidated" "message=all required artifact probes passed"
