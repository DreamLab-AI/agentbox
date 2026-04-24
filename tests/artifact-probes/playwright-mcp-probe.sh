#!/bin/bash
# Probe: skills/playwright/mcp-server npm service closure
# Gate: skills.browser.playwright / ENABLE_PLAYWRIGHT
# PRD-002 §9 Phase 1 — RC-002-02 artifact probe
#
# NOTE: Playwright browsers are NOT probed here — they are supplied by
# pkgs.playwright-driver.browsers and must be present at the path exported
# in PLAYWRIGHT_BROWSERS_PATH.  A separate browser probe in
# tests/artifact-probes/playwright-probe.sh covers that path.

set -euo pipefail

if [ "${ENABLE_PLAYWRIGHT:-false}" != "true" ]; then
  echo "SKIP: ENABLE_PLAYWRIGHT not set"
  exit 77
fi

SERVICE_DIR="/opt/agentbox/skills/playwright/mcp-server"

if [ ! -d "$SERVICE_DIR/node_modules" ]; then
  echo "FAIL: $SERVICE_DIR/node_modules not present — image was not built with PRD-002 Phase 1 packaging"
  exit 1
fi

if [ ! -f "$SERVICE_DIR/server.js" ]; then
  echo "FAIL: $SERVICE_DIR/server.js missing"
  exit 1
fi

# Browser path must be set and non-empty; the actual browser binary is
# tested by playwright-probe.sh.
if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ]; then
  echo "FAIL: PLAYWRIGHT_BROWSERS_PATH not set — check imageEnv in flake.nix"
  exit 1
fi

echo "PASS: playwright-mcp closure present at $SERVICE_DIR; PLAYWRIGHT_BROWSERS_PATH=$PLAYWRIGHT_BROWSERS_PATH"
exit 0
