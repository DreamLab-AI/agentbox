'use strict';

/**
 * Route-level lock for REC-5 AC5 (PRD-019 / ADR-037 D1): EVERY {success:false}
 * return through the agent-events route classifies through the shared MAST
 * taxonomy — including the fourth error site, the per-event identity-mismatch
 * check INSIDE POST /v1/agent-events/batch's for-loop, which previously returned a
 * plain {success:false} with no failure_mode.
 *
 * The real failure-taxonomy library runs (NOT mocked) so the assertion proves the
 * route wires the real classifier. Only agent-event-auth is mocked, to drive the
 * two failure branches (auth reject → unmapped; identity mismatch → FM-1.2)
 * without standing up NIP-98 signing.
 */

jest.mock('../../management-api/lib/agent-event-auth', () => ({
  verifyAgentEventRequest: jest.fn(),
  reconcileSourceUrn: jest.fn(),
}));

const auth = require('../../management-api/lib/agent-event-auth');
const Fastify = require('../../management-api/node_modules/fastify');
const agentEventsRoutes = require('../../management-api/routes/agent-events');

const VERIFIED_DID = `did:nostr:${'a'.repeat(64)}`;
const MISMATCH_URN = `did:nostr:${'b'.repeat(64)}`;

async function makeApp() {
  const app = Fastify({ logger: false });
  await app.register(agentEventsRoutes, {
    logger: { info() {}, debug() {}, warn() {}, error() {} },
    metrics: {},
  });
  await app.ready();
  return app;
}

// A batch/emit event that passes schema validation (non-numeric string ids can
// only match the string branch of the oneOf, so coercion cannot fail it).
function evt(sourceUrn) {
  return {
    source_agent_id: 'agent-x',
    target_node_id: 'node-y',
    action_type: 'query',
    source_urn: sourceUrn,
  };
}

describe('REC-5 AC5 — every {success:false} route return carries a MAST tag', () => {
  beforeEach(() => {
    // Default: auth passes with a verified did; reconcile flags a mismatch when a
    // claimed source_urn differs from that did (mirrors the real lib's contract).
    auth.verifyAgentEventRequest.mockReturnValue({ ok: true, did: VERIFIED_DID, pubkey: 'a'.repeat(64) });
    auth.reconcileSourceUrn.mockImplementation((claimed, did) =>
      (claimed && claimed !== did)
        ? { ok: false, status: 403, error: 'source_urn mismatch' }
        : { ok: true });
  });

  test('FOURTH SITE (the defect): batch per-event identity mismatch → FM-1.2, not a bare {success:false}', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST', url: '/v1/agent-events/batch',
      payload: { events: [evt(MISMATCH_URN)] },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.success).toBe(false);
    // The classification the singular /emit site already produced now also rides
    // the batch site: Disobey Role Specification, human text preserved as detail.
    expect(body.failure_mode).toBe('FM-1.2');
    expect(body.failure_detail).toBe('source_urn mismatch');
    await app.close();
  });

  test('PARITY: the singular /emit identity mismatch classifies FM-1.2 too (regression lock)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST', url: '/v1/agent-events/emit',
      payload: evt(MISMATCH_URN),
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.success).toBe(false);
    expect(body.failure_mode).toBe('FM-1.2');
    await app.close();
  });

  test('batch auth-signature reject also classifies (→ unmapped, the honest sentinel), never bare', async () => {
    auth.verifyAgentEventRequest.mockReturnValue({ ok: false, status: 401, error: 'invalid NIP-98 signature' });
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST', url: '/v1/agent-events/batch',
      payload: { events: [evt(MISMATCH_URN)] },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.success).toBe(false);
    // A transport auth reject is not a multi-agent behaviour the binary signal can
    // resolve → `unmapped`, never dropped, human text kept as detail.
    expect(body.failure_mode).toBe('unmapped');
    expect(body.failure_detail).toBe('invalid NIP-98 signature');
    await app.close();
  });

  test('a matching source_urn proceeds (the classification path only fires on failure)', async () => {
    const app = await makeApp();
    const res = await app.inject({
      method: 'POST', url: '/v1/agent-events/batch',
      payload: { events: [evt(VERIFIED_DID)] }, // claimed === verified did → ok
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.failure_mode).toBeUndefined();
    await app.close();
  });
});
