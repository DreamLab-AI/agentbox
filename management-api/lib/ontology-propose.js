'use strict';

/**
 * ontology-propose — governed concept-contribution helper for the KG-elevation
 * route (PRD-014 Seam D / D2).
 *
 * Relocated here from mcp/servers/ by ADR-2108. **Re-pointed at `vault propose`
 * by ADR-2109/ADR-2116**: it used to build a `POST /api/ontology-agent/propose`
 * request descriptor, and that route now answers 410 Gone. Ontology proposals
 * are forum ActionRequests signed by a human, not authenticated HTTP writes
 * (VisionFlow `PRD-sovereign-corpus` §3.3).
 *
 * What the descriptor was is why this mattered more than a dead fetch: nothing
 * in agentbox ever executed it. It was *handed out* — returned in the
 * KG-elevation response and baked into `fields.propose_request` of a **signed,
 * durable** kind-31402. Left alone, agentbox would have gone on publishing an
 * instruction to call a retired route into events nobody can edit.
 *
 * So this module now:
 *
 *   - mints the OKF `resource` IRI for a candidate (contract C1:
 *     `namespace + slug(title)`), using the SAME slug rule the apply path
 *     resolves with — see below, this is the load-bearing bit;
 *   - builds the `vault propose` argv (contract C2) as a pure descriptor; and
 *   - runs it via `$VAULT_BIN`, returning the `PatchProposal` (contract C4).
 *
 * It also still guards the ungoverned `/api/ontology/load` backdoor behind
 * `AGENTBOX_ONTOLOGY_DIRECT_LOAD` (default off).
 *
 * # The slug rule is shared on purpose
 *
 * `slugify` is imported from `./ontology-apply` rather than re-implemented.
 * The invariant that matters is that **the IRI we propose is an IRI the apply
 * path can resolve**: proposing `urn:ngm:class:rgb-d-camera` and then failing
 * to find it at promotion time would strand a human decision, and two copies
 * of a slug rule drift. One rule, two users.
 *
 * # Why dry-run by default
 *
 * `vault propose` posts a 31402 unless `--dry-run`. The KG-elevation path
 * already publishes its own governed ActionRequest through
 * `elevation-publisher`, so letting vault post a second would raise two cases
 * for one concept. The default here is therefore `--dry-run`: vault runs Whelk
 * and the conflict detector and returns the `PatchProposal` with its
 * `blockers`, and agentbox keeps its single publisher. Per C4, a proposal with
 * non-empty `blockers` is not posted at all — which is a gate the elevation
 * path did not previously have.
 *
 * Pure where it can be, async only where it shells out, so both halves are unit
 * testable against a stub `vault` on PATH.
 *
 * @see PRD-014 §4.4  @see ADR-2108  @see ADR-2109  @see VisionClaw ADR-2116
 * @see contracts C1 (slug), C2 (`vault propose`), C4 (`PatchProposal`)
 */

const { runVaultCommand, slugify } = require('./ontology-apply');

const DIRECT_LOAD_ENV = 'AGENTBOX_ONTOLOGY_DIRECT_LOAD';

/**
 * The OKF `resource` namespace (contract C1). Every knowledge-vault IRI is this
 * plus `slug(title)`, and `vault propose` takes exactly such an IRI.
 */
const IRI_NAMESPACE = 'urn:ngm:class:';

/**
 * The retired route, kept ONLY so a stale caller's descriptor can be recognised
 * and so the 410 it now returns is traceable to a name rather than a mystery
 * URL. Nothing builds a request against it.
 * @deprecated ADR-2116 — use {@link buildVaultProposeCommand}.
 */
const RETIRED_PROPOSE_PATH = '/api/ontology-agent/propose';

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
 * The OKF `resource` IRI for a proposal (contract C1).
 *
 * An `amend` names its target directly; a `create` mints one from the preferred
 * term with the shared slug rule. A caller-supplied IRI is honoured as-is —
 * `vault propose` is the authority on whether it resolves, not this.
 *
 * @throws {ProposeError} when neither a term nor a target IRI is available
 */
function proposalIri(proposal = {}, args = {}) {
  const explicit = args.iri || proposal.target_iri || args.target_iri;
  if (explicit) return String(explicit);
  const term = proposal.preferred_term;
  if (!term) {
    throw new ProposeError("cannot mint an IRI: neither 'iri' nor 'preferred_term' was supplied");
  }
  const slug = slugify(term);
  if (!slug) {
    throw new ProposeError(`cannot mint an IRI: '${term}' slugs to the empty string`);
  }
  return IRI_NAMESPACE + slug;
}

/**
 * The hypothesis a `PatchProposal` carries — the one falsifiable sentence the
 * human is being asked to agree or disagree with.
 *
 * Built from the candidate rather than left blank, because a reviewer who
 * cannot tell what claim they are signing off has nothing to judge. The agent
 * context supplies the attribution half.
 */
function buildHypothesis(proposal = {}, args = {}, env = process.env) {
  if (args.hypothesis) return String(args.hypothesis);
  const ctx = buildAgentContext(args, env);
  if (proposal.action === 'amend') {
    return `${ctx.agent_id} proposes amending ${proposal.target_iri} on the evidence of its personal-KG usage.`;
  }
  const term = proposal.preferred_term;
  const domain = proposal.domain ? ` in the ${proposal.domain} domain` : '';
  return `'${term}' is a distinct, reusable concept${domain} that belongs in the shared corpus. `
    + `Proposed by ${ctx.agent_id} (confidence ${ctx.confidence}).`;
}

/**
 * Build the `vault propose` invocation for a candidate (contract C2).
 *
 * Pure and synchronous — it shells out to nothing — so the argv is asserted in
 * a unit test without a vault, exactly as the old HTTP descriptor was asserted
 * without a VisionClaw.
 *
 * `--dry-run` is the default: see the module header. Pass `{ post: true }` to
 * let vault publish the 31402 itself.
 *
 * @returns {{ bin:string, argv:string[], iri:string, level:string,
 *             hypothesis:string, proposal:object, agentContext:object, dryRun:boolean }}
 * @throws {ProposeError}
 */
function buildVaultProposeCommand(args = {}, env = process.env) {
  const action = args.action || (args.target_iri ? 'amend' : 'create');
  let proposal;
  if (action === 'create') {
    proposal = buildCreateProposal(args.proposal || args);
  } else if (action === 'amend') {
    proposal = buildAmendProposal(args);
  } else {
    throw new ProposeError(`unknown proposal action '${action}' (expected create | amend)`);
  }

  // An elevation is a CONTENT proposal. It adds or amends one page's own
  // assertions; it does not touch `vocabulary.yaml` or move a page in the class
  // hierarchy, which is what `schema` means and what floors a case at tier
  // High. Claiming `schema` here would raise the tier of every elevation and
  // make the floor meaningless for the changes that actually earn it.
  const level = args.level || 'content';
  if (level !== 'content' && level !== 'schema') {
    throw new ProposeError(`unknown proposal level '${level}' (expected content | schema)`);
  }

  const iri = proposalIri(proposal, args);
  const hypothesis = buildHypothesis(proposal, args, env);
  const dryRun = args.post !== true;

  const argv = ['propose', iri, '--level', level, '--hypothesis', hypothesis];
  if (args.diff) argv.push('--diff', String(args.diff));
  // A grouped proposal (a --diff DIRECTORY of several pages) is named by its
  // title: vault mints its subject as urn:ngm:proposal:<slug(title)>.
  if (args.title) argv.push('--title', String(args.title));
  if (dryRun) argv.push('--dry-run');
  argv.push('--json');

  return {
    bin: env.VAULT_BIN || 'vault',
    argv,
    iri,
    level,
    hypothesis,
    dryRun,
    proposal,
    agentContext: buildAgentContext(args, env),
  };
}

/**
 * Run `vault propose` and return its `PatchProposal` (contract C4).
 *
 * `blockers` non-empty means Whelk found an inconsistency, or the conflict
 * detector found a subclass cycle, a relation contradiction or a vocabulary
 * violation. Per C4 such a proposal is **not posted** — it is not a decision
 * for a human to make, because an inconsistent ontology is not approvable. The
 * caller gets the blockers so it can say why rather than failing silently.
 *
 * @returns {Promise<{command:object, proposal:object|null, event:object|null,
 *                    blockers:string[], blocked:boolean, error:string|null}>}
 */
async function runVaultPropose(args = {}, deps = {}) {
  const env = deps.env || process.env;
  const runVault = deps.runVault || runVaultCommand;
  const command = buildVaultProposeCommand(args, env);
  try {
    const out = await runVault(command.argv);
    const doc = out && typeof out === 'object' && !Array.isArray(out) ? out : null;
    // The real `vault propose --json` prints `{proposal: PatchProposal, event:
    // 31402}`; a bare PatchProposal is still accepted. Reading `blockers` off
    // the wrapper instead of the proposal would make this gate blind — every
    // real proposal would look unblocked.
    const patch = doc && doc.proposal && typeof doc.proposal === 'object' ? doc.proposal : doc;
    const event = doc && doc.event && typeof doc.event === 'object' ? doc.event : null;
    const blockers = patch && Array.isArray(patch.blockers) ? patch.blockers : [];
    return { command, proposal: patch, event, blockers, blocked: blockers.length > 0, error: null };
  } catch (err) {
    // A vault that refuses is not a crash in the elevation scan: the scan's job
    // is to surface candidates, and one that cannot be proposed is reported as
    // such rather than taking the whole sweep down.
    return {
      command,
      proposal: null,
      event: null,
      blockers: [],
      blocked: true,
      error: String((err && err.message) || err),
    };
  }
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
        'Direct axiom load bypasses the Whelk-consistency + human-signature ' +
        'governance path and is disabled. Run `vault propose <iri> --level ' +
        'content|schema`, which runs the blockers and raises a forum 31402 for a ' +
        'human-signed 31403 (ADR-2116). To allow the ungoverned backdoor for ' +
        `admin/bootstrap, set ${DIRECT_LOAD_ENV}=true.`,
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
    'path: `vault propose` runs the Whelk consistency gate and the conflict ' +
    'detector as blockers, then a forum kind-31402 carries it to a human whose ' +
    'signed kind-31403 applies it. This is the only sanctioned route for ' +
    'elevating a personal-KG concept into the shared ontology.',
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
      // proposal framing (contract C2/C4)
      level: { type: 'string', enum: ['content', 'schema'], description: 'content (default) | schema' },
      hypothesis: { type: 'string', description: 'The falsifiable claim the human is asked to judge' },
      iri: { type: 'string', description: 'Override the minted OKF resource IRI' },
      post: { type: 'boolean', description: 'Let vault publish the 31402 itself (default: dry-run)' },
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
  IRI_NAMESPACE,
  RETIRED_PROPOSE_PATH,
  LOAD_PATH,
  directLoadEnabled,
  buildAgentContext,
  proposalIri,
  buildHypothesis,
  buildVaultProposeCommand,
  runVaultPropose,
  axiomAddDescriptor,
  ONTOLOGY_PROPOSE_TOOL,
};
