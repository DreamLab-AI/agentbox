'use strict';

/**
 * Contract test suite — governance decision flow (end-to-end)
 *
 * Exercises the full Agent Control Surface Protocol lifecycle:
 *   1. Agent publishes PanelDefinition (kind 31400) via outbox
 *   2. Agent publishes ActionRequest  (kind 31402) via outbox
 *   3. Human responds with ActionResponse (kind 31403) via inbound path
 *   4. Orchestrator adapter dispatches the decision
 *   5. Provenance records are persisted
 *
 * The relay is fully mocked — no network, no WebSocket.  The test
 * exercises RelayConsumer's inbound routing and the orchestrator
 * adapter's handleGovernanceDecision in isolation.
 *
 * @see ADR-009  (relay-consumer bridge)
 * @see ADR-005  (orchestrator adapter slot)
 * @see relay-consumer.js  (governance event routing)
 * @see local-process-manager.js  (handleGovernanceDecision)
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

function expect(actual) {
  return {
    toBe(expected)        { assert.strictEqual(actual, expected); },
    toEqual(expected)     { assert.deepStrictEqual(actual, expected); },
    toBeDefined()         { assert.notStrictEqual(actual, undefined); },
    toBeUndefined()       { assert.strictEqual(actual, undefined); },
    toBeTruthy()          { assert.ok(actual); },
    toBeFalsy()           { assert.ok(!actual); },
    toBeNull()            { assert.strictEqual(actual, null); },
    toBeGreaterThan(n)    { assert.ok(actual > n); },
    toBeGreaterThanOrEqual(n) { assert.ok(actual >= n); },
    toContain(s)          { assert.ok(typeof actual === 'string' ? actual.includes(s) : Array.isArray(actual) && actual.includes(s)); },
    toMatch(re)           { assert.match(actual, re); },
    toThrow(msg)          { assert.throws(actual, msg ? { message: msg } : undefined); },
    toHaveLength(n)       { assert.strictEqual(actual.length, n); },
    toHaveProperty(k, v)  { assert.ok(k in actual); if (v !== undefined) assert.deepStrictEqual(actual[k], v); },
    not: {
      toBe(expected)      { assert.notStrictEqual(actual, expected); },
      toBeDefined()       { assert.strictEqual(actual, undefined); },
      toBeNull()          { assert.notStrictEqual(actual, null); },
      toContain(s)        { assert.ok(typeof actual === 'string' ? !actual.includes(s) : !(Array.isArray(actual) && actual.includes(s))); },
    },
  };
}

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const { LocalProcessManagerOrchestratorAdapter } =
  require('../../management-api/adapters/orchestrator/local-process-manager');
const { RelayConsumer } =
  require('../../mcp/nostr-bridge/relay-consumer');
const { kinds } = require('../../mcp/servers/nostr-bridge');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create an isolated temp directory for pod state. */
function makeTmpPodRoot() {
  const dir = path.join(os.tmpdir(), `agentbox-gov-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Clean up a temp directory tree. */
function rmTmpDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
}

/** Deterministic hex pubkey for test fixtures. */
const TEST_PUBKEY = 'a'.repeat(64);
const TEST_NPUB   = TEST_PUBKEY; // hex form — avoids bech32 dep

/** Deterministic event IDs. */
const PANEL_EVENT_ID   = '0001' + 'b'.repeat(60);
const REQUEST_EVENT_ID = '0002' + 'c'.repeat(60);
const RESPONSE_EVENT_ID = '0003' + 'd'.repeat(60);

const CASE_ID = 'case-governance-test-001';

/** Build a minimal Nostr-shaped event. */
function makeEvent({ id, kind, content, tags, pubkey }) {
  return {
    id:         id || crypto.randomBytes(32).toString('hex'),
    pubkey:     pubkey || TEST_PUBKEY,
    kind,
    content:    typeof content === 'string' ? content : JSON.stringify(content || {}),
    tags:       tags || [],
    created_at: Math.floor(Date.now() / 1000),
    sig:        'f'.repeat(128), // structural sig — tests inject verifyEvent=()=>true
  };
}

/**
 * Build a PanelDefinition event (kind 31400).
 * Written to outbox by an agent to define an interactive control panel.
 */
function makePanelDefinition({ panelId } = {}) {
  const dTag = panelId || `panel-${crypto.randomUUID().slice(0, 8)}`;
  return makeEvent({
    id:   PANEL_EVENT_ID,
    kind: kinds.PANEL_DEFINITION,
    content: {
      title:       'Test Governance Panel',
      description: 'Panel for integration test',
      actions:     [{ id: 'approve', label: 'Approve' }, { id: 'reject', label: 'Reject' }],
    },
    tags: [
      ['d', dTag],
      ['p', TEST_PUBKEY],
    ],
  });
}

/**
 * Build an ActionRequest event (kind 31402).
 * Published by an agent to request a human decision.
 */
function makeActionRequest({ panelDTag, caseId } = {}) {
  return makeEvent({
    id:   REQUEST_EVENT_ID,
    kind: kinds.ACTION_REQUEST,
    content: {
      case_id:     caseId || CASE_ID,
      title:       'Approve knowledge graph merge',
      description: 'Agent recommends merging 42 new concepts.',
      options:     ['approve', 'reject', 'defer'],
    },
    tags: [
      ['d', `request-${caseId || CASE_ID}`],
      ['e', PANEL_EVENT_ID],                    // references the panel
      ['p', TEST_PUBKEY],
      ...(panelDTag ? [['a', `${kinds.PANEL_DEFINITION}:${TEST_PUBKEY}:${panelDTag}`]] : []),
    ],
  });
}

/**
 * Build an ActionResponse event (kind 31403).
 * Published by a human in the forum to respond to an ActionRequest.
 */
function makeActionResponse({ caseId, outcome, reason, decidedBy } = {}) {
  return makeEvent({
    id:     RESPONSE_EVENT_ID,
    kind:   kinds.ACTION_RESPONSE,
    pubkey: decidedBy || TEST_PUBKEY,
    content: {
      case_id:  caseId || CASE_ID,
      outcome:  outcome || 'approve',
      reason:   reason || 'Concepts verified by domain expert.',
    },
    tags: [
      ['d', `response-${caseId || CASE_ID}`],
      ['e', REQUEST_EVENT_ID],                  // references the action request
      ['p', TEST_PUBKEY],
    ],
  });
}

/**
 * Write an outbox event file in the format relay-consumer expects.
 * Returns the written file path.
 */
function writeOutboxEvent(podRoot, npub, event, filename) {
  const outboxDir = path.join(podRoot, 'pods', npub, 'events', 'outbox');
  fs.mkdirSync(outboxDir, { recursive: true });
  const filePath = path.join(outboxDir, filename || `${event.id}.json`);
  const payload = {
    event:    { ...event, content: typeof event.content === 'string' ? event.content : JSON.stringify(event.content) },
    status:   'pending',
    queued_at: new Date().toISOString(),
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return filePath;
}

/** Spawn stub: returns a minimal EventEmitter-like fake process. */
function makeSpawnStub() {
  const { EventEmitter } = require('events');
  return (_cmd, _args, _opts) => {
    const proc = new EventEmitter();
    proc.pid = Math.floor(Math.random() * 90000) + 10000;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin  = { write: () => true, writable: true };
    proc.kill   = (_sig) => { proc.emit('exit', 0, null); };
    setImmediate(() => proc.stdout.emit('data', Buffer.from('started\n')));
    return proc;
  };
}

/** Create a silent logger that captures structured messages. */
function makeCaptureLogger() {
  const entries = [];
  const logger = {};
  for (const level of ['info', 'warn', 'error', 'debug', 'trace']) {
    logger[level] = (obj, msg) => entries.push({ level, obj, msg });
  }
  logger.entries = entries;
  return logger;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('governance flow :: end-to-end', () => {

  let podRoot;
  let orchestrator;
  let logger;

  beforeEach(() => {
    podRoot      = makeTmpPodRoot();
    orchestrator = new LocalProcessManagerOrchestratorAdapter({ spawnFn: makeSpawnStub() });
    logger       = makeCaptureLogger();
  });

  afterEach(() => {
    rmTmpDir(podRoot);
  });

  // ── Step 1: Agent publishes PanelDefinition ─────────────────────────────

  describe('step 1 — PanelDefinition (kind 31400) outbox write', () => {

    it('writes a pending outbox file with correct Nostr event structure', () => {
      const panel = makePanelDefinition({ panelId: 'test-panel-01' });
      const filePath = writeOutboxEvent(podRoot, TEST_NPUB, panel, 'test-panel.json');

      expect(fs.existsSync(filePath)).toBe(true);

      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(raw.status).toBe('pending');
      expect(raw.event).toBeDefined();
      expect(raw.event.kind).toBe(kinds.PANEL_DEFINITION);
      expect(raw.event.id).toBe(PANEL_EVENT_ID);

      // d-tag identifies the panel
      const dTag = raw.event.tags.find(t => t[0] === 'd');
      expect(dTag).toBeDefined();
      expect(dTag[1]).toBe('test-panel-01');
    });

    it('content contains panel schema with title and actions', () => {
      const panel = makePanelDefinition();
      writeOutboxEvent(podRoot, TEST_NPUB, panel);

      const raw = JSON.parse(
        fs.readFileSync(path.join(podRoot, 'pods', TEST_NPUB, 'events', 'outbox', `${PANEL_EVENT_ID}.json`), 'utf8')
      );
      const content = JSON.parse(raw.event.content);
      expect(content).toHaveProperty('title');
      expect(content).toHaveProperty('actions');
      expect(Array.isArray(content.actions)).toBe(true);
      expect(content.actions.length).toBeGreaterThan(0);
    });
  });

  // ── Step 2: Agent publishes ActionRequest ─────────────────────────────

  describe('step 2 — ActionRequest (kind 31402) outbox write', () => {

    it('writes a pending outbox file referencing the panel via e-tag', () => {
      const request = makeActionRequest({ panelDTag: 'test-panel-01', caseId: CASE_ID });
      const filePath = writeOutboxEvent(podRoot, TEST_NPUB, request);

      expect(fs.existsSync(filePath)).toBe(true);

      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(raw.status).toBe('pending');
      expect(raw.event.kind).toBe(kinds.ACTION_REQUEST);
      expect(raw.event.id).toBe(REQUEST_EVENT_ID);

      // e-tag references the panel event
      const eTag = raw.event.tags.find(t => t[0] === 'e');
      expect(eTag).toBeDefined();
      expect(eTag[1]).toBe(PANEL_EVENT_ID);

      // Content includes case_id and options
      const content = JSON.parse(raw.event.content);
      expect(content.case_id).toBe(CASE_ID);
      expect(Array.isArray(content.options)).toBe(true);
    });
  });

  // ── Step 3: Decision routing via orchestrator ─────────────────────────

  describe('step 3 — ActionResponse (kind 31403) decision routing', () => {

    it('handleGovernanceDecision is callable on the orchestrator adapter', () => {
      expect(typeof orchestrator.handleGovernanceDecision).toBe('function');
    });

    it('returns { dispatched: true } for a valid ActionResponse event', async () => {
      const response = makeActionResponse();
      const result = await orchestrator.handleGovernanceDecision(response);

      expect(result).toBeDefined();
      expect(result.dispatched).toBe(true);
      expect(result.event_id).toBe(RESPONSE_EVENT_ID);
    });

    it('persists the decision to the governance decisions directory', async () => {
      // Set AGENTBOX_PUBKEY so the adapter writes to a known pod path
      const origPubkey = process.env.AGENTBOX_PUBKEY;
      const origCwd    = process.cwd();
      process.env.AGENTBOX_PUBKEY = TEST_PUBKEY;

      // Override cwd to podRoot so the file lands in our temp tree
      process.chdir(podRoot);
      try {
        const response = makeActionResponse({ caseId: CASE_ID, outcome: 'approve' });
        const result = await orchestrator.handleGovernanceDecision(response);

        expect(result.dispatched).toBe(true);
        expect(result.target).toBe('file'); // no running agent matched

        // Find the decision file
        const npubDir = `npub-${TEST_PUBKEY.slice(0, 16)}`;
        const decisionDir = path.join(podRoot, 'pods', npubDir, 'events', 'governance', 'decisions');
        const decisionFile = path.join(decisionDir, `${RESPONSE_EVENT_ID}.json`);

        expect(fs.existsSync(decisionFile)).toBe(true);

        const decision = JSON.parse(fs.readFileSync(decisionFile, 'utf8'));
        expect(decision.type).toBe('governance_decision');
        expect(decision.event_id).toBe(RESPONSE_EVENT_ID);
        expect(decision.case_id).toBe(CASE_ID);
        expect(decision.outcome).toBe('approve');
        expect(decision.decided_by).toBe(TEST_PUBKEY);
      } finally {
        process.chdir(origCwd);
        if (origPubkey !== undefined) {
          process.env.AGENTBOX_PUBKEY = origPubkey;
        } else {
          delete process.env.AGENTBOX_PUBKEY;
        }
      }
    });

    it('routes decision to a running agent when the agentId matches the d-tag ref', async () => {
      // Spawn a fake agent whose agentId we control
      const { agentId } = await orchestrator.spawnAgent({ command: 'echo', args: ['gov'] });

      // Build a response whose d-tag matches the agentId
      const response = makeEvent({
        id:     RESPONSE_EVENT_ID,
        kind:   kinds.ACTION_RESPONSE,
        content: { case_id: CASE_ID, outcome: 'reject', reason: 'Needs review' },
        tags:   [['d', agentId], ['p', TEST_PUBKEY]],
      });

      const events = [];
      await orchestrator.streamEvent(agentId, ev => events.push(ev));

      const result = await orchestrator.handleGovernanceDecision(response);

      expect(result.dispatched).toBe(true);
      expect(result.target).toBe(agentId);

      // The handler should have received a governance-decision lifecycle event
      expect(events.length).toBeGreaterThanOrEqual(1);
      const govEvent = events.find(e => e.kind === 'governance-decision');
      expect(govEvent).toBeDefined();
      expect(govEvent.payload.case_id).toBe(CASE_ID);
      expect(govEvent.payload.outcome).toBe('reject');
      expect(govEvent.payload.activity_urn).toMatch(/^urn:agentbox:activity:/);
    });

    it('throws when event is missing an id', async () => {
      await assert.rejects(
        () => orchestrator.handleGovernanceDecision({}),
        { message: /event with id is required/i },
      );
      await assert.rejects(
        () => orchestrator.handleGovernanceDecision(null),
      );
    });

    it('handles non-JSON content gracefully (raw string)', async () => {
      const response = makeEvent({
        id:   RESPONSE_EVENT_ID,
        kind: kinds.ACTION_RESPONSE,
        tags: [['p', TEST_PUBKEY]],
      });
      response.content = 'plain-text-decision: approve';

      const result = await orchestrator.handleGovernanceDecision(response);
      expect(result.dispatched).toBe(true);
    });
  });

  // ── Step 4: RelayConsumer inbound routing to governance directory ──────

  describe('step 4 — RelayConsumer inbound governance event routing', () => {

    /**
     * Build a RelayConsumer wired to the test pod root with all mocks.
     * The bridge and signer are never used — we call _onInbound directly.
     */
    function makeTestConsumer(opts = {}) {
      // Patch NostrBridge constructor to avoid WebSocket connections
      const consumer = Object.create(RelayConsumer.prototype);
      consumer._npubs              = new Set([TEST_NPUB]);
      consumer._allowedPubkeys     = new Set();
      consumer._multiUser          = { enabled: false };
      consumer._allowedKinds       = [kinds.ACTION_RESPONSE, kinds.PANEL_DEFINITION, kinds.ACTION_REQUEST];
      consumer._ingressPolicy      = 'open';
      consumer._podRoot            = opts.podRoot || podRoot;
      consumer._stack              = 'default';
      consumer._fanout             = 'off';
      consumer._adapters           = opts.adapters || {};
      consumer._intentSpec         = null;
      consumer._logger             = opts.logger || logger;
      consumer._verifyEvent        = () => true;
      consumer._now                = () => Date.now();
      consumer._metrics            = {
        inbound_accepted: 0,
        inbound_rejected_sig: 0,
        inbound_rejected_policy: 0,
        inbound_rejected_recipient: 0,
        inbound_rejected_duplicate: 0,
        outbox_published: 0,
        outbox_pending: 0,
        outbox_failed: 0,
      };
      return consumer;
    }

    it('writes governance events to pods/<npub>/events/governance/', () => {
      const consumer = makeTestConsumer();
      const panel = makePanelDefinition();

      consumer._onInbound(panel, 'ws://test-relay:7777');

      const govFile = path.join(podRoot, 'pods', TEST_NPUB, 'events', 'governance', `${PANEL_EVENT_ID}.json`);
      expect(fs.existsSync(govFile)).toBe(true);

      const stored = JSON.parse(fs.readFileSync(govFile, 'utf8'));
      expect(stored.kind).toBe(kinds.PANEL_DEFINITION);
      expect(stored.kind_label).toBe('panel-definition');
      expect(stored.event_id).toBe(PANEL_EVENT_ID);
    });

    it('writes ActionRequest to governance directory with correct structure', () => {
      const consumer = makeTestConsumer();
      const request = makeActionRequest({ caseId: CASE_ID });

      consumer._onInbound(request, 'ws://test-relay:7777');

      const govFile = path.join(podRoot, 'pods', TEST_NPUB, 'events', 'governance', `${REQUEST_EVENT_ID}.json`);
      expect(fs.existsSync(govFile)).toBe(true);

      const stored = JSON.parse(fs.readFileSync(govFile, 'utf8'));
      expect(stored.kind).toBe(kinds.ACTION_REQUEST);
      expect(stored.kind_label).toBe('action-request');
    });

    it('routes ActionResponse (31403) through orchestrator.handleGovernanceDecision', async () => {
      const handleCalls = [];
      const mockOrchestrator = {
        handleGovernanceDecision: async (event) => {
          handleCalls.push(event);
          return { dispatched: true, target: 'file', event_id: event.id };
        },
      };

      const consumer = makeTestConsumer({
        adapters: { orchestrator: mockOrchestrator },
      });

      const response = makeActionResponse({ caseId: CASE_ID, outcome: 'approve' });
      consumer._onInbound(response, 'ws://test-relay:7777');

      // handleGovernanceDecision is called via Promise.resolve — wait a tick
      await new Promise(r => setImmediate(r));

      expect(handleCalls.length).toBe(1);
      expect(handleCalls[0].id).toBe(RESPONSE_EVENT_ID);
      expect(handleCalls[0].kind).toBe(kinds.ACTION_RESPONSE);
    });

    it('does NOT call handleGovernanceDecision for non-31403 governance events', async () => {
      const handleCalls = [];
      const mockOrchestrator = {
        handleGovernanceDecision: async (event) => {
          handleCalls.push(event);
          return { dispatched: true, target: 'file', event_id: event.id };
        },
      };

      const consumer = makeTestConsumer({
        adapters: { orchestrator: mockOrchestrator },
      });

      // PanelDefinition (31400) — should NOT trigger handleGovernanceDecision
      const panel = makePanelDefinition();
      consumer._onInbound(panel, 'ws://test-relay:7777');
      await new Promise(r => setImmediate(r));

      expect(handleCalls.length).toBe(0);
    });

    it('deduplicates governance events by event id', () => {
      const consumer = makeTestConsumer();
      const panel = makePanelDefinition();

      consumer._onInbound(panel, 'ws://test-relay:7777');
      consumer._onInbound(panel, 'ws://test-relay:7777');

      // Second inbound is rejected as duplicate (inbox dedup)
      expect(consumer._metrics.inbound_rejected_duplicate).toBe(1);
      expect(consumer._metrics.inbound_accepted).toBe(1);
    });

    it('rejects events that fail signature verification', () => {
      const consumer = makeTestConsumer();
      consumer._verifyEvent = () => false;

      const panel = makePanelDefinition();
      consumer._onInbound(panel, 'ws://test-relay:7777');

      expect(consumer._metrics.inbound_rejected_sig).toBe(1);
      expect(consumer._metrics.inbound_accepted).toBe(0);
    });

    it('writes inbound event to inbox as LDN-formatted payload', () => {
      const consumer = makeTestConsumer();
      const response = makeActionResponse();

      consumer._onInbound(response, 'ws://test-relay:7777');

      const inboxFile = path.join(podRoot, 'pods', TEST_NPUB, 'events', 'inbox', `${RESPONSE_EVENT_ID}.json`);
      expect(fs.existsSync(inboxFile)).toBe(true);

      const stored = JSON.parse(fs.readFileSync(inboxFile, 'utf8'));
      // LDN AS2 envelope
      expect(stored['@context']).toBe('https://www.w3.org/ns/activitystreams');
      expect(stored.type).toBe('Announce');
      expect(stored['x:nostrEvent']).toBeDefined();
      expect(stored['x:nostrEvent'].kind).toBe(kinds.ACTION_RESPONSE);
    });
  });

  // ── Step 5: Full loop integration ─────────────────────────────────────

  describe('step 5 — full governance loop integration', () => {

    it('panel → request → response → decision dispatched', async () => {
      const decisionResults = [];
      const realOrchestrator = new LocalProcessManagerOrchestratorAdapter({
        spawnFn: makeSpawnStub(),
      });

      // Wrap handleGovernanceDecision to capture results
      const origHandle = realOrchestrator.handleGovernanceDecision.bind(realOrchestrator);
      realOrchestrator.handleGovernanceDecision = async (event) => {
        const result = await origHandle(event);
        decisionResults.push(result);
        return result;
      };

      // Build a consumer with the real orchestrator adapter
      const consumer = Object.create(RelayConsumer.prototype);
      consumer._npubs          = new Set([TEST_NPUB]);
      consumer._allowedPubkeys = new Set();
      consumer._multiUser      = { enabled: false };
      consumer._allowedKinds   = [kinds.PANEL_DEFINITION, kinds.ACTION_REQUEST, kinds.ACTION_RESPONSE];
      consumer._ingressPolicy  = 'open';
      consumer._podRoot        = podRoot;
      consumer._stack          = 'default';
      consumer._fanout         = 'off';
      consumer._adapters       = { orchestrator: realOrchestrator };
      consumer._intentSpec     = null;
      consumer._logger         = logger;
      consumer._verifyEvent    = () => true;
      consumer._now            = () => Date.now();
      consumer._metrics        = {
        inbound_accepted: 0,
        inbound_rejected_sig: 0,
        inbound_rejected_policy: 0,
        inbound_rejected_recipient: 0,
        inbound_rejected_duplicate: 0,
        outbox_published: 0,
        outbox_pending: 0,
        outbox_failed: 0,
      };

      // Step 1: Agent writes PanelDefinition to outbox (simulated)
      const panel = makePanelDefinition({ panelId: 'integration-panel' });
      writeOutboxEvent(podRoot, TEST_NPUB, panel, 'panel.json');

      // Step 2: Agent writes ActionRequest to outbox (simulated)
      const request = makeActionRequest({ panelDTag: 'integration-panel', caseId: CASE_ID });
      writeOutboxEvent(podRoot, TEST_NPUB, request, 'request.json');

      // Verify outbox files exist
      const outboxDir = path.join(podRoot, 'pods', TEST_NPUB, 'events', 'outbox');
      expect(fs.existsSync(path.join(outboxDir, 'panel.json'))).toBe(true);
      expect(fs.existsSync(path.join(outboxDir, 'request.json'))).toBe(true);

      // Step 3: Human responds — inbound ActionResponse
      const response = makeActionResponse({
        caseId:   CASE_ID,
        outcome:  'approve',
        reason:   'Domain expert verified the merge.',
        decidedBy: 'b'.repeat(64),
      });
      consumer._onInbound(response, 'ws://test-relay:7777');

      // Wait for the async handleGovernanceDecision call
      await new Promise(r => setImmediate(r));
      // Second tick in case of nested microtasks
      await new Promise(r => setImmediate(r));

      // Step 4: Verify the decision was dispatched
      expect(decisionResults.length).toBe(1);
      expect(decisionResults[0].dispatched).toBe(true);
      expect(decisionResults[0].event_id).toBe(RESPONSE_EVENT_ID);

      // Step 5: Verify governance directory has all three events
      const govDir = path.join(podRoot, 'pods', TEST_NPUB, 'events', 'governance');
      expect(fs.existsSync(govDir)).toBe(true);

      // Only the ActionResponse was inbound — PanelDefinition and ActionRequest
      // were outbox writes (not processed by _onInbound), so governance dir
      // should have the response event.
      const govFile = path.join(govDir, `${RESPONSE_EVENT_ID}.json`);
      expect(fs.existsSync(govFile)).toBe(true);

      const stored = JSON.parse(fs.readFileSync(govFile, 'utf8'));
      expect(stored.kind).toBe(kinds.ACTION_RESPONSE);
      expect(stored.kind_label).toBe('action-response');

      // Verify inbox also received the LDN envelope
      const inboxFile = path.join(podRoot, 'pods', TEST_NPUB, 'events', 'inbox', `${RESPONSE_EVENT_ID}.json`);
      expect(fs.existsSync(inboxFile)).toBe(true);

      // Accepted count should be 1 (only the inbound response)
      expect(consumer._metrics.inbound_accepted).toBe(1);
    });

    it('full loop with all three governance events arriving inbound', async () => {
      // Simulate a scenario where all three events arrive via the relay
      // (e.g. another agent's panel definition is received as inbound)
      const decisionResults = [];
      const realOrchestrator = new LocalProcessManagerOrchestratorAdapter({
        spawnFn: makeSpawnStub(),
      });
      const origHandle = realOrchestrator.handleGovernanceDecision.bind(realOrchestrator);
      realOrchestrator.handleGovernanceDecision = async (event) => {
        const result = await origHandle(event);
        decisionResults.push(result);
        return result;
      };

      const consumer = Object.create(RelayConsumer.prototype);
      consumer._npubs          = new Set([TEST_NPUB]);
      consumer._allowedPubkeys = new Set();
      consumer._multiUser      = { enabled: false };
      consumer._allowedKinds   = [kinds.PANEL_DEFINITION, kinds.ACTION_REQUEST, kinds.ACTION_RESPONSE];
      consumer._ingressPolicy  = 'open';
      consumer._podRoot        = podRoot;
      consumer._stack          = 'default';
      consumer._fanout         = 'off';
      consumer._adapters       = { orchestrator: realOrchestrator };
      consumer._intentSpec     = null;
      consumer._logger         = logger;
      consumer._verifyEvent    = () => true;
      consumer._now            = () => Date.now();
      consumer._metrics        = {
        inbound_accepted: 0,
        inbound_rejected_sig: 0,
        inbound_rejected_policy: 0,
        inbound_rejected_recipient: 0,
        inbound_rejected_duplicate: 0,
        outbox_published: 0,
        outbox_pending: 0,
        outbox_failed: 0,
      };

      // All three arrive inbound in sequence
      consumer._onInbound(makePanelDefinition(), 'ws://relay:7777');
      consumer._onInbound(makeActionRequest(), 'ws://relay:7777');
      consumer._onInbound(makeActionResponse(), 'ws://relay:7777');

      await new Promise(r => setImmediate(r));
      await new Promise(r => setImmediate(r));

      // All three accepted
      expect(consumer._metrics.inbound_accepted).toBe(3);

      // Only the ActionResponse triggers handleGovernanceDecision
      expect(decisionResults.length).toBe(1);
      expect(decisionResults[0].event_id).toBe(RESPONSE_EVENT_ID);

      // All three are in the governance directory
      const govDir = path.join(podRoot, 'pods', TEST_NPUB, 'events', 'governance');
      expect(fs.existsSync(path.join(govDir, `${PANEL_EVENT_ID}.json`))).toBe(true);
      expect(fs.existsSync(path.join(govDir, `${REQUEST_EVENT_ID}.json`))).toBe(true);
      expect(fs.existsSync(path.join(govDir, `${RESPONSE_EVENT_ID}.json`))).toBe(true);
    });
  });

  // ── Provenance recording ──────────────────────────────────────────────

  describe('provenance — activity_urn on governance decisions', () => {

    it('handleGovernanceDecision lifecycle event includes activity_urn', async () => {
      const { agentId } = await orchestrator.spawnAgent({ command: 'echo', args: [] });

      const events = [];
      await orchestrator.streamEvent(agentId, ev => events.push(ev));

      const response = makeEvent({
        id:     RESPONSE_EVENT_ID,
        kind:   kinds.ACTION_RESPONSE,
        content: { case_id: CASE_ID, outcome: 'approve' },
        tags:   [['d', agentId], ['p', TEST_PUBKEY]],
      });

      await orchestrator.handleGovernanceDecision(response);

      const govEvent = events.find(e => e.kind === 'governance-decision');
      expect(govEvent).toBeDefined();
      expect(govEvent.payload.activity_urn).toBeDefined();
      expect(govEvent.payload.activity_urn).toMatch(/^urn:agentbox:activity:/);
      // activity kind is content-addressed (sha256-12), so the local part
      // is a hash rather than the 'decision-' localId hint passed to mint().
      expect(govEvent.payload.activity_urn).toMatch(/^urn:agentbox:activity:.+:.+$/);
    });

    it('persisted decision file contains governance_decision type and provenance fields', async () => {
      const origPubkey = process.env.AGENTBOX_PUBKEY;
      const origCwd    = process.cwd();
      process.env.AGENTBOX_PUBKEY = TEST_PUBKEY;
      process.chdir(podRoot);

      try {
        const response = makeActionResponse({
          caseId:   'prov-test-001',
          outcome:  'defer',
          reason:   'Needs more data.',
          decidedBy: 'c'.repeat(64),
        });

        await orchestrator.handleGovernanceDecision(response);

        const npubDir = `npub-${TEST_PUBKEY.slice(0, 16)}`;
        const decisionFile = path.join(
          podRoot, 'pods', npubDir, 'events', 'governance', 'decisions', `${RESPONSE_EVENT_ID}.json`
        );
        expect(fs.existsSync(decisionFile)).toBe(true);

        const decision = JSON.parse(fs.readFileSync(decisionFile, 'utf8'));
        expect(decision.type).toBe('governance_decision');
        expect(decision.event_id).toBe(RESPONSE_EVENT_ID);
        expect(decision.case_id).toBe('prov-test-001');
        expect(decision.outcome).toBe('defer');
        expect(decision.reason).toBe('Needs more data.');
        expect(decision.decided_by).toBe('c'.repeat(64));
      } finally {
        process.chdir(origCwd);
        if (origPubkey !== undefined) {
          process.env.AGENTBOX_PUBKEY = origPubkey;
        } else {
          delete process.env.AGENTBOX_PUBKEY;
        }
      }
    });
  });
});
