---
id: ADR-047
title: Native capability boundary for semantic integrity and provenance
status: proposed
date: 2026-08-07
type: integration
adr_category: architecture
author: Dr John O'Hare
depends_on: [ADR-046, ADR-023, ADR-005, ADR-013, ADR-008, ADR-012]
amends: ADR-046
drives: [ADR-048, ADR-049]
prd: PRD-022
domain: DDD-020
review_trigger: a native implementation cannot meet an accepted capability contract, or a maintained external component proves lower total cost in a reproducible spike
---

# ADR-047 — Native capability boundary for semantic integrity and provenance

## Context

ADR-046 selected four useful capabilities observed in Semantica: pre-merge
conflict handling, decision records, bi-temporal facts and runtime provenance.
The first draft of this ADR confused that product inspiration with an
infrastructure decision: it proposed a Python tenant, a shared-store binding and
a Whelk reasoner adapter before any of those seams had been proven.

That coupling is unnecessary and cuts across accepted architecture. ADR-023 D1
makes VisionClaw's HTTP API the stable, single-writer boundary; direct store
access is rejected. Semantica's public RDF backend matrix does not list
Oxigraph, and its data shapes are not part of our ubiquitous language. The value
we want is in the capabilities and the interactions they enable in the graph,
not in copying its classes, process topology or persistence choices.

## Decision

**Implement the selected capabilities natively behind VisionClaw's governed HTTP
write boundary. Treat Semantica as comparative prior art, never as a normative
runtime, schema or API.**

The native boundary has seven rules:

1. **Capability contracts first.** Each workstream begins with black-box examples
   and counter-examples: conflict report, temporal projection, provenance bundle
   and decision-chain traversal. Tests describe behaviour without importing
   Semantica types.
2. **One write door.** All mutation uses the authenticated VisionClaw propose
   API and its conflict → consistency → governance pipeline. No process receives
   direct Oxigraph update access.
3. **Whelk remains the classifier.** New TBox axioms pass a real OWL 2 EL profile
   check and a Whelk capability test. Unsupported entailments use explicit query
   traversal or materialisation code; documentation must not call them
   “Whelk-classified”.
4. **Our graph vocabulary is minimal.** Reuse PROV-O and existing Agentbox URNs;
   add `dl:` terms only where no standard term carries the required semantics.
   Data shapes are versioned as our contract, independently of Semantica.
5. **Native provenance is non-optional.** The write service creates and verifies
   the signature envelope. Optional enrichment may fail open; authentication,
   privacy filtering, attribution and signature verification fail closed.
6. **Temporal history is append-only.** Retraction closes a validity interval;
   it does not erase recorded history. Projection into the asserted graph is an
   explicit transaction with recovery and replay tests.
7. **External code is evidence-gated.** A disposable adapter spike is allowed
   only to compare behaviour or cost. Adopting any dependency requires an ADR
   amendment with a pinned version, licence/SBOM review, measured latency,
   rollback proof and no violation of rules 1–6.

### Interaction architecture

The operator-facing sequence is native and stable regardless of implementation:

1. submit a signed proposal;
2. preview typed conflicts and possible duplicate resolutions;
3. run Whelk consistency and ACSP authorisation;
4. atomically commit the assertion, provenance bundle and decision record;
5. explore causal/precedent links, attribution and temporal projections in the
   graph client.

This is an orchestrator pipeline, not a sidecar mesh. A single proposal ID and
idempotency key span every stage. Failure before commit changes no graph; retry
returns the prior result rather than duplicating facts or decisions.

## Alternatives considered

- **Co-located Semantica tenant over shared Oxigraph — rejected.** Backend and
  reasoner seams are unproven, direct store coupling violates ADR-023, and the
  extra runtime would make Semantica's infrastructure shape architectural.
- **Copy Semantica's data model into Oxigraph — rejected.** It would freeze an
  external implementation's terminology into our domain and complicate future
  evolution without proving user value.
- **Native capability implementation — selected.** It preserves the accepted
  boundary and lets each capability land independently behind tests and gates.

## Acceptance gates

- Contract tests prove idempotent, atomic proposal commits and rollback on every
  injected failure point.
- Security tests prove unauthenticated, replayed, client-attributed and raw-update
  attempts cannot mutate either asserted or provenance graphs.
- Temporal golden tests cover open/closed intervals, corrections, late-arriving
  facts, recorded-time queries and `state_at(t)` boundary instants.
- Provenance tests use correct PROV-O relations: activities
  `prov:wasAssociatedWith` agents; generated entities
  `prov:wasAttributedTo` agents and `prov:wasGeneratedBy` activities.
- Decision traversal tests distinguish asserted direct links from derived reachability;
  causation is not assumed transitive.
- Benchmarks report proposal p50/p95/p99, classification time and projection time
  against a frozen corpus. RuVector recall is required only if retrieval geometry
  changes.

## Consequences

- No Python tenant, supervisor programme, `[semantica_tenant]` manifest gate or
  direct Oxigraph credential is added by this sprint.
- W-B/W-C/W-D become independent native workstreams rather than consumers of W-E.
- Semantica upgrades cannot break production; useful new interactions can still be
  evaluated and ported through capability contracts.
- The choice costs more native implementation effort but removes an unproven
  operational dependency and aligns the plan with the project's own graph model.
