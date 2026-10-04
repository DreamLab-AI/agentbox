#!/usr/bin/env bash
# ADR-2071 clause (c): run ONE dream night with management-api stopped, then
# restart it whatever the night's outcome. Owner decision 2026-10-02, Q9: the
# night of Monday 5 Oct, i.e. the 01:00-05:00 UTC window on Tue 6 Oct.
#
# A stateless tick, run every 10 minutes by supercronic from
# skills/podcast-knowledge-ingest/crontab ([program:podcast-cron]). The crontab
# and this script live in the bind-mounted checkout, so the arrangement
# survives a container restart without an image rebuild. Each tick decides only
# from the marker, a state file and the clock (always UTC, whatever TZ says):
#
#   marker  $WORKSPACE/.agentbox/adr-2071-api-down-night   one line: YYYY-MM-DD
#           (the UTC date of the window). No marker → nothing happens.
#   state   $WORKSPACE/.agentbox/adr-2071-api-down-night.state   key=value lines
#   log     $WORKSPACE/.agentbox/adr-2071-api-down-night.log
#
#   1. stop     between 00:30 and 00:59 UTC on the marker date, if not yet
#               stopped: `supervisorctl stop management-api`; state=stopped.
#               First tick at or after 01:00 with no stop → state=missed (the
#               night has started with the API up; the run is not attempted).
#   2. restart  once state=stopped, the first tick that sees ANY of
#                 - dream-last-night.json dated the marker date (cycle done),
#                 - 07:30 UTC on the marker date passed (deadline),
#                 - management-api RUNNING again (container restart: supervisord
#                   autostarts it; recorded as interrupted)
#               runs `supervisorctl start management-api` (idempotent) and sets
#               state=done with the reason. An EXIT trap also restarts it if the
#               tick dies between stop and the state write.
#   3. retire   when state is done/missed the marker is renamed *.consumed, so
#               the tick is inert without a fresh marker. (The crontab line was
#               removed on 2026-10-04 once clause (c) passed; re-add it to reuse.)
#
# The morning after: scripts/activation/adr-2087-check.sh --api-down-night DATE
# reads the state file as well as the night record (check C3).
#
#   --status   print marker, state and API status; change nothing.
#
# Test seams (tests/config/adr-2071-api-down-night.test.sh): ADR2071_NOW
# (epoch seconds) and SUPERVISORCTL (path).

set -uo pipefail

WORKSPACE="${WORKSPACE:-/home/devuser/workspace}"
DIR="$WORKSPACE/.agentbox"
MARKER="$DIR/adr-2071-api-down-night"
STATE="$DIR/adr-2071-api-down-night.state"
LOG="$DIR/adr-2071-api-down-night.log"
NIGHT_RECORD="$DIR/dream-last-night.json"
SUPERVISORCTL="${SUPERVISORCTL:-supervisorctl}"
PROGRAM="management-api"
DEADLINE_HHMM="0730"

now_s="${ADR2071_NOW:-$(date -u +%s)}"
utc() { TZ=UTC date -u -d "@$now_s" "+$1"; }
TODAY="$(utc %Y-%m-%d)"
HHMM="$(utc %H%M)"
STAMP="$(utc %Y-%m-%dT%H:%M:%SZ)"

log() { mkdir -p "$DIR"; printf '%s %s\n' "$STAMP" "$*" | tee -a "$LOG"; }
# Pure bash plus coreutils and supervisorctl: supercronic's PATH for
# [program:podcast-cron] has no sed or awk.
state_get() {
  local k v out=""
  [ -r "$STATE" ] || return 0
  while IFS='=' read -r k v; do [ "$k" = "$1" ] && out="$v"; done < "$STATE"
  printf '%s' "$out"
}
state_set() { mkdir -p "$DIR"; printf '%s=%s\n' "$1" "$2" >> "$STATE"; }
api_status() {
  local _name st _rest
  read -r _name st _rest <<<"$("$SUPERVISORCTL" status "$PROGRAM" 2>/dev/null)"
  printf '%s' "$st"
}

if [ "${1:-}" = "--status" ]; then
  echo "now (UTC): $STAMP"
  echo "marker:    $( [ -r "$MARKER" ] && cat "$MARKER" || echo absent )"
  echo "state:     $( [ -r "$STATE" ] && tr '\n' ' ' < "$STATE" || echo none )"
  echo "$PROGRAM: $(api_status)"
  exit 0
fi

[ -r "$MARKER" ] || exit 0
NIGHT="$(tr -d '[:space:]' < "$MARKER")"
if ! [[ "$NIGHT" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  log "marker holds '$NIGHT', not a YYYY-MM-DD date; ignoring"
  exit 0
fi

retire() { mv -f "$MARKER" "$MARKER.consumed" 2>/dev/null && log "marker retired to $MARKER.consumed"; }

phase="$(state_get phase)"
case "$phase" in
  done|missed) retire; exit 0 ;;
esac

# ── 1. stop ────────────────────────────────────────────────────────────────
if [ -z "$phase" ]; then
  [ "$TODAY" = "$NIGHT" ] || exit 0
  if [ "$HHMM" -ge 0030 ] && [ "$HHMM" -lt 0100 ]; then
    if [ -e "$DIR/dream-paused" ]; then
      log "dreaming is paused (dream-paused flag); the API stays up and the run is not attempted"
      state_set night "$NIGHT"; state_set phase missed; state_set reason dream-paused
      retire; exit 0
    fi
    # From here until the state write, any exit restarts the API.
    trap '"$SUPERVISORCTL" start "$PROGRAM" >/dev/null 2>&1; log "tick exited before recording the stop; $PROGRAM restarted"' EXIT
    if "$SUPERVISORCTL" stop "$PROGRAM" >/dev/null 2>&1 || [ "$(api_status)" = "STOPPED" ]; then
      state_set night "$NIGHT"; state_set phase stopped; state_set stopped_at "$STAMP"
      trap - EXIT
      log "ADR-2071 (c): $PROGRAM stopped for the $NIGHT dream window (status $(api_status))"
    else
      log "ADR-2071 (c): could not stop $PROGRAM (status $(api_status)); not attempted"
      trap - EXIT
      "$SUPERVISORCTL" start "$PROGRAM" >/dev/null 2>&1
      state_set night "$NIGHT"; state_set phase missed; state_set reason stop-failed
      retire
    fi
    exit 0
  fi
  if [ "$HHMM" -ge 0100 ]; then
    log "ADR-2071 (c): no stop before the $NIGHT window opened (no tick 00:30-00:59 UTC); not attempted"
    state_set night "$NIGHT"; state_set phase missed; state_set reason no-tick-before-window
    retire
  fi
  exit 0
fi

# ── 2. restart ─────────────────────────────────────────────────────────────
if [ "$phase" = "stopped" ]; then
  reason=""
  record_date=""
  if [ -r "$NIGHT_RECORD" ] && [[ "$(< "$NIGHT_RECORD")" =~ \"date\"[[:space:]]*:[[:space:]]*\"([0-9-]+)\" ]]; then
    record_date="${BASH_REMATCH[1]}"
  fi
  status="$(api_status)"
  if [ "$record_date" = "$NIGHT" ]; then
    reason="night-record"
  elif [ "$status" = "RUNNING" ] || [ "$status" = "STARTING" ]; then
    reason="interrupted"
  elif [[ "$TODAY" > "$NIGHT" ]] || { [ "$TODAY" = "$NIGHT" ] && [ "$HHMM" -ge "$DEADLINE_HHMM" ]; }; then
    reason="deadline"
  fi
  [ -n "$reason" ] || exit 0
  "$SUPERVISORCTL" start "$PROGRAM" >/dev/null 2>&1
  state_set phase done; state_set started_at "$STAMP"; state_set reason "$reason"
  log "ADR-2071 (c): $PROGRAM restarted ($reason; status now $(api_status)). Next: scripts/activation/adr-2087-check.sh --api-down-night $NIGHT"
  retire
fi
exit 0
