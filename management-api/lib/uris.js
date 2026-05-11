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
 *   did:nostr:<pubkey>                   — agent identity (BIP-340 x-only
 *                                          pubkey, 64-char lowercase hex)
 *
 *   urn:agentbox:<kind>:<scope>:<local>  — opaque content-addressed names
 *     where:
 *       <kind>   ∈ pod | envelope | credential | mandate | receipt |
 *                  activity | event | mcp | memory | skill | adr | prd |
 *                  ddd | thing | dataset | bead
 *       <scope>  optional; agent pubkey hex or another urn:agentbox: anchor
 *       <local>  ASCII slug or hex/base32 of a content hash
 *
 *   https://<host>/<path>                — operator-resolvable HTTPS IRIs
 *     produced by `resolveCanonical(urn)` at the management-api boundary
 *
 * Why pubkey hex and not bech32 npub?
 *   Both the DID layer and the URN scope segments use 64-char
 *   lowercase hex (BIP-340 x-only pubkey). This is consumed by
 *   non-Nostr tooling (W3C VC verifiers, DID resolvers, monitoring
 *   stacks) without requiring a bech32 decoder. Bech32 npub is only
 *   used at the Nostr-relay wire boundary and in legacy pod filesystem
 *   paths. Conversion happens at the relay/display edge.
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
 *       <scope> carries the agent's BIP-340 x-only pubkey hex. e.g.
 *         urn:agentbox:credential:0123…ef:sha256-12-deadbeef
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
 * Sporny, Longley, Allen, Grant, Sabadello). BIP-340 x-only pubkey
 * convention from [BIP-340](https://github.com/bitcoin/bips/blob/master/bip-0340.mediawiki)
 * and Nostr [NIP-01](https://github.com/nostr-protocol/nips/blob/master/01.md).
 * The content-addressing convention follows the agentbox FOD-everything
 * pattern from `lib/npm-cli.nix` and `lib/solid-pod-rs.nix`.
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
  agent:      { ownerScope: false, contentAddressed: false, resolvableSurface: 'agents' },
  meta:       { ownerScope: false, contentAddressed: false, resolvableSurface: 'meta' },
});

const URN_RE = /^urn:agentbox:([a-z]+):([^:]+(?::[^:]+)?)$/;
// BIP-340 x-only pubkey: 32 bytes serialised as 64 lowercase hex chars.
// The canonical-URI layer is a name service, not a Schnorr verifier —
// strict cryptographic validation belongs in DDD-003 §AgentIdentity.
const PUBKEY_HEX_RE = /^[0-9a-f]{64}$/;
const DID_NOSTR_RE = /^did:nostr:([0-9a-f]{64})$/;
// Backward compatibility helpers: callers that supply a bech32 npub
// (Nostr-internal form) are accepted at the parameter boundary by
// `_normalisePubkey()`. The DID grammar itself is pubkey-only.
const NPUB_PREFIX_RE = /^npub1[a-z0-9]+$/;

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
 * @param {string} [opts.pubkey] — agent BIP-340 x-only pubkey hex
 *   (64 lowercase hex chars) for owner-scoped kinds. A `did:nostr:`
 *   prefix or a bech32 `npub1` value is also accepted at the boundary
 *   and normalised — but the resulting URI always carries pubkey hex.
 * @param {string} [opts.npub] — DEPRECATED alias for `pubkey`. Kept
 *   for two release cycles to ease the rename. Use `pubkey`.
 * @param {*} [opts.payload] — JSON-serialisable payload for content addressing
 * @param {string} [opts.localId] — explicit local id; required when
 *   the kind is not content-addressed and not scope-bearing
 * @returns {string} a `urn:agentbox:<kind>:…` URI
 */
function mint({ kind, pubkey, npub, payload, localId } = {}) {
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
    const supplied = pubkey || npub;
    if (!supplied) {
      throw new MalformedUri(`urn:agentbox:${kind}:${local}`, 'kind requires pubkey scope');
    }
    const normalised = _normalisePubkey(supplied);
    if (!normalised) {
      throw new MalformedUri(`urn:agentbox:${kind}:${local}`, `bad pubkey: ${supplied}`);
    }
    return `urn:agentbox:${kind}:${normalised}:${local}`;
  }

  return `urn:agentbox:${kind}:${local}`;
}

/**
 * Normalise a caller-supplied identifier to BIP-340 x-only pubkey hex.
 * Accepts:
 *   - 64-char lowercase hex (already canonical)
 *   - did:nostr:<64-char hex> (strips the prefix)
 *   - npub1... bech32 (best-effort decode; if the bech32 decoder
 *     isn't available, the function returns null and the caller
 *     surfaces a MalformedUri so the operator gets a clear error)
 * Returns the canonical 64-char hex pubkey, or null if the input is
 * not recognisable.
 */
function _normalisePubkey(value) {
  if (typeof value !== 'string') return null;
  if (PUBKEY_HEX_RE.test(value)) return value;
  if (value.startsWith('did:nostr:')) {
    const tail = value.slice('did:nostr:'.length);
    return PUBKEY_HEX_RE.test(tail) ? tail : null;
  }
  if (NPUB_PREFIX_RE.test(value)) {
    // bech32 decode is best-effort; nostr-tools is available in the
    // bundled management-api but not at the URI layer's level. We try
    // a require() and gracefully return null if absent so the caller
    // can fall back. Real callers should pass pubkey hex directly.
    try {
      const { nip19 } = require('nostr-tools');
      const { type, data } = nip19.decode(value);
      if (type === 'npub' && typeof data === 'string' && PUBKEY_HEX_RE.test(data)) {
        return data;
      }
    } catch { /* nostr-tools not loadable here; fall through */ }
    return null;
  }
  return null;
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
    return { scheme: 'did', method: 'nostr', pubkey: uri.slice('did:nostr:'.length) };
  }
  const m = uri.match(URN_RE);
  if (!m) return null;
  const [, kind, rest] = m;
  const parts = rest.split(':');
  if (parts.length === 1) {
    return { scheme: 'urn', kind, pubkey: null, local: parts[0] };
  }
  return { scheme: 'urn', kind, pubkey: parts[0], local: parts.slice(1).join(':') };
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
