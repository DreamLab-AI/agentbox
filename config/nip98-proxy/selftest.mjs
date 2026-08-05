#!/usr/bin/env node
/**
 * Self-test for the NIP-98 ingress proxy (PRD-021 WS4 / ADR-043 D4.6).
 *
 * Spins up a fake AoE upstream, boots proxy.mjs against it, then exercises:
 *   A. no credentials            → 401 (fail-closed)
 *   B. break-glass bearer        → 200, upstream sees X-Agentbox-Pubkey + X-Forwarded-For,
 *                                  and the Authorization header is stripped
 *   C. valid NIP-98 (kind-27235) → 200, upstream sees the signer's pubkey
 *                                  (skipped gracefully if nostr-tools is unresolvable)
 *   D. WebSocket upgrade         → proxy forwards the upgrade with injected identity
 *   E. routed prefix (ADR-045)   → /mgmt/* lands on the second upstream with the
 *                                  prefix stripped, identity injected, auth stripped;
 *                                  unrouted paths still land on the default upstream
 *
 * Run: node config/nip98-proxy/selftest.mjs
 * Exit code 0 = all assertions passed (skips do not fail the run).
 */

import http from 'node:http';
import net from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const BREAK_GLASS = 'test-break-glass-token-0123456789';
const PROXY_PORT = 19096;
let failures = 0;
let skips = 0;

function assert(cond, name, detail) {
  if (cond) { console.log(`  PASS  ${name}`); }
  else { console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); failures += 1; }
}
function skip(name, why) { console.log(`  SKIP  ${name} — ${why}`); skips += 1; }

// ─── Fake AoE upstream ─────────────────────────────────────────────────────────

let lastReq = null;
let lastUpgrade = null;

const upstream = http.createServer((req, res) => {
  lastReq = { method: req.method, url: req.url, headers: { ...req.headers } };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, seen: req.headers['x-agentbox-pubkey'] || null }));
});
upstream.on('upgrade', (req, socket) => {
  lastUpgrade = { url: req.url, headers: { ...req.headers } };
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
  socket.end();
});

function once(server, port) {
  return new Promise((res) => server.listen(port, '127.0.0.1', () => res(server.address().port)));
}

// ─── Fake management-api upstream (ADR-045 routed target) ──────────────────────

let lastMgmtReq = null;

const mgmtUpstream = http.createServer((req, res) => {
  lastMgmtReq = { method: req.method, url: req.url, headers: { ...req.headers } };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, surface: 'mgmt' }));
});

// ─── HTTP helper ───────────────────────────────────────────────────────────────

function request(path, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: PROXY_PORT, path, method: 'GET', headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

// ─── NIP-98 header (best-effort; needs nostr-tools) ────────────────────────────

function buildNip98(method, url) {
  const bridgePath = pathResolve(__dirname, '../../mcp/servers/nostr-bridge.js');
  let tools;
  try {
    const bridgeRequire = createRequire(bridgePath);
    tools = bridgeRequire('nostr-tools');
  } catch (err) {
    return { skip: `nostr-tools unresolvable: ${err.message}` };
  }
  const { generateSecretKey, getPublicKey, finalizeEvent } = tools;
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const unsigned = {
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['u', url], ['method', method.toUpperCase()]],
    content: '',
  };
  const signed = finalizeEvent(unsigned, sk);
  const header = `Nostr ${Buffer.from(JSON.stringify(signed), 'utf8').toString('base64')}`;
  return { header, pubkey: pk };
}

// ─── WS upgrade helper (raw socket) ────────────────────────────────────────────

function wsUpgrade(path) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PROXY_PORT, '127.0.0.1', () => {
      sock.write(
        `GET ${path} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${PROXY_PORT}\r\n` +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
        'Sec-WebSocket-Version: 13\r\n\r\n'
      );
    });
    let buf = '';
    sock.on('data', (c) => { buf += c; });
    sock.on('close', () => resolve(buf));
    sock.on('error', reject);
    setTimeout(() => { sock.destroy(); resolve(buf); }, 800);
  });
}

// ─── Run ────────────────────────────────────────────────────────────────────────

async function main() {
  const upstreamPort = await once(upstream, 0);
  const mgmtPort = await once(mgmtUpstream, 0);

  process.env.NIP98_PROXY_PORT = String(PROXY_PORT);
  process.env.NIP98_PROXY_HOST = '127.0.0.1';
  process.env.AOE_UPSTREAM = `http://127.0.0.1:${upstreamPort}`;
  process.env.NIP98_PROXY_ROUTES = JSON.stringify([
    { prefix: '/mgmt/', target: `http://127.0.0.1:${mgmtPort}` },
  ]);
  process.env.NIP98_PROXY_ALLOW_BEARER = BREAK_GLASS;
  process.env.NIP98_PROXY_BEARER_PUBKEY = 'operator-break-glass';

  await import('./proxy.mjs');
  await new Promise((r) => setTimeout(r, 300)); // let it bind

  console.log('NIP-98 proxy self-test\n');

  // A. no credentials → 401
  {
    const r = await request('/api/sessions', {});
    assert(r.status === 401, 'A: unauthenticated request rejected 401', `got ${r.status}`);
  }

  // B. break-glass bearer → 200 + identity injected + Authorization stripped
  {
    lastReq = null;
    const r = await request('/api/sessions?state=live', { authorization: `Bearer ${BREAK_GLASS}` });
    assert(r.status === 200, 'B: break-glass bearer accepted 200', `got ${r.status}`);
    assert(lastReq && lastReq.headers['x-agentbox-pubkey'] === 'operator-break-glass',
      'B: upstream received X-Agentbox-Pubkey', JSON.stringify(lastReq && lastReq.headers['x-agentbox-pubkey']));
    assert(lastReq && !!lastReq.headers['x-forwarded-for'], 'B: upstream received X-Forwarded-For');
    assert(lastReq && lastReq.headers.authorization === undefined,
      'B: Authorization header stripped before upstream', JSON.stringify(lastReq && lastReq.headers.authorization));
  }

  // B2. wrong bearer → 401
  {
    const r = await request('/api/sessions', { authorization: 'Bearer wrong-token-of-same-lengthxxxxxxx' });
    assert(r.status === 401, 'B2: wrong break-glass bearer rejected 401', `got ${r.status}`);
  }

  // C. valid NIP-98 → 200 with signer pubkey
  {
    const url = `http://127.0.0.1:${PROXY_PORT}/api/sessions`;
    const nip98 = buildNip98('GET', url);
    if (nip98.skip) {
      skip('C: valid NIP-98 accepted', nip98.skip);
    } else {
      lastReq = null;
      const r = await request('/api/sessions', { authorization: nip98.header });
      assert(r.status === 200, 'C: valid NIP-98 accepted 200', `got ${r.status}`);
      assert(lastReq && lastReq.headers['x-agentbox-pubkey'] === nip98.pubkey,
        'C: upstream received the signer pubkey',
        `${lastReq && lastReq.headers['x-agentbox-pubkey']} != ${nip98.pubkey}`);
    }
  }

  // C2. forged NIP-98 (bad signature) → 401
  {
    const forged = {
      kind: 27235, created_at: Math.floor(Date.now() / 1000),
      tags: [['u', `http://127.0.0.1:${PROXY_PORT}/api/sessions`], ['method', 'GET']],
      content: '', id: '00'.repeat(32), sig: '00'.repeat(64),
      pubkey: '11'.repeat(32),
    };
    const header = `Nostr ${Buffer.from(JSON.stringify(forged), 'utf8').toString('base64')}`;
    const r = await request('/api/sessions', { authorization: header });
    assert(r.status === 401, 'C2: forged NIP-98 signature rejected 401', `got ${r.status}`);
  }

  // D. WS upgrade with break-glass query token → forwarded with identity
  {
    lastUpgrade = null;
    const resp = await wsUpgrade(`/sessions/abc/live-ws?access_token=${BREAK_GLASS}`);
    assert(/101/.test(resp), 'D: WS upgrade completed (101 relayed)', JSON.stringify(resp.slice(0, 40)));
    assert(lastUpgrade && lastUpgrade.headers['x-agentbox-pubkey'] === 'operator-break-glass',
      'D: upstream upgrade received X-Agentbox-Pubkey', JSON.stringify(lastUpgrade && lastUpgrade.headers));
  }

  // D2. WS upgrade without credentials → 401 handshake
  {
    const resp = await wsUpgrade('/sessions/abc/live-ws');
    assert(/401/.test(resp), 'D2: unauthenticated WS upgrade rejected 401', JSON.stringify(resp.slice(0, 40)));
  }

  // E. routed prefix → mgmt upstream, prefix stripped, identity injected
  {
    lastMgmtReq = null;
    lastReq = null;
    const r = await request(`/mgmt/v1/system?probe=1`, { authorization: `Bearer ${BREAK_GLASS}` });
    assert(r.status === 200 && r.body.includes('"surface":"mgmt"'),
      'E: /mgmt/* routed to management upstream', `status ${r.status} body ${r.body.slice(0, 60)}`);
    assert(lastMgmtReq && lastMgmtReq.url === '/v1/system?probe=1',
      'E: prefix stripped, query preserved', JSON.stringify(lastMgmtReq && lastMgmtReq.url));
    assert(lastMgmtReq && lastMgmtReq.headers['x-agentbox-pubkey'] === 'operator-break-glass',
      'E: routed upstream received X-Agentbox-Pubkey');
    assert(lastMgmtReq && lastMgmtReq.headers.authorization === undefined,
      'E: Authorization stripped on routed upstream');
    assert(lastReq === null, 'E: default upstream NOT hit for routed path');
  }

  // E2. unrouted path still falls through to the default (AoE) upstream
  {
    lastMgmtReq = null;
    lastReq = null;
    const r = await request('/api/sessions', { authorization: `Bearer ${BREAK_GLASS}` });
    assert(r.status === 200 && lastReq && lastReq.url === '/api/sessions',
      'E2: unrouted path reaches default upstream unchanged', JSON.stringify(lastReq && lastReq.url));
    assert(lastMgmtReq === null, 'E2: routed upstream NOT hit for default path');
  }

  // E3. unauthenticated routed request → 401 (auth precedes routing)
  {
    lastMgmtReq = null;
    const r = await request('/mgmt/v1/system', {});
    assert(r.status === 401, 'E3: unauthenticated routed request rejected 401', `got ${r.status}`);
    assert(lastMgmtReq === null, 'E3: routed upstream never contacted without identity');
  }

  console.log(`\n${failures === 0 ? 'OK' : 'FAILED'} — ${failures} failure(s), ${skips} skip(s)`);
  upstream.close();
  mgmtUpstream.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error('self-test crashed:', err); process.exit(1); });
