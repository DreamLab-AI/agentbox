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

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const OPERATOR = 'f'.repeat(64);
const AGENT = 'a'.repeat(64);
const STRANGER = 'd'.repeat(64);

function buildApp() {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    const raw = request.headers['x-test-auth'];
    if (raw) { try { request.auth = JSON.parse(raw); } catch (_) { /* leave unset */ } }
  });
  app.register(mandateRoutes, { logger, manifest: {} });
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
    delete process.env.AGENTBOX_STACK;
    delete process.env.AGENTBOX_PROFILE; // no signer stack → unsigned mint, still records
  });
  afterAll(() => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} });
  beforeEach(() => { app = buildApp(); });
  afterEach(async () => { await app.close(); });

  it('403 — a non-operator NIP-98 key cannot create a mandate', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/mandate', headers: auth('nip98', STRANGER),
      payload: { agent: AGENT, container: '/proj/x/' },
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
      payload: { agent: AGENT, container: '/proj/x/' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('400 — the operator cannot mint for a forged (mismatched) issuer', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/mandate', headers: auth('nip98', OPERATOR),
      payload: { issuer: STRANGER, agent: AGENT, container: '/proj/x/' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('issuer_mismatch');
  });

  it('201 — the operator mints (no issuer supplied → self as issuer)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/mandate', headers: auth('nip98', OPERATOR),
      payload: { agent: AGENT, container: '/proj/ok/' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.record.issuer).toBe(`did:nostr:${OPERATOR}`);
    expect(body.record.agent).toBe(`did:nostr:${AGENT}`);
  });

  it('201 — a matching issuer (operator did) is accepted', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/mandate', headers: auth('nip98', OPERATOR),
      payload: { issuer: `did:nostr:${OPERATOR}`, agent: AGENT, container: '/proj/match/' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('the operator bearer is operator-equivalent (201)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/v1/mandate', headers: auth('bearer'),
      payload: { agent: AGENT, container: '/proj/bearer/' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().record.issuer).toBe(`did:nostr:${OPERATOR}`);
  });
});
