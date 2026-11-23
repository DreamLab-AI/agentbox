'use strict';

/**
 * AB-11 — lib/mandate-signer: the one authority that changes a pod's mandates.
 * Real crypto (nostr-tools BIP-340, the production NIP-98 verifier). Run under
 * node:test: nostr-tools is ESM-only and jest cannot load it.
 *
 *   node --test tests/sovereign/mandate-signer.node-test.js
 *
 * The final group drives the REAL identity port (`nostr-pod-bridge
 * serve-identity`) over its unix socket, which settles the "the port signs nip98
 * only for base_url, but the local adapter calls 127.0.0.1:8484" question by
 * observation. It skips cleanly when no built binary is found
 * (AGENTBOX_POD_BRIDGE_BIN, or a cargo target dir named by AB11_PORT_TARGET).
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const nostr = require('../../management-api/node_modules/nostr-tools');
const { NostrBridge } = require('../../mcp/servers/nostr-bridge');
const {
  resolveMandateSigner, assertOwnerSigner, podEndpoints, headerPubkey, SignerUnavailable,
} = require('../../management-api/lib/mandate-signer');
const mandateLib = require('../../management-api/lib/mandate');

const unsignedMandate = (owner, createdAt) => {
  const { record } = mandateLib.createMandate({ issuer: owner, agent: 'b'.repeat(64), container: `/pods/${owner}/proj/x/` });
  return { record, unsigned: mandateLib.buildMandateEvent(record, { status: 'active', createdAt }) };
};

function keypair() {
  const sk = nostr.generateSecretKey();
  return { sk, hex: Buffer.from(sk).toString('hex'), pub: nostr.getPublicKey(sk) };
}

function writeIdentity(root, kp, agentId = 'agentbox-core') {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, `${agentId}.json`), JSON.stringify({ private_key_hex: kp.hex, x_only_pubkey_hex: kp.pub }), { mode: 0o600 });
}

let tmp;
beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mandate-signer-')); });
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const sovereignEnv = (root) => ({ AGENTBOX_IDENTITY_ROOT: root, AGENTBOX_AGENT_ID: 'agentbox-core' });

describe('sovereign source (the default, ADR-2078)', () => {
  test('signs NIP-98 the production verifier accepts, binds the body, and signs the mandate event', async () => {
    const kp = keypair();
    writeIdentity(path.join(tmp, 'id'), kp);
    const s = await resolveMandateSigner({}, { env: sovereignEnv(path.join(tmp, 'id')) });
    assert.equal(s.source, 'sovereign');
    assert.equal(s.pubkey, kp.pub);

    const url = 'https://pods.example/pods/x/proj/demo.acl';
    const header = await s.nip98('PUT', url, 'turtle-body');
    assert.equal(headerPubkey(header), kp.pub);
    const v = NostrBridge.verifyNip98(header, 'PUT', url, 'turtle-body');
    assert.deepEqual({ valid: v.valid, pubkey: v.pubkey }, { valid: true, pubkey: kp.pub });
    assert.equal(NostrBridge.verifyNip98(header, 'PUT', url, 'a different body').valid, false, 'payload tag binds the body');

    const { record, unsigned } = unsignedMandate(kp.pub, 1_800_000_000);
    const ev = await s.signEvent(unsigned);
    assert.equal(nostr.verifyEvent(ev), true);
    assert.equal(ev.pubkey, kp.pub);
    assert.equal(ev.created_at, 1_800_000_000);
    assert.deepEqual(ev.tags.find((t) => t[0] === 'd'), ['d', record.urn]);
  });

  test('works with sign_requests OFF: the flag governs the pods adapter, never a mandate', async () => {
    const kp = keypair();
    writeIdentity(path.join(tmp, 'id'), kp);
    const manifest = { integrations: { solid_pod_rs: { sign_requests: false } } };
    const s = await resolveMandateSigner(manifest, { env: sovereignEnv(path.join(tmp, 'id')) });
    assert.equal(s.pubkey, kp.pub);
  });

  test('no identity file: SignerUnavailable, and the failure is NOT cached (it resolves once the file appears)', async () => {
    const root = path.join(tmp, 'id');
    const env = sovereignEnv(root);
    await assert.rejects(() => resolveMandateSigner({}, { env }), (e) => e instanceof SignerUnavailable && e.code === 'signer_unavailable');
    writeIdentity(root, keypair());
    const s = await resolveMandateSigner({}, { env });
    assert.match(s.pubkey, /^[0-9a-f]{64}$/);
  });

  test('a corrupt identity (secret does not derive the recorded pubkey) is refused, never used', async () => {
    const a = keypair(); const b = keypair();
    fs.mkdirSync(path.join(tmp, 'id'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'id', 'agentbox-core.json'), JSON.stringify({ private_key_hex: a.hex, x_only_pubkey_hex: b.pub }));
    await assert.rejects(() => resolveMandateSigner({}, { env: sovereignEnv(path.join(tmp, 'id')) }), SignerUnavailable);
  });
});

describe('stack source (named explicitly, never ambient)', () => {
  test('uses the named stack key; pubkey is learned from a throwaway signature that is never sent', async () => {
    const kp = keypair();
    let loadedStack = null;
    const signer = { async sign(e) { return nostr.finalizeEvent(e, kp.sk); } };
    const s = await resolveMandateSigner(
      { integrations: { solid_pod_rs: { sign_stack: 'pod-stack' } } },
      { env: {}, loadSigner: (stack) => { loadedStack = stack; return signer; } },
    );
    assert.equal(loadedStack, 'pod-stack');
    assert.equal(s.source, 'stack');
    assert.equal(s.pubkey, kp.pub);
  });

  test('AGENTBOX_PROFILE alone never selects a stack (the sovereign file is still what is read)', async () => {
    const kp = keypair();
    writeIdentity(path.join(tmp, 'id'), kp);
    let stackLoaded = false;
    const s = await resolveMandateSigner({}, {
      env: { ...sovereignEnv(path.join(tmp, 'id')), AGENTBOX_PROFILE: 'ambient' },
      loadSigner: () => { stackLoaded = true; throw new Error('must not be used'); },
    });
    assert.equal(stackLoaded, false);
    assert.equal(s.source, 'sovereign');
  });
});

describe('identity-port source (role isolation, ADR-2122)', () => {
  function fakePort(kp, { refuse } = {}) {
    const seen = [];
    const call = async (op, params) => {
      seen.push({ op, params });
      if (refuse && refuse(op, params)) throw new Error('identity port refused or unavailable');
      if (op === 'pubkey') return { key: params.key, pubkey: kp.pub };
      if (op === 'nip98') {
        const tags = [['u', params.url], ['method', params.method]];
        if (params.payload_sha256) tags.push(['payload', params.payload_sha256]);
        const ev = nostr.finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags, content: '' }, kp.sk);
        return { header: `Nostr ${Buffer.from(JSON.stringify(ev)).toString('base64')}` };
      }
      if (op === 'sign_event') return { event: nostr.finalizeEvent({ kind: params.kind, created_at: params.created_at, tags: params.tags, content: params.content }, kp.sk) };
      throw new Error(`unexpected op ${op}`);
    };
    return { call, seen };
  }
  const roleManifest = { security: { role_isolation: true } };

  test('role isolation selects the port; nip98 and the mandate event go through nip98 / sign_event on key core only', async () => {
    const kp = keypair();
    const port = fakePort(kp);
    const s = await resolveMandateSigner(roleManifest, { env: {}, portRequest: port.call });
    assert.equal(s.source, 'identity-port');
    assert.equal(s.pubkey, kp.pub);

    const header = await s.nip98('PUT', 'https://pods.example/a.acl', 'body');
    assert.equal(NostrBridge.verifyNip98(header, 'PUT', 'https://pods.example/a.acl', 'body').valid, true);
    const { unsigned } = unsignedMandate(kp.pub, 1_800_000_123);
    const ev = await s.signEvent(unsigned);
    assert.equal(ev.created_at, 1_800_000_123, 'created_at survives the port (needed for max(now, grant+1))');

    const ops = port.seen.map((x) => x.op);
    assert.deepEqual(ops, ['pubkey', 'nip98', 'sign_event']);
    assert.ok(port.seen.every((x) => x.params.key === 'core'));
    assert.ok(!ops.includes('forum_event'), 'the junkiejarvis-only forum_event path must not carry a mandate');
    assert.deepEqual(Object.keys(port.seen[2].params).sort(), ['content', 'created_at', 'key', 'kind', 'tags']);
  });

  test('a port that is down or refuses is SignerUnavailable; it never falls back to a key file', async () => {
    const root = path.join(tmp, 'id');
    writeIdentity(root, keypair());                                   // a key file exists, and must be ignored
    await assert.rejects(
      () => resolveMandateSigner(roleManifest, { env: sovereignEnv(root), portRequest: async () => { throw new Error('identity port unavailable'); } }),
      SignerUnavailable,
    );
  });

  test('a port that refuses to sign for the pod URL fails the preflight (fail closed, nothing sent)', async () => {
    const kp = keypair();
    const port = fakePort(kp, { refuse: (op) => op === 'nip98' });
    const s = await resolveMandateSigner(roleManifest, { env: {}, portRequest: port.call });
    await assert.rejects(() => assertOwnerSigner({ signer: s, issuerHex: kp.pub, signedBase: 'http://127.0.0.1:8484' }), SignerUnavailable);
  });
});

describe('assertOwnerSigner', () => {
  const stub = (pubkey, headerPub) => ({
    pubkey,
    nip98: async () => `Nostr ${Buffer.from(JSON.stringify({ pubkey: headerPub })).toString('base64')}`,
  });
  test('accepts only when the signer AND the header it produces are the issuer', async () => {
    const issuer = 'a'.repeat(64);
    await assertOwnerSigner({ signer: stub(issuer, issuer), issuerHex: issuer, signedBase: 'https://p' });
    await assert.rejects(() => assertOwnerSigner({ signer: stub('b'.repeat(64), 'b'.repeat(64)), issuerHex: issuer, signedBase: 'https://p' }), (e) => e.reason === 'signer_mismatch');
    await assert.rejects(() => assertOwnerSigner({ signer: stub(issuer, 'b'.repeat(64)), issuerHex: issuer, signedBase: 'https://p' }), (e) => e.reason === 'signer_mismatch');
    await assert.rejects(() => assertOwnerSigner({ signer: null, issuerHex: issuer, signedBase: 'https://p' }), SignerUnavailable);
    await assert.rejects(() => assertOwnerSigner({ signer: { pubkey: issuer, nip98: async () => null }, issuerHex: issuer, signedBase: 'https://p' }), SignerUnavailable);
  });
});

describe('podEndpoints: where to connect vs which origin the pod matches NIP-98 against', () => {
  test('base_url set → sign the PUBLIC origin, connect to the local listener (0.0.0.0 bind → loopback)', () => {
    const m = { integrations: { solid_pod_rs: { port: 8484, bind: '0.0.0.0', base_url: 'https://pods-native.dreamlab-ai.com/' } } };
    assert.deepEqual(podEndpoints(m, {}), { connectBase: 'http://127.0.0.1:8484', signedBase: 'https://pods-native.dreamlab-ai.com' });
  });
  test('no base_url → both are the local listener', () => {
    assert.deepEqual(podEndpoints({ integrations: { solid_pod_rs: { port: 9000, bind: '127.0.0.1' } } }, {}), { connectBase: 'http://127.0.0.1:9000', signedBase: 'http://127.0.0.1:9000' });
    assert.deepEqual(podEndpoints({}, {}), { connectBase: 'http://127.0.0.1:8484', signedBase: 'http://127.0.0.1:8484' });
  });
  test('AGENTBOX_MANDATE_POD_URL overrides the connect origin only', () => {
    const m = { integrations: { solid_pod_rs: { base_url: 'https://pod.example' } } };
    assert.deepEqual(podEndpoints(m, { AGENTBOX_MANDATE_POD_URL: 'http://pod:8484/' }), { connectBase: 'http://pod:8484', signedBase: 'https://pod.example' });
  });
});

// ── the REAL identity port ────────────────────────────────────────────────────────

function findPortBinary() {
  const home = os.homedir();
  const candidates = [
    process.env.AGENTBOX_POD_BRIDGE_BIN,
    process.env.AB11_PORT_TARGET && path.join(process.env.AB11_PORT_TARGET, 'debug', 'nostr-pod-bridge'),
    path.join(home, 'workspace', '.tmp', 'ab11-target', 'debug', 'nostr-pod-bridge'),
  ].filter(Boolean);
  return candidates.find((c) => { try { fs.accessSync(c, fs.constants.X_OK); return true; } catch { return false; } }) || null;
}

const PORT_REQUIRED = !!(process.env.CI || process.env.AGENTBOX_REQUIRE_POD_INTEGRATION);
if (PORT_REQUIRED && !findPortBinary()) {
  test('nostr-pod-bridge is built (required: CI / AGENTBOX_REQUIRE_POD_INTEGRATION is set)', () => assert.fail('no built nostr-pod-bridge binary; set AGENTBOX_POD_BRIDGE_BIN'));
}

describe('against the real identity port (serve-identity over its unix socket)', { skip: !findPortBinary() && !PORT_REQUIRED && 'no built nostr-pod-bridge binary' }, () => {
  const BIN = findPortBinary();
  let child; let dir; let env; let core;
  const BASE = 'https://pods.example';

  beforeEach(async () => {
    core = keypair();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ab11-port-'));
    fs.mkdirSync(path.join(dir, 'run'), { mode: 0o755 });
    fs.mkdirSync(path.join(dir, 'keys'));
    fs.writeFileSync(path.join(dir, 'keys', 'core.key'), core.hex);
    const uid = process.getuid(); const gid = process.getgid();
    fs.writeFileSync(path.join(dir, 'acl.json'), JSON.stringify({
      version: 1,
      keys: { core: { file: 'core.key', required: true, mirror_root: true, nip98_url_prefixes: ['manifest:integrations.solid_pod_rs.base_url'], relays: ['ws://127.0.0.1:7777'] } },
      callers: { [uid]: { name: 'test', ops: { pubkey: { keys: ['core'] }, nip98: { keys: ['core'] }, sign_event: { keys: ['core'], kinds: [30078] } } } },
    }));
    fs.writeFileSync(path.join(dir, 'agentbox.toml'), `[integrations.solid_pod_rs]\nbase_url = "${BASE}"\n`);
    const sock = path.join(dir, 'run', 'identity.sock');
    env = { PATH: '/usr/bin:/bin', AGENTBOX_POD_BRIDGE_BIN: BIN, AGENTBOX_IDENTITY_SOCK: sock, AGENTBOX_ROLE_ISOLATION: '1' };
    child = spawn(BIN, ['serve-identity'], {
      env: { ...env, RUST_LOG: 'warn', AGENTBOX_IDENTITY_ACL: path.join(dir, 'acl.json'), AGENTBOX_IDENTITY_KEY_DIR: path.join(dir, 'keys'),
        AGENTBOX_IDENTITY_RECEIPT_DIR: path.join(dir, 'receipts'), AGENTBOX_CONFIG: path.join(dir, 'agentbox.toml'), AGENTBOX_IDENTITY_SOCK_GID: String(gid) },
      stdio: 'ignore',
    });
    for (let i = 0; i < 200 && !fs.existsSync(sock); i += 1) await new Promise((r) => setTimeout(r, 25));
    assert.ok(fs.existsSync(sock), 'port socket never appeared');
  });
  afterEach(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } fs.rmSync(dir, { recursive: true, force: true }); });

  const manifest = { security: { role_isolation: true }, integrations: { solid_pod_rs: { base_url: BASE, port: 8484 } } };

  test('resolves the core key, signs NIP-98 for the PUBLIC base_url, and signs a real mandate envelope', async () => {
    const s = await resolveMandateSigner(manifest, { env });
    assert.equal(s.source, 'identity-port');
    assert.equal(s.pubkey, core.pub);
    const { signedBase } = podEndpoints(manifest, {});
    await assertOwnerSigner({ signer: s, issuerHex: core.pub, signedBase });
    const url = `${signedBase}/pods/${core.pub}/proj/x.acl`;
    const header = await s.nip98('PUT', url, 'ttl');
    assert.equal(NostrBridge.verifyNip98(header, 'PUT', url, 'ttl').valid, true);

    const at = Math.floor(Date.now() / 1000);
    const { record, unsigned } = unsignedMandate(core.pub, at);
    const ev = await s.signEvent(unsigned);
    assert.equal(nostr.verifyEvent(ev), true);
    assert.equal(ev.pubkey, core.pub);
    assert.equal(ev.created_at, at);
    assert.equal(ev.tags.find((t) => t[0] === 'd')[1], record.urn);
  });

  test('THE ORIGIN QUESTION: the port refuses to sign for the loopback origin the pod listens on, so the signed URL must be base_url', async () => {
    const s = await resolveMandateSigner(manifest, { env });
    await assert.rejects(() => s.nip98('PUT', 'http://127.0.0.1:8484/pods/x/proj/y.acl', 'ttl'), /refused|unavailable/);
    // ...which is why mandate-signer signs `signedBase` (base_url) and only CONNECTS to the loopback origin.
    const { connectBase, signedBase } = podEndpoints(manifest, {});
    assert.equal(connectBase, 'http://127.0.0.1:8484');
    assert.equal(signedBase, BASE);
  });

  test('the port refuses a 30078 that is not a mandate envelope of core, so a compromised caller cannot sign generic app data', async () => {
    const s = await resolveMandateSigner(manifest, { env });
    for (const tags of [[], [['d', 'app-state'], ['t', 'agent-mandate']], [['d', `urn:agentbox:mandate:${core.pub}:x`]]]) {
      await assert.rejects(() => s.signEvent({ kind: 30078, created_at: 1, tags, content: '{}' }), /refused|unavailable/);
    }
  });

  test('the port refuses a mandate envelope with a far-future created_at, or content that is not this key\'s envelope', async () => {
    const s = await resolveMandateSigner(manifest, { env });
    const { unsigned } = unsignedMandate(core.pub, Math.floor(Date.now() / 1000));
    await assert.rejects(() => s.signEvent({ ...unsigned, created_at: 4_102_444_800 }), /refused|unavailable/);
    await assert.rejects(() => s.signEvent({ ...unsigned, content: JSON.stringify({ ...JSON.parse(unsigned.content), issuer: `did:nostr:${'e'.repeat(64)}` }) }), /refused|unavailable/);
    await assert.rejects(() => s.signEvent({ ...unsigned, content: 'not json' }), /refused|unavailable/);
  });

  test('with no base_url in the manifest the port has no allowlist: preflight fails closed rather than guessing an origin', async () => {
    const noBase = { security: { role_isolation: true }, integrations: { solid_pod_rs: { port: 8484 } } };
    fs.writeFileSync(path.join(dir, 'agentbox.toml'), '[integrations.solid_pod_rs]\n');
    // The running port already resolved its manifest at start; this models the unset case via its URL check.
    const s = await resolveMandateSigner(noBase, { env });
    const { signedBase } = podEndpoints(noBase, {});
    assert.equal(signedBase, 'http://127.0.0.1:8484');
    await assert.rejects(() => assertOwnerSigner({ signer: s, issuerHex: core.pub, signedBase }), SignerUnavailable);
  });
});
