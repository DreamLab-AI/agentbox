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

const NOOP_LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

// A structurally-valid 64-hex pubkey for attribution.
const PK = 'a'.repeat(64);

/**
 * Build a fastify app with the broker-bridge plugin registered, and a `fetch`
 * stub that returns `upstreamBody` for the enrichment-proposals decide call.
 * Records the parsed decide-request body on `captured`.
 */
async function buildApp(upstreamBody, captured) {
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
  await app.register(brokerBridgeRoutes, { logger: NOOP_LOGGER });
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
