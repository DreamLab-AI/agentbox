#!/bin/bash
# Probe: skills/comfyui/mcp-server npm service closure
# Gate: skills.media.comfyui_builtin / ENABLE_COMFYUI_BUILTIN
# PRD-002 §9 Phase 1 — RC-002-02 artifact probe
#
# NOTE: The comfyui-mcp derivation adds python3 + node-gyp for the sharp native
# binding.  This probe checks that the compiled native addon is present at
# node_modules/sharp/build/Release/sharp.node.

set -euo pipefail

if [ "${ENABLE_COMFYUI_BUILTIN:-false}" != "true" ]; then
  echo "SKIP: ENABLE_COMFYUI_BUILTIN not set"
  exit 77
fi

SERVICE_DIR="/opt/agentbox/skills/comfyui/mcp-server"

if [ ! -d "$SERVICE_DIR/node_modules" ]; then
  echo "FAIL: $SERVICE_DIR/node_modules not present — image was not built with PRD-002 Phase 1 packaging"
  exit 1
fi

if [ ! -f "$SERVICE_DIR/server.js" ]; then
  echo "FAIL: $SERVICE_DIR/server.js missing"
  exit 1
fi

# sharp native addon check
SHARP_ADDON="$SERVICE_DIR/node_modules/sharp/build/Release/sharp.node"
if [ ! -f "$SHARP_ADDON" ]; then
  echo "FAIL: sharp native addon not found at $SHARP_ADDON — native gyp rebuild may have failed during Nix build"
  exit 1
fi

echo "PASS: comfyui-mcp closure present at $SERVICE_DIR (sharp native addon: present)"
exit 0
