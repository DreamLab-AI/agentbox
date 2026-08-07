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

## Context

`semantica` is an MIT-licensed, Python, graph-native "infrastructure beneath the
LLM" — an end-to-end pipeline (ingest → extract → conflict-detect → dedup → KG →
ontology/reasoning/provenance/decisions → polyglot store). It is startlingly
proximal to VisionClaw's semantic half: its **default RDF backend is embedded
Oxigraph**, the same store VisionClaw runs, so on storage it is a strict superset
of ours. It ships, as first-class modules, four capabilities VisionClaw lacks at
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

**Complement, do not replace.** Keep Whelk EL classification as the inference
core; adopt the four capabilities above as an agent-facing tenant *over* our
Oxigraph store, registering Whelk *behind* semantica's `SPARQLReasoner` /
`OntologyValidator` so semantica queries our reasoned graph rather than supplying
its own weaker inference.

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

## Integration boundary (open question, with a recommendation)

Semantica is Python; the VisionClaw core is Rust/Oxigraph. Two options for
capabilities 2–4:

- **(A) Co-located Python tenant** — run semantica as a sidecar bound to our
  Oxigraph store, Whelk registered behind its reasoner. Fast to stand up; reuses
  its ProvenanceManager / bi-temporal / decision modules as-is. Cost: a second
  runtime and its dependency surface alongside the Rust engine.
- **(B) Native Rust reimplementation** — port the 3–4 patterns into the VisionClaw
  core. No second runtime; tighter integration. Cost: significant engineering, and
  we forgo semantica's maintained implementations.

**Recommendation: (A) as the near-term path** once VisionClaw is restored — it
lets us validate the four capabilities against real traffic cheaply before
committing to a native port. Revisit (B) only if the Python tenant proves a
latency or operational burden. This is the one decision this ADR leaves to the
operator; everything above is settled.

## Consequences

- Whelk EL classification stays the inference core; no reasoning downgrade.
- Pre-merge integrity is available immediately (`pipeline/conflicts.py`), decoupled
  from VisionClaw's availability — the highest-value capability lands first.
- Our DID/Nostr hierarchical ownership + ACSP governance remain the differentiators
  semantica lacks (its accountability is PROV-O lineage, not cryptographic
  sovereignty); the tenant does not replace them.
- Sequencing depends on ADR-023's VisionClaw restoration and the 8,152-vs-~5,975
  corpus/store drift being resolved (load `ontology-output.ttl` into
  `urn:ngm:graph:ontology:assert`) before capabilities 2–4 are actionable.
