'use strict';

/**
 * ADR-2078 acceptance: the pods adapter signs as the container's sovereign
 * identity, the one `nostr-pod-bridge bootstrap` mints at boot phase 3
 * (`<AGENTBOX_IDENTITY_ROOT>/<AGENTBOX_AGENT_ID>.json`, default
 * `/var/lib/agentbox/identities/agentbox-core.json`). That keypair is the one
 * the bootstrap writes into the pod's ACL and DID documents, so it is the only
 * identity a default-deny pod accepts.
 *
 * Cases (numbering follows the ADR's Acceptance test):
 *   1. fresh identity, no stack key, sign_requests = true → exactly one request
 *      per operation, each carrying a NIP-98 header that the production
 *      verifier (`NostrBridge.verifyNip98`) accepts as the identity's pubkey,
 *      body bound through the payload tag; zero unsigned requests.
 *   2. identity file absent → `SigningUnavailable` before any byte is sent,
 *      with no fallback to the stack path or to unsigned.
 *   3. sign_requests = false → byte-identical to the unsigned baseline.
 *   4. `./agentbox.sh health` and `/ready` in the rebuilt image — a runtime
 *      check recorded in the ADR, not reproducible here.
 *
 * Runs under node:test rather than jest: nostr-tools pulls ESM-only @noble
 * packages that jest's module system cannot require on Node 22 (the same
 * reason tests/sovereign/chain-info.node-test.js exists). Real crypto
 * throughout — keys from nostr-tools, BIP-340 signatures from finalizeEvent,
 * verification by the production verifier. Only `fetch` is stubbed.
 *
 * The bridge resolves nostr-tools relative to mcp/servers; where mcp/ has no
 * install (CI), run with NODE_PATH pointing at management-api/node_modules.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { generateSecretKey, getPublicKey } =
  require('../../management-api/node_modules/nostr-tools');
const { NostrBridge } = require('../../mcp/servers/nostr-bridge');
const { resolveAdapters } = require('../../management-api/adapters');
const { ExternalPodsAdapter } = require('../../management-api/adapters/pods/external');
const { SigningUnavailable } = require('../../management-api/adapters/errors');
const { buildPodNip98 } = require('../../management-api/lib/pod-signer');
const { sovereignIdentityPath, loadSovereignSigner } =
  require('../../management-api/lib/agent-identity');

const ENV_KEYS = [
  'AGENTBOX_IDENTITY_ROOT', 'AGENTBOX_AGENT_ID', 'AGENTBOX_STACK', 'AGENTBOX_PROFILE', 'OPF_MODE',
];

/** Write an identity file in the exact layout the bootstrap produces. */
function mintBootstrapIdentity(root, agentId = 'agentbox-core') {
  const sk = generateSecretKey();
  const xOnly = getPublicKey(sk);
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, `${agentId}.json`);
  fs.writeFileSync(
    file,
    `${JSON.stringify({
      agent_id: agentId,
      created_at: 1759400000,
      private_key_hex: Buffer.from(sk).toString('hex'),
      public_key_hex: `02${xOnly}`,
      x_only_pubkey_hex: xOnly,
      nsec: 'nsec1-unused-by-the-signer',
      npub: 'npub1-unused-by-the-signer',
    }, null, 2)}\n`,
    { mode: 0o600 }
  );
  return { file, xOnly };
}

function manifest(impl, signRequests) {
  const solid = { base_url: 'http://pod.test' };
  if (signRequests !== undefined) solid.sign_requests = signRequests;
  return {
    adapters: { pods: impl },
    federation: { external_url: 'http://pod.test' },
    integrations: { solid_pod_rs: solid },
  };
}

/**
 * The pods slot as the server builds it. `local-solid-rs` (the manifest
 * default) goes through `resolveAdapters`, the full production wiring.
 * `external` is constructed from the same signer config the resolver derives,
 * because the resolver hands that impl `externalUrl` while the class reads
 * `baseUrl` — a pre-existing key mismatch across every `external` slot,
 * recorded in tests/integration/resolver-degraded.test.js and out of scope here.
 */
function makePods(impl, signRequests) {
  const m = manifest(impl, signRequests);
  if (impl !== 'external') return resolveAdapters(m).pods;
  const requireSigned = signRequests === true;
  const nip98 = buildPodNip98(m, {
    onError: (err) => console.warn(
      `[adapters] pods NIP-98 signing unavailable: ${err.message}` +
        (requireSigned ? ' — sign_requests is on, so the pods slot fails closed (ADR-2064)' : '')
    ),
  });
  const cfg = { baseUrl: 'http://pod.test' };
  if (nip98) Object.assign(cfg, { nip98, requireSigned });
  else if (requireSigned) cfg.requireSigned = true;
  return new ExternalPodsAdapter(cfg);
}

function okResponse(url) {
  return {
    ok: true,
    status: 200,
    url,
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

function withSandbox() {
  const ctx = {};
  beforeEach(() => {
    ctx.tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adr2078-'));
    ctx.savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.AGENTBOX_IDENTITY_ROOT = ctx.tmp;
    process.env.AGENTBOX_AGENT_ID = 'agentbox-core';
    // The privacy filter is orthogonal and makes its own fetch when enabled.
    process.env.OPF_MODE = 'off';
    ctx.savedFetch = global.fetch;
    ctx.savedWarn = console.warn;
    ctx.warnings = [];
    console.warn = (...a) => ctx.warnings.push(a.join(' '));
    ctx.calls = [];
    global.fetch = async (url, init = {}) => {
      ctx.calls.push({ url, init });
      return okResponse(url);
    };
  });
  afterEach(() => {
    global.fetch = ctx.savedFetch;
    console.warn = ctx.savedWarn;
    for (const k of ENV_KEYS) {
      if (ctx.savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = ctx.savedEnv[k];
    }
    fs.rmSync(ctx.tmp, { recursive: true, force: true });
  });
  return ctx;
}

test('the production verifier can run Schnorr here (guards against a vacuous pass)', () => {
  const sk = generateSecretKey();
  const { finalizeEvent } = require('../../management-api/node_modules/nostr-tools');
  const ev = finalizeEvent({
    kind: 27235, created_at: Math.floor(Date.now() / 1000),
    tags: [['u', 'http://x/'], ['method', 'GET']], content: '',
  }, sk);
  const header = `Nostr ${Buffer.from(JSON.stringify(ev)).toString('base64')}`;
  const r = NostrBridge.verifyNip98(header, 'GET', 'http://x/');
  assert.equal(r.valid, true, `verifier unavailable: ${r.error} (set NODE_PATH, see header)`);
});

for (const impl of ['local-solid-rs', 'external']) {
  describe(`ADR-2078 acceptance — pods impl ${impl}`, () => {
    const ctx = withSandbox();

    test('case 1: each operation sends one request, signed as the identity in agentbox-core.json', async () => {
      const { xOnly } = mintBootstrapIdentity(ctx.tmp);
      const pods = makePods(impl, true);
      const verified = new Set();

      for (const [op, args, method] of OPS) {
        const before = ctx.calls.length;
        await pods[op](...args);
        // local-solid-rs probes pod capabilities once (OPTIONS on the root)
        // before its first PATCH. The probe is not the operation's request, so
        // it is excluded from the count, but it is still verified below.
        const issued = ctx.calls.slice(before)
          .filter((c) => (c.init.method || 'GET').toUpperCase() !== 'OPTIONS');
        assert.equal(issued.length, 1, `${op} issued ${issued.length} requests`);

        const { url, init } = issued[0];
        verified.add(issued[0]);
        assert.equal((init.method || 'GET').toUpperCase(), method);
        const auth = init.headers && init.headers.Authorization;
        assert.equal(typeof auth, 'string', `${op} went out unsigned`);
        assert.deepEqual(
          NostrBridge.verifyNip98(auth, method, url, init.body),
          { valid: true, pubkey: xOnly, error: null },
          `${op} header does not verify as the sovereign identity`
        );
      }
      // Zero unsigned requests, the probe included. Each header is verified
      // exactly once: the verifier's replay cache rightly rejects a second look.
      for (const { url, init } of ctx.calls.filter((c) => !verified.has(c))) {
        const method = (init.method || 'GET').toUpperCase();
        assert.equal(
          NostrBridge.verifyNip98(init.headers && init.headers.Authorization, method, url, init.body).pubkey,
          xOnly,
          `${method} ${url} is not signed as the sovereign identity`
        );
      }
    });

    test('case 2: identity file absent → SigningUnavailable before any byte, no stack fallback', async () => {
      // Ambient stack hints and on-disk stack material exist; neither may be used.
      const profiles = path.join(ctx.tmp, 'profiles', 'main');
      fs.mkdirSync(profiles, { recursive: true });
      fs.writeFileSync(path.join(profiles, 'nostr.key.enc'), Buffer.alloc(60));
      fs.writeFileSync(path.join(profiles, 'nostr.salt'), '00'.repeat(16));
      process.env.AGENTBOX_PROFILE = 'main';

      const pods = makePods(impl, true);
      for (const [op, args] of OPS) {
        await assert.rejects(pods[op](...args), (err) => {
          assert.ok(err instanceof SigningUnavailable, `${op}: ${err && err.message}`);
          assert.equal(err.code, 'SIGNING_UNAVAILABLE');
          assert.equal(err.slot, 'pods');
          return true;
        });
      }
      assert.equal(ctx.calls.length, 0, 'a request left the process unsigned');
      const expected = path.join(ctx.tmp, 'agentbox-core.json');
      assert.ok(
        ctx.warnings.some((w) => w.includes(expected) && w.includes('ADR-2064')),
        `no operator warning naming ${expected}: ${JSON.stringify(ctx.warnings)}`
      );
    });

    test('case 3: sign_requests = false is byte-identical to the unsigned baseline', async () => {
      mintBootstrapIdentity(ctx.tmp);
      const off = makePods(impl, false);
      for (const [op, args] of OPS) await off[op](...args);
      const offCalls = ctx.calls.splice(0);

      const base = makePods(impl, undefined);
      for (const [op, args] of OPS) await base[op](...args);

      assert.deepEqual(offCalls, ctx.calls);
      assert.ok(offCalls.every((c) => !(c.init.headers && c.init.headers.Authorization)));
    });
  });
}

describe('ADR-2078 — signer source selection', () => {
  const ctx = withSandbox();
  const on = (extra = {}) => ({ integrations: { solid_pod_rs: { sign_requests: true, ...extra } } });

  test('defaults to the sovereign identity; an ambient AGENTBOX_PROFILE does not divert it', async () => {
    const { xOnly } = mintBootstrapIdentity(ctx.tmp);
    const stackLoads = [];
    const fn = buildPodNip98(on(), {
      env: { AGENTBOX_IDENTITY_ROOT: ctx.tmp, AGENTBOX_PROFILE: 'ambient-harness-slug' },
      loadSigner: (s) => { stackLoads.push(s); throw new Error('stack path must not be used'); },
    });
    const header = await fn('GET', 'http://pod.test/kg/x');
    assert.equal(NostrBridge.verifyNip98(header, 'GET', 'http://pod.test/kg/x').pubkey, xOnly);
    assert.deepEqual(stackLoads, []);
  });

  test('a tampered identity (secret does not derive its recorded pubkey) is refused without echoing the key', async () => {
    const { file } = mintBootstrapIdentity(ctx.tmp);
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    doc.x_only_pubkey_hex = getPublicKey(generateSecretKey());
    fs.writeFileSync(file, JSON.stringify(doc));
    const errors = [];
    const fn = buildPodNip98(on(), {
      env: { AGENTBOX_IDENTITY_ROOT: ctx.tmp }, onError: (e) => errors.push(e),
    });
    assert.equal(await fn('GET', 'http://h/x'), null);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /does not derive/);
    assert.ok(!errors[0].message.includes(doc.private_key_hex));
  });
});

describe('agent-identity — sovereign identity reader', () => {
  const ctx = withSandbox();

  test('resolves the path the bootstrap writes: <root>/<agent_id>.json', () => {
    assert.equal(sovereignIdentityPath({ env: {} }), '/var/lib/agentbox/identities/agentbox-core.json');
    assert.equal(
      sovereignIdentityPath({ env: { AGENTBOX_IDENTITY_ROOT: '/r', AGENTBOX_AGENT_ID: 'x' } }),
      '/r/x.json'
    );
  });

  test('never mints: an absent file throws ENOENT and creates nothing', () => {
    assert.throws(() => loadSovereignSigner({ env: { AGENTBOX_IDENTITY_ROOT: ctx.tmp } }), { code: 'ENOENT' });
    assert.deepEqual(fs.readdirSync(ctx.tmp), []);
  });

  test('a corrupt identity file is refused without quoting its contents', () => {
    // V8's JSON.parse errors quote a slice of the input; for this file that
    // slice would be key material, and the message reaches the operator log.
    const secretish = 'deadbeefcafef00d'.repeat(4);
    const file = path.join(ctx.tmp, 'agentbox-core.json');
    fs.writeFileSync(file, `{"private_key_hex":${secretish}}`);
    assert.throws(() => loadSovereignSigner({ env: { AGENTBOX_IDENTITY_ROOT: ctx.tmp } }), (err) => {
      assert.match(err.message, /is not valid JSON/);
      assert.ok(err.message.includes(file));
      for (let i = 0; i + 8 <= secretish.length; i += 4) {
        assert.ok(!err.message.includes(secretish.slice(i, i + 8)), `message leaks key bytes: ${err.message}`);
      }
      assert.equal(err.cause, undefined);
      return true;
    });
  });

  test('exposes the public identity and a BIP-340 signer, never the secret', async () => {
    const { xOnly } = mintBootstrapIdentity(ctx.tmp);
    const s = loadSovereignSigner({ env: { AGENTBOX_IDENTITY_ROOT: ctx.tmp } });
    assert.equal(s.pubkey, xOnly);
    assert.equal(s.did, `did:nostr:${xOnly}`);
    assert.deepEqual(Object.keys(s).sort(), ['did', 'path', 'pubkey', 'sign']);
    const ev = await s.sign({ kind: 27235, created_at: 1, tags: [], content: '' });
    assert.equal(ev.pubkey, xOnly);
    assert.match(ev.sig, /^[0-9a-f]{128}$/);
  });
});
