#!/bin/bash
# ADR-2207 D4: record the sidecar's one display into the exchange volume.
#
#   record.sh start [name]   start recording; refuses (exit 3) while one is running
#   record.sh stop           SIGINT to ffmpeg, wait until it has finalised the file
#                            (exit 4 when nothing is recording)
#   record.sh status
#
# Every command prints one JSON object on stdout. Output:
#   <exchange>/recordings/<name>-<UTC yyyymmddThhmmssZ>.mkv
# with <name> reduced to [A-Za-z0-9._-] (default "recording"). x11grab of :2 at the
# display helper's size (display-env.sh), 30 fps, Matroska, so a recording cut
# short is still playable. Bounded: one recording at a time and at most
# RECORD_MAX_SECONDS (default 3600) each, enforced by ffmpeg's -t, so it cannot fill
# the volume. pid and path live under RECORD_STATE_DIR (/tmp/browsercontainer).
#
# Env: BROWSER_DISPLAY_SIZE, BROWSER_EXCHANGE_DIR (/home/devuser/exchange),
#      RECORD_MAX_SECONDS (3600), RECORD_ENCODER_ARGS
#      ("-c:v libx264 -preset ultrafast -crf 20 -pix_fmt yuv420p"),
#      RECORD_STOP_TIMEOUT (20 s), FFMPEG_BIN (ffmpeg), RECORD_STATE_DIR.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CMD="${1:-status}"
NAME="${2:-recording}"
STATE_DIR="${RECORD_STATE_DIR:-/tmp/browsercontainer}"
EXCHANGE="${BROWSER_EXCHANGE_DIR:-/home/devuser/exchange}"
FFMPEG="${FFMPEG_BIN:-ffmpeg}"
MAX="${RECORD_MAX_SECONDS:-3600}"
STOP_TIMEOUT="${RECORD_STOP_TIMEOUT:-20}"
ENCODER="${RECORD_ENCODER_ARGS:--c:v libx264 -preset ultrafast -crf 20 -pix_fmt yuv420p}"
PIDF="$STATE_DIR/record.pid"
PATHF="$STATE_DIR/record.path"
STARTF="$STATE_DIR/record.started"

json_str() {
  local s="$1"
  s="${s//\\/\\\\}"; s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"; s="${s//$'\r'/\\r}"; s="${s//$'\t'/\\t}"
  printf '"%s"' "$s"
}
fail() { # fail <exit> <message>
  printf '{"error":%s}\n' "$(json_str "$2")"
  exit "$1"
}
recording_pid() {
  local pid
  [ -f "$PIDF" ] || return 1
  pid="$(cat "$PIDF" 2>/dev/null)"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  echo "$pid"
}
last_path() { cat "$PATHF" 2>/dev/null; }
status_json() { # status_json <recording:true|false> [extra json fields]
  local p; p="$(last_path)"
  local pj="null"; [ -n "$p" ] && pj="$(json_str "$p")"
  local started="null"; [ -s "$STARTF" ] && started="$(json_str "$(cat "$STARTF")")"
  local pidj="null"; [ "$1" = true ] && pidj="$(cat "$PIDF")"
  printf '{"recording":%s,"pid":%s,"path":%s,"startedAt":%s,"maxSeconds":%s%s}\n' \
    "$1" "$pidj" "$pj" "$started" "$MAX" "${2:-}"
}

mkdir -p "$STATE_DIR" || fail 1 "cannot create $STATE_DIR"

case "$CMD" in
  start)
    # shellcheck source=display-env.sh
    . "$HERE/display-env.sh"
    [[ "$MAX" =~ ^[1-9][0-9]{0,5}$ ]] || fail 2 "RECORD_MAX_SECONDS='$MAX' must be a positive integer"
    if pid="$(recording_pid)"; then
      printf '{"error":"already recording","pid":%s,"path":%s}\n' "$pid" "$(json_str "$(last_path)")"
      exit 3
    fi
    rm -f "$PIDF" "$STARTF"
    [ -d "$EXCHANGE" ] && [ -w "$EXCHANGE" ] || fail 2 "exchange $EXCHANGE is not a writable directory"
    safe="$(printf '%s' "$NAME" | tr -c 'A-Za-z0-9._-' '-')"
    while [[ "$safe" == [.-]* ]]; do safe="${safe:1}"; done
    safe="${safe:0:64}"
    [ -n "$safe" ] || safe=recording
    mkdir -p "$EXCHANGE/recordings" || fail 1 "cannot create $EXCHANGE/recordings"
    ts="$(date -u +%Y%m%dT%H%M%SZ)"
    out="$EXCHANGE/recordings/$safe-$ts.mkv"
    n=1
    while [ -e "$out" ]; do out="$EXCHANGE/recordings/$safe-$ts-$n.mkv"; n=$((n + 1)); done
    read -r -a enc <<<"$ENCODER"
    # Job control gives ffmpeg its own process group with SIGINT not ignored, so
    # `stop` can finalise it and the caller's group (the bridge) is not involved.
    set -m
    nohup "$FFMPEG" -hide_banner -loglevel error -nostdin \
      -f x11grab -video_size "${BROWSER_DISPLAY_W}x${BROWSER_DISPLAY_H}" -framerate 30 -i "${RECORD_DISPLAY:-:2}" \
      -t "$MAX" "${enc[@]}" -f matroska "$out" </dev/null >>"$STATE_DIR/record.log" 2>&1 &
    pid=$!
    set +m
    echo "$pid" >"$PIDF"
    echo "$out" >"$PATHF"
    date -u +%Y-%m-%dT%H:%M:%SZ >"$STARTF"
    sleep "${RECORD_START_CHECK_SECONDS:-0.5}"
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PIDF"
      fail 1 "ffmpeg exited at once: $(tail -n 3 "$STATE_DIR/record.log" 2>/dev/null | tr '\n' ' ')"
    fi
    status_json true
    ;;
  stop)
    if ! pid="$(recording_pid)"; then
      rm -f "$PIDF"
      printf '{"error":"not recording","recording":false,"path":%s}\n' \
        "$(p="$(last_path)"; [ -n "$p" ] && json_str "$p" || echo null)"
      exit 4
    fi
    kill -INT "$pid" 2>/dev/null
    forced=false
    steps=$((STOP_TIMEOUT * 10))
    while kill -0 "$pid" 2>/dev/null && [ "$steps" -gt 0 ]; do sleep 0.1; steps=$((steps - 1)); done
    if kill -0 "$pid" 2>/dev/null; then
      forced=true
      kill -TERM "$pid" 2>/dev/null; sleep 2; kill -KILL "$pid" 2>/dev/null
    fi
    rm -f "$PIDF"
    status_json false ",\"finalised\":$([ "$forced" = false ] && echo true || echo false)"
    ;;
  status)
    if recording_pid >/dev/null; then status_json true; else status_json false; fi
    ;;
  *)
    fail 2 "usage: record.sh start [name] | stop | status"
    ;;
esac
