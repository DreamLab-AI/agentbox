'use strict';

/**
 * FINDING 4 (External security audit) — concurrent approvals must not
 * double-sign a kind-31403 decision.
 *
 * signAndPublishDecision reads the open request, then `await ensureReady()` +
 * `await bridge.publish()`. Before the fix, two simultaneous POSTs for the same
 * request id both passed the `!open` check (the delete happened only after the
 * awaits) and both published a signed 31403 — two authority decisions for one
 * gate.
 *
 * The fix claims the request ATOMICALLY (synchronously, before the first await):
 * `inFlight.add(id)` + `openRequests.delete(id)`. A concurrent call finds the
 * claim and throws DECISION_IN_FLIGHT (routes/approvals.js maps this to 409).
 * On publish FAILURE the pending state is restored so a retry can succeed.
 *
 * A fake bridge with a gated publish forces the two calls to genuinely overlap.
 */

const { buildAuthorityConsumer } = require('../../management-api/lib/authority-consumer');

const APPROVER = 'c'.repeat(64);
const logger = { debug() {}, info() {}, warn() {}, error() {} };

function makeSigner(pubkey) {
  let n = 0;
  return {
    async sign(evt) {
      return { ...evt, id: `${evt.kind}-${++n}-${Math.random().toString(16).slice(2, 8)}`, pubkey, sig: 'x' };
    },
  };
}

/**
 * Fake bridge whose publish can be gated (to force overlap) or made to fail
 * once (to exercise the restore-on-failure path).
 */
function makeControllableBridge(signer) {
  const bridge = {
    handlers: [],
    published: [],
    _gate: null,       // when set, publish awaits this promise before resolving
    _failNext: false,  // when true, the next publish rejects
    subscribe(_filter, handler) { bridge.handlers.push(handler); return 'sub-1'; },
    async publish(evt) {
      if (bridge._gate) await bridge._gate;
      if (bridge._failNext) {
        bridge._failNext = false;
        throw new Error('relay publish failed');
      }
      const signed = await signer.sign(evt);
      bridge.published.push(signed);
      return signed;
    },
  };
  return bridge;
}

function buildConsumer() {
  process.env.AGENTBOX_X_ONLY_PUBKEY_HEX = APPROVER; // allowlisted approver
  const signer = makeSigner(APPROVER);
  const bridge = makeControllableBridge(signer);
  const consumer = buildAuthorityConsumer({
    manifest: { sovereign_mesh: {} },
    logger,
    bridgeFactory: async () => bridge,
    signer,
    verifyEvent: () => true,
    defaultTimeoutMs: 300,
  });
  return { consumer, bridge };
}

// The fake bridge records BOTH the signed 31402 request (published by
// publishActionRequest) and any 31403 decision; count only the decisions.
function decisionsPublished(bridge) {
  return bridge.published.filter((e) => e.kind === 31403);
}

async function openOneRequest(consumer, dTag = 'panel-conc') {
  return consumer.publishActionRequest({
    kind: 31402,
    created_at: 1,
    tags: [['d', dTag]],
    content: JSON.stringify({ case_id: `case-${dTag}` }),
  });
}

describe('signAndPublishDecision — concurrency (finding 4)', () => {
  it('two concurrent decisions for the same id → exactly ONE publish, the other rejects DECISION_IN_FLIGHT', async () => {
    const { consumer, bridge } = buildConsumer();
    const req = await openOneRequest(consumer, 'panel-a');
    expect(consumer.listPending().length).toBe(1);

    // Gate A's publish so both calls are genuinely in flight at once.
    let releaseGate;
    bridge._gate = new Promise((resolve) => { releaseGate = resolve; });

    const pA = consumer.signAndPublishDecision({ requestId: req.id, outcome: 'approve' });
    const pB = consumer.signAndPublishDecision({ requestId: req.id, outcome: 'reject' });

    // A claimed the request synchronously (before its first await), so B is
    // already rejected while A is still blocked on the gate — assert B's reason
    // BEFORE opening the gate to prove the claim is what stopped the second sign.
    await expect(pB).rejects.toMatchObject({ code: 'DECISION_IN_FLIGHT' });
    // Nothing published yet: A is still parked on the gate.
    expect(decisionsPublished(bridge).length).toBe(0);

    // Let A complete.
    releaseGate();
    const signedA = await pA;
    expect(signedA.kind).toBe(31403);

    // Exactly one signed 31403 hit the wire.
    expect(decisionsPublished(bridge).length).toBe(1);
    expect(decisionsPublished(bridge)[0].kind).toBe(31403);

    // The request is now decided + no longer pending, and not stuck in-flight.
    expect(consumer.isDecided(req.id)).toBe(true);
    expect(consumer.listPending().length).toBe(0);
  });

  it('a second decision AFTER the first succeeds is rejected ALREADY_DECIDED (not re-signed)', async () => {
    const { consumer, bridge } = buildConsumer();
    const req = await openOneRequest(consumer, 'panel-b');

    const first = await consumer.signAndPublishDecision({ requestId: req.id, outcome: 'approve' });
    expect(first.kind).toBe(31403);
    expect(decisionsPublished(bridge).length).toBe(1);

    await expect(consumer.signAndPublishDecision({ requestId: req.id, outcome: 'reject' }))
      .rejects.toMatchObject({ code: 'ALREADY_DECIDED' });

    // No second publish.
    expect(decisionsPublished(bridge).length).toBe(1);
  });

  it('publish FAILURE restores pending so a retry succeeds (no lost request, no double-sign)', async () => {
    const { consumer, bridge } = buildConsumer();
    const req = await openOneRequest(consumer, 'panel-c');
    expect(consumer.listPending().length).toBe(1);

    // First publish attempt fails.
    bridge._failNext = true;
    await expect(consumer.signAndPublishDecision({ requestId: req.id, outcome: 'approve' }))
      .rejects.toThrow('relay publish failed');

    // Pending state restored: request is still open, not decided, nothing published.
    expect(consumer.listPending().length).toBe(1);
    expect(consumer.getPending(req.id)).toBeTruthy();
    expect(consumer.isDecided(req.id)).toBe(false);
    expect(decisionsPublished(bridge).length).toBe(0);

    // Retry now succeeds and signs exactly one decision.
    const retried = await consumer.signAndPublishDecision({ requestId: req.id, outcome: 'approve' });
    expect(retried.kind).toBe(31403);
    expect(decisionsPublished(bridge).length).toBe(1);
    expect(consumer.isDecided(req.id)).toBe(true);
    expect(consumer.listPending().length).toBe(0);
  });

  it('after a failed+restored attempt, a concurrent pair still yields exactly one publish', async () => {
    const { consumer, bridge } = buildConsumer();
    const req = await openOneRequest(consumer, 'panel-d');

    bridge._failNext = true;
    await expect(consumer.signAndPublishDecision({ requestId: req.id, outcome: 'approve' }))
      .rejects.toThrow('relay publish failed');
    expect(consumer.listPending().length).toBe(1);

    let releaseGate;
    bridge._gate = new Promise((resolve) => { releaseGate = resolve; });
    const pA = consumer.signAndPublishDecision({ requestId: req.id, outcome: 'approve' });
    const pB = consumer.signAndPublishDecision({ requestId: req.id, outcome: 'reject' });
    releaseGate();
    const results = await Promise.allSettled([pA, pB]);

    expect(results.filter((r) => r.status === 'fulfilled').length).toBe(1);
    expect(results.filter((r) => r.status === 'rejected').length).toBe(1);
    expect(results.find((r) => r.status === 'rejected').reason.code).toBe('DECISION_IN_FLIGHT');
    expect(decisionsPublished(bridge).length).toBe(1);
  });
});
