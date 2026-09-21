#!/usr/bin/env bash
# openjev-engine container entrypoint.
#
# One process. The façade lives in the `systemone` container and reaches this
# engine over the SHARED network namespace (compose `network_mode:
# service:systemone`), which is what lets the engine keep its loopback-only
# bind while living in a separate image — and a separate image is forced by the
# transformers 4.x (laya) / 5.x (qwen3_5) split.
#
# Fail-loud, not fail-open: if the engine exits, the container exits with its
# status. A degraded engine that loaded nothing stays UP and says so on
# /health — that is a different thing from a dead one, and the façade must be
# able to tell them apart.

set -uo pipefail

log() { printf '[openjev] %s\n' "$*" >&2; }

trap 'log "received SIGTERM, stopping"; kill -TERM "$PID" 2>/dev/null; wait "$PID"; exit 0' TERM
trap 'log "received SIGINT, stopping";  kill -TERM "$PID" 2>/dev/null; wait "$PID"; exit 0' INT

log "starting openjev-engine (${OPENJEV_BIND_HOST:-127.0.0.1}:${OPENJEV_PORT:-8099}, models=${OPENJEV_MODELS:-<default>})"
python -m openjev_engine &
PID=$!
wait "$PID"
status=$?
log "engine exited with status ${status}"
exit "$status"
