# Linked-Data middleware — developer reference

Implementer-facing notes for the Linked-Data Interchange domain. Pairs with [PRD-006](../reference/prd/PRD-006-linked-data-interfaces.md), [ADR-012](../reference/adr/ADR-012-jsonld-federation-grammar.md), and [DDD-004](../reference/ddd/DDD-004-linked-data-interchange-domain.md).

## Code layout

```
management-api/middleware/linked-data/
├── index.js                    # createEncoder / createLinter entry points
├── encoder.js                  # LinkedDataEncoder (DDD-004 §EncodingPipeline)
├── context-resolver.js         # ContextResolver (DDD-004 §ContextCatalogue)
├── lion-linter.js              # LION rule enforcement
├── jcs.js                      # RFC 8785 canonicalisation
├── round-trip.js               # PRD-006 §8.1 conformance helper
└── surfaces/
    ├── s01-pods.js  …  s11-http-meta.js

lib/linked-data-contexts.nix    # build-time-pinned context catalogue
docs/reference/_vocab/
├── agbx.md                     # agbx: term registry
└── agentbox-v1.context.jsonld  # in-tree first-party @context document

tests/contract/linked-data/
├── invariants.spec.js          # L01–L12
├── jcs.spec.js                 # RFC 8785 vectors
└── surfaces.spec.js            # one smoke test per surface
```

## Surface module shape

Every surface module exports the metadata fields the encoder needs and an `encode(payload, ctx)` function. Optional `decode(jsonld)` for bidirectional surfaces.

```js
module.exports = {
  id: 'S5',                            // SurfaceId
  slot: 'events',                      // adapter slot or null for build-time-only
  gateKey: 'provenance',               // [linked_data].<gateKey>
  prerequisiteAdapter: 'adapters.events',
  form: 'compacted',                   // compacted | expanded | flattened | framed
  direction: 'emit',                   // emit | consume | both
  operations: ['emit', 'append'],
  canonicalisation: 'none',            // 'jcs' for S3, S8 only (DDD-004 §L06)
  vocabularyBinding: ['prov:', 'agbx:'],
  contextIri: 'http://www.w3.org/ns/prov-o#',

  async encode(payload, { resolver, manifest, agentDid, operation }) {
    return { document: jsonldDoc, contextIri };
  },

  // Optional — bidirectional surfaces only
  decode(jsonldDoc) { return internalShape; },
};
```

The encoder picks the surface for a given dispatch by matching `slot + operation + enabled gate`. Multiple surfaces may share a slot (e.g. S5 PROV-O is parallel emit alongside the regular `events` JSONL adapter).

## Adding a new surface

1. Create `surfaces/sNN-<name>.js` with the shape above.
2. Pin its `@context` IRI in `lib/linked-data-contexts.nix` (one new entry per vocabulary it uses).
3. Run `./scripts/prefetch-hashes.sh --linked-data`.
4. Add a per-surface gate to the schema under `[linked_data].<gateKey>` (`schema/agentbox.toml.schema.json`).
5. Add a manifest gate to `agentbox.toml`.
6. Add a validation rule to `scripts/agentbox-config-validate.js` (next free `E04x` code).
7. Register the module in `index.js`'s `surfaceModules` array.
8. Add a smoke test to `tests/contract/linked-data/surfaces.spec.js`.
9. Add a fixture to `tests/contract/linked-data/round-trip.spec.js` so CI catches regressions.
10. Update [PRD-006 §3](../reference/prd/PRD-006-linked-data-interfaces.md#3-surface-inventory) and the user doc table.

## Pipeline ordering — fixed in code

Per DDD-004 §L08, the dispatch order is:

```
observability.before()           (ADR-005)
  └─> privacy_filter.redact()    (ADR-008)
      └─> linked_data.encode()   (ADR-012, this layer)
          └─> adapter.<impl>.write()
```

The encoder receives post-redaction bytes and never sees raw user input. The manifest's `[linked_data.privacy_handoff].order` is documentation only — the validator's E048 rejects any other value.

## ContextResolver invariants

- **L01** — Every ContextDocument's SHA-256 is verified at boot when the index declares one. Mismatches abort startup.
- **L02** — No mutation API. The encoder reads the same parsed object reference every time `resolve(iri)` is called.
- **L03** — Bijective IRI → ContextDocument map. Duplicate IRIs in the index abort boot.
- **L09** — `documentLoader()` returns a function compatible with jsonld.js that never reaches the network. Tests monkey-patch `fetch` to throw, run the full encoder suite, and assert no `fetch` calls.

## LION linter

`new LIONLinter({ resolver, surface, baseIRI, inheritedContextIRIs })` enforces five rules. Construct with the same `ContextResolver` the encoder uses; the linter looks up inherited terms through the resolver's catalogue.

The CI gate is `node management-api/middleware/linked-data/lion-linter.js <files…>`. It returns non-zero on any rule violation. Wired into the standard `npm test` jest run via `tests/contract/linked-data/invariants.spec.js`.

## JCS

`canonicalise(value)` returns the RFC 8785 canonical string. Used by surfaces S3 and S8 before signing. NaN, Infinity, undefined, function, symbol, and bigint are rejected. Object keys are sorted by Unicode code-point order.

## `agbx:` vocabulary policy

Adding a new term to the agentbox extension namespace requires:

1. A localname under `https://agentbox.dreamlab-ai.systems/ns/v1#`.
2. A datatype (or `@type: @id` for IRI references).
3. A documented rationale in `docs/reference/_vocab/agbx.md`.
4. A search confirming no upstream W3C / IETF / Schema.org equivalent.
5. A round-trip test in `tests/contract/linked-data/surfaces.spec.js`.

The published context document at `docs/reference/_vocab/agentbox-v1.context.jsonld` ships with the image.

## Test surface

Every surface has at least:

- An invariants test row in `invariants.spec.js`.
- A smoke test in `surfaces.spec.js`.

To run only the linked-data tests:

```sh
cd management-api && npm test -- --testPathPattern='contract/linked-data'
```

W3C JSON-LD 1.1 Test Suite integration is a Phase 1 follow-up — the harness location and runner script will live at `tests/contract/linked-data/w3c-test-suite.spec.js` once the suite has been vendored as a git submodule under `tests/vendor/json-ld-api/`.

## Phase rollout

| Phase | Target | Surfaces wired |
|---|---|---|
| 1 | 2026-05 | mechanism + S7 + S10 |
| 2 | 2026-06 | + S1 + S2 + S4 + S5 |
| 3 | 2026-07 | + S3 + S6 + S8 + S9 + S11 |

The encoder accepts payloads for every surface today; the per-phase gating happens at the manifest level so later surfaces can be flipped on without code changes.
