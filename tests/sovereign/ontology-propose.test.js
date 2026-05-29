'use strict';

/**
 * WS6 (PRD-014 Seam D / D2): personal-KG concepts reach the shared ontology
 * only through VisionClaw's GOVERNED path (`/ontology-agent/propose` → Whelk
 * consistency → human approval → PR). The ungoverned `/api/ontology/load`
 * backdoor in `ontology_axiom_add` is disabled by default and must be opted
 * into explicitly. The propose request body mirrors VisionClaw's ProposeRequest
 * DTO (camelCase outer keys, snake_case inner fields).
 */

const {
  ProposeError,
  DIRECT_LOAD_ENV,
  PROPOSE_PATH,
  LOAD_PATH,
  directLoadEnabled,
  buildAgentContext,
  buildProposeRequest,
  axiomAddDescriptor,
  ONTOLOGY_PROPOSE_TOOL,
} = require('../../mcp/servers/ontology-propose');

const DID = `did:nostr:${'a'.repeat(64)}`;

describe('directLoadEnabled', () => {
  it('defaults to false on an empty env', () => {
    expect(directLoadEnabled({})).toBe(false);
  });

  it('accepts true / 1 / yes (case-insensitive) and rejects everything else', () => {
    expect(directLoadEnabled({ [DIRECT_LOAD_ENV]: 'TRUE' })).toBe(true);
    expect(directLoadEnabled({ [DIRECT_LOAD_ENV]: '1' })).toBe(true);
    expect(directLoadEnabled({ [DIRECT_LOAD_ENV]: 'Yes' })).toBe(true);
    expect(directLoadEnabled({ [DIRECT_LOAD_ENV]: 'false' })).toBe(false);
    expect(directLoadEnabled({ [DIRECT_LOAD_ENV]: 'on' })).toBe(false);
  });
});

describe('buildAgentContext', () => {
  it('defaults agent_id/user_id from AGENTBOX_DID', () => {
    const ctx = buildAgentContext({}, { AGENTBOX_DID: DID });
    expect(ctx.agent_id).toBe(DID);
    expect(ctx.user_id).toBe(DID);
    expect(ctx.agent_type).toBe('agentbox-bridge');
    expect(ctx.confidence).toBe(0.8);
    expect(ctx.session_id).toBeNull();
  });

  it('lets explicit agent_context fields override env defaults', () => {
    const ctx = buildAgentContext(
      { agent_context: { agent_id: 'a1', user_id: 'u1', agent_type: 'librarian', confidence: 0.55, session_id: 's9' } },
      { AGENTBOX_DID: DID }
    );
    expect(ctx).toEqual({
      agent_id: 'a1',
      agent_type: 'librarian',
      task_description: 'concept contribution via agentbox bridge',
      session_id: 's9',
      confidence: 0.55,
      user_id: 'u1',
    });
  });

  it('throws when no agent identity can be resolved', () => {
    expect(() => buildAgentContext({}, {})).toThrow(ProposeError);
    expect(() => buildAgentContext({}, {})).toThrow(/agent_id is required/);
  });
});

describe('buildProposeRequest (create)', () => {
  const env = { AGENTBOX_DID: DID };
  const valid = {
    preferred_term: 'Photovoltaic Cell',
    definition: 'A device converting light into electricity.',
    owl_class: 'PhotovoltaicCell',
    physicality: 'physical',
    role: 'energy-conversion',
    domain: 'renewables',
  };

  it('builds the governed descriptor with camelCase outer + snake_case inner', () => {
    const r = buildProposeRequest(valid, env);
    expect(r.path).toBe(PROPOSE_PATH);
    expect(r.method).toBe('POST');
    expect(r.body.proposal.action).toBe('create');
    expect(r.body.proposal.preferred_term).toBe('Photovoltaic Cell');
    expect(r.body.proposal.is_subclass_of).toEqual([]);
    expect(r.body.proposal.relationships).toEqual({});
    expect(r.body.agentContext.agent_id).toBe(DID);
  });

  it('defaults action to create when no target_iri is present', () => {
    expect(buildProposeRequest(valid, env).body.proposal.action).toBe('create');
  });

  it('rejects a create proposal missing a required field', () => {
    const { definition, ...missing } = valid;
    expect(() => buildProposeRequest(missing, env)).toThrow(/'definition' is required/);
  });

  it('honours an explicit proposal envelope', () => {
    const r = buildProposeRequest({ action: 'create', proposal: valid }, env);
    expect(r.body.proposal.owl_class).toBe('PhotovoltaicCell');
  });
});

describe('buildProposeRequest (amend)', () => {
  const env = { AGENTBOX_DID: DID };

  it('infers amend from a target_iri and shapes the amendment payload', () => {
    const r = buildProposeRequest({
      target_iri: 'vc:onto/PhotovoltaicCell',
      amendment: { update_definition: 'Refined definition', add_alt_terms: ['solar cell'] },
    }, env);
    expect(r.body.proposal.action).toBe('amend');
    expect(r.body.proposal.target_iri).toBe('vc:onto/PhotovoltaicCell');
    expect(r.body.proposal.amendment.update_definition).toBe('Refined definition');
    expect(r.body.proposal.amendment.add_alt_terms).toEqual(['solar cell']);
    expect(r.body.proposal.amendment.add_relationships).toEqual({});
    expect(r.body.proposal.amendment.update_quality_score).toBeNull();
  });

  it('rejects an amend proposal with no target_iri', () => {
    expect(() => buildProposeRequest({ action: 'amend' }, env)).toThrow(/'target_iri' is required/);
  });
});

describe('buildProposeRequest (errors)', () => {
  it('rejects an unknown action', () => {
    expect(() => buildProposeRequest({ action: 'destroy' }, { AGENTBOX_DID: DID }))
      .toThrow(/unknown proposal action/);
  });
});

describe('axiomAddDescriptor', () => {
  const axiom = { axiom_type: 'SubClassOf', subject: 'vc:A', object: 'vc:B' };

  it('refuses by default and redirects to the governed tool', () => {
    const d = axiomAddDescriptor(axiom, {});
    expect(d.guarded).toBe(true);
    expect(d.error).toBe('ontology_governance_required');
    expect(d.message).toMatch(/ontology_propose/);
    expect(d.message).toContain(DIRECT_LOAD_ENV);
  });

  it('returns the legacy load descriptor only when the backdoor is enabled', () => {
    const d = axiomAddDescriptor(axiom, { [DIRECT_LOAD_ENV]: 'true' });
    expect(d.guarded).toBeUndefined();
    expect(d.path).toBe(LOAD_PATH);
    expect(d.method).toBe('POST');
    expect(d.body.format).toBe('axiom');
    expect(d.body.axioms).toEqual([axiom]);
  });
});

describe('ONTOLOGY_PROPOSE_TOOL', () => {
  it('advertises the governed propose tool with a closed schema', () => {
    expect(ONTOLOGY_PROPOSE_TOOL.name).toBe('ontology_propose');
    expect(ONTOLOGY_PROPOSE_TOOL.inputSchema.additionalProperties).toBe(false);
    expect(ONTOLOGY_PROPOSE_TOOL.description).toMatch(/GOVERNED/);
  });
});
