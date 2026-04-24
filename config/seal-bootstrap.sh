#!/usr/bin/env bash
# seal-bootstrap.sh — supervisord [program:bootstrap-seal], priority=99.
#
# Runs after supervisord has started all lower-priority programs.
# Waits until every required program declared in artifact-probes.json
# has transitioned to RUNNING state (or until a timeout), then writes
# the bootstrap sentinel file that signals BootstrapCompleted.
#
# Sentinel location: /run/agentbox/bootstrap.done  (tmpfs — ephemeral per boot)
# This file's existence is the canonical BootstrapCompleted signal per DDD-001.

set -euo pipefail

_SENTINEL_DIR="/run/agentbox"
_SENTINEL="${_SENTINEL_DIR}/bootstrap.done"
_SUPERVISORCTL="${SUPERVISORCTL:-supervisorctl}"
_TIMEOUT="${BOOTSTRAP_SEAL_TIMEOUT:-120}"
_POLL_INTERVAL=2
_TS() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

_log() {
  local level="$1"; shift
  local event="$1"; shift
  local extra=''
  for kv in "$@"; do
    local key="${kv%%=*}"
    local val="${kv#*=}"
    extra="${extra}, \"${key}\": \"${val}\""
  done
  printf '{"level":"%s","time":"%s","agentbox.stage":"bootstrap","event":"%s"%s}\n' \
    "$level" "$(_TS)" "$event" "$extra"
}

# Derive required programs from supervisord config.  We look for
# [program:*] blocks that set  required_for_readiness = true  in their
# environment stanza.  Supervisord does not parse custom keys, so this
# is a naming convention: programs that are required emit
#   environment=AGENTBOX_REQUIRED_FOR_READINESS="true"
# in supervisord.conf.  We parse the conf file at seal time.
_SUPERVISORD_CONF="${SUPERVISORD_CONF:-/etc/supervisord.conf}"

_required_programs() {
  if [ ! -f "$_SUPERVISORD_CONF" ]; then
    echo ""
    return
  fi
  # Extract [program:name] blocks that contain AGENTBOX_REQUIRED_FOR_READINESS=true
  awk '
    /^\[program:/ {
      prog = $0
      sub(/^\[program:/, "", prog)
      sub(/\].*/, "", prog)
      in_block = 1
      required = 0
    }
    in_block && /AGENTBOX_REQUIRED_FOR_READINESS.*true/ { required = 1 }
    /^\[/ && !/^\[program:/ { in_block = 0 }
    END {}
    in_block && required { print prog }
  ' "$_SUPERVISORD_CONF"
}

mapfile -t REQUIRED_PROGRAMS < <(_required_programs)

_log "info" "BootstrapSealStarted" \
  "required_programs=$(IFS=','; echo "${REQUIRED_PROGRAMS[*]:-none}")" \
  "timeout_seconds=${_TIMEOUT}"

_elapsed=0
while [ "$_elapsed" -lt "$_TIMEOUT" ]; do
  ALL_RUNNING=1
  for prog in "${REQUIRED_PROGRAMS[@]:-}"; do
    if [ -z "$prog" ]; then continue; fi
    status=$("$_SUPERVISORCTL" status "$prog" 2>/dev/null | awk '{print $2}' || echo "UNKNOWN")
    if [ "$status" != "RUNNING" ]; then
      ALL_RUNNING=0
      _log "debug" "WaitingForProgram" "program=${prog}" "status=${status}" \
        "elapsed_seconds=${_elapsed}"
      break
    fi
  done

  if [ "$ALL_RUNNING" -eq 1 ]; then
    break
  fi

  sleep "$_POLL_INTERVAL"
  _elapsed=$(( _elapsed + _POLL_INTERVAL ))
done

if [ "$_elapsed" -ge "$_TIMEOUT" ]; then
  _log "error" "BootstrapSealTimeout" \
    "reason=required programs did not reach RUNNING within ${_TIMEOUT}s" \
    "timeout_seconds=${_TIMEOUT}"
  # Do NOT write the sentinel — bootstrap is not complete.
  exit 1
fi

# Write the sentinel atomically via a temp file + mv.
mkdir -p "$_SENTINEL_DIR"
_tmp="${_SENTINEL}.tmp.$$"
printf '{"completed_at":"%s","agentbox.stage":"bootstrap"}\n' "$(_TS)" > "$_tmp"
mv "$_tmp" "$_SENTINEL"

_log "info" "BootstrapCompleted" \
  "sentinel=${_SENTINEL}" \
  "elapsed_seconds=${_elapsed}"
