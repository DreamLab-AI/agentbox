#!/usr/bin/env bash
# register-mcp.sh — on-demand registration of the Blender MCP server into the
# workspace .mcp.json, so BlenderMCP tools appear natively in the session.
#
# WHY on-demand: BlenderMCP is a heavy, GPU-sidecar-backed capability. Registering it
# unconditionally would spin up a connection in every session even when no 3D work is
# happening. Instead the `blender` skill registers it lazily — this is the "MCP on
# demand as part of progressive discovery" path. (You don't strictly need it: the
# supervised proxy already exposes the socket on localhost:9876, and tools/
# mcp-blender-client.js bridges it — but native tools are nicer when doing real work.)
#
# The registered server is `uvx blender-mcp`, which connects to localhost:9876 (the
# agentbox proxy → gui-tools-service sidecar). Idempotent: re-running is a no-op.
#
# Usage: register-mcp.sh [--remove]
set -uo pipefail

MCP_JSON="${MCP_JSON:-${WORKSPACE:-/home/devuser/workspace}/.mcp.json}"
MODE="${1:-add}"

command -v node >/dev/null 2>&1 || { echo "register-mcp: node required"; exit 1; }

REMOVE=0
[ "$MODE" = "--remove" ] && REMOVE=1

node - "$MCP_JSON" "$REMOVE" <<'NODE'
const fs = require('fs');
const [path, removeFlag] = process.argv.slice(2);
const remove = removeFlag === '1';
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path, 'utf8')); } catch (_) { cfg = {}; }
cfg.mcpServers = cfg.mcpServers || {};
if (remove) {
  if (cfg.mcpServers.blender) { delete cfg.mcpServers.blender; console.log('register-mcp: removed blender from', path); }
  else console.log('register-mcp: blender not present, nothing to remove');
} else if (cfg.mcpServers.blender) {
  console.log('register-mcp: blender already registered in', path, '(no-op)');
} else {
  cfg.mcpServers.blender = {
    command: 'uvx',
    args: ['blender-mcp'],
    // uvx blender-mcp connects to BLENDER_HOST:BLENDER_PORT — the agentbox proxy
    // (localhost:9876) bridges to the gui-tools-service sidecar.
    env: { BLENDER_HOST: 'localhost', BLENDER_PORT: '9876' },
  };
  console.log('register-mcp: added blender (uvx blender-mcp -> localhost:9876) to', path);
}
fs.writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n');
NODE

echo "register-mcp: done. Restart the session (or reload MCP) for tools to appear."
