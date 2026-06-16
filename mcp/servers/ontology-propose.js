'use strict';

/**
 * ontology-propose — governed concept-contribution helper for the ontology
 * bridge (PRD-014 Seam D / D2).
 *
 * Personal-KG concepts must reach the shared ontology through VisionClaw's
 * GOVERNED path: `POST /api/ontology-agent/propose` → Whelk consistency gate →
 * human approval → PR. The bridge previously POSTed axioms straight to
 * `/api/ontology/load`, bypassing every gate. This module:
 *
 *   - builds the `/api/ontology-agent/propose` request body (the `ontology_propose`
 *     tool) mirroring VisionClaw's ProposeRequest contract, defaulting the
 *     agent context from the agent's did:nostr environment; and
 *   - guards the ungoverned `/api/ontology/load` backdoor behind
 *     `AGENTBOX_ONTOLOGY_DIRECT_LOAD` (default off) so `ontology_axiom_add`
 *     refuses by default and points callers at the governed tool.
 *
 * Pure + synchronous: it returns request descriptors `{ path, method, body }`
 * (or a guard error) for the bridge to execute via fetch — so it is unit
 * testable without a live VisionClaw.
 *
 * @see PRD-014 §4.4  @see src/handlers/ontology_agent_handler.rs (propose)
 */

const DIRECT_LOAD_ENV = 'AGENTBOX_ONTOLOGY_DIRECT_LOAD';
// Live route is `/api/ontology-agent/propose`: the Rust handler registers
// `web::scope("/ontology-agent")` nested inside `web::scope("/api")`
// (main.rs:882 → ontology_agent_handler.rs:346), so the mount point carries the
// `/api` prefix. The bare `/ontology-agent/propose` 404s at the server — there
// is no gateway rewriting the boundary (VISIONCLAW_API_URL points directly at
// visionclaw-server:4000). Aligns with the sibling LOAD_PATH convention below.
const PROPOSE_PATH = '/api/ontology-agent/propose';
const LOAD_PATH = '/api/ontology/load';

class ProposeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ProposeError';
  }
}

function directLoadEnabled(env = process.env) {
  const v = String(env[DIRECT_LOAD_ENV] || '').toLowerCase();
  return v === 'true' || v === '1' || v === 'yes';
}

/**
 * Build the AgentContext, overlaying explicit args on did:nostr env defaults.
 * Every proposal is attributed to the agent's own identity.
 */
function buildAgentContext(args = {}, env = process.env) {
  const ctx = args.agent_context || {};
  const did = env.AGENTBOX_DID || env.AGENTBOX_URN || null;
  const agentId = ctx.agent_id || env.AGENTBOX_AGENT_ID || did;
  const userId = ctx.user_id || env.AGENTBOX_USER_ID || did;
  if (!agentId) {
    throw new ProposeError(
      'agent_context.agent_id is required (or set AGENTBOX_DID / AGENTBOX_AGENT_ID)'
    );
  }
  if (!userId) {
    throw new ProposeError(
      'agent_context.user_id is required (or set AGENTBOX_DID / AGENTBOX_USER_ID)'
    );
  }
  return {
    agent_id: agentId,
    agent_type: ctx.agent_type || env.AGENTBOX_AGENT_TYPE || 'agentbox-bridge',
    task_description: ctx.task_description || 'concept contribution via agentbox bridge',
    session_id: ctx.session_id || null,
    confidence: typeof ctx.confidence === 'number' ? ctx.confidence : 0.8,
    user_id: userId,
  };
}

function buildCreateProposal(p = {}) {
  for (const field of ['preferred_term', 'definition', 'owl_class', 'physicality', 'role', 'domain']) {
    if (!p[field] || typeof p[field] !== 'string') {
      throw new ProposeError(`create proposal: '${field}' is required`);
    }
  }
  return {
    action: 'create',
    preferred_term: p.preferred_term,
    definition: p.definition,
    owl_class: p.owl_class,
    physicality: p.physicality,
    role: p.role,
    domain: p.domain,
    is_subclass_of: Array.isArray(p.is_subclass_of) ? p.is_subclass_of : [],
    relationships: p.relationships && typeof p.relationships === 'object' ? p.relationships : {},
    alt_terms: Array.isArray(p.alt_terms) ? p.alt_terms : [],
    owner_user_id: p.owner_user_id || null,
  };
}

function buildAmendProposal(args = {}) {
  if (!args.target_iri || typeof args.target_iri !== 'string') {
    throw new ProposeError("amend proposal: 'target_iri' is required");
  }
  const a = args.amendment || {};
  return {
    action: 'amend',
    target_iri: args.target_iri,
    amendment: {
      add_relationships: a.add_relationships && typeof a.add_relationships === 'object' ? a.add_relationships : {},
      remove_relationships: a.remove_relationships && typeof a.remove_relationships === 'object' ? a.remove_relationships : {},
      update_definition: a.update_definition || null,
      update_quality_score: typeof a.update_quality_score === 'number' ? a.update_quality_score : null,
      add_alt_terms: Array.isArray(a.add_alt_terms) ? a.add_alt_terms : [],
      custom_fields: a.custom_fields && typeof a.custom_fields === 'object' ? a.custom_fields : {},
    },
  };
}

/**
 * Build the governed propose request descriptor from MCP tool args.
 * @returns {{ path:string, method:string, body:object }}
 * @throws {ProposeError}
 */
function buildProposeRequest(args = {}, env = process.env) {
  const action = args.action || (args.target_iri ? 'amend' : 'create');
  let proposal;
  if (action === 'create') {
    proposal = buildCreateProposal(args.proposal || args);
  } else if (action === 'amend') {
    proposal = buildAmendProposal(args);
  } else {
    throw new ProposeError(`unknown proposal action '${action}' (expected create | amend)`);
  }
  return {
    path: PROPOSE_PATH,
    method: 'POST',
    body: { proposal, agentContext: buildAgentContext(args, env) },
  };
}

/**
 * Guard `ontology_axiom_add`. Default: refuse and redirect to the governed
 * tool. Only when AGENTBOX_ONTOLOGY_DIRECT_LOAD is truthy does it return the
 * legacy `/api/ontology/load` descriptor.
 * @returns {{ guarded:true, error:string, message:string } | { path, method, body }}
 */
function axiomAddDescriptor(args = {}, env = process.env) {
  if (!directLoadEnabled(env)) {
    return {
      guarded: true,
      error: 'ontology_governance_required',
      message:
        'Direct axiom load bypasses the Whelk-consistency + human-approval + PR ' +
        'governance path and is disabled. Use the ontology_propose tool. To allow ' +
        `the ungoverned backdoor for admin/bootstrap, set ${DIRECT_LOAD_ENV}=true.`,
    };
  }
  return {
    path: LOAD_PATH,
    method: 'POST',
    body: {
      source: 'agentbox-bridge',
      format: 'axiom',
      validate_immediately: true,
      axioms: [{ axiom_type: args.axiom_type, subject: args.subject, object: args.object }],
    },
  };
}

const ONTOLOGY_PROPOSE_TOOL = {
  name: 'ontology_propose',
  description:
    'Propose a new ontology note (or amend an existing one) through the GOVERNED ' +
    'path: Whelk consistency gate → human approval → PR. This is the only sanctioned ' +
    'route for elevating a personal-KG concept into the shared ontology.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['create', 'amend'], description: 'create (default) | amend' },
      // create fields
      preferred_term: { type: 'string', description: 'Canonical term (create)' },
      definition: { type: 'string', description: 'Definition prose (create)' },
      owl_class: { type: 'string', description: 'OWL class IRI/slug (create)' },
      physicality: { type: 'string', description: 'physical | abstract | … (create)' },
      role: { type: 'string', description: 'Functional role (create)' },
      domain: { type: 'string', description: 'Source domain (create)' },
      is_subclass_of: { type: 'array', items: { type: 'string' }, description: 'Parent class IRIs (create)' },
      relationships: { type: 'object', description: 'Relationship → [target IRIs] (create)' },
      alt_terms: { type: 'array', items: { type: 'string' }, description: 'Synonyms (create)' },
      owner_user_id: { type: 'string', description: 'Note owner; defaults to the agent identity' },
      // amend fields
      target_iri: { type: 'string', description: 'IRI to amend (amend)' },
      amendment: { type: 'object', description: 'Amendment payload (amend)' },
      // attribution
      agent_context: {
        type: 'object',
        description: 'Agent attribution; agent_id/user_id default to AGENTBOX_DID',
      },
    },
    additionalProperties: false,
  },
};

module.exports = {
  ProposeError,
  DIRECT_LOAD_ENV,
  PROPOSE_PATH,
  LOAD_PATH,
  directLoadEnabled,
  buildAgentContext,
  buildProposeRequest,
  axiomAddDescriptor,
  ONTOLOGY_PROPOSE_TOOL,
};
