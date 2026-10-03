'use strict';
/**
 * G-5 key split: dual-admit at the agentbox verifiers, driven by config.
 *
 * Runner: node:test (`node --test tests/sovereign/g5-key-split.node-test.js`).
 *
 * config/custody/g5-key-split.json names the house key and each replacement
 * key's PUBLIC half (null until the owner supplies it). These tests take those
 * pubkeys from config and check them against the real verifier path:
 *
 *   agentbox.toml --(agentbox-manifest nip98-config)--> proxy config file
 *                 --(config/nip98-proxy/proxy.mjs)----> admit / 401
 *
 * The proxy's session-cookie path enforces the same allowlist as NIP-98 and
 * can be exercised for a pubkey without its private key: the cookie MAC is keyed
 * by a session secret pinned for the test, never by the identity. That is why a
 * public key alone is enough to prove admission, which matters because no
 * replacement private key ever enters this repo or container.
 *
 * Until a replacement pubkey is supplied, its admission cases skip with a
 * reason, and a synthetic candidate key exercises the same dual-admit
 * path. No real secret is used anywhere.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '../..');
const G5 = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/custody/g5-key-split.json'), 'utf8'));
const MANIFEST_TOML = path.join(ROOT, 'agentbox.toml');
const PROXY = path.join(ROOT, 'config/nip98-proxy/proxy.mjs');
const { secp256k1 } = require(path.join(ROOT, 'management-api/node_modules/@noble/curves/secp256k1.js'));

const HEX64 = /^[0-9a-f]{64}$/;
const PROXY_PATH = 'interaction_plane.proxy.allowed_pubkeys';
/** Verifier paths these tests can drive. An unknown one fails loudly. */
const KNOWN_VERIFIERS = new Set([PROXY_PATH]);
const SESSION_SECRET = 'cd'.repeat(32);
const AOE_TOKEN = 'ef'.repeat(32);

/** BIP-340 lift_x: a valid x-only key is the x of a curve point with even y. */
function isXonlyPoint(hex) {
  if (!HEX64.test(hex)) return false;
  return secp256k1.utils.isValidPublicKey(Buffer.from(`02${hex}`, 'hex'), true);
}

/** A synthetic x-only pubkey from a fresh random scalar (never persisted). */
function syntheticPubkey() {
  return Buffer.from(secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), true).slice(1)).toString('hex');
}

function supplied() { return G5.replacements.filter((r) => r.pubkey !== null); }
function houseStillAdmittedAt(verifier) {
  return !G5.house_key_withdrawn_from.some((role) =>
    (G5.replacements.find((r) => r.role === role)?.agentbox_verifiers || []).includes(verifier));
}

function manifestBin() {
  const env = process.env.AGENTBOX_MANIFEST_BIN;
  if (env) return env;
  const r = spawnSync('sh', ['-c', 'command -v agentbox-manifest'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** The REAL projection of agentbox.toml's proxy allowlist. */
function projectProxyAllowlist(tomlPath) {
  const bin = manifestBin();
  if (!bin) return { skip: 'agentbox-manifest not on PATH (set AGENTBOX_MANIFEST_BIN)' };
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'g5-')), 'nip98.json');
  const r = spawnSync(bin, ['nip98-config', '--manifest', tomlPath, '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, `nip98-config failed: ${r.stderr}`);
  return { allowed: JSON.parse(fs.readFileSync(out, 'utf8')).allowedPubkeys.map((p) => p.toLowerCase()) };
}

/** The proxy's v1 session cookie under the pinned test secret (node:crypto HMAC). */
function cookieFor(pubkey) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const mac = crypto.createHmac('sha256', SESSION_SECRET).update(`${pubkey}.${exp}`).digest('hex');
  return `agentbox_nip07_session=v1.${pubkey}.${exp}.${mac}`;
}

function freePort() {
  return new Promise((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
}

function get(port, headers) {
  return new Promise((resolve) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/api/sessions', headers }, (res) => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', () => resolve(0));
    req.end();
  });
}

/** Boot the real proxy with ONLY the given allowlist as its config file. */
async function bootProxy(t, allowedPubkeys) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g5-proxy-'));
  const upstream = http.createServer((q, s) => { s.writeHead(200); s.end('{}'); });
  await new Promise((r) => upstream.listen(0, '127.0.0.1', r));
  const upPort = upstream.address().port;
  const cfg = path.join(dir, 'nip98.json');
  fs.writeFileSync(cfg, JSON.stringify({ routes: [], allowedPubkeys }));
  const tok = path.join(dir, 'serve.url');
  fs.writeFileSync(tok, `http://127.0.0.1:${upPort}/?token=${AOE_TOKEN}\n`);
  const port = await freePort();
  const env = { PATH: process.env.PATH, HOME: dir, NIP98_PROXY_PORT: String(port), NIP98_PROXY_HOST: '127.0.0.1',
    NIP98_PROXY_CONFIG_FILE: cfg, NIP98_PROXY_SESSION_SECRET: SESSION_SECRET,
    AOE_UPSTREAM: `http://127.0.0.1:${upPort}`, AOE_TOKEN_FILE: tok };
  const proc = spawn(process.execPath, [PROXY], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let err = ''; proc.stderr.on('data', (c) => { err += c; });
  t.after(() => { proc.kill('SIGKILL'); upstream.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`proxy exited ${proc.exitCode}: ${err.slice(0, 300)}`);
    const up = await new Promise((r) => { const c = net.connect(port, '127.0.0.1'); c.on('connect', () => { c.destroy(); r(true); }); c.on('error', () => r(false)); });
    if (up) return port;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`proxy never bound: ${err.slice(0, 300)}`);
}

// ─── Config shape ──────────────────────────────────────────────────────────

test('G5-1 config carries public keys only, in a well-formed shape', () => {
  assert.equal(G5.house_key, '11ed64225dd5e2c5e18f61ad43d5ad9272d08739d3a20dd25886197b0738663c');
  const roles = G5.replacements.map((r) => r.role);
  assert.equal(new Set(roles).size, roles.length, 'roles are unique');
  assert.ok(!roles.includes('k_admin'), 'K_admin is the operator\'s, verified by the forum: never listed here (D2)');
  const walk = (v, at) => {
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
      assert.ok(!/priv|secret|nsec|seed|mnemonic/i.test(k) || k === '$comment', `secret-shaped field ${at}.${k}`);
      walk(x, `${at}.${k}`);
    } else if (typeof v === 'string') assert.ok(!/^nsec1/i.test(v), `nsec value at ${at}`);
  };
  walk(G5, 'g5');
  for (const r of G5.replacements) {
    assert.ok(r.pubkey === null || HEX64.test(r.pubkey), `${r.role}.pubkey is null or lowercase 64-hex`);
    for (const v of r.agentbox_verifiers) assert.ok(KNOWN_VERIFIERS.has(v), `${r.role}: unknown verifier ${v}`);
  }
  for (const w of G5.house_key_withdrawn_from) assert.ok(roles.includes(w), `withdrawn role ${w} exists`);
});

test('G5-2 every supplied pubkey is a real x-only point, distinct from the house key and each other', () => {
  // The validator itself: accepts the house key, refuses x >= p and junk.
  assert.ok(isXonlyPoint(G5.house_key));
  assert.ok(!isXonlyPoint('ff'.repeat(32)), 'x >= field prime is refused');
  assert.ok(!isXonlyPoint('zz'.repeat(32)));
  const seen = new Set([G5.house_key]);
  for (const r of supplied()) {
    assert.ok(isXonlyPoint(r.pubkey), `${r.role}: ${r.pubkey.slice(0, 8)}… is not a secp256k1 x-only key (typo?)`);
    assert.ok(!seen.has(r.pubkey), `${r.role} must be a NEW independent key, not a reused one`);
    seen.add(r.pubkey);
  }
});

// ─── Projection: agentbox.toml → proxy config ──────────────────────────────

test('G5-3 projection keeps the house key and carries every supplied replacement (dual-admit)', async (t) => {
  const p = projectProxyAllowlist(MANIFEST_TOML);
  if (p.skip) { t.skip(p.skip); return; }
  if (houseStillAdmittedAt(PROXY_PATH)) {
    assert.ok(p.allowed.includes(G5.house_key), 'house key still admitted until step E withdraws it');
  } else {
    assert.ok(!p.allowed.includes(G5.house_key), 'house key withdrawn from the proxy: must be gone');
  }
  for (const r of G5.replacements.filter((x) => x.agentbox_verifiers.includes(PROXY_PATH))) {
    await t.test(`${r.role} is projected`, (st) => {
      if (r.pubkey === null) { st.skip(`${r.role} pubkey not yet supplied by the owner (handoff step A)`); return; }
      assert.ok(p.allowed.includes(r.pubkey), `${r.role} missing from [interaction_plane.proxy].allowed_pubkeys`);
    });
  }
});

// ─── The running verifier ──────────────────────────────────────────────────

test('G5-4 the real proxy admits the house key and every supplied replacement, refuses an outsider', async (t) => {
  const p = projectProxyAllowlist(MANIFEST_TOML);
  if (p.skip) { t.skip(p.skip); return; }
  const port = await bootProxy(t, p.allowed);
  if (houseStillAdmittedAt(PROXY_PATH)) assert.equal(await get(port, { cookie: cookieFor(G5.house_key) }), 200, 'house key admitted');
  for (const r of G5.replacements.filter((x) => x.agentbox_verifiers.includes(PROXY_PATH))) {
    await t.test(`${r.role} admitted`, async (st) => {
      if (r.pubkey === null) { st.skip(`${r.role} pubkey not yet supplied by the owner (handoff step A)`); return; }
      assert.equal(await get(port, { cookie: cookieFor(r.pubkey) }), 200);
    });
  }
  assert.equal(await get(port, { cookie: cookieFor(syntheticPubkey()) }), 401, 'unlisted key refused');
  assert.equal(await get(port, {}), 401, 'no credential refused');
});

test('G5-5 dual-admit mechanics with a synthetic candidate: adding a key admits it beside the house key', async (t) => {
  const p = projectProxyAllowlist(MANIFEST_TOML);
  if (p.skip) { t.skip(p.skip); return; }
  const candidate = syntheticPubkey();
  assert.ok(isXonlyPoint(candidate));
  const port = await bootProxy(t, [...p.allowed, candidate]);
  assert.equal(await get(port, { cookie: cookieFor(candidate) }), 200, 'new key admitted after addition');
  assert.equal(await get(port, { cookie: cookieFor(G5.house_key) }), 200, 'house key still admitted beside it');
  assert.equal(await get(port, { cookie: cookieFor(syntheticPubkey()) }), 401, 'a different key is not admitted');
});

test('G5-6 withdrawal mechanics (step E rehearsal): dropping the house key refuses it, keeps the replacement', async (t) => {
  const p = projectProxyAllowlist(MANIFEST_TOML);
  if (p.skip) { t.skip(p.skip); return; }
  const candidate = syntheticPubkey();
  const port = await bootProxy(t, [...p.allowed.filter((k) => k !== G5.house_key), candidate]);
  assert.equal(await get(port, { cookie: cookieFor(G5.house_key) }), 401, 'withdrawn house key refused, even on a valid-MAC cookie');
  assert.equal(await get(port, { cookie: cookieFor(candidate) }), 200, 'replacement unaffected');
});
