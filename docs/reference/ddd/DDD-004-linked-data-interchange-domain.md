# DDD-004: Linked-Data Interchange Domain

**Date**: 2026-04-25
**Status**: Accepted
**Bounded Context**: Linked-Data Interchange
**Cross-references**: [PRD-006](../prd/PRD-006-linked-data-interfaces.md) (product requirements), [ADR-012](../adr/ADR-012-jsonld-federation-grammar.md) (decision record), [ADR-005](../adr/ADR-005-pluggable-adapter-architecture.md) (consumed adapter dispatch path), [ADR-008](../adr/ADR-008-privacy-filter-routing.md) (upstream middleware), [ADR-010](../adr/ADR-010-rust-solid-pod-adoption.md) (S1 surface owner), [DDD-001](./DDD-001-immutable-bootstrap-domain.md) (build-time context catalogue is part of the runtime closure), [DDD-002](./DDD-002-runtime-contract-domain.md) (S11 surface emits the runtime contract via JSON-LD), [DDD-003](./DDD-003-sovereign-messaging-domain.md) (S2 envelope content is owned by this domain)

---

## TL;DR for newcomers
*Skip if you already know the linked-data-interchange bounded context.*

This DDD captures the Linked-Data Interchange bounded context: the part of the system that owns how agentbox-produced data appears to external integrators as W3C JSON-LD 1.1, how external JSON-LD reaches agentbox without compromising the privacy filter or the adapter contract, and how hand-authored documents stay safely round-trippable through full processing. The pain point is that the sovereign data stack already speaks the same identity (`did:nostr:<pubkey>`) at every layer, but the encoding at each layer was its own coordination problem — pod resources spoke RDF/Turtle, Nostr envelopes spoke ad-hoc JSON, payment receipts had no defined shape. The shape of the answer is a domain with explicit aggregates (`ContextDocument`, `ContextCatalogue`, `FederationSurface`, `EncodingPipeline`, `LinkedResource`, `LIONDocument`), twelve numbered invariants L01–L12 each mapping to a testable predicate, and a published language of domain events consumed by the `events` adapter slot.

**If you remember only one thing:** the encoder runs after the privacy filter and never fetches a context at runtime — the catalogue is part of the image, the contexts are content-addressed, and the LION subset is what humans write.

For the deep version, keep reading.

## Bounded context

**Owns** (IN):

- The catalogue of pinned context documents (`ContextCatalogue`, `ContextDocument`).
- The federation-surface taxonomy (`FederationSurface`) — the eleven surfaces from PRD-006 §3 and any future additions.
- The encoder pipeline that wraps adapter dispatch (`EncodingPipeline`) — the third middleware after observability (ADR-005) and the privacy filter (ADR-008).
- The linked-resource projections of adapter outputs (`LinkedResource`) — the post-encoder Compacted, Expanded, or Framed JSON-LD bytes.
- The LION authoring subset and its linter (`LIONDocument`).
- The vocabulary registry for `agbx:` terms with no upstream W3C / IETF / Schema.org equivalent.
- The conformance commitments — round-trip rule, JCS canonicalisation rule, W3C JSON-LD 1.1 Test Suite results.

**Does not own** (OUT):

- The cryptographic primitives (Schnorr / Ed25519 signing, BIP-340 verification). Owned by the Sovereign Messaging domain (DDD-003) for the in-process signer and by `solid-pod-rs` for HTTP-layer NIP-98.
- The privacy redaction itself — that is the Privacy Filter domain (ADR-008), which runs upstream of this one.
- The adapter slot business logic — that is the Adapter Contract (ADR-005). This domain wraps it but does not change it.
- The Solid Protocol semantics — owned by `solid-pod-rs`. This domain produces JSON-LD that solid-pod-rs serves as a content-negotiated representation; what `solid:` terms mean is delegated.
- The Nostr wire protocol — owned by DDD-003 and the embedded `nostr-rs-relay`. This domain produces the `content` payload of NIP-17 sealed DMs but not the envelope or the signing.
- Image-time context fetching — owned by the Immutable Bootstrap domain (DDD-001) and the FOD chain in `lib/linked-data-contexts.nix`. This domain consumes the resolved catalogue but does not perform the fetch.
- Vocabulary stewardship beyond the `agbx:` namespace. We bind to upstream vocabularies; we do not maintain them.

## Ubiquitous language

| Term | Definition |
|---|---|
| **ContextDocument** | A single JSON-LD `@context` document, identified by an IRI, content-hashed, stored at `/opt/agentbox/contexts/<name>.jsonld`. |
| **ContextCatalogue** | The build-time-resolved set of ContextDocuments shipped with the runtime image, indexed by IRI. |
| **PinnedContextIRI** | A `@context` IRI that has a corresponding ContextDocument in the ContextCatalogue. |
| **UnpinnedContextIRI** | A `@context` IRI not in the ContextCatalogue. The unknown-context-policy decides what happens when one appears in input. |
| **FederationSurface** | One of the eleven PRD-006 §3 surfaces, each with a fixed direction (emit / consume / both), JSON-LD form (Compacted / Expanded / Flattened / Framed), vocabulary binding, and manifest gate. |
| **EncodingPipeline** | The ordered middleware chain: observability → privacy filter → linked-data encoder → adapter implementation. |
| **LinkedResource** | The serialised JSON-LD bytes produced by the encoder for a given adapter dispatch. The encoder's output, the adapter implementation's input. |
| **LIONDocument** | A hand-authored JSON-LD document that satisfies the LION subset rules (PRD-006 §6.1). |
| **VocabularyBinding** | The mapping from a FederationSurface to the set of W3C / IETF / Schema.org vocabularies it uses. |
| **AgentboxVocabularyTerm** | A term in the `agbx:` namespace, i.e. `https://agentbox.dreamlab-ai.systems/ns/v1#<localname>`. Each term has a documented rationale. |
| **RoundTripGuarantee** | The CI-tested property `emit(input) == compact(expand(emit(input)), context)` per FederationSurface. |
| **CanonicalisationGuarantee** | The CI-tested property `canonicalise(emit(input)) == jcs(emit(input))` per signed FederationSurface (S3, S8). |
| **PrivacyHandoff** | The fixed-in-code ordering: redaction completes before encoding begins. |
| **UnknownContextPolicy** | One of `fail-closed` (reject) or `fail-open` (substitute stub context, log event). Default `fail-closed` for read paths; emit paths never produce unknown contexts. |

## Aggregates

### LinkedDataInterchange (Root Aggregate)

The authoritative external-encoding contract for one agentbox deployment.

```
LinkedDataInterchange
  +-- contextCatalogue: ContextCatalogue
  +-- surfaces: FederationSurface[]                  // eleven by default; extension-point
  +-- encodingPipeline: EncodingPipeline
  +-- vocabularyRegistry: VocabularyRegistry         // agbx: namespace + upstream bindings
  +-- conformance: ConformanceState                  // last test-suite + round-trip results
  |
  +-- ContextCatalogue
  |     +-- entries: ContextDocument[]
  |     +-- index: Map<IRI, ContextDocument>
  |     +-- unknownPolicy: "fail-closed" | "fail-open"
  |     +-- cacheMode: "image" | "bind" | "off"
  |
  +-- ContextDocument
  |     +-- iri: PinnedContextIRI
  |     +-- name: string                              // filename under /opt/agentbox/contexts
  |     +-- sha256: SRI hash                          // resolved at build time via FOD
  |     +-- bytes: bytes                              // immutable; mounted from image
  |     +-- vocabulary: string                        // human label; e.g. "ActivityStreams 2.0"
  |     +-- upstreamSource: URL                       // canonical W3C / IETF / Schema.org URL
  |     +-- pinnedAt: ISO-8601                        // build-time stamp
  |
  +-- FederationSurface
  |     +-- id: "S1" | "S2" | … | "S11" | "Sxx"      // PRD-006 §3 + extensions
  |     +-- direction: "emit" | "consume" | "both"
  |     +-- form: "compacted" | "expanded" | "flattened" | "framed"
  |     +-- vocabularyBinding: VocabularyBinding
  |     +-- manifestGate: string                      // e.g. "linked_data.pods"
  |     +-- prerequisiteAdapter: string | null        // e.g. "adapters.pods"
  |     +-- canonicalisation: "jcs" | "none"
  |     +-- frame: Frame | null                       // S10 only
  |     +-- enabled: boolean
  |
  +-- EncodingPipeline
  |     +-- order: ["observability", "privacy_filter", "linked_data", "adapter"]   // fixed
  |     +-- privacyHandoff: "after"                   // fixed; documentation key only
  |     +-- encoder: jsonld.js v8 | json-ld v0.21
  |     +-- jcs: jcs.js (RFC 8785) | none
  |
  +-- VocabularyRegistry
  |     +-- upstream: Map<prefix, IRI>                // as: → activitystreams, etc.
  |     +-- agbx: AgentboxVocabularyTerm[]
  |     +-- agbxContextDocument: ContextDocument
  |
  +-- ConformanceState
  |     +-- lastRoundTripRun: ISO-8601
  |     +-- roundTripPassedSurfaces: Set<surfaceId>
  |     +-- lastJcsRun: ISO-8601
  |     +-- jcsPassedSurfaces: Set<surfaceId>
  |     +-- lastW3CSuiteRun: ISO-8601
  |     +-- w3cSuiteResults: { expand: number, compact: number, frame: number }
```

**Consistency boundary**: singleton per container. Loaded once at management-api startup from `/opt/agentbox/contexts/index.json` plus the active `agentbox.toml`. Mutations (operator overrides via `[linked_data.contexts]`) are applied at boot only; runtime never mutates the catalogue.

### ContextCatalogue (sub-aggregate root)

Holds every pinned ContextDocument and the index that lets the encoder resolve an IRI to bytes in O(1).

```
ContextCatalogue
  +-- entries: ContextDocument[]
  +-- index: Map<IRI, ContextDocument>               // populated at boot
  +-- unknownPolicy: "fail-closed" | "fail-open"
  +-- cacheMode: "image" | "bind" | "off"
```

**Consistency boundary**: image-time content. The build closure (DDD-001) materialises every ContextDocument; the runtime mounts them read-only.

**Invariants**:

- Every `ContextDocument.sha256` is content-addressed and verified at boot (L01).
- The catalogue is read-only at runtime (L02).
- Every PinnedContextIRI in the catalogue resolves to exactly one ContextDocument (no duplicates, no aliases) (L03).

### FederationSurface

One of the eleven PRD-006 §3 surfaces, each with a fixed direction, form, and vocabulary binding.

```
FederationSurface
  +-- id: surfaceId
  +-- direction: "emit" | "consume" | "both"
  +-- form: jsonLDForm
  +-- vocabularyBinding: VocabularyBinding
  +-- manifestGate: tomlPath
  +-- prerequisiteAdapter: tomlPath | null
  +-- canonicalisation: "jcs" | "none"
  +-- frame: Frame | null
  +-- enabled: boolean                                // resolved from manifest
```

**Consistency boundary**: per FederationSurface, but several share prerequisites (e.g. S2 requires `[sovereign_mesh.relay].enabled = true`; S1 + S4 + S9 all touch solid-pod-rs).

**Invariants**:

- A FederationSurface is `enabled = true` only if its manifest gate AND its prerequisite adapter are both satisfied (L04).
- `direction = "emit"` surfaces never appear in the consume-path validator (L05).
- `canonicalisation = "jcs"` is set if and only if `id ∈ {S3, S8}` (L06).
- `form = "framed"` is set if and only if `frame` is non-null (L07).

### EncodingPipeline

The ordered middleware chain that wraps the adapter dispatch path.

```
EncodingPipeline
  +-- order: ["observability", "privacy_filter", "linked_data", "adapter"]   // fixed
  +-- privacyHandoff: "after"                         // fixed; doc-only key
  +-- encoder: jsonld.js | json-ld
  +-- jcs: jcs.js | none
```

**Consistency boundary**: singleton per process. The order is enforced in code; the manifest's `[linked_data].privacy_handoff.order` is documentation only and the validator rejects any other value.

**Invariants**:

- Order is fixed; the encoder always runs after the privacy filter (L08).
- The encoder never fetches a context at runtime; every `@context` resolution goes through the ContextCatalogue (L09).
- The encoder is a no-op when `[linked_data].enabled = false` (L10).

### LinkedResource

The serialised JSON-LD bytes produced by the encoder for a single adapter dispatch.

```
LinkedResource
  +-- surface: surfaceId
  +-- form: jsonLDForm
  +-- bytes: bytes
  +-- contextIRI: PinnedContextIRI
  +-- canonicalised: boolean                          // true if surface.canonicalisation = "jcs"
  +-- canonicalHash: SHA-256 | null                   // present iff canonicalised
  +-- producedAt: ISO-8601
  +-- producedBy: did:nostr:<pubkey>                    // the agent identity
```

**Consistency boundary**: per dispatch. Each LinkedResource is immutable once produced; subsequent edits go through a new dispatch.

**Invariants**:

- `bytes` parses as valid JSON-LD 1.1 (L11).
- `bytes` round-trips through `compact(expand(bytes), contextIRI) == bytes` (L12).
- For S3 + S8, `canonicalHash == sha256(jcs(bytes))`.

### LIONDocument

A hand-authored JSON-LD document that satisfies the LION subset rules.

```
LIONDocument
  +-- path: filesystemPath
  +-- inheritedSurface: surfaceId                     // S7 or S10
  +-- bytes: bytes                                    // raw markdown frontmatter or .jsonld
  +-- linterStatus: "pass" | "fail"
  +-- linterErrors: LIONError[]
```

**Consistency boundary**: per file. The CI runs the linter on every `.md` file with a JSON-LD frontmatter block.

**Invariants**:

- A LIONDocument has `linterStatus = "pass"` before merge (CI gate).
- Every `@id` in a LIONDocument is an absolute IRI or a base-relative IRI under the document's surface.
- LIONDocuments may not redefine `@protected` terms in the inherited surface's context.

### URICanonicaliser

Owns the URI grammar (ADR-013). Stateless mint+resolve service used by every surface emitter and by the `/v1/uri/<urn>` resolver route.

```
URICanonicaliser
  +-- KINDS: Map<kind, KindSpec>            // see ADR-013 §1
  +-- mint({ kind, npub, payload, localId }) → uri
  +-- resolveCanonical(uri, { managementApiBase, podBase }) → IRI | null
  +-- parse(uri) → { scheme, kind, npub, local } | null
  +-- isCanonical(uri) → boolean
```

**Consistency boundary**: stateless. Every call to `mint` is deterministic on its inputs; every call to `parse` and `isCanonical` is a pure regex match against the grammar.

**Invariants**:

- L13 (uniqueness) — `mint(input₁) === mint(input₂)` if and only if the inputs are deeply equal.
- L14 (resolvability is best-effort) — `resolveCanonical` returns either an HTTPS IRI or `null`; it never raises and never blocks on I/O.
- L15 (kinds are closed) — adding a kind is a code change to `KINDS`; an unknown kind raises `UnknownUriKind` at `mint` time and returns 404 at `/v1/uri/<urn>`.

### ViewerSurface

Models the S12 surface — the JSON-LD-aware browser at `/lo/*`. The viewer is one implementation among many behind a stable pane-manifest contract.

```
ViewerSurface
  +-- impl: "local-linkedobjects" | "external" | "off"
  +-- enabled: boolean
  +-- mountPath: string                       // default "/lo"
  +-- bundlePath: string                      // /opt/agentbox/browser when impl = local
  +-- externalUrl: string | null              // when impl = external
  +-- panesDir: filesystemPath                // built-in panes
  +-- buildPaneManifest(opts) → PaneManifest
  +-- buildInfo: { name, version, source, license, rev }
  +-- sourceCodeHeader: URL                   // AGPL §13
```

**Consistency boundary**: singleton per process. Resolved at boot from `[linked_data.viewer]`. Mutations (operator adding a pane via `extra_panes`) are picked up on the next manifest request — there's no live reload of the bundle, only of the manifest.

**Invariants**:

- L16 (no traversal) — pane requests at `/lo/panes/<file>` reject `..`, `/`, and `\` in the file name; bundle requests resolve to a path under `bundlePath` (verified by `path.startsWith`).
- L17 (AGPL §13 header) — every response from `/lo/*` carries a `Source-Code` HTTP header pointing at the upstream repository.
- L18 (manifest is authoritative) — adding a pane is a one-line manifest operation; the agentbox first-party code never imports a pane directly.

## Numbered invariants

Each invariant maps to a testable predicate in `tests/contract/linked-data/invariants.spec.js`.

| ID | Invariant | Test |
|---|---|---|
| **L01** | Every `ContextDocument.sha256` is verified at boot against the file bytes; mismatch aborts startup. | `verifyCatalogueAtBoot()` |
| **L02** | The ContextCatalogue is read-only at runtime; `cacheMode = "image"` enforces filesystem-level read-only. | `catalogueIsReadOnly()` |
| **L03** | Every PinnedContextIRI resolves to exactly one ContextDocument. Duplicates abort startup. | `catalogueIndexIsBijective()` |
| **L04** | A FederationSurface is `enabled = true` only if its manifest gate AND its prerequisite adapter are both satisfied. | `surfacePrerequisitesEnforced()` |
| **L05** | `direction = "emit"` surfaces never appear in the consume-path validator; calling decode on an emit-only surface throws `EmitOnlySurface`. | `emitOnlySurfacesRejectDecode()` |
| **L06** | `canonicalisation = "jcs"` if and only if `id ∈ {S3, S8}`. | `canonicalisationOnlyForSignedSurfaces()` |
| **L07** | `form = "framed"` if and only if `frame` is non-null. | `framedSurfacesHaveFrame()` |
| **L08** | The encoder runs strictly after the privacy filter in the dispatch path. The fixed order is enforced in code; the validator rejects any `[linked_data].privacy_handoff.order != "after"`. | `pipelineOrderingFixed()` |
| **L09** | The encoder never fetches a context at runtime; every `@context` resolution goes through the ContextCatalogue. Test: monkey-patch `fetch` to throw, run the full encoder test suite, assert no `fetch` calls. | `encoderDoesNotFetchAtRuntime()` |
| **L10** | The encoder is a no-op when `[linked_data].enabled = false`; the dispatch path bypasses the middleware entirely. | `encoderNoOpWhenDisabled()` |
| **L11** | Every emitted LinkedResource is valid JSON-LD 1.1 per the W3C Test Suite expand+compact tests. | `everyEmittedResourceIsValidJsonld()` |
| **L12** | Every emitted LinkedResource satisfies `compact(expand(bytes), contextIRI) == bytes`. | `roundTripIsByteIdentical()` |
| **L13** | `uris.mint(input₁) === uris.mint(input₂)` iff inputs are deeply equal. | `uri.uniqueness()` |
| **L14** | `uris.resolveCanonical` returns IRI or null; never raises, never blocks on I/O. | `resolverIsPureFunction()` |
| **L15** | Unknown kinds raise `UnknownUriKind` at mint, return 404 at `/v1/uri/<urn>`. | `unknownKindRejected()` |
| **L16** | Pane requests reject `..` / `/` / `\` traversal. Bundle requests resolve under `bundlePath`. | `viewerRejectsTraversal()` |
| **L17** | Every `/lo/*` response carries `Source-Code` header (AGPL §13). | `viewerSourceCodeHeader()` |
| **L18** | Adding a pane is a one-line manifest operation; agentbox first-party code never imports panes. | `paneRegistryIsDataDriven()` |

## Domain events

The Linked-Data Interchange domain emits the following domain events to the `events` adapter slot. Consumers (intelligence routing, observability backend, federated peers) subscribe via the slot's standard mechanism.

| Event | Trigger | Payload |
|---|---|---|
| `linked-data.surface-enabled` | A FederationSurface transitions to `enabled = true` at boot or via reload. | `{ surfaceId, manifestGate, prerequisiteAdapter, vocabularyBinding }` |
| `linked-data.surface-disabled` | Transition to `enabled = false`. | `{ surfaceId, reason }` |
| `linked-data.context-loaded` | A ContextDocument is loaded into the in-memory index at boot. | `{ iri, sha256, name, vocabulary }` |
| `linked-data.unknown-context` | An UnpinnedContextIRI appears in input on a consume-path surface. | `{ iri, surface, policy, action }` (action = `"rejected"` for fail-closed, `"stub-substituted"` for fail-open) |
| `linked-data.encode-completed` | An adapter dispatch's encoding step finishes successfully. | `{ surfaceId, form, bytesLength, contextIRI, durationMs, agent }` |
| `linked-data.encode-failed` | An adapter dispatch's encoding step throws. | `{ surfaceId, errorClass, errorMessage, agent }` |
| `linked-data.round-trip-violation` | A CI round-trip test fails. | `{ surfaceId, fixturePath, expectedSha256, actualSha256 }` |
| `linked-data.canonicalisation-completed` | A signed surface (S3, S8) computes a JCS hash. | `{ surfaceId, canonicalHash, payloadSize, agent }` |
| `linked-data.lion-lint-completed` | The LION linter finishes a run. | `{ path, status, errorCount }` |

Per ADR-005, every event also carries the standard observability spine: span ID, timestamp, originating agent's `did:nostr:<pubkey>`.

## Consistency model

### Build time (DDD-001)

The ContextCatalogue is materialised entirely at build time:

1. `lib/linked-data-contexts.nix` declares each ContextDocument with its IRI and SRI hash.
2. `pkgs.fetchurl` resolves each entry as a fixed-output derivation; sandbox-permitted because outputHash is declared.
3. `pkgs.symlinkJoin` aggregates every fetched document under a single `/opt/agentbox/contexts/` root with an `index.json` mapping IRI → filename.
4. The image build embeds this root as part of the runtime closure.

Result: the runtime image contains every ContextDocument needed at runtime, with content-addressed integrity, with zero network access from the running container.

### Boot time (DDD-002)

The management-api startup sequence:

1. `LinkedDataContextResolver` reads `/opt/agentbox/contexts/index.json`.
2. For each entry, the resolver verifies `sha256(file_bytes) == declared_sha256`; mismatch raises `CatalogueIntegrityFailure` and the readiness probe stays red (DDD-002 Probe Contract).
3. The resolver populates the in-memory `Map<IRI, ContextDocument>` index.
4. For each FederationSurface, the boot logic checks the manifest gate and prerequisite adapter; passing surfaces are added to the EncodingPipeline.
5. Boot completes with `linked-data.context-loaded` for each ContextDocument and `linked-data.surface-enabled` for each enabled surface.

### Runtime

The EncodingPipeline runs synchronously in the adapter dispatch path. Every adapter write has the form:

```javascript
async function dispatch(slotId, operation, payload, context) {
  const span = observability.before(slotId, operation, context);
  try {
    const redacted = await privacyFilter.redact(slotId, operation, payload);
    const encoded  = await linkedData.encode(slotId, operation, redacted);
    const result   = await adapters[slotId].impl[operation](encoded);
    span.complete(result);
    return result;
  } catch (err) {
    span.error(err);
    throw err;
  }
}
```

The encoder is the only piece of code that knows about JSON-LD. Adapter implementations see `encoded.bytes` (a `Buffer`) and write it as-is.

### Failure modes

| Failure | Detection | Recovery |
|---|---|---|
| Catalogue file mismatch (boot) | L01 boot-time SHA-256 check | Readiness stays red; operator must rebuild image |
| Unknown `@context` IRI in input (read path) | L09 runtime check | If `fail-closed`: reject with 415. If `fail-open`: log `linked-data.unknown-context`, substitute stub context |
| Round-trip violation (CI) | L12 round-trip test | CI fails, merge blocked |
| JCS hash mismatch (S3, S8) | L06 canonicalisation rule | Signature verification fails; consumer rejects; agent retries with corrected payload |
| LION lint failure (authoring) | LION linter on `.md` files | CI fails, merge blocked |
| Privacy-filter ordering violation (test) | L08 pipeline order test | CI fails, merge blocked |

## Relationship to other domains

```
DDD-001 (Immutable Bootstrap)
    │  produces RuntimeClosure containing /opt/agentbox/contexts/
    ▼
DDD-002 (Runtime Contract)
    │  exposes /v1/meta as S11 (Compacted JSON-LD)
    │  health probes carry no JSON-LD (internal)
    ▼
DDD-004 (Linked-Data Interchange)  ← this domain
    │
    ├──> DDD-003 (Sovereign Messaging)
    │       writes S2 envelope content into NIP-17 sealed DMs
    │       reads from PodMailbox to publish S5 PROV-O receipts
    │
    ├──> Adapter Contract (ADR-005)
    │       wraps every adapter dispatch as the third middleware
    │       contract tests run against all three implementation classes per slot
    │
    └──> Privacy Filter (ADR-008)
            consumes post-redaction bytes
            never sees raw user-supplied content
```

The Linked-Data Interchange domain is **downstream** of the Sovereign Messaging domain (it encodes what DDD-003 has signed) and **upstream** of nothing — it produces bytes that adapters write. It is a pure encoding layer.

## Repository layout

```
management-api/middleware/linked-data/        # owned by this domain
├── encoder.js
├── context-resolver.js
├── lion-linter.js
├── round-trip.js
├── jcs.js
└── surfaces/
    ├── s01-pods.js  …  s11-http-meta.js

lib/linked-data-contexts.nix                  # owned by DDD-001 (build closure)
                                              # consumed by this domain at boot
/opt/agentbox/contexts/                       # runtime mount; populated by DDD-001
├── index.json
├── activitystreams.context.jsonld
├── credentials-v2.context.jsonld
├── did-v1.context.jsonld
├── schema-org.context.jsonld
├── wot-td.context.jsonld
├── prov-o.context.jsonld
├── dcat-3.context.jsonld
├── odrl-2.context.jsonld
├── skos.context.jsonld
├── dcterms.context.jsonld
└── agentbox-v1.context.jsonld

docs/reference/_vocab/agbx.md                 # owned by this domain
                                              # rationale per agbx: term

tests/contract/linked-data/                   # owned by this domain
├── invariants.spec.js                         # L01–L12
├── round-trip.spec.js
├── jcs.spec.js
├── w3c-test-suite.spec.js
├── pods-s1.spec.js  …  http-meta-s11.spec.js
├── privacy-handoff.spec.js
├── lion-linter.spec.js
└── unknown-context.spec.js
```

## Vocabulary registry

The `agbx:` namespace is reserved for terms with no upstream W3C / IETF / Schema.org equivalent. Each term has:

- A localname under `https://agentbox.dreamlab-ai.systems/ns/v1#`.
- A datatype (or `@type: @id` for IRI references).
- A documented rationale in `docs/reference/_vocab/agbx.md`.
- A round-trip test fixture in `tests/contract/linked-data/vocab-agbx.spec.js`.

Initial term set (Phase 1 + 2 + 3):

| Term | Datatype | Used by | Rationale |
|---|---|---|---|
| `agbx:HandoffClaim` | `@type` | S2, S5 | Bead claim handoffs from one agent to another; ActivityStreams `as:Activity` is too generic |
| `agbx:RequestBriefing` | `@type` | S2 | Internal-agent request to external-agent for context; AS `as:Question` doesn't carry agentbox claim semantics |
| `agbx:DeliverArtefact` | `@type` | S2, S5 | Delivery of a produced file or memory entry; AS `as:Add` semantics differ |
| `agbx:ProgressiveDisclosure` | `xsd:boolean` | S7 | Skill metadata flag indicating just-in-time disclosure; not in Schema.org HowTo |
| `agbx:invocationTrigger` | `xsd:string` | S7 | Skill invocation trigger pattern; not in Schema.org |
| `agbx:requires` | `@type: @id` | S6, S7 | Capability requirement; WoT TD `td:hasRequiredFunction` is too narrow |
| `agbx:redacted` | `xsd:boolean` | every surface | Privacy-filter redaction flag; no upstream equivalent |
| `agbx:RuntimeContract` | `@type` | S11 | DDD-002 RuntimeContract aggregate exposed as JSON-LD |
| `agbx:adr` `agbx:prd` `agbx:ddd` | `@type` | S10 | Architecture document classes; SKOS classes too generic |
| `agbx:Capability` | `@type` | S6 | MCP capability descriptor variant of Schema.org SoftwareApplication |

Adding a term requires a one-paragraph rationale, a search confirming no upstream equivalent, and a round-trip test. The rationale is reviewed in PR.

## Acknowledgements

This domain stands on the shoulders of:

- **W3C JSON-LD 1.1 Working Group** — Gregg Kellogg (in memoriam, d. 2025-09-06), Pierre-Antoine Champin, Dave Longley, Manu Sporny, Markus Lanthaler, Niklas Lindström.
- **W3C Verifiable Credentials WG** — Sporny, Longley, Sabadello, Steele, Allen.
- **W3C DID WG** — Reed, Sporny, Longley, Allen, Grant, Sabadello.
- **W3C Web of Things WG** — Käbisch, Charpenay, Kovatsch.
- **W3C PROV WG** — Lebo, Sahoo, McGuinness.
- **Schema.org** community.
- **Solid Project** — Capadisli, Berners-Lee, Verborgh, Kjernsmo, Bingham, Zagidulin.
- **Linked Object Notation (LION)** — Melvin Carvalho et al., MIT-licensed.
- **`jsonld.js`** — Dave Longley, Manu Sporny (Digital Bazaar), BSD-3-Clause.
- **`json-ld` Rust crate** — Timothée Haudebourg, Apache-2.0.
- **JCS (RFC 8785)** — Anders Rundgren, Bret Jordan, Samuel Erdtman.

The complete bibliography is in [PRD-006 §14](../prd/PRD-006-linked-data-interfaces.md#14-acknowledgements-and-attribution).
