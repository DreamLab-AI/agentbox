'use strict';

/**
 * Custody X-1 step 1 (W3, ADR-2122): the pods signer through the identity port.
 *
 * Spawns the real `nostr-pod-bridge serve-identity` with a throwaway key in a
 * temp dir, calls it through the real `sign-request` client, and verifies every
 * header with the production verifier (`NostrBridge.verifyNip98`). Real crypto
 * throughout; only `fetch` is stubbed.
 *
 * Cases:
 *   1. `sign-request nip98` → a header verifyNip98 accepts as the port's key,
 *      with the body bound through the payload tag.
 *   2. role_isolation on: each pods operation (both impls, production wiring
 *      via resolveAdapters) sends one request signed by the port, with NO
 *      identity file present: the port is the only source.
 *   3. role_isolation on, no socket → SigningUnavailable, zero requests sent.
 *   4. role_isolation on, URL outside the port's allowlist → refused →
 *      SigningUnavailable, zero requests sent.
 *   5. flag off and no sign_source → the port is never consulted.
 *
 * The binary comes from NOSTR_POD_BRIDGE_BIN, else the crate's target dir.
 * Without a built binary every case is skipped (and says so): CI images that
 * carry no Rust toolchain still run the rest of test:node.
 */

const { describe, test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');

const { generateSecretKey, getPublicKey, finalizeEvent } =
  require('../../management-api/node_modules/nostr-tools');
const { NostrBridge } = require('../../mcp/servers/nostr-bridge');
const { resolveAdapters } = require('../../management-api/adapters');
const { ExternalPodsAdapter } = require('../../management-api/adapters/pods/external');
const { SigningUnavailable } = require('../../management-api/adapters/errors');
const { buildPodNip98 } = require('../../management-api/lib/pod-signer');

const CRATE = path.join(__dirname, '../../services/nostr-pod-bridge');
function findBin() {
  const c = [
    process.env.NOSTR_POD_BRIDGE_BIN,
    process.env.CARGO_TARGET_DIR && path.join(process.env.CARGO_TARGET_DIR, 'debug/nostr-pod-bridge'),
    path.join(CRATE, 'target/debug/nostr-pod-bridge'),
    path.join(CRATE, 'target/release/nostr-pod-bridge'),
  ].filter(Boolean);
  return c.find((p) => { try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; } });
}
const BIN = findBin();
const SKIP = BIN ? false : 'nostr-pod-bridge not built (set NOSTR_POD_BRIDGE_BIN)';

const ENV_KEYS = [
  'AGENTBOX_IDENTITY_ROOT', 'AGENTBOX_AGENT_ID', 'AGENTBOX_STACK', 'AGENTBOX_PROFILE', 'OPF_MODE',
  'AGENTBOX_POD_BRIDGE_BIN', 'AGENTBOX_IDENTITY_SOCK', 'AGENTBOX_ROLE_ISOLATION',
];

const POD = 'http://pod.test';

/** Start serve-identity on a temp socket with a fresh key; resolve when listening. */
async function startPort(tmp) {
  const sk = generateSecretKey();
  const pubkey = getPublicKey(sk);
  const keys = path.join(tmp, 'keys');
  const run = path.join(tmp, 'run');
  fs.mkdirSync(keys, { mode: 0o700 });
  fs.mkdirSync(run, { mode: 0o755 });
  fs.writeFileSync(path.join(keys, 'core.key'), Buffer.from(sk).toString('hex'), { mode: 0o400 });
  fs.writeFileSync(path.join(tmp, 'acl.json'), JSON.stringify({
    version: 1,
    keys: { core: { file: 'core.key', required: true, nip98_url_prefixes: [POD] } },
    callers: { [String(process.getuid())]: { name: 'node-test', ops: {
      pubkey: { keys: ['core'] }, nip98: { keys: ['core'] },
    } } },
  }));
  const sock = path.join(run, 'identity.sock');
  const child = spawn(BIN, ['serve-identity'], {
    env: {
      PATH: process.env.PATH,
      RUST_LOG: 'warn',
      AGENTBOX_ROLE_ISOLATION: '1',
      AGENTBOX_IDENTITY_ACL: path.join(tmp, 'acl.json'),
      AGENTBOX_IDENTITY_KEY_DIR: keys,
      AGENTBOX_IDENTITY_SOCK: sock,
      AGENTBOX_IDENTITY_RECEIPT_DIR: path.join(tmp, 'receipts'),
      AGENTBOX_CONFIG: path.join(tmp, 'absent.toml'),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const deadline = Date.now() + 10000;
  while (!fs.existsSync(sock)) {
    if (Date.now() > deadline || child.exitCode !== null) {
      child.kill();
      throw new Error(`serve-identity did not listen: ${stderr}`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  return { child, sock, pubkey, skHex: Buffer.from(sk).toString('hex') };
}

function signRequestCli(sock, op, params) {
  const r = spawnSync(BIN, ['sign-request', op], {
    env: { AGENTBOX_IDENTITY_SOCK: sock }, input: JSON.stringify(params),
  });
  return { code: r.status, out: JSON.parse(r.stdout.toString() || 'null') };
}

function okResponse(url) {
  return {
    ok: true, status: 200, url,
    headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'text/turtle' : null) },
    text: async () => '',
    json: async () => ({ '@graph': [], _cursor: null }),
  };
}

const OPS = [
  ['write', ['/kg/a', '<a> <b> <c> .', 'text/turtle'], 'PUT'],
  ['read', ['/kg/a'], 'GET'],
  ['patch', ['/kg/a', [{ op: 'add', path: '/b', value: 2 }]], 'PATCH'],
  ['del', ['/kg/a'], 'DELETE'],
  ['list', ['/kg/'], 'GET'],
];

function manifest(impl, { isolation = true, base = POD } = {}) {
  return {
    adapters: { pods: impl },
    federation: { external_url: base },
    integrations: { solid_pod_rs: { base_url: base, sign_requests: true } },
    security: { role_isolation: isolation },
  };
}

function makePods(impl, m) {
  if (impl !== 'external') return resolveAdapters(m).pods;
  const nip98 = buildPodNip98(m, { onError: () => {} });
  return new ExternalPodsAdapter({ baseUrl: m.integrations.solid_pod_rs.base_url, nip98, requireSigned: true });
}

describe('identity port: NIP-98 via serve-identity', { skip: SKIP }, () => {
  const ctx = {};
  before(async () => {
    ctx.tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'idport-'));
    ctx.port = await startPort(ctx.tmp);
  });
  after(() => {
    if (ctx.port) ctx.port.child.kill();
    fs.rmSync(ctx.tmp, { recursive: true, force: true });
  });
  beforeEach(() => {
    // Same method + URL + body in the same second is the same event id, which
    // the verifier's replay defence rightly rejects across tests.
    NostrBridge._resetReplayCache();
    ctx.savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    // An empty identity root: if anything read the sovereign file, it would fail.
    ctx.idRoot = fs.mkdtempSync(path.join(ctx.tmp, 'idroot-'));
    process.env.AGENTBOX_IDENTITY_ROOT = ctx.idRoot;
    process.env.AGENTBOX_AGENT_ID = 'agentbox-core';
    process.env.OPF_MODE = 'off';
    process.env.AGENTBOX_POD_BRIDGE_BIN = BIN;
    process.env.AGENTBOX_IDENTITY_SOCK = ctx.port.sock;
    ctx.savedFetch = global.fetch;
    ctx.savedWarn = console.warn;
    console.warn = () => {};
    ctx.calls = [];
    global.fetch = async (url, init = {}) => { ctx.calls.push({ url, init }); return okResponse(url); };
  });
  afterEach(() => {
    global.fetch = ctx.savedFetch;
    console.warn = ctx.savedWarn;
    for (const k of ENV_KEYS) {
      if (ctx.savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = ctx.savedEnv[k];
    }
  });

  test('the production verifier can run Schnorr here (guards against a vacuous pass)', () => {
    const ev = finalizeEvent({
      kind: 27235, created_at: Math.floor(Date.now() / 1000),
      tags: [['u', 'http://x/'], ['method', 'GET']], content: '',
    }, generateSecretKey());
    const r = NostrBridge.verifyNip98(`Nostr ${Buffer.from(JSON.stringify(ev)).toString('base64')}`, 'GET', 'http://x/');
    assert.equal(r.valid, true, `verifier unavailable: ${r.error} (set NODE_PATH)`);
  });

  test('case 1: sign-request nip98 verifies as the port key with the body bound', () => {
    const body = '<a> <b> <c> .';
    const url = `${POD}/kg/a?ignored=1`;
    const { code, out } = signRequestCli(ctx.port.sock, 'nip98', {
      key: 'core', method: 'put', url,
      payload_sha256: crypto.createHash('sha256').update(body).digest('hex'),
    });
    assert.equal(code, 0, JSON.stringify(out));
    assert.deepEqual(NostrBridge.verifyNip98(out.header, 'PUT', `${POD}/kg/a`, body),
      { valid: true, pubkey: ctx.port.pubkey, error: null });
    // A substituted body fails: the payload tag is really bound.
    const again = signRequestCli(ctx.port.sock, 'nip98', {
      method: 'PUT', url, payload_sha256: crypto.createHash('sha256').update(body).digest('hex'),
    });
    assert.equal(NostrBridge.verifyNip98(again.out.header, 'PUT', `${POD}/kg/a`, 'other').valid, false);
    assert.ok(!JSON.stringify(out).includes(ctx.port.skHex));
  });

  for (const impl of ['local-solid-rs', 'external']) {
    test(`case 2 (${impl}): under role_isolation every pods op is signed by the port, and only by it`, async () => {
      const pods = makePods(impl, manifest(impl));
      for (const [op, args, method] of OPS) {
        const before = ctx.calls.length;
        await pods[op](...args);
        const issued = ctx.calls.slice(before)
          .filter((c) => (c.init.method || 'GET').toUpperCase() !== 'OPTIONS');
        assert.equal(issued.length, 1, `${op} issued ${issued.length} requests`);
        const { url, init } = issued[0];
        const auth = init.headers && init.headers.Authorization;
        assert.equal(typeof auth, 'string', `${op} went out unsigned`);
        assert.deepEqual(NostrBridge.verifyNip98(auth, method, url, init.body),
          { valid: true, pubkey: ctx.port.pubkey, error: null }, `${op} header does not verify`);
      }
      assert.deepEqual(fs.readdirSync(ctx.idRoot), [], 'an identity file appeared');
    });

    test(`case 3 (${impl}): no socket → SigningUnavailable, zero requests`, async () => {
      process.env.AGENTBOX_IDENTITY_SOCK = path.join(ctx.tmp, 'run/absent.sock');
      const pods = makePods(impl, manifest(impl));
      for (const [op, args] of OPS) {
        await assert.rejects(() => pods[op](...args), (e) => e instanceof SigningUnavailable, op);
      }
      assert.equal(ctx.calls.length, 0);
    });

    test(`case 4 (${impl}): a URL outside the port's allowlist is refused, zero requests`, async () => {
      const pods = makePods(impl, manifest(impl, { base: 'http://elsewhere.test' }));
      for (const [op, args] of OPS) {
        await assert.rejects(() => pods[op](...args), (e) => e instanceof SigningUnavailable && /refused/.test(e.message), op);
      }
      assert.equal(ctx.calls.length, 0);
    });
  }

  test('case 5: flag off and no sign_source → the port is never consulted', async () => {
    let consulted = 0;
    const m = manifest('external', { isolation: false });
    const nip98 = buildPodNip98(m, {
      signRequest: async () => { consulted += 1; return { code: 0, out: '{}' }; },
      loadSovereignSigner: () => { throw new Error('no identity in this sandbox'); },
      onError: () => {},
    });
    assert.equal(await nip98('GET', `${POD}/x`), null);
    assert.equal(consulted, 0);
  });

  test('sign_source = "identity-port" selects the port without the flag', async () => {
    let seen = null;
    const m = manifest('external', { isolation: false });
    m.integrations.solid_pod_rs.sign_source = 'identity-port';
    const nip98 = buildPodNip98(m, {
      signRequest: async (op, params) => { seen = { op, params }; return { code: 1, out: '{"refused":{"op":"nip98","reason":"x"}}' }; },
      loadSovereignSigner: () => { throw new Error('must not be called'); },
    });
    await assert.rejects(() => nip98('POST', `${POD}/x`, { a: 1 }), /identity port refused: x/);
    assert.equal(seen.op, 'nip98');
    assert.equal(seen.params.payload_sha256,
      crypto.createHash('sha256').update(JSON.stringify({ a: 1 })).digest('hex'));
  });
});
