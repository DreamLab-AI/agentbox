// tab0-bridge must notice when the session-plane daemon goes away (ADR-2153).
// While the coordinator is ready, the voice meta-agent is told to use
// session-control.cjs, which has no tmux fallback; readiness that never clears
// after the daemon dies leaves voice commands failing silently.
import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

function fakeDaemon(socketPath) {
  const server = net.createServer((c) => {
    c.on('data', () => c.end(JSON.stringify({ ok: true, sessions: [{ slug: 'tab0', present: true }] }) + '\n'));
  });
  return new Promise((resolve) => server.listen(socketPath, () => resolve(server)));
}

function health(port) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/health' }, (res) => {
      let body = ''; res.on('data', (d) => { body += d; }); res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

async function until(fn, ms) {
  const end = Date.now() + ms;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > end) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}

test('coordinator readiness follows the session-plane daemon both ways', async (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'tab0-ready-'));
  const sock = join(temp, 'sessions.sock');
  const port = await freePort();
  let daemon = await fakeDaemon(sock);
  const child = spawn(process.execPath, [join(root, 'config/tab0-bridge/server.mjs')], {
    cwd: temp,
    env: {
      ...process.env, NODE_PATH: join(root, 'management-api/node_modules'),
      BRIDGE_PORT: String(port), BRIDGE_BIND: '127.0.0.1', BRIDGE_TOKEN: 'readiness-test-token',
      AGENTBOX_MANIFEST_PATH: join(temp, 'absent.toml'), AGENTBOX_SESSIONS_SOCKET: sock,
      BRIDGE_SESSION_PROBE_MS: '100', BRIDGE_TMUX_SESSION: `absent-${process.pid}`,
    },
  });
  t.after(() => { child.kill('SIGKILL'); daemon.close(); rmSync(temp, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    let out = '';
    const timer = setTimeout(() => reject(new Error(`startup timeout\n${out}`)), 8000);
    const onData = (c) => { out += c; if (out.includes('tab0-bridge listening')) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', onData); child.stderr.on('data', onData);
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`exited ${code}\n${out}`)); });
  });

  assert.ok(await until(async () => (await health(port)).coordinator === true, 3000), 'ready while the daemon answers');
  await new Promise((r) => daemon.close(r));
  assert.ok(await until(async () => (await health(port)).coordinator === false, 3000), 'not ready once the daemon is gone');
  daemon = await fakeDaemon(sock);
  assert.ok(await until(async () => (await health(port)).coordinator === true, 3000), 'ready again when the daemon returns');
});
