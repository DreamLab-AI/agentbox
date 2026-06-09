'use strict';

/**
 * BC20 / A4 ProvenanceBridge — agentbox-side reference of the anti-corruption
 * layer (DDD-012 §A4, ADR-026 D1, PRD-014 Seam E / E1).
 *
 * VisionClaw's `src/uri` minter (kinds: concept | group | kg | bead |
 * execution | did) is converged across agent worktrees but not yet merged to
 * main — main still carries the legacy `urn:ngm` scheme. Until it merges, THIS
 * module plus its tests are the executable definition of the cross-namespace
 * contract the VisionClaw ingest path must conform to.
 *
 * The map (matches VisionClaw's converged `urn:visionclaw` grammar). There is
 * deliberately NO `agent` URN kind: an agent's identity IS its `did:nostr`, so
 * an agentbox agent crosses as the bare DID rather than a relabelled URN.
 *
 *   urn:agentbox:activity:<pubkey>:<verb>-<id>  → urn:visionclaw:execution:<sha256-12>
 *   urn:agentbox:agent:<pubkey>:<name>          → did:nostr:<pubkey>
 *   urn:agentbox:thing:<pubkey>:proposal-<id>   → urn:visionclaw:kg:<pubkey>:<sha256-12>
 *   urn:agentbox:memory:<pubkey>:lesson-<hash>  → urn:visionclaw:concept:<domain>:<slug>
 *   urn:agentbox:bead:<pubkey>:<sha256-12>      → urn:visionclaw:bead:<pubkey>:<sha256-12> (pass-through)
 *
 * Discipline (DDD-012 invariants):
 *  - B05: the ONLY module importing the cross-namespace (urn:visionclaw)
 *    grammar. BC22 aggregates elsewhere speak typed urn:agentbox value objects.
 *  - B04: the kind map is CLOSED. An unmapped kind is dropped + logged, never
 *    silently mis-mapped.
 *  - B02: agentbox URNs are parsed/validated through lib/uris.js; this module
 *    never fabricates an ad-hoc urn:agentbox identifier.
 *  - B01: provenance is continuous + bidirectional, injective per owner_did.
 *    Where the VisionClaw kind is content-addressed (execution, kg) the local
 *    is a fresh sha256-12 and the original urn:agentbox identity is recovered
 *    from a durable UrnMapping store; where it is identity-bearing (agent →
 *    did:nostr) the pubkey round-trips structurally.
 *  - B03: pure + synchronous. The fail-open posture lives at the network
 *    boundary (VisionClaw ingest), not here — this reference never calls a peer.
 */

const crypto = require('crypto');
const uris = require('./uris');

// Closed kind map (B04). `agent` is special-cased to did:nostr (no URN kind).
// `bead` crosses structurally: both grammars are <pubkey>:<sha256-12> now that
// agentbox beads are content-addressed (uris.js), so the local passes through
// unchanged — content identity is preserved across the boundary and the
// crossing round-trips without a UrnMapping store (audit 2026-06-09 A3).
const AGENTBOX_TO_VISIONCLAW = Object.freeze({
  activity: 'execution',
  thing: 'kg',
  memory: 'concept',
  bead: 'bead',
});
const VISIONCLAW_TO_AGENTBOX = Object.freeze({
  execution: 'activity',
  kg: 'thing',
  concept: 'memory',
  bead: 'bead',
});

const PUBKEY_HEX_RE = /^[0-9a-f]{64}$/;
const VC_URN_RE = /^urn:visionclaw:([a-z]+):(.+)$/;

function sha12(input) {
  const hex = crypto.createHash('sha256').update(String(input), 'utf8').digest('hex');
  return `sha256-12-${hex.slice(0, 12)}`;
}

function slugify(s) {
  return String(s).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

function defaultLog(reason, urn) {
  // B04: dropped crossings are logged, never silent.
  try { process.stderr.write(`[bc20] drop: ${reason} (${urn})\n`); } catch { /* noop */ }
}

/**
 * Translate an agentbox URN to its VisionClaw identifier plus the UrnMapping
 * that lets the crossing round-trip. Returns null (and logs) on an unmapped
 * kind or a non-canonical input (B04).
 *
 * @param {string} agentboxUrn
 * @param {object} [opts]
 * @param {string} [opts.domain] required for memory→concept (the elevation domain)
 * @param {string} [opts.slug]   required for memory→concept (the concept slug)
 * @param {function} [opts.onDrop] (reason, urn) => void  (defaults to stderr log)
 * @returns {{ visionclaw_id:string, mapping:{agentbox_urn:string, visionclaw_urn:string, owner_did:string|null} } | null}
 */
function toVisionclaw(agentboxUrn, opts = {}) {
  const onDrop = opts.onDrop || defaultLog;
  const parsed = uris.parse(agentboxUrn); // B02
  if (!parsed || parsed.scheme !== 'urn') {
    onDrop('not a canonical urn:agentbox URI', agentboxUrn);
    return null;
  }
  const ownerDid = parsed.pubkey ? `did:nostr:${parsed.pubkey}` : null;

  // agent → did:nostr (identity-bearing; structural round-trip on the pubkey)
  if (parsed.kind === 'agent') {
    if (!parsed.pubkey || !PUBKEY_HEX_RE.test(parsed.pubkey)) {
      onDrop('agent crossing needs a 64-hex owner pubkey scope', agentboxUrn);
      return null;
    }
    const vc = `did:nostr:${parsed.pubkey}`;
    return { visionclaw_id: vc, mapping: { agentbox_urn: agentboxUrn, visionclaw_urn: vc, owner_did: ownerDid } };
  }

  const vcKind = AGENTBOX_TO_VISIONCLAW[parsed.kind];
  if (!vcKind) {
    onDrop(`unmapped kind '${parsed.kind}'`, agentboxUrn);
    return null;
  }

  let vc;
  if (vcKind === 'execution') {
    // content-addressed, unscoped — owner travels in owner_did + the mapping
    vc = `urn:visionclaw:execution:${sha12(agentboxUrn)}`;
  } else if (vcKind === 'bead') {
    // structural pass-through: agentbox bead locals are already sha256-12
    // content addresses, identical to VisionClaw's bead shape. Preserving the
    // local keeps content identity intact across the boundary (unlike
    // execution/kg, which re-hash the URN string).
    if (!parsed.pubkey || !PUBKEY_HEX_RE.test(parsed.pubkey)) {
      onDrop('bead crossing needs a 64-hex owner pubkey scope', agentboxUrn);
      return null;
    }
    if (!/^sha256-12-[0-9a-f]{12}$/.test(parsed.local)) {
      onDrop('bead crossing needs a sha256-12 content-addressed local', agentboxUrn);
      return null;
    }
    vc = `urn:visionclaw:bead:${parsed.pubkey}:${parsed.local}`;
  } else if (vcKind === 'kg') {
    if (!parsed.pubkey || !PUBKEY_HEX_RE.test(parsed.pubkey)) {
      onDrop('kg crossing needs a 64-hex owner pubkey scope', agentboxUrn);
      return null;
    }
    vc = `urn:visionclaw:kg:${parsed.pubkey}:${sha12(agentboxUrn)}`;
  } else { // concept
    if (!opts.domain || !opts.slug) {
      onDrop('concept crossing needs {domain, slug} (the elevation target)', agentboxUrn);
      return null;
    }
    vc = `urn:visionclaw:concept:${slugify(opts.domain)}:${slugify(opts.slug)}`;
  }

  return { visionclaw_id: vc, mapping: { agentbox_urn: agentboxUrn, visionclaw_urn: vc, owner_did: ownerDid } };
}

/**
 * Recover the agentbox URN for a VisionClaw identifier. did:nostr round-trips
 * structurally (identity preserved); content-addressed kinds (execution, kg)
 * and domain-scoped concept are recovered from the UrnMapping store the forward
 * crossing populated (B01). Returns null (and logs) when unrecoverable.
 *
 * @param {string} visionclawId
 * @param {object} [opts]
 * @param {{getByVisionclaw:function}} [opts.store]
 * @param {function} [opts.onDrop]
 * @returns {string|null}
 */
function toAgentbox(visionclawId, opts = {}) {
  const onDrop = opts.onDrop || defaultLog;
  const store = opts.store;

  const did = uris.parse(visionclawId);
  if (did && did.scheme === 'did' && did.method === 'nostr') {
    // did:nostr → the agent's identity is the pubkey. The human-readable name
    // is node metadata, not identity, so the exact source URN is recovered from
    // the store when present; otherwise a stable did-derived agent URN.
    if (store) {
      const hit = store.getByVisionclaw(visionclawId);
      if (hit) return hit.agentbox_urn;
    }
    return `urn:agentbox:agent:${did.pubkey}:_`;
  }

  const m = VC_URN_RE.exec(visionclawId || '');
  if (!m) {
    onDrop('not a urn:visionclaw identifier', visionclawId);
    return null;
  }
  const vcKind = m[1];
  if (!(vcKind in VISIONCLAW_TO_AGENTBOX)) {
    onDrop(`unmapped visionclaw kind '${vcKind}'`, visionclawId);
    return null;
  }
  if (store) {
    const hit = store.getByVisionclaw(visionclawId);
    if (hit) return hit.agentbox_urn;
  }
  if (vcKind === 'bead') {
    // structural recovery: both bead grammars are <pubkey>:<sha256-12>, so the
    // crossing reverses without a store (identity-preserving pass-through).
    const beadMatch = /^([0-9a-f]{64}):(sha256-12-[0-9a-f]{12})$/.exec(m[2]);
    if (beadMatch) return `urn:agentbox:bead:${beadMatch[1]}:${beadMatch[2]}`;
    onDrop('bead identifier is not <64-hex pubkey>:<sha256-12>', visionclawId);
    return null;
  }
  onDrop(`content-addressed ${vcKind} needs a UrnMapping store to recover the urn:agentbox source`, visionclawId);
  return null;
}

/**
 * Translate an agentbox URN and persist the UrnMapping into a store in one step
 * (the outbound federation crossing). Returns the UrnMapping or null on drop.
 */
function crossOutbound(agentboxUrn, store, opts = {}) {
  const res = toVisionclaw(agentboxUrn, opts);
  if (!res) return null;
  if (store) store.put(res.mapping);
  return res.mapping;
}

/**
 * B01 proof helper: cross out and back through a fresh store; true iff the
 * recovered agentbox URN equals the original (zero identity loss).
 */
function roundTrips(agentboxUrn, opts = {}) {
  const store = new InMemoryUrnMappingStore();
  const out = crossOutbound(agentboxUrn, store, opts);
  if (!out) return false;
  return toAgentbox(out.visionclaw_urn, { store }) === agentboxUrn;
}

/**
 * Durable UrnMapping table contract (DDD-012 §A4). VisionClaw owns the durable
 * implementation; this in-memory one backs the agentbox reference round-trip
 * and the test suite. Injective in both directions (last-writer-wins on a
 * VisionClaw id, which for did:nostr correctly collapses name variants of one
 * identity, per B01 "injective per owner_did").
 */
class InMemoryUrnMappingStore {
  constructor() {
    this._byAb = new Map();
    this._byVc = new Map();
  }
  put(mapping) {
    if (!mapping || !mapping.agentbox_urn || !mapping.visionclaw_urn) {
      throw new Error('UrnMapping requires agentbox_urn + visionclaw_urn');
    }
    this._byAb.set(mapping.agentbox_urn, mapping);
    this._byVc.set(mapping.visionclaw_urn, mapping);
    return mapping;
  }
  getByAgentbox(urn) { return this._byAb.get(urn) || null; }
  getByVisionclaw(id) { return this._byVc.get(id) || null; }
  get size() { return this._byAb.size; }
}

module.exports = {
  AGENTBOX_TO_VISIONCLAW,
  VISIONCLAW_TO_AGENTBOX,
  sha12,
  slugify,
  toVisionclaw,
  toAgentbox,
  crossOutbound,
  roundTrips,
  InMemoryUrnMappingStore,
};
