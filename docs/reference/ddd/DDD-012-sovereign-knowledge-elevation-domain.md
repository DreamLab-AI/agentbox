# DDD-012: Sovereign Knowledge Elevation Domain

**Date**: 2026-05-28
**Status**: Proposed
**Bounded Context**: Sovereign Knowledge Elevation (BC22)
**Cross-references**: [PRD-014](../prd/PRD-014-embodied-agent-loop.md) (driving product requirements — the five seams A–E and goals G1–G8), [ADR-026](../adr/ADR-026-cross-substrate-agent-loop-seams.md) (decisions D1–D4; if absent, PRD-014 §4), [DDD-008](./DDD-008-ontology-bridge-domain.md) (BC21 Ontology Bridge — the governed transport this context dispatches through; BC20 VisionClaw is its upstream), [DDD-003](./DDD-003-sovereign-messaging-domain.md) (sovereign messaging — ACSP transport, `did:nostr` identity, I01–I12), [DDD-004](./DDD-004-linked-data-interchange-domain.md) (linked-data interchange — JSON-LD encoding of pod RDF, the privacy→encoder middleware order L08), [ADR-013](../adr/ADR-013-canonical-uri-grammar.md) (URI grammar; every `@id` minted via `uris.js`), [ADR-005](../adr/ADR-005-pluggable-adapter-architecture.md) (adapter dispatch path BC22 wraps), [ADR-017](../adr/ADR-017-multi-tenant-did-nostr-pods.md) (per-user pod keys; mandate model works single-tenant first).

---

## TL;DR for newcomers
*Skip if you already know the sovereign-knowledge-elevation bounded context.*

This DDD captures the bounded context that sits **between** an agentbox agent, the user's Solid pod, and VisionClaw's governed shared ontology. It owns the full lifecycle of taking a triple an agent wrote into a user's *personal* knowledge graph and **elevating** selected concepts into the *shared*, governed OWL 2 EL++ ontology — under delegated authority, with continuous provenance, and with two distinct gates (logical consistency *and* human policy approval) before anything becomes a shared class. PRD-014 calls this the major gap (Seam D): the pieces exist on both sides but nothing reads a pod KG, aligns it, and routes it through the governed propose→Whelk→PR path; the agentbox bridge today POSTs to the ungoverned `/api/ontology/load` backdoor, the pod adapter writes anonymously with no mandate, and the BC20 provenance bridge is paper-only.

**If you remember only one thing:** the pod RDF is the single source of truth for the personal KG; an agent writes it only under a scoped, revocable mandate as its *own* `did:nostr` (never the user's nsec); and a concept becomes shared only after it passes **both** the Whelk consistency gate (correctness) **and** the ACSP policy gate (human approval).

For the deep version, keep reading.

## Bounded Context: Sovereign Knowledge Elevation (BC22)

BC22 is a **write-then-elevate orchestration domain**. Unlike BC21 (a read-heavy query proxy), BC22 *mutates* state on two sovereign stores under delegated authority and drives a multi-step governance pipeline. It operates across two federation boundaries: agentbox↔solid-pod-rs (the pod write) and agentbox↔VisionClaw (the elevation). It owns the mandate, the personal-KG-as-pod-RDF model, the elevation proposal lifecycle, and the provenance bridge — but it owns *neither* endpoint: the pod's bytes-on-disk belong to solid-pod-rs, and the shared ontology and its Whelk reasoner belong to VisionClaw (BC20).

### Upstream Context

**VisionClaw** (BC20) owns:
- The governed shared OWL 2 EL++ ontology (Oxigraph `ontology:assert` / `ontology:inferred` named graphs).
- The Whelk-rs EL++ consistency reasoner.
- The governed elevation pipeline: `ontology_propose` → Whelk → GitHub PR → merge → git versioning (`ontology_mutation_service.rs`, `ontology_agent_handler.rs`).
- Shared-class IRI minting (`vc:onto/<slug>`).
- The XR visualiser that renders agent actors and the `ConceptElevated` animation.

**solid-pod-rs** owns:
- The pod's on-disk LDP resources, the WAC `acl:agent` grant model, the NIP-98 HTTP auth verifier, and the N3/SPARQL PATCH applier.
- The canonical *bytes* of the personal KG. BC22 owns the *meaning* of those bytes as a personal KG; it does not own the storage protocol.

### Downstream Context

**Agentbox agents** (and the voice→actor ingress of Seam A/B) consume BC22 as:
- The authority to write a personal KG (the AgentMandate).
- The path to propose a concept for elevation (the governed `ontology_propose` tool, never `/api/ontology/load`).
- The provenance guarantee that their `urn:agentbox:activity` records survive the federation crossing.

## Ubiquitous language

| Term | Definition |
|---|---|
| **Mandate** | A scoped, revocable, signed grant authorising one agent (`did:nostr:AGENT`) to write a specific pod KG container under WAC `acl:agent`. Minted as `urn:agentbox:mandate:<scope>:<local>`. The agent writes as *itself*, never as the user. |
| **Actor** | The agent identity acting under a mandate. An actor is a `did:nostr` plus a `urn:agentbox:agent` URN; it is the *grantee*, never the *grantor*. |
| **Personal KG** | The user's private knowledge graph. Its **canonical representation is pod RDF** (Turtle/JSON-LD in a pod container). RuVector memory and Logseq markdown are *projections into* the pod RDF, not competing sources of truth. |
| **Elevation candidate** | A concept extracted from personal-KG triples that an agent or human proposes for promotion into the shared ontology. Pre-proposal; not yet governed. |
| **Proposal** | An elevation candidate that has entered the governed lifecycle. Mirrors VisionClaw's `NoteProposal`. Carries a `ProposalStatus`. |
| **Consistency gate** | The Whelk EL++ reasoner check. Answers *"is this logically consistent with the shared ontology?"* — the **correctness** gate. Owned by BC20. |
| **Policy gate** | The ACSP human-in-the-loop approval. Answers *"should this be shared?"* — the **policy** gate. A `PanelDefinition`/`ActionRequest` (31400/31402) raised to the forum; approval is a signed 31403. |
| **Elevation** | The act of promoting a concept from personal-KG styling to a shared OWL class via the governed propose→Whelk→PR→merge path. |
| **Elevation event** | The domain event (`ConceptElevated`) emitted on merge, which drives the XR migration animation (Seam E). |
| **Provenance bridge** | The BC20 anti-corruption translation that maps `urn:agentbox:*` records to `urn:visionclaw:*` graph nodes and back, preserving identity across the federation boundary. |
| **Alignment** | String + embedding similarity of an elevation candidate against existing `vc:` shared classes, run *before* proposing, to prevent duplicate shared classes. |

## Aggregates

### A1: AgentMandate (root)

The scoped, revocable grant authorising an agent to write a pod KG container. Root aggregate of BC22: nothing in this context mutates a pod or proposes an elevation without a valid mandate in hand.

**Value Objects:**
- `MandateScope { container_uri: PodURI, modes: ("acl:Write" | "acl:Append")[], expires: ISO-8601 }`
- `MandateGrant { grantor_did: did:nostr, agent_did: did:nostr, urn: "urn:agentbox:mandate:<scope>:<local>", signature: SchnorrSig, issued_at: ISO-8601, revoked_at: ISO-8601 | null }`
- `WacBinding { container_uri, acl_agent: did:nostr, acl_modes: ("acl:Write"|"acl:Append")[] }` — the WAC `acl:agent` triple the grant projects into the pod's `.acl` resource.
- `Nip26Delegation { delegator_pubkey, delegatee_pubkey, conditions, token } | null` — the wire form *only* where an agent must speak *as* the user (default null; the agent speaks as itself).

**Consistency boundary**: one aggregate per `(agent_did, container_uri)`. The grant is minted by the grantor (the user/pod owner), persisted as a signed record under `pods/<npub>/mandates/`, and projected as a WAC `acl:agent` triple into the container's `.acl`. Revocation atomically sets `revoked_at` *and* removes the WAC triple; both must succeed or the revoke is retried (revocation is fail-closed: a half-revoked mandate is treated as revoked).

**Invariants:**
- **M01**: An agent MUST act only under a mandate where `revoked_at = null` AND `now() < scope.expires` AND a matching `WacBinding` exists in the container `.acl`. Absence of any of these → the write is refused (`mandate-invalid`, fail-closed).
- **M02**: The agent writes as its OWN `did:nostr` (`agent_did`); the user's nsec NEVER crosses into BC22. The NIP-98 `Authorization` is signed with the agent's key, not the grantor's (extends DDD-003 I05 across the federation boundary).
- **M03**: Revocation is immediate and verifiable — once `revoked_at` is set and the WAC triple is removed, the next pod write under that mandate is refused by *both* BC22 (record check) and solid-pod-rs (WAC default-deny). Two independent enforcement points; neither is sufficient alone.
- **M04**: `mandate.urn` is minted via `uris.js` (R2 scope-bearing, content-addressed on `assignee+target+action+constraints`, owner-scoped to the grantor). Ad-hoc `format!()`/template-literal mandate URNs are prohibited (ADR-013).
- **M05**: `scope.modes` ⊆ `{acl:Write, acl:Append}`; an agent granted only `acl:Append` MUST NOT issue a PATCH that deletes existing triples.

### A2: PersonalKnowledgeGraph

The elevatable object. The user's private KG whose canonical representation is **pod RDF**. Memory (RuVector) and Logseq markdown are projections INTO it, not authorities over it.

**Value Objects:**
- `KgContainer { pod_uri: PodURI, owner_did: did:nostr, format: "text/turtle" | "application/ld+json" }`
- `KgTriple { s: IRI, p: IRI, o: IRI | Literal, source_activity_urn: "urn:agentbox:activity:<scope>:<verb>-<id>" }`
- `KgProjection { from: "ruvector-memory" | "logseq-md", into: KgContainer, last_synced: ISO-8601 }` — a one-way derivation INTO the pod RDF; never the reverse direction of authority.

**Consistency boundary**: one aggregate per `KgContainer`. Writes are PATCH-applied via the pods adapter under an A1 mandate. The PATCH applier (solid-pod-rs) MUST parse the existing resource body into the working graph before applying inserts/deletes (the Seam-C C1 bug fix); BC22 asserts this as a domain invariant and a regression contract test, even though the parse itself runs in solid-pod-rs.

**Invariants:**
- **K01**: Every `KgTriple` carries `source_activity_urn` resolving to the `urn:agentbox:activity` record that wrote it. A triple with no provenance is a domain violation (no anonymous personal-KG mutation). Provenance is PROV-O aligned (the activity is `prov:Activity`, the triple `prov:wasGeneratedBy` it).
- **K02**: Incremental writes are NON-DESTRUCTIVE — applying a PATCH that inserts triple T preserves all pre-existing triples in the container (the C1 data-loss bug; G3). Regression predicate: insert one triple, assert prior triples survive.
- **K03**: Pod RDF is the SINGLE source of truth for the personal KG. RuVector/Logseq are `KgProjection`s INTO the pod; on conflict, the pod RDF wins; a projection MUST NOT be read as authoritative for elevation (resolves D6's three-disjoint-stores gap).
- **K04**: Reads use GET content-negotiation (Turtle↔JSON-LD↔N-Triples; Seam-C C4) so the extractor can read-before-write; an agent reads the current container before any PATCH (mandate-gated, but read is `acl:Read`-implied by `acl:Write`).
- **K05**: A write under A1's `acl:Append`-only mandate is insert-only; delete operations require `acl:Write` (couples to M05).

### A3: ElevationProposal

The extracted concept turned into a governed proposal. Owns the lifecycle from extraction to merge-or-reject. This is the aggregate the personal-KG→proposal extractor produces.

**Value Objects:**
- `ProposalStatus { value: "Staged" | "Extracted" | "Proposed" | "ConsistencyChecked" | "PolicyPending" | "PolicyApproved" | "PRCreated" | "Merged" | "Rejected" }`
- `ElevationCandidate { source_triples: KgTriple[], candidate_label: string, candidate_iri: IRI, alignment_matches: AlignmentMatch[] }`
- `AlignmentMatch { existing_class_iri: "vc:onto/<slug>", similarity: float, method: "string" | "embedding" }`
- `NoteProposal { proposal_urn: "urn:agentbox:thing:<scope>:proposal-<id>", subject_iri, axioms: Axiom[], rationale: string, proposer_did: did:nostr }` — mirrors VisionClaw's `NoteProposal` contract.
- `ConsistencyResult { passed: boolean, reasoner: "whelk-el++", new_subsumptions: Axiom[], conflicts: Conflict[] }`
- `PolicyDecision { panel_urn, approved: boolean, approver_did: did:nostr, acsp_kind: 31403, signature: SchnorrSig } | null`

**Consistency boundary**: one aggregate per `proposal_urn`. `ProposalStatus` advances monotonically along the DAG `Staged → Extracted → Proposed → ConsistencyChecked → PolicyPending → PolicyApproved → PRCreated → Merged`, with `Rejected` reachable from any of `Proposed`, `ConsistencyChecked`, `PolicyPending`. No backflow (a `Merged` proposal is terminal). Status transitions persist before the corresponding domain event fires.

**Invariants:**
- **P01**: A proposal MUST pass BOTH gates before it can become a shared class: the **Whelk EL++ consistency gate** (`ConsistencyResult.passed = true`, the correctness gate) AND the **ACSP policy gate** (`PolicyDecision.approved = true`, the human-approval gate). Neither alone is sufficient; status `Merged` requires both predecessors satisfied (G4, G8).
- **P02**: Alignment/dedup MUST run before `Proposed` — `ElevationCandidate.alignment_matches` is computed (string + embedding similarity over `vc:` labels) and any match above the dedup threshold blocks minting a duplicate shared class (the candidate is merged into the existing class instead) (D4; no duplicate `vc:onto/*`).
- **P03**: Elevation routes through VisionClaw's `/ontology-agent/propose` (the governed propose→Whelk→PR path), NEVER the ungoverned `/api/ontology/load` backdoor. The backdoor is removed/guarded in `ontology_axiom_add` (D2, G4). BC22 dispatches via BC21 (the Ontology Bridge), which holds the read-only stance for queries and the governed-propose stance for writes.
- **P04**: `proposal_urn` is minted via `uris.js` reusing the existing `thing` kind (`urn:agentbox:thing:<scope>:proposal-<id>`); no new URN kind is introduced (agentbox CLAUDE.md constraint).
- **P05**: Every `ElevationCandidate.source_triples[*]` resolves to an A2 `KgTriple` with a valid `source_activity_urn` (provenance is unbroken from triple to proposal; couples K01→P05).
- **P06**: The policy gate is required where policy mandates it (G8); for candidates below the policy threshold, `PolicyDecision` MAY be auto-approved by a configured policy, but the *correctness* gate (P01 Whelk) is never skippable.

### A4: ProvenanceBridge

The BC20 anti-corruption translation. Maps `urn:agentbox:*` records to `urn:visionclaw:*` graph nodes and back, so an agent's action and an elevation cross the federation boundary with zero identity loss.

**Value Objects:**
- `UrnMapping { agentbox_urn: "urn:agentbox:<kind>:<scope>:<local>", visionclaw_urn: "urn:visionclaw:<kind>:<scope>:<local>", owner_did: did:nostr }`
- `ActivityRecord { action_urn: "urn:agentbox:activity:<scope>:<verb>-<id>", verb: string, actor_did: did:nostr, target: URN, timestamp: ISO-8601 }` — PROV-O aligned (`prov:Activity` + `prov:wasAssociatedWith` actor + `prov:used`/`prov:generated` target).
- `BridgeHealth { status: "healthy" | "degraded" | "unavailable", peer: "visionclaw", last_check: ISO-8601 }`

**Consistency boundary**: stateless translation per crossing, plus a small durable `UrnMapping` table for round-trip re-identification. Live in VisionClaw's ingest path (consuming agentbox PROV-O records via the existing `0x23 AGENT_ACTION` binary frame / WS `agent-action` event) and round-tripped in agentbox's BC20 reference.

**Invariants:**
- **B01**: Provenance is CONTINUOUS and BIDIRECTIONAL — a `urn:agentbox:activity` re-identifies to a `urn:visionclaw` node and back to the same `urn:agentbox:activity`; zero identity loss across the crossing (G5). The `UrnMapping` is injective in both directions per `owner_did`.
- **B02**: Mappings are minted via `uris.js` (agentbox side) / `src/uri/` (VisionClaw side) per ADR-013; the bridge NEVER constructs a URN ad-hoc. The mapping table maps names; it does not invent them.
- **B03**: The bridge FAILS OPEN on an unreachable peer — when VisionClaw is unreachable, the agentbox-side record is still persisted with its `urn:agentbox` identity and the crossing is retried later; the local action is not blocked by an unreachable visualiser (mirrors DDD-008 BC21's degraded posture; contrast M01/P01/P03 which fail closed). `BridgeHealth.status` reflects the peer state.
- **B04**: The kind map is closed and explicit: `activity↔execution`, `agent↔agent`, `memory↔concept`, `thing↔kg` (extends DDD-008's BC21 ACL table). An unmapped kind is logged and dropped, never silently mis-mapped.
- **B05**: The translation is the ONLY code that imports the cross-namespace grammar; BC22 aggregates A1–A3 speak only `urn:agentbox` value objects (anti-corruption discipline, per DDD-003's "domain code MUST NOT import the wire model outside this layer").

## Domain events

Every event carries `{ ts, correlation_id, actor: did:nostr }` plus the standard ADR-005 observability spine (span ID). Events are dispatched through the `events` adapter slot. The dispatch wraps adapters in the fixed middleware order **observability → privacy filter → linked-data encoder → adapter** (ADR-005 + DDD-004 §L08); privacy redaction completes before the encoder runs.

| Event | Payload sketch | Seam / PRD goal served | Gate produced by |
|---|---|---|---|
| `MandateGranted` | `{ mandate_urn, grantor_did, agent_did, container_uri, modes, expires }` | Seam C / G2 | A1 grant (pre-write authority) |
| `MandateRevoked` | `{ mandate_urn, agent_did, revoked_at, wac_removed: boolean }` | Seam C / G2 | A1 revoke (M03) |
| `TripleWrittenToPod` | `{ container_uri, triple, source_activity_urn, mandate_urn }` | Seam C / G2, G3 | A2 write (K01, K02) |
| `ConceptExtracted` | `{ proposal_urn, candidate_label, source_triples[], alignment_matches[] }` | Seam D / G4 | A3 extraction (D1) |
| `ElevationProposed` | `{ proposal_urn, subject_iri, axioms[], proposer_did }` | Seam D / G4 | A3 `Proposed` (P03 via `/ontology-agent/propose`) |
| `ConsistencyChecked` | `{ proposal_urn, passed, new_subsumptions[], conflicts[] }` | Seam D / G4 | A3 `ConsistencyChecked` (Whelk correctness gate, P01) |
| `ElevationPolicyApproved` | `{ proposal_urn, panel_urn, approver_did, acsp_kind: 31403 }` | Seam D / G8 | A3 `PolicyApproved` (ACSP policy gate, P01, P06) |
| `ConceptElevated` | `{ proposal_urn, shared_class_iri: "vc:onto/<slug>", pr_url, merged_at, source_personal_kg_node }` | Seam E / G6 | A3 `Merged` → drives XR migration animation |
| `ProvenanceMapped` | `{ agentbox_urn, visionclaw_urn, owner_did, direction }` | Seam E / G5 | A4 crossing (B01) |

`ConceptElevated` is the event PRD-014 §3 E4 flags as absent today; it is the hook the XR graph consumes to animate a personal-KG node migrating to shared-ontology styling (E5 owner/origin field).

## Context map

```
                         ┌──────────────────────────────────────────┐
                         │  BC20 — VisionClaw (UPSTREAM)             │
                         │  governed OWL2 ontology, Whelk, PR/merge, │
                         │  XR visualiser, shared-class IRI minting  │
                         └──────────────────────────────────────────┘
                              ▲  Customer/Supplier (ACL: WAC on pod,│
                 propose via  │  ACSP on governance)  ConceptElevated│
                   BC21       │                       + ProvenanceMapped
                              │
   ┌───────────────┐   uses   │   ┌──────────────────────────────────┐
   │ BC21 Ontology │◀─────────┼───│  BC22 — Sovereign Knowledge      │ ← this
   │ Bridge        │  governed│   │        Elevation                 │
   │ (DDD-008)     │ transport│   │  A1 AgentMandate (root)          │
   └───────────────┘          │   │  A2 PersonalKnowledgeGraph       │
                              │   │  A3 ElevationProposal            │
   ┌───────────────┐  ACSP    │   │  A4 ProvenanceBridge (ACL→BC20)  │
   │ DDD-003       │ transport│   └──────────────────────────────────┘
   │ Sovereign     │◀─────────┘        │ writes pod RDF      │ encodes
   │ Messaging     │ (31400-31405,     │ under mandate       │ pod RDF as
   └───────────────┘  NIP-98 sign)     ▼                     ▼ JSON-LD
                              ┌──────────────────┐  ┌──────────────────┐
                              │ solid-pod-rs     │  │ DDD-004          │
                              │ (LDP/WAC/NIP-98) │  │ Linked-Data      │
                              │ Conformist       │  │ Interchange      │
                              └──────────────────┘  └──────────────────┘
```

Relationship summary (using the strategic-pattern vocabulary):

- **BC22 → BC20 (VisionClaw): Customer/Supplier with an Anti-Corruption Layer.** VisionClaw is the upstream ontology owner; BC22 is the downstream customer that *proposes* but never *commits* shared classes. The supplier defines the governed contract (`/ontology-agent/propose`, Whelk gate, PR governance); BC22 conforms to it. A4 ProvenanceBridge is the ACL that prevents VisionClaw's `urn:visionclaw` model from leaking into BC22's `urn:agentbox` aggregates. Authorisation crosses via WAC (pod write) and ACSP (governance).
- **BC22 → BC21 (Ontology Bridge): uses-as-transport.** BC22 does not talk to VisionClaw's REST API directly; it dispatches through BC21 (DDD-008), which already owns the connection lifecycle, the SPARQL prologue, the read-only-query stance, and the governed-propose path. BC21 gains the `ontology_propose` tool mirroring the governed contract; BC22 is its caller. This keeps the federation boundary in one place.
- **BC22 → DDD-003 (Sovereign Messaging): uses-as-transport (ACSP).** The policy gate (31400/31402 panel + 31403 approval) and the agent's signed pod-write NIP-98 both ride the sovereign-messaging substrate. BC22 raises a `PanelDefinition`/`ActionRequest` and consumes the signed approval; it does not own the relay or the signing (DDD-003 owns those; nsec never crosses, M02 ⊇ I05).
- **BC22 → solid-pod-rs: Conformist.** BC22 conforms to the Solid/LDP/WAC/NIP-98 protocol as solid-pod-rs implements it. BC22 owns the *meaning* (personal KG, provenance per triple); solid-pod-rs owns the *bytes, the ACL, and the PATCH applier*. The C1 non-destructive-PATCH fix lives in solid-pod-rs; BC22 asserts K02 as a contract expectation against it.
- **BC22 → DDD-004 (Linked-Data Interchange): downstream encoder.** Pod RDF (Turtle/JSON-LD) and every emitted `@id` pass through DDD-004's EncodingPipeline. BC22 produces records; DDD-004 encodes them; the privacy filter redacts before the encoder runs (L08). The `ConceptElevated` and `ProvenanceMapped` events are encoded as JSON-LD on emit.

## Anti-corruption layer

A4 ProvenanceBridge is the ACL between BC22's `urn:agentbox` model and BC20's `urn:visionclaw` model. It extends the BC21 table (DDD-008 §Anti-Corruption Layer) with the elevation-specific kinds:

| Agentbox (BC22) | VisionClaw (BC20) | Translation |
|---|---|---|
| `urn:agentbox:activity:<scope>:<verb>-<id>` | `urn:visionclaw:execution:<scope>:<local>` | PROV-O Activity → execution graph node (B01, B04) |
| `urn:agentbox:agent:<scope>:<name>` | `urn:visionclaw:agent:<scope>:<local>` | actor identity → live agent node (replaces E2 mock polling) |
| `urn:agentbox:memory:<scope>:lesson-<hash>` | `urn:visionclaw:concept:<scope>:<slug>` | personal-KG concept → graph concept node |
| `urn:agentbox:thing:<scope>:proposal-<id>` | `urn:visionclaw:kg:<scope>:<slug>` | elevation proposal → personal-KG node (pre-elevation) |
| `ConceptElevated` event | `0x23 AGENT_ACTION` frame / WS `agent-action` | elevation animation hook (E4, E6) |
| ACSP 31400-31405 | (BC20 must adopt; E3) | governance protocol — BC20 maps `AgentActionEnvelope` onto ACSP kinds |

The translation code is the ONLY place the cross-namespace grammar is imported (B05); BC22 aggregates A1–A3 speak only typed `urn:agentbox` value objects.

## Invariant summary

| ID | Aggregate | Predicate | Posture |
|---|---|---|---|
| M01 | AgentMandate | valid + unexpired + unrevoked + WAC-bound before any write | fail-closed |
| M02 | AgentMandate | agent writes as own `did:nostr`; user nsec never crosses | fail-closed |
| M03 | AgentMandate | revocation immediate + verifiable at two enforcement points | fail-closed |
| M04 | AgentMandate | mandate URN minted via `uris.js` (R2); no ad-hoc URNs | build/test gate |
| M05 | AgentMandate | `acl:Append`-only mandate is insert-only | fail-closed |
| K01 | PersonalKG | every triple carries `source_activity_urn` (PROV-O) | fail-closed |
| K02 | PersonalKG | incremental PATCH is non-destructive (C1 fix; G3) | regression test |
| K03 | PersonalKG | pod RDF is single source of truth; memory/md are projections | conflict-resolution rule |
| K04 | PersonalKG | reads use GET content-negotiation; read-before-write | contract test |
| K05 | PersonalKG | append-only writes are insert-only (couples M05) | fail-closed |
| P01 | ElevationProposal | Whelk gate AND ACSP gate both pass before `Merged` | fail-closed |
| P02 | ElevationProposal | alignment/dedup runs before `Proposed`; no duplicate classes | fail-closed |
| P03 | ElevationProposal | routes via `/ontology-agent/propose`, not `/api/ontology/load` | fail-closed |
| P04 | ElevationProposal | proposal URN reuses `thing` kind; no new URN kind | build/test gate |
| P05 | ElevationProposal | candidate source_triples resolve to provenanced KgTriples | fail-closed |
| P06 | ElevationProposal | policy gate required where policy mandates; Whelk never skippable | policy-conditional |
| B01 | ProvenanceBridge | provenance continuous + bidirectional; zero identity loss | invariant |
| B02 | ProvenanceBridge | mappings minted via uris.js / src/uri; never ad-hoc | build/test gate |
| B03 | ProvenanceBridge | fails open on unreachable peer; local action not blocked | fail-open |
| B04 | ProvenanceBridge | kind map closed; unmapped kind dropped + logged | invariant |
| B05 | ProvenanceBridge | translation is the only cross-namespace importer | architecture gate |

**Posture rule of thumb**: everything that gates *authority* or *correctness* (mandates, the two elevation gates, provenance-per-triple) fails CLOSED. Everything that gates *visibility* across the federation boundary (the visualiser, the ontology peer reachability) fails OPEN. This mirrors the agentbox CLAUDE.md constraint: fail-closed on missing/invalid mandate; fail-open on unreachable ontology/visualiser peer.

## Map to PRD-014 goals and seams

| PRD-014 | BC22 mechanism |
|---|---|
| **G2** (delegated pod write) | A1 AgentMandate (M01–M05) + A2 `TripleWrittenToPod` |
| **G3** (non-destructive RDF write) | A2 K02 (C1 fix asserted as contract) |
| **G4** (governed elevation path) | A3 P03 (`/ontology-agent/propose`, not the backdoor) + P01 Whelk gate |
| **G5** (continuous provenance) | A4 B01 + `ProvenanceMapped` event |
| **G6** (live actors + elevation viz) | A4 ACL (agent↔agent live mapping) + `ConceptElevated` event |
| **G8** (governed loop) | A3 P01 + P06 ACSP policy gate + `ElevationPolicyApproved` |
| **Seam A/B** | consumed boundary — voice→actor ingress hands BC22 an actor `did:nostr` to act under a mandate |
| **Seam C** | A1 (mandate/delegation, C2/C3) + A2 (non-destructive PATCH C1, content-neg C4) |
| **Seam D** | A3 entirely — extractor (D1), alignment (D4), governed routing (D2), policy gate (D5), unified store (D6 via K03) |
| **Seam E** | A4 (BC20 ACL made real, E1) + `ConceptElevated` (E4) + agent↔agent live mapping (E2) |

## Repository mapping

| Aggregate / concern | Primary file(s) | Status |
|---|---|---|
| A1 AgentMandate (grant/revoke) | `management-api/lib/mandates.js` (new); WAC projection via pods adapter | to build |
| A1 mandate URN minting | `management-api/lib/uris.js` (`mandate` kind, existing) | implemented |
| A1 NIP-98 signing on pod write | `management-api/adapters/pods/_solid-http-base.js` (extend; C2) | partial |
| A2 PersonalKG write/read | pods adapter PATCH/GET; non-destructive fix in `solid-pod-rs/.../lib.rs` (C1) | to build / bug |
| A2 KG projection (memory/md → pod) | `management-api/lib/kg-projector.js` (new; D6) | to build |
| A3 personal-KG → proposal extractor | `mcp/servers/ontology-bridge.js` (`ontology_propose` tool, new; D1) | to build |
| A3 alignment/dedup | `mcp/servers/ontology-bridge.js` (string+embedding; D4) | to build |
| A3 governed routing (remove backdoor) | `mcp/servers/ontology-bridge.js:217-231` (guard `/api/ontology/load`; D2) | bug/gap |
| A3 Whelk + PR pipeline (upstream) | VisionClaw `ontology_mutation_service.rs`, `ontology_agent_handler.rs` | implemented (BC20) |
| A3 ACSP policy gate | DDD-003 relay + `docs/user/nostr-relay.md` ACSP kinds (D5) | partial |
| A4 ProvenanceBridge (agentbox ref) | `management-api/lib/bc20-bridge.js` (new; E1) | to build |
| A4 ProvenanceBridge (VisionClaw ingest) | VisionClaw ingest path consuming `0x23 AGENT_ACTION` (E1, E6) | to build (BC20) |
| Domain events dispatch | `management-api/adapters/events/*.js` (slot) | implemented (slot) |
| Contract test harness | `tests/contract/knowledge-elevation/*.spec.js` (new) | to build |

## Test strategy

- **Unit tests — one per invariant (M01–M05, K01–K05, P01–P06, B01–B05)** under `tests/unit/knowledge-elevation/`. Each test names its invariant in the `describe` string. No invariant ships without a test.
- **Contract tests** under `tests/contract/knowledge-elevation/`:
  - `mandate.contract.spec.js` — M01 (refuse on missing/expired/revoked), M02 (no nsec in any frame/log), M03 (revoke enforced at both points).
  - `non-destructive-patch.contract.spec.js` — K02: insert one triple, assert all prior triples survive (the G3 regression, run against solid-pod-rs).
  - `governed-elevation.contract.spec.js` — P01 (both gates required), P03 (backdoor path returns 403/guarded), P02 (duplicate candidate merges, no new `vc:onto/*`).
  - `provenance-roundtrip.contract.spec.js` — B01: `urn:agentbox:activity` → `urn:visionclaw` → back yields the same activity URN; B03: with the peer stubbed unreachable, the local write still persists and the action is not blocked.
- **Property-based tests (`fast-check`)**:
  - **Status monotonicity**: for any transition sequence, `ProposalStatus` only advances along the DAG; `Merged` is terminal; `Rejected` is reachable only from the documented predecessors.
  - **Provenance injectivity**: for any set of distinct `urn:agentbox` records, the `UrnMapping` is injective in both directions per `owner_did` (B01).
- **Integration test — end-to-end (PRD-014 §7.1)**: agent selected in XR → spoken instruction → signed ActionRequest → actor → NIP-98 pod write of a triple → personal-KG node appears → ACSP elevation prompt → on approval, governed PR proposes the shared class → on merge, `ConceptElevated` animates the migration — asserting one continuous provenance chain (`urn:agentbox:activity` ↔ `urn:visionclaw`).

## Design notes

This domain exists because "elevate a concept" is not one concern. *Authority to write* (the mandate), *the meaning of the personal KG* (pod RDF as truth, with per-triple provenance), *the two-gate governance of sharing* (Whelk correctness AND ACSP policy), and *identity preservation across the federation boundary* (the BC20 ACL) are four separate invariant surfaces. Collapsing them — as the current code does, with an anonymous pod write that destroys prior triples feeding an ungoverned `/api/ontology/load` POST that bypasses both gates and a paper-only bridge that loses identity — is exactly how Seam D became the flagged major gap. Modelled as four aggregates with explicit fail-closed/fail-open postures, a missing mandate, a destructive PATCH, a skipped gate, or a lost provenance link each becomes a domain violation with a failing test, not an undetected breach of the user's sovereignty.

The constraint discipline is deliberate: no new URN kinds (proposals reuse `thing`, lessons reuse `memory`, mandates reuse `mandate`), no new identity primitives (`did:nostr` end to end), and the privacy→encoder middleware order honoured wherever BC22 dispatch wraps an adapter. BC22 adds an orchestration domain, not a new substrate.
