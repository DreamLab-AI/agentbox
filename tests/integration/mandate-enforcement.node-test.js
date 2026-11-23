'use strict';

/**
 * AB-11 integration — a mandate is ENFORCED at a real solid-pod-rs, then revoked.
 *
 * Real pieces: the solid-pod-rs-server binary (WAC, NIP-98 verification, Sidecar
 * ACL layout), real BIP-340 signatures, the real mandate modules (grant, revoke,
 * reconcile, registry, signer, publisher over NostrBridge) and a real WebSocket
 * relay speaking enough NIP-01 to answer OK. Faked: nothing in the path under test.
 *
 * What it proves, end to end:
 *   - before a grant the agent's session key cannot write the container (403);
 *   - after grant the SAME key can (201) inside the container and nowhere else,
 *     and still cannot touch the .acl (Control is never delegated);
 *   - the owner keeps access throughout;
 *   - after revoke the agent is 403 again while the owner still gets 200;
 *   - the pod matches NIP-98 against its PUBLIC origin while we connect to the
 *     loopback listener (the "signed vs connect origin" question);
 *   - relay down at revoke → effective at the pod, `revoked_unpublished`, and
 *     the reconciler publishes once the relay returns;
 *   - the events relayed are the signed kind-30078 grant and revoke, the revoke
 *     strictly later than the grant.
 *
 * Skips cleanly when no solid-pod-rs-server binary is available
 * (SOLID_POD_RS_SERVER_BIN, a cargo target dir, or PATH).
 *
 *   node --test tests/integration/mandate-enforcement.node-test.js
 */

const { describe, test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { createRequire } = require('module');

const REPO = path.resolve(__dirname, '../..');
const nostr = require('../../management-api/node_modules/nostr-tools');
const { WebSocketServer } = createRequire(path.join(REPO, 'mcp/servers/package.json'))('ws');

const registry = require('../../management-api/lib/mandate-registry');
const { grantMandate } = require('../../management-api/lib/mandate-grant');
const { revokeMandate, reconcileMandates } = require('../../management-api/lib/mandate-revocation');
const { resolveMandateSigner, SignerUnavailable } = require('../../management-api/lib/mandate-signer');
const { createPublisher } = require('../../management-api/lib/mandate-publish');
const { sidecarPath } = require('../../management-api/lib/mandate-acl');

function findServerBinary() {
  const home = os.homedir();
  const candidates = [
    process.env.SOLID_POD_RS_SERVER_BIN,
    path.join(home, 'workspace/solid-pod-rs/target/debug/solid-pod-rs-server'),
    path.join(home, 'workspace/solid-pod-rs/target/release/solid-pod-rs-server'),
  ].filter(Boolean);
  for (const c of candidates) { try { fs.accessSync(c, fs.constants.X_OK); return c; } catch { /* next */ } }
  const which = spawnSync('which', ['solid-pod-rs-server'], { encoding: 'utf8' });
  return which.status === 0 ? which.stdout.trim() : null;
}

const BIN = findServerBinary();
const PUBLIC_ORIGIN = 'https://pods.mandate-test.example';   // what the pod matches NIP-98 against

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}

async function waitFor(fn, ms = 12000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await fn()) return true; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

function nip98(sk, method, url, body) {
  const tags = [['u', url], ['method', method.toUpperCase()], ['nonce', crypto.randomBytes(8).toString('hex')]];
  if (body) tags.push(['payload', crypto.createHash('sha256').update(body).digest('hex')]);
  const ev = nostr.finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags, content: '' }, sk);
  return `Nostr ${Buffer.from(JSON.stringify(ev)).toString('base64')}`;
}

/** Fake NIP-01 relay on a fixed port that answers OK and records events. */
function startRelay(port) {
  return new Promise((resolve) => {
    const events = [];
    const wss = new WebSocketServer({ port, host: '127.0.0.1' }, () => resolve({
      events,
      close: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); wss.close(() => r()); }),
    }));
    wss.on('connection', (ws) => ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m[0] === 'EVENT') {
        if (!nostr.verifyEvent(m[1])) { ws.send(JSON.stringify(['OK', m[1].id, false, 'invalid: bad signature'])); return; }
        events.push(m[1]);
        ws.send(JSON.stringify(['OK', m[1].id, true, '']));
      }
    }));
  });
}

describe('mandate enforcement against a real solid-pod-rs', { skip: !BIN && 'no solid-pod-rs-server binary found' }, () => {
  let root; let podPort; let proc; let log = '';
  let state; let relayPort; let relay;
  let owner; let ownerPub; let agentA; let agentB;
  const origEnv = {};
  const podLocal = () => `http://127.0.0.1:${podPort}`;
  const C = () => `/pods/${ownerPub}/proj/demo/`;

  /** An authenticated request AS a key, signing the pod's PUBLIC origin (that is what it matches). */
  async function as(sk, method, p, body) {
    const headers = { Authorization: nip98(sk, method, `${PUBLIC_ORIGIN}${p}`, body) };
    if (body !== undefined) headers['Content-Type'] = 'text/plain';
    return fetch(`${podLocal()}${p}`, { method, headers, body });
  }

  const publishers = [];
  const deps = () => {
    const publisher = createPublisher({ relays: [`ws://127.0.0.1:${relayPort}`], requiredRelay: `ws://127.0.0.1:${relayPort}`, timeoutMs: 1500 });
    publishers.push(publisher);
    return depsWith(publisher);
  };
  const depsWith = (publisher) => ({
    resolveSigner: () => resolveMandateSigner({}, { env: { AGENTBOX_IDENTITY_ROOT: path.join(state, 'identities'), AGENTBOX_AGENT_ID: 'agentbox-core' } }),
    podEndpoints: () => ({ connectBase: podLocal(), signedBase: PUBLIC_ORIGIN }),
    spaceReplays: true,
    publisher,
  });
  const logger = { debug() {}, info() {}, warn() {}, error() {} };

  before(async () => {
    for (const k of ['AGENTBOX_STATE_DIR']) origEnv[k] = process.env[k];
    owner = nostr.generateSecretKey(); ownerPub = nostr.getPublicKey(owner);
    agentA = nostr.generateSecretKey(); agentB = nostr.generateSecretKey();
    state = fs.mkdtempSync(path.join(os.tmpdir(), 'ab11-state-'));
    process.env.AGENTBOX_STATE_DIR = state;
    fs.mkdirSync(path.join(state, 'identities'), { recursive: true });
    fs.writeFileSync(path.join(state, 'identities', 'agentbox-core.json'),
      JSON.stringify({ private_key_hex: Buffer.from(owner).toString('hex'), x_only_pubkey_hex: ownerPub }), { mode: 0o600 });

    // The pod: what `nostr-pod-bridge bootstrap` lays down for the owner (pods/<hex>.acl sidecar), full-path IRIs.
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ab11-pod-'));
    fs.mkdirSync(path.join(root, 'pods', ownerPub, 'proj', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(root, 'pods', `${ownerPub}.acl`),
      `@prefix acl: <http://www.w3.org/ns/auth/acl#> .\n<#owner> a acl:Authorization ;\n  acl:agent <did:nostr:${ownerPub}> ;\n` +
      `  acl:accessTo </pods/${ownerPub}/> ; acl:default </pods/${ownerPub}/> ;\n  acl:mode acl:Read, acl:Write, acl:Append, acl:Control .\n`);
    fs.writeFileSync(path.join(root, 'pods', `${ownerPub}.acl.meta.json`), JSON.stringify({ content_type: 'text/turtle', links: [] }));
    podPort = await freePort();
    fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ server: { host: '127.0.0.1', port: podPort }, storage: { type: 'fs', root } }));
    proc = spawn(BIN, ['-c', path.join(root, 'config.json'), '--host', '127.0.0.1', '-p', String(podPort), '--public-base-url', PUBLIC_ORIGIN],
      { env: { ...process.env, RUST_LOG: 'warn' }, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', (d) => { log += d; }); proc.stderr.on('data', (d) => { log += d; });
    assert.ok(await waitFor(async () => (await fetch(`${podLocal()}/.well-known/solid`)).status > 0), `pod did not start: ${log.slice(0, 400)}`);

    relayPort = await freePort();
    relay = await startRelay(relayPort);
  });

  after(async () => {
    for (const p of publishers) await p.close();
    try { proc.kill('SIGTERM'); } catch { /* gone */ }
    if (relay) await relay.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(state, { recursive: true, force: true });
    for (const [k, v] of Object.entries(origEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  test('sanity: the owner can write the container before any mandate; the agent cannot', async () => {
    assert.equal((await as(owner, 'PUT', `${C()}seed.txt`, 'owner data')).status, 201);
    assert.equal((await as(agentA, 'PUT', `${C()}a.txt`, 'nope')).status, 403);
    assert.equal((await as(agentA, 'GET', `${C()}seed.txt`)).status, 403);
  });

  test('grant → the session key can write inside the container (201), nowhere else, and never the ACL; the owner keeps access', async () => {
    const g = await grantMandate({ issuer: ownerPub, agent: nostr.getPublicKey(agentA), container: C(), manifest: {}, logger, deps: deps() });
    assert.equal(g.reused, false);
    assert.equal(g.signed, true);

    assert.equal((await as(agentA, 'PUT', `${C()}a.txt`, 'agent data')).status, 201, 'the mandate must be enforced at the pod');
    assert.equal((await as(agentA, 'GET', `${C()}a.txt`)).status, 200);
    // Not beyond the container...
    assert.equal((await as(agentA, 'PUT', `/pods/${ownerPub}/proj/other/x.txt`, 'x')).status, 403);
    assert.equal((await as(agentA, 'PUT', `/pods/${ownerPub}/elsewhere.txt`, 'x')).status, 403);
    // ...and never Control: it may not read or rewrite the sidecar that grants it.
    assert.equal((await as(agentA, 'GET', sidecarPath(C()))).status, 403);
    assert.equal((await as(agentA, 'PUT', sidecarPath(C()), '@prefix acl: <http://www.w3.org/ns/auth/acl#> .')).status, 403);
    // Someone else's key gets nothing.
    assert.equal((await as(agentB, 'PUT', `${C()}b.txt`, 'x')).status, 403);
    // The owner is unaffected.
    assert.equal((await as(owner, 'GET', `${C()}a.txt`)).status, 200);
    assert.equal((await as(owner, 'PUT', `${C()}owner2.txt`, 'still mine')).status, 201);

    const granted = relay.events.filter((e) => e.kind === 30078);
    assert.equal(granted.length, 1);
    assert.equal(granted[0].pubkey, ownerPub);
    assert.deepEqual(granted[0].tags.find((t) => t[0] === 'status'), ['status', 'active']);
  });

  test('a second agent on the same container is added without losing the first (whole sidecar from the registry)', async () => {
    await grantMandate({ issuer: ownerPub, agent: nostr.getPublicKey(agentB), container: C(), manifest: {}, logger, deps: deps() });
    assert.equal((await as(agentB, 'PUT', `${C()}b.txt`, 'b data')).status, 201);
    assert.equal((await as(agentA, 'PUT', `${C()}a2.txt`, 'a data')).status, 201);
  });

  test('revoke A → the same PUT is 403, the owner still 200, B unaffected; the revoke event supersedes the grant', async () => {
    const res = await revokeMandate({ agent: nostr.getPublicKey(agentA), container: C(), manifest: {}, logger, deps: deps() });
    assert.deepEqual({ s: res.state, pod: res.effective_at_pod, pub: res.published }, { s: 'revoked', pod: true, pub: true });

    assert.equal((await as(agentA, 'PUT', `${C()}a3.txt`, 'after revoke')).status, 403);
    assert.equal((await as(agentA, 'GET', `${C()}a.txt`)).status, 403);
    assert.equal((await as(owner, 'GET', `${C()}a.txt`)).status, 200);
    assert.equal((await as(agentB, 'PUT', `${C()}b2.txt`, 'b still ok')).status, 201);

    const forA = relay.events.filter((e) => e.tags.some((t) => t[0] === 'p' && t[1] === nostr.getPublicKey(agentA)));
    assert.equal(forA.length, 2);
    const [grant, revoke] = forA;
    assert.deepEqual(revoke.tags.find((t) => t[0] === 'status'), ['status', 'revoked']);
    assert.ok(revoke.created_at > grant.created_at, 'revoke created_at must be strictly after the grant');
    assert.equal(revoke.tags.find((t) => t[0] === 'd')[1], grant.tags.find((t) => t[0] === 'd')[1], 'same addressable slot');
  });

  test('revoking the last agent DELETEs the sidecar; the owner is unaffected; a revoked mandate is a tombstone', async () => {
    await revokeMandate({ agent: nostr.getPublicKey(agentB), container: C(), manifest: {}, logger, deps: deps() });
    assert.equal((await as(agentB, 'PUT', `${C()}b3.txt`, 'x')).status, 403);
    assert.equal((await as(owner, 'GET', sidecarPath(C()))).status, 404, 'no mandates left: the sidecar is gone');
    assert.equal((await as(owner, 'GET', `${C()}b.txt`)).status, 200);
    const { ensureMandate } = require('../../management-api/routes/mandate');
    await assert.rejects(
      () => ensureMandate({ issuer: ownerPub, agent: nostr.getPublicKey(agentA), container: C(), manifest: {}, logger, deps: deps() }),
      { name: 'MandateRevokedError' },
    );
  });

  test('relay DOWN at revoke → effective at the pod at once, revoked_unpublished; the reconciler publishes when it returns', async () => {
    // fresh agent so earlier events do not interfere
    const agentC = nostr.generateSecretKey(); const pubC = nostr.getPublicKey(agentC);
    const CC = `/pods/${ownerPub}/proj/relay/`;
    await grantMandate({ issuer: ownerPub, agent: pubC, container: CC, manifest: {}, logger, deps: deps() });
    assert.equal((await as(agentC, 'PUT', `${CC}c.txt`, 'c')).status, 201);

    await relay.close();                                                   // relay goes away
    const res = await revokeMandate({ agent: pubC, container: CC, manifest: {}, logger, deps: deps() });
    assert.deepEqual({ s: res.state, pod: res.effective_at_pod, pub: res.published }, { s: 'revoked_unpublished', pod: true, pub: false });
    assert.equal((await as(agentC, 'PUT', `${CC}c2.txt`, 'x')).status, 403, 'enforced at the pod despite the relay outage');
    assert.equal((await as(owner, 'GET', `${CC}c.txt`)).status, 200);

    relay = await startRelay(relayPort);                                   // relay returns
    const d = deps();
    let out;
    assert.ok(await waitFor(async () => { out = await reconcileMandates({ manifest: {}, logger, deps: d }); return out.revoked === 1; }, 15000), JSON.stringify(out));
    const entry = registry.load()[registry.keyFor(pubC, CC)];
    assert.equal(entry.state, 'revoked');
    assert.ok(relay.events.some((e) => e.tags.some((t) => t[0] === 'status' && t[1] === 'revoked') && e.tags.some((t) => t[0] === 'p' && t[1] === pubC)));
    assert.equal((await as(agentC, 'PUT', `${CC}c3.txt`, 'x')).status, 403);
  });

  test('POD DOWN at revoke → 502-class failure, state "revoking" (not revoked); the reconciler finishes it when the pod returns', async () => {
    const agentD = nostr.generateSecretKey(); const pubD = nostr.getPublicKey(agentD);
    const CD = `/pods/${ownerPub}/proj/podoutage/`;
    await grantMandate({ issuer: ownerPub, agent: pubD, container: CD, manifest: {}, logger, deps: deps() });
    assert.equal((await as(agentD, 'PUT', `${CD}d.txt`, 'd')).status, 201);

    proc.kill('SIGTERM');
    await new Promise((r) => proc.once('exit', r));
    await assert.rejects(
      () => revokeMandate({ agent: pubD, container: CD, manifest: {}, logger, deps: deps() }),
      { name: 'RevokeError', effective_at_pod: false, status: 502 },
    );
    assert.equal(registry.load()[registry.keyFor(pubD, CD)].state, 'revoking');

    proc = spawn(BIN, ['-c', path.join(root, 'config.json'), '--host', '127.0.0.1', '-p', String(podPort), '--public-base-url', PUBLIC_ORIGIN],
      { env: { ...process.env, RUST_LOG: 'warn' }, stdio: ['ignore', 'pipe', 'pipe'] });
    assert.ok(await waitFor(async () => (await fetch(`${podLocal()}/.well-known/solid`)).status > 0), 'pod did not restart');
    const out = await reconcileMandates({ manifest: {}, logger, deps: deps() });
    assert.equal(out.revoked, 1);
    assert.equal(registry.load()[registry.keyFor(pubD, CD)].state, 'revoked');
    assert.equal((await as(agentD, 'PUT', `${CD}d2.txt`, 'x')).status, 403);
  });

  test('no pod-owner signer → 503-class, and the agent gains nothing', async () => {
    const agentE = nostr.generateSecretKey(); const pubE = nostr.getPublicKey(agentE);
    const CE = `/pods/${ownerPub}/proj/nosigner/`;
    const noSigner = { ...deps(), resolveSigner: async () => { throw new SignerUnavailable('no signer'); } };
    await assert.rejects(() => grantMandate({ issuer: ownerPub, agent: pubE, container: CE, manifest: {}, logger, deps: noSigner }), SignerUnavailable);
    assert.equal((await as(agentE, 'PUT', `${CE}e.txt`, 'x')).status, 403);
  });
});
