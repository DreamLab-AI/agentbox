'use strict';

/**
 * WS6 (PRD-014 Seam D / D2, producer): personal-KG entries are scored for
 * elevation candidacy and each high-value candidate becomes (1) a GOVERNED
 * ontology-propose descriptor and (2) an agent-action LINK emit payload whose
 * target is the shared-ontology concept. Every URN is minted through the
 * sanctioned minters: lib/uris.js for the agentbox proposal node and
 * lib/bc20-provenance-bridge.js for the FOREIGN urn:visionclaw target — never
 * a hand-rolled template literal.
 */

const {
  ExtractError,
  normaliseEntry,
  normaliseLesson,
  scoreCandidate,
  buildProposalDescriptor,
  extractProposals,
} = require('../../management-api/lib/kg-proposal-extractor');
const { AgentActionType, agentEventPublisher } = require('../../management-api/utils/agent-event-publisher');
const uris = require('../../management-api/lib/uris');

const PUBKEY = 'a'.repeat(64);
const ENV = { AGENTBOX_X_ONLY_PUBKEY_HEX: PUBKEY, AGENTBOX_DID: `did:nostr:${PUBKEY}` };

const RICH = {
  key: 'photovoltaic-cell',
  value: {
    preferred_term: 'Photovoltaic Cell',
    definition: 'A semiconductor device that converts light directly into electricity via the photovoltaic effect.',
    domain: 'renewables',
    physicality: 'physical',
    role: 'energy-conversion',
  },
};
const THIN = { key: 'tldr', value: { term: 'x', definition: 'short' } };

describe('normaliseEntry', () => {
  it('coalesces preferred_term / definition / domain from an object value', () => {
    const n = normaliseEntry(RICH);
    expect(n.term).toBe('Photovoltaic Cell');
    expect(n.domain).toBe('renewables');
    expect(n.physicality).toBe('physical');
  });

  it('parses a JSON-string value', () => {
    const n = normaliseEntry({ key: 'k', value: JSON.stringify({ title: 'Tandem', description: 'desc' }) });
    expect(n.term).toBe('Tandem');
    expect(n.definition).toBe('desc');
  });

  it('treats a plain-text value as the definition', () => {
    const n = normaliseEntry({ key: 'note', value: 'just some prose' });
    expect(n.term).toBe('note');
    expect(n.definition).toBe('just some prose');
  });
});

describe('scoreCandidate — transparent deterministic heuristic', () => {
  it('scores a well-formed concept highly', () => {
    const s = scoreCandidate(normaliseEntry(RICH));
    expect(s.score).toBeGreaterThanOrEqual(0.9);
    expect(s.reasons).toEqual(expect.arrayContaining(['named', 'defined', 'substantive', 'domain-tagged', 'ontology-shaped']));
  });

  it('scores a thin entry below the default threshold', () => {
    expect(scoreCandidate(normaliseEntry(THIN)).score).toBeLessThan(0.6);
  });
});

describe('buildProposalDescriptor — sanctioned URN minting only', () => {
  const d = buildProposalDescriptor(normaliseEntry(RICH), scoreCandidate(normaliseEntry(RICH)), { ownerPubkey: PUBKEY, env: ENV });

  it('mints an owner-scoped agentbox proposal URN via uris.js', () => {
    expect(uris.isCanonical(d.proposal_urn)).toBe(true);
    const p = uris.parse(d.proposal_urn);
    expect(p.kind).toBe('thing');
    expect(p.pubkey).toBe(PUBKEY);
    expect(p.local).toMatch(/^proposal-sha256-12-[0-9a-f]{12}$/);
  });

  it('crosses the proposal node to a FOREIGN urn:visionclaw:kg id via the BC20 bridge', () => {
    expect(d.proposal_foreign_urn).toMatch(new RegExp(`^urn:visionclaw:kg:${PUBKEY}:sha256-12-[0-9a-f]{12}$`));
  });

  it('targets a domain-scoped urn:visionclaw:concept (the elevation target)', () => {
    expect(d.target_urn).toBe('urn:visionclaw:concept:renewables:photovoltaic-cell');
  });

  it('routes through the GOVERNED /api/ontology-agent/propose path (never /api/ontology/load)', () => {
    expect(d.propose_request.path).toBe('/api/ontology-agent/propose');
    expect(d.propose_request.method).toBe('POST');
    expect(d.propose_request.body.proposal.action).toBe('create');
    expect(d.propose_request.body.proposal.preferred_term).toBe('Photovoltaic Cell');
  });

  it('emits a LINK action carrying the foreign target_urn', () => {
    expect(d.emit.action_type).toBe(AgentActionType.LINK);
    expect(d.emit.target_urn).toBe(d.target_urn);
  });

  it('refuses to mint without a 64-hex owner pubkey', () => {
    expect(() => buildProposalDescriptor(normaliseEntry(RICH), scoreCandidate(normaliseEntry(RICH)), { ownerPubkey: 'short', env: {} }))
      .toThrow(ExtractError);
  });
});

describe('extractProposals + wire envelope', () => {
  it('accepts the rich entry, rejects the thin one, and renders the wire shape', () => {
    const { proposals, scanned, accepted } = extractProposals([RICH, THIN], { ownerPubkey: PUBKEY, env: ENV });
    expect(scanned).toBe(2);
    expect(accepted).toBe(1);

    const p = proposals[0];
    const ev = agentEventPublisher.emitAgentAction({
      source_agent_id: 99,
      target_node_id: 1234,
      action_type: p.emit.action_type,
      duration_ms: p.emit.duration_ms,
      metadata: p.emit.metadata,
      target_urn: p.emit.target_urn,
      source_urn: ENV.AGENTBOX_DID,
      pubkey: PUBKEY,
    });
    const n = agentEventPublisher.createMcpNotification(ev);

    expect(n.method).toBe('notifications/agent_action');
    expect(n.params.event.version).toBe(3);
    expect(n.params.event.action_type).toBe(AgentActionType.LINK);
    expect(n.params.event.action_type_name).toBe('link');
    expect(n.params.event.target_urn).toBe('urn:visionclaw:concept:renewables:photovoltaic-cell');
    expect(n.params.event.source_urn).toBe(ENV.AGENTBOX_DID);
    expect(n.params.message_type).toBe(0x23);
    expect(n.params.protocol_version).toBe(2);
    expect(n.params.event.metadata.origin).toBe('kg-elevation');
    expect(n.params.event.metadata.governed_path).toBe('/api/ontology-agent/propose');
  });

  it('throws on a non-array input', () => {
    expect(() => extractProposals('nope', { ownerPubkey: PUBKEY })).toThrow(ExtractError);
  });
});

/**
 * Task B: code-as-harness DistilledLesson records (mcp/expel/distil.py, written
 * to the `code-harness-lessons` namespace) FEED the SAME governed memory→concept
 * elevation pipeline. The lesson's own minted urn:agentbox:memory:lesson-* URN
 * is preserved as provenance — the experiential learning → governed ontology link.
 */
describe('code-as-harness lessons feed the governed pipeline', () => {
  const LESSON_URN = `urn:agentbox:memory:${PUBKEY}:lesson-deadbeefcafe`;
  // A lesson record exactly as distil.py writes its JSON value.
  const LESSON_JSON = {
    lesson_urn: LESSON_URN,
    ontology_type: 'ex:DistilledLesson',
    memory_type: 'semantic',
    rule: 'Verify adapter health before dispatch to avoid silent fallback writes',
    scope: PUBKEY,
    confidence: 0.72,
    evidence_claim: 'Three trajectories where a degraded memory adapter dropped lessons silently.',
    active: true,
  };
  // distil writes the stored value as "<rule> | <json>".
  const LESSON_ENTRY = {
    key: `lesson:${PUBKEY}:lesson-deadbeefcafe`,
    value: `${LESSON_JSON.rule} | ${JSON.stringify(LESSON_JSON)}`,
  };

  it('normaliseLesson recognises an ex:DistilledLesson object', () => {
    const n = normaliseLesson(LESSON_JSON);
    expect(n.term).toBe(LESSON_JSON.rule);
    expect(n.role).toBe('lesson');
    expect(n.domain).toBe('experiential');
    expect(n.lesson_urn).toBe(LESSON_URN);
    expect(n.confidence).toBe(0.72);
  });

  it('normaliseEntry recovers the JSON tail from the distil "<rule> | <json>" value', () => {
    const n = normaliseEntry(LESSON_ENTRY);
    expect(n.source).toBe('distilled-lesson');
    expect(n.term).toBe(LESSON_JSON.rule);
    expect(n.lesson_urn).toBe(LESSON_URN);
    expect(n.definition).toBe(LESSON_JSON.evidence_claim);
  });

  it('a substantive lesson scores as an elevation candidate', () => {
    expect(scoreCandidate(normaliseEntry(LESSON_ENTRY)).score).toBeGreaterThanOrEqual(0.6);
  });

  it('builds a GOVERNED proposal carrying the originating lesson URN as provenance', () => {
    const { proposals, accepted } = extractProposals([LESSON_ENTRY], { ownerPubkey: PUBKEY, env: ENV });
    expect(accepted).toBe(1);
    const p = proposals[0];

    // Same sanctioned governed path as the personal-KG candidates.
    expect(p.propose_request.path).toBe('/api/ontology-agent/propose');
    expect(uris.isCanonical(p.proposal_urn)).toBe(true);

    // The experiential→governed link: the lesson URN survives onto the
    // descriptor and into the beam metadata, with origin marked distilled-lesson.
    expect(p.source_lesson_urn).toBe(LESSON_URN);
    expect(p.emit.metadata.origin).toBe('distilled-lesson');
    expect(p.emit.metadata.source_lesson_urn).toBe(LESSON_URN);
    expect(p.emit.metadata.lesson_confidence).toBe(0.72);
  });

  it('personal-KG candidates carry no lesson provenance (null, origin kg-elevation)', () => {
    const { proposals } = extractProposals([RICH], { ownerPubkey: PUBKEY, env: ENV });
    expect(proposals[0].source_lesson_urn).toBeNull();
    expect(proposals[0].emit.metadata.origin).toBe('kg-elevation');
    expect(proposals[0].emit.metadata.source_lesson_urn).toBeUndefined();
  });
});
