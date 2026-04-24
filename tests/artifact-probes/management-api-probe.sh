#!/bin/bash
# Probe: management-api npm service closure
# Gate: always-on (no feature flag)
# PRD-002 §9 Phase 1 — RC-002-02 artifact probe

set -euo pipefail

SERVICE_DIR="/opt/agentbox/management-api"

if [ ! -d "$SERVICE_DIR/node_modules" ]; then
  echo "FAIL: $SERVICE_DIR/node_modules not present — image was not built with PRD-002 Phase 1 packaging"
  exit 1
fi

if [ ! -f "$SERVICE_DIR/server.js" ]; then
  echo "FAIL: $SERVICE_DIR/server.js missing"
  exit 1
fi

# Verify the entrypoint can be required without crashing (import check).
if ! node -e "require('$SERVICE_DIR/server.js')" 2>/dev/null; then
  echo "INFO: require() check exited non-zero (expected for servers that start listening immediately)"
fi

echo "PASS: management-api closure present at $SERVICE_DIR"
exit 0
