#!/bin/bash
# Probe: skills/openai-codex/mcp-server npm service closure
# Gate: toolchains.codex / ENABLE_CODEX
# PRD-002 §9 Phase 1 — RC-002-02 artifact probe

set -euo pipefail

if [ "${ENABLE_CODEX:-false}" != "true" ]; then
  echo "SKIP: ENABLE_CODEX not set"
  exit 77
fi

SERVICE_DIR="/opt/agentbox/skills/openai-codex/mcp-server"

if [ ! -d "$SERVICE_DIR/node_modules" ]; then
  echo "FAIL: $SERVICE_DIR/node_modules not present — image was not built with PRD-002 Phase 1 packaging"
  exit 1
fi

if [ ! -f "$SERVICE_DIR/server.js" ]; then
  echo "FAIL: $SERVICE_DIR/server.js missing"
  exit 1
fi

echo "PASS: openai-codex-mcp closure present at $SERVICE_DIR"
exit 0
