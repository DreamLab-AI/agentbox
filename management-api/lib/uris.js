'use strict';

/**
 * Canonical URI builder + resolver — ADR-013, DDD-004 §URICanonicaliser.
 *
 * Every JSON-LD surface emitter mints `@id` values through this module
 * so the agentbox URI grammar is uniform and every URI can be
 * dereferenced to its canonical representation. Without this, each
 * surface invents its own ID shape (urn:uuid, ad-hoc strings, raw
 * caller pass-through), the viewer can't follow links between
 * surfaces, and integrators can't write generic monitoring code.
 *
 * The grammar is intentionally minimal:
 *
 *   did:nostr:<npub>                     — agent identity
 *
 *   urn:agentbox:<kind>:<scope>:<local>  — opaque content-addressed names
 *     where:
 *       <kind>   ∈ pod | envelope | credential | mandate | receipt |
 *                  activity | event | mcp | memory | skill | adr | prd |
 *                  ddd | thing | dataset | bead
 *       <scope>  optional;  agent npub or another urn:agentbox: anchor
 *       <local>  ASCII slug or hex/base32 of a content hash
 *
 *   https://<host>/<path>                — operator-resolvable HTTPS IRIs
 *     produced by `resolveCanonical(urn)` at the management-api boundary
 *
 * Three rules govern minting:
 *
 *   R1. CONTENT-ADDRESSED — when a payload uniquely determines the
 *       resource (a credentialSubject, an activity, an event), the
 *       <local> portion is `sha256-12-<first 12 hex chars of SHA-256>`.
 *       Same input → same URI, every time. PRD-006 §8.1 round-trip
 *       relies on this for deterministic emit→sign→re-emit.
 *
 *   R2. SCOPE-BEARING — when the resource is owned by an agent,
 *       <scope> carries the agent's npub. e.g.
 *         urn:agentbox:credential:npub1abc:sha256-12-deadbeef
 *
 *   R3. STABLE-ON-IDENTITY — the URI of a static thing (a skill, an
 *       MCP server, an ADR) is `urn:agentbox:<kind>:<id>` where <id>
 *       is its public, immutable name. Same skill always has the same
 *       URI across rebuilds.
 *
 * Resolution is the inverse: `resolveCanonical(urn)` returns either an
 * HTTPS IRI (the operator-supplied management-api/pod base + a path)
 * or `null` if the resolver doesn't know how to dereference it.
 *
 * Attribution
 * -----------
 * URI grammar inspired by IETF [URN syntax (RFC 8141)](https://www.rfc-editor.org/rfc/rfc8141)
 * and [W3C DID Core 1.0](https://www.w3.org/TR/did-core/) (Reed,
 * Sporny, Longley, Allen, Grant, Sabadello). The content-addressing
 * convention follows the agentbox FOD-everything pattern from
 * `lib/npm-cli.nix` and `lib/solid-pod-rs.nix`.
 */

const crypto = require('crypto');

const KINDS = Object.freeze({
  pod:        { ownerScope: true,  contentAddressed: true,  resolvableSurface: 'pods' },
  envelope:   { ownerScope: true,  contentAddressed: true,  resolvableSurface: 'pods' },
  credential: { ownerScope: true,  contentAddressed: true,  resolvableSurface: 'pods' },
  mandate:    { ownerScope: true,  contentAddressed: true,  resolvableSurface: 'pods' },
  receipt:    { ownerScope: true,  contentAddressed: true,  resolvableSurface: 'pods' },
  activity:   { ownerScope: true,  contentAddressed: true,  resolvableSurface: 'agent-events' },
  event:      { ownerScope: true,  contentAddressed: true,  resolvableSurface: 'agent-events' },
  mcp:        { ownerScope: false, contentAddressed: false, resolvableSurface: 'things' },
  memory:     { ownerScope: false, contentAddressed: false, resolvableSurface: 'memory' },
  skill:      { ownerScope: false, contentAddressed: false, resolvableSurface: 'skills' },
  adr:        { ownerScope: false, contentAddressed: false, resolvableSurface: 'docs' },
  prd:        { ownerScope: false, contentAddressed: false, resolvableSurface: 'docs' },
  ddd:        { ownerScope: false, contentAddressed: false, resolvableSurface: 'docs' },
  thing:      { ownerScope: false, contentAddressed: false, resolvableSurface: 'things' },
  dataset:    { ownerScope: true,  contentAddressed: false, resolvableSurface: 'memory' },
  bead:       { ownerScope: true,  contentAddressed: false, resolvableSurface: 'beads' },
  meta:       { ownerScope: false, contentAddressed: false, resolvableSurface: 'meta' },
});

const URN_RE = /^urn:agentbox:([a-z]+):([^:]+(?::[^:]+)?)$/;
// We accept any `npub1` prefix followed by lowercase ASCII alphanumeric.
// Bech32 has a stricter charset, but the canonical-URI layer is a name
// service, not a Schnorr verifier — strict bech32 validation belongs in
// the cryptographic layer (DDD-003 §AgentIdentity).
const NPUB_RE = /^npub1[a-z0-9]+$/;
const DID_NOSTR_RE = /^did:nostr:(npub1[a-z0-9]+)$/;

class UnknownUriKind extends Error {
  constructor(kind) {
    super(`UnknownUriKind: ${kind}. Valid: ${Object.keys(KINDS).join(', ')}`);
    this.name = 'UnknownUriKind';
    this.kind = kind;
  }
}

class MalformedUri extends Error {
  constructor(uri, reason) {
    super(`MalformedUri: ${uri} — ${reason}`);
    this.name = 'MalformedUri';
    this.uri = uri;
  }
}

/**
 * Mint a canonical URI.
 *
 * @param {object} opts
 * @param {string} opts.kind — one of KINDS
 * @param {string} [opts.npub] — agent npub for owner-scoped kinds
 * @param {*} [opts.payload] — JSON-serialisable payload for content addressing
 * @param {string} [opts.localId] — explicit local id; required when
 *   the kind is not content-addressed and not scope-bearing
 * @returns {string} a `urn:agentbox:<kind>:…` URI
 */
function mint({ kind, npub, payload, localId } = {}) {
  if (!(kind in KINDS)) throw new UnknownUriKind(kind);
  const spec = KINDS[kind];

  let local;
  if (spec.contentAddressed) {
    if (payload === undefined) {
      throw new MalformedUri(`urn:agentbox:${kind}:?`, 'content-addressed kind requires payload');
    }
    local = _contentAddress(payload);
  } else if (localId) {
    local = _slug(localId);
  } else {
    throw new MalformedUri(`urn:agentbox:${kind}:?`, 'kind requires localId');
  }

  if (spec.ownerScope) {
    if (!npub) throw new MalformedUri(`urn:agentbox:${kind}:${local}`, 'kind requires npub scope');
    if (!NPUB_RE.test(npub) && !DID_NOSTR_RE.test(npub)) {
      throw new MalformedUri(`urn:agentbox:${kind}:${local}`, `bad npub: ${npub}`);
    }
    const npubOnly = npub.startsWith('did:nostr:') ? npub.slice('did:nostr:'.length) : npub;
    return `urn:agentbox:${kind}:${npubOnly}:${local}`;
  }

  return `urn:agentbox:${kind}:${local}`;
}

/**
 * Resolve a `urn:agentbox:*` URI to a dereferenceable HTTPS IRI under
 * the operator-supplied management-api base. Returns `null` for
 * unknown URIs or for URIs in the `did:nostr:` / `did:` family (those
 * resolve through their own DID resolver).
 *
 * @param {string} uri
 * @param {object} opts
 * @param {string} opts.managementApiBase — e.g. http://127.0.0.1:9090
 * @param {string} [opts.podBase] — e.g. http://127.0.0.1:8484
 * @returns {string|null}
 */
function resolveCanonical(uri, { managementApiBase, podBase } = {}) {
  if (!uri || typeof uri !== 'string') return null;

  if (DID_NOSTR_RE.test(uri)) {
    if (!podBase) return null;
    return `${podBase}/.well-known/did.json`;
  }

  const m = uri.match(URN_RE);
  if (!m) return null;
  const [, kind, rest] = m;
  if (!(kind in KINDS)) return null;
  const spec = KINDS[kind];

  // Most agentbox URIs route through the management-api so the viewer
  // can layer auth, content negotiation, and CORS in one place.
  const base = managementApiBase || '';
  const surface = spec.resolvableSurface;
  return `${base}/v1/uri/${encodeURIComponent(uri)}?surface=${surface}`;
}

/** Parse a canonical URI into its components, or null if not canonical. */
function parse(uri) {
  if (typeof uri !== 'string') return null;
  if (DID_NOSTR_RE.test(uri)) {
    return { scheme: 'did', method: 'nostr', npub: uri.slice('did:nostr:'.length) };
  }
  const m = uri.match(URN_RE);
  if (!m) return null;
  const [, kind, rest] = m;
  const parts = rest.split(':');
  if (parts.length === 1) {
    return { scheme: 'urn', kind, npub: null, local: parts[0] };
  }
  return { scheme: 'urn', kind, npub: parts[0], local: parts.slice(1).join(':') };
}

/** Boolean — is this a canonical agentbox URI? */
function isCanonical(uri) {
  return DID_NOSTR_RE.test(uri || '') || URN_RE.test(uri || '');
}

function _contentAddress(payload) {
  // Stable hash: JSON.stringify with sorted keys is sufficient for
  // content addressing here; the surfaces' round-trip + JCS rules
  // give us the strict canonical form when bytes-identical signing
  // matters. For URI minting, "deterministic enough" beats "exactly
  // RFC 8785" because we're producing a name, not a signature input.
  const canon = _stableStringify(payload);
  const hex = crypto.createHash('sha256').update(canon, 'utf8').digest('hex');
  return `sha256-12-${hex.slice(0, 12)}`;
}

function _stableStringify(value) {
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(_stableStringify).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + _stableStringify(value[k])).join(',') + '}';
}

function _slug(s) {
  return String(s).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 96);
}

module.exports = {
  KINDS,
  mint,
  resolveCanonical,
  parse,
  isCanonical,
  UnknownUriKind,
  MalformedUri,
};
