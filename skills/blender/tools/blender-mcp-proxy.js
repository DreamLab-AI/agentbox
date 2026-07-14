#!/usr/bin/env node

/**
 * Blender MCP Proxy — the "client / federated" transport for the Blender skill.
 *
 * Bridges a local BlenderMCP socket (localhost:9876, what agents connect to) to a
 * Blender running in an external GPU-capable GUI sidecar (default gui-tools-service:9876).
 *
 * WHY A PROXY AND NOT LOCAL BLENDER:
 * The BlenderMCP addon runs its command server inside Blender's GUI event loop
 * (it marshals execute_code onto the main thread via bpy.app.timers). That needs a
 * real OpenGL context. Agentbox's in-container VNC display (TigerVNC :1) does NOT
 * advertise GLX_ARB_create_context, so GUI Blender cannot obtain a context there —
 * which is why Blender is served from an external GPU/VirtualGL sidecar and bridged
 * here, rather than run locally. See docs/user/blender.md.
 *
 * Config (env):
 *   GUI_CONTAINER_HOST        upstream Blender host   (default: gui-tools-service)
 *   GUI_BLENDER_PORT          upstream Blender port   (default: 9876)
 *   LOCAL_BLENDER_PROXY_PORT  local listen port       (default: 9876)
 *
 * Health: `node tools/blender-health.js` round-trips get_scene_info and reports
 * refused / silent-close / timeout / ok. If the sidecar is down, this proxy accepts
 * the connection but the upstream connect fails — surfaced clearly in the log below
 * (and seen by the health check as `silent-close`, not `refused`).
 */

const net = require('net');

const GUI_CONTAINER_HOST = process.env.GUI_CONTAINER_HOST || 'gui-tools-service';
const GUI_BLENDER_PORT = parseInt(process.env.GUI_BLENDER_PORT || '9876', 10);
const LOCAL_PROXY_PORT = parseInt(process.env.LOCAL_BLENDER_PROXY_PORT || '9876', 10);

console.log(`[blender-mcp-proxy] bridging 127.0.0.1:${LOCAL_PROXY_PORT} -> ${GUI_CONTAINER_HOST}:${GUI_BLENDER_PORT}`);

// Throttle repeated upstream-down warnings so a polling client can't flood the log.
let lastUpstreamWarn = 0;
function warnUpstream(reason) {
  const now = Date.now();
  if (now - lastUpstreamWarn < 15000) return;
  lastUpstreamWarn = now;
  console.error(
    `[blender-mcp-proxy] upstream ${GUI_CONTAINER_HOST}:${GUI_BLENDER_PORT} unreachable (${reason}). ` +
    `The Blender GUI sidecar is not running. Start it (or set GUI_CONTAINER_HOST to a live ` +
    `BlenderMCP host). A client connecting now will see the socket accept then close with no data.`,
  );
}

const server = net.createServer((clientSocket) => {
  const guiSocket = net.createConnection({ host: GUI_CONTAINER_HOST, port: GUI_BLENDER_PORT });

  // Only pipe once the upstream is actually connected, so a dead sidecar produces a
  // clear log line rather than a silent half-open bridge.
  guiSocket.on('connect', () => {
    clientSocket.pipe(guiSocket);
    guiSocket.pipe(clientSocket);
  });

  guiSocket.on('error', (err) => {
    warnUpstream(err.code || err.message);
    clientSocket.destroy();
  });

  clientSocket.on('error', () => guiSocket.destroy());
  clientSocket.on('close', () => guiSocket.destroy());
  guiSocket.on('close', () => clientSocket.destroy());
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[blender-mcp-proxy] 127.0.0.1:${LOCAL_PROXY_PORT} already in use — another proxy or a local Blender holds it.`);
  } else {
    console.error(`[blender-mcp-proxy] server error: ${err.message}`);
  }
  process.exit(1);
});

server.listen(LOCAL_PROXY_PORT, '127.0.0.1', () => {
  console.log(`[blender-mcp-proxy] listening on 127.0.0.1:${LOCAL_PROXY_PORT}`);
});

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { server.close(); process.exit(0); });
}
