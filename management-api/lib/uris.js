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
 *                  activity | event | decision | mcp | memory | skill |
 *                  adr | prd | ddd | thing | dataset | bead | knowledge |
 *                  agent | meta | chain
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

// Scope semantics:
//   ownerScope=false                      — pubkey scope is NEVER emitted.
//   ownerScope=true, scopeRequired=true   — pubkey scope is REQUIRED (mint throws
//                                           without it). The historic default.
//   ownerScope=true, scopeRequired=false  — pubkey scope is emitted WHEN SUPPLIED
//                                           and omitted otherwise (optional scope).
//
// Optional scope is used by the Code-as-Harness kinds (CLAUDE.md §Code-as-Harness
// URN Allocation: thing:<scope>:kernel-…, memory:<scope>:lesson-…, agent identity
// being the bare DID) and by the WS6 elevation path, whose `thing` proposal URN
// must carry the owner pubkey so it can cross to `urn:visionclaw:kg:<pubkey>:…`
// through the BC20 bridge (lib/bc20-provenance-bridge.js, which drops an unscoped
// `thing`). The unscoped forms (e.g. urn:agentbox:thing:mcp-foo) remain valid.
//
// `ownerScope` stays a boolean (contract L15); `scopeRequired` is only meaningful
// when `ownerScope` is true and defaults to true for backward compatibility.
const KINDS = Object.freeze({
  pod:        { ownerScope: true,  scopeRequired: true,  contentAddressed: true,  resolvableSurface: 'pods' },
  envelope:   { ownerScope: true,  scopeRequired: true,  contentAddressed: true,  resolvableSurface: 'pods' },
  credential: { ownerScope: true,  scopeRequired: true,  contentAddressed: true,  resolvableSurface: 'pods' },
  mandate:    { ownerScope: true,  scopeRequired: true,  contentAddressed: true,  resolvableSurface: 'pods' },
  receipt:    { ownerScope: true,  scopeRequired: true,  contentAddressed: true,  resolvableSurface: 'pods' },
  activity:   { ownerScope: true,  scopeRequired: true,  contentAddressed: true,  resolvableSurface: 'agent-events' },
  event:      { ownerScope: true,  scopeRequired: true,  contentAddressed: true,  resolvableSurface: 'agent-events' },
  // decision IS-A prov:Activity (ADR-048): mirrors activity's plumbing —
  // scope-required owner pubkey + content-addressed payload hash.
  decision:   { ownerScope: true,  scopeRequired: true,  contentAddressed: true,  resolvableSurface: 'agent-events' },
  mcp:        { ownerScope: false, scopeRequired: false, contentAddressed: false, resolvableSurface: 'things' },
  memory:     { ownerScope: true,  scopeRequired: false, contentAddressed: false, resolvableSurface: 'memory' },
  skill:      { ownerScope: false, scopeRequired: false, contentAddressed: false, resolvableSurface: 'skills' },
  adr:        { ownerScope: false, scopeRequired: false, contentAddressed: false, resolvableSurface: 'docs' },
  prd:        { ownerScope: false, scopeRequired: false, contentAddressed: false, resolvableSurface: 'docs' },
  ddd:        { ownerScope: false, scopeRequired: false, contentAddressed: false, resolvableSurface: 'docs' },
  thing:      { ownerScope: true,  scopeRequired: false, contentAddressed: false, resolvableSurface: 'things' },
  dataset:    { ownerScope: true,  scopeRequired: true,  contentAddressed: false, resolvableSurface: 'memory' },
  // bead is content-addressed to match VisionClaw's converged grammar
  // (`urn:visionclaw:bead:<pubkey>:<sha256-12>`) so the BC20 bridge can
  // cross beads structurally instead of dropping them (audit 2026-06-09 A3).
  bead:       { ownerScope: true,  scopeRequired: true,  contentAddressed: true,  resolvableSurface: 'beads' },
  // knowledge (ADR-2085): a colloquy knowledge unit. Content-addressed with a
  // scope, so `urn:agentbox:knowledge:<pubkey>:sha256-12-<hex>` and the cq id
  // `ku_<hex>` carry the SAME twelve digest characters — one address in two
  // grammars, rather than two identities to keep in step.
  knowledge:  { ownerScope: true,  scopeRequired: true,  contentAddressed: true,  resolvableSurface: 'memory' },
  agent:      { ownerScope: true,  scopeRequired: false, contentAddressed: false, resolvableSurface: 'agents' },
  meta:       { ownerScope: false, scopeRequired: false, contentAddressed: false, resolvableSurface: 'meta' },
  // chain (ADR-2098, amended 2026-10-02 for sidestr 0.0.5): a sidestr chain,
  // named by the id of its kind-3500 chain event, the one value that names this
  // chain and no other (SPEC 3). Not the alias `sidestr:<name>` (a name, not a
  // proof: two signers can announce the same one) and not the genesis hash (a
  // cross-check inside the document). Both stay in the resolved record. The
  // local part is the full 64-hex id, never slugged: `localGrammar` refuses
  // anything else, so `sidestr:dreamlab` cannot become `sidestr_dreamlab`.
  // URN_RE admits at most one colon after the kind, so `sidestr:<name>` as a
  // local part would also parse as scope `sidestr` + local `<name>`; the hash
  // key avoids that as well. `sha256-12-<first 12 hex>` is display only.
  chain:      { ownerScope: false, scopeRequired: false, contentAddressed: false, resolvableSurface: 'chains', localGrammar: /^[0-9a-f]{64}$/ },
});

// sidestr chain identity (SPEC 0.0.5 §3, §11). The chain event is kind 3500,
// regular and immutable; its id is the chain's hash. Kept beside the URN
// grammar because the record a `chain` URN resolves to is part of its contract.
const CHAIN_EVENT_KIND = 3500;
const CHAIN_HASH_RE = /^[0-9a-f]{64}$/;
const CHAIN_ALIAS_RE = /^sidestr:[a-z0-9][a-z0-9-]*$/;

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
  } else if (localId && spec.localGrammar) {
    // A kind with a fixed local grammar takes its id as given or not at all:
    // slugging would turn a wrong id into a different, well-formed one.
    // Hex is case-insensitive, so the one normalisation is to lower case
    // (the same id, as upstream's resolveChain lowercases a hash).
    const id = String(localId).toLowerCase();
    if (!spec.localGrammar.test(id)) {
      throw new MalformedUri(`urn:agentbox:${kind}:${localId}`, `local id must match ${spec.localGrammar}`);
    }
    local = id;
  } else if (localId) {
    local = _slug(localId);
  } else {
    throw new MalformedUri(`urn:agentbox:${kind}:?`, 'kind requires localId');
  }

  if (spec.ownerScope) {
    const supplied = pubkey || npub;
    if (!supplied) {
      // scopeRequired === false → optional scope: mint the unscoped form.
      if (spec.scopeRequired === false) {
        return `urn:agentbox:${kind}:${local}`;
      }
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
  if (spec.localGrammar && !spec.localGrammar.test(rest)) return null;

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
  if (KINDS[kind] && KINDS[kind].localGrammar && !KINDS[kind].localGrammar.test(rest)) return null;
  const parts = rest.split(':');
  if (parts.length === 1) {
    return { scheme: 'urn', kind, pubkey: null, local: parts[0] };
  }
  return { scheme: 'urn', kind, pubkey: parts[0], local: parts.slice(1).join(':') };
}

/** Boolean — is this a canonical agentbox URI? */
function isCanonical(uri) {
  if (DID_NOSTR_RE.test(uri || '')) return true;
  const m = (uri || '').match(URN_RE);
  if (!m) return false;
  const spec = KINDS[m[1]];
  return !(spec && spec.localGrammar && !spec.localGrammar.test(m[2]));
}

/**
 * The display form of a chain hash: `sha256-12-<first 12 hex>`. Display only;
 * anything that binds to a chain binds to the full 64-hex id.
 *
 * @param {string} hashOrUrn — a 64-hex chain hash or a `urn:agentbox:chain:` URN
 * @returns {string|null}
 */
function chainDisplay(hashOrUrn) {
  const p = typeof hashOrUrn === 'string' && hashOrUrn.startsWith('urn:') ? parse(hashOrUrn) : null;
  const hash = p ? (p.kind === 'chain' ? p.local : null) : (typeof hashOrUrn === 'string' ? hashOrUrn.toLowerCase() : null);
  return hash && CHAIN_HASH_RE.test(hash) ? `sha256-12-${hash.slice(0, 12)}` : null;
}

/**
 * Build the record a `chain` URN resolves to, from the chain's document and,
 * when its signer has published one, its kind-3500 chain event.
 *
 * With an event the record is keyed by the event id: `{ urn, hash, display,
 * alias, genesisHash, signer, legacy: false }`. The event is checked the way
 * upstream's `parseChainEvent` checks it (sidestr/spec siding/lib/announce.mjs):
 * `verify(event)` must hold (id is the hash of the content, signature good;
 * the caller supplies a trusted verifier, this module is a name service and
 * does no cryptography), the content is a document naming its alias in `id`,
 * a `signer` field (if any) is the event's author and a `signers` list (if
 * any) includes it. Where a document is also given, its alias and genesisHash
 * must agree with the event's and its `signer` (or `signers`) must name the
 * event's author: they are the cross-checks, and a disagreement is an error,
 * never a silently preferred value.
 *
 * Without an event the chain predates 0.0.5: the record has no URN and no
 * hash, carries the alias and genesisHash it is resolved by, and is marked
 * `legacy: true`.
 *
 * @param {object} opts
 * @param {object} [opts.document] — the chain document (chain.json)
 * @param {object} [opts.event] — the kind-3500 chain event (chain-event.json)
 * @param {function} [opts.verify] — `(event) => boolean`; required with an event
 * @returns {{urn: string|null, hash: string|null, display: string|null,
 *            alias: string, genesisHash: string|null, signer: string|null, legacy: boolean}}
 */
function chainRecord({ document = null, event = null, verify } = {}) {
  if (event) {
    if (event.kind !== CHAIN_EVENT_KIND) throw new MalformedUri('urn:agentbox:chain:?', `not a chain event (kind ${CHAIN_EVENT_KIND})`);
    if (typeof verify !== 'function') throw new MalformedUri('urn:agentbox:chain:?', 'a chain event needs a verifier');
    let ok = false;
    try { ok = !!verify(event); } catch { ok = false; }
    if (!ok) throw new MalformedUri('urn:agentbox:chain:?', 'the chain event does not verify (id or signature)');
    const hash = String(event.id).toLowerCase();
    if (!CHAIN_HASH_RE.test(hash)) throw new MalformedUri('urn:agentbox:chain:?', 'a chain event id is 64 hex');
    let doc;
    try { doc = JSON.parse(event.content); } catch { throw new MalformedUri(`urn:agentbox:chain:${hash}`, "the chain event's content is not JSON"); }
    if (!doc || typeof doc !== 'object' || typeof doc.id !== 'string' || !CHAIN_ALIAS_RE.test(doc.id)) {
      throw new MalformedUri(`urn:agentbox:chain:${hash}`, 'the chain event carries no document with an alias (sidestr:<name>)');
    }
    if (doc.signer !== undefined && doc.signer !== event.pubkey) {
      throw new MalformedUri(`urn:agentbox:chain:${hash}`, "the document names a signer other than the event's author");
    }
    if (Array.isArray(doc.signers) && !doc.signers.includes(event.pubkey)) {
      throw new MalformedUri(`urn:agentbox:chain:${hash}`, "the event's author is not one of the document's signers");
    }
    const lower = (v) => (typeof v === 'string' ? v.toLowerCase() : null);
    const genesisHash = lower(doc.genesisHash) ?? lower(document && document.genesisHash);
    if (document) {
      if (document.id !== doc.id) {
        throw new MalformedUri(`urn:agentbox:chain:${hash}`, `the chain event is for ${doc.id}, the document is ${document.id}`);
      }
      if (doc.genesisHash && document.genesisHash && lower(doc.genesisHash) !== lower(document.genesisHash)) {
        throw new MalformedUri(`urn:agentbox:chain:${hash}`, 'the chain event and the document disagree on genesisHash');
      }
      // The sealed document names who may sign for the chain; an event by anyone
      // else is not this chain's, whatever alias it claims.
      if (typeof document.signer === 'string' && document.signer !== event.pubkey) {
        throw new MalformedUri(`urn:agentbox:chain:${hash}`, "the chain event's author is not the document's signer");
      }
      if (Array.isArray(document.signers) && !document.signers.includes(event.pubkey)) {
        throw new MalformedUri(`urn:agentbox:chain:${hash}`, "the chain event's author is not one of the document's signers");
      }
    }
    return {
      urn: mint({ kind: 'chain', localId: hash }),
      hash,
      display: chainDisplay(hash),
      alias: doc.id,
      genesisHash,
      signer: event.pubkey,
      legacy: false,
    };
  }
  if (!document || typeof document.id !== 'string' || !CHAIN_ALIAS_RE.test(document.id)) {
    throw new MalformedUri('urn:agentbox:chain:?', 'a chain without an event needs its document, with an alias (sidestr:<name>)');
  }
  const genesisHash = typeof document.genesisHash === 'string' ? document.genesisHash.toLowerCase() : null;
  if (!genesisHash || !CHAIN_HASH_RE.test(genesisHash)) {
    throw new MalformedUri('urn:agentbox:chain:?', `${document.id} has no event and no genesisHash: it cannot be resolved`);
  }
  return {
    urn: null,
    hash: null,
    display: null,
    alias: document.id,
    genesisHash,
    signer: typeof document.signer === 'string' ? document.signer : null,
    legacy: true,
  };
}

/**
 * Resolve a chain against known records (from `chainRecord`).
 *
 * By hash (or `chain` URN): exactly the record with that hash, or null. A
 * resolver never redirects one id to another, so a hash no record carries
 * does not fall back to an alias.
 *
 * By alias and genesisHash together: the record carrying both. A record with
 * a hash comes back as itself; one without (a pre-0.0.5 chain) comes back
 * `legacy: true`. An alias alone is a name, not a proof, and resolves nothing.
 *
 * @param {object} query — `{ hash }`, `{ urn }` or `{ alias, genesisHash }`
 * @param {Array<object>} records
 * @returns {object|null}
 */
function resolveChain(query = {}, records = []) {
  let hash = query.hash ?? null;
  if (query.urn) {
    const p = parse(query.urn);
    if (!p || p.kind !== 'chain') return null;
    hash = p.local;
  }
  if (hash != null) {
    hash = String(hash).toLowerCase();
    if (!CHAIN_HASH_RE.test(hash)) return null;
    return records.find((r) => r && r.hash === hash) || null;
  }
  const { alias, genesisHash } = query;
  if (typeof alias !== 'string' || typeof genesisHash !== 'string') return null;
  const g = genesisHash.toLowerCase();
  return records.find((r) => r && r.alias === alias && r.genesisHash === g) || null;
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
  CHAIN_EVENT_KIND,
  mint,
  resolveCanonical,
  parse,
  isCanonical,
  chainDisplay,
  chainRecord,
  resolveChain,
  UnknownUriKind,
  MalformedUri,
};
