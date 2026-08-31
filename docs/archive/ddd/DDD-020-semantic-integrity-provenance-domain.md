# DDD-020: Semantic Integrity & Provenance Domain

**Date**: 2026-08-07
**Status**: Proposed
**Bounded Context**: Semantic Integrity & Provenance — governed, provenanced, temporal writes to the shared graph (**BC23**)
**Cross-references**: [PRD-022](../prd/PRD-022-semantic-integrity-provenance-decisions.md) (product requirements — the five workstreams this domain models), [ADR-046](../adr/ADR-046-semantica-complement.md) (complement-not-replace — the seed decision), [ADR-047](../adr/ADR-047-semantica-tenant-integration-boundary.md) (the tenant ACL this domain's write port dispatches through), [ADR-048](../adr/ADR-048-decision-records-as-graph-nodes.md) (`DecisionRecord` aggregate), [ADR-049](../adr/ADR-049-bitemporal-facts-and-runtime-provenance.md) (`BiTemporalFact` + `ProvenanceStamp` value objects), [ADR-023](../adr/ADR-023-ontology-bridge.md) (VisionClaw ontology bridge — BC20/BC21, the store + reasoner this domain writes against), [DDD-008](./DDD-008-ontology-bridge-domain.md) (Ontology Bridge — BC21, the **read** context this domain extends to governed **writes**), [DDD-012](./DDD-012-sovereign-knowledge-elevation-domain.md) (Sovereign Knowledge Elevation — BC22, the `urn:agentbox:activity` PROV-O spine this domain's provenance rides), [DDD-003](./DDD-003-sovereign-messaging-domain.md) (nostr crypto + signing — consumed for attribution, not owned), [DDD-016](./DDD-016-memory-learning-domain.md) (RuVector namespaces — `decisions` similarity search), [ADR-005](../adr/ADR-005-pluggable-adapter-architecture.md) (adapter + three-layer middleware), [ADR-008](../adr/ADR-008-privacy-filter-routing.md) (fail-closed provenance write path), [ADR-012](../adr/ADR-012-jsonld-federation-grammar.md) (JSON-LD PROV-O encoding), [ADR-013](../adr/ADR-013-canonical-uri-grammar.md) (URN grammar, `uris.js` minting, the `decision` kind), [ADR-033](../adr/ADR-033-did-nostr-multikey-convergence.md) (DID/Nostr signing keys).

---

## TL;DR for newcomers

*Skip if you already know that this bounded context makes runtime graph writes
safe, attributed, temporal and auditable through native capability contracts,
while Whelk remains the reasoning core.*

This DDD captures the **Semantic Integrity & Provenance** bounded context (BC23):
what happens between a signed proposal and an atomic merge into the shared graph.
It closes four gaps: integrity conflicts, missing runtime provenance, absent
temporal history and unqueryable decisions. Semantica is prior art for these
capabilities; the domain implements them natively through VisionClaw's governed
HTTP boundary and owns its own vocabulary and interaction contracts. The
aggregate root is `GovernedAssertion`; the domain does not own the store,
reasoner or ACSP governance verdict.

**If you remember only one thing:** a `GovernedAssertion` is a signed proposal
whose conflict, consistency and governance results commit atomically with its
provenance, validity and decision record. Whelk classifies a clean asserted
graph; append-only history stays in the provenance graph.

For the deep version, keep reading.

---

## Domain Purpose

The truth this domain owns is the **integrity, attribution, and temporality of every runtime write to the shared ontology graph**: whether a proposed change is conflict-free, who is cryptographically accountable for it, when it is (and was) true, and what decision produced it. "Write" means a governed assertion arriving through the ACSP propose path (`/api/ontology-agent/propose`) — not a corpus batch import (that is the markdown pipeline, already provenanced) and not a read (that is BC21, DDD-008).

Three things make this a domain rather than a validation function. First, **integrity**: a write is not merged because it is EL-consistent — consistency is not integrity (a subclass cycle is often still satisfiable), so a write passes a distinct conflict/entity-resolution gate before it reaches Whelk. Second, **accountability**: a merged triple is not anonymous — it is reachable from a `prov:Activity` `prov:wasAttributedTo` a signed `did:nostr`, so accountability is cryptographic sovereignty, not merely lineage. Third, **temporality**: a fact is not present-tense-only — it carries a valid-time interval distinct from its recorded-time, held off the reasoned graph, so "what did we believe on date X" is a graph query.

Nothing in this domain owns Whelk classification, the Oxigraph store internals, the ACSP governance *decision* (it consumes the verdict), nostr signing (DDD-003), or the corpus markdown pipeline. It owns the guard, the stamp, the temporal annotation, and the decision record — the binding, not the parts it binds.

---

## Bounded Context Definition

**Boundary**: The governed-write surface to the shared graph — the conflict gate, the provenance/temporal stamp, the decision record, and the tenant ACL — all inside the container, all over the *single* Oxigraph store.

**Owns** (IN):

- The `GovernedAssertion` aggregate — a proposed triple set that has passed the gate, been stamped, temporally annotated, and governed in.
- The `ConflictReport` — the typed output of the pre-merge gate (`DUPLICATE_CONCEPT`, `SUBCLASS_CYCLE`, `RELATION_CONTRADICTION`, `TYPE_CONFLICT`), exit-coded to compose with `pipeline.gate`.
- The `DecisionRecord` aggregate (ADR-048) — the first-class, `did:nostr`-signed, Whelk-classifiable decision node, `IS-A prov:Activity`, with `dl:caused`/`dl:precedentFor`/`dl:influenced` causal edges.
- `ProvenanceStamp` (value object) — `{ did:nostr, activityUrn, generatedAtTime }`, the runtime PROV-O attribution.
- `BiTemporalFact` / `ValidityInterval` (value objects) — the RDF-star valid-time/recorded-time annotation held in the provenance named graph.
- The `SemanticaTenant` ACL — the anti-corruption adapter binding semantica's Python modules to our store, identity, governance, and middleware (ADR-047).
- The named-graph separation contract — asserted graph (Whelk-classified) vs `urn:agentbox:graph:provenance` (not classified).

**Does not own** (OUT):

- **Whelk classification and Oxigraph internals** (BC20, VisionClaw / ADR-023). This domain uses the governed HTTP boundary and never re-implements inference or accesses the store directly.
- **The ontology *read* surface** (BC21, DDD-008 / PRD-011). This domain extends the bridge from read to governed write; it does not own the read port.
- **The ACSP governance decision.** This domain enforces the conflict gate and stamps provenance; the accept/reject *verdict* on a proposal is ACSP's, consumed here as a precondition to merge.
- **Nostr cryptography and signing** (DDD-003). Hands unsigned payloads over for signing; consumes the signed attribution.
- **The `urn:agentbox:activity` PROV-O Activity spine** (BC22, DDD-012 / PRD-014). Reuses it as the generating-activity for W-D stamps; does not own the embodied-loop that mints activities.
- **semantica `src/`** (ADR-047 rule 6). Adopted generic subdomain; conformed to as a published language, never patched.
- **The corpus markdown pipeline** (`jjohare/logseq`). `pipeline/conflicts.py` is the *native port* of the same detector pattern; this domain owns the *runtime* guard, the corpus owns the *batch* guard, sharing the pattern not the code.

---

## Ubiquitous Language

| Term | Definition |
|---|---|
| **GovernedAssertion** | The aggregate root: a proposed triple set that has (1) passed the `ConflictReport` gate, (2) received a `ProvenanceStamp`, (3) had its `ValidityInterval` recorded off the reasoned graph, and (4) been governed in by ACSP. No triple reaches `urn:ngm:graph:ontology:assert` except as a merged `GovernedAssertion` (I01). |
| **ConflictReport** | The typed result of the pre-merge gate over a proposal: zero or more of `DUPLICATE_CONCEPT` (→ `EntityMerger`), `SUBCLASS_CYCLE` (hard-fail), `RELATION_CONTRADICTION` (fail-closed, ACSP override required), `TYPE_CONFLICT` (hard-fail). Exit-coded to compose with `pipeline.gate`. First live run found 2 cycles + 57 contradictions (PRD-022 §1.1). |
| **EntityMerger** | The resolution path for `DUPLICATE_CONCEPT`: blocking + semantic-similarity clustering to fold a duplicate into the canonical node rather than inserting a second one. The one "fail-into-merge" branch; all other conflict classes fail closed. |
| **DecisionRecord** | First-class decision activity (ADR-048), associated with a signed `did:nostr`. Direct causal/precedent edges are asserted; bounded reachability is query-derived with supporting paths. |
| **ProvenanceStamp** | Value object `{ did:nostr, activityUrn, generatedAtTime, bip340Sig }` attached to each asserted triple via RDF-star in the provenance graph (ADR-049 W-D). The `bip340Sig` is a signature by the acting principal over the canonicalised `(s,p,o,activity,t)` tuple — attribution is *signed*, not a settable label. A triple with a missing or invalid stamp/signature is rejected, not merged (I02, fail-closed). |
| **BiTemporalFact** | An asserted triple carrying two time axes: `dl:validFrom`/`dl:validTo` (valid-time, world) and `prov:generatedAtTime` (recorded-time). Reified in the provenance graph; the asserted graph is the `state_at(now)` valid-time projection (ADR-049 W-C). |
| **ValidityInterval** | Value object `[validFrom, validTo)` on a `BiTemporalFact`. A retraction sets `validTo`; it never deletes history. `state_at(t)` returns the triples whose interval contains `t`; Allen algebra relates intervals. |
| **CapabilityContract** | Implementation-neutral request/result contract for conflict preview, temporal projection, provenance and decision traversal. Semantica shapes are non-normative fixtures only. |
| **Asserted graph** | `urn:ngm:graph:ontology:assert` — the clean, present-tense, valid-time projection Whelk classifies. Holds **no** temporal or provenance metadata (I03). |
| **Provenance graph** | `urn:agentbox:graph:provenance` — the RDF-star named graph holding all `ValidityInterval` + `ProvenanceStamp` annotations. Whelk does **not** classify it (I03). |
| **dl:** | The decision-layer vocabulary (`dl:DecisionRecord`, `dl:caused`, `dl:precedentFor`, `dl:validFrom`, …) — OWL terms added so decisions and temporality are *classifiable*, not just stored. |

---

## Aggregates and invariants

**Aggregate root: `GovernedAssertion`.** Consistency boundary = one proposal's triple set + its gate result + stamp + validity + governance verdict. `DecisionRecord` is a second aggregate (independently addressable, its own lifecycle), referenced from a `GovernedAssertion` via `dl:governedBy`/`dl:caused`.

Invariants (domain law):

- **I01 — Single write door.** No triple enters the asserted graph except as a merged `GovernedAssertion` through the ACSP propose path. Raw SPARQL UPDATE into the asserted graph is prohibited.
- **I02 — No unattributed triple.** Every asserted runtime triple is reachable from a signed native provenance envelope. A write whose stamp cannot be produced, privacy-checked or signature-verified is rejected (fail-closed, ADR-008).
- **I03 — Reasoned graph stays clean.** Temporal and provenance *metadata* live **only** in `urn:agentbox:graph:provenance`; Whelk classifies **only** the asserted graph. Classification soundness and the `./agentbox.sh ruvector recall` band are preserved by this separation (PRD-022 G6). Note the boundary is *metadata*, not *decisions*: a `DecisionRecord`'s **causal edges** (`dl:caused`/`dl:precedentFor`) are ontology structure and live in the asserted graph so Whelk classifies the closure; only the decision's PROV-O *attribution* is reified into the provenance graph (ADR-048 §Graph placement). No non-EL axiom enters the classified graph (ADR-047 §3a EL-profile guard).
- **I04 — Cryptographic attribution.** Every `DecisionRecord` and every `ProvenanceStamp` attributes to a signed `did:nostr`, not an opaque actor string; child+parent signing keys are both attributable down a spawn tree.
- **I05 — Whelk is the sole inference core.** No external reasoner is introduced; unsupported reachability is explicitly query-derived.
- **I06 — Middleware on every write.** Every governed write dispatches observability → privacy filter → JSON-LD encoder (ADR-005/008/012), in that order.
- **I07 — Consistency ≠ integrity.** A proposal passes the conflict gate (integrity) *and* Whelk consistency *and* ACSP governance — three distinct checks, none substituting for another. EL-satisfiability alone never authorises a merge.
- **I08 — External shapes are non-normative.** Comparative implementations may inform fixtures but never define the production schema or process topology.
- **I09 — One store, one HTTP write door.** No sidecar or client receives direct Oxigraph update credentials; every mutation crosses VisionClaw's authenticated governed API (ADR-023).
- **I10 — The single write door is locked.** The propose route that is the single write door (I01) must be authenticated and signature-verified *before* any conflict gate or tenant is wired to it. An integrity gate on an unauthenticated route guards a door with no lock, admitting forged/flooded governed writes (PRD-022 §5 step 0).

---

## Context map

| Relationship | Neighbour | Pattern |
|---|---|---|
| **Conformist / behind-ACL** | `SemanticaTenant` (semantica) | Adopted generic subdomain; we conform to its Python API, ACL owns identity/governance/middleware (ADR-047). |
| **Customer–Supplier (downstream)** | BC20 VisionClaw (Whelk + Oxigraph, ADR-023) | We are the customer: we write against the store and register Whelk behind the tenant reasoner. Supplier owns inference + store. |
| **Extends (read→write)** | BC21 Ontology Bridge (DDD-008) | BC21 owns the *read* surface; BC23 extends the same bridge to a *governed write* surface. Shared URN namespaces, distinct direction. |
| **Reuses spine** | BC22 Sovereign Knowledge Elevation (DDD-012) | Reuses `urn:agentbox:activity` PROV-O Activities as W-D generating-activities; does not own the elevation loop. |
| **Consumes signing** | DDD-003 Sovereign Messaging | Hands unsigned payloads for `did:nostr` signing; consumes signed attribution. |
| **Consumes similarity** | DDD-016 Memory-Learning | `find_similar_decisions` searches the RuVector `decisions` namespace; precedent *reasoning* stays in Whelk. |

---

## Migration / sequencing

This domain is **partly live and largely gated** (PRD-022 §5). The pre-merge conflict pattern exists natively today (`pipeline/conflicts.py`, batch/corpus) — the runtime `GovernedAssertion` guard, the tenant, and the temporal/decision aggregates are **VisionClaw-gated**: they cannot exist until `visionclaw-server:4000` is restored, `ontology-output.ttl` is loaded to kill the 8,152-vs-~5,975 drift, and the Whelk consistency-check is re-enabled in the propose path. Landing order once unblocked: `SemanticaTenant` standup (W-E) → `ProvenanceStamp` (W-D) → `BiTemporalFact` (W-C, shared mechanism) → `DecisionRecord` (W-B, consumes attribution). The domain adds one URN kind (`decision`), one named graph (`urn:agentbox:graph:provenance`), and one manifest gate (`[semantica_tenant]`, apply-class `rebuild`) — no new adapter slot, no new store, no new port.
