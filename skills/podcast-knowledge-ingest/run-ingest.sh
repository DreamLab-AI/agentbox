#!/bin/bash
# Entry point for the podcast-knowledge-ingest cron.
# Rust port (services/podcast-ingest, binary: podcast-ingest): the pipeline
# no longer needs a python3-capability probe — the binary is self-contained
# (no interpreter, no site-packages) and just needs to be on PATH.

set -u
SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="${1:-${SKILL_DIR}/podcasts.yaml}"

BIN="$(command -v podcast-ingest || true)"
if [ -z "$BIN" ]; then
    echo "run-ingest.sh: podcast-ingest not found on PATH — aborting" >&2
    exit 1
fi

# One ingest at a time (the catch-up loop, run-catchup.sh, takes the same lock).
# If the loop is draining the back catalogue, this weekly run has nothing to add
# and must not queue behind it for days, so it stands down quietly. Exit 0: it
# is not a failure.
# shellcheck source=lib-lock.sh
. "${SKILL_DIR}/lib-lock.sh"
podcast_lock_acquire
case $? in
    0) ;;
    75)
        echo "run-ingest.sh: another podcast ingest holds ${PODCAST_INGEST_LOCK} (the catch-up loop?); standing down" >&2
        exit 0
        ;;
    *) exit 1 ;;
esac

# Not exec: the shell keeps file descriptor 9, and with it the lock, until the
# binary has finished.
"$BIN" --config "$CONFIG" "${@:2}"
exit $?
