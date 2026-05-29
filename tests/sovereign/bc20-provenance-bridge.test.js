'use strict';

/**
 * WS5 (PRD-014 Seam E / E1): the BC20 ProvenanceBridge is the anti-corruption
 * layer between agentbox's `urn:agentbox:*` model and VisionClaw's
 * `urn:visionclaw:*` graph model. It must cross the federation boundary with
 * zero identity loss (B01), through a CLOSED kind map (B04), importing the
 * cross-namespace grammar in exactly one place (B05), validating the agentbox
 * side through uris.js (B02).
 *
 * Map (VisionClaw's converged grammar; no `agent` URN kind — an agent's
 * identity IS its did:nostr):
 *   activity → execution (content-addressed)   agent → did:nostr
 *   thing    → kg (owner-scoped)               memory → concept (domain:slug)
 */

const bc20 = require('../../management-api/lib/bc20-provenance-bridge');

const PK = 'a'.repeat(64);
const silent = () => {};

describe('the closed kind map (B04)', () => {
  it('maps exactly activity/thing/memory to execution/kg/concept and is bijective on those', () => {
    expect(bc20.AGENTBOX_TO_VISIONCLAW).toEqual({ activity: 'execution', thing: 'kg', memory: 'concept' });
    expect(bc20.VISIONCLAW_TO_AGENTBOX).toEqual({ execution: 'activity', kg: 'thing', concept: 'memory' });
  });

  it('drops (and logs) an unmapped agentbox kind rather than mis-mapping it', () => {
    const drops = [];
    const r = bc20.toVisionclaw(`urn:agentbox:receipt:${PK}:aci-7`, { onDrop: (reason) => drops.push(reason) });
    expect(r).toBeNull();
    expect(drops[0]).toMatch(/unmapped kind 'receipt'/);
  });

  it('drops a non-canonical input', () => {
    expect(bc20.toVisionclaw('not-a-urn', { onDrop: silent })).toBeNull();
  });
});

describe('activity → execution (content-addressed, owner via owner_did)', () => {
  const ab = `urn:agentbox:activity:${PK}:respond-42`;

  it('emits an unscoped content-addressed execution id and carries owner_did', () => {
    const r = bc20.toVisionclaw(ab);
    expect(r.visionclaw_id).toMatch(/^urn:visionclaw:execution:sha256-12-[0-9a-f]{12}$/);
    expect(r.mapping.owner_did).toBe(`did:nostr:${PK}`);
    expect(r.mapping.agentbox_urn).toBe(ab);
  });

  it('is deterministic', () => {
    expect(bc20.toVisionclaw(ab).visionclaw_id).toBe(bc20.toVisionclaw(ab).visionclaw_id);
  });

  it('round-trips through the UrnMapping store with zero identity loss (B01)', () => {
    expect(bc20.roundTrips(ab)).toBe(true);
  });

  it('cannot be reversed without the store (content-addressed)', () => {
    const r = bc20.toVisionclaw(ab);
    expect(bc20.toAgentbox(r.visionclaw_id, { onDrop: silent })).toBeNull();
  });
});

describe('agent → did:nostr (identity-bearing, structural round-trip)', () => {
  const ab = `urn:agentbox:agent:${PK}:librarian`;

  it('crosses as the bare DID, not a urn:visionclaw:agent', () => {
    const r = bc20.toVisionclaw(ab);
    expect(r.visionclaw_id).toBe(`did:nostr:${PK}`);
    expect(r.mapping.owner_did).toBe(`did:nostr:${PK}`);
  });

  it('recovers the exact source URN via the store, and the identity structurally without it', () => {
    expect(bc20.roundTrips(ab)).toBe(true);
    expect(bc20.toAgentbox(`did:nostr:${PK}`)).toBe(`urn:agentbox:agent:${PK}:_`);
  });

  it('drops an agent URN with no owner pubkey scope', () => {
    expect(bc20.toVisionclaw('urn:agentbox:agent:librarian', { onDrop: silent })).toBeNull();
  });
});

describe('thing(proposal) → kg (owner-scoped)', () => {
  const ab = `urn:agentbox:thing:${PK}:proposal-9`;

  it('emits an owner-scoped content-addressed kg id', () => {
    const r = bc20.toVisionclaw(ab);
    expect(r.visionclaw_id).toMatch(new RegExp(`^urn:visionclaw:kg:${PK}:sha256-12-[0-9a-f]{12}$`));
    expect(r.mapping.owner_did).toBe(`did:nostr:${PK}`);
  });

  it('round-trips through the store (B01)', () => {
    expect(bc20.roundTrips(ab)).toBe(true);
  });

  it('drops a thing URN with no owner pubkey scope', () => {
    expect(bc20.toVisionclaw('urn:agentbox:thing:proposal-9', { onDrop: silent })).toBeNull();
  });
});

describe('memory → concept (domain:slug, post-elevation)', () => {
  const ab = `urn:agentbox:memory:${PK}:lesson-deadbeef`;

  it('requires {domain, slug} and slugifies them', () => {
    expect(bc20.toVisionclaw(ab, { onDrop: silent })).toBeNull();
    const r = bc20.toVisionclaw(ab, { domain: 'Built Environment', slug: 'Photovoltaic Cell' });
    expect(r.visionclaw_id).toBe('urn:visionclaw:concept:built-environment:photovoltaic-cell');
  });

  it('round-trips through the store (B01)', () => {
    expect(bc20.roundTrips(ab, { domain: 'renewables', slug: 'pv-cell' })).toBe(true);
  });
});

describe('toAgentbox reverse guards', () => {
  it('drops a non-visionclaw identifier', () => {
    expect(bc20.toAgentbox('http://example/x', { onDrop: silent })).toBeNull();
  });

  it('drops an unmapped visionclaw kind', () => {
    expect(bc20.toAgentbox('urn:visionclaw:group:teamX#members', { onDrop: silent })).toBeNull();
  });
});

describe('crossOutbound persists the mapping', () => {
  it('translates and stores in one step, recoverable both directions', () => {
    const store = new bc20.InMemoryUrnMappingStore();
    const ab = `urn:agentbox:activity:${PK}:respond-1`;
    const mapping = bc20.crossOutbound(ab, store, {});
    expect(store.size).toBe(1);
    expect(store.getByAgentbox(ab)).toEqual(mapping);
    expect(bc20.toAgentbox(mapping.visionclaw_urn, { store })).toBe(ab);
  });

  it('returns null and stores nothing on a dropped crossing', () => {
    const store = new bc20.InMemoryUrnMappingStore();
    expect(bc20.crossOutbound(`urn:agentbox:receipt:${PK}:x`, store, { onDrop: silent })).toBeNull();
    expect(store.size).toBe(0);
  });

  it('rejects a malformed mapping on put', () => {
    const store = new bc20.InMemoryUrnMappingStore();
    expect(() => store.put({ agentbox_urn: 'x' })).toThrow(/requires/);
  });
});
