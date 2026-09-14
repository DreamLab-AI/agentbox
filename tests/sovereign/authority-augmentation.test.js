'use strict';

/**
 * authority gate — augmentation-conditions additions (EXP-AC-003, EXP-AC-004,
 * EXP-AC-007).
 *
 *  * FR3.4  the gate stamps the ADR-2011 task-property triple on its own 31402
 *  * FR4.4  EVERY deny path appends an `authority.deny` record to the
 *           hash-chained execution journal — a denial that is only a log line
 *           is invisible to `/v1/agent-events`, which is where an operator
 *           looks for it
 *  * FR7.3  the `no-decision-surface` deny returns a STRUCTURED hint naming the
 *           manual-continuation tool, so an operator learns the option at the
 *           moment of denial rather than from documentation
 */

const { buildAuthorityGate } = require('../../management-api/lib/authority');
const tp = require('../../management-api/lib/task-properties');

const MANIFEST = {
  skills: {
    authority: {
      enabled: true,
      classes: { pod_delete: 'zero-tolerance', memory_read: 'recoverable' },
      task_properties: {
        verifiability: 'partial',
        stakes: 'significant',
        classes: { pod_delete: { verifiability: 'opaque', stakes: 'critical' } },
      },
    },
  },
};

const OPERATION = { kind: 'test-op', target: 'pod:abc' };

/** A journal double capturing every appended record. */
function journalDouble(opts = {}) {
  const records = [];
  return {
    records,
    async append(record) {
      records.push(record);
      if (opts.throws) throw new Error('journal unavailable');
      return { ok: true };
    },
  };
}

function signedRequestFrom(unsigned) {
  return { ...unsigned, id: 'a'.repeat(64), pubkey: 'b'.repeat(64), sig: 'c'.repeat(128) };
}

describe('EXP-AC-003 — the gate stamps the task-property triple on its 31402', () => {
  test('a zero-tolerance action publishes tp-reversibility=irreversible', async () => {
    let published = null;
    const gate = buildAuthorityGate(MANIFEST, {
      publishActionRequest: async (unsigned) => { published = unsigned; return signedRequestFrom(unsigned); },
      awaitDecision: async () => null,
    });
    await gate.guard({ actionClass: 'pod_delete', operation: OPERATION });

    expect(tp.fromTags(published.tags)).toEqual({
      verifiability: 'opaque', reversibility: 'irreversible', stakes: 'critical',
    });
    expect(JSON.parse(published.content).fields.task_properties).toEqual({
      verifiability: 'opaque', reversibility: 'irreversible', stakes: 'critical',
    });
  });

  test('an escalation-required (unclassified) action is stamped irreversible — fail-closed', async () => {
    let published = null;
    const gate = buildAuthorityGate(MANIFEST, {
      publishActionRequest: async (u) => { published = u; return signedRequestFrom(u); },
      awaitDecision: async () => null,
    });
    await gate.guard({ actionClass: 'never_classified', operation: OPERATION });
    expect(tp.fromTags(published.tags).reversibility).toBe('irreversible');
  });

  test('a caller-supplied task_properties may tighten but never loosen', async () => {
    let published = null;
    const gate = buildAuthorityGate(MANIFEST, {
      publishActionRequest: async (u) => { published = u; return signedRequestFrom(u); },
      awaitDecision: async () => null,
    });
    await gate.guard({
      actionClass: 'pod_delete',
      operation: OPERATION,
      taskProperties: { verifiability: 'inspectable', reversibility: 'reversible', stakes: 'bounded' },
    });
    expect(tp.fromTags(published.tags)).toEqual({
      verifiability: 'opaque', reversibility: 'irreversible', stakes: 'critical',
    });
  });

  test('the resolved triple is returned on the gate result for the caller to record', async () => {
    const gate = buildAuthorityGate(MANIFEST, { awaitDecision: null });
    const result = await gate.guard({ actionClass: 'pod_delete', operation: OPERATION });
    expect(result.task_properties).toEqual({
      verifiability: 'opaque', reversibility: 'irreversible', stakes: 'critical',
    });
  });

  test('a recoverable action still reports its triple with no publish', async () => {
    const gate = buildAuthorityGate(MANIFEST, {});
    const result = await gate.guard({ actionClass: 'memory_read', operation: OPERATION });
    expect(result.decision).toBe('allow');
    expect(result.task_properties).toEqual({
      verifiability: 'partial', reversibility: 'compensable', stakes: 'significant',
    });
  });
});

describe('EXP-AC-007 — no-decision-surface returns a structured manual-continuation hint', () => {
  test('the deny carries code + hint naming governance_manual_continue', async () => {
    const gate = buildAuthorityGate(MANIFEST, { awaitDecision: null });
    const result = await gate.guard({ actionClass: 'pod_delete', operation: OPERATION });
    expect(result.decision).toBe('deny');
    expect(result.code).toBe('no-decision-surface');
    expect(result.hint).toBe('governance_manual_continue');
    expect(result.reason).toBe('no-decision-surface'); // legacy field preserved
  });
});

describe('EXP-AC-004 — every deny path journals an authority.deny record', () => {
  const DENY_CASES = [
    {
      name: 'no decision surface wired',
      deps: { awaitDecision: null },
      params: { actionClass: 'pod_delete', operation: OPERATION },
      stage: 'decision-surface',
      reason: 'no-decision-surface',
      expectDigest: false,
    },
    {
      name: 'missing or invalid operation',
      deps: { awaitDecision: async () => null },
      params: { actionClass: 'pod_delete' },
      stage: 'operation',
      reason: 'missing-or-invalid-operation',
      expectDigest: false,
    },
    {
      name: 'publish failed',
      deps: {
        publishActionRequest: async () => { throw new Error('relay down'); },
        awaitDecision: async () => null,
      },
      params: { actionClass: 'pod_delete', operation: OPERATION },
      stage: 'publish',
      reason: 'publish-failed: relay down',
    },
    {
      name: 'producer returned no request id',
      deps: { publishActionRequest: async () => ({}), awaitDecision: async () => null },
      params: { actionClass: 'pod_delete', operation: OPERATION },
      stage: 'publish',
      reason: 'no-request-id',
    },
    {
      name: 'producer signed a different payload',
      deps: {
        publishActionRequest: async (u) => ({ ...signedRequestFrom(u), content: '{"tampered":true}' }),
        awaitDecision: async () => null,
      },
      params: { actionClass: 'pod_delete', operation: OPERATION },
      stage: 'publish',
      reason: 'request-payload-changed',
    },
    {
      name: 'decision wait errored',
      deps: {
        publishActionRequest: async (u) => signedRequestFrom(u),
        awaitDecision: async () => { throw new Error('socket closed'); },
      },
      params: { actionClass: 'pod_delete', operation: OPERATION },
      stage: 'await-decision',
      reason: 'await-failed: socket closed',
    },
    {
      name: 'no signed response (timeout)',
      deps: {
        publishActionRequest: async (u) => signedRequestFrom(u),
        awaitDecision: async () => null,
      },
      params: { actionClass: 'pod_delete', operation: OPERATION },
      stage: 'await-decision',
      reason: 'no-signed-response',
    },
    {
      name: 'unverified signature',
      deps: {
        publishActionRequest: async (u) => signedRequestFrom(u),
        awaitDecision: async () => ({ id: 'd'.repeat(64), kind: 31403, tags: [], content: '{}' }),
        verifyEvent: () => false,
      },
      params: { actionClass: 'pod_delete', operation: OPERATION },
      stage: 'verify-signature',
      reason: 'unverified-signature',
    },
    {
      name: 'a decision that is not an approval',
      deps: {
        publishActionRequest: async (u) => signedRequestFrom(u),
        awaitDecision: async (req) => ({
          id: 'd'.repeat(64), kind: 31403,
          tags: [['e', req.id], ['d', 'urn:agentbox:authority:pod_delete:1']],
          content: JSON.stringify({ outcome: 'reject' }),
        }),
        verifyEvent: () => true,
      },
      params: { actionClass: 'pod_delete', operation: OPERATION, panelId: 'urn:agentbox:authority:pod_delete:1' },
      stage: 'outcome',
      reason: 'not-approved: reject',
      expectDigest: true,
    },
  ];

  test.each(DENY_CASES)('deny path "$name" is journalled with stage + reason', async (c) => {
    const journal = journalDouble();
    const gate = buildAuthorityGate(MANIFEST, {
      ...c.deps,
      journal,
      agentDid: 'did:nostr:' + 'e'.repeat(64),
    });
    const result = await gate.guard(c.params);

    expect(result.decision).toBe('deny');
    expect(journal.records).toHaveLength(1);
    const record = journal.records[0];
    expect(record.type).toBe('authority.deny');
    expect(record.stage).toBe(c.stage);
    expect(record.reason).toBe(c.reason);
    expect(record.action_class).toBe(c.params.actionClass);
    expect(record.authority_class).toBe('zero-tolerance');
    expect(record.agent_did).toBe('did:nostr:' + 'e'.repeat(64));
    expect(record.task_properties).toEqual({
      verifiability: 'opaque', reversibility: 'irreversible', stakes: 'critical',
    });
    if (c.expectDigest !== false) expect(record.operation_sha256).toMatch(/^[0-9a-f]{64}$/);
    else expect(record.operation_sha256).toBeNull();
  });

  test('an ALLOW journals nothing — only denials are recorded', async () => {
    const journal = journalDouble();
    const gate = buildAuthorityGate(MANIFEST, { journal });
    await gate.guard({ actionClass: 'memory_read', operation: OPERATION });
    expect(journal.records).toHaveLength(0);
  });

  test('an approved zero-tolerance release journals nothing', async () => {
    const journal = journalDouble();
    const gate = buildAuthorityGate(MANIFEST, {
      journal,
      publishActionRequest: async (u) => signedRequestFrom(u),
      awaitDecision: async (req) => ({
        id: 'd'.repeat(64), kind: 31403,
        tags: [['e', req.id], ['d', 'p1']],
        content: JSON.stringify({ outcome: 'approve' }),
      }),
      verifyEvent: () => true,
    });
    const result = await gate.guard({ actionClass: 'pod_delete', operation: OPERATION, panelId: 'p1' });
    expect(result.decision).toBe('allow');
    expect(journal.records).toHaveLength(0);
  });

  test('a journal that throws never converts a deny into an exception', async () => {
    const journal = journalDouble({ throws: true });
    const warnings = [];
    const gate = buildAuthorityGate(MANIFEST, {
      journal,
      awaitDecision: null,
      logger: { debug() {}, info() {}, warn: (o, m) => warnings.push(m) },
    });
    const result = await gate.guard({ actionClass: 'pod_delete', operation: OPERATION });
    expect(result.decision).toBe('deny');
    expect(warnings.join(' ')).toMatch(/authority.deny/);
  });

  test('the gate still works with no journal wired (backward compatible)', async () => {
    const gate = buildAuthorityGate(MANIFEST, { awaitDecision: null });
    await expect(gate.guard({ actionClass: 'pod_delete', operation: OPERATION }))
      .resolves.toMatchObject({ decision: 'deny' });
  });
});
