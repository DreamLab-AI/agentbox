#!/bin/bash
# Probe: ruflo CLI
# Gate: toolchains.ruflo / ENABLE_RUFLO

set -euo pipefail

if [ "${ENABLE_RUFLO:-false}" != "true" ]; then
  echo "SKIP: ENABLE_RUFLO not set"
  exit 77
fi

if ! command -v ruflo &>/dev/null; then
  echo "FAIL: ruflo not found in PATH"
  exit 1
fi

if ! ruflo --version >/dev/null 2>&1 && ! ruflo --help >/dev/null 2>&1; then
  echo "FAIL: ruflo --version and --help both exited non-zero"
  exit 1
fi

echo "PASS: ruflo present"
exit 0
