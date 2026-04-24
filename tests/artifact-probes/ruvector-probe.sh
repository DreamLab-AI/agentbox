#!/bin/bash
# Probe: ruvector CLI
# ruvector is always enabled (not feature-gated).
# Asserts: ruvector binary is in PATH and responds to --version.

set -euo pipefail

if ! command -v ruvector &>/dev/null; then
  echo "FAIL: ruvector not found in PATH"
  exit 1
fi

if ! ruvector --version >/dev/null 2>&1; then
  echo "FAIL: ruvector --version exited non-zero"
  exit 1
fi

echo "PASS: ruvector present ($(ruvector --version 2>&1 | head -1))"
exit 0
