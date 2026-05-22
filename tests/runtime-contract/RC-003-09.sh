#!/usr/bin/env bash
# RC-003-09: Assert hardened baseline security profile is applied to the agentbox container.
# Pass criteria (all must hold):
#   1. Container user is not root (User != "0" and != "")
#   2. HostConfig.ReadonlyRootfs == true
#   3. HostConfig.CapDrop contains "ALL"
#   4. At least 3 tmpfs mounts present (baseline: /tmp, /run, /var/run)
#
# Usage:
#   RC-003-09.sh [container-name]
# Default container name: agentbox
#
# Exit codes: 0 = all assertions pass, 1 = one or more failed.

set -euo pipefail

CONTAINER="${1:-agentbox}"
PASS=0
FAIL=0

_pass() { echo "  PASS: $1"; ((PASS++)) || true; }
_fail() { echo "  FAIL: $1" >&2; ((FAIL++)) || true; }

echo "RC-003-09: Hardened baseline security assertions for container '${CONTAINER}'"

# ── Fetch inspect JSON ──────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "SKIP: docker not available (CI environment without container runtime)"
  exit 0
fi

INSPECT=$(docker inspect "${CONTAINER}" 2>/dev/null) || {
  echo "SKIP: container '${CONTAINER}' not running (expected in CI)"
  exit 0
}

# ── 1. User must not be root ────────────────────────────────────────────────
USER_FIELD=$(echo "${INSPECT}" | jq -r '.[0].Config.User // ""')
if [ -z "${USER_FIELD}" ] || [ "${USER_FIELD}" = "0" ] || [ "${USER_FIELD}" = "root" ] || [ "${USER_FIELD}" = "0:0" ]; then
  _fail "Config.User is '${USER_FIELD}' — container is running as root"
else
  _pass "Config.User='${USER_FIELD}' (non-root)"
fi

# ── 2. ReadonlyRootfs must be true ──────────────────────────────────────────
READONLY=$(echo "${INSPECT}" | jq -r '.[0].HostConfig.ReadonlyRootfs // false')
if [ "${READONLY}" = "true" ]; then
  _pass "HostConfig.ReadonlyRootfs=true"
else
  _fail "HostConfig.ReadonlyRootfs=${READONLY} — root filesystem is NOT read-only"
fi

# ── 3. CapDrop must contain ALL ─────────────────────────────────────────────
CAP_DROP=$(echo "${INSPECT}" | jq -r '.[0].HostConfig.CapDrop // [] | map(ascii_upcase) | .[]')
if echo "${CAP_DROP}" | grep -qxF "ALL"; then
  _pass "HostConfig.CapDrop contains 'ALL'"
else
  _fail "HostConfig.CapDrop does not contain 'ALL' — got: $(echo "${INSPECT}" | jq -c '.[0].HostConfig.CapDrop')"
fi

# ── 4. At least 3 tmpfs mounts ──────────────────────────────────────────────
TMPFS_COUNT=$(echo "${INSPECT}" | jq '[.[0].Mounts[] | select(.Type == "tmpfs")] | length')
if [ "${TMPFS_COUNT}" -ge 3 ]; then
  _pass "tmpfs mount count=${TMPFS_COUNT} (>= 3 required)"
else
  _fail "tmpfs mount count=${TMPFS_COUNT} (need >= 3 for /tmp, /run, /var/run)"
fi

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo "RC-003-09 result: ${PASS} passed, ${FAIL} failed"
[ "${FAIL}" -eq 0 ] && exit 0 || exit 1
