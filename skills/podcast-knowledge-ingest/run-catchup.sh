#!/bin/bash
# run-catchup.sh — drain the back catalogue through podcast-ingest at a steady
# clip, resumably, until there are no new episodes left.
#
# One iteration is one `podcast-ingest` run capped at CATCHUP_BATCH episodes
# (default 5). The binary records each episode as it lands and ledger writes are
# idempotent by assertion fingerprint, so the loop can be killed at any point and
# started again; it picks up where the state says it was.
#
#   run-catchup.sh [podcasts.yaml]        run until done
#   run-catchup.sh --check [podcasts.yaml] preflight only, then exit
#
# Pacing and safety:
#   * one Loom slot: iterations run strictly one after another;
#   * a singleton lock shared with run-ingest.sh (lib-lock.sh) stops the weekly
#     cron and this loop ever overlapping;
#   * it does nothing between CATCHUP_YIELD_START and CATCHUP_YIELD_END (UTC
#     HH:MM, default 00:30-05:10): the dream machine's window is 01:00-05:00 UTC
#     ([dream_machine] window_start/window_end in agentbox.toml) and it uses the
#     same Loom and the HP node;
#   * YouTube throttles subtitle downloads (HTTP 429). The binary then stops its
#     batch and prints "RATE-LIMITED:"; the loop sleeps 15, 30, 60, then 120
#     minutes (capped) and resets after a clean iteration;
#   * any other failure stops the loop after 3 iterations in a row without
#     progress, and says why;
#   * SIGTERM / SIGINT stop it cleanly, forwarding the signal to the binary.
#
# Environment: VAULT_TRANSCRIPTS (required), CATCHUP_BATCH, CATCHUP_YIELD_START,
# CATCHUP_YIELD_END, PODCAST_INGEST_LOCK. Test hooks: CATCHUP_MINUTE_SECS
# (seconds per "minute" in naps, default 60) and CATCHUP_CLOCK_CMD (prints the
# current UTC HH:MM, default `date -u +%H:%M`).
set -u

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHECK_ONLY=0
if [ "${1:-}" = "--check" ]; then
    CHECK_ONLY=1
    shift
fi
CONFIG="${1:-${SKILL_DIR}/podcasts.yaml}"
BATCH="${CATCHUP_BATCH:-5}"
YIELD_START="${CATCHUP_YIELD_START:-00:30}"
YIELD_END="${CATCHUP_YIELD_END:-05:10}"
MINUTE="${CATCHUP_MINUTE_SECS:-60}"
CLOCK_CMD="${CATCHUP_CLOCK_CMD:-date -u +%H:%M}"

die() {
    echo "run-catchup.sh: $*" >&2
    exit 1
}

BIN="$(command -v podcast-ingest || true)"
[ -n "$BIN" ] || die "podcast-ingest not found on PATH"
[ -n "${VAULT_TRANSCRIPTS:-}" ] || die "VAULT_TRANSCRIPTS is unset; the [vault] section of agentbox.toml names it"
[ -d "$VAULT_TRANSCRIPTS" ] || die "VAULT_TRANSCRIPTS=$VAULT_TRANSCRIPTS is not a directory"
[ -f "$CONFIG" ] || die "config $CONFIG not found"
case "$BATCH" in '' | *[!0-9]* | 0) die "CATCHUP_BATCH must be a positive integer, got '$BATCH'" ;; esac
grep -q '^ *max_episodes_per_run:' "$CONFIG" || die "$CONFIG has no max_episodes_per_run to cap"

# shellcheck source=lib-lock.sh
. "${SKILL_DIR}/lib-lock.sh"
podcast_lock_acquire
case $? in
    0) ;;
    75) die "another podcast ingest holds ${PODCAST_INGEST_LOCK} (the weekly cron or another loop); not starting" ;;
    *) exit 1 ;;
esac

LOG="${VAULT_TRANSCRIPTS}/.catchup-log.txt"
WORK="$(mktemp -d)"
CAPPED="${WORK}/podcasts.catchup.yaml"
OUT="${WORK}/iteration.out"
sed "s/^\( *max_episodes_per_run:\).*/\1 ${BATCH}/" "$CONFIG" >"$CAPPED"

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$LOG"; }

STOP=0
CHILD=""
NAP=""
cleanup() { rm -rf "$WORK"; }
on_signal() {
    STOP=1
    [ -n "$CHILD" ] && kill -TERM "$CHILD" 2>/dev/null
    [ -n "$NAP" ] && kill "$NAP" 2>/dev/null
}
trap on_signal TERM INT
trap cleanup EXIT

# Interruptible sleep of $1 minutes.
nap() {
    local minutes="$1" secs
    secs=$((minutes * MINUTE))
    [ "$secs" -gt 0 ] || return 0
    sleep "$secs" &
    NAP=$!
    wait "$NAP" 2>/dev/null
    NAP=""
}

hhmm_to_min() {
    local h="${1%%:*}" m="${1##*:}"
    echo $((10#$h * 60 + 10#$m))
}

# Minutes of waiting needed to leave the dream-machine window (0 outside it).
# Works for a window that wraps midnight too.
yield_minutes() {
    local now start end
    now=$(hhmm_to_min "$(eval "$CLOCK_CMD")")
    start=$(hhmm_to_min "$YIELD_START")
    end=$(hhmm_to_min "$YIELD_END")
    if [ "$start" -le "$end" ]; then
        if [ "$now" -ge "$start" ] && [ "$now" -lt "$end" ]; then echo $((end - now)); else echo 0; fi
    else
        if [ "$now" -ge "$start" ]; then
            echo $((1440 - now + end))
        elif [ "$now" -lt "$end" ]; then
            echo $((end - now))
        else
            echo 0
        fi
    fi
}

if [ "$CHECK_ONLY" = 1 ]; then
    echo "run-catchup.sh: ok: binary $BIN, config $CONFIG, batch $BATCH, yield ${YIELD_START}-${YIELD_END} UTC, log $LOG"
    exit 0
fi

log "catch-up start: batch=$BATCH config=$CONFIG yield=${YIELD_START}-${YIELD_END}UTC pid=$$"
iteration=0
total_downloaded=0
backoff=15
stalled=0

while [ "$STOP" = 0 ]; do
    wait_min=$(yield_minutes)
    if [ "$wait_min" -gt 0 ]; then
        log "dream window: sleeping ${wait_min} min"
        nap "$wait_min"
        continue
    fi

    iteration=$((iteration + 1))
    "$BIN" --config "$CAPPED" >"$OUT" 2>&1 &
    CHILD=$!
    wait "$CHILD"
    rc=$?
    CHILD=""
    cat "$OUT" >>"$LOG"
    [ "$STOP" = 0 ] || break

    listed=$(sed -n 's/.*\] \([0-9][0-9]*\) new episodes to download\..*/\1/p' "$OUT" | tail -1)
    got=$(sed -n 's/.*Downloaded \([0-9][0-9]*\) episodes\..*/\1/p' "$OUT" | tail -1)
    listed=${listed:-0}
    got=${got:-0}
    total_downloaded=$((total_downloaded + got))
    remaining=$((listed - got))

    if grep -q 'No new episodes' "$OUT" && [ "$rc" = 0 ]; then
        log "iteration $iteration: no new episodes left; catch-up complete ($total_downloaded downloaded this session)"
        exit 0
    fi

    if grep -q '^RATE-LIMITED:' "$OUT"; then
        log "iteration $iteration: downloaded $got, remaining $remaining; YouTube rate-limited the subtitle fetch, backing off ${backoff} min"
        nap "$backoff"
        backoff=$((backoff * 2))
        [ "$backoff" -le 120 ] || backoff=120
        continue
    fi

    if [ "$rc" = 0 ] && [ "$got" -gt 0 ]; then
        backoff=15
        stalled=0
        log "iteration $iteration: downloaded $got, remaining $remaining ($total_downloaded this session)"
        continue
    fi

    # Non-zero exit with no download, or a clean exit that moved nothing.
    if [ "$got" -gt 0 ]; then
        stalled=0
    else
        stalled=$((stalled + 1))
    fi
    log "iteration $iteration: exit $rc, downloaded $got, remaining $remaining; no progress ($stalled of 3)"
    if [ "$stalled" -ge 3 ]; then
        log "stopping: 3 iterations in a row made no progress. Last output:"
        tail -n 8 "$OUT" | sed 's/^/    /' | tee -a "$LOG"
        exit 1
    fi
    nap 5
done

log "catch-up stopped by signal after $iteration iteration(s), $total_downloaded downloaded this session"
exit 0
