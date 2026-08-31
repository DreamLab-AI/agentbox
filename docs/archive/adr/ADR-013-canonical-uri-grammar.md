# ADR-013: Canonical URI grammar and resolver

**Status:** Accepted
**Date:** 2026-04-25
**Author:** Agentbox team
**Supersedes:** n/a
**Related:** PRD-006 (Linked-data interfaces — §15 viewer slot), ADR-012 (JSON-LD adoption — every surface emits `@id` values constrained by this ADR), DDD-004 (Linked-Data interchange domain — §URICanonicaliser aggregate), DDD-003 (Sovereign messaging — `did:nostr:<pubkey>` identity layer)

## TL;DR for newcomers
*Skip if you already know that URI uniqueness and URI resolvability are different contracts.*

This ADR defines the agentbox URI grammar — `did:nostr:<pubkey>` for identity and `urn:agentbox:<kind>:[<scope>:]<local>` for everything else — plus a `/v1/uri/<urn>` resolver service. The pain point it addresses is that PRD-006's eleven surfaces were each minting `@id` values their own way (caller pass-through, `urn:uuid:*`, ad-hoc strings, randomly-generated event URNs) so the viewer (S12) could not follow links between them and external integrators could not write generic monitoring code. The shape of the answer is one shared minting library (`management-api/lib/uris.js`), called by every surface, that produces deterministic content-addressed names; one resolver route (`/v1/uri/<urn>`) that best-effort dereferences names to current HTTPS IRIs; and a documented contract that says **uniqueness is unconditional, resolvability is best-effort**. You will learn the grammar, the kinds, the resolver semantics (200/307, 404, 410), the surface-by-surface refactor, and the relationship to W3C DID Core and IETF RFC 8141.

**If you remember only one thing:** every agentbox URI is unique by construction; some of them resolve, some don't, and the resolver tells you which.

For the deep version, keep reading.

## Context

Three observations forced the decision:

1. **PRD-006 needed identifiers for emitted documents.** The eleven surfaces (S1–S11) each mint an `@id` per emitted resource. Before this ADR, those mints were inconsistent:

   | Surface | Pre-ADR @id source |
   |---|---|
   | S1 pods | caller-supplied id, pass-through |
   | S2 nostr | caller-supplied id, pass-through |
   | S3 credentials | `urn:uuid:<random>` |
   | S4 DID Documents | `did:nostr:<pubkey>` ✓ |
   | S5 provenance | `urn:uuid:<random>` |
   | S6 MCP descriptors | `urn:agentbox:mcp:<id>` ✓ |
   | S7 skills | caller-supplied id, pass-through |
   | S8 payments | `urn:uuid:<random>` |
   | S9 DCAT | `urn:agentbox:memory:<name>` ✓ |
   | S10 ADR/PRD/DDD | caller-supplied id |
   | S11 HTTP meta | `urn:agentbox:event:<timestamp>:<rand>` |

   Random URNs make every emit a different document; round-trip tests pass only because they ignore `@id` differences. JCS canonicalisation (PRD-006 §8.2) cannot sign credentials whose `@id` changes between emits; the proof block is supposed to bind a stable identifier.

2. **The viewer (S12) needs to follow links.** The Linked-Object Browser dispatches by `@type` and renders properties. If a property points at `urn:uuid:abc-…`, the viewer has no path to follow; the link is a dead end. If the same property points at `urn:agentbox:credential:01234567…:sha256-12-deadbeef`, the resolver knows to look in the pod's credentials collection.

3. **External monitoring needs a stable identity for every emitted thing.** "Show me every credential this agent has ever issued" is impossible when credentials are URN-UUIDs that change on every emit. With content-addressed URIs, the same credential is always the same name, even when re-emitted, even when the agent identity changes.

Three approaches were considered:

### Alternative A — keep per-surface ad-hoc IDs

Cheapest. Costs nothing today. Costs everything later: the viewer can't navigate, monitoring needs out-of-band ID maps, and signed credentials fail JCS round-trip.

Rejected.

### Alternative B — make every URI a dereferenceable HTTPS IRI

Tempting because "every URI is a URL" is operationally simple. Rejected because:

- Many agentbox names exist independent of where they're served. A credential URI should mean the same thing whether served from a local pod, a federated pod, or a backup tarball.
- W3C DID Core, [RFC 8141 (URN syntax)](https://www.rfc-editor.org/rfc/rfc8141), and the broader Linked Data ecosystem all distinguish names from locations. Agentbox should follow that distinction.
- Conflating name and address creates churn on operator changes (rebind to a new domain → every URI breaks).

### Alternative C — `urn:agentbox:<kind>:…` for names, optional HTTPS IRIs for locations, an explicit resolver service

Adopted. Names are content-addressed where the resource is content-determined; scope-bearing where ownership is part of identity; stable strings where the name is a public, immutable label. The resolver service answers "where can I fetch a current representation of this URI?" with 307, 404, or 410.

This matches DID Core's two-step model (a DID is a name, the DID Document is its current representation) and RFC 8141's URN philosophy ("globally unique, persistent identifier for a resource that does not necessarily indicate a location").

## Decision

We adopt the URI grammar below, ship `management-api/lib/uris.js` as the single mint+resolve library every surface uses, refactor S1–S11 to use it, and expose a `/v1/uri/<urn>` resolver route.

### 1. Grammar

```
URI            ::= identity-uri | name-uri
identity-uri   ::= "did:nostr:" pubkey-hex      ; BIP-340 x-only, 64 lc hex
name-uri       ::= "urn:agentbox:" kind ":" [scope ":"] local
kind           ::= "pod" | "envelope" | "credential" | "mandate" | "receipt"
                 | "activity" | "event" | "mcp" | "memory" | "skill"
                 | "adr" | "prd" | "ddd" | "thing" | "dataset" | "bead" | "meta"
scope          ::= pubkey-hex               ; required for owner-scoped kinds
local          ::= content-hash | slug
content-hash   ::= "sha256-12-" 12HEXDIGIT  ; first 12 hex chars of SHA-256
slug           ::= [A-Za-z0-9._-]{1,96}     ; ASCII slug
```

Three minting rules are codified in `management-api/lib/uris.js` and enforced by every surface:

- **R1 — Content-addressed.** When a payload uniquely determines the resource (`credentialSubject`, an activity fingerprint, a Nostr envelope's signed bytes), `<local>` is `sha256-12-<first 12 hex chars of SHA-256(stableStringify(payload))>`. Same input → same URI, every time.

- **R2 — Scope-bearing.** When the resource is owned by an agent (every credential, every mandate, every receipt, every pod resource, every envelope, every activity), `<scope>` is the owner's BIP-340 x-only pubkey hex. e.g. `urn:agentbox:credential:01234567…:sha256-12-deadbeef`.

- **R3 — Stable-on-identity.** When the resource is a static thing with a public name (a skill id, an MCP server id, an ADR number), `<local>` is its public, immutable label and there is no `<scope>`. e.g. `urn:agentbox:skill:console-buddy`, `urn:agentbox:mcp:playwright`, `urn:agentbox:adr:013`.

### 2. Uniqueness vs resolvability — the primary contract

**Uniqueness is unconditional.** Every agentbox URI minted via `uris.mint()` is globally unique by construction. The same payload always yields the same URI. Different payloads always yield different URIs (modulo SHA-256 collision, which we treat as impossible). This guarantee holds whether or not the resolver can fetch the resource right now.

**Resolvability is best-effort.** A URI is a name. The resolver service `/v1/uri/<urn>` attempts to dereference a name to a current HTTPS IRI:

| Outcome | HTTP status | Meaning |
|---|---|---|
| Resolvable | 307 with `Location` | a current representation exists at the given IRI |
| Unknown | 404 | the URI is well-formed but the resolver does not know how to fetch it (resource never existed, was never persisted, or lives outside this resolver's reach) |
| Retracted | 410 | the URI was once resolvable; the resource has been deliberately deleted; clients should stop attempting to fetch |

Consumers can rely on URI uniqueness, always, and on resolvability only when the resolver answers 307. The viewer (S12) handles 404 by rendering the URN literally with a "no representation available" badge, so panes always render even when a referenced resource is unreachable.

### 3. Surface refactor

Every emitter under `management-api/middleware/linked-data/surfaces/` calls `uris.mint(...)` instead of generating IDs locally. The full mapping:

| Surface | Kind | Mint shape |
|---|---|---|
| S1 pods | `pod` | content-addressed, owner-scoped |
| S2 nostr | `envelope` | content-addressed, owner-scoped |
| S3 credentials | `credential` | content-addressed on `credentialSubject`, owner-scoped to issuer |
| S4 DID Documents | identity-uri (`did:nostr:<pubkey>`) | not minted; passed through |
| S5 provenance | `activity` | content-addressed on action+slot+operation+input+output, owner-scoped |
| S6 MCP descriptors | `mcp` | stable on serverId |
| S7 skills | `skill` | stable on skill id |
| S8 mandates | `mandate` | content-addressed on assignee+target+action+constraints, owner-scoped to principal |
| S8 receipts | `receipt` | content-addressed on mandate+amount+customer, owner-scoped to issuer |
| S9 DCAT | `dataset`, `memory` | stable on namespace name |
| S10 docs | `adr` / `prd` / `ddd` | stable on doc id |
| S11 events | `event` | content-addressed on action+slot+timestamp+payload, owner-scoped |
| S11 meta | `meta` | stable on `runtime` (one per agent) |

Caller-supplied IDs that are already canonical (per `uris.isCanonical()`) are honoured. Otherwise the surface mints a fresh one.

### 4. Resolver semantics

`/v1/uri/<urn>` (route at `management-api/routes/uri-resolver.js`) implements:

- 400 `malformed-uri` — input does not match the grammar.
- 307 `Location: <https-iri>` — resolver knows where to fetch the current representation.
- 404 `not-resolvable` — well-formed URI but no resolver mapping (e.g. ownership-scoped kind without a npub, kind whose surface is currently `off`).
- 410 `gone` — resource was once resolvable but has been retracted (reserved for future use; not currently emitted).

A self-describing endpoint at `/v1/uri` (no urn parameter) returns the grammar, the kind table, and the contract statements above as JSON-LD so external tooling can discover what this agentbox supports.

### 5. Always available

The resolver is always available, regardless of `[linked_data].enabled`. URI uniqueness is unconditional; only the **resolution** of specific kinds depends on which surfaces are enabled. e.g.:

- `urn:agentbox:credential:…` resolves only when S3 is enabled.
- `urn:agentbox:event:…` resolves only when S5 is enabled.
- `did:nostr:<pubkey>` resolves only when S4 (DID Documents) is enabled.

The resolver responds with 404 + a hint pointing at the manifest section to enable.

### 6. Public extension API

`uris.KINDS` is the public catalogue of kind metadata. Adding a new kind means:

1. Add an entry to `KINDS` with `{ ownerScope, contentAddressed, resolvableSurface }`.
2. Add a `case` to the resolver's switch in `routes/uri-resolver.js`.
3. Add a contract test asserting stable mint per fixture.
4. Document the kind in `docs/user/uris.md`.

No core changes; new surfaces and external integrators can extend the grammar without touching `lib/uris.js` if they're content with the existing kind set.

## Consequences

### Positive

- **Stable signatures.** S3 credentials and S8 payments now satisfy JCS round-trip with deterministic `@id`s. The proof block binds a meaningful identifier, not a freshly-rolled UUID.
- **Viewer can navigate.** S12 panes can follow links between surfaces (a credential's `evidence` points at a mandate URI; the resolver finds the mandate).
- **Deduplication is automatic.** Re-emitting the same payload yields the same URI, so external indexes don't double-count.
- **Identity has one canonical anchor.** `did:nostr:<pubkey>` is the agent's identity URI everywhere. Pod resources, envelopes, credentials, and events all carry the same agent scope.
- **Operator-friendly resolution.** A single route (`/v1/uri/`) replaces ad-hoc per-surface lookup logic. Tools that follow URIs by HTTP have one entry point.
- **URI uniqueness survives backend swaps.** A URI minted under `local-solid-rs` keeps its identity when the operator switches to `external` pods; only the resolver's redirect target changes.

### Negative

- **Breaking change for surface emitters.** Pre-ADR-013 callers that relied on `urn:uuid:` identifiers see their IDs change. Mitigation: caller-supplied canonical URIs are honoured (`uris.isCanonical()` check in every surface), so legacy callers can pass through their existing IDs if they're already canonical.
- **Mint cost on every emit.** SHA-256 over the stable-stringified payload runs on every dispatch. Tiny in practice (microseconds for small payloads), but measurable in tight loops. Mitigation: surfaces that can mint once and cache (e.g. S6 MCP descriptors) do.
- **Content-address fragility.** A payload change → a different URI. Cancelling a credential by issuing a new one with corrected fields produces a new URN. Mitigation: `evidence` field on the new VC references the old URN, so the chain is auditable. We document this clearly.
- **Resolver coupling.** External consumers that trust 307 redirects assume the resolver is reachable. Mitigation: 404/410 responses include the grammar so consumers can fall back to URI-as-name only when the resolver is unreachable.

### Risk that was considered and rejected

**Risk: collision in the 12-hex-char prefix.** With 48 bits of entropy, birthday-bound collision probability reaches 1% around 2.3M URIs of the same kind+scope. Mitigation: `<local>` can be expanded from 12 to 24 hex chars in a follow-up without breaking the grammar (the regex permits any HEXDIGIT count in the parser). Threshold for upgrade: when any single agent's per-kind cardinality exceeds 100k.

## Implementation notes

### Code

```
management-api/lib/uris.js              # mint + resolveCanonical + parse + isCanonical
management-api/routes/uri-resolver.js   # /v1/uri/<urn> endpoint
management-api/middleware/linked-data/surfaces/s{01..11}-*.js
                                        # every surface refactored to call uris.mint()
tests/contract/linked-data/uris.contract.spec.js
                                        # stable-mint contract per fixture
```

### Tests

`tests/contract/linked-data/uris.contract.spec.js`:

- `uri.uniqueness` — same payload always yields same URI, every kind, every surface.
- `uri.distinctness` — different payloads yield different URIs.
- `uri.canonical-form` — every minted URI matches the grammar regex.
- `uri.scope` — owner-scoped kinds without an npub raise `MalformedUri`.
- `uri.resolver-200` — known kinds return 307 + a parseable Location.
- `uri.resolver-404` — unknown kinds and unscoped owner-kinds return 404.

### Documentation

- [`docs/user/uris.md`](../../user/uris.md) — operator-facing one-page description of the grammar, the resolver semantics, and 12 worked examples.
- [`docs/user/browser.md`](../../user/browser.md) — viewer + URI integration story.
- [`docs/reference/_vocab/agbx.md`](../_vocab/agbx.md) — extends the term registry with URI-specific guidance.

## Acknowledgements

ADR-013 stands on:

- **W3C DID Core 1.0** — Drummond Reed, Manu Sporny, Dave Longley, Christopher Allen, Ryan Grant, Markus Sabadello. The two-step name-vs-resolution model.
- **IETF RFC 8141 (URN syntax)** — P. Saint-Andre, J. Klensin (IETF, April 2017). The URN philosophy of stable names independent of location.
- **W3C VC Data Model 2.0** — Sporny, Longley, Sabadello, Steele, Allen. Credential identifier conventions.
- **Linked Data Platform 1.0** — Steve Speicher, John Arwe, Ashok Malhotra. Container-relative URI conventions for pod resources.
- **The agentbox FOD-everything pattern** — `lib/npm-cli.nix`, `lib/solid-pod-rs.nix`, `lib/nagual-qe.nix`, `lib/linked-data-contexts.nix`. Content-addressing as a deployment discipline.
- **`did:nostr` method draft** — DreamLab-AI / nostr-protocol contributors.

In memoriam: **Gregg Kellogg** (d. 2025-09-06). The JSON-LD foundations every URI in this grammar plays inside.
