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
 * ADR closeout acceptance (2026-09-05) — each case fails loudly if the boundary
 * regresses, and several boot SEPARATE proxy processes because the property under
 * test only exists across a restart or a different boot configuration:
 *   G. spoofed identity headers  → client-supplied X-Agentbox-Pubkey /
 *                                  -Auth-Mode are stripped and replaced by the
 *                                  AUTHENTICATED identity on HTTP and WS (ADR-2009)
 *   H. verifier faults           → absent module, throwing verifier and
 *                                  non-canonical/absent verified pubkeys all deny,
 *                                  with zero upstream contact (ADR-2009/2011)
 *   I. allowlist removal         → an identity dropped from the allowlist is denied
 *                                  on its NEXT request, including on an
 *                                  already-established session cookie (ADR-2009)
 *   J. cookie expiry / restart   → expired cookies and cookies minted under a
 *                                  previous HMAC key are rejected, no upstream call
 *   K. tokenless denial          → no NIP-98, no bearer, no cookie → 401/WS-401 and
 *                                  the AoE daemon token is NOT injected downstream
 *                                  (ADR-2002)
 *   L. bearer gated behind NIP-98→ named-route bearer injected only when
 *                                  mode !== nip98; a signed request's own
 *                                  Authorization reaches the upstream gate; AoE
 *                                  still gets its daemon token; a bearer-only
 *                                  request cannot reach a mutation route (ADR-2010)
 *   M. hex-canonical identity    → agent-identity helper: lowercase 64-hex x-only,
 *                                  0600 key file, restart stability, persisted:false
 *                                  on persistence failure, no private key in any
 *                                  stdout/stderr the proxy or the mint CLI produces
 *                                  (ADR-2011)
 *
 * Run: NODE_PATH=management-api/node_modules node config/nip98-proxy/selftest.mjs
 * Exit code 0 = all assertions passed (skips do not fail the run).
 */

import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';
import {
  writeFileSync, unlinkSync, mkdirSync, mkdtempSync, copyFileSync, statSync, readFileSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

const BREAK_GLASS = 'test-break-glass-token-0123456789';
const PROXY_PORT = 19096;
// Child-proxy ports: each closeout case that needs a DIFFERENT boot config
// (allowlist contents, verifier availability, HMAC key) gets its own process.
const PORT_NO_VERIFIER = 19097;
const PORT_STUB_VERIFIER = 19098;
const PORT_ALLOW_A = 19099;
const PORT_ALLOW_B = 19100;
const PORT_RESTART = 19101;
// ADR-2027 break-glass bounds (expiry / scope) — one proxy per configuration.
const PORT_BG_EXPIRED = 19102;
const PORT_BG_SCOPED = 19103;
const PORT_BG_MALFORMED_EXPIRY = 19104;
// Pinned so a cookie minted in this process is verifiable by a child proxy —
// the only way to test allowlist removal / restart against a live session.
const SESSION_SECRET = 'selftest-pinned-session-secret-0123456789abcdef';
const GOV_BEARER = 'gov-upstream-bearer-secret-value';
let failures = 0;
let skips = 0;
const tempPaths = [];
const children = [];

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

// ─── Fake governance upstream (ADR-2010 bearer_env route) ──────────────────────
//
// Stands in for a governance service that authenticates callers with its OWN
// bearer AND re-verifies the operator's Schnorr signature. It records exactly
// what credential the proxy handed it, which is the whole ADR-2010 question.

let lastGovReq = null;
let lastGovUpgrade = null;

const govUpstream = http.createServer((req, res) => {
  lastGovReq = { method: req.method, url: req.url, headers: { ...req.headers } };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, surface: 'gov' }));
});
govUpstream.on('upgrade', (req, socket) => {
  lastGovUpgrade = { url: req.url, headers: { ...req.headers } };
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
  socket.end();
});

// ─── HTTP helper ───────────────────────────────────────────────────────────────

function request(path, headers, method = 'GET', port = PROXY_PORT) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    // A boundary defect can crash the proxy mid-request (e.g. injecting an
    // undefined identity header). Surface that as a failed assertion with
    // status 0 rather than an unhandled rejection that hides which case broke.
    req.on('error', (err) => resolve({ status: 0, body: '', headers: {}, error: err.message }));
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

function wsUpgrade(path, extraHeaders = '', port = PROXY_PORT) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(
        `GET ${path} HTTP/1.1\r\n` +
        `Host: 127.0.0.1:${port}\r\n` +
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

// ─── Child-proxy harness ───────────────────────────────────────────────────────
//
// Several closeout properties are only observable ACROSS boots: an allowlist is
// read once at boot, the session HMAC key is per-process, and verifier
// availability is decided at module load. Those cases therefore spawn a real
// `node proxy.mjs` with a different environment and drive it over the wire,
// while the fake upstreams of this process stay the recording surface.

function trackTemp(p) { tempPaths.push(p); return p; }

/**
 * Boot a proxy child on `port`. `env` entries whose value is null are DELETED
 * from the inherited environment (so "break-glass disabled" is genuinely unset,
 * not empty-string). `entry` allows booting a COPY of proxy.mjs from a directory
 * where the relative nostr-bridge candidate does not exist.
 */
function startProxy(port, env = {}, entry = pathResolve(__dirname, 'proxy.mjs')) {
  const childEnv = { ...process.env, NIP98_PROXY_PORT: String(port), NIP98_PROXY_HOST: '127.0.0.1' };
  for (const [k, v] of Object.entries(env)) {
    if (v === null) delete childEnv[k];
    else childEnv[k] = String(v);
  }
  const proc = spawn(process.execPath, [entry], { env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  const child = { proc, port, out: '', err: '' };
  proc.stdout.on('data', (c) => { child.out += c; });
  proc.stderr.on('data', (c) => { child.err += c; });
  children.push(child);
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 8000;
    (function poll() {
      if (proc.exitCode !== null) {
        reject(new Error(`proxy child on ${port} exited ${proc.exitCode}: ${child.err.slice(0, 400)}`));
        return;
      }
      const probe = net.connect(port, '127.0.0.1');
      probe.on('connect', () => { probe.destroy(); resolve(child); });
      probe.on('error', () => {
        probe.destroy();
        if (Date.now() > deadline) reject(new Error(`proxy child on ${port} never bound: ${child.err.slice(0, 400)}`));
        else setTimeout(poll, 100);
      });
    })();
  });
}

function stopChildren() {
  for (const c of children) { try { c.proc.kill('SIGKILL'); } catch { /* already gone */ } }
}

/**
 * Reproduce the proxy's session-cookie wire format (`v1.<pk>.<exp>.<hmac>`)
 * under an ARBITRARY secret and expiry. Needed to forge the two cases a live
 * proxy cannot mint for us: an already-expired cookie, and a cookie carrying a
 * valid MAC under a PREVIOUS boot's key. node:crypto HMAC-SHA256 throughout —
 * no bespoke construction.
 */
function mintCookieWith(secret, pubkey, exp) {
  const mac = crypto.createHmac('sha256', secret).update(`${pubkey}.${exp}`).digest('hex');
  return `v1.${pubkey}.${exp}.${mac}`;
}

// ─── Run ────────────────────────────────────────────────────────────────────────

async function main() {
  const upstreamPort = await once(upstream, 0);
  const mgmtPort = await once(mgmtUpstream, 0);
  const govPort = await once(govUpstream, 0);

  // Hermetic: never inherit the operator's live boot-projected config file
  // (its allowlist would 401 the selftest's ephemeral signer — ADR-069).
  process.env.NIP98_PROXY_CONFIG_FILE = '/nonexistent-selftest-isolated.json';
  process.env.NIP98_PROXY_PORT = String(PROXY_PORT);
  process.env.NIP98_PROXY_HOST = '127.0.0.1';
  process.env.AOE_UPSTREAM = `http://127.0.0.1:${upstreamPort}`;
  // ADR-2010: the /gov/ route names a bearer_env, so the proxy holds a secret the
  // browser never does. bearer_env is fatal at boot when unset — set it first.
  process.env.SELFTEST_GOV_BEARER = GOV_BEARER;
  process.env.NIP98_PROXY_ROUTES = JSON.stringify([
    { prefix: '/mgmt/', target: `http://127.0.0.1:${mgmtPort}` },
    { prefix: '/gov/', target: `http://127.0.0.1:${govPort}`, bearer_env: 'SELFTEST_GOV_BEARER' },
  ]);
  process.env.NIP98_PROXY_ALLOW_BEARER = BREAK_GLASS;
  process.env.NIP98_PROXY_BEARER_PUBKEY = 'operator-break-glass';
  // Pinned so cookies minted here are verifiable by the child proxies below
  // (I/J: allowlist removal and restart under a rotated key).
  process.env.NIP98_PROXY_SESSION_SECRET = SESSION_SECRET;

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


  // ══ ADR closeout acceptance (2026-09-05) ═══════════════════════════════════

  // G. SPOOFED IDENTITY HEADERS (ADR-2009) --------------------------------------
  // A client that supplies the very headers the proxy injects must not be able
  // to assert its own identity. Both stamps must be stripped and replaced by the
  // AUTHENTICATED identity, on HTTP and on the WebSocket path.
  {
    const SPOOF = '99'.repeat(32);

    lastReq = null;
    const r = await request('/api/sessions', {
      authorization: `Bearer ${BREAK_GLASS}`,
      'x-agentbox-pubkey': SPOOF,
      'x-agentbox-auth-mode': 'nip98',
    });
    assert(r.status === 200, 'G1: request with spoofed identity headers still served', `got ${r.status}`);
    assert(lastReq && lastReq.headers['x-agentbox-pubkey'] === 'operator-break-glass',
      'G1: HTTP — client-supplied X-Agentbox-Pubkey replaced by the authenticated identity',
      JSON.stringify(lastReq && lastReq.headers['x-agentbox-pubkey']));
    assert(lastReq && !String(lastReq.headers['x-agentbox-pubkey']).includes(SPOOF),
      'G1b: HTTP — spoofed pubkey value never reaches the upstream');
    assert(lastReq && lastReq.headers['x-agentbox-auth-mode'] === 'break-glass',
      'G1c: HTTP — client-supplied X-Agentbox-Auth-Mode replaced by the real mode',
      JSON.stringify(lastReq && lastReq.headers['x-agentbox-auth-mode']));

    const nip98 = buildNip98('GET', `http://127.0.0.1:${PROXY_PORT}/api/sessions`);
    if (nip98.skip) {
      skip('G2: HTTP — spoofed header loses to the signed identity', nip98.skip);
    } else {
      lastReq = null;
      await request('/api/sessions', { authorization: nip98.header, 'x-agentbox-pubkey': SPOOF });
      assert(lastReq && lastReq.headers['x-agentbox-pubkey'] === nip98.pubkey,
        'G2: HTTP — spoofed header loses to the signed identity',
        JSON.stringify(lastReq && lastReq.headers['x-agentbox-pubkey']));
    }

    lastUpgrade = null;
    await wsUpgrade(`/sessions/abc/live-ws?access_token=${BREAK_GLASS}`,
      `X-Agentbox-Pubkey: ${SPOOF}\r\nX-Agentbox-Auth-Mode: nip98\r\n`);
    assert(lastUpgrade && lastUpgrade.headers['x-agentbox-pubkey'] === 'operator-break-glass',
      'G3: WS — client-supplied X-Agentbox-Pubkey stripped and re-injected',
      JSON.stringify(lastUpgrade && lastUpgrade.headers['x-agentbox-pubkey']));
    assert(lastUpgrade && lastUpgrade.headers['x-agentbox-auth-mode'] === 'break-glass',
      'G3b: WS — client-supplied X-Agentbox-Auth-Mode stripped and re-injected',
      JSON.stringify(lastUpgrade && lastUpgrade.headers['x-agentbox-auth-mode']));
    assert(lastUpgrade && !JSON.stringify(lastUpgrade.headers).includes(SPOOF),
      'G3c: WS — spoofed value appears nowhere in the forwarded headers',
      JSON.stringify(lastUpgrade && lastUpgrade.headers));
  }

  // H. VERIFIER FAULTS (ADR-2009 / ADR-2011) ------------------------------------
  // H(a): the verifier MODULE is unavailable. NOSTR_BRIDGE_PATH is authoritative,
  // so naming a module that is not there is the exact deployment fault (a bake
  // that missed the bridge, a bad overlay) and must NOT silently fall back to
  // another nostr-bridge.js elsewhere on the box. Break-glass is unset, so
  // nothing may pass at all.
  {
    const child = await startProxy(PORT_NO_VERIFIER, {
      NOSTR_BRIDGE_PATH: pathResolve(tmpdir(), 'nip98-selftest-absent-bridge.js'),
      NIP98_PROXY_ALLOW_BEARER: null,
      NIP98_PROXY_ALLOWED_PUBKEYS: null,
    });

    assert(/DISABLED \(fail-closed\)/.test(child.out + child.err),
      'H1: absent verifier logged as fail-closed at boot');
    assert(/no fallback/.test(child.out + child.err),
      'H1b: an explicit verifier path does not silently fall back to another module');

    const nip98 = buildNip98('GET', `http://127.0.0.1:${PORT_NO_VERIFIER}/api/sessions`);
    if (nip98.skip) {
      skip('H2: valid NIP-98 denied when the verifier is unavailable', nip98.skip);
    } else {
      lastReq = null;
      const r = await request('/api/sessions', { authorization: nip98.header }, 'GET', PORT_NO_VERIFIER);
      assert(r.status === 401, 'H2: valid NIP-98 denied when the verifier is unavailable', `got ${r.status}`);
      assert(lastReq === null, 'H2b: upstream never contacted without a verifier');
    }

    lastReq = null;
    const r2 = await request('/api/sessions', { authorization: `Bearer ${BREAK_GLASS}` }, 'GET', PORT_NO_VERIFIER);
    assert(r2.status === 401, 'H3: bearer cannot substitute for the absent verifier', `got ${r2.status}`);
    assert(lastReq === null, 'H3b: upstream never contacted on the bearer path either');

    lastUpgrade = null;
    const ws = await wsUpgrade('/sessions/abc/live-ws?auth=Zm9v', '', PORT_NO_VERIFIER);
    assert(/401/.test(ws), 'H4: WS upgrade denied when the verifier is unavailable', JSON.stringify(ws.slice(0, 40)));
    assert(lastUpgrade === null, 'H4b: upstream upgrade never attempted without a verifier');
  }

  // H(b): the verifier LOADS but misbehaves — throws, or returns a "valid"
  // result whose pubkey is absent / npub / truncated / uppercase. ADR-2011 makes
  // lowercase 64-hex the sole durable identity, so anything else must be denied
  // (or canonicalised) BEFORE it is stamped upstream as an identity.
  {
    const dir = trackTemp(mkdtempSync(pathResolve(tmpdir(), 'nip98-stubverifier-')));
    const stub = pathResolve(dir, 'stub-bridge.cjs');
    writeFileSync(stub, `'use strict';
// Selftest stub: a NIP-98 verifier whose behaviour is keyed off the request
// path, so one boot can exercise every verifier-fault mode.
function verifyNip98(authHeader, method, url) {
  const p = new URL(url).pathname;
  if (p.endsWith('/throw')) throw new Error('verifier exploded');
  if (p.endsWith('/missing')) return { valid: true };
  if (p.endsWith('/npub')) return { valid: true, pubkey: 'npub1' + 'q'.repeat(58) };
  if (p.endsWith('/short')) return { valid: true, pubkey: 'ab'.repeat(20) };
  if (p.endsWith('/upper')) return { valid: true, pubkey: 'AB'.repeat(32) };
  if (p.endsWith('/ok')) return { valid: true, pubkey: 'cd'.repeat(32) };
  return { valid: false, error: 'stub default deny' };
}
module.exports = { NostrBridge: { verifyNip98 } };
`);
    await startProxy(PORT_STUB_VERIFIER, {
      NOSTR_BRIDGE_PATH: stub,
      NIP98_PROXY_ALLOW_BEARER: null,
      NIP98_PROXY_ALLOWED_PUBKEYS: null,
    });
    const nostrHeader = { authorization: `Nostr ${Buffer.from('{}', 'utf8').toString('base64')}` };
    const cases = [
      ['throw', 'H5: throwing verifier denies (no unauthenticated routing)'],
      ['missing', 'H6: verified result with NO pubkey denied'],
      ['npub', 'H7: npub-form verified pubkey denied (ADR-2011 hex-canonical)'],
      ['short', 'H8: truncated verified pubkey denied'],
    ];
    for (const [path, name] of cases) {
      lastReq = null;
      const r = await request(`/stub/${path}`, nostrHeader, 'GET', PORT_STUB_VERIFIER);
      assert(r.status === 401, name, `got ${r.status}`);
      assert(lastReq === null, `${name.split(':')[0]}b: upstream never contacted`);
    }
    lastReq = null;
    const rUpper = await request('/stub/upper', nostrHeader, 'GET', PORT_STUB_VERIFIER);
    assert(rUpper.status === 200, 'H9: uppercase verified pubkey accepted after canonicalisation', `got ${rUpper.status}`);
    assert(lastReq && lastReq.headers['x-agentbox-pubkey'] === 'ab'.repeat(32),
      'H9b: uppercase pubkey is lowercased before it is stamped upstream',
      JSON.stringify(lastReq && lastReq.headers['x-agentbox-pubkey']));
    lastReq = null;
    const rOk = await request('/stub/ok', nostrHeader, 'GET', PORT_STUB_VERIFIER);
    assert(rOk.status === 200 && lastReq && lastReq.headers['x-agentbox-pubkey'] === 'cd'.repeat(32),
      'H10: control — a canonical verified pubkey still passes', `got ${rOk.status}`);
  }

  // I. ALLOWLIST REMOVAL (ADR-2009) ---------------------------------------------
  // An identity that was allowed and is then removed must be denied on its NEXT
  // request — including a request that rides an already-established session
  // cookie minted while it WAS allowed. The session secret is pinned across both
  // boots so the cookie's MAC stays valid: the allowlist, not the MAC, is what
  // must reject it.
  {
    const pkAllowed = '3a'.repeat(32);
    const pkOther = '4b'.repeat(32);
    const cookie = mintCookieWith(SESSION_SECRET, pkAllowed, Math.floor(Date.now() / 1000) + 3600);

    await startProxy(PORT_ALLOW_A, { NIP98_PROXY_ALLOWED_PUBKEYS: pkAllowed });
    lastReq = null;
    const rA = await request('/api/sessions', { cookie: `agentbox_nip07_session=${cookie}` }, 'GET', PORT_ALLOW_A);
    assert(rA.status === 200, 'I1: listed identity passes on its session cookie', `got ${rA.status}`);
    assert(lastReq && lastReq.headers['x-agentbox-pubkey'] === pkAllowed,
      'I1b: upstream saw the listed identity');

    await startProxy(PORT_ALLOW_B, { NIP98_PROXY_ALLOWED_PUBKEYS: pkOther });
    lastReq = null;
    const rB = await request('/api/sessions', { cookie: `agentbox_nip07_session=${cookie}` }, 'GET', PORT_ALLOW_B);
    assert(rB.status === 401, 'I2: identity removed from the allowlist is denied on the next request', `got ${rB.status}`);
    assert(lastReq === null, 'I2b: upstream never contacted for the de-listed identity');

    lastUpgrade = null;
    const wsB = await wsUpgrade('/sessions/abc/live-ws',
      `Cookie: agentbox_nip07_session=${cookie}\r\n`, PORT_ALLOW_B);
    assert(/401/.test(wsB), 'I3: de-listed session cookie also fails the WS upgrade', JSON.stringify(wsB.slice(0, 40)));
    assert(lastUpgrade === null, 'I3b: upstream upgrade never attempted for the de-listed identity');

    const nip98 = buildNip98('GET', `http://127.0.0.1:${PORT_ALLOW_B}/api/sessions`);
    if (nip98.skip) {
      skip('I4: freshly signed but unlisted identity denied', nip98.skip);
    } else {
      lastReq = null;
      const r = await request('/api/sessions', { authorization: nip98.header }, 'GET', PORT_ALLOW_B);
      assert(r.status === 401, 'I4: freshly signed but unlisted identity denied', `got ${r.status}`);
      assert(lastReq === null, 'I4b: signature validity alone does not reach the upstream');
    }
  }

  // J. COOKIE EXPIRY / RESTART UNDER A NEW HMAC KEY ------------------------------
  // The default session secret is per-boot: a restart invalidates every cookie.
  // Both halves are asserted against a live child — an expired cookie under the
  // CURRENT key, and a well-formed cookie whose MAC was made under the PREVIOUS
  // key (exactly what a restart leaves in the operator's browser).
  {
    const NEW_SECRET = 'selftest-post-restart-secret-fedcba9876543210';
    await startProxy(PORT_RESTART, { NIP98_PROXY_SESSION_SECRET: NEW_SECRET });
    const pk = '5c'.repeat(32);
    const now = Math.floor(Date.now() / 1000);

    lastReq = null;
    const expired = mintCookieWith(NEW_SECRET, pk, now - 60);
    const rExp = await request('/api/sessions', { cookie: `agentbox_nip07_session=${expired}` }, 'GET', PORT_RESTART);
    assert(rExp.status === 401, 'J1: expired session cookie rejected', `got ${rExp.status}`);
    assert(lastReq === null, 'J1b: upstream never contacted for an expired cookie');

    lastReq = null;
    const oldKey = mintCookieWith(SESSION_SECRET, pk, now + 3600);
    const rOld = await request('/api/sessions', { cookie: `agentbox_nip07_session=${oldKey}` }, 'GET', PORT_RESTART);
    assert(rOld.status === 401, 'J2: cookie minted under the previous HMAC key rejected after restart', `got ${rOld.status}`);
    assert(lastReq === null, 'J2b: upstream never contacted for a previous-key cookie');

    lastReq = null;
    const fresh = mintCookieWith(NEW_SECRET, pk, now + 3600);
    const rNew = await request('/api/sessions', { cookie: `agentbox_nip07_session=${fresh}` }, 'GET', PORT_RESTART);
    assert(rNew.status === 200, 'J3: control — a cookie under the current key still works', `got ${rNew.status}`);
  }

  // K. TOKENLESS DENIAL (ADR-2002) ----------------------------------------------
  // No NIP-98, no bearer, no cookie: denied with the documented status, and the
  // AoE daemon token must NOT be injected downstream — nothing is forwarded at all.
  {
    const AOE_TOKEN = 'ab'.repeat(32);
    lastReq = null;
    const r = await request('/api/sessions', { accept: 'application/json' }, 'POST');
    assert(r.status === 401, 'K1: tokenless request denied 401 (documented status)', `got ${r.status}`);
    assert(lastReq === null, 'K1b: AoE upstream never contacted, so no daemon token is injected');
    assert(!r.body.includes(AOE_TOKEN), 'K1c: the AoE daemon token does not leak into the denial body');

    lastUpgrade = null;
    const ws = await wsUpgrade('/sessions/abc/live-ws');
    assert(/401/.test(ws) && lastUpgrade === null,
      'K2: tokenless WS upgrade denied before any upstream connection', JSON.stringify(ws.slice(0, 40)));

    lastMgmtReq = null;
    const rm = await request('/mgmt/v1/system', {}, 'POST');
    assert(rm.status === 401 && lastMgmtReq === null,
      'K3: tokenless request to a named route denied before routing', `got ${rm.status}`);
  }

  // L. BEARER GATED BEHIND NIP-98 (ADR-2010) ------------------------------------
  // /gov/ is a named route holding a bearer_env secret. The gate: the route
  // bearer is injected ONLY when the caller did not sign; a genuinely signed
  // caller's own Authorization reaches the upstream so it can re-verify the
  // operator signature itself. AoE keeps its daemon token in every mode.
  {
    const url = `http://127.0.0.1:${PROXY_PORT}/gov/approve`;
    const nip98 = buildNip98('POST', url);
    if (nip98.skip) {
      skip('L1: signed NIP-98 identity reaches the governance upstream', nip98.skip);
    } else {
      lastGovReq = null;
      const r = await request('/gov/approve', { authorization: nip98.header }, 'POST');
      assert(r.status === 200, 'L1: signed request reaches the governance route', `got ${r.status}`);
      assert(lastGovReq && lastGovReq.headers.authorization === nip98.header,
        'L1b: the signed NIP-98 Authorization reaches the upstream gate untouched',
        JSON.stringify(lastGovReq && lastGovReq.headers.authorization));
      assert(lastGovReq && lastGovReq.headers.authorization !== `Bearer ${GOV_BEARER}`,
        'L1c: the route bearer is NOT injected in auth.mode=nip98');
      assert(lastGovReq && lastGovReq.headers['x-forwarded-host'] === `127.0.0.1:${PROXY_PORT}`,
        'L1d: X-Forwarded-Host lets the upstream rebuild the signed u-tag URL',
        JSON.stringify(lastGovReq && lastGovReq.headers['x-forwarded-host']));
      assert(lastGovReq && lastGovReq.headers['x-agentbox-auth-mode'] === 'nip98',
        'L1e: upstream told the identity was a live signature');
    }

    // Non-signing modes DO get the route bearer (they carry nothing the upstream
    // could verify): break-glass and cookie session.
    lastGovReq = null;
    await request('/gov/approve', { authorization: `Bearer ${BREAK_GLASS}` }, 'POST');
    assert(lastGovReq && lastGovReq.headers.authorization === `Bearer ${GOV_BEARER}`,
      'L2: break-glass mode receives the route bearer',
      JSON.stringify(lastGovReq && lastGovReq.headers.authorization));

    lastGovReq = null;
    const cookieTok = proxyMod.mintSessionToken('6d'.repeat(32));
    await request('/gov/approve', { cookie: `agentbox_nip07_session=${cookieTok}` }, 'POST');
    assert(lastGovReq && lastGovReq.headers.authorization === `Bearer ${GOV_BEARER}`,
      'L3: cookie-session mode receives the route bearer',
      JSON.stringify(lastGovReq && lastGovReq.headers.authorization));

    // A bearer alone — even the upstream's OWN bearer — is not an identity here.
    lastGovReq = null;
    const rb = await request('/gov/approve', { authorization: `Bearer ${GOV_BEARER}` }, 'POST');
    assert(rb.status === 401, 'L4: bearer-only request cannot reach a mutation route', `got ${rb.status}`);
    assert(lastGovReq === null, 'L4b: governance upstream never contacted by a bearer-only caller');

    // WS mirror of the same gate.
    const wsUrl = `http://127.0.0.1:${PROXY_PORT}/gov/ws`;
    const wsNip98 = buildNip98('GET', wsUrl);
    if (wsNip98.skip) {
      skip('L5: WS — signed identity reaches the governance upstream', wsNip98.skip);
    } else {
      lastGovUpgrade = null;
      const b64 = wsNip98.header.slice('Nostr '.length);
      await wsUpgrade(`/gov/ws?auth=${encodeURIComponent(b64)}`);
      assert(lastGovUpgrade && lastGovUpgrade.headers.authorization === wsNip98.header,
        'L5: WS — signed identity reaches the governance upstream untouched',
        JSON.stringify(lastGovUpgrade && lastGovUpgrade.headers.authorization));
      assert(lastGovUpgrade && lastGovUpgrade.headers.authorization !== `Bearer ${GOV_BEARER}`,
        'L5b: WS — route bearer NOT injected in auth.mode=nip98');
    }

    lastGovUpgrade = null;
    await wsUpgrade(`/gov/ws?access_token=${BREAK_GLASS}`);
    assert(lastGovUpgrade && lastGovUpgrade.headers.authorization === `Bearer ${GOV_BEARER}`,
      'L6: WS — non-signing mode receives the route bearer',
      JSON.stringify(lastGovUpgrade && lastGovUpgrade.headers.authorization));

    // The AoE default route is the deliberate exception: daemon token always.
    const aoeUrl = `http://127.0.0.1:${PROXY_PORT}/api/sessions`;
    const aoeNip98 = buildNip98('GET', aoeUrl);
    if (aoeNip98.skip) {
      skip('L7: AoE receives its daemon token even in nip98 mode', aoeNip98.skip);
    } else {
      lastReq = null;
      await request('/api/sessions', { authorization: aoeNip98.header });
      assert(lastReq && lastReq.headers.authorization === `Bearer ${'ab'.repeat(32)}`,
        'L7: AoE receives its daemon token even in nip98 mode (HTTP)',
        JSON.stringify(lastReq && lastReq.headers.authorization));
      lastUpgrade = null;
      const wsAoe = buildNip98('GET', `http://127.0.0.1:${PROXY_PORT}/sessions/abc/live-ws`);
      await wsUpgrade(`/sessions/abc/live-ws?auth=${encodeURIComponent(wsAoe.header.slice('Nostr '.length))}`);
      assert(lastUpgrade && lastUpgrade.headers.authorization === `Bearer ${'ab'.repeat(32)}`,
        'L7b: AoE receives its daemon token even in nip98 mode (WS)',
        JSON.stringify(lastUpgrade && lastUpgrade.headers.authorization));
    }
  }

  // M. HEX-CANONICAL IDENTITY HELPER (ADR-2011) ---------------------------------
  {
    const identity = require(pathResolve(__dirname, '../../management-api/lib/agent-identity.js'));
    const dir = trackTemp(mkdtempSync(pathResolve(tmpdir(), 'agent-identity-')));
    const keyPath = pathResolve(dir, 'agent-did-selftest.key');
    const HEX64 = /^[0-9a-f]{64}$/;

    const first = identity.loadOrMint({ keyPath });
    assert(!!first && HEX64.test(first.pubkey),
      'M1: minted identity is a lowercase 64-hex x-only pubkey', JSON.stringify(first && first.pubkey));
    assert(first && first.did === `did:nostr:${first.pubkey}`,
      'M1b: did:nostr uses the canonical hex verbatim', JSON.stringify(first && first.did));
    assert(first && first.multikey === `fe70102${first.pubkey}` && first.multikey.length === 71,
      'M1c: Multikey is the fixed 71-char fe70102-prefixed form', JSON.stringify(first && first.multikey));
    assert(first && first.persisted === true && first.minted === true,
      'M1d: fresh mint reports minted + persisted', JSON.stringify(first));

    const mode = statSync(keyPath).mode & 0o777;
    assert(mode === 0o600, 'M2: private key file persisted with mode 0600', `got 0${mode.toString(8)}`);

    const second = identity.loadOrMint({ keyPath });
    assert(second && second.pubkey === first.pubkey && second.minted === false,
      'M3: restart with the same key file yields the same identity (not a re-mint)',
      JSON.stringify(second && { pubkey: second.pubkey, minted: second.minted }));

    const storedPriv = readFileSync(keyPath, 'utf8').trim();
    assert(HEX64.test(storedPriv) && !JSON.stringify(second).includes(storedPriv),
      'M4: the returned identity carries no private key material');

    // Persistence failure: the key path's parent is a regular file, so mkdir and
    // write both fail. The identity must still be valid but must SAY it is
    // unstable rather than pretending it will survive a restart.
    const blocker = pathResolve(dir, 'blocker');
    writeFileSync(blocker, 'not a directory\n');
    const unstable = identity.loadOrMint({ keyPath: pathResolve(blocker, 'agent-did.key') });
    assert(unstable && HEX64.test(unstable.pubkey) && unstable.persisted === false,
      'M5: persistence failure surfaces persisted:false, not a silently unstable identity',
      JSON.stringify(unstable && { persisted: unstable.persisted }));

    assert(identity.deriveXonly(`npub1${'q'.repeat(58)}`) === null,
      'M6: deriveXonly rejects npub/bech32 input');
    assert(identity.deriveXonly('ab'.repeat(20)) === null, 'M6b: deriveXonly rejects a short key');
    assert(identity.deriveXonly(`${'g'.repeat(64)}`) === null, 'M6c: deriveXonly rejects non-hex input');
    assert(identity.deriveXonly(storedPriv.toUpperCase()) === first.pubkey,
      'M6d: an uppercase private hex still derives the lowercase canonical pubkey');

    // The mint CLI is what the entrypoint evals — it must never print the key.
    const cliDir = trackTemp(mkdtempSync(pathResolve(tmpdir(), 'agent-identity-cli-')));
    const cliOut = execFileSync(process.execPath,
      [pathResolve(__dirname, '../../management-api/lib/agent-identity.js'), 'mint'],
      {
        env: { ...process.env, AGENTBOX_AGENT_IDENTITY_DIR: cliDir, AGENTBOX_PROFILE: 'selftest' },
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      });
    const cliKeyFile = pathResolve(cliDir, 'agent-did-selftest.key');
    const cliPriv = readFileSync(cliKeyFile, 'utf8').trim();
    assert(!cliOut.includes(cliPriv) && /export AGENTBOX_AGENT_DID=did:nostr:[0-9a-f]{64}/.test(cliOut),
      'M7: the mint CLI exports the public DID and never the private key');
    assert((statSync(cliKeyFile).mode & 0o777) === 0o600, 'M7b: CLI-minted key file is 0600');
  }

  // M8. No secret material in anything the proxy logs.
  {
    const logs = children.map((c) => c.out + c.err).join('\n');
    const leaked = [
      ['session HMAC secret', SESSION_SECRET],
      ['break-glass token', BREAK_GLASS],
      ['route bearer', GOV_BEARER],
      ['AoE daemon token', 'ab'.repeat(32)],
    ].filter(([, v]) => logs.includes(v)).map(([n]) => n);
    assert(leaked.length === 0, 'M8: no credential material appears in proxy stdout/stderr', leaked.join(', '));
    assert(logs.length > 0, 'M8b: child proxy logs were actually captured (the check is not vacuous)');
  }

  // N. BREAK-GLASS IS BOUNDED AUTHORITY (ADR-2027) ------------------------------
  //
  // The estate review found "a static break-glass token comparison without
  // branch-local expiry/scope checks", and that returning a mode/identity is
  // "not durable per-use audit". These cases exercise the three bounds against
  // real proxy children: the correct token must still be refused when the
  // credential has expired or the request is out of scope, and every accepted
  // use must leave an auditable record carrying a FINGERPRINT, never the token.
  {
    // N1. Expired credential — the right token, refused.
    const expired = await startProxy(PORT_BG_EXPIRED, {
      NIP98_PROXY_ALLOW_BEARER: BREAK_GLASS,
      NIP98_PROXY_BEARER_EXPIRES_AT: new Date(Date.now() - 60_000).toISOString(),
    });
    const rExpired = await request('/health', { authorization: `Bearer ${BREAK_GLASS}` }, 'GET', PORT_BG_EXPIRED);
    assert(rExpired.status === 401,
      'N1: an EXPIRED break-glass credential is refused despite a correct token',
      `status ${rExpired.status}`);
    assert(/break-glass REFUSED/.test(expired.out + expired.err),
      'N1b: the refusal is audited');
    assert(!(expired.out + expired.err).includes(BREAK_GLASS),
      'N1c: the refused token itself never appears in the audit record');

    // N2. Scope — in-scope accepted, out-of-scope refused with the same token.
    const scoped = await startProxy(PORT_BG_SCOPED, {
      NIP98_PROXY_ALLOW_BEARER: BREAK_GLASS,
      NIP98_PROXY_BEARER_SCOPE: 'GET /sessions',
    });
    const inScope = await request('/sessions/abc', { authorization: `Bearer ${BREAK_GLASS}` }, 'GET', PORT_BG_SCOPED);
    assert(inScope.status === 200,
      'N2: an IN-SCOPE break-glass request is accepted', `status ${inScope.status}`);
    const outOfScope = await request('/admin/danger', { authorization: `Bearer ${BREAK_GLASS}` }, 'GET', PORT_BG_SCOPED);
    assert(outOfScope.status === 401,
      'N2b: the SAME token is refused outside its request scope', `status ${outOfScope.status}`);
    const wrongMethod = await request('/sessions/abc', { authorization: `Bearer ${BREAK_GLASS}` }, 'DELETE', PORT_BG_SCOPED);
    assert(wrongMethod.status === 401,
      'N2c: the scope binds the METHOD as well as the path', `status ${wrongMethod.status}`);

    // N3. Per-use audit, by fingerprint.
    const scopedLogs = scoped.out + scoped.err;
    assert(/break-glass USED/.test(scopedLogs), 'N3: an accepted use is audited');
    const fpMatch = scopedLogs.match(/"fingerprint":"([0-9a-f]{12})"/);
    assert(!!fpMatch, 'N3b: the audit record carries a token fingerprint');
    assert(!scopedLogs.includes(BREAK_GLASS),
      'N3c: the audit record never contains the token itself');
    assert(/"use_count":1/.test(scopedLogs), 'N3d: uses are counted for correlation');

    // N4. A malformed expiry is FAIL-CLOSED — an operator who tried to bound the
    // credential and mistyped must not silently get an unbounded one.
    const malformed = await startProxy(PORT_BG_MALFORMED_EXPIRY, {
      NIP98_PROXY_ALLOW_BEARER: BREAK_GLASS,
      NIP98_PROXY_BEARER_EXPIRES_AT: 'not-a-date',
    });
    const rMal = await request('/health', { authorization: `Bearer ${BREAK_GLASS}` }, 'GET', PORT_BG_MALFORMED_EXPIRY);
    assert(rMal.status === 401,
      'N4: a MALFORMED expiry fails closed rather than defaulting to unbounded',
      `status ${rMal.status}`);
    assert(/malformed NIP98_PROXY_BEARER_EXPIRES_AT/.test(malformed.out + malformed.err),
      'N4b: the malformed-expiry refusal names the cause');

    // N5. Back-compatibility: with neither bound set the credential behaves
    // exactly as before, and the status line SAYS it is unbounded rather than
    // presenting an unbounded credential as a bounded one.
    const unbounded = await request('/health', { authorization: `Bearer ${BREAK_GLASS}` });
    assert(unbounded.status === 200,
      'N5: with no bounds configured the break-glass path is unchanged', `status ${unbounded.status}`);
    const mainLogs = children.map((c) => c.out + c.err).join('\n');
    assert(/NO EXPIRY CONFIGURED/.test(mainLogs) || /"expires_at":null/.test(mainLogs),
      'N5b: an unbounded credential is reported as unbounded, never as bounded');
  }

  console.log(`\n${failures === 0 ? 'OK' : 'FAILED'} — ${failures} failure(s), ${skips} skip(s)`);
  stopChildren();
  upstream.close();
  mgmtUpstream.close();
  govUpstream.close();
  process.exit(failures === 0 ? 0 : 1);
}

process.on('exit', () => {
  stopChildren();
  for (const p of tempPaths) { try { rmSync(p, { recursive: true, force: true }); } catch { /* gone */ } }
});

main().catch((err) => { console.error('self-test crashed:', err); stopChildren(); process.exit(1); });
