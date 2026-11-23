'use strict';

/**
 * Finding 3 (High) — /v1/mandate create/revoke/list are operator-only, and the
 * create route refuses a caller-supplied issuer that disagrees with the
 * authenticated operator (never sign an operator-key mandate for an arbitrary
 * issuer). A non-operator gets 403; a forged issuer gets 400; the operator with
 * a matching (or absent) issuer mints as normal.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

const Fastify = require('../../management-api/node_modules/fastify');
const mandateRoutes = require('../../management-api/routes/mandate');
const { makeDeps } = require('./helpers/mandate-fakes');

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const OPERATOR = 'a'.repeat(64);  // the pod owner: pods live at /pods/<operator>/…
const AGENT = 'b'.repeat(64);
const STRANGER = 'd'.repeat(64);

let deps;
function buildApp() {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    const raw = request.headers['x-test-auth'];
    if (raw) { try { request.auth = JSON.parse(raw); } catch (_) { /* leave unset */ } }
  });
  app.register(mandateRoutes, { logger, manifest: {}, deps });
  return app;
}

function auth(mode, pubkey) {
  return { 'x-test-auth': JSON.stringify(pubkey ? { mode, pubkey } : { mode }) };
}

describe('/v1/mandate — operator-only + issuer binding', () => {
  let app; let tmp;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mandate-authz-'));
    process.env.AGENTBOX_STATE_DIR = tmp;
    process.env.AGENTBOX_X_ONLY_PUBKEY_HEX = OPERATOR;
  });
  afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} });
  beforeEach(() => { fs.rmSync(path.join(tmp, 'mandates'), { recursive: true, force: true }); deps = makeDeps(); app = buildApp(); });
  afterEach(async () => { await app.close(); });

  it('403 — a non-operator NIP-98 key cannot create a mandate', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/mandate', headers: auth('nip98', STRANGER),
      payload: { agent: AGENT, container: `/pods/${OPERATOR}/proj/x/` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('forbidden_not_operator');
  });

  it('403 — a non-operator cannot list mandates', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/mandate', headers: auth('nip98', STRANGER) });
    expect(res.statusCode).toBe(403);
  });

  it('403 — a non-operator cannot revoke', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/mandate/revoke', headers: auth('nip98', STRANGER),
      payload: { agent: AGENT, container: `/pods/${OPERATOR}/proj/x/` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('400 — the operator cannot mint for a forged (mismatched) issuer', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/mandate', headers: auth('nip98', OPERATOR),
      payload: { issuer: STRANGER, agent: AGENT, container: `/pods/${OPERATOR}/proj/x/` },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('issuer_mismatch');
  });

  it('201 — the operator mints (no issuer supplied → self as issuer)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/mandate', headers: auth('nip98', OPERATOR),
      payload: { agent: AGENT, container: `/pods/${OPERATOR}/proj/ok/` },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.record.issuer).toBe(`did:nostr:${OPERATOR}`);
    expect(body.record.agent).toBe(`did:nostr:${AGENT}`);
  });

  it('201 — a matching issuer (operator did) is accepted', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/mandate', headers: auth('nip98', OPERATOR),
      payload: { issuer: `did:nostr:${OPERATOR}`, agent: AGENT, container: `/pods/${OPERATOR}/proj/match/` },
    });
    expect(res.statusCode).toBe(201);
  });

  it('the operator bearer is operator-equivalent (201)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/mandate', headers: auth('bearer'),
      payload: { agent: AGENT, container: `/pods/${OPERATOR}/proj/bearer/` },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().record.issuer).toBe(`did:nostr:${OPERATOR}`);
  });
});

// ── AB-11: the HTTP contract of enforcement and revocation ──────────────────────
describe('/v1/mandate — fail-closed signing, tombstone and revoke contract (AB-11)', () => {
  let app; let tmp; let d;
  const C = `/pods/${OPERATOR}/proj/http/`;
  const post = (url, payload, headers = auth('nip98', OPERATOR)) => app.inject({ method: 'POST', url, headers, payload });

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mandate-http-'));
    process.env.AGENTBOX_STATE_DIR = tmp;
    process.env.AGENTBOX_X_ONLY_PUBKEY_HEX = OPERATOR;
    d = makeDeps();
    deps = d;
    app = buildApp();
  });
  afterEach(async () => { await app.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

  it('503 signer_unavailable on grant with no pod-owner signer, and nothing is minted', async () => {
    d.signer = null;
    const res = await post('/v1/mandate', { agent: AGENT, container: C });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'signer_unavailable' });
    expect((await app.inject({ method: 'GET', url: '/v1/mandate', headers: auth('nip98', OPERATOR) })).json().count).toBe(0);
  });

  it('400 for a container outside the pod and for a Control request', async () => {
    expect((await post('/v1/mandate', { agent: AGENT, container: '/proj/x/' })).statusCode).toBe(400);
    expect((await post('/v1/mandate', { agent: AGENT, container: C, modes: ['Read', 'Control'] })).statusCode).toBe(400);
  });

  it('201 grant is signed and enforced; the listing shows its state', async () => {
    const res = await post('/v1/mandate', { agent: AGENT, container: C });
    expect(res.statusCode).toBe(201);
    expect(res.json().signed).toBe(true);
    expect(d.pod.files.get(`/pods/${OPERATOR}/proj/http.acl`)).toContain(AGENT);
    const list = (await app.inject({ method: 'GET', url: '/v1/mandate', headers: auth('nip98', OPERATOR) })).json();
    expect(list.mandates[0]).toMatchObject({ state: 'active', pod: OPERATOR });
  });

  it('revoke: 200 with effective_at_pod/published; then the explicit grant replaces the tombstone (201), ensure would 409', async () => {
    await post('/v1/mandate', { agent: AGENT, container: C });
    const rv = await post('/v1/mandate/revoke', { agent: AGENT, container: C });
    expect(rv.statusCode).toBe(200);
    expect(rv.json()).toMatchObject({ state: 'revoked', effective_at_pod: true, published: true });
    expect(d.pod.files.has(`/pods/${OPERATOR}/proj/http.acl`)).toBe(false);
    const again = await post('/v1/mandate', { agent: AGENT, container: C });
    expect(again.statusCode).toBe(201);                            // operator's explicit grant
    const { ensureMandate } = mandateRoutes;
    await post('/v1/mandate/revoke', { agent: AGENT, container: C });
    await expect(ensureMandate({ agent: AGENT, container: C, manifest: {}, logger, deps: d })).rejects.toMatchObject({ name: 'MandateRevokedError' });
  });

  it('revoke 503 with no signer leaves the mandate active; 404 for an unknown mandate', async () => {
    await post('/v1/mandate', { agent: AGENT, container: C });
    const saved = d.signer;
    d.signer = null;
    const rv = await post('/v1/mandate/revoke', { agent: AGENT, container: C });
    expect(rv.statusCode).toBe(503);
    expect(rv.json().error).toBe('signer_unavailable');
    d.signer = saved;
    const list = (await app.inject({ method: 'GET', url: '/v1/mandate', headers: auth('nip98', OPERATOR) })).json();
    expect(list.mandates[0].state).toBe('active');
    expect((await post('/v1/mandate/revoke', { urn: 'urn:agentbox:mandate:none' })).statusCode).toBe(404);
  });

  it('revoke 502 effective_at_pod:false on a pod failure; 200 published:false when only the relay is down', async () => {
    await post('/v1/mandate', { agent: AGENT, container: C });
    d.pod.fail('DELETE', 500);
    const bad = await post('/v1/mandate/revoke', { agent: AGENT, container: C });
    expect(bad.statusCode).toBe(502);
    expect(bad.json()).toMatchObject({ effective_at_pod: false });
    d.publisher.down = true;
    const half = await post('/v1/mandate/revoke', { agent: AGENT, container: C });
    expect(half.statusCode).toBe(200);
    expect(half.json()).toMatchObject({ state: 'revoked_unpublished', effective_at_pod: true, published: false });
  });
});
