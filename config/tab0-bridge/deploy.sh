#!/usr/bin/env bash
# Deploy-reconcile the tab0-bridge from this canonical source into the
# workspace volume. Idempotent, fail-open — safe to nohup from the fleet
# SessionStart hook on every session. Jobs:
#   1. Copy source files into ~/workspace/tab0-bridge when they differ.
#   2. Install production deps on a fresh workspace volume.
#   3. (Re)start the bridge when it is down or its code changed.
#
# Two modes (Finding 3, security audit 2026-08):
#   deploy.sh reconcile   — jobs 1+2 only (copy source + install deps), NO
#                           process launch. This is what supervisor's
#                           [program:tab0-bridge] runs before it execs the
#                           bridge itself in the foreground.
#   deploy.sh             — jobs 1+2, then belt-and-braces launch (job 3) ONLY
#                           when supervisor does NOT own the process. When
#                           AGENTBOX_TAB0_BRIDGE_SUPERVISED=1 (set on the same
#                           gate as the supervisor block) we reconcile files and
#                           defer the lifecycle to supervisor — no double launch.
#
# Off switch: AGENTBOX_TAB0_BRIDGE=0 (enforced by the calling hook).
set -u
MODE="${1:-run}"
SRC="$(cd "$(dirname "$0")" 2>/dev/null && pwd)" || exit 0
DST="${WORKSPACE:-$HOME/workspace}/tab0-bridge"
mkdir -p "$DST" 2>/dev/null || exit 0

# No cmp/diff in the Nix image — compare by md5. A missing destination file
# hashes to nothing and therefore always registers as changed.
same() { [ "$(md5sum <"$1" 2>/dev/null)" = "$(md5sum <"$2" 2>/dev/null)" ] && [ -f "$2" ]; }
changed=0
for f in server.mjs turn-sink.cjs start.sh package.json; do
  if [ -f "$SRC/$f" ] && ! same "$SRC/$f" "$DST/$f"; then
    cp "$SRC/$f" "$DST/$f" 2>/dev/null && changed=1
  fi
done

if [ ! -d "$DST/node_modules/ws" ] && command -v npm >/dev/null 2>&1; then
  (cd "$DST" && npm install --omit=dev >>"$DST/bridge.log" 2>&1) || exit 0
fi

# Reconcile-only mode (supervisor path): source + deps are now in place; the
# supervisor block execs `node server.mjs` itself in the foreground. Also stop
# here when supervisor owns the process — the hook must never launch a rival.
if [ "$MODE" = "reconcile" ] || [ "${AGENTBOX_TAB0_BRIDGE_SUPERVISED:-0}" = "1" ]; then
  exit 0
fi

# ---- Belt-and-braces launch (non-supervised deployments only) ---------------
alive() { curl -sf -m 2 "http://127.0.0.1:${BRIDGE_PORT:-8971}/health" >/dev/null 2>&1; }

if [ "$changed" = 1 ]; then
  # Only instances launched by this script (absolute path) can be restarted;
  # a legacy hand-launched `node server.mjs` is left alone until next boot.
  pid="$(pgrep -f 'tab0-bridge/server\.mjs' 2>/dev/null | head -1 || true)"
  if [ -n "$pid" ]; then kill "$pid" 2>/dev/null; sleep 1; fi
fi

if ! alive; then
  nohup node "$DST/server.mjs" >>"$DST/bridge.log" 2>&1 &
  disown 2>/dev/null || true
fi
exit 0
