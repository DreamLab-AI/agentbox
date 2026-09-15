/**
 * broker-bridge receipt-ladder tests — PRD-augmentation-conditions FR4.2,
 * EXP-AC-004 ("agentbox `broker-bridge` posts the receipt after
 * `ApplicationReceiptStore.begin` and `finish`; failure to post is journalled,
 * never silent").
 *
 * The counter-example these pin down is the PRD's own: "a decision projected
 * `projection-committed` forever while the mutation failed, with no receipt".
 *
 *   node --test management-api/tests/broker-bridge-receipts.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const brokerBridgeRoutes = require('../routes/broker-bridge');
const authority = require('../lib/authority');
const { ApplicationReceiptStore } = require('../lib/governance-application-receipts');

const NOOP_LOGGER = { info() {}, warn() {}, error() {}, debug() {} };
const PK = 'a'.repeat(64);
const RESPONSE_ID = 'd'.repeat(64);

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

function signedResponse(requestId, outcome) {
  return {
    id: RESPONSE_ID,
    kind: authority.ACTION_RESPONSE_KIND,
    pubkey: 'b'.repeat(64),
    content: JSON.stringify({ outcome, reason: 'human decided' }),
    tags: [['e', requestId], ['p', PK]],
    sig: 'deadbeef',
  };
}

function buildGate(outcome = 'approve') {
  return authority.buildAuthorityGate(AUTH_MANIFEST, {
    logger: NOOP_LOGGER,
    publishActionRequest: async (unsigned) => ({ ...unsigned, id: 'c'.repeat(64), sig: 'sig' }),
    awaitDecision: async (req) => (outcome === null ? null : signedResponse(req.id, outcome)),
    verifyEvent: () => true,
  });
}

/** A receipt-publisher double recording every mirrored stage. */
function publisherDouble(opts = {}) {
  const posts = [];
  return {
    posts,
    async post(receipt) {
      posts.push(receipt);
      if (opts.throws) throw new Error('publisher exploded');
      return opts.result || { ok: true, queued: false, status: 202 };
    },
  };
}

async function buildApp(upstreamBody, { publisher, gate = buildGate('approve'), upstreamThrows = false } = {}) {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/api/enrichment-proposals/')) {
      if (upstreamThrows) throw new Error('visionclaw unreachable');
      return {
        ok: true, status: 200, statusText: 'OK',
        async json() { return upstreamBody; },
        async text() { return JSON.stringify(upstreamBody); },
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  const app = Fastify();
  const receiptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'broker-receipt-ladder-'));
  await app.register(brokerBridgeRoutes, {
    logger: NOOP_LOGGER,
    authorityGate: gate,
    applicationReceipts: new ApplicationReceiptStore(receiptDir),
    receiptPublisher: publisher,
  });
  app.addHook('onClose', async () => fs.rmSync(receiptDir, { recursive: true, force: true }));
  await app.ready();
  app.__restoreFetch = () => { global.fetch = originalFetch; };
  return app;
}

const COMMITTED = {
  success: true, decision: 'approve', attributed: true,
  writeback_triggered: true, writeback_committed: true,
  activity_urn: 'urn:visionclaw:execution:sha256-12-abcabcabcabc',
};

test('FR4.2: an applied decision posts consumer-received then applied, in ladder order', async () => {
  const publisher = publisherDouble();
  const app = await buildApp(COMMITTED, { publisher });
  try {
    const res = await app.inject({
      method: 'POST', url: '/api/broker/bridge/cases/case-r1/decide',
      headers: { 'content-type': 'application/json', 'x-agent-pubkey': PK },
      payload: { decision: 'approve', note: 'ship it' },
    });
    assert.equal(res.statusCode, 200);

    assert.equal(publisher.posts.length, 2);
    assert.equal(publisher.posts[0].stage, 'consumer-received');
    assert.equal(publisher.posts[0].response_event_id, RESPONSE_ID);
    assert.equal(publisher.posts[1].stage, 'applied');
    assert.equal(publisher.posts[1].response_event_id, RESPONSE_ID);
    assert.equal(publisher.posts[1].acknowledgement.writeback_committed, true);
    assert.equal(publisher.posts[1].acknowledgement.case_id, 'case-r1');
  } finally {
    app.__restoreFetch();
    await app.close();
  }
});

test('FR4.2: a decision whose write-back did not commit posts not-applied', async () => {
  const publisher = publisherDouble();
  const app = await buildApp(
    { ...COMMITTED, writeback_triggered: true, writeback_committed: false },
    { publisher },
  );
  try {
    const res = await app.inject({
      method: 'POST', url: '/api/broker/bridge/cases/case-r2/decide',
      headers: { 'content-type': 'application/json', 'x-agent-pubkey': PK },
      payload: { decision: 'approve' },
    });
    // The route still reports the failure honestly upstream …
    assert.equal(res.statusCode, 502);
    // … and the human still learns the outcome.
    assert.deepEqual(publisher.posts.map(p => p.stage), ['consumer-received', 'not-applied']);
    assert.equal(publisher.posts[1].acknowledgement.writeback_committed, false);
  } finally {
    app.__restoreFetch();
    await app.close();
  }
});

test('an UNKNOWN outcome posts no terminal receipt — absence is not fabricated as not-applied', async () => {
  const publisher = publisherDouble();
  const app = await buildApp(COMMITTED, { publisher, upstreamThrows: true });
  try {
    const res = await app.inject({
      method: 'POST', url: '/api/broker/bridge/cases/case-r3/decide',
      headers: { 'content-type': 'application/json', 'x-agent-pubkey': PK },
      payload: { decision: 'approve' },
    });
    assert.equal(res.statusCode, 502);
    assert.deepEqual(publisher.posts.map(p => p.stage), ['consumer-received']);
  } finally {
    app.__restoreFetch();
    await app.close();
  }
});

test('a recoverable decision mirrors nothing — there is no signed approval to report on', async () => {
  const publisher = publisherDouble();
  const app = await buildApp(
    { success: true, decision: 'reject', attributed: true, writeback_triggered: false, writeback_committed: false },
    { publisher },
  );
  try {
    const res = await app.inject({
      method: 'POST', url: '/api/broker/bridge/cases/case-r4/decide',
      headers: { 'content-type': 'application/json', 'x-agent-pubkey': PK },
      payload: { decision: 'reject' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(publisher.posts.length, 0);
  } finally {
    app.__restoreFetch();
    await app.close();
  }
});

test('a publisher that throws never fails the decision — the mutation already happened', async () => {
  const publisher = publisherDouble({ throws: true });
  const app = await buildApp(COMMITTED, { publisher });
  try {
    const res = await app.inject({
      method: 'POST', url: '/api/broker/bridge/cases/case-r5/decide',
      headers: { 'content-type': 'application/json', 'x-agent-pubkey': PK },
      payload: { decision: 'approve' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().writeback_committed, true);
    assert.equal(publisher.posts.length, 2); // both attempted
  } finally {
    app.__restoreFetch();
    await app.close();
  }
});

test('a queued (unreachable-forum) receipt still leaves the decision successful', async () => {
  const publisher = publisherDouble({ result: { ok: false, queued: true, error: 'ECONNREFUSED' } });
  const app = await buildApp(COMMITTED, { publisher });
  try {
    const res = await app.inject({
      method: 'POST', url: '/api/broker/bridge/cases/case-r6/decide',
      headers: { 'content-type': 'application/json', 'x-agent-pubkey': PK },
      payload: { decision: 'approve' },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(publisher.posts.map(p => p.stage), ['consumer-received', 'applied']);
  } finally {
    app.__restoreFetch();
    await app.close();
  }
});
