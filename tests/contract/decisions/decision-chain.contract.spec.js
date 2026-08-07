'use strict';

/**
 * Decision records + bounded decision-chain traversal — ADR-047 fixture family 4
 * (+ security cross-cuts), PRD-022 W-B / ADR-048.
 *
 * Black-box contract per ADR-047 rule 1: describe the behaviour WITHOUT
 * importing Semantica types, pairing examples with counter-examples. Pure /
 * loopback — no live VisionClaw, no network (the suite convention; a live
 * integration spec is the operator's serialized step).
 *
 * What is pinned here:
 *   1. Cross-language URN contract — the `decision` kind minted by
 *      management-api/lib/uris.js byte-matches the Rust decision_service goldens.
 *   2. Request-builder descriptors — record / trace / impact / similar / rules.
 *   3. Security cross-cuts — a client may not self-assert its deciding identity.
 *   4. Non-transitivity — a two-hop A→B→C chain never reports A→C as an asserted
 *      edge; reachability is derived, bounded, path-bearing, never "Whelk-classified".
 */

const dt = require('../../../mcp/servers/decision-tools.js');
const uris = require('../../../management-api/lib/uris');

const PK = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('ADR-048 — decision URN grammar (cross-language with uris.js)', () => {
  test('decision kind mints a scope-required content-addressed URN', () => {
    const u = uris.mint({ kind: 'decision', pubkey: PK, payload: { summary: 's', rationale: 'r' } });
    expect(u).toMatch(new RegExp(`^urn:agentbox:decision:${PK}:sha256-12-[0-9a-f]{12}$`));
  });

  // These goldens are the SAME constants asserted by the Rust
  // decision_service unit tests (src/services/decision_service.rs). If either
  // side drifts, decision URNs stop resolving across the JS/Rust boundary.
  test('golden: core {summary,rationale,proposalUrn} payload', () => {
    const u = uris.mint({
      kind: 'decision',
      pubkey: PK,
      payload: {
        summary: 'merge duplicate concepts',
        rationale: 'resolves DUPLICATE_CONCEPT',
        proposalUrn: 'urn:agentbox:activity:abc',
      },
    });
    expect(u).toBe(`urn:agentbox:decision:${PK}:sha256-12-9ec3d090ff23`);
  });

  test('golden: key order does not change the URN', () => {
    const u = uris.mint({ kind: 'decision', pubkey: PK, payload: { rationale: 'b', summary: 'a' } });
    expect(u).toBe(`urn:agentbox:decision:${PK}:sha256-12-5a783bf3b83f`);
  });

  test('golden: nested arrays / bools / null', () => {
    const u = uris.mint({
      kind: 'decision',
      pubkey: PK,
      payload: { summary: 's', rationale: 'r', proposalUrn: null, inputs: ['x', 'y'], n: 3, ok: true },
    });
    expect(u).toBe(`urn:agentbox:decision:${PK}:sha256-12-229db3cd9a71`);
  });

  test('decision URN requires the pubkey scope (identity, not a body field)', () => {
    expect(() => uris.mint({ kind: 'decision', payload: { summary: 's' } })).toThrow(/pubkey scope/);
  });
});

describe('record_decision descriptor', () => {
  test('builds the governed /api/decisions/record POST with camelCase body', () => {
    const d = dt.buildRecordDecisionRequest({
      summary: 'adopt native write door',
      rationale: 'closes the governance gap',
      proposal_urn: 'urn:agentbox:activity:p1',
      caused: ['urn:agentbox:decision:AA:sha256-12-aaa'],
      precedent_for: ['urn:agentbox:decision:AA:sha256-12-bbb'],
    });
    expect(d.path).toBe('/api/decisions/record');
    expect(d.method).toBe('POST');
    expect(d.body.summary).toBe('adopt native write door');
    expect(d.body.proposalUrn).toBe('urn:agentbox:activity:p1');
    expect(d.body.caused).toEqual(['urn:agentbox:decision:AA:sha256-12-aaa']);
    expect(d.body.precedentFor).toEqual(['urn:agentbox:decision:AA:sha256-12-bbb']);
    // Defaulted arrays.
    expect(d.body.influenced).toEqual([]);
    expect(d.body.consideredInputs).toEqual([]);
    expect(d.body.governedBy).toEqual([]);
  });

  test('absent proposal is null, not undefined', () => {
    const d = dt.buildRecordDecisionRequest({ summary: 's', rationale: 'r' });
    expect(d.body.proposalUrn).toBeNull();
  });

  test('requires summary and rationale', () => {
    expect(() => dt.buildRecordDecisionRequest({ rationale: 'r' })).toThrow(/summary/);
    expect(() => dt.buildRecordDecisionRequest({ summary: 's' })).toThrow(/rationale/);
  });

  // Security cross-cut (ADR-047 gate): the descriptor carries NO identity claim.
  test('the record body carries no agent/scope/pubkey identity claim', () => {
    const d = dt.buildRecordDecisionRequest({ summary: 's', rationale: 'r' });
    const keys = Object.keys(d.body);
    for (const forbidden of dt.FORBIDDEN_IDENTITY_FIELDS) {
      expect(keys).not.toContain(forbidden);
    }
    expect(d.body).not.toHaveProperty('agentContext');
  });

  test.each(dt.FORBIDDEN_IDENTITY_FIELDS)(
    'rejects client-supplied identity field: %s',
    (field) => {
      const args = { summary: 's', rationale: 'r' };
      args[field] = field === 'agent_context' || field === 'agentContext' ? { agent_id: 'x' } : 'attacker-key';
      expect(() => dt.buildRecordDecisionRequest(args)).toThrow(dt.DecisionError);
    }
  );
});

describe('trace_decision_chain / analyze_decision_impact descriptors', () => {
  const URN = 'urn:agentbox:decision:0011:sha256-12-abcdef012345';

  test('trace is a bounded GET on the URL-encoded root URN (ancestry)', () => {
    const d = dt.buildTraceRequest({ decision_urn: URN, max_depth: 4 });
    expect(d.method).toBe('GET');
    expect(d.path).toBe(`/api/decisions/${encodeURIComponent(URN)}/trace?max_depth=4`);
    // colons are percent-encoded so the URN stays a single path segment.
    expect(d.path).toContain(encodeURIComponent(URN));
    expect(d.path).not.toContain('&direction=');
  });

  test('impact reuses the trace endpoint with downstream direction', () => {
    const d = dt.buildImpactRequest({ decision_urn: URN, max_depth: 2 });
    expect(d.method).toBe('GET');
    expect(d.path).toBe(`/api/decisions/${encodeURIComponent(URN)}/trace?max_depth=2&direction=downstream`);
  });

  test('max_depth is bounded by the cap (no unbounded fan-out)', () => {
    const d = dt.buildTraceRequest({ decision_urn: URN, max_depth: 100000 });
    expect(d.path).toBe(`/api/decisions/${encodeURIComponent(URN)}/trace?max_depth=${dt.MAX_DEPTH_CAP}`);
  });

  test('missing max_depth defaults to the bounded default', () => {
    const d = dt.buildTraceRequest({ decision_urn: URN });
    expect(d.path).toContain(`max_depth=${dt.DEFAULT_MAX_DEPTH}`);
  });

  test('negative / garbage depth falls back to the default', () => {
    expect(dt.buildTraceRequest({ decision_urn: URN, max_depth: -5 }).path).toContain(
      `max_depth=${dt.DEFAULT_MAX_DEPTH}`
    );
    expect(dt.buildTraceRequest({ decision_urn: URN, max_depth: 'abc' }).path).toContain(
      `max_depth=${dt.DEFAULT_MAX_DEPTH}`
    );
  });

  test('trace requires a decision URN', () => {
    expect(() => dt.buildTraceRequest({})).toThrow(/decision_urn/);
  });
});

describe('find_similar_decisions / check_decision_rules descriptors', () => {
  test('similar targets memory_search namespace `decisions` (not an ontology query)', () => {
    const d = dt.buildSimilarDecisionsDescriptor({ summary: 'merge duplicates', limit: 5 });
    expect(d.tool).toBe('memory_search');
    expect(d.namespace).toBe('decisions');
    expect(d.query).toBe('merge duplicates');
    expect(d.limit).toBe(5);
    // It is emphatically NOT an HTTP descriptor.
    expect(d).not.toHaveProperty('path');
    expect(d).not.toHaveProperty('method');
  });

  test('check_decision_rules guards the caller through the governed propose gate', () => {
    const d = dt.buildCheckRulesDescriptor({ proposal: {} });
    expect(d.guarded).toBe(true);
    expect(d.error).toBe('decision_rules_via_propose');
    expect(d.message).toMatch(/propose/);
    // no direct write path is offered.
    expect(d).not.toHaveProperty('path');
  });
});

describe('tool schemas', () => {
  test('all five decision tools are advertised with closed input schemas', () => {
    const names = dt.DECISION_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'analyze_decision_impact',
        'check_decision_rules',
        'find_similar_decisions',
        'record_decision',
        'trace_decision_chain',
      ].sort()
    );
    for (const tool of dt.DECISION_TOOLS) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.inputSchema.additionalProperties).toBe(false);
    }
  });

  test('record_decision schema forbids identity fields via additionalProperties:false', () => {
    const props = Object.keys(dt.RECORD_DECISION_TOOL.inputSchema.properties);
    for (const forbidden of dt.FORBIDDEN_IDENTITY_FIELDS) {
      expect(props).not.toContain(forbidden);
    }
  });
});

// ── ADR-047 fixture family 4: causation is NOT transitive ────────────────────
//
// A compliant `GET /decisions/{A}/trace` response for the chain A→B→C (each a
// DIRECT dl:caused link). The fixture is what src/handlers/decision_handler.rs
// returns; the assertions pin the contract the Rust bounded_bfs guarantees.
describe('bounded traversal contract — non-transitivity (counter-example)', () => {
  const A = 'urn:agentbox:decision:0011:sha256-12-aaaaaaaaaaaa';
  const B = 'urn:agentbox:decision:0011:sha256-12-bbbbbbbbbbbb';
  const C = 'urn:agentbox:decision:0011:sha256-12-cccccccccccc';

  const traceResponse = {
    success: true,
    root: A,
    direction: 'downstream',
    maxDepth: 5,
    derived: true,
    hops: [
      { decisionUrn: A, depth: 0, path: [A] },
      { decisionUrn: B, depth: 1, path: [A, B] },
      { decisionUrn: C, depth: 2, path: [A, B, C] },
    ],
  };

  test('reachability is labelled derived, never asserted or "Whelk-classified"', () => {
    expect(traceResponse.derived).toBe(true);
    const blob = JSON.stringify(traceResponse).toLowerCase();
    expect(blob).not.toContain('whelk');
    expect(blob).not.toContain('classified');
    expect(blob).not.toContain('asserted');
  });

  test('A→C is NOT reported as a direct edge (two hops, path-bearing)', () => {
    const c = traceResponse.hops.find((h) => h.decisionUrn === C);
    expect(c.depth).toBe(2); // two direct hops, not one
    expect(c.path).toEqual([A, B, C]); // the supporting chain is explicit
    // No hop claims C reachable at depth 1 (that would imply a direct A→C).
    expect(traceResponse.hops.some((h) => h.decisionUrn === C && h.depth === 1)).toBe(false);
  });

  test('every hop carries a supporting path of length depth+1 rooted at A', () => {
    for (const h of traceResponse.hops) {
      expect(h.path).toHaveLength(h.depth + 1);
      expect(h.path[0]).toBe(A);
      expect(h.path[h.path.length - 1]).toBe(h.decisionUrn);
    }
  });

  test('traversal is bounded — a max_depth=1 view drops the depth-2 node', () => {
    const bounded = {
      ...traceResponse,
      maxDepth: 1,
      hops: traceResponse.hops.filter((h) => h.depth <= 1),
    };
    expect(bounded.hops.map((h) => h.decisionUrn)).toEqual([A, B]);
    expect(bounded.hops.some((h) => h.decisionUrn === C)).toBe(false);
  });
});
