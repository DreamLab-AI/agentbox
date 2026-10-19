#!/bin/bash
# Shared singleton lock for the podcast ingest. The weekly cron (run-ingest.sh)
# and the catch-up loop (run-catchup.sh) both take it, so they can never run at
# the same time: two writers on .ingest-state.json and the ledgers would race.
#
# Source this file, then call `podcast_lock_acquire`. On success it returns 0
# and holds the lock on file descriptor 9 until the shell exits (children
# inherit it, which is what keeps it held while the binary runs). On contention
# it returns 75 (EX_TEMPFAIL) without waiting.

PODCAST_INGEST_LOCK="${PODCAST_INGEST_LOCK:-/tmp/podcast-ingest.lock}"

podcast_lock_acquire() {
    if ! command -v flock >/dev/null 2>&1; then
        echo "podcast ingest lock: flock not found on PATH" >&2
        return 1
    fi
    exec 9>"$PODCAST_INGEST_LOCK" || return 1
    flock -n 9 || return 75
    return 0
}
