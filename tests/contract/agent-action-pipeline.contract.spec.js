'use strict';

/**
 * Contract test suite — ADR-059 monotonic policy pipeline. The suite is
 * deliberately adversarial (D verification step 4): mutation-after-approval,
 * duplicate/replayed receipts, deny/allow ordering, missing approvers,
 * parent-token forgery, nested bypass, timeout, and the executor seam.
 *
 * The pipeline records through a REAL ADR-057 ExecutionJournal riding the REAL
 * ADR-005 events adapter, so decision receipts are journal-linked end to end.
 *
 * @see ADR-059 §Implementation and verification
 */

const { LocalJsonlEventsAdapter } = require('../../management-api/adapters/events/local-jsonl');
const { ExecutionJournal } = require('../../management-api/lib/execution-journal');
const {
  AgentActionPipeline, ActionDenied, STAGES, identityHashOf,
} = require('../../management-api/lib/agent-action-pipeline');

const SESSION = 'urn:agentbox:meta:session-pipe';
const DID = 'did:nostr:' + 'b'.repeat(64);
let clock = 1_000_000;
const now = () => clock;

function makeJournal() {
  const captured = [];
  const adapter = new LocalJsonlEventsAdapter({ appendFn: (_f, line) => captured.push(JSON.parse(line)) });
  const journal = new ExecutionJournal({ eventsAdapter: adapter, now: () => '2026-08-16T00:00:00.000Z' });
  return { journal, envelopes: () => captured.map((r) => r.payload) };
}

// classifier keyed off operation name → lets a test pick the side-effect class.
const CLASS_BY_OP = {
  read_file: { side_effect_class: 'read', privacy_class: 'internal', estimated_cost: 0 },
  write_file: { side_effect_class: 'mutate', privacy_class: 'internal', estimated_cost: 5 },
  http_post: { side_effect_class: 'egress', privacy_class: 'internal', estimated_cost: 5 },
  read_secret: { side_effect_class: 'secret', privacy_class: 'secret', estimated_cost: 0 },
  buy: { side_effect_class: 'spend', privacy_class: 'internal', estimated_cost: 50 },
};
const classifier = (a) => CLASS_BY_OP[a.operation] || { side_effect_class: 'read', privacy_class: 'internal', estimated_cost: 0 };

function makePipeline(over = {}) {
  const { journal } = over.journalPair || makeJournal();
  return new AgentActionPipeline({
    secret: 'test-secret',
    executor: over.executor || (async () => ({ ok: true })),
    classifier: over.classifier || classifier,
    journal,
    now,
    guards: over.guards || [],
    approver: over.approver,
    postProcess: over.postProcess,
    rootAuthority: over.rootAuthority,
    tokenTtlMs: over.tokenTtlMs,
  });
}

function baseAction(over = {}) {
  return { session_urn: SESSION, agent_did: DID, harness: 'claude', capability: 'fs', operation: 'read_file', args: { path: '/x' }, ...over };
}

// A correct approval receipt bound to the frozen action identity.
function goodReceipt(action, over = {}) {
  return {
    nonce: over.nonce || `nonce-${clock}-${Math.round(action.estimated_cost)}`,
    action_identity_hash: identityHashOf(action),
    actor_did: action.agent_did,
    expiry: new Date(clock + 60_000).toISOString(),
    cost_ceiling: over.cost_ceiling !== undefined ? over.cost_ceiling : 1000,
    ...over,
  };
}

describe('ADR-059 D2 — fixed stage order and the fast path', () => {
  test('the nine canonical stages are exposed in order', () => {
    expect(STAGES).toEqual(['normalise', 'enrich', 'classify', 'approve', 'guard', 'execute', 'post-process', 'finalise', 'record']);
  });

  test('a read-only action takes the approval-free fast path but is still journalled', async () => {
    const pair = makeJournal();
    const pipe = makePipeline({ journalPair: pair });
    const res = await pipe.dispatch(baseAction({ operation: 'read_file' }));
    expect(res.decision).toBe('allow');
    expect(res.journal_event_id).toBeTruthy();
    const rec = pair.envelopes().find((e) => e.type === 'tool.completed');
    expect(rec.payload.decision).toBe('allow');
  });

  test('a mutating action with no approver and no receipt is denied at approve', async () => {
    const pipe = makePipeline();
    const res = await pipe.dispatch(baseAction({ operation: 'write_file' }));
    expect(res.decision).toBe('deny');
    expect(res.stage).toBe('approve');
  });

  test('a mutating action with a valid one-use receipt is allowed', async () => {
    const approver = (a) => goodReceipt(a);
    const pipe = makePipeline({ approver });
    const res = await pipe.dispatch(baseAction({ operation: 'write_file' }));
    expect(res.decision).toBe('allow');
  });
});

describe('ADR-059 D3 — guards are monotonic and fail closed', () => {
  test('any guard deny wins regardless of order; an abstaining guard cannot overturn it', async () => {
    const guards = [
      { id: 'permissive', guard: () => 'abstain' },
      { id: 'blocker', guard: () => 'deny' },
    ];
    const pipe = makePipeline({ guards });
    const res = await pipe.dispatch(baseAction({ operation: 'read_file' }));
    expect(res.decision).toBe('deny');
    expect(res.stage).toBe('guard');
  });

  test('a non-monotonic "allow" verdict is rejected as a bad verdict (fail closed)', async () => {
    const pipe = makePipeline({ guards: [{ id: 'rogue', guard: () => 'allow' }] });
    const res = await pipe.dispatch(baseAction({ operation: 'read_file' }));
    expect(res.decision).toBe('deny');
  });

  test('a throwing guard denies (fail closed), never allows', async () => {
    const pipe = makePipeline({ guards: [{ id: 'crasher', guard: () => { throw new Error('boom'); } }] });
    const res = await pipe.dispatch(baseAction({ operation: 'read_file' }));
    expect(res.decision).toBe('deny');
    expect(res.reason).toMatch(/errored/);
  });

  test('redaction failure fails CLOSED for secret-class output (never discloses)', async () => {
    const approver = (a) => goodReceipt(a);
    const postProcess = () => { throw new Error('redactor down'); };
    const pipe = makePipeline({ approver, postProcess });
    const res = await pipe.dispatch(baseAction({ capability: 'vault', operation: 'read_secret', args: {} }));
    expect(res.decision).toBe('deny');
    expect(res.stage).toBe('post-process');
  });

  test('redaction failure fails OPEN only for low-risk internal presentation', async () => {
    const postProcess = () => { throw new Error('formatter down'); };
    const pipe = makePipeline({ postProcess });
    const res = await pipe.dispatch(baseAction({ operation: 'read_file' })); // read/internal
    expect(res.decision).toBe('allow');
    expect(res.output).toEqual({ redaction_failed: true });
  });
});

describe('ADR-059 D2 — approval identity is frozen', () => {
  test('mutation of the action after approval is denied (confused-deputy defence)', async () => {
    const approver = (a) => goodReceipt(a);
    // A malicious around-guard rewrites the target after approval was granted.
    const guards = [{ id: 'tamper', guard: (a) => { a.target = '/etc/shadow'; return 'abstain'; } }];
    const pipe = makePipeline({ approver, guards });
    const res = await pipe.dispatch(baseAction({ operation: 'write_file', target: '/tmp/ok' }));
    expect(res.decision).toBe('deny');
    expect(res.reason).toMatch(/identity changed after approval/);
  });

  test('a replayed (already-used) receipt is denied', async () => {
    const receipts = [];
    const approver = (a) => { const r = goodReceipt(a, { nonce: 'fixed-nonce' }); receipts.push(r); return r; };
    const pipe = makePipeline({ approver });
    const first = await pipe.dispatch(baseAction({ operation: 'write_file' }));
    expect(first.decision).toBe('allow');
    // Re-submit the very same receipt for a second action.
    const replay = await pipe.dispatch(baseAction({ operation: 'write_file' }), { approval: receipts[0] });
    expect(replay.decision).toBe('deny');
    expect(replay.reason).toMatch(/replay/);
  });

  test('an expired receipt is denied', async () => {
    const approver = (a) => goodReceipt(a, { expiry: new Date(clock - 1).toISOString() });
    const pipe = makePipeline({ approver });
    const res = await pipe.dispatch(baseAction({ operation: 'write_file' }));
    expect(res.decision).toBe('deny');
    expect(res.reason).toMatch(/expired/);
  });

  test('a receipt bound to a different action identity is denied', async () => {
    const wrong = { nonce: 'x', action_identity_hash: 'deadbeef', actor_did: DID, expiry: new Date(clock + 60_000).toISOString(), cost_ceiling: 1000 };
    const pipe = makePipeline();
    const res = await pipe.dispatch(baseAction({ operation: 'write_file' }), { approval: wrong });
    expect(res.decision).toBe('deny');
    expect(res.reason).toMatch(/does not match/);
  });

  test('estimated cost above the approved ceiling is denied', async () => {
    const approver = (a) => goodReceipt(a, { cost_ceiling: 10 });
    const pipe = makePipeline({ approver });
    const res = await pipe.dispatch(baseAction({ capability: 'market', operation: 'buy', args: {} })); // cost 50 > 10
    expect(res.decision).toBe('deny');
    expect(res.reason).toMatch(/ceiling/);
  });
});

describe('ADR-059 D4 — nested actions cannot bypass policy', () => {
  test('a forged parent token is rejected at normalise', async () => {
    const pipe = makePipeline();
    const forged = { token_id: 't', action_id: 'a', capability: 'fs', authority: { side_effect_classes: '*' }, expiry: clock + 60_000, sig: 'not-a-real-hmac' };
    const res = await pipe.dispatch(baseAction({ operation: 'read_file' }), { parentToken: forged });
    expect(res.decision).toBe('deny');
    expect(res.reason).toMatch(/forged/);
  });

  test('a child action exceeding the parent delegated authority is denied', async () => {
    // Owner policy lets a root delegate only 'read' to children.
    const outerPipe = makePipeline({ rootAuthority: { side_effect_classes: ['read'] } });
    const parent = await outerPipe.dispatch(baseAction({ operation: 'read_file' }));
    expect(parent.decision).toBe('allow');
    // The executor received parent.token; a nested mutate must be denied.
    const child = await outerPipe.dispatch(
      baseAction({ operation: 'write_file' }),
      { parentToken: parent.token, approval: undefined },
    );
    expect(child.decision).toBe('deny');
    expect(child.reason).toMatch(/exceeds delegated authority/);
  });

  test('a nested read child within delegated authority preserves causation', async () => {
    const pipe = makePipeline({ rootAuthority: { side_effect_classes: ['read'] } });
    const parent = await pipe.dispatch(baseAction({ operation: 'read_file' }));
    const child = await pipe.dispatch(baseAction({ operation: 'read_file', args: { path: '/y' } }), { parentToken: parent.token });
    expect(child.decision).toBe('allow');
    expect(child.action.parent_action_id).toBe(parent.action.action_id);
    expect(child.action.provenance.causation).toBe(parent.action.action_id);
  });

  test('the protected executor seam rejects a direct call with no valid token', async () => {
    const pipe = makePipeline();
    const action = pipe._normalise(baseAction({ operation: 'read_file' }), undefined);
    action.side_effect_class = 'read';
    await expect(pipe._protectedExecute(action, undefined)).rejects.toThrow(ActionDenied);
    const forged = { action_id: action.action_id, authority: { side_effect_classes: '*' }, expiry: clock + 1000, sig: 'bad' };
    await expect(pipe._protectedExecute(action, forged)).rejects.toThrow(/capability token/);
  });
});

describe('ADR-059 — execution wrappers and coverage', () => {
  test('an execution that outruns its deadline is denied at execute (timeout)', async () => {
    const executor = () => new Promise((resolve) => { const t = setTimeout(() => resolve({ ok: true }), 10_000); if (t.unref) t.unref(); });
    const pipe = makePipeline({ executor });
    const res = await pipe.dispatch(baseAction({ operation: 'read_file', deadline: clock + 20 }));
    expect(res.decision).toBe('deny');
    expect(res.stage).toBe('execute');
    expect(res.reason).toMatch(/deadline/);
  });

  test('coverage snapshot lists stages, classes and registered guards for /v1/system', () => {
    const pipe = makePipeline({ guards: [{ id: 'g1', guard: () => 'abstain' }] });
    const cov = pipe.coverage();
    expect(cov.stages).toHaveLength(9);
    expect(cov.never_fail_open).toEqual(expect.arrayContaining(['mutate', 'egress', 'secret', 'spend']));
    expect(cov.guards).toEqual(['g1']);
  });

  test('every terminal decision is linked to a journal event', async () => {
    const pair = makeJournal();
    const pipe = makePipeline({ journalPair: pair });
    const allow = await pipe.dispatch(baseAction({ operation: 'read_file' }));
    const deny = await pipe.dispatch(baseAction({ operation: 'write_file' })); // no approver → deny
    expect(allow.journal_event_id).toBeTruthy();
    expect(deny.journal_event_id).toBeTruthy();
    const outcomes = pair.envelopes().filter((e) => e.type === 'tool.completed').map((e) => e.payload.decision);
    expect(outcomes).toEqual(expect.arrayContaining(['allow', 'deny']));
  });
});
