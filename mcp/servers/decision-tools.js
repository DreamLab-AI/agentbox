'use strict';

/**
 * decision-tools — governed decision-record request builders for the ontology
 * bridge (PRD-022 W-B / ADR-048).
 *
 * Decisions are first-class, `did:nostr`-signed graph nodes in VisionClaw's
 * Oxigraph. This module builds the request DESCRIPTORS `{ path, method, body }`
 * (or a memory descriptor / guard error) for the five decision tools, mirroring
 * VisionClaw's decision handler contract. It is PURE + synchronous — no server,
 * no fetch, no SDK import — so it is unit-testable without a live VisionClaw and
 * `require()`-able by the bridge (exactly the `ontology-propose.js` pattern).
 *
 * The single non-negotiable rule (ADR-047 rule 2 / ADR-048 §Attribution): the
 * deciding identity is the AUTHENTICATED principal, derived server-side from the
 * NIP-98 / session pubkey. A client MUST NOT supply an agent/scope/pubkey field;
 * this builder REJECTS any such field rather than forwarding a self-asserted
 * identity. Decision URNs are minted server-side (and by `lib/uris.js`,
 * `kind: 'decision'`), never here.
 *
 * @see src/handlers/decision_handler.rs
 * @see src/services/decision_service.rs
 * @see agentbox/management-api/lib/uris.js (decision URN grammar)
 */

// Live routes. The `/api` prefix IS required — VisionClaw mounts
// `web::scope("/decisions")` nested inside `web::scope("/api")`, and
// VISIONCLAW_API_URL points directly at the server (no gateway rewrite),
// matching the sibling PROPOSE_PATH convention in ontology-propose.js.
const RECORD_PATH = '/api/decisions/record';

// Identity fields a client may NOT self-assert. The server binds attribution
// to the authenticated principal; any of these in the tool args is a hard error.
const FORBIDDEN_IDENTITY_FIELDS = Object.freeze([
  'agent_id',
  'agentId',
  'user_id',
  'userId',
  'pubkey',
  'scope',
  'did',
  'agent_context',
  'agentContext',
]);

const MAX_DEPTH_CAP = 64;
const DEFAULT_MAX_DEPTH = 5;

class DecisionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DecisionError';
  }
}

function assertNoClientIdentity(args = {}) {
  for (const field of FORBIDDEN_IDENTITY_FIELDS) {
    if (args[field] !== undefined && args[field] !== null) {
      throw new DecisionError(
        `decision: '${field}' may not be supplied by the client — the deciding ` +
          'identity is the authenticated did:nostr principal (ADR-048 §Attribution).'
      );
    }
  }
}

function asStringArray(v) {
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.length > 0) : [];
}

function clampDepth(v) {
  const n = Number.isFinite(v) ? Math.floor(v) : Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_MAX_DEPTH;
  return Math.min(n, MAX_DEPTH_CAP);
}

function requireUrn(args = {}) {
  const urn = args.decision_urn || args.decisionUrn || args.urn;
  if (!urn || typeof urn !== 'string') {
    throw new DecisionError("decision trace: 'decision_urn' is required");
  }
  return urn;
}

/**
 * Build the `record_decision` request descriptor. NO identity is placed in the
 * body — the server derives the URN scope from the authenticated pubkey.
 * @returns {{ path:string, method:string, body:object }}
 * @throws {DecisionError}
 */
function buildRecordDecisionRequest(args = {}, _env = process.env) {
  assertNoClientIdentity(args);
  for (const field of ['summary', 'rationale']) {
    if (!args[field] || typeof args[field] !== 'string') {
      throw new DecisionError(`record_decision: '${field}' is required`);
    }
  }
  const proposalUrn =
    typeof args.proposal_urn === 'string'
      ? args.proposal_urn
      : typeof args.proposalUrn === 'string'
        ? args.proposalUrn
        : null;

  return {
    path: RECORD_PATH,
    method: 'POST',
    body: {
      summary: args.summary,
      rationale: args.rationale,
      proposalUrn,
      caused: asStringArray(args.caused),
      precedentFor: asStringArray(args.precedent_for || args.precedentFor),
      influenced: asStringArray(args.influenced),
      consideredInputs: asStringArray(args.considered_inputs || args.consideredInputs),
      governedBy: asStringArray(args.governed_by || args.governedBy),
    },
  };
}

function traceDescriptor(urn, depth, direction) {
  let path = `/api/decisions/${encodeURIComponent(urn)}/trace?max_depth=${depth}`;
  if (direction === 'downstream') path += '&direction=downstream';
  return { path, method: 'GET' };
}

/**
 * Build the `trace_decision_chain` descriptor — bounded ANCESTRY over direct
 * `dl:caused`/`dl:precedentFor` links. The response is query-derived
 * (`derived: true`), never a materialised transitive edge.
 * @returns {{ path:string, method:string }}
 */
function buildTraceRequest(args = {}, _env = process.env) {
  const urn = requireUrn(args);
  const depth = clampDepth(args.max_depth ?? args.maxDepth ?? DEFAULT_MAX_DEPTH);
  return traceDescriptor(urn, depth, 'ancestry');
}

/**
 * Build the `analyze_decision_impact` descriptor — the bounded DOWNSTREAM blast
 * radius (what this decision caused), same endpoint, opposite direction. Also
 * derived and bounded; causation is not assumed transitive.
 * @returns {{ path:string, method:string }}
 */
function buildImpactRequest(args = {}, _env = process.env) {
  const urn = requireUrn(args);
  const depth = clampDepth(args.max_depth ?? args.maxDepth ?? DEFAULT_MAX_DEPTH);
  return traceDescriptor(urn, depth, 'downstream');
}

/**
 * Build the `find_similar_decisions` descriptor. Precedent DISCOVERY is
 * similarity search over decision summaries in RuVector — NOT an ontology query
 * (precedent REASONING is Whelk, ADR-048). This targets `memory_search`
 * namespace `decisions`, so it is a memory descriptor, not an HTTP one.
 * @returns {{ tool:string, namespace:string, query:string, limit:number }}
 */
function buildSimilarDecisionsDescriptor(args = {}, _env = process.env) {
  const summary = args.summary || args.query;
  if (!summary || typeof summary !== 'string') {
    throw new DecisionError("find_similar_decisions: 'summary' is required");
  }
  const limit = Number.isFinite(args.limit) ? Math.max(1, Math.min(50, Math.floor(args.limit))) : 10;
  return {
    tool: 'memory_search',
    namespace: 'decisions',
    query: summary,
    limit,
  };
}

/**
 * `check_decision_rules` — the SHACL-shape + Whelk-consistency policy gate that
 * composes with the W-A conflict gate. There is no standalone client endpoint:
 * the rules gate runs SERVER-SIDE inside the governed propose pipeline
 * (ADR-047 one-write-door), so the honest descriptor is a guard directing the
 * caller through `ontology_propose`. Mirrors the `axiomAddDescriptor` guard in
 * ontology-propose.js.
 * @returns {{ guarded:true, error:string, message:string }}
 */
function buildCheckRulesDescriptor(_args = {}, _env = process.env) {
  return {
    guarded: true,
    error: 'decision_rules_via_propose',
    message:
      'check_decision_rules (SHACL + Whelk consistency) is evaluated server-side ' +
      'inside the governed propose pipeline — it is not a separate client call. ' +
      'Submit the change through ontology_propose; the rules gate runs before commit.',
  };
}

// ── tool schemas ────────────────────────────────────────────────────────────

const RECORD_DECISION_TOOL = {
  name: 'record_decision',
  description:
    'Record a governed DecisionRecord as a first-class, did:nostr-signed graph ' +
    'node. Identity is the authenticated principal — do NOT supply agent/scope/' +
    'pubkey fields. Stores direct dl:caused/dl:precedentFor/dl:influenced edges ' +
    'as asserted truth; reachability stays query-derived.',
  inputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One-line decision summary' },
      rationale: { type: 'string', description: 'Why the decision was made' },
      proposal_urn: { type: 'string', description: 'Governed proposal this decision resolves' },
      caused: { type: 'array', items: { type: 'string' }, description: 'Decision URNs directly caused' },
      precedent_for: { type: 'array', items: { type: 'string' }, description: 'Decision URNs this is precedent for' },
      influenced: { type: 'array', items: { type: 'string' }, description: 'Decision URNs influenced' },
      considered_inputs: { type: 'array', items: { type: 'string' }, description: 'Fact/source URNs weighed' },
      governed_by: { type: 'array', items: { type: 'string' }, description: 'ACSP policy/shape URNs' },
    },
    required: ['summary', 'rationale'],
    additionalProperties: false,
  },
};

const TRACE_DECISION_CHAIN_TOOL = {
  name: 'trace_decision_chain',
  description:
    'Bounded ancestry over direct dl:caused/dl:precedentFor links. Returns hops ' +
    'with supporting paths; the result is query-derived (derived:true), never a ' +
    'materialised or Whelk-classified transitive edge. Causation is not transitive.',
  inputSchema: {
    type: 'object',
    properties: {
      decision_urn: { type: 'string', description: 'Root decision URN' },
      max_depth: { type: 'number', description: `Traversal bound (<= ${MAX_DEPTH_CAP})` },
    },
    required: ['decision_urn'],
    additionalProperties: false,
  },
};

const ANALYZE_DECISION_IMPACT_TOOL = {
  name: 'analyze_decision_impact',
  description:
    'Bounded downstream reachability (blast radius) — the decisions this one ' +
    'caused, for retraction impact analysis. Same derived, non-transitive, ' +
    'depth-bounded semantics as trace_decision_chain.',
  inputSchema: {
    type: 'object',
    properties: {
      decision_urn: { type: 'string', description: 'Root decision URN' },
      max_depth: { type: 'number', description: `Traversal bound (<= ${MAX_DEPTH_CAP})` },
    },
    required: ['decision_urn'],
    additionalProperties: false,
  },
};

const FIND_SIMILAR_DECISIONS_TOOL = {
  name: 'find_similar_decisions',
  description:
    'Precedent DISCOVERY via RuVector semantic search over decision summaries ' +
    '(namespace `decisions`). This is similarity, not ontology reasoning — ' +
    'precedent REASONING is Whelk (see trace_decision_chain).',
  inputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'Decision summary to find precedent for' },
      limit: { type: 'number', description: 'Max results (default 10)' },
    },
    required: ['summary'],
    additionalProperties: false,
  },
};

const CHECK_DECISION_RULES_TOOL = {
  name: 'check_decision_rules',
  description:
    'Policy gate (SHACL shapes + Whelk consistency) composing with the W-A ' +
    'conflict gate. Evaluated server-side inside the governed propose pipeline; ' +
    'this tool guides the caller through ontology_propose rather than mutating.',
  inputSchema: {
    type: 'object',
    properties: {
      proposal: { type: 'object', description: 'Proposal to check' },
    },
    additionalProperties: false,
  },
};

const DECISION_TOOLS = [
  RECORD_DECISION_TOOL,
  TRACE_DECISION_CHAIN_TOOL,
  ANALYZE_DECISION_IMPACT_TOOL,
  FIND_SIMILAR_DECISIONS_TOOL,
  CHECK_DECISION_RULES_TOOL,
];

module.exports = {
  DecisionError,
  RECORD_PATH,
  FORBIDDEN_IDENTITY_FIELDS,
  MAX_DEPTH_CAP,
  DEFAULT_MAX_DEPTH,
  buildRecordDecisionRequest,
  buildTraceRequest,
  buildImpactRequest,
  buildSimilarDecisionsDescriptor,
  buildCheckRulesDescriptor,
  RECORD_DECISION_TOOL,
  TRACE_DECISION_CHAIN_TOOL,
  ANALYZE_DECISION_IMPACT_TOOL,
  FIND_SIMILAR_DECISIONS_TOOL,
  CHECK_DECISION_RULES_TOOL,
  DECISION_TOOLS,
};
