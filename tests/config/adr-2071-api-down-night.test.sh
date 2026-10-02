#!/usr/bin/env bash
# ============================================================================
# adr-2071-api-down-night.test.sh — the ADR-2071 clause (c) one-shot
# ----------------------------------------------------------------------------
# Drives scripts/activation/adr-2071-api-down-night.sh tick by tick against a
# scratch WORKSPACE, a stub supervisorctl that keeps the program's status in a
# file, and a pinned clock (ADR2071_NOW). The real supervisor is never touched.
#
# Usage:  bash tests/config/adr-2071-api-down-night.test.sh
# Exit:   0 = every case passed, 1 = at least one failed.
# ============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "${HERE}/../.." && pwd)"
SCRIPT="${REPO}/scripts/activation/adr-2071-api-down-night.sh"

PASS=0; FAIL=0
ok()   { PASS=$((PASS + 1)); echo "  ok   $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (got '$2', want '$3')"; fi; }

SCRATCH="$(mktemp -d)"
trap 'rm -rf "$SCRATCH"' EXIT

# Stub supervisorctl: status/stop/start on one program, state in a file.
STUB="$SCRATCH/supervisorctl"
cat > "$STUB" <<'EOF'
#!/usr/bin/env bash
f="$STUB_STATE"
[ -r "$f" ] || echo RUNNING > "$f"
case "$1" in
  status) printf '%-32s %s\n' "$2" "$(cat "$f")" ;;
  stop)   echo STOPPED > "$f"; echo "$2: stopped"; echo "stop" >> "$f.calls" ;;
  start)  echo RUNNING > "$f"; echo "$2: started"; echo "start" >> "$f.calls" ;;
esac
EOF
chmod +x "$STUB"

at() { TZ=UTC date -u -d "$1" +%s; }

fresh() {
  WS="$SCRATCH/ws-$1"; rm -rf "$WS"; mkdir -p "$WS/.agentbox"
  export STUB_STATE="$WS/api.status"; rm -f "$STUB_STATE" "$STUB_STATE.calls"
}
# The script runs under supercronic's PATH for [program:podcast-cron], which has
# coreutils but no sed or awk: give it exactly that (coreutils + /bin:/usr/bin
# minus anything else), so a regression to sed/awk fails here, not at 00:30.
COREUTILS_DIR="$(dirname "$(command -v date)")"
CRON_PATH="$SCRATCH/cronbin:$COREUTILS_DIR"
mkdir -p "$SCRATCH/cronbin"; ln -sf "$(command -v bash)" "$SCRATCH/cronbin/bash"
tick() { env -i PATH="$CRON_PATH" STUB_STATE="$STUB_STATE" WORKSPACE="$WS" SUPERVISORCTL="$STUB" \
  ADR2071_NOW="$(at "$1")" TZ=Europe/London bash "$SCRIPT" >/dev/null 2>&1; }
api() { cat "$STUB_STATE" 2>/dev/null || echo RUNNING; }
calls() { cat "$STUB_STATE.calls" 2>/dev/null | tr '\n' ' ' | sed 's/ $//'; }
st() { sed -n "s/^$1=//p" "$WS/.agentbox/adr-2071-api-down-night.state" 2>/dev/null | tail -1; }
night() { printf '{\n  "date": "%s",\n  "outcomes": []\n}\n' "$1" > "$WS/.agentbox/dream-last-night.json"; }

echo "no marker: nothing happens, even inside the stop slot"
fresh nomarker
tick "2026-10-06 00:40"
check "API untouched" "$(api)" RUNNING
check "no supervisorctl stop/start" "$(calls)" ""

echo "the happy path: stop at 00:40 UTC, hold, restart on the night record"
fresh happy
echo 2026-10-06 > "$WS/.agentbox/adr-2071-api-down-night"
night 2026-10-05
tick "2026-10-05 23:50";  check "the evening before (BST 00:50 on the 6th) does nothing" "$(api)" RUNNING
tick "2026-10-06 00:20";  check "00:20 UTC is too early" "$(api)" RUNNING
tick "2026-10-06 00:40";  check "00:40 UTC stops it" "$(api)" STOPPED
check "phase=stopped" "$(st phase)" stopped
tick "2026-10-06 00:50";  check "a second tick in the slot does not stop twice" "$(calls)" "stop"
tick "2026-10-06 02:00";  check "held while the night runs (old record)" "$(api)" STOPPED
night 2026-10-06
tick "2026-10-06 03:10";  check "restarted once the night record is today's" "$(api)" RUNNING
check "reason=night-record" "$(st reason)" night-record
check "phase=done" "$(st phase)" done
check "marker retired" "$([ -e "$WS/.agentbox/adr-2071-api-down-night.consumed" ] && [ ! -e "$WS/.agentbox/adr-2071-api-down-night" ] && echo yes)" yes
tick "2026-10-07 00:40";  check "inert afterwards" "$(calls)" "stop start"

echo "deadline: no night record by 07:30 UTC still restarts it"
fresh deadline
echo 2026-10-06 > "$WS/.agentbox/adr-2071-api-down-night"
tick "2026-10-06 00:30"; check "stopped" "$(api)" STOPPED
tick "2026-10-06 07:20"; check "held at 07:20" "$(api)" STOPPED
tick "2026-10-06 07:30"; check "restarted at 07:30" "$(api)" RUNNING
check "reason=deadline" "$(st reason)" deadline

echo "container restart mid-night: supervisord brought the API back"
fresh restart
echo 2026-10-06 > "$WS/.agentbox/adr-2071-api-down-night"
tick "2026-10-06 00:30"; check "stopped" "$(api)" STOPPED
echo RUNNING > "$STUB_STATE"
tick "2026-10-06 01:40"; check "reason=interrupted" "$(st reason)" interrupted
check "phase=done" "$(st phase)" done

echo "missed slot: first tick after 01:00 never stops the API"
fresh missed
echo 2026-10-06 > "$WS/.agentbox/adr-2071-api-down-night"
tick "2026-10-06 01:10"; check "API left up" "$(api)" RUNNING
check "phase=missed" "$(st phase)" missed
check "no stop issued" "$(calls)" ""

echo "dreaming paused: the run is not attempted"
fresh paused
echo 2026-10-06 > "$WS/.agentbox/adr-2071-api-down-night"
touch "$WS/.agentbox/dream-paused"
tick "2026-10-06 00:40"; check "API left up" "$(api)" RUNNING
check "reason=dream-paused" "$(st reason)" dream-paused

echo "a malformed marker is ignored"
fresh junk
echo "monday" > "$WS/.agentbox/adr-2071-api-down-night"
tick "2026-10-06 00:40"; check "API left up" "$(api)" RUNNING

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
