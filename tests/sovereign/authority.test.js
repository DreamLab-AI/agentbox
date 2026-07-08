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
    const r = await gate.guard({ actionClass: 'research' });
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
    const r = await gate.guard({ actionClass: 'ontology_axiom_load', action: 'load axioms' });

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
    const r = await gate.guard({ actionClass: 'payment_settlement' });
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
    const r = await gate.guard({ actionClass: 'ontology_axiom_load' });
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
    const r = await gate.guard({ actionClass: 'ontology_axiom_load' });
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
    const r = await gate.guard({ actionClass: 'ontology_axiom_load' });
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
    const r = await gate.guard({ actionClass: 'never_seen_before' });
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
