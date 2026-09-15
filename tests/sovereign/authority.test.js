'use strict';

/**
 * Unit test for management-api/lib/authority.js — the action authority gate
 * (REC-6, PRD-019 / ADR-037 D2).
 *
 * Locks the three falsification clauses:
 *   1. a new/unclassified skill DEFAULTS to escalation-required, never permissive.
 *   2. a zero-tolerance action NEVER proceeds without a verified, approving,
 *      signed 31402/31403 response (fail-closed on timeout/unavailable/reject).
 *   3. the gate CONSUMES the forum's signed decision — it publishes a kind-31402
 *      request and never signs a kind-31403 response of its own.
 */

const authority = require('../../management-api/lib/authority');

// A manifest carrying the classification table (mirrors agentbox.toml [skills.authority]).
const MANIFEST = {
  skills: {
    authority: {
      enabled: true,
      default: 'escalation',
      classes: {
        research: 'recoverable',
        code_interpreter_exec: 'recoverable',
        ontology_axiom_load: 'zero-tolerance',
        payment_settlement: 'zero-tolerance',
        bogus: 'not-a-class', // malformed — must be ignored, falling to escalation
      },
    },
  },
};

// A signed ActionResponse (kind 31403) approving the request it references.
function signedResponse(requestId, outcome) {
  return {
    id: `resp-${requestId}`,
    kind: authority.ACTION_RESPONSE_KIND, // 31403
    pubkey: 'b'.repeat(64),
    content: JSON.stringify({ outcome, reason: 'human decided' }),
    tags: [['e', requestId], ['p', 'a'.repeat(64)]],
    sig: 'deadbeef',
  };
}

describe('authority — ACSP kind constants (single source of truth)', () => {
  test('produces 31402 requests, consumes 31403 responses', () => {
    expect(authority.ACTION_REQUEST_KIND).toBe(31402);
    expect(authority.ACTION_RESPONSE_KIND).toBe(31403);
  });
});

describe('authority.loadClassificationTable / classifyAction', () => {
  test('malformed class entries are dropped; enabled + default honoured', () => {
    const t = authority.loadClassificationTable(MANIFEST);
    expect(t.enabled).toBe(true);
    expect(t.default).toBe(authority.ESCALATION_REQUIRED);
    expect(t.classes.research).toBe('recoverable');
    expect(t.classes.ontology_axiom_load).toBe('zero-tolerance');
    expect(t.classes.bogus).toBeUndefined();
  });

  test('classifies known action classes from the config table', () => {
    const t = authority.loadClassificationTable(MANIFEST);
    expect(authority.classifyAction('research', { table: t })).toBe('recoverable');
    expect(authority.classifyAction('ontology_axiom_load', { table: t })).toBe('zero-tolerance');
  });

  test('FALSIFICATION 1: an unclassified action defaults to escalation-required, NOT permissive', () => {
    const t = authority.loadClassificationTable(MANIFEST);
    expect(authority.classifyAction('some_brand_new_skill', { table: t }))
      .toBe(authority.ESCALATION_REQUIRED);
    // a class that only carried a malformed value also escalates, never proceeds
    expect(authority.classifyAction('bogus', { table: t }))
      .toBe(authority.ESCALATION_REQUIRED);
  });

  test('SKILL.md frontmatter authority_class overrides the table', () => {
    const t = authority.loadClassificationTable(MANIFEST);
    // research is recoverable in the table, but a skill can escalate itself
    expect(authority.classifyAction('research', { table: t, frontmatter: { authority_class: 'zero-tolerance' } }))
      .toBe('zero-tolerance');
  });
});

describe('authority.buildAuthorityGate.guard', () => {
  test('a recoverable action proceeds with NO blocking wait and NO decision call', async () => {
    let awaited = false;
    const gate = authority.buildAuthorityGate(MANIFEST, {
      awaitDecision: async () => { awaited = true; return null; },
      publishActionRequest: async () => { throw new Error('should not publish for recoverable'); },
    });
    const r = await gate.guard({ operation: { kind: 'test-authority-operation' }, actionClass: 'research' });
    expect(r.decision).toBe('allow');
    expect(r.blocked).toBe(false);
    expect(r.authority_class).toBe('recoverable');
    expect(awaited).toBe(false);
  });

  test('a zero-tolerance action BLOCKS, publishes a 31402, and releases on a verified approve', async () => {
    const published = [];
    let requestId = 'req-1';
    const gate = authority.buildAuthorityGate(MANIFEST, {
      publishActionRequest: async (unsigned) => {
        published.push(unsigned);
        return { ...unsigned, id: requestId, sig: 'sig' };
      },
      awaitDecision: async (signedReq) => signedResponse(signedReq.id, 'approve'),
      verifyEvent: () => true,
    });
    const r = await gate.guard({ operation: { kind: 'test-authority-operation' }, actionClass: 'ontology_axiom_load', action: 'load axioms' });

    expect(published).toHaveLength(1);
    expect(published[0].kind).toBe(authority.ACTION_REQUEST_KIND); // it PRODUCED a 31402 request
    expect(r.decision).toBe('allow');
    expect(r.blocked).toBe(true);      // it blocked pending the signed response
    expect(r.released).toBe(true);     // and released on the approve
    expect(r.authority_class).toBe('zero-tolerance');
    expect(r.request_event_id).toBe(requestId);
    expect(r.response_event_id).toBe(`resp-${requestId}`);
    expect(r.outcome).toBe('approve');
  });

  test('FALSIFICATION 2a: a zero-tolerance action with NO decision surface is DENIED (fail-closed)', async () => {
    const gate = authority.buildAuthorityGate(MANIFEST, {
      // no awaitDecision wired
      publishActionRequest: async (u) => ({ ...u, id: 'req-x' }),
    });
    const r = await gate.guard({ operation: { kind: 'test-authority-operation' }, actionClass: 'payment_settlement' });
    expect(r.decision).toBe('deny');
    expect(r.released).toBe(false);
    expect(r.reason).toBe('no-decision-surface');
  });

  test('FALSIFICATION 2b: a timed-out / absent signed response DENIES, never proceeds', async () => {
    const gate = authority.buildAuthorityGate(MANIFEST, {
      publishActionRequest: async (u) => ({ ...u, id: 'req-2' }),
      awaitDecision: async () => null, // timeout / unavailable
      verifyEvent: () => true,
    });
    const r = await gate.guard({ operation: { kind: 'test-authority-operation' }, actionClass: 'ontology_axiom_load' });
    expect(r.decision).toBe('deny');
    expect(r.released).toBe(false);
    expect(r.reason).toBe('no-signed-response');
  });

  test('FALSIFICATION 2c: a REJECT decision denies the action', async () => {
    const gate = authority.buildAuthorityGate(MANIFEST, {
      publishActionRequest: async (u) => ({ ...u, id: 'req-3' }),
      awaitDecision: async (req) => signedResponse(req.id, 'reject'),
      verifyEvent: () => true,
    });
    const r = await gate.guard({ operation: { kind: 'test-authority-operation' }, actionClass: 'ontology_axiom_load' });
    expect(r.decision).toBe('deny');
    expect(r.released).toBe(false);
    expect(r.outcome).toBe('reject');
  });

  test('an UNVERIFIED signature denies (consume the forum signing, trust nothing blind)', async () => {
    const gate = authority.buildAuthorityGate(MANIFEST, {
      publishActionRequest: async (u) => ({ ...u, id: 'req-4' }),
      awaitDecision: async (req) => signedResponse(req.id, 'approve'),
      verifyEvent: () => false, // signature does not verify
    });
    const r = await gate.guard({ operation: { kind: 'test-authority-operation' }, actionClass: 'ontology_axiom_load' });
    expect(r.decision).toBe('deny');
    expect(r.reason).toBe('unverified-signature');
  });

  test('an unclassified action also escalates through the block-on-signed-response path', async () => {
    const published = [];
    const gate = authority.buildAuthorityGate(MANIFEST, {
      publishActionRequest: async (u) => { published.push(u); return { ...u, id: 'req-5' }; },
      awaitDecision: async (req) => signedResponse(req.id, 'approve'),
      verifyEvent: () => true,
    });
    const r = await gate.guard({ operation: { kind: 'test-authority-operation' }, actionClass: 'never_seen_before' });
    expect(r.authority_class).toBe(authority.ESCALATION_REQUIRED);
    expect(published).toHaveLength(1); // an unclassified action still blocks on a signed response
    expect(r.decision).toBe('allow');
    expect(r.blocked).toBe(true);
  });

  test('FALSIFICATION 3: the gate never signs a 31403 — it only builds 31402 requests', () => {
    // The module exposes no response-signing surface; the only event it builds is
    // the ActionRequest. This is a structural guard against reimplementing the broker.
    expect(typeof authority.buildAuthorityGate).toBe('function');
    expect(authority.buildActionResponse).toBeUndefined();
    expect(authority.signDecision).toBeUndefined();
  });
});

/**
 * EXP-AC-003 re-audit (auditor counter-example, evidence EXP-AC-003, commit 887679ff3).
 *
 * The defect: `classifyAction` let a SKILL.md frontmatter `authority_class` WIN
 * outright over the manifest's entry, so frontmatter `recoverable` on a
 * zero-tolerance action class (e.g. `ontology_axiom_load`) demoted the action to
 * an unblocked proceed and turned the ADR-2011 reversibility seed from
 * `irreversible` into `compensable`. The module docstring claimed tightening was
 * "an invariant, not a default"; these cases make that literally true.
 *
 * The rule locked here: frontmatter may only TIGHTEN a class the OPERATOR
 * declared in `agentbox.toml`. Where the operator declared nothing, frontmatter
 * is the sole declaration and still classifies (otherwise the frontmatter surface
 * could never be used at all) — but it can never loosen one that exists.
 */
describe('EXP-AC-003 — frontmatter authority_class may only TIGHTEN the manifest class', () => {
  const t = authority.loadClassificationTable(MANIFEST);

  test('COUNTER-EXAMPLE: zero-tolerance in the manifest is NOT loosened to recoverable by frontmatter', () => {
    expect(authority.classifyAction('ontology_axiom_load', {
      table: t,
      frontmatter: { authority_class: 'recoverable' },
    })).toBe('zero-tolerance');
  });

  test('tightening is still honoured: recoverable in the manifest → zero-tolerance on the skill', () => {
    expect(authority.classifyAction('research', {
      table: t,
      frontmatter: { authority_class: 'zero-tolerance' },
    })).toBe('zero-tolerance');
  });

  test('where the operator declared NOTHING, frontmatter is the sole declaration and classifies', () => {
    expect(authority.classifyAction('some_brand_new_skill', {
      table: t,
      frontmatter: { authority_class: 'recoverable' },
    })).toBe('recoverable');
    // ...and a malformed manifest entry is no declaration either
    expect(authority.classifyAction('bogus', {
      table: t,
      frontmatter: { authority_class: 'recoverable' },
    })).toBe('recoverable');
  });

  test('an ignored loosening is NAMED in a structured log line (action, manifest class, frontmatter class)', () => {
    const warnings = [];
    const cls = authority.classifyAction('payment_settlement', {
      table: t,
      frontmatter: { authority_class: 'recoverable' },
      logger: { warn: (fields, msg) => warnings.push({ fields, msg }) },
    });
    expect(cls).toBe('zero-tolerance');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].fields).toMatchObject({
      event: 'authority.frontmatter-loosening-ignored',
      action_class: 'payment_settlement',
      manifest_class: 'zero-tolerance',
      frontmatter_class: 'recoverable',
    });
  });

  test('a TIGHTENING frontmatter logs nothing — only a refused loosening is reported', () => {
    const warnings = [];
    authority.classifyAction('research', {
      table: t,
      frontmatter: { authority_class: 'zero-tolerance' },
      logger: { warn: (fields, msg) => warnings.push({ fields, msg }) },
    });
    expect(warnings).toHaveLength(0);
  });

  test('the onLoosening hook reports the attempt for callers that journal it', () => {
    const attempts = [];
    authority.classifyAction('pod_delete', {
      table: authority.loadClassificationTable({
        skills: { authority: { classes: { pod_delete: 'zero-tolerance' } } },
      }),
      frontmatter: { authority_class: 'recoverable' },
      onLoosening: (a) => attempts.push(a),
    });
    expect(attempts).toEqual([{
      action_class: 'pod_delete',
      manifest_class: 'zero-tolerance',
      frontmatter_class: 'recoverable',
    }]);
  });

  test('the gate BLOCKS a zero-tolerance action carrying a loosening frontmatter', async () => {
    const gate = authority.buildAuthorityGate(MANIFEST, {
      publishActionRequest: async () => { throw new Error('should not reach publish without a decision surface'); },
    });
    const r = await gate.guard({
      operation: { kind: 'test-authority-operation' },
      actionClass: 'ontology_axiom_load',
      frontmatter: { authority_class: 'recoverable' },
    });
    expect(r.decision).toBe('deny');
    expect(r.blocked).toBe(true);
    expect(r.authority_class).toBe('zero-tolerance');
    expect(r.task_properties.reversibility).toBe('irreversible');
  });

  test('the gate JOURNALS the refused loosening alongside the deny', async () => {
    const records = [];
    const gate = authority.buildAuthorityGate(MANIFEST, {
      journal: { append: async (r) => { records.push(r); } },
      agentDid: 'did:nostr:' + 'c'.repeat(64),
    });
    await gate.guard({
      operation: { kind: 'test-authority-operation' },
      actionClass: 'ontology_axiom_load',
      frontmatter: { authority_class: 'recoverable' },
    });
    const loosening = records.find((r) => r.type === 'authority.frontmatter-loosening-ignored');
    expect(loosening).toMatchObject({
      action_class: 'ontology_axiom_load',
      manifest_class: 'zero-tolerance',
      frontmatter_class: 'recoverable',
      agent_did: 'did:nostr:' + 'c'.repeat(64),
    });
    expect(records.some((r) => r.type === 'authority.deny')).toBe(true);
  });

  test('a journal that throws on the loosening record never converts the gate into an exception', async () => {
    const gate = authority.buildAuthorityGate(MANIFEST, {
      journal: { append: async () => { throw new Error('journal down'); } },
    });
    const r = await gate.guard({
      operation: { kind: 'test-authority-operation' },
      actionClass: 'ontology_axiom_load',
      frontmatter: { authority_class: 'recoverable' },
    });
    expect(r.decision).toBe('deny');
    expect(r.authority_class).toBe('zero-tolerance');
  });
});

/**
 * The load-bearing case: read against the REAL agentbox.toml, not a fixture, so
 * this fails if the manifest keys are wired to the wrong path even when the
 * fixture-driven cases pass.
 */
describe('EXP-AC-003 — against the REAL agentbox.toml', () => {
  const path = require('path');
  const REPO = path.resolve(__dirname, '../..');
  let realManifest;

  beforeAll(() => {
    process.env.AGENTBOX_MANIFEST_PATH = path.join(REPO, 'agentbox.toml');
    realManifest = require('../../management-api/adapters/manifest-loader').loadManifest();
  });

  test('ontology_axiom_load is zero-tolerance in the running manifest', () => {
    const t = authority.loadClassificationTable(realManifest);
    expect(t.classes.ontology_axiom_load).toBe('zero-tolerance');
  });

  test('COUNTER-EXAMPLE: a skill claiming authority_class=recoverable cannot demote it', () => {
    const t = authority.loadClassificationTable(realManifest);
    expect(authority.classifyAction('ontology_axiom_load', {
      table: t,
      frontmatter: { authority_class: 'recoverable' },
    })).toBe('zero-tolerance');
  });

  test('COUNTER-EXAMPLE: and the derived triple stays irreversible / opaque / critical', () => {
    const taskProperties = require('../../management-api/lib/task-properties');
    expect(taskProperties.derive('ontology_axiom_load', {
      manifest: realManifest,
      frontmatter: {
        authority_class: 'recoverable',
        task_properties: { verifiability: 'inspectable', reversibility: 'reversible', stakes: 'bounded' },
      },
    })).toEqual({ verifiability: 'opaque', reversibility: 'irreversible', stakes: 'critical' });
  });
});
