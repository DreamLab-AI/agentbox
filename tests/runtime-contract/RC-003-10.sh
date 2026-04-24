#!/usr/bin/env bash
# RC-003-10: Assert that the desktop exception delta is merged additively.
# When [desktop].enabled=true the exception block adds /tmp/.X11-unix and
# /run/user/1000 to the tmpfs list while CapDrop still contains ALL (union,
# not replace).
#
# Pass criteria (all must hold):
#   1. /tmp/.X11-unix is in the tmpfs mounts
#   2. /run/user/1000 is in the tmpfs mounts
#   3. HostConfig.CapDrop still contains "ALL" (baseline not lost)
#
# Pre-condition: container must have been started from a compose generated with
#   [desktop].enabled = true  AND  [security.exceptions.desktop] declared.
#
# Usage:
#   RC-003-10.sh [container-name]
# Default container name: agentbox
#
# Exit codes: 0 = all assertions pass, 1 = one or more failed.

set -euo pipefail

CONTAINER="${1:-agentbox}"
PASS=0
FAIL=0

_pass() { echo "  PASS: $1"; ((PASS++)) || true; }
_fail() { echo "  FAIL: $1" >&2; ((FAIL++)) || true; }

echo "RC-003-10: Desktop exception merge assertions for container '${CONTAINER}'"

# ── Fetch inspect JSON ──────────────────────────────────────────────────────
INSPECT=$(docker inspect "${CONTAINER}" 2>/dev/null) || {
  echo "ERROR: cannot inspect container '${CONTAINER}'" >&2
  exit 1
}

# ── 1. /tmp/.X11-unix must be a tmpfs mount ─────────────────────────────────
X11_MOUNT=$(echo "${INSPECT}" | jq -r '
  .[0].Mounts[]
  | select(.Type == "tmpfs" and (.Destination == "/tmp/.X11-unix" or .Source == "/tmp/.X11-unix"))
  | .Destination
' 2>/dev/null | head -1)

if [ -n "${X11_MOUNT}" ]; then
  _pass "/tmp/.X11-unix is a tmpfs mount (desktop exception applied)"
else
  _fail "/tmp/.X11-unix is NOT in tmpfs mounts — desktop exception not merged"
fi

# ── 2. /run/user/1000 must be a tmpfs mount ─────────────────────────────────
RUNUSER_MOUNT=$(echo "${INSPECT}" | jq -r '
  .[0].Mounts[]
  | select(.Type == "tmpfs" and (.Destination == "/run/user/1000" or .Source == "/run/user/1000"))
  | .Destination
' 2>/dev/null | head -1)

if [ -n "${RUNUSER_MOUNT}" ]; then
  _pass "/run/user/1000 is a tmpfs mount (desktop exception applied)"
else
  _fail "/run/user/1000 is NOT in tmpfs mounts — desktop exception not merged"
fi

# ── 3. CapDrop still contains ALL (union, not replace) ──────────────────────
CAP_DROP=$(echo "${INSPECT}" | jq -r '.[0].HostConfig.CapDrop // [] | map(ascii_upcase) | .[]')
if echo "${CAP_DROP}" | grep -qxF "ALL"; then
  _pass "HostConfig.CapDrop still contains 'ALL' (baseline not erased by union merge)"
else
  _fail "HostConfig.CapDrop no longer contains 'ALL' — exception merge replaced baseline"
fi

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "RC-003-10 result: ${PASS} passed, ${FAIL} failed"
[ "${FAIL}" -eq 0 ] && exit 0 || exit 1
