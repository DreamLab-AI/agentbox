import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import TOML from '@iarna/toml';
import WebSocket, { WebSocketServer } from 'ws';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = path => readFileSync(`${root}${path}`, 'utf8');
const manifest = TOML.parse(read('agentbox.toml'));
const routes = manifest.interaction_plane.proxy.routes.filter(r => ['/code', '/jupyter'].includes(r.prefix));
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));

test('builder navigation keeps workspace surfaces on the authenticated console origin', () => {
  const html = read('voice/console/site/index.html');
  for (const [surface, path] of [['code-server', '/code/'], ['jupyter', '/jupyter/']]) {
    assert.match(html, new RegExp(`<a href="${path}" data-surface="${surface}">`));
    assert.ok(routes.some(r => `${r.prefix}/` === path));
  }
  assert.doesNotMatch(read('voice/console/site/app.js'), /location\.hostname.*dataset\.port/);
  const caddy = read('voice/console/Caddyfile');
  assert.match(caddy, /@workspace path \/code \/code\/\* \/jupyter \/jupyter\/\*/);
  assert.match(caddy, /handle @workspace\s*\{\s*reverse_proxy agentbox:9096/);
  assert.match(read('flake.nix'), /command=.*jupyter-lab .*--ServerApp.base_url=\/jupyter\/ .*--ServerApp.trust_xheaders=True/);
});

test('configured workspace routes gate HTTP and WebSockets and preserve service paths and cookies', { timeout: 15000 }, async t => {
  const upstream = http.createServer((req, res) => res.end(JSON.stringify({ path: req.url, cookie: req.headers.cookie, host: req.headers.host, origin: req.headers.origin })));
  const wss = new WebSocketServer({ server: upstream });
  wss.on('connection', (ws, req) => ws.send(JSON.stringify({ path: req.url, cookie: req.headers.cookie, host: req.headers.host, origin: req.headers.origin })));
  const upstreamPort = await listen(upstream);
  const reservation = http.createServer();
  const proxyPort = await listen(reservation);
  await new Promise(resolve => reservation.close(resolve));
  const secret = 'workspace-route-test-only';
  const pubkey = 'ab'.repeat(32);
  const expiry = Math.floor(Date.now() / 1000) + 120;
  const mac = createHmac('sha256', secret).update(`${pubkey}.${expiry}`).digest('hex');
  const cookie = `agentbox_nip07_session=v1.${pubkey}.${expiry}.${mac}; upstream_login=kept`;
  const child = spawn(process.execPath, [`${root}config/nip98-proxy/proxy.mjs`], { env: {
    ...process.env, NIP98_PROXY_PORT: String(proxyPort), NIP98_PROXY_HOST: '127.0.0.1',
    NIP98_PROXY_CONFIG_FILE: '/tmp/agentbox-workspace-test-absent.json', NIP98_PROXY_MGMT_UPSTREAM: '',
    NIP98_PROXY_ALLOWED_PUBKEYS: pubkey, NIP98_PROXY_ALLOW_BEARER: '',
    NIP98_PROXY_SESSION_SECRET: secret,
    NIP98_PROXY_ROUTES: JSON.stringify(routes.map(r => ({ ...r, target: `http://127.0.0.1:${upstreamPort}` }))),
  }});
  t.after(async () => {
    wss.clients.forEach(ws => ws.terminate());
    wss.close(); upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
    if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('proxy startup timeout')), 5000);
    let logs = '';
    const log = chunk => { logs += chunk; if (logs.includes('nip98-proxy listening')) { clearTimeout(timer); resolve(); } };
    child.stdout.on('data', log); child.stderr.on('data', log);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`proxy exited ${code}: ${logs}`)); });
  });
  for (const [path, expected] of [['/code/static/test.js?x=1', '/static/test.js?x=1'], ['/jupyter/api/kernels?x=1', '/jupyter/api/kernels?x=1']]) {
    const url = `http://127.0.0.1:${proxyPort}${path}`;
    assert.equal((await fetch(url)).status, 401);
    const response = await new Promise((resolve, reject) => {
      http.get(url, { headers: { cookie, host: 'voice.test:8444', origin: 'https://voice.test:8444' } }, res => {
        let body = ''; res.on('data', chunk => { body += chunk; });
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      }).on('error', reject);
    });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { path: expected, cookie: 'upstream_login=kept', host: 'voice.test:8444', origin: 'https://voice.test:8444' });
    for (const authenticated of [false, true]) {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(url.replace('http:', 'ws:'), { headers: authenticated ? { cookie, host: 'voice.test:8444', origin: 'https://voice.test:8444' } : {}, handshakeTimeout: 3000 });
        ws.on('error', reject);
        ws.on('unexpected-response', (_req, res) => {
          try { assert.equal(authenticated, false); assert.equal(res.statusCode, 401); res.resume(); ws.removeListener('error', reject); ws.on('error', () => {}); ws.terminate(); resolve(); } catch (e) { reject(e); }
        });
        ws.on('message', data => {
          try { assert.equal(authenticated, true); assert.deepEqual(JSON.parse(data), { path: expected, cookie: 'upstream_login=kept', host: 'voice.test:8444', origin: 'https://voice.test:8444' }); ws.close(); resolve(); } catch (e) { reject(e); }
        });
      });
    }
  }
});
