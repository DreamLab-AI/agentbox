'use strict';

/**
 * WS6 (PRD-014 Seam D / D2), as amended by ADR-2116: personal-KG concepts reach
 * the shared ontology only through the GOVERNED path — which is no longer an
 * HTTP POST. `vault propose <iri> --level content` runs Whelk and the conflict
 * detector as BLOCKERS and raises a forum kind-31402; a human's signed
 * kind-31403 applies it. `/api/ontology-agent/propose` now answers 410 Gone.
 *
 * The ungoverned `/api/ontology/load` backdoor in `ontology_axiom_add` is
 * unchanged: disabled by default, opted into explicitly.
 */

const {
  ProposeError,
  DIRECT_LOAD_ENV,
  IRI_NAMESPACE,
  LOAD_PATH,
  directLoadEnabled,
  buildAgentContext,
  buildVaultProposeCommand,
  axiomAddDescriptor,
  ONTOLOGY_PROPOSE_TOOL,
} = require('../../management-api/lib/ontology-propose');

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

describe('buildVaultProposeCommand (create)', () => {
  const env = { AGENTBOX_DID: DID };
  const valid = {
    preferred_term: 'Photovoltaic Cell',
    definition: 'A device converting light into electricity.',
    owl_class: 'PhotovoltaicCell',
    physicality: 'physical',
    role: 'energy-conversion',
    domain: 'renewables',
  };

  it('builds the C2 vault propose argv, dry-run by default', () => {
    const c = buildVaultProposeCommand(valid, env);
    expect(c.bin).toBe('vault');
    expect(c.iri).toBe(`${IRI_NAMESPACE}photovoltaic-cell`);
    expect(c.level).toBe('content');
    expect(c.dryRun).toBe(true);
    expect(c.argv).toEqual([
      'propose', `${IRI_NAMESPACE}photovoltaic-cell`,
      '--level', 'content',
      '--hypothesis', c.hypothesis,
      '--dry-run', '--json',
    ]);
    // The validated proposal and the attribution survive for the caller.
    expect(c.proposal.action).toBe('create');
    expect(c.proposal.preferred_term).toBe('Photovoltaic Cell');
    expect(c.proposal.is_subclass_of).toEqual([]);
    expect(c.proposal.relationships).toEqual({});
    expect(c.agentContext.agent_id).toBe(DID);
  });

  it('never targets the retired HTTP route', () => {
    const c = buildVaultProposeCommand(valid, env);
    expect(c.argv.join(' ')).not.toMatch(/ontology-agent/);
    expect(c).not.toHaveProperty('path');
    expect(c).not.toHaveProperty('method');
  });

  it('defaults action to create when no target_iri is present', () => {
    expect(buildVaultProposeCommand(valid, env).proposal.action).toBe('create');
  });

  it('rejects a create proposal missing a required field', () => {
    const { definition, ...missing } = valid;
    expect(() => buildVaultProposeCommand(missing, env)).toThrow(/'definition' is required/);
  });

  it('honours an explicit proposal envelope', () => {
    const c = buildVaultProposeCommand({ action: 'create', proposal: valid }, env);
    expect(c.proposal.owl_class).toBe('PhotovoltaicCell');
  });
});

describe('buildVaultProposeCommand (amend)', () => {
  const env = { AGENTBOX_DID: DID };

  it('infers amend from a target_iri and shapes the amendment payload', () => {
    const c = buildVaultProposeCommand({
      target_iri: 'urn:ngm:class:photovoltaic-cell',
      amendment: { update_definition: 'Refined definition', add_alt_terms: ['solar cell'] },
    }, env);
    expect(c.proposal.action).toBe('amend');
    expect(c.proposal.target_iri).toBe('urn:ngm:class:photovoltaic-cell');
    expect(c.proposal.amendment.update_definition).toBe('Refined definition');
    expect(c.proposal.amendment.add_alt_terms).toEqual(['solar cell']);
    expect(c.proposal.amendment.add_relationships).toEqual({});
    expect(c.proposal.amendment.update_quality_score).toBeNull();
    // An amend names its subject; nothing is minted for it.
    expect(c.iri).toBe('urn:ngm:class:photovoltaic-cell');
    expect(c.argv[1]).toBe('urn:ngm:class:photovoltaic-cell');
  });

  it('rejects an amend proposal with no target_iri', () => {
    expect(() => buildVaultProposeCommand({ action: 'amend' }, env)).toThrow(/'target_iri' is required/);
  });
});

describe('buildVaultProposeCommand (errors)', () => {
  it('rejects an unknown action', () => {
    expect(() => buildVaultProposeCommand({ action: 'destroy' }, { AGENTBOX_DID: DID }))
      .toThrow(/unknown proposal action/);
  });
});

describe('axiomAddDescriptor', () => {
  const axiom = { axiom_type: 'SubClassOf', subject: 'vc:A', object: 'vc:B' };

  it('refuses by default and redirects to the governed tool', () => {
    const d = axiomAddDescriptor(axiom, {});
    expect(d.guarded).toBe(true);
    expect(d.error).toBe('ontology_governance_required');
    expect(d.message).toMatch(/vault propose/);
    expect(d.message).toMatch(/human-signed 31403/);
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
