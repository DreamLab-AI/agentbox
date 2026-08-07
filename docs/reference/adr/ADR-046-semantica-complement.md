---
id: ADR-046
title: Semantica as a complement to VisionClaw (not a replacement)
status: proposed
date: 2026-08-07
type: integration
author: Dr John O'Hare
depends_on: [ADR-023, ADR-112, ADR-005, ADR-013]
review_trigger: VisionClaw restored to service, or semantica major release changing its reasoner surface
---

# ADR-046 — Semantica as a complement to VisionClaw (not a replacement)

> **Origin:** decided from the Opus investigation mesh `wf_854d1254`
> (substrate-vs-prime-semantica), which audited our own substrate against
> prime-agent and semantica (`github.com/semantica-agi/semantica`). The decision
> is recorded in RuVector `project-state/prime-agent-semantica-integration-decision`.
>
> **Operationalised (2026-08-07) by:** [PRD-022](../prd/PRD-022-semantic-integrity-provenance-decisions.md)
> (the five workstreams that build the four capabilities), [ADR-047](./ADR-047-semantica-tenant-integration-boundary.md)
> (resolves the integration boundary in favour of native, capability-first
> implementation),
> [ADR-048](./ADR-048-decision-records-as-graph-nodes.md) (decisions-as-nodes),
> [ADR-049](./ADR-049-bitemporal-facts-and-runtime-provenance.md) (bi-temporal + runtime
> PROV-O), and [DDD-020](../ddd/DDD-020-semantic-integrity-provenance-domain.md) (BC23,
> the Semantic Integrity & Provenance domain). This ADR remains the seed *complement,
> not replace* decision; the boundary question it left to the operator is now closed by ADR-047.

## Context

`semantica` is an MIT-licensed, Python, graph-native "infrastructure beneath the
LLM" — an end-to-end pipeline (ingest → extract → conflict-detect → dedup → KG →
ontology/reasoning/provenance/decisions → polyglot store). It is startlingly
proximal to VisionClaw's semantic half. Its public backend matrix lists
Blazegraph, Jena and RDF4J, not Oxigraph; its storage and runtime are therefore
neither a superset of ours nor a premise of this decision. It ships, as
first-class modules, four interaction patterns VisionClaw lacks at
the agent-write/runtime layer:

1. **W3C PROV-O provenance on every triple** (we hang `prov:wasAttributedTo` /
   `prov:generatedAtTime` off corpus IRIs, but only in the markdown corpus, not
   on runtime agent writes).
2. **Bi-temporal facts** — valid-time vs recorded-time, `state_at()` point-in-time
   snapshots, Allen interval algebra.
3. **Decisions-as-graph-nodes** — `record_decision()` with causal
   CAUSED/INFLUENCED/PRECEDENT_FOR edges, `trace_decision_chain()`, policy gates.
4. **ConflictDetector + EntityMerger** — value/type/temporal/logical conflict
   detection and entity resolution *before* merge.

The decisive divergence: **semantica has no OWL DL/EL reasoner.** Its "reasoning"
is Rete / Datalog / SPARQL / SHACL — it *generates and validates* OWL but never
*classifies* it. VisionClaw's whole point is **Whelk-rs** (OWL 2 EL++) doing
materialised subsumption over our class hierarchy (ADR-023). Swapping the stack to
semantica would downgrade the reasoning core.

## Decision

**Complement, do not replace.** Keep Whelk EL classification and VisionClaw's
single-writer HTTP boundary. Implement the four capabilities natively in our
domain model and graph. Semantica is comparative prior art for capability and
interaction design, not a runtime dependency, canonical schema, storage layer,
or API contract.

We adopt disciplines/patterns, not a wholesale dependency. Priority order, by
value-over-cost, is set by the failure modes a multi-agent mesh actually hits:

| # | Capability | Why | Gating |
|---|---|---|---|
| 1 | **ConflictDetector / EntityMerger** | protects graph integrity during concurrent agent writes — our real, observed failure mode (duplicate merges, dangling refs) | **none — shipped natively** |
| 2 | Decisions-as-graph-nodes | auditable agent decision trail, a natural extension of ACSP governed writes | VisionClaw up |
| 3 | Bi-temporal `state_at()` | "what did we believe on date X" over a living corpus | VisionClaw up |
| 4 | PROV-O on runtime triples | extend corpus-only provenance to agent writes | VisionClaw up |

### Shipped now (unblocked)

Capability 1 is delivered **natively, with no VisionClaw or semantica dependency**,
as `pipeline/conflicts.py` in `jjohare/logseq` (the ConflictDetector pattern over
our own corpus): `DUPLICATE_CONCEPT`, `SUBCLASS_CYCLE`, `RELATION_CONTRADICTION`,
`TYPE_CONFLICT`, exit-coded to compose with `pipeline.gate` as a pre-merge guard.
Its first live run found real defects: **2 subclass cycles** and **57
subClassOf/contrasts_with contradictions** the structural validator does not catch.

## Integration boundary

Semantica is Python; the VisionClaw core is Rust/Oxigraph. Two approaches were
considered for capabilities 2–4:

- **(A) Co-located Python tenant** — rejected. It imports an unproven backend and
  reasoner seam, conflicts with ADR-023's HTTP single-writer boundary, and lets a
  reference implementation dictate our operational architecture.
- **(B) Native Rust reimplementation** — port the 3–4 patterns into the VisionClaw
  core. No second runtime; tighter integration. Cost: significant engineering, and
  we forgo semantica's maintained implementations.

**Decision: (B), implemented capability-first.** Port only the behaviours and
interaction contracts proven useful by acceptance tests. Do not mirror
Semantica's internal classes or persistence shapes. Small disposable comparison
spikes may run outside production to validate semantics, but they create no
runtime dependency and have no write credentials.

## Consequences

- Whelk EL classification stays the inference core; no reasoning downgrade.
- Pre-merge integrity is available immediately (`pipeline/conflicts.py`), decoupled
  from VisionClaw's availability — the highest-value capability lands first.
- Our DID/Nostr hierarchical ownership + ACSP governance remain the
  differentiators; external examples inform behaviour but do not replace them.
- Sequencing depends on ADR-023's VisionClaw restoration and the 8,152-vs-~5,975
  corpus/store drift being resolved (load `ontology-output.ttl` into
  `urn:ngm:graph:ontology:assert`) before capabilities 2–4 are actionable.
