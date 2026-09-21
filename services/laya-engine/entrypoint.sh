#!/usr/bin/env bash
# Sovereign System One container entrypoint: supervise the engine and the façade
# as one unit and propagate the first death.
#
# Modes:
#   engine  — the Python engine only (the `engine` build stage's default)
#   facade  — the Rust façade only (an engine elsewhere on loopback)
#   both    — the shipped image: engine first, façade once the engine answers
#
# Fail-loud, not fail-open: if either process exits, the container exits with
# that process's status. A half-dead sidecar that still answers /health on one
# port is worse than a restart, because the consumer's fail-open path
# (routing table / built-in summary) only triggers on a clean failure.

set -uo pipefail

MODE="${1:-both}"
ENGINE_URL="${SSO_ENGINE_URL:-http://127.0.0.1:8098}"
ENGINE_WAIT_S="${SSO_ENGINE_WAIT_S:-600}"

ENGINE_PID=""
FACADE_PID=""

log() { printf '[systemone] %s\n' "$*" >&2; }

shutdown() {
    local sig="${1:-TERM}"
    log "received SIG${sig}, stopping children"
    [ -n "$FACADE_PID" ] && kill -TERM "$FACADE_PID" 2>/dev/null
    [ -n "$ENGINE_PID" ] && kill -TERM "$ENGINE_PID" 2>/dev/null
    wait
    exit 0
}
trap 'shutdown TERM' TERM
trap 'shutdown INT' INT

start_engine() {
    log "starting laya-engine (${LAYA_BIND_HOST:-127.0.0.1}:${LAYA_PORT:-8098}, models=${LAYA_MODELS:-<default>})"
    python -m laya_engine &
    ENGINE_PID=$!
}

start_facade() {
    if [ ! -x /opt/systemone/bin/system-one-facade ]; then
        log "FATAL: /opt/systemone/bin/system-one-facade is missing — this image was built from the 'engine' stage"
        return 127
    fi
    log "starting system-one-facade (${SSO_BIND:-0.0.0.0:8097} -> ${ENGINE_URL})"
    /opt/systemone/bin/system-one-facade &
    FACADE_PID=$!
}

# Wait for the engine to ANSWER, not to be healthy: a degraded engine (a
# checkpoint that would not load) must still come up so /health can say so.
# The first boot downloads ~1.7 GB of weights, hence the generous ceiling.
wait_for_engine() {
    local deadline=$(( SECONDS + ENGINE_WAIT_S ))
    while [ "$SECONDS" -lt "$deadline" ]; do
        if ! kill -0 "$ENGINE_PID" 2>/dev/null; then
            log "engine exited during startup"
            return 1
        fi
        # Any HTTP status counts, including 503 (= loaded nothing yet).
        if curl -fsS -o /dev/null "${ENGINE_URL}/health" 2>/dev/null \
           || curl -sS -o /dev/null -w '%{http_code}' "${ENGINE_URL}/health" 2>/dev/null | grep -qE '^[45]0[0-9]$'; then
            log "engine is answering on ${ENGINE_URL}"
            return 0
        fi
        sleep 2
    done
    log "engine did not answer within ${ENGINE_WAIT_S}s"
    return 1
}

case "$MODE" in
    engine)
        start_engine
        wait "$ENGINE_PID"
        status=$?
        log "engine exited with status ${status}"
        exit "$status"
        ;;
    facade)
        start_facade || exit $?
        wait "$FACADE_PID"
        status=$?
        log "facade exited with status ${status}"
        exit "$status"
        ;;
    both)
        start_engine
        if ! wait_for_engine; then
            kill -TERM "$ENGINE_PID" 2>/dev/null
            wait "$ENGINE_PID" 2>/dev/null
            exit 1
        fi
        start_facade || { kill -TERM "$ENGINE_PID" 2>/dev/null; exit 127; }
        # First death wins: report it and take the other process down with it.
        wait -n
        status=$?
        if kill -0 "$ENGINE_PID" 2>/dev/null; then
            log "facade exited with status ${status}; stopping engine"
        else
            log "engine exited with status ${status}; stopping facade"
        fi
        kill -TERM "$ENGINE_PID" "$FACADE_PID" 2>/dev/null
        wait 2>/dev/null
        exit "$status"
        ;;
    *)
        log "unknown mode '${MODE}' (expected engine|facade|both)"
        exit 2
        ;;
esac
