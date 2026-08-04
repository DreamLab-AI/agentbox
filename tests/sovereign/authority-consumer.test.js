'use strict';

/**
 * ADR-043 D4.7 / PRD-021 F3-6 — the canonical awaitDecision consumer. A
 * verified, allowlisted kind-31403 resolves a pending gate wait; a
 * non-allowlisted 31403 is ignored (the wait times out to null → DENY); the
 * dashboard signing front door signs+publishes a 31403 that releases the wait.
 * A fake bridge + injected signer isolate the test from a live relay.
 */

const { buildAuthorityConsumer, buildActionResponse } = require('../../management-api/lib/authority-consumer');

const APPROVER = 'c'.repeat(64);
const logger = { debug() {}, info() {}, warn() {}, error() {} };

function makeFakeBridge() {
  const bridge = {
    handlers: [],
    published: [],
    subscribe(filter, handler) { bridge.handlers.push(handler); return 'sub-1'; },
    async publish(evt, signer) { const signed = await signer.sign(evt); bridge.published.push(signed); return signed; },
  };
  return bridge;
}

function makeSigner(pubkey) {
  let n = 0;
  return { async sign(evt) { return { ...evt, id: `${evt.kind}-${++n}-${Math.random().toString(16).slice(2, 8)}`, pubkey, sig: 'x' }; } };
}

function buildConsumer(overrides = {}) {
  const bridge = makeFakeBridge();
  process.env.AGENTBOX_X_ONLY_PUBKEY_HEX = APPROVER; // allowlisted approver
  const consumer = buildAuthorityConsumer({
    manifest: { sovereign_mesh: {} },
    logger,
    bridgeFactory: async () => bridge,
    signer: makeSigner(APPROVER),
    verifyEvent: () => true,
    defaultTimeoutMs: 300,
    ...overrides,
  });
  return { consumer, bridge };
}

describe('buildActionResponse', () => {
  it('builds a 31403 referencing the request by e-tag + outcome content', () => {
    const evt = buildActionResponse({ requestId: 'req-1', panelId: 'panel-1', outcome: 'approve' });
    expect(evt.kind).toBe(31403);
    expect(evt.tags).toContainEqual(['e', 'req-1']);
    expect(JSON.parse(evt.content).outcome).toBe('approve');
  });
});

describe('authority consumer — awaitDecision', () => {
  it('resolves a pending wait on a verified, allowlisted 31403', async () => {
    const { consumer, bridge } = buildConsumer();
    const unsigned = { kind: 31402, created_at: 1, tags: [['d', 'panel-x']], content: JSON.stringify({ case_id: 'case-x' }) };
    const signedReq = await consumer.publishActionRequest(unsigned);
    expect(signedReq.id).toBeTruthy();
    expect(consumer.listPending().length).toBe(1);

    const waitP = consumer.awaitDecision(signedReq, { timeoutMs: 1000 });
    // Deliver a matching 31403 through the bridge subscription.
    const decision = { kind: 31403, pubkey: APPROVER, tags: [['e', signedReq.id], ['d', 'panel-x']], content: JSON.stringify({ outcome: 'approve', case_id: 'case-x' }) };
    bridge.handlers.forEach((h) => h(decision));

    const resolved = await waitP;
    expect(resolved).toBe(decision);
    expect(consumer.listPending().length).toBe(0);
  });

  it('ignores a non-allowlisted 31403 (wait times out to null → DENY)', async () => {
    const { consumer, bridge } = buildConsumer();
    const signedReq = await consumer.publishActionRequest({ kind: 31402, created_at: 1, tags: [['d', 'p2']], content: '{}' });
    const waitP = consumer.awaitDecision(signedReq, { timeoutMs: 150 });
    const rogue = { kind: 31403, pubkey: 'd'.repeat(64), tags: [['e', signedReq.id]], content: JSON.stringify({ outcome: 'approve' }) };
    bridge.handlers.forEach((h) => h(rogue));
    const resolved = await waitP;
    expect(resolved).toBeNull();
  });

  it('signAndPublishDecision signs a 31403 and releases the local wait', async () => {
    const { consumer } = buildConsumer();
    const signedReq = await consumer.publishActionRequest({ kind: 31402, created_at: 1, tags: [['d', 'p3']], content: JSON.stringify({ case_id: 'c3' }) });
    const waitP = consumer.awaitDecision(signedReq, { timeoutMs: 1000 });
    const signed = await consumer.signAndPublishDecision({ requestId: signedReq.id, outcome: 'approve' });
    expect(signed.kind).toBe(31403);
    const resolved = await waitP;
    expect(resolved.kind).toBe(31403);
  });
});
