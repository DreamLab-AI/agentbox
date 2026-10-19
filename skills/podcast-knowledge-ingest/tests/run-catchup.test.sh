#!/bin/bash
# Tests for run-catchup.sh, run-ingest.sh and lib-lock.sh with a fake
# podcast-ingest on PATH. No network, no vault, no real binary.
#   bash tests/run-catchup.test.sh
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL="$(dirname "$HERE")"
ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT
PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "ok   - $1"; }
bad() { FAIL=$((FAIL + 1)); echo "FAIL - $1"; [ -n "${2:-}" ] && echo "       $2"; }
check() { if eval "$2"; then ok "$1"; else bad "$1" "${3:-$2}"; fi; }

# A fresh sandbox: fake binary dir, transcripts dir, a copy of the config.
new_case() {
    CASE="$ROOT/$1"
    mkdir -p "$CASE/bin" "$CASE/transcripts"
    export VAULT_TRANSCRIPTS="$CASE/transcripts"
    export PODCAST_INGEST_LOCK="$CASE/lock"
    export CATCHUP_MINUTE_SECS=0
    export CATCHUP_YIELD_START=00:00 CATCHUP_YIELD_END=00:00
    printf 'podcasts: []\nsettings:\n  max_episodes_per_run: 15\n' >"$CASE/podcasts.yaml"
    unset CATCHUP_BATCH
    PATH="$CASE/bin:$ORIG_PATH"
}
ORIG_PATH="$PATH"

# fake_ingest <script body>: installs $CASE/bin/podcast-ingest. The body can use
# $N (1-based call number), $CFG (the --config path) and $CASE.
fake_ingest() {
    cat >"$CASE/bin/podcast-ingest" <<EOF
#!/bin/bash
CASE="$CASE"
N=\$(( \$(cat "\$CASE/calls" 2>/dev/null || echo 0) + 1 ))
echo \$N >"\$CASE/calls"
CFG="\$2"
grep -o 'max_episodes_per_run: [0-9]*' "\$CFG" >>"\$CASE/caps"
$1
EOF
    chmod +x "$CASE/bin/podcast-ingest"
}

logtext() { cat "$CASE/transcripts/.catchup-log.txt" 2>/dev/null; }

# --- 1. runs to completion, with the batch cap applied and progress logged ----
new_case complete
fake_ingest '
case $N in
  1) echo "[Cast] 12 new episodes to download."; echo "[Cast] Downloaded 5 episodes."; exit 0;;
  2) echo "[Cast] 7 new episodes to download."; echo "[Cast] Downloaded 5 episodes."; exit 0;;
  3) echo "[Cast] 2 new episodes to download."; echo "[Cast] Downloaded 2 episodes."; exit 0;;
  *) echo "[Cast] No new episodes."; exit 0;;
esac'
CATCHUP_BATCH=5 bash "$SKILL/run-catchup.sh" "$CASE/podcasts.yaml" >/dev/null 2>&1
rc=$?
check "completes with exit 0" "[ $rc = 0 ]"
check "stops on 'No new episodes'" "logtext | grep -q 'catch-up complete (12 downloaded'"
check "logs downloaded and remaining per iteration" "logtext | grep -q 'iteration 1: downloaded 5, remaining 7'"
check "caps every run at CATCHUP_BATCH" "[ \"\$(sort -u '$CASE/caps')\" = 'max_episodes_per_run: 5' ]"
check "the original config is not edited" "grep -q 'max_episodes_per_run: 15' '$CASE/podcasts.yaml'"

# --- 2. rate limit: exponential backoff 15, 30, then recovers ----------------
new_case ratelimit
fake_ingest '
case $N in
  1|2) echo "[Cast] 9 new episodes to download."; echo "RATE-LIMITED: 0 downloaded before YouTube returned 429"; exit 1;;
  3) echo "[Cast] 9 new episodes to download."; echo "[Cast] Downloaded 5 episodes."; exit 0;;
  *) echo "[Cast] No new episodes."; exit 0;;
esac'
bash "$SKILL/run-catchup.sh" "$CASE/podcasts.yaml" >/dev/null 2>&1
rc=$?
check "survives two rate limits and finishes" "[ $rc = 0 ]"
check "first backoff is 15 min" "logtext | grep -q 'backing off 15 min'"
check "second backoff is 30 min" "logtext | grep -q 'backing off 30 min'"

# --- 3. backoff is capped at 120 min -----------------------------------------
new_case cap
fake_ingest '
if [ $N -le 7 ]; then echo "RATE-LIMITED: 0 downloaded before YouTube returned 429"; exit 1; fi
echo "[Cast] No new episodes."; exit 0'
bash "$SKILL/run-catchup.sh" "$CASE/podcasts.yaml" >/dev/null 2>&1
check "backoff reaches 120 min and stays there" "logtext | grep -c 'backing off 120 min' | grep -qx 4"

# --- 4. repeated plain failure stops after 3, with the reason ----------------
new_case stall
fake_ingest 'echo "ERROR something is broken"; exit 1'
bash "$SKILL/run-catchup.sh" "$CASE/podcasts.yaml" >/dev/null 2>&1
rc=$?
check "stops with exit 1 after three failures" "[ $rc = 1 ] && [ \"\$(cat '$CASE/calls')\" = 3 ]"
check "says why it stopped" "logtext | grep -q 'stopping: 3 iterations in a row made no progress' && logtext | grep -q 'something is broken'"

# --- 5. a failed iteration that still downloaded does not count as stalled ----
new_case partial
fake_ingest '
case $N in
  1|2|3|4) echo "[Cast] 30 new episodes to download."; echo "[Cast] Downloaded 3 episodes."; echo "ERROR one episode failed"; exit 1;;
  *) echo "[Cast] No new episodes."; exit 0;;
esac'
bash "$SKILL/run-catchup.sh" "$CASE/podcasts.yaml" >/dev/null 2>&1
check "progress with errors keeps going" "[ \"\$(cat '$CASE/calls')\" = 5 ]"

# --- 6. singleton lock -------------------------------------------------------
new_case lock
fake_ingest 'echo "[Cast] No new episodes."; exit 0'
( flock 9; sleep 6 ) 9>"$PODCAST_INGEST_LOCK" &
HOLDER=$!
sleep 0.5
out=$(bash "$SKILL/run-catchup.sh" "$CASE/podcasts.yaml" 2>&1)
rc=$?
check "the loop refuses to start while the lock is held" "[ $rc != 0 ] && echo \"$out\" | grep -q 'holds'"
check "and does not run the binary" "[ ! -f '$CASE/calls' ]"
out=$(bash "$SKILL/run-ingest.sh" "$CASE/podcasts.yaml" 2>&1)
rc=$?
check "the weekly run stands down with exit 0" "[ $rc = 0 ] && echo \"$out\" | grep -q 'standing down'"
check "and does not run the binary either" "[ ! -f '$CASE/calls' ]"
kill "$HOLDER" 2>/dev/null
wait "$HOLDER" 2>/dev/null
sleep 0.3
bash "$SKILL/run-ingest.sh" "$CASE/podcasts.yaml" >/dev/null 2>&1
check "the weekly run proceeds once the lock is free" "[ \"\$(cat '$CASE/calls')\" = 1 ]"
check "run-ingest.sh returns the binary's exit code" "fake_ingest 'exit 3'; bash '$SKILL/run-ingest.sh' '$CASE/podcasts.yaml' >/dev/null 2>&1; [ \$? = 3 ]"
check "and releases the lock afterwards" "flock -n '$PODCAST_INGEST_LOCK' true"

# --- 7. dream window (the clock is a hook: inside the window once, then after) -
new_case window
fake_ingest 'echo "[Cast] No new episodes."; exit 0'
CATCHUP_YIELD_START=00:30 CATCHUP_YIELD_END=05:10 CATCHUP_MINUTE_SECS=0 \
    CATCHUP_CLOCK_CMD="if [ -f '$CASE/clock-used' ]; then echo 06:00; else touch '$CASE/clock-used'; echo 02:00; fi" \
    timeout 20 bash "$SKILL/run-catchup.sh" "$CASE/podcasts.yaml" >/dev/null 2>&1
check "sleeps through the dream window, then runs" "logtext | grep -q 'dream window: sleeping 190 min' && logtext | grep -q 'catch-up complete'"
check "does not run the binary inside the window" "[ \"\$(cat '$CASE/calls')\" = 1 ]"
new_case window_edges
fake_ingest 'echo "[Cast] No new episodes."; exit 0'
for t in 00:29 05:10 12:00 23:59; do
    CATCHUP_YIELD_START=00:30 CATCHUP_YIELD_END=05:10 CATCHUP_CLOCK_CMD="echo $t" \
        bash "$SKILL/run-catchup.sh" "$CASE/podcasts.yaml" >/dev/null 2>&1
done
check "runs immediately outside the window (00:29, 05:10, 12:00, 23:59)" "[ \"\$(cat '$CASE/calls')\" = 4 ]"
new_case window_wrap
fake_ingest 'echo "[Cast] No new episodes."; exit 0'
CATCHUP_YIELD_START=23:00 CATCHUP_YIELD_END=02:00 CATCHUP_MINUTE_SECS=0 \
    CATCHUP_CLOCK_CMD="if [ -f '$CASE/clock-used' ]; then echo 03:00; else touch '$CASE/clock-used'; echo 23:30; fi" \
    timeout 20 bash "$SKILL/run-catchup.sh" "$CASE/podcasts.yaml" >/dev/null 2>&1
check "a window that wraps midnight waits 150 min from 23:30" "logtext | grep -q 'dream window: sleeping 150 min'"

# --- 8. SIGTERM stops it cleanly and forwards the signal ----------------------
new_case term
fake_ingest 'trap "echo TERMED >\"$CASE/termed\"; exit 143" TERM; echo "[Cast] 3 new episodes to download."; sleep 30 & wait $!'
bash "$SKILL/run-catchup.sh" "$CASE/podcasts.yaml" >/dev/null 2>&1 &
LOOP=$!
sleep 1.5
kill -TERM "$LOOP"
wait "$LOOP"
rc=$?
check "exits 0 on SIGTERM" "[ $rc = 0 ]"
check "logs that a signal stopped it" "logtext | grep -q 'stopped by signal'"
check "forwards SIGTERM to the binary" "[ -f '$CASE/termed' ]"

# --- 9. preflight ------------------------------------------------------------
new_case preflight
fake_ingest 'exit 0'
check "--check passes with a good setup" "bash '$SKILL/run-catchup.sh' --check '$CASE/podcasts.yaml' >/dev/null 2>&1"
check "--check does not run the binary" "[ ! -f '$CASE/calls' ]"
check "rejects a non-numeric batch" "! CATCHUP_BATCH=abc bash '$SKILL/run-catchup.sh' --check '$CASE/podcasts.yaml' >/dev/null 2>&1"
check "needs VAULT_TRANSCRIPTS" "! VAULT_TRANSCRIPTS= bash '$SKILL/run-catchup.sh' --check '$CASE/podcasts.yaml' >/dev/null 2>&1"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" = 0 ]
