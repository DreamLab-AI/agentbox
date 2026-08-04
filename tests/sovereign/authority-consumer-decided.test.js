'use strict';

/**
 * Finding 2 (Critical), consumer half — signAndPublishDecision must FAIL CLOSED:
 * it throws for an unknown request id (NOT_PENDING) and for one a prior 31403
 * already answered (ALREADY_DECIDED), and it never signs a second decision. The
 * decided cache also reflects a mobile-path 31403 (a verified inbound decision
 * marks the open request decided + closes it).
 */

const { buildAuthorityConsumer } = require('../../management-api/lib/authority-consumer');

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
  return { async sign(evt) { return { ...evt, id: `${evt.kind}-${++n}`, pubkey, sig: 'x' }; } };
}

function buildConsumer() {
  const bridge = makeFakeBridge();
  process.env.AGENTBOX_X_ONLY_PUBKEY_HEX = APPROVER;
  const consumer = buildAuthorityConsumer({
    manifest: { sovereign_mesh: {} },
    logger,
    bridgeFactory: async () => bridge,
    signer: makeSigner(APPROVER),
    verifyEvent: () => true,
    defaultTimeoutMs: 300,
  });
  return { consumer, bridge };
}

describe('authority consumer — fail-closed decision guards', () => {
  it('throws NOT_PENDING for an id the gate never opened', async () => {
    const { consumer } = buildConsumer();
    await expect(consumer.signAndPublishDecision({ requestId: 'ghost', outcome: 'approve' }))
      .rejects.toMatchObject({ code: 'NOT_PENDING' });
    expect(consumer.isDecided('ghost')).toBe(false);
  });

  it('signs once, then throws ALREADY_DECIDED and marks decided', async () => {
    const { consumer, bridge } = buildConsumer();
    const req = await consumer.publishActionRequest({ kind: 31402, created_at: 1, tags: [['d', 'p1']], content: '{}' });
    expect(consumer.getPending(req.id)).toBeTruthy();

    const signed = await consumer.signAndPublishDecision({ requestId: req.id, outcome: 'approve' });
    expect(signed.kind).toBe(31403);
    expect(consumer.isDecided(req.id)).toBe(true);
    expect(consumer.getPending(req.id)).toBeNull(); // no longer pending
    const publishedCount = bridge.published.length;

    await expect(consumer.signAndPublishDecision({ requestId: req.id, outcome: 'reject' }))
      .rejects.toMatchObject({ code: 'ALREADY_DECIDED' });
    // Crucially: no SECOND 31403 was published.
    expect(bridge.published.length).toBe(publishedCount);
  });

  it('a verified inbound (mobile-path) 31403 marks the open request decided', async () => {
    const { consumer, bridge } = buildConsumer();
    const req = await consumer.publishActionRequest({ kind: 31402, created_at: 1, tags: [['d', 'p2']], content: '{}' });
    const decision = { kind: 31403, pubkey: APPROVER, id: 'mob-1', tags: [['e', req.id], ['d', 'p2']], content: JSON.stringify({ outcome: 'approve' }) };
    bridge.handlers.forEach((h) => h(decision));
    expect(consumer.isDecided(req.id)).toBe(true);
    expect(consumer.getPending(req.id)).toBeNull();
    // The HTTP front door would now refuse to re-sign it.
    await expect(consumer.signAndPublishDecision({ requestId: req.id, outcome: 'reject' }))
      .rejects.toMatchObject({ code: 'ALREADY_DECIDED' });
  });
});
