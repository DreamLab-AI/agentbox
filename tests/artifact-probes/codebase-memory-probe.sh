#!/bin/bash
# Probe: codebase-memory-mcp CLI  (binary name: codebase-memory-mcp)
# Gate: toolchains.codebase_memory / ENABLE_CODEBASE_MEMORY

set -euo pipefail

if [ "${ENABLE_CODEBASE_MEMORY:-false}" != "true" ]; then
  echo "SKIP: ENABLE_CODEBASE_MEMORY not set"
  exit 77
fi

if ! command -v codebase-memory-mcp &>/dev/null; then
  echo "FAIL: codebase-memory-mcp not found in PATH"
  exit 1
fi

if ! codebase-memory-mcp --version >/dev/null 2>&1 && ! codebase-memory-mcp --help >/dev/null 2>&1; then
  echo "FAIL: codebase-memory-mcp --version and --help both exited non-zero"
  exit 1
fi

echo "PASS: codebase-memory-mcp present"
exit 0
