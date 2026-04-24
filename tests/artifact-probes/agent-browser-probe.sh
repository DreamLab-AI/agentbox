#!/bin/bash
# Probe: agent-browser CLI
# Gate: skills.browser.agent_browser / ENABLE_AGENT_BROWSER
# Requires: CHROME_PATH is injected by the Nix wrapper (pkgs.chromium)

set -euo pipefail

if [ "${ENABLE_AGENT_BROWSER:-false}" != "true" ]; then
  echo "SKIP: ENABLE_AGENT_BROWSER not set"
  exit 77
fi

if ! command -v agent-browser &>/dev/null; then
  echo "FAIL: agent-browser not found in PATH"
  exit 1
fi

if ! agent-browser --version >/dev/null 2>&1 && ! agent-browser --help >/dev/null 2>&1; then
  echo "FAIL: agent-browser --version and --help both exited non-zero"
  exit 1
fi

echo "PASS: agent-browser present (CHROME_PATH=${CHROME_PATH:-<unset>})"
exit 0
