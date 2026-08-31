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
 *   F. NIP-07 browser sessions   → handshake page served; browser 401s redirect to
 *                                  it; session cookies authenticate HTTP + WS with
 *                                  the real pubkey and are stripped before upstream;
 *                                  forged/expired cookies and non-NIP-98 mints rejected
 *
 * Run: node config/nip98-proxy/selftest.mjs
 * Exit code 0 = all assertions passed (skips do not fail the run).
 */

import http from 'node:http';
import net from 'node:net';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';

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

function request(path, headers, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port: PROXY_PORT, path, method, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.end();
  });
}

// ─── NIP-98 header (best-effort; needs nostr-tools) ────────────────────────────

function buildNip98(method, url) {
  const bridgePath = process.env.NOSTR_BRIDGE_PATH
    || pathResolve(__dirname, '../../mcp/servers/nostr-bridge.js');
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

function wsUpgrade(path, extraHeaders = '') {
  return new Promise((resolve, reject) => {
    const sock = net.connect(PROXY_PORT, '127.0.0.1', () => {
      sock.write(
        `GET ${path} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${PROXY_PORT}\r\n` +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
        'Sec-WebSocket-Version: 13\r\n' +
        extraHeaders +
        '\r\n'
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

  // Hermetic: never inherit the operator's live boot-projected config file
  // (its allowlist would 401 the selftest's ephemeral signer — ADR-069).
  process.env.NIP98_PROXY_CONFIG_FILE = '/nonexistent-selftest-isolated.json';
  process.env.NIP98_PROXY_PORT = String(PROXY_PORT);
  process.env.NIP98_PROXY_HOST = '127.0.0.1';
  process.env.AOE_UPSTREAM = `http://127.0.0.1:${upstreamPort}`;
  process.env.NIP98_PROXY_ROUTES = JSON.stringify([
    { prefix: '/mgmt/', target: `http://127.0.0.1:${mgmtPort}` },
  ]);
  process.env.NIP98_PROXY_ALLOW_BEARER = BREAK_GLASS;
  process.env.NIP98_PROXY_BEARER_PUBKEY = 'operator-break-glass';

  // N-05: default-upstream (AoE) forwards fail closed without the daemon's
  // shared-secret token. Provision a fake serve.url so the selftest exercises
  // the injection path hermetically (the fake upstream ignores the bearer).
  const aoeTokenFile = pathResolve(tmpdir(), `selftest-aoe-serve-${process.pid}.url`);
  writeFileSync(aoeTokenFile, `http://127.0.0.1:${upstreamPort}/?token=${'ab'.repeat(32)}\n`);
  process.env.AOE_TOKEN_FILE = aoeTokenFile;
  process.on('exit', () => { try { unlinkSync(aoeTokenFile); } catch { /* gone */ } });

  const proxyMod = await import('./proxy.mjs');
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
    // N-05: the client's Authorization is stripped, and the proxy injects the
    // AoE daemon's shared-secret token toward the default upstream — the
    // upstream must see the daemon token, never the client credential.
    assert(lastReq && lastReq.headers.authorization === `Bearer ${'ab'.repeat(32)}`,
      'B: client Authorization replaced by injected AoE daemon token',
      JSON.stringify(lastReq && lastReq.headers.authorization));
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

  // D3. WS upgrade with a signed NIP-98 event as ?auth= (the console's
  // signer-only carrier — browsers cannot set headers on a WS handshake).
  // Same verification path as the header form; the u tag is signed without
  // the query string, matching signedUrlFor's stripped reconstruction.
  {
    const url = `http://127.0.0.1:${PROXY_PORT}/sessions/abc/live-ws`;
    const nip98 = buildNip98('GET', url);
    if (nip98.skip) {
      skip('D3: WS upgrade via ?auth= NIP-98 accepted', nip98.skip);
    } else {
      lastUpgrade = null;
      const b64 = nip98.header.slice('Nostr '.length);
      const resp = await wsUpgrade(`/sessions/abc/live-ws?auth=${encodeURIComponent(b64)}`);
      assert(/101/.test(resp), 'D3: WS upgrade via ?auth= NIP-98 accepted (101)', JSON.stringify(resp.slice(0, 40)));
      assert(lastUpgrade && lastUpgrade.headers['x-agentbox-pubkey'] === nip98.pubkey,
        'D3: upstream upgrade received the signer pubkey',
        JSON.stringify(lastUpgrade && lastUpgrade.headers['x-agentbox-pubkey']));
      assert(lastUpgrade && !/auth=/.test(lastUpgrade.url || ''),
        'D3: consumed ?auth= credential stripped from the forwarded URL',
        JSON.stringify(lastUpgrade && lastUpgrade.url));
    }
  }

  // D4. WS upgrade with a forged ?auth= event → 401 (verification is real,
  // not presence-of-parameter).
  {
    const forged = {
      kind: 27235, created_at: Math.floor(Date.now() / 1000),
      tags: [['u', `http://127.0.0.1:${PROXY_PORT}/sessions/abc/live-ws`], ['method', 'GET']],
      content: '', id: '00'.repeat(32), sig: '00'.repeat(64),
      pubkey: '11'.repeat(32),
    };
    const b64 = Buffer.from(JSON.stringify(forged), 'utf8').toString('base64');
    const resp = await wsUpgrade(`/sessions/abc/live-ws?auth=${encodeURIComponent(b64)}`);
    assert(/401/.test(resp), 'D4: forged ?auth= WS upgrade rejected 401', JSON.stringify(resp.slice(0, 40)));
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

  // F. NIP-07 browser sessions ------------------------------------------------

  // F1. handshake page served, unauthenticated
  {
    const r = await request('/nip07/', { accept: 'text/html' });
    assert(r.status === 200 && /window\.nostr/.test(r.body) && /27235/.test(r.body),
      'F1: handshake page served with NIP-07 signer flow', `status ${r.status}`);
  }

  // F2. unauthenticated BROWSER GET redirects to the handshake (API 401 covered by A)
  {
    const r = await request('/api/sessions', { accept: 'text/html,application/xhtml+xml' });
    assert(r.status === 302 && String(r.headers.location).startsWith('/nip07/?next=%2Fapi%2Fsessions'),
      'F2: browser 401 becomes redirect to handshake with next', `status ${r.status} loc ${r.headers.location}`);
  }

  // F3. session mint requires a live NIP-98 signature (bearer must not launder)
  {
    const r = await request('/nip07/session', { authorization: `Bearer ${BREAK_GLASS}` }, 'POST');
    assert(r.status === 401, 'F3: break-glass bearer cannot mint a session', `got ${r.status}`);
    const r2 = await request('/nip07/session', {}, 'POST');
    assert(r2.status === 401, 'F3b: credential-less mint rejected', `got ${r2.status}`);
  }

  // F4. cookie sessions authenticate HTTP with the real pubkey; token stripped upstream
  {
    const pubkey = 'ab'.repeat(32);
    const token = proxyMod.mintSessionToken(pubkey);
    lastReq = null;
    const r = await request('/api/sessions', {
      cookie: `other=1; agentbox_nip07_session=${token}; theme=dark`,
    });
    assert(r.status === 200, 'F4: session cookie accepted 200', `got ${r.status}`);
    assert(lastReq && lastReq.headers['x-agentbox-pubkey'] === pubkey,
      'F4: upstream received the session pubkey', JSON.stringify(lastReq && lastReq.headers['x-agentbox-pubkey']));
    assert(lastReq && lastReq.headers['x-agentbox-auth-mode'] === 'nip07-session',
      'F4: auth mode stamped nip07-session');
    assert(lastReq && lastReq.headers.cookie === 'other=1; theme=dark',
      'F4: session token stripped from upstream Cookie, other cookies kept',
      JSON.stringify(lastReq && lastReq.headers.cookie));
  }

  // F5. forged / expired session cookies rejected
  {
    const forged = `v1.${'cd'.repeat(32)}.${Math.floor(Date.now() / 1000) + 9999}.${'00'.repeat(32)}`;
    const r = await request('/api/sessions', { cookie: `agentbox_nip07_session=${forged}` });
    assert(r.status === 401, 'F5: forged session cookie rejected 401', `got ${r.status}`);
    const token = proxyMod.mintSessionToken('ef'.repeat(32));
    const farFuture = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600;
    assert(proxyMod.verifySessionToken(token, farFuture) === null,
      'F5b: expired session token verifies null');
    const [v, pk, exp] = token.split('.');
    const tampered = [v, pk, String(Number(exp) + 3600), token.split('.')[3]].join('.');
    assert(proxyMod.verifySessionToken(tampered) === null,
      'F5c: expiry tampering breaks the MAC');
  }

  // F6. WS upgrade rides the session cookie
  {
    const pubkey = '12'.repeat(32);
    const token = proxyMod.mintSessionToken(pubkey);
    lastUpgrade = null;
    const resp = await wsUpgrade('/sessions/abc/live-ws', `Cookie: agentbox_nip07_session=${token}\r\n`);
    assert(/101/.test(resp), 'F6: WS upgrade via session cookie completed', JSON.stringify(resp.slice(0, 40)));
    assert(lastUpgrade && lastUpgrade.headers['x-agentbox-pubkey'] === pubkey,
      'F6: WS upstream received the session pubkey');
    assert(lastUpgrade && lastUpgrade.headers.cookie === undefined,
      'F6: session cookie stripped from WS upstream headers', JSON.stringify(lastUpgrade && lastUpgrade.headers.cookie));
  }

  // F7. open-redirect guard on next
  {
    assert(proxyMod.safeNextPath('/aoe/dash') === '/aoe/dash', 'F7: same-origin path preserved');
    assert(proxyMod.safeNextPath('https://evil.example/') === '/', 'F7b: absolute URL rejected');
    assert(proxyMod.safeNextPath('//evil.example/') === '/', 'F7c: protocol-relative rejected');
    assert(proxyMod.safeNextPath('/\\evil.example/') === '/', 'F7d: backslash URL rejected');
  }

  // F8. full mint flow via a real NIP-98 signature (needs nostr-tools)
  {
    const url = `http://127.0.0.1:${PROXY_PORT}/nip07/session`;
    const nip98 = buildNip98('POST', url);
    if (nip98.skip) {
      skip('F8: NIP-98-signed session mint', nip98.skip);
    } else {
      const r = await request('/nip07/session', { authorization: nip98.header }, 'POST');
      const setCookie = String((r.headers['set-cookie'] || [])[0] || '');
      assert(r.status === 200 && setCookie.includes('agentbox_nip07_session=v1.') && setCookie.includes('HttpOnly'),
        'F8: signed handshake mints HttpOnly session cookie', `status ${r.status} cookie ${setCookie.slice(0, 60)}`);
      const token = setCookie.split(';')[0].split('=').slice(1).join('=');
      const session = proxyMod.verifySessionToken(token);
      assert(session && session.pubkey === nip98.pubkey,
        'F8b: minted session binds the signer pubkey', JSON.stringify(session));
    }
  }

  console.log(`\n${failures === 0 ? 'OK' : 'FAILED'} — ${failures} failure(s), ${skips} skip(s)`);
  upstream.close();
  mgmtUpstream.close();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error('self-test crashed:', err); process.exit(1); });
