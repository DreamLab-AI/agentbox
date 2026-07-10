/**
 * broker-bridge decide-route tests — F0 "stop the bleed" (closeout 2026-07-03).
 *
 * Verifies the bridge honours VisionClaw's real `writeback_committed` response
 * field instead of fabricating a successful closure, and that it propagates a
 * real `broker_pubkey` rather than the literal string 'unknown' (which
 * VisionClaw treats as unattributed and refuses to write back).
 *
 * Runner: node:test (built in). Run just this file with:
 *   node --test management-api/tests/broker-bridge.test.js
 *
 * `global.fetch` is stubbed so no real VisionClaw call is made; the stub also
 * captures the outbound decide body so we can assert on broker_pubkey.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');

const brokerBridgeRoutes = require('../routes/broker-bridge');
const authority = require('../lib/authority');

const NOOP_LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

// A structurally-valid 64-hex pubkey for attribution.
const PK = 'a'.repeat(64);

// Manifest classifying the two broker action classes (mirrors agentbox.toml
// [skills.authority.classes]). approve/promote → zero-tolerance (gated);
// everything else → recoverable (ungated).
const AUTH_MANIFEST = {
  skills: {
    authority: {
      enabled: true,
      classes: {
        broker_enrichment_writeback: 'zero-tolerance',
        broker_enrichment_review: 'recoverable',
      },
    },
  },
};

// A signed ACSP ActionResponse (kind 31403) referencing the request by e-tag.
function signedResponse(requestId, outcome) {
  return {
    id: `resp-${requestId}`,
    kind: authority.ACTION_RESPONSE_KIND, // 31403
    pubkey: 'b'.repeat(64),
    content: JSON.stringify({ outcome, reason: 'human decided' }),
    tags: [['e', requestId], ['p', 'a'.repeat(64)]],
    sig: 'deadbeef',
  };
}

/**
 * Build a real authority gate with an injected ACSP producer + a mocked signed-
 * decision consumer (the forum's 31403). `outcome` decides the response; a
 * `null` outcome models a timeout / absent decision surface (fail-closed deny).
 */
function buildGate(outcome = 'approve') {
  return authority.buildAuthorityGate(AUTH_MANIFEST, {
    logger: NOOP_LOGGER,
    publishActionRequest: async (unsigned) => ({ ...unsigned, id: 'req-broker-1', sig: 'sig' }),
    awaitDecision: async (signedReq) => (outcome === null ? null : signedResponse(signedReq.id, outcome)),
    verifyEvent: () => true,
  });
}

/**
 * Build a fastify app with the broker-bridge plugin registered, and a `fetch`
 * stub that returns `upstreamBody` for the enrichment-proposals decide call.
 * Records the parsed decide-request body on `captured`. `authorityGate` is
 * injected (default: an approving zero-tolerance gate) so the decide route's
 * REC-6 gate is exercised without a live forum / relay.
 */
async function buildApp(upstreamBody, captured, authorityGate = buildGate('approve')) {
  const originalFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    if (String(url).includes('/api/enrichment-proposals/')) {
      captured.url = String(url);
      captured.body = opts.body ? JSON.parse(opts.body) : null;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        async json() { return upstreamBody; },
        async text() { return JSON.stringify(upstreamBody); },
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const app = Fastify();
  await app.register(brokerBridgeRoutes, { logger: NOOP_LOGGER, authorityGate });
  await app.ready();

  app.__restoreFetch = () => { global.fetch = originalFetch; };
  return app;
}

test('attributed approval that commits reports success + writeback_committed', async () => {
  const captured = {};
  const app = await buildApp(
    {
      success: true,
      decision: 'approve',
      attributed: true,
      writeback_triggered: true,
      writeback_committed: true,
      activity_urn: 'urn:visionclaw:execution:sha256-12-abcabcabcabc',
    },
    captured,
  );
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/broker/bridge/cases/case-1/decide',
      headers: { 'content-type': 'application/json', 'x-agent-pubkey': PK },
      payload: { decision: 'approve', note: 'looks good' },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.writeback_triggered, true);
    assert.equal(body.writeback_committed, true);
    assert.equal(body.attributed, true);
    assert.equal(body.writeback_result.status, 'committed');
  } finally {
    app.__restoreFetch();
    await app.close();
  }
});

test('attributed approval that does NOT commit returns 502 writeback-not-committed', async () => {
  const captured = {};
  const app = await buildApp(
    {
      success: true,
      decision: 'approve',
      attributed: true,
      writeback_triggered: true,
      writeback_committed: false, // triggered but the Oxigraph write did not land
      activity_urn: 'urn:visionclaw:execution:sha256-12-deadbeefdead',
    },
    captured,
  );
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/broker/bridge/cases/case-2/decide',
      headers: { 'content-type': 'application/json', 'x-agent-pubkey': PK },
      payload: { decision: 'approve' },
    });
    assert.equal(res.statusCode, 502);
    const body = res.json();
    assert.equal(body.error, 'writeback-not-committed');
    assert.equal(body.writeback_committed, false);
    assert.equal(body.case_id, 'case-2');
  } finally {
    app.__restoreFetch();
    await app.close();
  }
});

test('broker_pubkey propagates the real deciding pubkey, never the literal "unknown"', async () => {
  const captured = {};
  const app = await buildApp(
    {
      success: true, decision: 'approve', attributed: true,
      writeback_triggered: true, writeback_committed: true,
      activity_urn: 'urn:visionclaw:execution:sha256-12-000011112222',
    },
    captured,
  );
  try {
    await app.inject({
      method: 'POST',
      url: '/api/broker/bridge/cases/case-3/decide',
      headers: { 'content-type': 'application/json', 'x-agent-pubkey': PK },
      payload: { decision: 'approve' },
    });
    assert.ok(captured.body, 'decide body was captured');
    assert.notEqual(captured.body.broker_pubkey, 'unknown');
    assert.equal(captured.body.broker_pubkey, PK);
    assert.equal(captured.body.outcome, 'approve');
  } finally {
    app.__restoreFetch();
    await app.close();
  }
});

test('non-writeback decision (reject) reports honest not-committed state', async () => {
  const captured = {};
  const app = await buildApp(
    {
      success: true, decision: 'reject', attributed: true,
      writeback_triggered: false, writeback_committed: false,
      activity_urn: 'urn:visionclaw:execution:sha256-12-333344445555',
    },
    captured,
  );
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/broker/bridge/cases/case-4/decide',
      headers: { 'content-type': 'application/json', 'x-agent-pubkey': PK },
      payload: { decision: 'reject' },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.writeback_triggered, false);
    assert.equal(body.writeback_committed, false);
    // reject is not a write-back decision, so no writeback_result envelope
    // (null on the wire, possibly serialised to an empty object by the schema).
    assert.ok(
      body.writeback_result === null
        || body.writeback_result === undefined
        || Object.keys(body.writeback_result).length === 0,
      `expected empty writeback_result, got ${JSON.stringify(body.writeback_result)}`,
    );
  } finally {
    app.__restoreFetch();
    await app.close();
  }
});

// ── REC-6 authority gate on the decide route (ADR-037 D2) ────────────────────

test('AUTHORITY: an approved write-back decision RELEASES on a verified 31403 and stamps the class', async () => {
  const captured = {};
  const app = await buildApp(
    {
      success: true, decision: 'approve', attributed: true,
      writeback_triggered: true, writeback_committed: true,
      activity_urn: 'urn:visionclaw:execution:sha256-12-aaaabbbbcccc',
    },
    captured,
    buildGate('approve'),
  );
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/broker/bridge/cases/case-auth-1/decide',
      headers: { 'content-type': 'application/json', 'x-agent-pubkey': PK },
      payload: { decision: 'approve' },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.authority_class, 'zero-tolerance');
    assert.equal(body.authority_request_event_id, 'req-broker-1');
    assert.equal(body.authority_response_event_id, 'resp-req-broker-1');
    // The write-back was proxied ONLY after the gate released.
    assert.ok(captured.body, 'VisionClaw decide was called after release');
  } finally {
    app.__restoreFetch();
    await app.close();
  }
});

test('AUTHORITY: a write-back decision with NO signed decision (timeout) is DENIED 403 and never proxied', async () => {
  const captured = {};
  const app = await buildApp(
    { success: true, decision: 'approve', attributed: true, writeback_triggered: true, writeback_committed: true },
    captured,
    buildGate(null), // awaitDecision resolves null → fail-closed
  );
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/broker/bridge/cases/case-auth-2/decide',
      headers: { 'content-type': 'application/json', 'x-agent-pubkey': PK },
      payload: { decision: 'approve' },
    });
    assert.equal(res.statusCode, 403);
    const body = res.json();
    assert.equal(body.error, 'authority_denied');
    assert.equal(body.authority_class, 'zero-tolerance');
    assert.equal(body.success, false);
    assert.equal(body.case_id, 'case-auth-2');
    // The irreversible write-back was blocked BEFORE any VisionClaw proxy call.
    assert.equal(captured.body, undefined, 'VisionClaw must NOT be called on a denied decision');
  } finally {
    app.__restoreFetch();
    await app.close();
  }
});

test('AUTHORITY: a REJECTED signed decision (31403 outcome=reject) DENIES the write-back 403', async () => {
  const captured = {};
  const app = await buildApp(
    { success: true, decision: 'promote', attributed: true, writeback_triggered: true, writeback_committed: true },
    captured,
    buildGate('reject'),
  );
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/broker/bridge/cases/case-auth-3/decide',
      headers: { 'content-type': 'application/json', 'x-agent-pubkey': PK },
      payload: { decision: 'promote' },
    });
    assert.equal(res.statusCode, 403);
    const body = res.json();
    assert.equal(body.error, 'authority_denied');
    assert.equal(captured.body, undefined, 'a rejected decision is not proxied');
  } finally {
    app.__restoreFetch();
    await app.close();
  }
});

test('AUTHORITY: a recoverable decision (reject) passes UNGATED even with no decision surface', async () => {
  const captured = {};
  // A gate whose consumer would DENY if consulted — proves the recoverable
  // decision never touches the block-on-signed-response path.
  const app = await buildApp(
    {
      success: true, decision: 'reject', attributed: true,
      writeback_triggered: false, writeback_committed: false,
    },
    captured,
    buildGate(null),
  );
  try {
    const res = await app.inject({
      method: 'POST',
      url: '/api/broker/bridge/cases/case-auth-4/decide',
      headers: { 'content-type': 'application/json', 'x-agent-pubkey': PK },
      payload: { decision: 'reject' },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.success, true);
    assert.equal(body.authority_class, 'recoverable');
    assert.ok(captured.body, 'recoverable decision is proxied without a decision wait');
  } finally {
    app.__restoreFetch();
    await app.close();
  }
});

// ── governance-decision-waiter: the relay-consumer → gate seam ───────────────

test('WAITER: notify() with a matching 31403 resolves an awaitDecision by request e-tag', async () => {
  const { GovernanceDecisionWaiter } = require('../lib/governance-decision-waiter');
  const waiter = new GovernanceDecisionWaiter();
  const signedRequest = { id: 'req-abc', content: JSON.stringify({ case_id: 'case-9' }), tags: [['d', 'panel-9']] };
  const p = waiter.awaitDecision(signedRequest, { timeoutMs: 5000 });
  assert.equal(waiter.pendingKeyCount() > 0, true);
  const resp = signedResponse('req-abc', 'approve');
  const matched = waiter.notify(resp);
  assert.equal(matched, true);
  const resolved = await p;
  assert.equal(resolved.id, 'resp-req-abc');
  assert.equal(waiter.pendingKeyCount(), 0, 'waiter is cleaned up after resolution');
});

test('WAITER: notify() with a matching case_id resolves even without an e-tag', async () => {
  const { GovernanceDecisionWaiter } = require('../lib/governance-decision-waiter');
  const waiter = new GovernanceDecisionWaiter();
  const signedRequest = { id: 'req-def', content: JSON.stringify({ case_id: 'case-77' }), tags: [] };
  const p = waiter.awaitDecision(signedRequest, { timeoutMs: 5000 });
  const resp = { id: 'r2', kind: authority.ACTION_RESPONSE_KIND, content: JSON.stringify({ case_id: 'case-77', outcome: 'approve' }), tags: [] };
  assert.equal(waiter.notify(resp), true);
  assert.equal((await p).id, 'r2');
});

test('WAITER: an unrelated 31403 does not resolve a pending waiter', async () => {
  const { GovernanceDecisionWaiter } = require('../lib/governance-decision-waiter');
  const waiter = new GovernanceDecisionWaiter();
  const signedRequest = { id: 'req-ghi', content: JSON.stringify({ case_id: 'case-1' }), tags: [] };
  const p = waiter.awaitDecision(signedRequest, { timeoutMs: 30 });
  assert.equal(waiter.notify(signedResponse('some-other-request', 'approve')), false);
  const resolved = await p; // times out → null (fail-closed)
  assert.equal(resolved, null);
});
