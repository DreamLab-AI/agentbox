#!/bin/bash
# Probe: skills/lazy-fetch/mcp-server npm service closure
# Gate: toolchains.ruflo / ENABLE_RUFLO or toolchains.claude_flow / ENABLE_CLAUDE_FLOW
# PRD-002 §9 Phase 1 — RC-002-02 artifact probe

set -euo pipefail

if [ "${ENABLE_RUFLO:-false}" != "true" ] && [ "${ENABLE_CLAUDE_FLOW:-false}" != "true" ]; then
  echo "SKIP: neither ENABLE_RUFLO nor ENABLE_CLAUDE_FLOW is set"
  exit 77
fi

SERVICE_DIR="/opt/agentbox/skills/lazy-fetch/mcp-server"

if [ ! -d "$SERVICE_DIR/node_modules" ]; then
  echo "FAIL: $SERVICE_DIR/node_modules not present — image was not built with PRD-002 Phase 1 packaging"
  exit 1
fi

# TypeScript build output must exist
if [ ! -f "$SERVICE_DIR/dist/mcp-server.js" ]; then
  echo "FAIL: $SERVICE_DIR/dist/mcp-server.js missing — TypeScript compilation (tsc) did not run during Nix build"
  exit 1
fi

echo "PASS: lazy-fetch-mcp closure present at $SERVICE_DIR"
exit 0
