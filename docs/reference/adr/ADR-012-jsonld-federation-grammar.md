# ADR-012: JSON-LD 1.1 as the federation interchange grammar

**Status:** Accepted
**Date:** 2026-04-25
**Author:** Agentbox team
**Supersedes:** n/a
**Related:** ADR-005 (Pluggable adapter architecture — this ADR adds the third middleware), ADR-008 (Privacy filter routing — JSON-LD encoder runs after redaction), ADR-009 (Embedded Nostr relay — S2 envelope payloads), ADR-010 (solid-pod-rs — S1 representations), PRD-006 (Linked-data interfaces — this ADR's product spec), DDD-004 (Linked-data interchange domain — this ADR's bounded context)

## TL;DR for newcomers
*Skip if you already know why agentbox commits to a single semantic encoding at its outer edges.*

This ADR explains why agentbox adopts [JSON-LD 1.1](https://www.w3.org/TR/json-ld11/) as the canonical encoding at every external interchange surface, why a Linked Object Notation (LION) subset handles hand-authored documents, and why neither one ever crosses into internal config or the adapter dispatch path. The pain point is that the sovereign data stack already speaks RDF on the pod side, idiomatic JSON on the relay side, ad-hoc envelopes on the payments side, and prose-only on the architecture-doc side; integrators write a parser per surface today, and the same agent identity reaches the world differently from each one. The shape of the answer is **JSON-LD 1.1 as a third cross-cutting middleware** (sitting next to ADR-005 observability and ADR-008 privacy filter), with surface-specific forms (Compacted, Expanded, Framed) selected by the eleven surface inventory in PRD-006, plus a strict LION subset for hand-authored documents, plus a build-time-pinned context catalogue that mirrors the agentbox FOD-everything pattern. You will learn the alternatives considered, the decision boundaries, the middleware ordering, the manifest contract, and the conformance commitments.

**If you remember only one thing:** one grammar at every federation seam, one authoring subset for humans, one pinned context catalogue — agentbox stays idiomatic-JSON inside while becoming Linked Data at its edges.

For the deep version, keep reading.

## Context

Agentbox already has a coherent identity (`sovereign-bootstrap.py` + did:nostr in [solid-pod-rs](ADR-010-rust-solid-pod-adoption.md)), a coherent durable substrate ([solid-pod-rs](ADR-010-rust-solid-pod-adoption.md) for pods, [nostr-rs-relay](ADR-009-embedded-nostr-relay.md) for messaging), a coherent privacy posture ([privacy filter](ADR-008-privacy-filter-routing.md)), and a coherent contract surface ([adapter slots](ADR-005-pluggable-adapter-architecture.md)). What it does not have is a coherent **encoding** at the outer edge.

Today the encoding situation looks like this:

| Surface | Encoding | Consequence |
|---|---|---|
| Pod resource representations | JSON or Turtle, content-negotiated by solid-pod-rs | Solid clients work; agentbox-specific clients write a parser |
| Nostr envelope payloads (NIP-17 sealed DMs) | Ad-hoc JSON inside the sealed `content` | Every counterparty negotiates the shape bilaterally |
| Bead claims and work receipts | Plain JSON to the `events` adapter | External integrators build a custom subscriber |
| Verifiable claims about agent identity | Not currently emitted | No verification path exists |
| DID Documents | Not currently emitted | did:nostr resolution requires bespoke code |
| MCP capability descriptors | agentbox-internal TOML + Python | Host orchestrators discover capabilities by reading agentbox source |
| Skill metadata | Markdown frontmatter | Other agent runtimes cannot learn about an agentbox skill |
| Agentic-payment authorisations | Not yet defined | Each payment counterparty proposes its own envelope |
| Memory namespace catalogues | RuVector-internal | Federated peers cannot discover what agentbox holds |
| Architecture documentation cross-references | Markdown prose links | Architecture is not machine-traversable |
| `/v1/meta` and `/v1/agent-events` HTTP responses | Plain JSON | Linked-Data-first integrators (Solid, Inrupt, ActivityPub) need a translator |

Every entry in this table is an integrator-visible surface. Each currently uses its own encoding, vocabulary, and shape. An agent that signs a Nostr event, reaches a pod, persists a credential, writes a memory entry, and authorises a payment touches **five different encodings** with five different validation regimes. The agent identity is consistent (a single `did:nostr:<pubkey>`); the encoding is not.

Three constraints shape the decision:

1. **Agentbox's adapter contract is non-negotiable.** Per [ADR-005](ADR-005-pluggable-adapter-architecture.md) and the project rule in [CLAUDE.md](../../../CLAUDE.md), every durable-state integration goes through one of the five adapter slots. New encoding behaviour must fit the existing slot model, not add a sixth slot, not bypass the adapter dispatch path.
2. **Internal idiomatic JSON must remain.** Agentbox's per-surface code is small and idiomatic JavaScript / Rust / Python. Forcing every internal hand-off through `expand → compact` would inflate the codebase, slow the dispatch path, and make debugging harder. Linked-Data encoding belongs at the **outer** edge, not the inner one.
3. **Privacy filter is upstream.** [ADR-008](ADR-008-privacy-filter-routing.md) redacts user-supplied bytes before any durable write. Any encoding step has to run *after* redaction so the encoder never sees raw PII.

Within those constraints, three approaches were live:

### Alternative A — keep ad-hoc per-surface encodings

The cheapest option. Costs nothing today. Costs everything tomorrow: every new integrator writes a parser per surface, every surface change is a coordination problem with every consumer, and the value of the unified `did:nostr` identity is undercut because the things signed under that identity are heterogeneous blobs.

Rejected on principle (ADR-005's "behavioural equivalence" doctrine applies to encoding too) and on cost (the agentic-payments work in PRD-005 was already trending toward a bespoke envelope; PRD-006 absorbs it into a standards-compliant shape).

### Alternative B — switch internals to RDF / SPARQL throughout

The most "correct" option from an academic Linked-Data standpoint. Every adapter call would expand to triples, every internal queue would carry triples, every contract test would exercise SPARQL. solid-pod-rs already supports it for pod resources.

Rejected. The cost is enormous: the entire JavaScript management-api would need an RDF representation library; the Nostr bridge code would need to wrap every plain-string field in literal-typing logic; the privacy-filter middleware would need to navigate triple graphs instead of JSON paths. None of this changes what an external integrator sees compared to Alternative C, which gets the same external surface for a fraction of the cost.

### Alternative C — JSON-LD 1.1 as a cross-cutting encoding middleware at the federation edge

Adopt JSON-LD 1.1 as a middleware that runs after the privacy filter in the adapter dispatch path, encoding adapter outputs into Compacted JSON-LD using a published context. Internal code stays JSON. External integrators see Linked Data. Hand-authored documents use the LION subset, which is mechanically a subset of JSON-LD and round-trips through full processing.

This is what we adopt.

The JSON-LD 1.1 specification is mature ([W3C Recommendation 2020-07-16, errata 2025-06-04](https://www.w3.org/TR/json-ld11/)), has multiple production implementations (jsonld.js, json-ld-rs, pyld, JsonLD-PHP), is the canonical encoding for [W3C Verifiable Credentials 2.0](https://www.w3.org/TR/vc-data-model-2.0/), [W3C DID Core 1.0](https://www.w3.org/TR/did-core/), and the [Solid Protocol](https://solidproject.org/TR/protocol). Adopting it does not pull in a research project; it pulls in a deployed stack with a 12-year track record and an editor team — Gregg Kellogg, Pierre-Antoine Champin, Dave Longley — whose work the broader Linked Data ecosystem already depends on.

## Decision

We adopt JSON-LD 1.1 as the canonical encoding at every external interchange surface and the LION subset for hand-authored documents.

Concretely:

### 1. JSON-LD as the third cross-cutting middleware

The adapter dispatch path now has three middleware layers, in this fixed order:

```
adapter.write(payload)
  └─> observability.before()           (ADR-005 §Observability)
      └─> privacy_filter.redact()      (ADR-008)
          └─> linked_data.encode()     (ADR-012, this decision)
              └─> adapter.<impl>.write(jsonld_bytes)
```

The order is fixed in code. The `[linked_data].privacy_handoff.order` manifest key is documentation only; the validator rejects any value other than `"after"`. This means:

- Observability sees the unredacted payload (so spans correctly attribute work to the originating identity).
- Privacy filter sees the post-observability payload and redacts it.
- JSON-LD encoder sees only the post-redaction payload; it never touches raw user data.

### 2. The eleven federation surfaces from PRD-006

[PRD-006 §3](../prd/PRD-006-linked-data-interfaces.md#3-surface-inventory) enumerates eleven surfaces. Each surface picks one JSON-LD form (Compacted, Expanded, or Framed) and binds to specific W3C / IETF / Schema.org vocabularies. The adapter contract from ADR-005 is unchanged; the slot's `external` and `local-*` implementations both produce JSON-LD when the surface is enabled.

### 3. Authoring subset

Hand-authored documents (skill `SKILL.md` frontmatter, ADR / PRD / DDD frontmatter, mandates that humans review before signing) use [Linked Object Notation (LION)](https://linkedobjects.github.io/) — a strict subset of JSON-LD 1.1 with five rules ([PRD-006 §6.1](../prd/PRD-006-linked-data-interfaces.md#61-lion-rules)). Every LION document is a valid JSON-LD document by construction. The build re-emits LION as full JSON-LD; the LION linter rejects anything outside the subset.

### 4. Build-time-pinned context catalogue

Every `@context` IRI consumed by agentbox is resolved at build time and pinned into the runtime image at `/opt/agentbox/contexts/`. Mirrors the FOD-everything pattern from `lib/npm-cli.nix`, `lib/solid-pod-rs.nix`, and `lib/nagual-qe.nix`. The runtime resolver loads the catalogue index once and never fetches a context document at runtime.

`scripts/prefetch-hashes.sh --linked-data` walks the catalogue and resolves every `lib.fakeHash` to a real SRI hash on first build of a fresh clone, mirroring the existing `--cli` and `--service` flags.

### 5. Default-off master gate

`[linked_data].enabled = false` ships in the default manifest. Operators opt in per-surface. A user who runs `./agentbox.sh up --build` against the default manifest sees zero behavioural change.

### 6. Conformance commitments

- **Round-trip:** every emitter satisfies `emit(input) == compact(expand(emit(input)), context)` in CI.
- **Canonicalisation:** surfaces that produce signed credentials or signed mandates (S3, S8) additionally satisfy JCS round-trip ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)).
- **W3C JSON-LD Test Suite:** 100% pass rate on Expansion, Compaction, and applicable Framing tests, run weekly via `nix flake check`.
- **No vocabulary lock-in:** if a W3C / IETF / Schema.org vocabulary covers a concept, agentbox uses it; the `agbx:` namespace is reserved for terms with no upstream equivalent and requires a documented rationale ([PRD-006 §8.4](../prd/PRD-006-linked-data-interfaces.md#84-no-vocabulary-lock-in)).

### 7. Adapter contract is unchanged

ADR-005's five-slot model stays exactly as it is. PRD-006 sits *above* the adapter contract; it does not add a sixth slot, does not change any existing slot's interface, and does not introduce a new implementation class. The five existing implementations of each slot continue to pass the contract test harness; PRD-006 adds a new layer of contract tests for the encoding middleware itself.

### 8. Manifest surface

A new top-level section `[linked_data]` (full grammar in [PRD-006 §4](../prd/PRD-006-linked-data-interfaces.md#4-manifest-model)) controls every surface. Validation rules E040–E049 (PRD-006 §4.1) are enforced by `agentbox config validate` before `nix build` is allowed to attempt.

### 9. Phased rollout

Three phases ([PRD-006 §11](../prd/PRD-006-linked-data-interfaces.md#11-phased-rollout)):

- **Phase 1 (target 2026-05):** mechanism only — context catalogue, LION linter, manifest model, S10 architecture-docs, S7 skill metadata. No user-data-touching surface yet.
- **Phase 2 (target 2026-06):** sovereign-stack surfaces — S1 pods, S2 Nostr envelopes, S4 DID Documents, S5 PROV-O, privacy-filter handoff in code.
- **Phase 3 (target 2026-07):** credential-bearing surfaces — S3 VCs, S8 agentic payments, S6 WoT capability descriptors, S9 DCAT memory catalogues, S11 HTTP content negotiation, JCS canonicalisation enforced.

## Consequences

### Positive

- **One identity reaches the world consistently.** A `did:nostr:<pubkey>` signs an S1 pod resource, an S2 Nostr envelope, an S3 credential, an S4 DID Document, an S5 provenance receipt, and an S8 mandate — each is verifiable through the same chain.
- **External integrators have a known interface.** A Solid client, an ActivityPub client, a VC verifier, or a SPARQL-aware host all work against agentbox without bespoke code.
- **The agentic-payments work pulls into VC + ODRL.** PRD-005's consultant-tier receipts and any future payment authorisations sit in a deployed cryptographic-claim ecosystem instead of a bespoke envelope.
- **`agbx:` extensions stay small.** Most concepts agentbox needs already exist in W3C vocabularies; the rationale-required gate keeps `agbx:` from sprawling.
- **Architecture is machine-traversable.** S10 makes the ADR / PRD / DDD graph a first-class artefact; future architecture tooling can build on it.
- **The privacy filter and observability are unaffected.** Both middlewares pre-date this ADR and continue to work; the encoder is downstream.
- **No internal complexity tax.** Internal JSON paths, internal queues, and per-process state stay plain JSON. Only the outer edge changes.

### Negative

- **Build-time context resolution is an additional FOD chain.** Each context document requires an SRI hash at build time. The same fakeHash workflow that operators already run for npm CLIs and Cargo crates extends to this catalogue. Mitigation: the `prefetch-hashes.sh --linked-data` flag automates it.
- **Three middleware layers are more than two.** The adapter dispatch path is fractionally slower per write. Mitigation: the encoder is opt-in per surface; default-off mode incurs zero cost.
- **JSON-LD has footguns.** Scoped contexts, type-scoped vs property-scoped contexts, framing edge cases, and base-IRI resolution can produce surprising outputs. Mitigation: LION authoring subset for humans, round-trip CI tests for machines, vocabulary catalogue lockdown to prevent drift.
- **Vocabulary updates need coordinated rollout.** When Schema.org or ActivityStreams update, the cached context document needs a new SRI hash. Mitigation: the catalogue is versioned per agentbox release; the default `unknown_context_policy = "fail-closed"` blocks reads against unknown contexts but does not block writes (writes use the cached version).
- **Some surfaces are emit-only initially.** S3, S4, S5, S6, S7, S9, S10, S11 do not consume external JSON-LD in Phase 1–3. Read paths on those surfaces are a follow-up. Mitigation: S1, S2, S8 are bidirectional from Phase 2/3 onward, covering the surfaces where bidirectional flow matters most.

### Risk that was considered and rejected

**Risk: lock-in to JSON-LD specifically (vs. RDF/Turtle, CBOR-LD, YAML-LD).** Considered. RDF/Turtle is harder for JavaScript-native consumers (the agentbox management-api is JavaScript). CBOR-LD is an emerging draft, not deployed. YAML-LD is a CG report. JSON-LD has the deployed implementation density and the ecosystem (VC, DID, Solid, ActivityStreams) already standardised on it. If a future surface needs CBOR-LD, the encoder middleware can be extended without changing this ADR.

**Risk: Gregg Kellogg's death (2025-09-06) leaves JSON-LD without a primary editor.** Pierre-Antoine Champin and Dave Longley remain active editors; the W3C JSON-LD Working Group has an active charter; the specification is at Recommendation status with errata being maintained. The risk is real but bounded — JSON-LD is broadly deployed enough that a stewardship gap would be filled.

## Implementation notes

### Manifest validation

Validation rules E040–E049 are added to `scripts/validate-config.js` (the `agentbox config validate` core). Each rule has an error code, a stderr regex, and a contract test under `tests/contract/linked-data/`. The rules are listed in [PRD-006 §4.1](../prd/PRD-006-linked-data-interfaces.md#41-validation-rules-enforced-by-agentbox-config-validate).

### Code organisation

```
management-api/middleware/linked-data/
├── encoder.js                    # main entry; wraps adapter dispatch
├── context-resolver.js           # loads /opt/agentbox/contexts/ catalogue
├── lion-linter.js                # used by `agentbox lint linked-data`
├── round-trip.js                 # CI helper for §6 conformance
├── jcs.js                        # JCS canonicalisation (RFC 8785)
└── surfaces/
    ├── s01-pods.js
    ├── s02-nostr.js
    ├── s03-credentials.js
    ├── s04-did.js
    ├── s05-provenance.js
    ├── s06-wot.js
    ├── s07-skill.js
    ├── s08-payments.js
    ├── s09-dcat.js
    ├── s10-arch-docs.js
    └── s11-http-meta.js
```

Each surface module exports `encode(payload, context)`, `decode(jsonld, context)` (where applicable), and `roundTripTest(fixture)`.

### Dependency choice

JavaScript: [`jsonld.js`](https://github.com/digitalbazaar/jsonld.js) v8 (BSD-3-Clause), the reference implementation maintained by Digital Bazaar (the same shop that produces the W3C VC reference implementation). Bundled via `buildNpmPackage` in `flake.nix`, pinned via `flake.lock`, with `nodeModulesHash` per the FOD pattern.

Rust: [`json-ld`](https://crates.io/crates/json-ld) v0.21 (Apache-2.0), used inside `solid-pod-rs` for content negotiation. No new Rust dependency; the same crate handles S1 + S4 server-side.

### Test surface

[PRD-006 §10](../prd/PRD-006-linked-data-interfaces.md#10-test-surface) lists the contract tests. Each surface gets:

- A round-trip test against the surface's published context (§6).
- A W3C test-suite slice (§8).
- A privacy-filter handoff ordering test (§7).
- A LION linter test (where authoring is allowed).

Per ADR-005's contract-test discipline, every surface test runs against all three implementation classes of its prerequisite adapter, confirming behavioural equivalence.

### Documentation

- [`docs/user/linked-data.md`](../../user/linked-data.md) — operator one-pager (added under PRD-006 Phase 1).
- [`docs/developer/linked-data.md`](../../developer/linked-data.md) — implementer reference (added under Phase 1).
- [`docs/reference/_vocab/agbx.md`](../_vocab/agbx.md) — `agbx:` term registry with rationale per term (added under Phase 1).

## Acknowledgements

ADR-012 stands on the shoulders of the W3C JSON-LD Working Group and the broader Linked Data community. Specific attributions:

- **JSON-LD 1.1** — [W3C Recommendation 2020-07-16](https://www.w3.org/TR/json-ld11/), edited by Gregg Kellogg, Pierre-Antoine Champin, Dave Longley; v1.0 authored by Manu Sporny, Markus Lanthaler, Niklas Lindström.
- **In memoriam: Gregg Kellogg** (d. 2025-09-06). The W3C spec carries his memorial; agentbox carries his work.
- **Linked Object Notation (LION)** — [linkedobjects.github.io](https://linkedobjects.github.io/), Melvin Carvalho et al., MIT-licensed. The §3 authoring rules are paraphrased from this source with attribution.
- **W3C Verifiable Credentials 2.0** — Sporny, Longley, Sabadello, Steele, Allen.
- **W3C DID Core 1.0** — Reed, Sporny, Longley, Allen, Grant, Sabadello.
- **Solid Protocol 0.11** — Capadisli, Berners-Lee, Verborgh, Kjernsmo, Bingham, Zagidulin.
- **`jsonld.js`** — Dave Longley, Manu Sporny (Digital Bazaar), BSD-3-Clause.
- **`json-ld` Rust crate** — Timothée Haudebourg, Apache-2.0.
- **JCS (RFC 8785)** — Anders Rundgren, Bret Jordan, Samuel Erdtman.

The full bibliography lives in [PRD-006 §14](../prd/PRD-006-linked-data-interfaces.md#14-acknowledgements-and-attribution).
