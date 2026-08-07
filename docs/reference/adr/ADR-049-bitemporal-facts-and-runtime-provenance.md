---
id: ADR-049
title: Bi-temporal facts and runtime PROV-O off the reasoned graph
status: proposed
date: 2026-08-07
type: data-model
adr_category: architecture
author: Dr John O'Hare
depends_on: [ADR-046, ADR-047, ADR-023, ADR-013, ADR-008, ADR-012]
prd: PRD-022
domain: DDD-020
review_trigger: RDF 1.2 quoted triples become stable in the pinned Oxigraph build, or projection/classification latency exceeds its accepted budget
---

# ADR-049 — Bi-temporal facts and runtime PROV-O off the reasoned graph

## Context

Runtime assertions need two time axes and provenance that can be joined back to
the asserted triple. This is a capability requirement, not a reason to inherit
Semantica's persistence shape. Temporal and provenance metadata must not bloat
the graph Whelk classifies, and the sprint must not depend on preliminary RDF
1.2 quoted-triple support without a compatibility test.

## Decision

Use a separate `urn:agentbox:graph:provenance` named graph. The portable v1
representation gives each assertion version a stable, content-addressed
`prov:Entity` IRI with `rdf:subject`, `rdf:predicate` and `rdf:object`. That entity
carries `dl:validFrom`, optional `dl:validTo`, `prov:generatedAtTime`,
`prov:wasGeneratedBy` and `prov:wasAttributedTo`. The generating
`prov:Activity` uses `prov:wasAssociatedWith` for the acting `did:nostr` agent.
The signature is part of a versioned native envelope, not a TBox predicate.

| Graph | Contents | Whelk classifies? |
|---|---|---|
| `urn:ngm:graph:ontology:assert` | current plain asserted triples | Yes |
| `urn:agentbox:graph:provenance` | assertion-version entities, intervals, activities, agents and signature-envelope links | No |

### Authority and transaction boundary

The append-only provenance graph is the historical source of truth. The asserted
graph is the current-time projection used by Whelk. A single authenticated,
idempotent VisionClaw transaction appends the assertion version and updates the
current projection. Retraction closes `[validFrom, validTo)` and removes the
current triple without deleting history. A transaction receipt records the
proposal ID, idempotency key, affected graph hashes and signature-envelope hash.

If Oxigraph cannot provide the required atomicity across both named graphs, the
implementation uses a write-ahead intent plus deterministic recovery; it must not
claim atomicity based on client-side sequencing. Failure-injection tests cover
every boundary between intent, provenance append, projection update and receipt.

### Temporal queries

`state_at(t)` selects assertion versions whose half-open interval contains `t`.
Recorded-time queries additionally filter `prov:generatedAtTime`, preserving the
difference between “true in the world” and “known by the system”. Golden tests
cover equal boundary instants, open-ended intervals, late-arriving assertions,
corrections, overlapping claims and clock normalisation to UTC.

Allen relations are query helpers derived from interval endpoints; they are not
materialised as TBox axioms. Historical classification uses an isolated transient
graph and never overwrites the current asserted graph.

### Quoted-triple upgrade path

RDF 1.2 quoted triples may replace portable reification only after a pinned-build
compatibility test proves parse, update, query, export/import and backup/restore
round trips. The public MCP/HTTP contracts expose assertion-version IDs rather
than storage syntax, so the upgrade does not change callers.

## Security and privacy

- The authenticated principal, never a client field, determines the agent.
- The activity is `prov:wasAssociatedWith` the agent; generated assertion
  entities are `prov:wasAttributedTo` that agent and `prov:wasGeneratedBy` the
  activity, following PROV-O domains.
- The native write service verifies the BIP-340 envelope before mutation.
- Privacy filtering is fail-closed and runs before provenance persistence.
- Replay of an idempotency key with a different payload is rejected.

## Alternatives considered

- **RDF-star/quoted triples as the v1 dependency — deferred.** Ergonomic, but the
  pinned runtime capability has not been demonstrated and portability matters.
- **Whole-graph snapshots — rejected as primary storage.** Expensive and poor for
  fact-level provenance; retained only for backup and benchmark fixtures.
- **Events-only provenance — rejected.** It is not directly joinable to facts.
- **Metadata in the asserted graph — rejected.** It pollutes Whelk's input.

## Consequences

- W-C/W-D share one native assertion-version contract without adopting an
  external tenant or data model.
- Correct PROV-O relations and append-only history are explicit acceptance gates.
- Projection recovery and idempotency become required sprint work rather than an
  assumed property of two client-issued updates.
