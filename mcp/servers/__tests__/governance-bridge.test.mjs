/**
 * governance-bridge MCP tools — EXP-AC-003 (FR3.4) and EXP-AC-007 (FR7.1).
 *
 *   node --test mcp/servers/__tests__/governance-bridge.test.mjs
 *
 * The server is imported, not spawned: it connects a stdio transport only when
 * it is the process entrypoint, so the tool table and handlers are exercisable
 * directly with a temporary pod root.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../..');

const PUBKEY = 'a'.repeat(64);
const POD_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'governance-bridge-pod-'));
const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'governance-bridge-state-'));

process.env.AGENTBOX_PUBKEY = PUBKEY;
process.env.AGENTBOX_POD_ROOT = POD_ROOT;
process.env.AGENTBOX_STATE_DIR = STATE_DIR;
process.env.AGENTBOX_MANIFEST_PATH = path.join(REPO, 'agentbox.toml');
// No forum configured: receipt posts queue rather than reaching the network.
delete process.env.FORUM_AUTH_API;

const { TOOLS, handleTool } = await import('../governance-bridge.js');

/** Read the single outbox event written for a case. */
function outboxEvent(caseId) {
  const dir = path.join(POD_ROOT, 'pods', fs.readdirSync(path.join(POD_ROOT, 'pods'))[0], 'events', 'outbox');
  return JSON.parse(fs.readFileSync(path.join(dir, `${caseId}.json`), 'utf8'));
}

function tagValue(event, name) {
  const found = (event.tags || []).find((t) => t[0] === name);
  return found ? found[1] : null;
}

test('the tool table advertises both augmentation-condition tools', () => {
  const names = TOOLS.map((t) => t.name);
  assert.ok(names.includes('governance_request_action'));
  assert.ok(names.includes('governance_manual_continue'));

  const request = TOOLS.find((t) => t.name === 'governance_request_action');
  assert.ok(request.inputSchema.properties.task_properties, 'task_properties is accepted');
  assert.ok(request.inputSchema.properties.action_class, 'action_class is accepted');
  assert.deepEqual(
    request.inputSchema.properties.task_properties.properties.reversibility.enum,
    ['reversible', 'compensable', 'irreversible'],
  );

  const manual = TOOLS.find((t) => t.name === 'governance_manual_continue');
  assert.deepEqual(manual.inputSchema.required, ['case_id', 'executed_by', 'evidence']);
});

test('EXP-AC-003: a zero-tolerance action class emits tp-reversibility=irreversible', async () => {
  const result = await handleTool('governance_request_action', {
    panel_id: 'panel-kg',
    case_id: 'case-tp-1',
    title: 'Load axioms',
    description: 'Direct axiom load into the shared ontology',
    action_class: 'ontology_axiom_load', // zero-tolerance in agentbox.toml
  });
  assert.equal(result.published, true);
  assert.equal(result.task_properties.reversibility, 'irreversible');

  const event = outboxEvent('case-tp-1');
  assert.equal(tagValue(event, 'tp-reversibility'), 'irreversible');
  assert.equal(tagValue(event, 'tp-verifiability'), 'opaque');
  assert.equal(tagValue(event, 'tp-stakes'), 'critical');
  assert.deepEqual(JSON.parse(event.content).task_properties, {
    verifiability: 'opaque', reversibility: 'irreversible', stakes: 'critical',
  });
});

test('a recoverable action class emits compensable', async () => {
  await handleTool('governance_request_action', {
    panel_id: 'panel-mem', case_id: 'case-tp-2',
    title: 'Search memory', description: 'read-only recall',
    action_class: 'memory_read',
  });
  const event = outboxEvent('case-tp-2');
  assert.equal(tagValue(event, 'tp-reversibility'), 'compensable');
  assert.equal(tagValue(event, 'tp-stakes'), 'bounded');
});

test('an UNDECLARED action class still emits all three tags, at the tightest reversibility', async () => {
  await handleTool('governance_request_action', {
    panel_id: 'panel-x', case_id: 'case-tp-3',
    title: 'Something new', description: 'no action_class supplied',
  });
  const event = outboxEvent('case-tp-3');
  assert.equal(tagValue(event, 'tp-reversibility'), 'irreversible');
  assert.equal(tagValue(event, 'tp-verifiability'), 'partial');
  assert.equal(tagValue(event, 'tp-stakes'), 'significant');
});

test('COUNTER-EXAMPLE: a caller cannot loosen the operator triple', async () => {
  const result = await handleTool('governance_request_action', {
    panel_id: 'panel-kg', case_id: 'case-tp-4',
    title: 'Load axioms', description: 'trying to self-declare a low tier',
    action_class: 'ontology_axiom_load',
    task_properties: { verifiability: 'inspectable', reversibility: 'reversible', stakes: 'bounded' },
  });
  assert.deepEqual(result.task_properties, {
    verifiability: 'opaque', reversibility: 'irreversible', stakes: 'critical',
  });
  assert.equal(tagValue(outboxEvent('case-tp-4'), 'tp-stakes'), 'critical');
});

test('a caller CAN tighten the operator triple', async () => {
  const result = await handleTool('governance_request_action', {
    panel_id: 'panel-mem', case_id: 'case-tp-5',
    title: 'Search memory', description: 'this one touches something sensitive',
    action_class: 'memory_read',
    task_properties: { stakes: 'critical' },
  });
  assert.equal(result.task_properties.stakes, 'critical');
});

test('EXP-AC-007: manual continuation refuses a case with no approval', async () => {
  const result = await handleTool('governance_manual_continue', {
    case_id: 'never-approved',
    executed_by: 'did:nostr:' + 'f'.repeat(64),
    evidence: 'ran it by hand',
  });
  assert.equal(result.error, 'no-approved-receipt');
});

test('EXP-AC-007: manual continuation refuses an agent executor', async () => {
  const result = await handleTool('governance_manual_continue', {
    case_id: 'never-approved',
    executed_by: `did:nostr:${PUBKEY}`, // this server's own identity
    evidence: 'ran it by hand',
  });
  assert.equal(result.error, 'executor-not-human');
});

test('EXP-AC-007: manual continuation validates the executor shape before anything else', async () => {
  const result = await handleTool('governance_manual_continue', {
    case_id: 'never-approved', executed_by: 'npub1nothex', evidence: 'ran it',
  });
  assert.equal(result.error, 'invalid-executed_by');
});

test('EXP-AC-007: an approved case is continued, bound and evidenced', async () => {
  const { ApplicationReceiptStore } = require('../../../management-api/lib/governance-application-receipts');
  const { operationDigest } = require('../../../management-api/lib/governance-correlation');

  // Seed the local approval the operator is about to continue by hand. This is
  // exactly what the authority gate writes when a 31403 approves an action.
  const operation = { kind: 'manual-op', target: 'kg' };
  const store = new ApplicationReceiptStore(path.join(STATE_DIR, 'governance-applications'));
  store.begin({
    released: true, outcome: 'approve',
    request_event_id: 'c'.repeat(64), response_event_id: 'd'.repeat(64),
    operation_sha256: operationDigest(operation),
  }, operation, { case_id: 'case-manual-1' });

  const human = 'did:nostr:' + 'e'.repeat(64);
  const result = await handleTool('governance_manual_continue', {
    case_id: 'case-manual-1', executed_by: human,
    evidence: 'applied the write-back manually while the relay was down',
  });

  assert.equal(result.ok, true);
  assert.equal(result.stage, 'applied-manually');
  assert.equal(result.executed_by, human);
  assert.equal(result.receipt.acknowledgement.manual, true);
  assert.match(result.activity_urn, /^urn:agentbox:activity:e{64}:sha256-12-[0-9a-f]{12}$/);
  // The forum is unconfigured in this environment, so the receipt is QUEUED —
  // recorded locally, never lost, never claimed as posted.
  assert.equal(result.posted, false);
  assert.equal(result.queued, true);
});

test.after(() => {
  fs.rmSync(POD_ROOT, { recursive: true, force: true });
  fs.rmSync(STATE_DIR, { recursive: true, force: true });
});
