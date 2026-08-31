---
id: ADR-048
title: Decision records as first-class, Whelk-classifiable graph nodes
status: proposed
date: 2026-08-07
type: data-model
adr_category: architecture
author: Dr John O'Hare
depends_on: [ADR-046, ADR-047, ADR-049, ADR-013, ADR-023, ADR-033]
prd: PRD-022
domain: DDD-020
review_trigger: decision-record volume outgrows Oxigraph query latency, or a governance change alters the ACSP proposal shape
---

# ADR-048 — Decision records as first-class, Whelk-classifiable graph nodes

> PRD-022 W-B. Semantica's signature pattern is *decisions-as-nodes* (`record_decision`,
> causal edges, precedent search, impact analysis, policy gates). We adopt the pattern
> and add sovereign, **`did:nostr`-signed** attribution while keeping direct
> evidence distinct from query-derived reachability.

## Context

When an agent proposes a graph change and ACSP governs it in, the *decision* is today unrecoverable as data — it lives in a commit message or a RuVector row, not as a node. You cannot trace the causal ancestry of a bad merge, surface precedent for a new proposal, or compute the blast radius of retracting a decision. The EU AI Act high-risk obligations (binding 2026-08-02) make this a compliance gap, not only an operational one.

Semantica models decisions as first-class graph nodes with `record_decision()` → `add_causal_relationship()` → `find_similar_decisions()` → `trace_decision_chain()` → `analyze_decision_impact()` → `check_decision_rules()`, exported as W3C PROV-O. Its causal edges are plain triples; its "reasoning" over them is Rete/Datalog — so a precedent *closure* is computed procedurally, never *classified*. VisionClaw has Whelk (OWL 2 EL++). If the causal edges are OWL object properties, Whelk *materialises* the closure as part of classification.

## Decision

**Model a `DecisionRecord` as a first-class node in Oxigraph, `rdf:type
prov:Activity, dl:DecisionRecord`, addressed by a new `decision` URN kind. Store
only direct causal/precedent claims as asserted edges; compute reachability at
query time and label it derived. Every DecisionRecord activity is
`prov:wasAssociatedWith` the acting `did:nostr` and signed.**

### URN kind (ADR-013)

Add one canonical kind: `decision`. Grammar `urn:agentbox:decision:<scope>:<sha256-12>` (scope = 64-char hex pubkey of the deciding principal; local = content hash of the decision payload). Minted **only** through `management-api/lib/uris.js` — ad-hoc `format!()`/template-literal decision URNs are prohibited (ADR-013 discipline). Resolvable best-effort via `/v1/uri/<urn>`.

**Why a new kind, not reuse of `activity` (the alternative).** A `DecisionRecord` `IS-A prov:Activity`, so it *inherits* W-D's runtime-provenance plumbing (ADR-049) — attribution, timestamp, generating-activity — without duplicating it. But a decision is independently addressable, searchable, and precedent-linked in a way a bare activity is not; collapsing it into `activity` would lose the first-class query surface (G4) and overload one kind with two lifecycles. One kind added, justified; the `IS-A prov:Activity` typing gives us the plumbing reuse the "reuse `activity`" alternative was reaching for, without the overload.

### Ontology terms (`dl:` = the decision-layer vocabulary)

| Term | OWL character | Purpose |
|---|---|---|
| `dl:DecisionRecord` | `owl:Class` ⊑ `prov:Activity` | the decision node |
| `dl:caused` | `owl:ObjectProperty` | direct decision → decision causation claim |
| `dl:influenced` | `owl:ObjectProperty` | weaker-than-caused influence link |
| `dl:precedentFor` | `owl:ObjectProperty` | direct, evidenced precedent claim |
| `dl:consideredInput` | `owl:ObjectProperty` | decision → the fact/source it weighed |
| `dl:governedBy` | `owl:ObjectProperty` | decision → the ACSP policy/shape that gated it |

Neither relation is declared transitive. Causation is not generally transitive,
and precedent inheritance is contextual; materialising either closure would turn
derived reachability into asserted truth and inflate the graph. Whelk classifies
the decision vocabulary and genuinely ontological axioms. MCP traversal computes
bounded paths and returns the supporting direct links.

> **EL profile note.** Passing the lightweight vocabulary regression test is not
> proof of OWL 2 EL conformance. Before merge, the complete imported ontology
> must pass a standards-based profile checker and an executed Whelk capability
> test. The local test only blocks known regressions.

### Graph placement — decisions are classified, their provenance is not (resolves the ADR-049 I03 boundary)

A `DecisionRecord` spans **two** graphs, and the split is exact, so it does not violate DDD-020 I03 (which quarantines *provenance metadata* from the classified graph):

| Triple family | Graph | Whelk classifies? |
|---|---|---|
| `dl:DecisionRecord` class membership + direct causal/precedent/influence/input/governance edges | `urn:ngm:graph:ontology:assert` (asserted) | **Yes** — direct graph only; reachability is query-derived |
| `prov:wasAssociatedWith <did:nostr>`, activity times, generated-entity attribution and the BIP-340 signature envelope | `urn:agentbox:graph:provenance` (portable reification, ADR-049 W-D) | **No** |

So the *causal structure* is classified (the whole point), while the *attribution* is reified off-graph like every other runtime write (ADR-049 I03). `trace_decision_chain()` returns the reasoned URN closure from the asserted graph; a caller wanting the signed attribution of each node does one join into the provenance graph — an explicit, documented second query, never an implicit hot-path join on the closure itself. The MCP tool contracts below specify which graph each call reads.

### MCP surface (added to the substrate-tools / ontology-bridge server)

- `record_decision(summary, inputs[], rationale, proposal_urn) → decision_urn` — mints the URN, stamps PROV-O (ADR-049 W-D), signs with the session `did:nostr`, writes through the ADR-005 middleware.
- `trace_decision_chain(decision_urn, max_depth) → [{decision_urn, depth, path}]` — bounded ancestry over direct `dl:caused`/`dl:precedentFor` links.
- `analyze_decision_impact(decision_urn) → {downstream, assertions}` — the transitive downstream set (blast radius for retraction).
- `find_similar_decisions(summary) → [decision_urn]` — RuVector semantic search over decision summaries (`mcp__claude-flow__memory_search`, namespace `decisions`), *not* an ontology query — precedent discovery is similarity, precedent *reasoning* is Whelk.
- `check_decision_rules(proposal) → {ok, violations}` — SHACL shape validation + Whelk consistency as the policy gate; composes with the W-A conflict gate.

### Attribution and signing (the semantica gap we close)

Every `DecisionRecord` activity carries `prov:wasAssociatedWith <did:nostr>` and
is signed with the deciding principal's BIP-340 key (ADR-033). Generated record
entities use `prov:wasAttributedTo`. This follows PROV-O's activity/entity domains
while adding cryptographic accountability.

## Alternatives considered

- **Reuse the `activity` kind** — rejected (loses first-class addressability/search; overloads one kind with two lifecycles). The `IS-A prov:Activity` typing captures the plumbing-reuse benefit without the cost.
- **Decision store in beads/events adapters, not Oxigraph** — partially adopted. The *canonical, Whelk-classifiable* record lives in Oxigraph (so precedent/impact are reasoned); a beads cross-reference (`urn:agentbox:bead` ↔ `urn:agentbox:decision`) gives the work-ledger view (PRD-022 Q2). Storing *only* in beads would forgo classification.
- **Materialised transitive causal closure** — rejected; causation is not
  generally transitive and closure would erase the distinction between evidence
  and derived reachability.

## Consequences

- Agent decisions become queryable, causally linked, precedent-searchable, `did:nostr`-signed nodes — closing PRD-022 §1.4 and G4, and the EU AI Act "why did the agent do that?" gap.
- One URN kind is added (19th), minted via `uris.js`, `IS-A prov:Activity` for plumbing reuse.
- Decision-chain tracing is bounded and evidence-bearing; direct assertions stay
  distinguishable from query-derived reachability.
- VisionClaw-gated (needs the reasoned store up); ships in PRD-022 W-B after W-D (attribution) and the §5 sequence.
