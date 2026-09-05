---
id: ADR-2073
title: Isolate asserted from inferred in the Loom backend so provenance scope is backend-enforced, not requested
date: 2026-09-05
decision_status: proposed
implementation_status: none
activation_status: inactive
supersedes: []
superseded_by: []
verified_commit: e070514d808b218574403377fb75e0e1a0a256b3
verified_paths: []
owner: jjohare
review_trigger: a Loom store change that splits or merges named graphs, any consumer relying on provenance=asserted for a correctness claim, or ADR-2023 moving off partial
repo: agentbox
domain: LEARNING-memory
lineage: ADR-2023 (Loom façade) — its "Remaining" section names this gap and is its ORIGIN, referenced with `see`, superseded by nothing here; GOVERNANCE-capabilities is the interim authority for the harness-side Loom and keeps that role
---

# ADR-2073 — Isolate asserted from inferred in the Loom backend

## Context

Diagram **AB-25.2** (`agentbox/25-ontology-tools-and-governed-writes.md:97`) records that
the Loom expand helper queries one merged graph and does not isolate asserted from
inferred, so `provenance` is a **requested** scope, not a backend-enforced one. The
asymmetry is visible in one file: on the VisionClaw backend
`mcp/servers/lib/ontology-retrieval.js:550-551` selects the named graph from the request
(`urn:ngm:graph:ontology:inferred` vs `:assert`) and every SPARQL query is wrapped in that
`GRAPH` clause (`:564,569`); on the Loom backend the same helper states "Loom store merges
assert+inferred into one graph — no GRAPH clause needed" (`:640`, and `:592-593`) and
issues an unscoped query. A caller asking for `provenance: asserted` receives inferred
triples silently, with the same shape of result and no limitation marker. ADR-2023 names
this in its own Remaining list; it does not close it.

## Decision

**Proposed.** Provenance scope is a property the backend enforces, or it is not offered.
When taken:

1. **The Loom store separates the two classes.** Asserted and inferred triples are held
   in distinct named graphs with the same IRIs the VisionClaw backend already uses
   (`urn:ngm:graph:ontology:assert`, `urn:ngm:graph:ontology:inferred`), so one query
   shape serves both backends and the retrieval helper's two code paths converge.
2. **Every Loom query carries the `GRAPH` clause**, in both the seed (`/loom/search`) and
   the expand (`/loom/sparql`) stages. The seed stage filters to the requested scope
   rather than seeding from the merged store and scoping only on expand — a seed drawn
   from inferred triples contaminates an asserted-scoped result even if expansion is
   correctly scoped.
3. **Until the store is split, the scope is refused, not approximated.** A request for a
   provenance scope the backend cannot enforce returns an explicit limitation in the
   result's existing stage/outcome vocabulary (AB-24.5) — never a silently merged answer.
   Fail-labelled, not fail-open, matching the Loom client's established posture.
4. **The result states which it was.** Every response carries backend name *and* whether
   provenance was backend-enforced or unavailable, alongside the generation identity
   already reported. A consumer can therefore tell an enforced scope from an unenforceable
   one without reading this ADR.
5. **Authority.** `GOVERNANCE-capabilities.md` remains the interim authority for the
   harness-side Loom; this record is filed under `LEARNING-memory` because it changes
   retrieval geometry, and it creates no competing authority over the façade contract.

## Consequences

- `provenance` stops being a parameter that is accepted and ignored — the failure mode
  where a caller's correctness argument rests on a filter that never ran.
- Cost: a Loom-side store change (out of this repo), a helper change here, and cache-key
  implications — a scoped and an unscoped answer to the same question are two entries, so
  the cache-completeness work in ADR-2023/AB-24.4 must account for the new dimension.
- Item 3 is a visible regression for any consumer that today receives a merged answer and
  believes it is asserted-only: those calls begin returning a limitation instead. That is
  the correction, not a side effect.
- Splitting the store may cost recall on queries that legitimately want both; those
  callers request the merged scope explicitly rather than getting it by default.

## Verification

`implementation_status: none`. Verified at `e070514d808b218574403377fb75e0e1a0a256b3`:
`mcp/servers/lib/ontology-retrieval.js:550-551` selects the named graph on the VisionClaw
path; `:592-593` and `:640` state in comments that the Loom store merges assert and
inferred so no `GRAPH` clause is emitted; `/loom/search` (`:627`) and `/loom/sparql`
(`:645`) are the two Loom calls and neither carries a graph scope. ADR-2023's "Remaining"
list records the same fact.

**Acceptance test for the landing change.** With a Loom store holding a class asserted in
the corpus and a distinct class present only as a Whelk inference:

1. `ontology_ask` with `provenance: asserted` against the Loom backend returns the
   asserted class and **not** the inferred one; the same query against the VisionClaw
   backend returns the identical set.
2. `provenance: inferred` returns the inferred class; the merged scope returns both.
3. The seed stage is scoped: a query whose only lexical match is the inferred class
   returns an empty asserted-scoped result, not a result seeded from it.
4. Against a Loom deployment whose store is **not** split, the same call returns an
   explicit limitation in the stage/outcome vocabulary and no triples — it does not return
   a merged answer.
5. Every result names the backend and whether provenance was backend-enforced.
6. Two identical questions differing only in provenance scope produce two cache entries,
   and a cache hit on one never satisfies the other.
