#!/usr/bin/env bash
# RC-002-03 — Stage B install-lint (PRD-002 §6 AC-1)
#
# Pure file lint — no Docker required.
#
# Greps config/entrypoint-unified.sh for any package-manager install or
# dependency-download invocation that is NOT commented out.  Zero matches
# required for the test to pass.
#
# Patterns checked (PRD-002 §6 AC-1):
#   npm install
#   pnpm install
#   pip install
#   playwright install
#   npm install -g
#   npx.*install
#
# Also reports (but does not fail on) commented-out install calls so maintainers
# are aware of residual commented code.
#
# Exit codes
#   0  — zero un-commented install lines found
#   1  — one or more un-commented install lines found

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENTRYPOINT="${REPO_ROOT}/config/entrypoint-unified.sh"

TAP_N=0
TAP_FAIL=0

_tap_ok()     { TAP_N=$(( TAP_N + 1 )); echo "ok ${TAP_N} - $1"; }
_tap_not_ok() { TAP_N=$(( TAP_N + 1 )); echo "not ok ${TAP_N} - $1"; TAP_FAIL=$(( TAP_FAIL + 1 )); }

# ── guard: file must exist ────────────────────────────────────────────────────
if [ ! -f "${ENTRYPOINT}" ]; then
    echo "not ok 1 - entrypoint file exists at ${ENTRYPOINT}"
    echo "1..1"
    exit 1
fi
_tap_ok "entrypoint file exists at config/entrypoint-unified.sh"

# ── installer pattern grep ────────────────────────────────────────────────────
INSTALL_PATTERN='npm install|pnpm install|pip install|playwright install|npm install -g|npx[[:space:]].*install'

# Un-commented install lines (lines that are NOT pure comment lines)
offending=$(grep -En "${INSTALL_PATTERN}" "${ENTRYPOINT}" \
    | grep -Ev '^[0-9]+:[[:space:]]*(#|[[:space:]]*#)' \
    || true)

if [ -z "$offending" ]; then
    _tap_ok "no un-commented package-manager install calls in entrypoint"
else
    _tap_not_ok "no un-commented package-manager install calls in entrypoint"
    echo "# offending lines (line:content):" >&2
    echo "$offending" | sed 's/^/#   /' >&2
fi

# ── informational: commented-out install lines ────────────────────────────────
commented=$(grep -En "${INSTALL_PATTERN}" "${ENTRYPOINT}" \
    | grep -E '^[0-9]+:[[:space:]]*(#|[[:space:]]*#)' \
    || true)

if [ -n "$commented" ]; then
    echo "# INFO: the following commented-out install lines remain in the entrypoint:"
    echo "$commented" | sed 's/^/#   /'
    echo "# These are inert but may indicate incomplete cleanup from PRD-002 Phase 4."
fi

# ── secondary check: no || true safety-net around install calls ──────────────
# A pattern like "npm install ... || true" indicates a best-effort install
# that PRD-002 §5.4 explicitly prohibits.
safety_net=$(grep -En 'npm install|pnpm install|pip install|playwright install' \
    "${ENTRYPOINT}" \
    | grep '|| true' \
    | grep -Ev '^[0-9]+:[[:space:]]*(#|[[:space:]]*#)' \
    || true)

if [ -z "$safety_net" ]; then
    _tap_ok "no '|| true' silent-failure pattern around install calls"
else
    _tap_not_ok "no '|| true' silent-failure pattern around install calls"
    echo "# offending lines:" >&2
    echo "$safety_net" | sed 's/^/#   /' >&2
fi

# ── summary ───────────────────────────────────────────────────────────────────
echo "1..${TAP_N}"
[ "$TAP_FAIL" -eq 0 ] && exit 0 || exit 1
