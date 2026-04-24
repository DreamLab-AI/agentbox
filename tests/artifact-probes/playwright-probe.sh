#!/bin/bash
# Probe: playwright CLI
# Gate: skills.browser.playwright / ENABLE_PLAYWRIGHT
# Requires: PLAYWRIGHT_BROWSERS_PATH is set by the Nix wrapper to pkgs.playwright-driver.browsers

set -euo pipefail

if [ "${ENABLE_PLAYWRIGHT:-false}" != "true" ]; then
  echo "SKIP: ENABLE_PLAYWRIGHT not set"
  exit 77
fi

if ! command -v playwright &>/dev/null; then
  echo "FAIL: playwright not found in PATH"
  exit 1
fi

if ! playwright --version >/dev/null 2>&1 && ! playwright --help >/dev/null 2>&1; then
  echo "FAIL: playwright --version and --help both exited non-zero"
  exit 1
fi

echo "PASS: playwright present (PLAYWRIGHT_BROWSERS_PATH=${PLAYWRIGHT_BROWSERS_PATH:-<unset>})"
exit 0
