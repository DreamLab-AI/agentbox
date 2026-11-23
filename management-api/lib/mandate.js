'use strict';

/**
 * lib/mandate — scoped agent delegation mandates (PRD-014 Seam C / C3).
 *
 * A mandate is the signed, revocable record by which a user grants a
 * specific agent write/append authority over ONE knowledge-graph
 * container on their Solid pod. It exists so an autonomous agent never
 * has to hold the user's nsec: the agent writes under its OWN
 * `did:nostr`, and the pod's WAC resolves an `acl:agent <did:nostr:AGENT>`
 * grant that the mandate renders.
 *
 * The flow:
 *   1. `createMandate()` produces the canonical record + its
 *      `urn:agentbox:mandate` URN (minted through lib/uris — never ad hoc).
 *      The record names the owner `pod` (the issuer's pubkey) and a container
 *      inside it (`/pods/<pod>/…`).
 *   2. `lib/mandate-acl.js` renders the container's WHOLE WAC sidecar from the
 *      registry (owner block + one block per active mandate) and PUTs it at
 *      `<container-without-slash>.acl`, the layout solid-pod-rs reads.
 *   3. `buildMandateEvent()` / `signMandate()` wrap the record in a signed,
 *      parameterised-replaceable Nostr event; revocation republishes the same
 *      `d` tag with `status=revoked` (lib/mandate-revocation.js).
 *
 * Control is never delegated: it is not an allowed mode, and the sidecar always
 * keeps the owner's Control (AB-11, ADR amending ADR-043 D4.5).
 *
 * No new URN kind and no new identity primitive are introduced — `mandate`
 * is an existing kind (lib/uris KINDS), identity is `did:nostr`.
 *
 * @see PRD-014 §4.2  @see ADR-026  @see DDD-012 (BC22)
 */

const uris = require('./uris');

// Parameterised-replaceable kind reused for the mandate envelope. NIP-33
// addressable: the (pubkey, kind, d-tag) triple is replaceable, which is
// exactly the revocation semantics a mandate needs. Mirrors the AGENT_STATE
// kind in mcp/servers/nostr-bridge.js (30078) — not a new primitive.
const MANDATE_EVENT_KIND = 30078;

const PUBKEY_HEX_RE = /^[0-9a-f]{64}$/;
// Control is deliberately absent: a delegation never confers Control, or the
// grantee could re-delegate or seize the container (forum pod-zone ACL, ADR-096).
const ALLOWED_MODES = Object.freeze(['Read', 'Write', 'Append']);
const DEFAULT_MODES = Object.freeze(['Read', 'Write', 'Append']);

class MandateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MandateError';
  }
}

/**
 * Normalise a `did:nostr:<hex>` or bare 64-char hex pubkey to canonical
 * lowercase hex. Returns null for anything else.
 */
function normalisePubkey(value) {
  if (typeof value !== 'string') return null;
  const v = value.startsWith('did:nostr:') ? value.slice('did:nostr:'.length) : value;
  const lower = v.toLowerCase();
  return PUBKEY_HEX_RE.test(lower) ? lower : null;
}

function normaliseModes(modes) {
  const list = Array.isArray(modes) && modes.length ? modes : DEFAULT_MODES;
  const seen = new Set();
  const out = [];
  for (const m of list) {
    // Accept 'acl:Write' or 'Write'; capitalise canonical form.
    const bare = String(m).replace(/^acl:/, '');
    const canon = bare.charAt(0).toUpperCase() + bare.slice(1).toLowerCase();
    if (canon === 'Control') {
      throw new MandateError('acl:Control is never delegated by a mandate (the owner alone holds Control)');
    }
    if (!ALLOWED_MODES.includes(canon)) {
      throw new MandateError(`unsupported acl:mode "${m}" (allowed: ${ALLOWED_MODES.join(', ')})`);
    }
    if (!seen.has(canon)) {
      seen.add(canon);
      out.push(canon);
    }
  }
  return out;
}

/**
 * Characters a container path may use. Deliberately narrow: the value is
 * written into a Turtle IRI and into a pod URL, so anything that could close
 * the IRI (`>`), start a fragment/query, or smuggle a separator is refused.
 */
const CONTAINER_RE = /^\/[A-Za-z0-9._~\-/]*$/;

/**
 * A pod container path must be absolute, end in a slash, and be plain:
 * no dot segments (raw or encoded), no empty segments, no sidecar suffix.
 */
function normaliseContainer(container) {
  if (typeof container !== 'string' || !container.startsWith('/')) {
    throw new MandateError(`container must be an absolute pod path, got "${container}"`);
  }
  const path = container.endsWith('/') ? container : `${container}/`;
  if (!CONTAINER_RE.test(path)) {
    throw new MandateError('container may contain only letters, digits and . _ ~ - /');
  }
  const segments = path.split('/').slice(1, -1);
  for (const seg of segments) {
    if (seg === '' || seg.startsWith('.')) {
      // `.`, `..`, and every dot-leading name (.acl, .meta, .well-known, .git, hidden dirs).
      throw new MandateError('container must not contain empty or dot-leading segments');
    }
    if (/\.(acl|meta)$/i.test(seg)) {
      throw new MandateError('container must not name an .acl or .meta sidecar');
    }
  }
  return path;
}

/**
 * Normalise a container AND require it to sit strictly inside the owner's pod:
 * `/pods/<ownerHex>/<something>/`. The pod root itself is refused (a mandate
 * there would span the whole pod).
 *
 * @param {string} container
 * @param {string} ownerHex - the pod owner's x-only pubkey hex
 * @returns {string} the normalised container path
 */
function containerInPod(container, ownerHex) {
  const path = normaliseContainer(container);
  const prefix = `/pods/${ownerHex}/`;
  if (!path.startsWith(prefix) || path === prefix) {
    throw new MandateError(`container must be inside the issuer's pod (${prefix}<container>/), got "${path}"`);
  }
  return path;
}

/**
 * Do two containers overlap (equal, or one an ancestor of the other)?
 * A mandate (or its tombstone) on one governs the other through `acl:default`.
 */
function containersOverlap(a, b) {
  const x = normaliseContainer(a);
  const y = normaliseContainer(b);
  return x.startsWith(y) || y.startsWith(x);
}

/**
 * The lazy/session mandate scope: strictly below `/pods/<owner>/proj/`
 * (`proj/<slug>/…`). The `proj/` root itself is a parent of every session
 * container and is refused. Only the operator's explicit grant may go elsewhere.
 */
function assertProjContainer(container, ownerHex) {
  const path = containerInPod(container, ownerHex);
  const prefix = `/pods/${ownerHex}/proj/`;
  if (!path.startsWith(prefix) || path === prefix) {
    throw new MandateError(`a session mandate must be inside ${prefix}<slug>/, got "${path}"`);
  }
  return path;
}

/** The owning pod's pubkey hex for a record; old records derive it from `issuer`. */
function podOf(record) {
  if (!record) return null;
  return normalisePubkey(record.pod) || normalisePubkey(record.issuer);
}

/**
 * Create a scoped agent mandate record + its canonical URN.
 *
 * @param {object} args
 * @param {string} args.issuer    - Granting user (did:nostr or hex pubkey).
 * @param {string} args.agent     - Grantee agent (did:nostr or hex pubkey).
 * @param {string} args.container - Pod container path inside the issuer's pod
 *   (e.g. "/pods/<issuerHex>/proj/foo/").
 * @param {string} [args.pod]     - Owner pod pubkey; must equal the issuer when given.
 * @param {string[]} [args.modes=['Read','Write','Append']] - acl:mode names.
 * @param {number} [args.issuedAt]  - Unix seconds; defaults to now.
 * @param {number|null} [args.expiresAt=null] - Unix seconds, or null for no expiry.
 * @returns {{ urn: string, record: object }}
 */
function createMandate({ issuer, agent, container, modes, issuedAt, expiresAt, pod } = {}) {
  const issuerHex = normalisePubkey(issuer);
  if (!issuerHex) throw new MandateError(`bad issuer identity: ${issuer}`);
  const agentHex = normalisePubkey(agent);
  if (!agentHex) throw new MandateError(`bad agent identity: ${agent}`);

  // The owner already holds every mode; a mandate naming the owner as its own grantee is meaningless.
  if (agentHex === issuerHex) throw new MandateError('agent must not be the issuer (the pod owner)');
  // One authority per pod (design decision b): the issuer IS the pod owner.
  if (pod !== undefined && normalisePubkey(pod) !== issuerHex) {
    throw new MandateError('pod must be the issuer (a mandate is issued by the pod owner)');
  }
  const path = containerInPod(container, issuerHex);
  const modeList = normaliseModes(modes);
  const issued = Number.isInteger(issuedAt) ? issuedAt : Math.floor(Date.now() / 1000);
  const expires = expiresAt === undefined ? null : expiresAt;
  if (expires !== null && (!Number.isInteger(expires) || expires <= issued)) {
    throw new MandateError('expiresAt must be a Unix-seconds integer after issuedAt, or null');
  }

  const record = {
    issuer: `did:nostr:${issuerHex}`,
    agent: `did:nostr:${agentHex}`,
    pod: issuerHex,
    container: path,
    modes: modeList,
    issued_at: issued,
    expires_at: expires,
    revoked: false,
  };

  // Content-address the mandate, scoped to the issuer's pubkey.
  const urn = uris.mint({ kind: 'mandate', pubkey: issuerHex, payload: record });
  record.urn = urn;
  return { urn, record };
}

const MANDATE_STATUSES = Object.freeze(['active', 'revoked']);

/**
 * The `created_at` for a mandate event that must supersede an earlier one in
 * the same addressable slot: never earlier than now, and strictly later than
 * the event it replaces (relays keep the highest `created_at` per
 * `(pubkey, kind, d)`; a tie falls to the lower id, which is arbitrary).
 *
 * @param {number|undefined} afterCreatedAt - the grant event's created_at, if known
 * @param {number} [nowSec]
 * @returns {number}
 */
function mandateEventCreatedAt(afterCreatedAt, nowSec) {
  const now = Number.isInteger(nowSec) ? nowSec : Math.floor(Date.now() / 1000);
  return Number.isInteger(afterCreatedAt) ? Math.max(now, afterCreatedAt + 1) : now;
}

/**
 * Build the UNSIGNED kind-30078 envelope for a mandate record: tags
 * `d=<urn>`, `p=<agent>`, `t=agent-mandate`, `status=<active|revoked>`, plus
 * an `expiration` tag only when the mandate has a future expiry (relays reject
 * an event whose expiration has already passed, and an empty tag is noise).
 *
 * @param {object} record
 * @param {object} [opts]
 * @param {'active'|'revoked'} [opts.status='active']
 * @param {number} [opts.createdAt]      - explicit created_at (wins over the rest)
 * @param {number} [opts.afterCreatedAt] - created_at of the event this one supersedes
 * @param {number} [opts.nowSec]
 * @returns {object} unsigned event
 */
function buildMandateEvent(record, opts = {}) {
  if (!record || !record.urn) throw new MandateError('record must carry a urn (use createMandate)');
  const status = opts.status || 'active';
  if (!MANDATE_STATUSES.includes(status)) {
    throw new MandateError(`status must be one of ${MANDATE_STATUSES.join(', ')}`);
  }
  const now = Number.isInteger(opts.nowSec) ? opts.nowSec : Math.floor(Date.now() / 1000);
  const tags = [
    ['d', record.urn],
    ['p', normalisePubkey(record.agent)],
    ['t', 'agent-mandate'],
    ['status', status],
  ];
  if (Number.isInteger(record.expires_at) && record.expires_at > now) {
    tags.push(['expiration', String(record.expires_at)]);
  }
  return {
    kind: MANDATE_EVENT_KIND,
    created_at: Number.isInteger(opts.createdAt)
      ? opts.createdAt
      : mandateEventCreatedAt(opts.afterCreatedAt, now),
    tags,
    content: JSON.stringify(status === 'revoked' ? { ...record, revoked: true } : record),
  };
}

/**
 * Wrap a mandate record in a signed, parameterised-replaceable Nostr event.
 * Revoke by re-signing the same `d` tag with `status: 'revoked'`.
 *
 * @param {object} record - A mandate record (must carry `urn`).
 * @param {{ sign(event: object): Promise<object> }} signer
 * @param {object} [opts] - see {@link buildMandateEvent}
 * @returns {Promise<object>} The signed Nostr event.
 */
async function signMandate(record, signer, opts = {}) {
  if (!record || !record.urn) throw new MandateError('record must carry a urn (use createMandate)');
  if (!signer || typeof signer.sign !== 'function') {
    throw new MandateError('signMandate requires a signer with sign(event)');
  }
  return signer.sign(buildMandateEvent(record, opts));
}

/**
 * Is a mandate record currently in force? Checks the revoked flag and the
 * expiry. (Signature authenticity is a separate concern — verify the
 * signed event with nostr-tools before trusting the embedded record.)
 *
 * @param {object} record
 * @param {number} [nowSec] - Unix seconds; defaults to now.
 * @returns {boolean}
 */
function isMandateActive(record, nowSec) {
  if (!record || record.revoked === true) return false;
  const now = Number.isInteger(nowSec) ? nowSec : Math.floor(Date.now() / 1000);
  if (record.expires_at !== null && record.expires_at !== undefined && now >= record.expires_at) {
    return false;
  }
  return true;
}

/**
 * Extract and validate the mandate record carried in a signed event's
 * content. Does NOT verify the Schnorr signature itself — pass the event
 * through `NostrBridge`/nostr-tools `verifyEvent` first where authenticity
 * matters. Returns the record on structural success.
 *
 * @param {object} signedEvent
 * @returns {object} the embedded mandate record
 */
function recordFromSignedMandate(signedEvent) {
  if (!signedEvent || signedEvent.kind !== MANDATE_EVENT_KIND) {
    throw new MandateError(`expected a kind-${MANDATE_EVENT_KIND} mandate event`);
  }
  let record;
  try {
    record = JSON.parse(signedEvent.content);
  } catch {
    throw new MandateError('mandate event content is not valid JSON');
  }
  if (!record || !record.urn || !uris.isCanonical(record.urn)) {
    throw new MandateError('mandate record is missing a canonical urn');
  }
  if (!normalisePubkey(record.agent) || !normalisePubkey(record.issuer)) {
    throw new MandateError('mandate record has malformed issuer/agent identity');
  }
  return record;
}

module.exports = {
  MANDATE_EVENT_KIND,
  ALLOWED_MODES,
  MandateError,
  createMandate,
  buildMandateEvent,
  mandateEventCreatedAt,
  signMandate,
  containerInPod,
  containersOverlap,
  assertProjContainer,
  normaliseContainer,
  podOf,
  isMandateActive,
  recordFromSignedMandate,
  normalisePubkey,
};
