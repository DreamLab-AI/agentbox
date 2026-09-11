import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../management-api/package.json', import.meta.url));
const { generateSecretKey, getPublicKey, finalizeEvent } = require('nostr-tools');
async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('real signed and session-cookie requests traverse ingress and bridge', { timeout: 25000 }, async t => {
  const temp = mkdtempSync(join(tmpdir(), 'agentbox-voice-ingress-'));
  const bridgePort = await freePort();
  const proxyPort = await freePort();
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const children = [];
  const sockets = [];
  t.after(async () => {
    sockets.forEach(ws => ws.terminate());
    await Promise.all(children.map(child => new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('close', resolve); child.kill();
    })));
    rmSync(temp, { recursive: true, force: true });
  });
  const env = {
    ...process.env, NODE_PATH: join(root, 'management-api/node_modules'),
    NOSTR_BRIDGE_PATH: join(root, 'mcp/servers/nostr-bridge.js'),
    BRIDGE_PORT: String(bridgePort), BRIDGE_BIND: '127.0.0.1', BRIDGE_TOKEN: 'isolated-test-token',
    AGENTBOX_RELAY_ALLOWED_PUBKEYS: pubkey, AGENTBOX_MANIFEST_PATH: join(temp, 'absent.toml'),
    NIP98_PROXY_PORT: String(proxyPort), NIP98_PROXY_HOST: '127.0.0.1',
    NIP98_PROXY_ALLOWED_PUBKEYS: pubkey, NIP98_PROXY_ALLOW_BEARER: '',
    NIP98_PROXY_CONFIG_FILE: join(temp, 'absent.json'),
    NIP98_PROXY_MGMT_UPSTREAM: '',
    NIP98_PROXY_ROUTES: JSON.stringify([
      { prefix: '/bridge', target: `http://127.0.0.1:${bridgePort}`, bearer_env: 'BRIDGE_TOKEN' },
      { prefix: '/feed', target: `http://127.0.0.1:${bridgePort}`, strip: false, bearer_env: 'BRIDGE_TOKEN' },
    ]),
  };
  async function start(file, ready) {
    const child = spawn(process.execPath, [join(root, file)], { env, cwd: temp });
    children.push(child);
    await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error(`startup timeout: ${file}\n${output}`)), 8000);
      const onData = chunk => {
        output += chunk;
        if (output.includes(ready)) { clearTimeout(timer); resolve(); }
      };
      child.stdout.on('data', onData); child.stderr.on('data', onData);
      child.once('error', reject);
      child.once('exit', code => { clearTimeout(timer); if (code) reject(new Error(output)); });
    });
  }
  await start('config/tab0-bridge/server.mjs', 'tab0-bridge listening');
  await start('config/nip98-proxy/proxy.mjs', 'nip98-proxy listening');
  function signed(method, path, secret = sk) {
    const event = finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000),
      tags: [['u', `https://voice.test${path}`], ['method', method], ['nonce', randomUUID()]], content: '' }, secret);
    return Buffer.from(JSON.stringify(event)).toString('base64');
  }
  function request(path, headers = {}, method = 'GET') {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: proxyPort, path, method,
        headers: { host: 'voice.test', 'x-forwarded-proto': 'https', ...headers } }, res => {
        let body = ''; res.on('data', c => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on('error', reject); req.end();
    });
  }
  async function feed(query = '', headers = {}) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${proxyPort}/feed${query}`, {
        headers: { host: 'voice.test', 'x-forwarded-proto': 'https', ...headers }, handshakeTimeout: 5000,
      });
      sockets.push(ws);
      ws.once('message', data => { resolve(JSON.parse(data)); ws.close(); });
      ws.once('error', reject);
      ws.once('unexpected-response', (_req, res) => { res.resume(); ws.terminate(); reject(new Error(`WS ${res.statusCode}`)); });
    });
  }
  assert.equal((await request('/bridge/v1/models')).status, 401);
  const header = { authorization: `Nostr ${signed('GET', '/bridge/v1/models')}` };
  const models = await request('/bridge/v1/models', header);
  assert.equal(models.status, 200, models.body);
  assert.equal(JSON.parse(models.body).data[0].id, 'tab0-meta');
  assert.equal((await request('/bridge/v1/models', header)).status, 401, 'replay remains denied');
  assert.equal((await feed(`?auth=${encodeURIComponent(signed('GET', '/feed'))}`)).type, 'snapshot');
  const mint = await request('/nip07/session', { authorization: `Nostr ${signed('POST', '/nip07/session')}` }, 'POST');
  assert.equal(mint.status, 200, mint.body);
  const cookie = mint.headers['set-cookie'][0].split(';')[0];
  assert.equal((await request('/nip07/session', { cookie })).status, 200);
  assert.equal((await request('/nip07/session')).status, 401);
  assert.equal((await request('/bridge/v1/models', { cookie })).status, 200);
  assert.equal((await feed('', { cookie })).type, 'snapshot');
  assert.equal((await request('/bridge/v1/models', {
    authorization: `Nostr ${signed('GET', '/bridge/v1/models', generateSecretKey())}`,
  })).status, 401, 'unknown signer remains denied');
});
