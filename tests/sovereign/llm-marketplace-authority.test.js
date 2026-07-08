'use strict';

/**
 * REC-6 (PRD-019 / ADR-037 D2) — the authority gate WIRED into a real, irreversible
 * call site: POST /v1/llm/revoke. `mandate_revoke` is classed `zero-tolerance` in
 * agentbox.toml [skills.authority.classes] (a granted agent losing access is not
 * locally reversible). Before this the route revoked with ZERO gate. These tests
 * lock the block/RELEASE behaviour AC4 requires:
 *
 *   - a zero-tolerance revoke BLOCKS on a signed 31402/31403 decision and RELEASES
 *     the revocation only on a verified `approve`;
 *   - with no decision surface / a reject, it is DENIED (fail-closed) and the
 *     irreversible revocation NEVER happens;
 *   - the authority classification is recorded on the agent-events envelope (AC4);
 *   - with [skills.authority] disabled the gate is inert (legacy pass-through).
 */

const authority = require('../../management-api/lib/authority');
const Fastify = require('../../management-api/node_modules/fastify');
const llmRoutes = require('../../management-api/routes/llm-marketplace');
const { agentEventPublisher } = require('../../management-api/utils/agent-event-publisher');

const MANIFEST_ON = {
  skills: { authority: { enabled: true, default: 'escalation', classes: { mandate_revoke: 'zero-tolerance' } } },
};
const MANIFEST_OFF = {
  skills: { authority: { enabled: false, default: 'escalation', classes: { mandate_revoke: 'zero-tolerance' } } },
};

// A signed ActionResponse (kind 31403) referencing the request by e-tag.
function signedResponse(requestId, outcome) {
  return {
    id: `resp-${requestId}`,
    kind: authority.ACTION_RESPONSE_KIND, // 31403
    pubkey: 'b'.repeat(64),
    content: JSON.stringify({ outcome }),
    tags: [['e', requestId]],
    sig: 'deadbeef',
  };
}

async function makeApp(manifest, gateDeps) {
  const app = Fastify({ logger: false });
  const authorityGate = authority.buildAuthorityGate(manifest, gateDeps || {});
  await app.register(llmRoutes, {
    logger: { info() {}, debug() {}, warn() {}, error() {} },
    authorityGate,
  });
  await app.ready();
  return app;
}

// The caller identity the route resolves for this test process (no NIP-98 here).
const CALLER = process.env.AGENTBOX_PUBKEY || '0'.repeat(64);

// Create a grant through the public route so the not-revoked assertion is real.
// The grantee is the CALLER so GET /v1/llm/grants (keyed by consumer pubkey) lists it.
async function seedGrant(app) {
  const res = await app.inject({
    method: 'POST', url: '/v1/llm/grant',
    payload: {
      request_event_id: 'req-evt',
      grantee_pubkey: CALLER,
      model: 'test-model',
      token_allocation: 1000,
    },
  });
  return res.json().grant_id;
}

async function activeGrantIds(app) {
  const res = await app.inject({ method: 'GET', url: '/v1/llm/grants' });
  return res.json().grants.map((g) => g.grantEventId).filter(Boolean);
}

describe('REC-6 — /v1/llm/revoke is gated by the authority model', () => {
  test('a zero-tolerance revoke BLOCKS on a signed 31402 and RELEASES on a verified approve', async () => {
    const published = [];
    const app = await makeApp(MANIFEST_ON, {
      publishActionRequest: async (u) => { published.push(u); return { ...u, id: 'req-approve' }; },
      awaitDecision: async (req) => signedResponse(req.id, 'approve'),
      verifyEvent: () => true,
    });

    const res = await app.inject({ method: 'POST', url: '/v1/llm/revoke', payload: { grant_id: 'g-approve' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.revoked).toBe(true);
    expect(body.authority_class).toBe('zero-tolerance');
    // It PRODUCED a kind-31402 ActionRequest (consumed the forum's decision).
    expect(published).toHaveLength(1);
    expect(published[0].kind).toBe(authority.ACTION_REQUEST_KIND);
    await app.close();
  });

  test('FALSIFICATION: with NO decision surface the revoke is DENIED and the grant is NOT revoked', async () => {
    const app = await makeApp(MANIFEST_ON, {
      // publisher wired but no awaitDecision consumer → fail-closed
      publishActionRequest: async (u) => ({ ...u, id: 'req-x' }),
    });
    const grantId = await seedGrant(app);
    expect(await activeGrantIds(app)).toContain(grantId);

    const res = await app.inject({ method: 'POST', url: '/v1/llm/revoke', payload: { grant_id: grantId } });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toBe('authority_denied');
    expect(body.authority_class).toBe('zero-tolerance');
    expect(body.reason).toBe('no-decision-surface');
    expect(body.revoked).toBe(false);
    // The irreversible action never happened: the grant is still active.
    expect(await activeGrantIds(app)).toContain(grantId);
    await app.close();
  });

  test('FALSIFICATION: a REJECT decision denies the revoke (never proceeds on a non-approval)', async () => {
    const app = await makeApp(MANIFEST_ON, {
      publishActionRequest: async (u) => ({ ...u, id: 'req-reject' }),
      awaitDecision: async (req) => signedResponse(req.id, 'reject'),
      verifyEvent: () => true,
    });
    const grantId = await seedGrant(app);
    const res = await app.inject({ method: 'POST', url: '/v1/llm/revoke', payload: { grant_id: grantId } });
    expect(res.statusCode).toBe(403);
    expect(res.json().revoked).toBe(false);
    expect(await activeGrantIds(app)).toContain(grantId);
    await app.close();
  });

  test('AC4: the authority classification is recorded on the agent-events envelope', async () => {
    const seen = [];
    const unsub = agentEventPublisher.subscribe((ev) => seen.push(ev));
    const app = await makeApp(MANIFEST_ON, {
      publishActionRequest: async (u) => ({ ...u, id: 'req-ac4' }),
      awaitDecision: async (req) => signedResponse(req.id, 'approve'),
      verifyEvent: () => true,
    });
    await app.inject({ method: 'POST', url: '/v1/llm/revoke', payload: { grant_id: 'g-ac4' } });

    const audit = seen.reverse().find((e) => e.metadata && e.metadata.kind === 'llm-grant-revoke');
    expect(audit).toBeDefined();
    expect(audit.authority_class).toBe('zero-tolerance');
    expect(audit.metadata.decision).toBe('allow');
    // and it is forwarded on the wire (AC4 record on the canonical envelope).
    const n = agentEventPublisher.createMcpNotification(audit);
    expect(n.params.event.authority_class).toBe('zero-tolerance');
    unsub();
    await app.close();
  });

  test('with [skills.authority] disabled the gate is inert — legacy revoke proceeds ungated', async () => {
    const app = await makeApp(MANIFEST_OFF, {
      // even without any decision surface, a disabled gate must not block
    });
    const res = await app.inject({ method: 'POST', url: '/v1/llm/revoke', payload: { grant_id: 'g-legacy' } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.revoked).toBe(true);
    expect(body.authority_class).toBeUndefined(); // no classification when the gate is inert
    await app.close();
  });
});
