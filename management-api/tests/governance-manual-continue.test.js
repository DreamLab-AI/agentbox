/**
 * governance_manual_continue — PRD-augmentation-conditions FR7.1, EXP-AC-007.
 *
 * "An operator can execute an approved action by hand during an outage and
 * leave a signed, bound receipt."
 *
 * The mesh being down is exactly when meaningful human control (condition C2)
 * is most at risk: without a continuation path the operator either waits, or
 * acts with no record at all. This records the act — bound to the approved
 * operation digest, attributed to a HUMAN did:nostr, never to an agent.
 *
 *   node --test management-api/tests/governance-manual-continue.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ApplicationReceiptStore } = require('../lib/governance-application-receipts');
const { operationDigest } = require('../lib/governance-correlation');
const { manualContinue, isHumanDid, MANUAL_STAGE } = require('../lib/governance-manual-continue');

const OPERATION = { kind: 'broker-enrichment-decision', case_id: 'case-m1', payload: { outcome: 'approve' } };
const RESPONSE_ID = 'd'.repeat(64);
const REQUEST_ID = 'c'.repeat(64);
const HUMAN = 'did:nostr:' + 'f'.repeat(64);
const AGENT = 'did:nostr:' + 'a'.repeat(64);

const approvedGate = (over = {}) => ({
  released: true, decision: 'allow', outcome: 'approve',
  request_event_id: REQUEST_ID, response_event_id: RESPONSE_ID,
  operation_sha256: operationDigest(OPERATION),
  ...over,
});

function setup(t, { approve = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-continue-'));
  const provDir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-prov-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(provDir, { recursive: true, force: true }); });
  const store = new ApplicationReceiptStore(dir);
  if (approve) store.begin(approvedGate(), OPERATION, { case_id: 'case-m1' });
  return { dir, provDir, store };
}

/** A receipt-publisher double. */
function publisherDouble(result = { ok: true, queued: false, status: 202 }) {
  const posts = [];
  return { posts, async post(r) { posts.push(r); return result; } };
}

function agentRegistry(dids = [AGENT]) {
  return { isAgent: (did) => dids.includes(did) };
}

test('isHumanDid accepts only a well-formed did:nostr', () => {
  assert.equal(isHumanDid(HUMAN), true);
  assert.equal(isHumanDid('did:nostr:' + 'F'.repeat(64)), false); // lower-case hex only
  assert.equal(isHumanDid('did:nostr:short'), false);
  assert.equal(isHumanDid('npub1xyz'), false);
  assert.equal(isHumanDid(''), false);
  assert.equal(isHumanDid(null), false);
});

test('the happy path writes applied-manually, mints PROV-O and posts the receipt', async (t) => {
  const { store, provDir } = setup(t);
  const publisher = publisherDouble();
  const result = await manualContinue({
    case_id: 'case-m1',
    executed_by: HUMAN,
    evidence: 'ran the enrichment write-back by hand; oxigraph tx 44f1',
  }, {
    receipts: store, publisher, provenanceDir: provDir,
    agentRegistry: agentRegistry(), agentDid: AGENT,
  });

  assert.equal(result.ok, true);
  assert.equal(result.stage, MANUAL_STAGE);
  assert.equal(MANUAL_STAGE, 'applied-manually');
  assert.equal(result.response_event_id, RESPONSE_ID);
  assert.equal(result.operation_sha256, operationDigest(OPERATION));
  assert.equal(result.executed_by, HUMAN);

  // The local receipt is the binding record.
  assert.equal(result.receipt.stage, 'applied-manually');
  assert.deepEqual(result.receipt.acknowledgement, {
    manual: true, executed_by: HUMAN, evidence: 'ran the enrichment write-back by hand; oxigraph tx 44f1',
  });

  // PROV-O: the activity's agent is the HUMAN, not the container.
  assert.match(result.activity_urn, /^urn:agentbox:activity:[0-9a-f]{64}:sha256-12-[0-9a-f]{12}$/);
  assert.match(result.receipt_urn, /^urn:agentbox:receipt:/);
  const provFile = path.join(provDir, 'case-m1.json');
  assert.ok(fs.existsSync(provFile), 'a provenance record is written');
  const prov = JSON.parse(fs.readFileSync(provFile, 'utf8'));
  assert.equal(prov['prov:wasAssociatedWith'], HUMAN);
  assert.equal(prov['@type'], 'prov:Activity');
  assert.equal(prov.executed_by, HUMAN);
  assert.equal(prov.stage, 'applied-manually');
  assert.equal(prov.case_id, 'case-m1');
  assert.equal(prov.response_event_id, RESPONSE_ID);
  assert.equal(prov.operation_sha256, operationDigest(OPERATION));

  // The forum learns about it under the human's name.
  assert.equal(publisher.posts.length, 1);
  assert.deepEqual(publisher.posts[0], {
    response_event_id: RESPONSE_ID,
    stage: 'applied-manually',
    acknowledgement: { manual: true, executed_by: HUMAN, evidence: 'ran the enrichment write-back by hand; oxigraph tx 44f1' },
    executed_by: HUMAN,
    evidence: 'ran the enrichment write-back by hand; oxigraph tx 44f1',
  });
});

test('COUNTER-EXAMPLE: a case with no local approval is refused', async (t) => {
  const { store } = setup(t, { approve: false });
  const result = await manualContinue(
    { case_id: 'case-m1', executed_by: HUMAN, evidence: 'did it' },
    { receipts: store, publisher: publisherDouble(), provenanceDir: os.tmpdir(), agentRegistry: agentRegistry() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, 'no-approved-receipt');
  assert.match(result.message, /case-m1/);
});

test('COUNTER-EXAMPLE: a REJECTED case can never be continued manually', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-reject-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new ApplicationReceiptStore(dir);
  // A gate that denies never produces a claim at all, so the only way a stored
  // receipt could carry a non-approve outcome is corruption — refuse it anyway.
  store.begin(approvedGate({ outcome: 'reject' }), OPERATION, { case_id: 'case-m1' });
  const result = await manualContinue(
    { case_id: 'case-m1', executed_by: HUMAN, evidence: 'did it' },
    { receipts: store, publisher: publisherDouble(), provenanceDir: dir, agentRegistry: agentRegistry() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, 'not-approved');
});

test('COUNTER-EXAMPLE: executed_by being an AGENT DID is refused', async (t) => {
  const { store, provDir } = setup(t);
  const result = await manualContinue(
    { case_id: 'case-m1', executed_by: AGENT, evidence: 'did it' },
    { receipts: store, publisher: publisherDouble(), provenanceDir: provDir, agentRegistry: agentRegistry([AGENT]) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, 'executor-not-human');
});

test("COUNTER-EXAMPLE: executed_by being the container's OWN did is refused", async (t) => {
  const { store, provDir } = setup(t);
  const result = await manualContinue(
    { case_id: 'case-m1', executed_by: AGENT, evidence: 'did it' },
    { receipts: store, publisher: publisherDouble(), provenanceDir: provDir, agentRegistry: { isAgent: () => false }, agentDid: AGENT },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, 'executor-not-human');
});

test('a malformed executed_by is refused before anything is written', async (t) => {
  const { store, provDir } = setup(t);
  for (const bad of ['npub1abc', 'did:nostr:zzz', '', undefined]) {
    const result = await manualContinue(
      { case_id: 'case-m1', executed_by: bad, evidence: 'did it' },
      { receipts: store, publisher: publisherDouble(), provenanceDir: provDir, agentRegistry: agentRegistry() },
    );
    assert.equal(result.ok, false);
    assert.equal(result.error, 'invalid-executed_by');
  }
  assert.equal(fs.readdirSync(provDir).length, 0);
});

test('evidence is mandatory — an unevidenced manual act is not a receipt', async (t) => {
  const { store, provDir } = setup(t);
  const result = await manualContinue(
    { case_id: 'case-m1', executed_by: HUMAN },
    { receipts: store, publisher: publisherDouble(), provenanceDir: provDir, agentRegistry: agentRegistry() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, 'missing-evidence');
});

test('an operation digest that does not match the approval is refused', async (t) => {
  const { store, provDir } = setup(t);
  const result = await manualContinue(
    { case_id: 'case-m1', executed_by: HUMAN, evidence: 'did it', operation: { kind: 'something-else' } },
    { receipts: store, publisher: publisherDouble(), provenanceDir: provDir, agentRegistry: agentRegistry() },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, 'operation-digest-mismatch');
});

test('a matching supplied operation is accepted', async (t) => {
  const { store, provDir } = setup(t);
  const result = await manualContinue(
    { case_id: 'case-m1', executed_by: HUMAN, evidence: 'did it', operation: OPERATION },
    { receipts: store, publisher: publisherDouble(), provenanceDir: provDir, agentRegistry: agentRegistry() },
  );
  assert.equal(result.ok, true);
});

test('a case already applied cannot be continued manually a second time', async (t) => {
  const { store, provDir } = setup(t);
  const first = await manualContinue(
    { case_id: 'case-m1', executed_by: HUMAN, evidence: 'did it' },
    { receipts: store, publisher: publisherDouble(), provenanceDir: provDir, agentRegistry: agentRegistry() },
  );
  assert.equal(first.ok, true);
  const second = await manualContinue(
    { case_id: 'case-m1', executed_by: HUMAN, evidence: 'did it again' },
    { receipts: store, publisher: publisherDouble(), provenanceDir: provDir, agentRegistry: agentRegistry() },
  );
  assert.equal(second.ok, false);
  assert.equal(second.error, 'already-resolved');
  assert.equal(second.stage_held, 'applied-manually');
});

test('EXP-AC-007: an unreachable forum queues the receipt — the act is never lost', async (t) => {
  const { store, provDir } = setup(t);
  const publisher = publisherDouble({ ok: false, queued: true, error: 'ECONNREFUSED' });
  const result = await manualContinue(
    { case_id: 'case-m1', executed_by: HUMAN, evidence: 'did it' },
    { receipts: store, publisher, provenanceDir: provDir, agentRegistry: agentRegistry() },
  );
  // The local receipt and provenance are authoritative; the forum post is a mirror.
  assert.equal(result.ok, true);
  assert.equal(result.posted, false);
  assert.equal(result.queued, true);
  assert.equal(result.receipt.stage, 'applied-manually');
  assert.ok(fs.existsSync(path.join(provDir, 'case-m1.json')));
});
