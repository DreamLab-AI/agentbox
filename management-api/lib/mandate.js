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
 *   2. `mandateToAclTurtle()` renders the WAC fragment the user PUTs to
 *      `<container>/.acl`; solid-pod-rs parses `acl:agent` (individual
 *      grants) and matches it against the agent's NIP-98-derived
 *      `did:nostr` webid (verified upstream in solid-pod-rs evaluator).
 *   3. `signMandate()` wraps the record in a signed, parameterised-
 *      replaceable Nostr event so it is revocable: republish under the
 *      same `d` tag with `{ revoked: true }` to revoke.
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
const ALLOWED_MODES = Object.freeze(['Read', 'Write', 'Append', 'Control']);
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

/** A pod container path must be absolute and end in a slash. */
function normaliseContainer(container) {
  if (typeof container !== 'string' || !container.startsWith('/')) {
    throw new MandateError(`container must be an absolute pod path, got "${container}"`);
  }
  return container.endsWith('/') ? container : `${container}/`;
}

/**
 * Create a scoped agent mandate record + its canonical URN.
 *
 * @param {object} args
 * @param {string} args.issuer    - Granting user (did:nostr or hex pubkey).
 * @param {string} args.agent     - Grantee agent (did:nostr or hex pubkey).
 * @param {string} args.container - Absolute pod container path (e.g. "/kg/").
 * @param {string[]} [args.modes=['Read','Write','Append']] - acl:mode names.
 * @param {number} [args.issuedAt]  - Unix seconds; defaults to now.
 * @param {number|null} [args.expiresAt=null] - Unix seconds, or null for no expiry.
 * @returns {{ urn: string, record: object }}
 */
function createMandate({ issuer, agent, container, modes, issuedAt, expiresAt } = {}) {
  const issuerHex = normalisePubkey(issuer);
  if (!issuerHex) throw new MandateError(`bad issuer identity: ${issuer}`);
  const agentHex = normalisePubkey(agent);
  if (!agentHex) throw new MandateError(`bad agent identity: ${agent}`);

  const path = normaliseContainer(container);
  const modeList = normaliseModes(modes);
  const issued = Number.isInteger(issuedAt) ? issuedAt : Math.floor(Date.now() / 1000);
  const expires = expiresAt === undefined ? null : expiresAt;
  if (expires !== null && (!Number.isInteger(expires) || expires <= issued)) {
    throw new MandateError('expiresAt must be a Unix-seconds integer after issuedAt, or null');
  }

  const record = {
    issuer: `did:nostr:${issuerHex}`,
    agent: `did:nostr:${agentHex}`,
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

/**
 * Render the WAC ACL Turtle granting the mandate's agent the recorded
 * modes over the container. The user PUTs this to `<container>.acl`.
 * Mirrors the owner-ACL shape solid-pod-rs writes at provision time.
 *
 * @param {object} record - A mandate record from createMandate().
 * @returns {string} Turtle document.
 */
function mandateToAclTurtle(record) {
  const agentHex = normalisePubkey(record && record.agent);
  if (!agentHex) throw new MandateError('record.agent is not a valid did:nostr');
  const container = normaliseContainer(record.container);
  const modeList = normaliseModes(record.modes);
  const modeClause = modeList.map((m) => `acl:${m}`).join(', ');

  return (
    '@prefix acl: <http://www.w3.org/ns/auth/acl#> .\n' +
    '<#agent-mandate> a acl:Authorization ;\n' +
    `    acl:agent <did:nostr:${agentHex}> ;\n` +
    `    acl:accessTo <${container}> ;\n` +
    `    acl:default <${container}> ;\n` +
    `    acl:mode ${modeClause} .\n`
  );
}

/**
 * Wrap a mandate record in a signed, parameterised-replaceable Nostr
 * event. Revoke by re-signing the same `d` tag with a record whose
 * `revoked` is true.
 *
 * @param {object} record - A mandate record (must carry `urn`).
 * @param {{ sign(event: object): Promise<object> }} signer - from loadSigner().
 * @returns {Promise<object>} The signed Nostr event.
 */
async function signMandate(record, signer) {
  if (!record || !record.urn) throw new MandateError('record must carry a urn (use createMandate)');
  if (!signer || typeof signer.sign !== 'function') {
    throw new MandateError('signMandate requires a signer with sign(event)');
  }
  const unsigned = {
    kind: MANDATE_EVENT_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', record.urn],
      ['p', normalisePubkey(record.agent)],
      ['t', 'agent-mandate'],
      ['expiration', String(record.expires_at ?? '')],
    ],
    content: JSON.stringify(record),
  };
  return signer.sign(unsigned);
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
  mandateToAclTurtle,
  signMandate,
  isMandateActive,
  recordFromSignedMandate,
  normalisePubkey,
};
