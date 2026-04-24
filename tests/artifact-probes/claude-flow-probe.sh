#!/bin/bash
# Probe: @claude-flow/cli  (binary name: claude-flow)
# Gate: toolchains.claude_flow / ENABLE_CLAUDE_FLOW

set -euo pipefail

if [ "${ENABLE_CLAUDE_FLOW:-false}" != "true" ]; then
  echo "SKIP: ENABLE_CLAUDE_FLOW not set"
  exit 77
fi

if ! command -v claude-flow &>/dev/null; then
  echo "FAIL: claude-flow not found in PATH"
  exit 1
fi

if ! claude-flow --version >/dev/null 2>&1 && ! claude-flow --help >/dev/null 2>&1; then
  echo "FAIL: claude-flow --version and --help both exited non-zero"
  exit 1
fi

echo "PASS: claude-flow present"
exit 0
