/**
 * Producer-side contract test: everything agentbox BUILDS for the governance
 * kinds 31400-31405 is checked against the forum's golden files
 * (contracts/governance/v1) through lib/governance-contract.
 *
 * Checked per event: same kind; the kind's required tag names; the content
 * field names the contract requires, with the golden file's JSON types; enum
 * values drawn from the manifest; rule constants respected.
 *
 * A producer that genuinely violates the contract is NOT bent into passing. Its
 * case is registered as a `KNOWN-VIOLATION` todo: it still runs and reports the
 * violation, and it stays out of the pass/fail count until the producer is fixed.
 *
 * Run: node --test tests/sovereign/governance-producer-contract.node-test.mjs
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
const REPO = path.resolve(HERE, '../..');

const PUBKEY = 'a'.repeat(64);
const POD_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'governance-producer-pod-'));
const STATE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'governance-producer-state-'));
process.env.AGENTBOX_PUBKEY = PUBKEY;
process.env.AGENTBOX_POD_ROOT = POD_ROOT;
process.env.AGENTBOX_STATE_DIR = STATE_DIR;
process.env.AGENTBOX_MANIFEST_PATH = path.join(REPO, 'agentbox.toml');
delete process.env.FORUM_AUTH_API;

const contract = require('../../management-api/lib/governance-contract');
const acs = require('../../management-api/lib/agent-control-surface');
const { buildActionResponse } = require('../../management-api/lib/authority-consumer');
const taskProperties = require('../../management-api/lib/task-properties');
const { buildElevationPublisher } = require('../../management-api/lib/elevation-publisher');
const { buildAuthorityGate } = require('../../management-api/lib/authority');
const uris = require('../../management-api/lib/uris');
const { handleTool } = await import('../../mcp/servers/governance-bridge.js');

const { ENUMS, MIN_HUMAN_RATIONALE_CHARS } = contract;

// ── the checker ──────────────────────────────────────────────────────────────

const jsonType = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const tagNames = (event) => event.tags.map((t) => t[0]);
const tagValue = (event, name) => (event.tags.find((t) => t[0] === name) || [])[1];
const oneOf = (value, allowed, what) =>
  assert.ok(allowed.includes(value), `${what} ${JSON.stringify(value)} is not in the contract: [${allowed.join(', ')}]`);

/** Collect every contract violation of `event` as a list of messages. */
function violations(event, kind) {
  const found = [];
  const check = (fn) => { try { fn(); } catch (err) { found.push(err.message); } };
  const descriptor = contract.BY_KIND[kind];
  const golden = contract.loadExample(kind);

  check(() => assert.equal(event.kind, kind, 'kind'));
  for (const name of descriptor.required_tags) {
    check(() => assert.ok(tagNames(event).includes(name), `required tag "${name}" is missing`));
  }
  check(() => assert.ok(tagValue(event, 'd'), '`d` tag must be non-empty'));

  // Content: parse, require the contract's field names, compare JSON types with
  // the golden file wherever the producer sets a field the golden also has.
  let content = null;
  if (descriptor.content_required.length || golden.content) {
    check(() => { content = JSON.parse(event.content); });
  } else {
    check(() => assert.equal(event.content, golden.content, 'content must be empty for this kind'));
  }
  const goldenContent = golden.content ? JSON.parse(golden.content) : {};
  if (content && typeof content === 'object') {
    for (const field of descriptor.content_required) {
      check(() => assert.ok(field in content, `required content field "${field}" is missing`));
    }
    for (const [field, value] of Object.entries(content)) {
      if (!(field in goldenContent) || value === null) continue;
      check(() => assert.equal(jsonType(value), jsonType(goldenContent[field]),
        `content field "${field}" has type ${jsonType(value)}, the contract has ${jsonType(goldenContent[field])}`));
    }
  }

  // Enum values drawn from the manifest.
  const tagEnums = {
    priority: ENUMS.action_priorities,
    'risk-tier': ENUMS.risk_tiers,
    category: ENUMS.case_categories,
    'subject-kind': ENUMS.subject_kinds,
    'tp-verifiability': ENUMS.verifiability,
    'tp-reversibility': ENUMS.reversibility,
    'tp-stakes': ENUMS.stakes,
  };
  for (const [name, allowed] of Object.entries(tagEnums)) {
    const value = tagValue(event, name);
    if (value !== undefined) check(() => oneOf(value, allowed, `tag "${name}"`));
  }
  if (content && kind === contract.PANEL_DEFINITION) {
    check(() => oneOf(content.schema, ENUMS.panel_schemas, 'schema'));
    check(() => oneOf(content.layout, ENUMS.layout_hints, 'layout'));
    for (const f of content.fields || []) check(() => oneOf(f.field_type, ENUMS.field_types, 'field_type'));
    for (const a of content.actions || []) check(() => oneOf(a.style, ENUMS.action_styles, 'action style'));
    for (const c of content.capabilities || []) check(() => oneOf(c, ENUMS.panel_capabilities, 'capability'));
  }
  if (content && kind === contract.ACTION_RESPONSE) {
    check(() => oneOf(content.action, ENUMS.decision_actions, 'content.action'));
    const tier = tagValue(event, 'risk-tier');
    if (RULES_TIERS.includes(tier) && RULES_ACTIONS.includes(content.action)) {
      check(() => assert.ok(
        typeof content.reasoning === 'string' && content.reasoning.trim().length >= MIN_HUMAN_RATIONALE_CHARS,
        `rationale must be at least ${MIN_HUMAN_RATIONALE_CHARS} characters at tier ${tier}`));
    }
  }
  return found;
}
const RULES_TIERS = contract.RULES.rationale_required_tiers;
const RULES_ACTIONS = contract.RULES.rationale_required_actions;

function conforms(name, build, kind) {
  test(name, async () => {
    assert.deepEqual(violations(await build(), kind), []);
  });
}

/** A producer that violates the contract today: runs, reports, does not fail the suite. */
function knownViolation(name, build, kind, expectedFragments) {
  test(`KNOWN-VIOLATION ${name}`, { todo: 'producer violates the governance contract (reported, not bent)' }, async () => {
    const found = violations(await build(), kind);
    for (const fragment of expectedFragments) {
      assert.ok(found.some((m) => m.includes(fragment)), `expected a violation mentioning "${fragment}"; got ${JSON.stringify(found)}`);
    }
    assert.deepEqual(found, [], `contract violations: ${found.join(' | ')}`);
  });
}

// ── agent-control-surface builders (the reference producer) ──────────────────

conforms('31400 PanelDefinition from buildPanelDefinition', () => acs.buildPanelDefinition({
  panelId: 'panel-1', title: 'Panel', description: 'A panel', schema: 'action-inbox', layout: 'inbox-table',
  fields: [{ name: 'term', fieldType: 'string', label: 'Term' }],
  actions: [{ id: 'approve', label: 'Approve', style: 'primary' }],
  capabilities: ['filter'],
}), contract.PANEL_DEFINITION);

conforms('31401 PanelState from buildPanelState', () => acs.buildPanelState({
  panelId: 'panel-1', state: { open_cases: 2 },
}), contract.PANEL_STATE);

conforms('31402 ActionRequest from buildActionRequest with contract enum values', () => acs.buildActionRequest({
  panelId: 'urn:agentbox:authority:grant-revoke:1', priority: 'critical',
  category: 'policy_exception', subjectKind: 'opaque', subjectId: 'grant-revoke', title: 'Authorise action',
  reasoning: 'Zero-tolerance action', fields: { action_class: 'grant-revoke', operation_sha256: 'ab'.repeat(32) },
  extraTags: taskProperties.toTags({ verifiability: 'opaque', reversibility: 'irreversible', stakes: 'critical' }),
}), contract.ACTION_REQUEST);

conforms('31404 PanelUpdate from buildPanelUpdate', () => acs.buildPanelUpdate({
  panelId: 'panel-1', diff: { open_cases: 1 },
}), contract.PANEL_UPDATE);

conforms('31405 PanelRetired from buildPanelRetired', () => acs.buildPanelRetired({ panelId: 'panel-1' }), contract.PANEL_RETIRED);

// The real producers, run for real with the publish step captured. These capture
// what elevation-publisher and the authority gate actually put on the wire, not
// a hand-copied argument list.
async function captureElevation() {
  let captured = null;
  const pub = buildElevationPublisher({ sovereign_mesh: { nostr_bridge: true } }, {
    env: { NOSTR_RELAYS: 'wss://relay.example', AGENTBOX_STACK: 'sovereign' },
    bridge: {}, signer: {},
    publishPanelEvent: async (_b, _s, unsigned) => { captured = unsigned; return { ...unsigned, id: 'f'.repeat(64) }; },
  });
  const proposal_urn = uris.mint({ kind: 'thing', pubkey: PUBKEY, localId: 'proposal-0123456789ab' });
  const res = await pub.publish({
    proposal_urn, target_urn: 'urn:visionclaw:concept:x',
    candidate: { term: 'X', domain: 'd', definition: 'x', score: 0.9, reasons: ['named'] },
  });
  assert.equal(res.published, true);
  return captured;
}

async function captureAuthorityGate() {
  let captured = null;
  const gate = buildAuthorityGate({ skills: { authority: { enabled: true, default: 'escalation', classes: { payment_settlement: 'zero-tolerance' } } } }, {
    publishActionRequest: async (unsigned) => { captured = unsigned; return { ...unsigned, id: 'f'.repeat(64) }; },
    awaitDecision: async () => null,
    defaultTimeoutMs: 10,
  });
  await gate.guard({ actionClass: 'payment_settlement', operation: { kind: 'x', payload: { a: 1 } }, action: 'Revoke grant' });
  assert.ok(captured, 'the gate published its 31402');
  return captured;
}

knownViolation('31402 from elevation-publisher: category and subject-kind outside the contract enums',
  captureElevation, contract.ACTION_REQUEST, ['tag "category"', 'tag "subject-kind"']);

knownViolation('31402 from the authority gate (authority.js): category and subject-kind outside the contract enums',
  captureAuthorityGate, contract.ACTION_REQUEST, ['tag "category"', 'tag "subject-kind"']);

// Not run through its real caller: arguments copied from config/hooks/ontology-monitor.cjs (~l.223)
// and routes/voice-intent.js (~l.244), both of which call acs.buildActionRequest.
knownViolation('31402 shaped like the ontology-monitor hook call: category and subject-kind outside the contract enums',
  () => acs.buildActionRequest({
    panelId: 'ontology-update-1', category: 'ontology', subjectKind: 'ontology-class', subjectId: 'urn:ngm:class:x',
    title: 'Ontology update', priority: 'low', fields: { kind: 'class', summary: 's', label: 'x' },
  }), contract.ACTION_REQUEST, ['tag "category"', 'tag "subject-kind"']);

knownViolation('31402 shaped like the voice-intent route call: category and subject-kind outside the contract enums',
  () => acs.buildActionRequest({
    panelId: 'urn:agentbox:voice-intent:aaaa:1', priority: 'high', category: 'voice-intent', subjectKind: 'actor',
    subjectId: PUBKEY, title: 'Voice intent', fields: { intent_verb: 'go' },
  }), contract.ACTION_REQUEST, ['tag "category"', 'tag "subject-kind"']);

// ── authority-consumer: the 31403 agentbox signs for the operator ────────────

const longReasoning = 'The operation hash matches the request and the scope is limited to one grant.';

conforms('31403 ActionResponse (approve) from buildActionResponse', () => buildActionResponse({
  requestId: 'e'.repeat(64), panelId: 'urn:agentbox:authority:grant-revoke:1', caseId: 'case-1',
  requesterPubkey: PUBKEY, outcome: 'approve', reasoning: longReasoning,
}), contract.ACTION_RESPONSE);

conforms('31403 ActionResponse (reject) from buildActionResponse', () => buildActionResponse({
  requestId: 'e'.repeat(64), panelId: 'urn:agentbox:authority:grant-revoke:1', outcome: 'reject', reasoning: longReasoning,
}), contract.ACTION_RESPONSE);

knownViolation('31403 ActionResponse (defer): "defer" is not a contract decision action',
  () => buildActionResponse({
    requestId: 'e'.repeat(64), panelId: 'urn:agentbox:authority:grant-revoke:1', outcome: 'defer', reasoning: longReasoning,
  }), contract.ACTION_RESPONSE, ['content.action']);

test('31403 rationale rule: a short rationale at a consequential tier is flagged', () => {
  const event = buildActionResponse({ requestId: 'e'.repeat(64), panelId: 'p', outcome: 'approve', reasoning: 'ok' });
  event.tags.push(['risk-tier', 'high']); // synthetic: no agentbox producer stamps a risk-tier on a 31403, so this exercises the checker only
  assert.ok(violations(event, contract.ACTION_RESPONSE).some((m) => m.includes('rationale must be at least')));
});

// ── governance-bridge MCP server: unsigned events written to the pod outbox ──

function outboxEvent(file) {
  const pods = path.join(POD_ROOT, 'pods');
  const dir = path.join(pods, fs.readdirSync(pods)[0], 'events', 'outbox');
  return JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
}

test('governance-bridge request_action 31402 conforms to the tag contract', async () => {
  await handleTool('governance_request_action', {
    panel_id: 'panel-kg', case_id: 'case-gb-1', title: 'Load axioms', description: 'Direct axiom load',
  });
  const event = outboxEvent('case-gb-1.json');
  const found = violations(event, contract.ACTION_REQUEST);
  // Everything except the missing `fields` is conformant; that gap is the known violation below.
  assert.deepEqual(found.filter((m) => !m.includes('"fields"')), []);
});

knownViolation('governance-bridge 31402: content has no `fields` object',
  () => {
    return outboxEvent('case-gb-1.json');
  }, contract.ACTION_REQUEST, ['required content field "fields"']);

knownViolation('governance-bridge 31400: content has no `schema` or `layout`',
  async () => {
    await handleTool('governance_publish_panel', {
      panel_id: 'panel-gb', title: 'Panel', fields: [{ name: 'a', type: 'string' }], actions: [{ id: 'ok', label: 'OK' }],
    });
    return outboxEvent('panel-gb.json');
  }, contract.PANEL_DEFINITION, ['required content field "schema"', 'required content field "layout"']);

knownViolation('governance-bridge 31405: content is not empty',
  async () => {
    await handleTool('governance_retire_panel', { panel_id: 'panel-gb', reason: 'done' });
    return outboxEvent('panel-gb-retire.json');
  }, contract.PANEL_RETIRED, ['content must be empty']);
