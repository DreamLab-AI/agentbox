#!/usr/bin/env bash
# Smoke tests for agentbox.sh local lifecycle verbs.
# Verifies that each new verb accepts --help and exits 0 without requiring
# Docker, Nix, or a running stack.

set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/agentbox.sh"

PASS=0
FAIL=0

check() {
    local label="$1"; shift
    if "$@" >/dev/null 2>&1; then
        echo "  PASS  ${label}"
        (( PASS++ )) || true
    else
        echo "  FAIL  ${label}  (exit $?)"
        (( FAIL++ )) || true
    fi
}

echo "agentbox.sh smoke tests"
echo "========================"

# Global --help
check "global --help"           bash "$SCRIPT" --help

# Local lifecycle verbs
check "up --help"               bash "$SCRIPT" up --help
check "down --help"             bash "$SCRIPT" down --help
check "build --help"            bash "$SCRIPT" build --help
check "rebuild --help"          bash "$SCRIPT" rebuild --help
check "logs --help"             bash "$SCRIPT" logs --help
check "shell --help"            bash "$SCRIPT" shell --help
check "health --help"           bash "$SCRIPT" health --help

# Pre-existing verbs still reachable
check "backup in usage"         bash -c "bash '$SCRIPT' --help | grep -q backup"
check "restore in usage"        bash -c "bash '$SCRIPT' --help | grep -q restore"

# Gemini CLI toolchain check (when enabled, gemini --help should work)
if command -v gemini &>/dev/null; then
    check "gemini --help"           gemini --help
    check "gemini --version"        gemini --version
else
    echo "  SKIP  gemini --help (toolchain not installed)"
    echo "  SKIP  gemini --version (toolchain not installed)"
fi

# Codex Rust CLI toolchain check (when [toolchains.codex]=true)
if command -v codex &>/dev/null; then
    check "codex --help"            codex --help
    check "codex --version"         codex --version
else
    echo "  SKIP  codex --help (toolchain not installed)"
    echo "  SKIP  codex --version (toolchain not installed)"
fi

echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[[ "$FAIL" -eq 0 ]]
