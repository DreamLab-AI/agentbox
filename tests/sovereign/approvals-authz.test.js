'use strict';

/**
 * Finding 2 (Critical) — /v1/approvals/:id/decide is now approver-gated and
 * request-state-aware. A verified NIP-98 signature is not enough: the signer
 * must be on the approval allowlist (403 otherwise); an unknown request id is
 * 404; a request a prior 31403 already answered is 409; only an allowlisted key
 * deciding a genuinely-pending request signs a 31403 (200).
 */

const Fastify = require('../../management-api/node_modules/fastify');
const approvalsRoutes = require('../../management-api/routes/approvals');

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const OPERATOR = 'f'.repeat(64);
const APPROVER = 'c'.repeat(64);
const STRANGER = 'd'.repeat(64);
const MANIFEST = { sovereign_mesh: { relay: { allowed_pubkeys: [APPROVER] } } };

/** A fake authority consumer mirroring the real getPending/isDecided/sign flow. */
function makeConsumer() {
  const open = new Map();
  const decided = new Map();
  return {
    _open: open,
    _decided: decided,
    listPending: () => [...open.values()],
    getPending: (id) => open.get(id) || null,
    isDecided: (id) => decided.has(id),
    getDecision: (id) => decided.get(id) || null,
    async signAndPublishDecision({ requestId, outcome }) {
      if (!open.has(requestId)) {
        const e = new Error(decided.has(requestId) ? 'already decided' : 'not pending');
        e.code = decided.has(requestId) ? 'ALREADY_DECIDED' : 'NOT_PENDING';
        throw e;
      }
      open.delete(requestId);
      const signed = { id: `resp-${requestId}`, kind: 31403 };
      decided.set(requestId, { outcome, response_event_id: signed.id });
      return signed;
    },
  };
}

/** Build a throwaway app: an onRequest hook fakes middleware/auth's request.auth. */
function buildApp(consumer) {
  const app = Fastify();
  // Header `x-test-auth`: JSON { mode, pubkey } → request.auth (as middleware/auth sets it).
  app.addHook('onRequest', async (request) => {
    const raw = request.headers['x-test-auth'];
    if (raw) { try { request.auth = JSON.parse(raw); } catch (_) { /* leave unset */ } }
  });
  app.register(approvalsRoutes, { logger, manifest: MANIFEST, authorityConsumer: consumer });
  return app;
}

function auth(mode, pubkey) {
  return { 'x-test-auth': JSON.stringify(pubkey ? { mode, pubkey } : { mode }) };
}

describe('POST /v1/approvals/:id/decide — approver-gated', () => {
  let app; let consumer;
  beforeAll(() => { process.env.AGENTBOX_X_ONLY_PUBKEY_HEX = OPERATOR; });
  beforeEach(() => {
    consumer = makeConsumer();
    consumer._open.set('req-pending', { request_event_id: 'req-pending', title: 'do a thing' });
    consumer._decided.set('req-old', { outcome: 'approve', response_event_id: 'resp-old' });
    app = buildApp(consumer);
  });
  afterEach(async () => { await app.close(); });

  it('401 when not NIP-98 (bearer cannot decide)', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/approvals/req-pending/decide', headers: auth('bearer'), payload: { outcome: 'approve' } });
    expect(res.statusCode).toBe(401);
  });

  it('403 for a verified-but-non-allowlisted NIP-98 key', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/approvals/req-pending/decide', headers: auth('nip98', STRANGER), payload: { outcome: 'approve' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('forbidden_not_approver');
    // The stranger did NOT decide the request — it is still pending.
    expect(consumer._open.has('req-pending')).toBe(true);
  });

  it('404 for an unknown request id (allowlisted caller)', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/approvals/no-such/decide', headers: auth('nip98', APPROVER), payload: { outcome: 'approve' } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('unknown_request');
  });

  it('409 for an already-decided request (allowlisted caller)', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/approvals/req-old/decide', headers: auth('nip98', APPROVER), payload: { outcome: 'approve' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('already_decided');
  });

  it('200 for an allowlisted approver deciding a pending request', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/approvals/req-pending/decide', headers: auth('nip98', APPROVER), payload: { outcome: 'approve' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.response_event_id).toBe('resp-req-pending');
    expect(body.decided_by).toBe(APPROVER);
    // Now decided → a second decide is 409.
    const res2 = await app.inject({ method: 'POST', url: '/v1/approvals/req-pending/decide', headers: auth('nip98', APPROVER), payload: { outcome: 'approve' } });
    expect(res2.statusCode).toBe(409);
  });

  it('the operator key (on the allowlist) may also decide', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/approvals/req-pending/decide', headers: auth('nip98', OPERATOR), payload: { decision: 'deny' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().outcome).toBe('reject'); // deny → reject normalisation preserved
  });
});
