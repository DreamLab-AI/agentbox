#!/bin/bash
# Probe: mcp/nostr-bridge npm service closure
# Gate: sovereign_mesh.enabled / SOVEREIGN_MESH_ENABLED
# PRD-002 §9 Phase 1 — RC-002-02 artifact probe

set -euo pipefail

if [ "${SOVEREIGN_MESH_ENABLED:-false}" != "true" ]; then
  echo "SKIP: SOVEREIGN_MESH_ENABLED not set"
  exit 77
fi

SERVICE_DIR="/opt/agentbox/mcp"
ENTRY="$SERVICE_DIR/servers/nostr-bridge.js"

if [ ! -d "$SERVICE_DIR/node_modules" ]; then
  echo "FAIL: $SERVICE_DIR/node_modules not present — image was not built with PRD-002 Phase 1 packaging"
  exit 1
fi

if [ ! -f "$ENTRY" ]; then
  echo "FAIL: $ENTRY missing"
  exit 1
fi

echo "PASS: nostr-bridge closure present at $SERVICE_DIR"
exit 0
