#!/usr/bin/env node
/**
 * BlenderMCP health check.
 *
 * Connects to the BlenderMCP socket server and runs a get_scene_info round-trip,
 * distinguishing the failure modes that actually occur in practice:
 *   - refused        : nothing is listening (addon not started, wrong host/port)
 *   - silent-close   : a socket accepts the connection then closes with no bytes
 *                      (Blender is up but the addon's server thread is not serving,
 *                       or a stale bind holds the port)
 *   - timeout        : connected, request sent, no response within the window
 *   - bad-json       : responded but not with parseable JSON
 *   - ok             : valid BlenderMCP response
 *
 * Exit code 0 on ok, 1 on any failure — usable as a gate.
 *
 * Env: BLENDER_HOST (default localhost), BLENDER_PORT (default 9876),
 *      BLENDER_HEALTH_TIMEOUT_MS (default 8000).
 */
const net = require('net');

const HOST = process.env.BLENDER_HOST || 'localhost';
const PORT = parseInt(process.env.BLENDER_PORT || '9876', 10);
const TIMEOUT = parseInt(process.env.BLENDER_HEALTH_TIMEOUT_MS || '8000', 10);

function check() {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let buf = Buffer.alloc(0);
    let connected = false;
    let settled = false;

    const done = (status, detail) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sock.destroy();
      resolve({ status, detail });
    };

    const timer = setTimeout(
      () => done('timeout', `no response within ${TIMEOUT}ms (connected=${connected}, bytes=${buf.length})`),
      TIMEOUT,
    );

    sock.connect(PORT, HOST, () => {
      connected = true;
      // BlenderMCP expects a bare JSON object (no trailing newline required).
      sock.write(JSON.stringify({ type: 'get_scene_info', params: {} }));
    });

    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      try {
        const json = JSON.parse(buf.toString());
        done('ok', json);
      } catch (_) {
        /* partial frame — keep buffering until timeout */
      }
    });

    sock.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') done('refused', `${HOST}:${PORT} refused the connection`);
      else done('error', `${err.code || ''} ${err.message}`.trim());
    });

    sock.on('close', () => {
      if (buf.length === 0) {
        done(connected ? 'silent-close' : 'refused',
          connected
            ? 'socket accepted then closed with 0 bytes — Blender is up but the BlenderMCP server is not serving (press Start in View3D > Sidebar > BlenderMCP, or the port is a stale bind)'
            : 'connection closed before it opened');
      } else {
        try { done('ok', JSON.parse(buf.toString())); }
        catch (_) { done('bad-json', buf.toString().slice(0, 400)); }
      }
    });
  });
}

const REMEDY = {
  refused: 'Start Blender, enable the Blender MCP addon, open View3D > Sidebar > BlenderMCP and click "Start MCP Server". Confirm BLENDER_HOST/BLENDER_PORT. If Blender runs in a separate GUI container, start tools/blender-mcp-proxy.js.',
  'silent-close': 'The port is bound but not answering. In Blender, toggle the BlenderMCP server off then on. If no Blender GUI is running, a stale process may hold the port — identify and stop it, or restart Blender with the addon enabled.',
  timeout: 'Blender accepted the request but did not answer. It may be blocked on a modal operator or a long task on the main thread. Check the Blender window/console.',
  'bad-json': 'Got a response that was not BlenderMCP JSON. Something else may be listening on this port.',
  error: 'Socket error — check host/port and container networking.',
};

check().then(({ status, detail }) => {
  if (status === 'ok') {
    const objs = Array.isArray(detail?.result?.objects) ? detail.result.objects.length
      : Array.isArray(detail?.objects) ? detail.objects.length : '?';
    console.log(`PASS  BlenderMCP responding at ${HOST}:${PORT} (${objs} objects in scene)`);
    process.exit(0);
  }
  console.error(`FAIL  [${status}] ${HOST}:${PORT} — ${typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 300)}`);
  if (REMEDY[status]) console.error(`      → ${REMEDY[status]}`);
  process.exit(1);
});
