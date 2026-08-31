---
id: PRD-022
title: Semantic Integrity, Provenance and Decision Intelligence
status: Draft v1
date: 2026-08-07
author: Dr John O'Hare
drives: [ADR-047, ADR-048, ADR-049]
domain: DDD-020
depends_on: [ADR-046, ADR-023, ADR-013, ADR-005, ADR-008, ADR-012]
review_trigger: VisionClaw restored to service (visionclaw-server:4000 up + ontology-output.ttl loaded), or semantica major release changing its reasoner/provenance surface
repo: github.com/DreamLab-AI/agentbox
---

# PRD-022: Semantic Integrity, Provenance and Decision Intelligence

**Related:** [ADR-046](../adr/ADR-046-semantica-complement.md) selects the
capabilities; [ADR-047](../adr/ADR-047-semantica-tenant-integration-boundary.md)
sets the native boundary; [ADR-048](../adr/ADR-048-decision-records-as-graph-nodes.md)
and [ADR-049](../adr/ADR-049-bitemporal-facts-and-runtime-provenance.md) define
decision and temporal/provenance semantics; [DDD-020](../ddd/DDD-020-semantic-integrity-provenance-domain.md)
owns the domain. The implementation remains constrained by
[ADR-023](../adr/ADR-023-ontology-bridge.md),
[ADR-013](../adr/ADR-013-canonical-uri-grammar.md),
[ADR-005](../adr/ADR-005-pluggable-adapter-architecture.md),
[ADR-008](../adr/ADR-008-privacy-filter-routing.md) and
[ADR-012](../adr/ADR-012-jsonld-federation-grammar.md).

## TL;DR for newcomers

*Skip if you already know that ADR-046 selected four useful capability patterns,
that one already shipped in the corpus pipeline, and that this sprint implements
the remaining graph interactions natively behind VisionClaw's governed API.*

A multi-agent mesh writes into a shared ontology graph. Four things about those
writes are currently unsafe or unrecorded. Semantica
(`github.com/semantica-agi/semantica`, MIT, Python) demonstrates useful versions
of these capabilities, but its runtime, storage adapters and data shapes are not
adopted here:

1. **Concurrent writes corrupt the graph** — duplicate merges, subclass cycles, relation contradictions. This is our *observed* failure mode, not a hypothetical: the native port of semantica's `ConflictDetector` (`pipeline/conflicts.py` in `jjohare/logseq`) found **2 subclass cycles and 57 subClassOf/contrasts_with contradictions** on its first live run over the real corpus — defects the structural validator never caught.
2. **Runtime agent writes carry no provenance** — we hang W3C PROV-O (`prov:wasAttributedTo`, `prov:generatedAtTime`) off corpus IRIs in the markdown pipeline, but an *agent's* write at runtime lands with no lineage at all.
3. **The graph is atemporal** — there is no "what did we believe on date X" over a living corpus; a retraction silently overwrites, and history is only recoverable from git diffs of the corpus, never queryable from the graph.
4. **Agent decisions leave no auditable trail** — a governed proposal that changes the graph vanishes into a commit message; it is not a queryable node with causal ancestry, precedent, or an impact set.

The decisive constraint (ADR-046): **semantica has no OWL DL/EL reasoner.** Its
"reasoning" is Rete/Datalog/SPARQL/SHACL — it generates and validates OWL but
does not replace Whelk's materialised EL classification. We therefore adopt the
four *capabilities and interactions*, not the stack: native services implement
them through VisionClaw's accepted HTTP boundary and our own graph vocabulary.

This PRD delivers the four as five workstreams, additively and manifest-gated, defaulting to today's behaviour, and — the differentiator semantica structurally lacks — every runtime write and every decision is **`did:nostr`-attributed and ACSP-governed**, so accountability is cryptographic sovereignty, not merely PROV-O lineage:

- **W-A — Pre-merge integrity gate** (semantica `ConflictDetector`/`EntityMerger`). **Native port shipped** (`pipeline/conflicts.py`); this PRD formalises it as a governed-write-path guard and wires it into the ACSP propose path. **Unblocked.**
- **W-B — Decisions-as-graph-nodes** (ADR-048). A `DecisionRecord` is a
  first-class `prov:Activity`; direct causal and precedent links are asserted,
  while ancestry and impact are derived explicitly at query time. **VisionClaw-gated.**
- **W-C — Bi-temporal facts** (ADR-049). Valid-time vs recorded-time, `state_at(t)` point-in-time snapshots, Allen interval relations — held in provenance-side named graphs so the EL-reasoned graph stays sound and fast. **VisionClaw-gated.**
- **W-D — Runtime PROV-O** (ADR-049). Extend corpus-only provenance to every agent write, on the same reification mechanism as W-C. **VisionClaw-gated.**
- **W-E — capability contracts and transaction spine** (ADR-047). Define the
  implementation-neutral contracts, idempotency key, atomic commit boundary and
  replay/rollback harness shared by W-A–W-D. **Contract work is unblocked.**
- **W-F — positioning/presentation** and **W-G — client visualisation** (§3): the outward-facing narrative and the node-graph rendering of each capability, both phased strictly behind the capability they describe.

**If you remember only one thing:** the four capabilities close a real, observed
integrity-and-accountability gap; we adopt Semantica's useful interaction ideas,
not its runtime or data model. Whelk remains the inference core, native services
own the write path, and every capability lands behind evidence and governance.

For the deep version, keep reading.

---

## 1. Problem

### 1.1 Concurrent agent writes corrupt shared graph integrity — proven, not hypothetical

The agent mesh proposes changes to a shared ontology graph. Two agents can independently assert `A subClassOf B` and `B subClassOf A`; a rename can leave a dangling reference; two extractions of the same real-world entity land as two nodes. VisionClaw's `propose→Whelk→governance` path checks *consistency* (Whelk rejects a graph that is unsatisfiable) but consistency is not integrity: a subclass cycle is often still *satisfiable* under EL semantics, and a `contrasts_with` contradiction between two `subClassOf` assertions is invisible to a subsumption reasoner entirely.

This is verified, not modelled. The native port of semantica's `ConflictDetector` (`pipeline/conflicts.py`, commit `7faa91ea5` in `jjohare/logseq`) ran once over the live corpus and found:

| Conflict class | Count | Caught by Whelk consistency? |
|---|---|---|
| `SUBCLASS_CYCLE` | **2** (`time-series-forecasting`↔`probabilistic-forecasting`; `adaptive-learning`↔`personalised-learning`) | No — both cycles remain EL-satisfiable |
| `RELATION_CONTRADICTION` (`subClassOf` vs `contrasts_with`) | **57** | No — orthogonal to subsumption |
| `DUPLICATE_CONCEPT` | (detector present) | No — entity resolution is pre-reasoner |
| `TYPE_CONFLICT` | (detector present) | No |

The structural validator did not catch these; the reasoner cannot. The gap is a **pre-merge integrity guard** that runs *before* an assertion reaches Whelk.

### 1.2 Runtime agent writes carry no provenance

We already hang PROV-O off corpus IRIs — `prov:wasAttributedTo`, `prov:generatedAtTime` — but only in the markdown corpus pipeline (`jjohare/logseq`), which is a batch, human-authored source. An *agent* writing at runtime through the governed propose path produces a triple with **no lineage**: no attribution to the acting `did:nostr`, no generating activity, no timestamp on the graph. The corpus is provenanced; the live agent surface is not. PRD-014 established the `urn:agentbox:activity` PROV-O Activity spine for the *embodied loop*; this PRD extends that spine to *every governed graph write*.

### 1.3 The graph cannot answer "what did we believe on date X"

The reasoned graph is a single present-tense snapshot. A retraction overwrites; a correction destroys the prior belief. "What did the ontology say about `X` before the 2026-07 enrichment?" is answerable only by checking out an old corpus commit and re-materialising — minutes of work, off-graph, and impossible for an agent mid-turn. There is no valid-time (*when was this true in the world*) distinct from recorded-time (*when did we learn it*), and no `state_at(t)` query.

### 1.4 Agent decisions leave no auditable, queryable trail

When an agent proposes a graph change and ACSP governs it in, the *decision* — the rationale, the inputs it weighed, the precedent it followed, what it caused downstream — is recorded, if at all, as prose in a commit message or a RuVector memory row. It is not a node. You cannot `trace_decision_chain()` to find the causal ancestry of a bad merge, cannot `find_similar_decisions()` to surface precedent, cannot `analyze_decision_impact()` to compute the blast radius of retracting one. The EU AI Act high-risk obligations binding 2026-08-02 (memory: `ontology-agents-industry-moment-2026-07`) make "why did the agent do that, and what did it depend on?" a *legal* question, not only an operational one.

### 1.5 Why semantica, and why not just adopt its stack

Semantica is useful comparative prior art and exposes §1.1–§1.4's capabilities
as first-class interactions. Its public RDF backend matrix does not list
Oxigraph, and its runtime and object model are not architectural inputs here.
VisionClaw keeps Whelk classification and its governed HTTP boundary; we port
only behaviour justified by our acceptance tests. This is ADR-046's
*complement, do not replace* decision applied consistently.

---

## 2. Goals and non-goals

### 2.1 Goals

| # | Goal | Success measure |
|---|---|---|
| G1 | No governed graph write merges without passing the conflict/entity-resolution gate | 100% of ACSP propose-path writes traverse the W-A guard; gate exit-code composes with `pipeline.gate`; the 2 cycles + 57 contradictions from §1.1 are *fixed and stay fixed* (regression corpus) |
| G2 | Every runtime governed write carries cryptographic + PROV-O attribution | Generated assertion entities link via `prov:wasGeneratedBy` to an activity `prov:wasAssociatedWith` the acting `did:nostr`; entities use `prov:wasAttributedTo`; zero unattributed runtime commits in the audit canary |
| G3 | The graph answers point-in-time queries | `state_at(t)` returns the valid-time projection at `t` for any `t` since W-C launch; recorded-time and valid-time are independently queryable |
| G4 | Agent decisions are first-class, queryable, causally linked nodes | `record_decision` / `trace_decision_chain` / `analyze_decision_impact` / `check_decision_rules` available via MCP; direct links remain distinguishable from query-derived reachability |
| G5 | Whelk remains the sole inference core | No external reasoner is introduced; every claimed entailment has a Whelk integration test or is labelled query-derived |
| G6 | The EL-reasoned graph stays sound and fast | Temporal + provenance metadata live in separate named graphs Whelk does not classify; classification and projection benchmarks stay within operator-approved budgets |
| G7 | Our positioning states the sovereign/governed/immersive superset of semantica's regulated-industries pitch, without publishing ahead of substance | Each README/website surface (W-F) updated only when the capability it names is live; the differentiator table lands in the `agentbox` README with W-A as a shipped proof point; every public publish operator-confirmed |
| G8 | Every landed capability is *visible and operable* in the node graph | W-G: decision nodes + asserted-vs-inferred edge distinction rendered (W-B), `state_at(t)` timeline scrubber live (W-C), attribution + signature badge in `NodeDetailPanel` (W-D), conflict badges + gate-status chips (W-A); each visual feature ships only after its capability, and the `graph_type` enum + settings pipeline are extended in all five settings files |

### 2.2 Non-goals

- **Not** replacing Whelk, Oxigraph, the ontology bridge (ADR-023/PRD-011), or the ACSP governance decision. This PRD consumes governance; it does not re-implement it.
- **Not** adopting semantica's reasoning, deduplication-as-inference, vector store, or its visualisation — VisionClaw/VisionFlow own those surfaces (client render, `ontology-bridge` MCP).
- **Not** a second RDF store, Python tenant, Semantica schema clone or direct
  Oxigraph binding. ADR-023's governed HTTP boundary remains authoritative.
- **Not** landing W-B/C/D before VisionClaw is restored and the corpus/store drift is resolved. Sequencing is a hard gate, not a preference (§5).

---

## 3. Workstreams

### W-A — Pre-merge integrity gate (ConflictDetector / EntityMerger)  ·  status: native port SHIPPED, formalisation open

**What shipped.** `pipeline/conflicts.py` (commit `7faa91ea5`) implements the `ConflictDetector` pattern natively over our corpus with no VisionClaw or semantica dependency: `DUPLICATE_CONCEPT`, `SUBCLASS_CYCLE`, `RELATION_CONTRADICTION`, `TYPE_CONFLICT`, exit-coded to compose with `pipeline.gate` (commit `813551daa`) as a pre-merge guard. It is decoupled from VisionClaw availability by design — the highest-value capability lands first (ADR-046 Consequences).

**What this PRD adds.** Promote the batch corpus guard to a **runtime governed-write guard**: the same four detectors run inside the ACSP propose path (`/api/ontology-agent/propose`) *before* an agent assertion reaches Whelk, and `EntityMerger` resolves `DUPLICATE_CONCEPT` by blocking + semantic-similarity clustering rather than blind insert. On conflict: reject with a typed report (composes with `pipeline.gate` exit codes), attach the report to the decision record (W-B), never silently overwrite.

**Guardrails spec.** Input: a proposed triple set + acting `did:nostr`. Reject if any detector fires above threshold; `TYPE_CONFLICT`/`SUBCLASS_CYCLE` are hard-fail (fail-closed); `DUPLICATE_CONCEPT` routes to `EntityMerger` (fail-into-merge); `RELATION_CONTRADICTION` is fail-closed with a required human/ACSP override. Escalation: rejected proposal → ACSP human-in-the-loop. Monitoring: per-class conflict counter; alert on merge-rejection rate > baseline.

**Fix backlog (surfaced by the live run, this PRD tracks to closure):** the 2 subclass cycles and 57 relation contradictions of §1.1 become a regression corpus — they must be fixed in `jjohare/logseq` and never recur (G1).

### W-B — Decisions-as-graph-nodes (ADR-048)  ·  status: VisionClaw-gated

A `DecisionRecord` is a first-class graph node, minted
`urn:agentbox:decision:<scope>:<sha256-12>`, and typed as both `prov:Activity`
and `dl:DecisionRecord`. Direct causal and precedent links are asserted; bounded
ancestry and impact are query-derived and return supporting paths. Activities
use `prov:wasAssociatedWith` for the acting `did:nostr`. Full design: ADR-048.

### W-C — Bi-temporal fact model (ADR-049)  ·  status: VisionClaw-gated

Each asserted fact carries valid-time distinct from recorded-time through a
portable assertion-version entity in the provenance graph. `state_at(t)` returns
the valid-time slice; interval relations are query helpers. Full design: ADR-049.

### W-D — Runtime PROV-O on agent writes (ADR-049)  ·  status: VisionClaw-gated

Every governed runtime write emits, into the provenance named graph, an assertion-version entity carrying `prov:wasGeneratedBy <activity>`, `prov:wasAttributedTo <did:nostr>`, `prov:generatedAtTime <t>` — on the *same* portable assertion-version mechanism as W-C (one mechanism, two annotation families — they ship together); the activity itself is `prov:wasAssociatedWith` the acting agent, and the BIP-340 signature lives in the versioned native envelope, not a TBox predicate. This closes the corpus-only-provenance gap of §1.2 and reuses PRD-014's `urn:agentbox:activity` spine. Full design: ADR-049.

### W-E — Native capability contracts and transaction spine (ADR-047)  ·  status: contract work unblocked

Define black-box contracts for conflict preview, temporal projection, provenance
bundles and decision traversal. Implement a single idempotent proposal transaction
that commits assertion, provenance and decision data atomically through the
VisionClaw HTTP write boundary. Add failure-injection, retry, replay and rollback
tests before W-B/W-C/W-D attach to it. Semantica examples may inform test cases,
but no Semantica class, backend, sidecar or API becomes part of the contract.

---

### W-F — Positioning and presentation, phased with the capability build  ·  status: continuous

Semantica *presents* better than we do in three specific, stealable ways, and the capability build is the occasion to fix that — **as each capability lands, not before it** (we describe shipped surface, never vapourware). This workstream is the outward-facing counterpart to W-A–W-E.

**What to steal from semantica's README (presentation, not substance):**

1. **A one-line category claim.** They open with "the open-source Palantir for AI agents." We bury our category ("neurosymbolic sovereign agent substrate") in section bodies. Lead with it.
2. **A quantified performance table.** They headline "6,000× faster node search, 6.98× dedup" on a 118k-node graph. We *have* comparable numbers (Whelk EL materialisation timings, `./agentbox.sh ruvector recall` bands, the 262k-triple load) and never surface them. Add a measured table.
3. **An explicit target-persona table.** They name "AI/ML platform teams, compliance & audit, regulated enterprises (finance/healthcare/legal/government/defence)." We should claim the *same* personas — because we serve them *better* (below) — and add the ones they cannot: multi-user immersive analysis teams, XR/situational-awareness operators.

**Our differentiators — the counter-pitch to their regulated-industries frame.** Semantica's accountability is **PROV-O lineage** — it answers *what happened*, in a record any store-admin can rewrite. We answer two strictly stronger questions and add a category they do not compete in:

| Their frame | Our stronger claim | Where it comes from |
|---|---|---|
| Explainable/auditable via PROV-O lineage | **Cryptographically sovereign** — every write and decision is `did:nostr`-**signed** and non-repudiable; ownership is a multi-key chain (parent/child down a spawn tree), not an editable log | ADR-033, DDD-020 I04, this PRD G2 |
| Policy compliance gates (SHACL/`check_decision_rules`) | **Governed** — ACSP human-in-the-loop *authorisation* on every mutation, not just post-hoc validation; consistency ≠ integrity ≠ governance are three distinct gates | DDD-020 I07, ACSP |
| Reasoning: Rete/Datalog/SPARQL/SHACL (validates OWL) | **Classifies OWL** — Whelk EL++ materialised subsumption over the class hierarchy; decision reachability is honestly *labelled derived* and returns its supporting evidence paths, never conflated with asserted truth | ADR-023, ADR-048 |
| Visualisation: force-directed 2D graph | **Multi-user, immersive, multi-surface** — the reasoned graph rendered in XR, collaboratively, over **secure self-sovereign links** (Nostr/DID); agents *act in* the space humans *govern* | VisionFlow client, PRD-014 embodied loop |
| Storage: polyglot (swap RDF/LPG backends) | (we deliberately do **not** compete here — one sovereign store, one source of truth) | ADR-047 rule 1 |

The honest framing for regulated industries: *semantica gives you a defensible audit trail; we give you a **sovereign, governed, immersive** one — provable ownership, human-authorised mutation, and a shared space multiple stakeholders inspect together.* That is a superset of their pitch, plus a surface (immersive multi-user) they have no answer to.

**External framing (Year of the Graph, vol. 30, Spring 2026 — cite, don't chase).** The industry vocabulary has caught up with our architecture, and its own consensus names semantica's category as incomplete. Useful, attributable phrases: *"connectivity without semantics is just faster error"* (Verhelst) — the one-line case for the Whelk gate; *"decision-recording without formal ontological structure remains incomplete"* — the newsletter's own verdict that context-graph decision traces (semantica's thesis) need the formal ontology layer we supply; the *"Logic Gap"* between recording a decision and understanding it (Blaschka) — which our formally-typed decision vocabulary plus bounded, evidence-path-returning traversal closes; and *"boards cannot govern what they cannot define"* (Verhelst) — the governance case for ACSP over a formally-defined ontology. **Calibration:** that same newsletter champions semantic *structure and provenance* but stops short of advocating classical description-logic inference — so our shipped Whelk EL++ classifier sits slightly *ahead* of the stated consensus. Claim that lead with evidence (materialised subsumption, the 2-cycle/57-contradiction catch), never as if it were industry orthodoxy — the "vibe ontologies / blindly trusting LLM-built KGs" caution in the same piece is exactly the failure our governed propose→Whelk→ACSP path exists to prevent.

**Surfaces to update, phased with capability landings (outward-facing — each gated on the capability being real, and on operator sign-off before publish):**

| Surface | Update | Gate |
|---|---|---|
| `agentbox` README | Category one-liner; the differentiator table above; the W-A conflict-gate result as a shipped proof point (2 cycles + 57 contradictions caught) | W-A (**now**) |
| VisionClaw README | Whelk-classifies-vs-validates framing; performance table; native capability contracts as the integration story | VisionClaw restored |
| VisionFlow README + website | Immersive multi-user/multi-surface differentiator; secure self-sovereign links; the neurosymbolic + provenance + decision-intelligence stack as one narrative | W-B/C/D landed |
| NarrativeGoldMine website | The regulated-industries counter-pitch; persona table incl. immersive-analysis operators; decision-intelligence + provenance as the enterprise story | W-B/D landed |

Nothing here publishes ahead of the substance: a surface is updated only when the capability it describes is live, and every outward-facing publish is operator-confirmed (the NarrativeGoldMine and VisionFlow sites are public).

### W-G — Client visualisation: the capabilities made visible in the node graph  ·  status: per-feature, gated on its capability

The host client (VisionFlow graph renderer) already ships the seams this workstream extends — an ontology feature slice (`OntologyPanel`, `InferencePanel`, `OntologyProposalList`, `OntologyContribution` = the governed-propose UI), a `NodeDetailPanel`, per-type instanced materials (Gem/CrystalOrb/AgentCapsule/GlassEdge), and type-flag rendering — so W-G is extension, not greenfield. Each feature gates on the capability it renders; nothing visual ships ahead of its substance.

**Per-capability features:**

| Capability | Visual/interactive feature | Gate |
|---|---|---|
| W-B decisions | Fourth node class `DecisionRecord` (octahedral "seal" geometry + `DecisionSealMaterial`, unused flag bits in 26–31); typed edge styles — `dl:caused` directed animated flow, `dl:precedentFor` translucent/ghosted (**asserted vs query-derived edges visually distinct**), `dl:governedBy` thin tether; interactions **Trace chain** (bounded causal ancestry), **Blast radius** (derived downstream paths + count), **Find precedent** (similarity candidates pulse) | W-B |
| W-C bi-temporal | **Timeline scrubber** (`TimelineScrubber.tsx`, bottom-docked; XR wrist/palm variant) re-projecting the graph at `state_at(t)` — nodes/edges fade outside their validity interval; **diff mode** (t₁ vs t₂) colours added/retracted/changed. The one genuinely new subsystem; needs `state_at(t)` server-side | W-C |
| W-D provenance | `NodeDetailPanel` *Attribution* section — acting `did:nostr`, activity URN (resolvable via `/v1/uri/`), timestamp, **BIP-340 signature-verified badge** (✓/✗); **colour-by-author** mode tinting nodes by asserting `did:nostr` (multi-user provenance at a glance) | W-D |
| W-A conflict gate | **Pre-merge conflict badges** rendering a rejected `ConflictReport` in situ (SUBCLASS_CYCLE pair joined by pulsing red arc; RELATION_CONTRADICTION warning glyphs — the 2-cycle/57-contradiction corpus is the demo scene); `OntologyProposalList` gains **gate-status chips** per proposal (conflict ✓/✗ · Whelk ✓/✗ · ACSP pending — DDD-020 I07's three distinct gates made legible) | W-A runtime wiring |

**Interface/menu changes (mapped to real seams):**

| Surface | Change |
|---|---|
| Settings pipeline (all five files: `settings/config/settings.ts` → generated types → `api/settingsApi.ts` defaults → `settingsUIDefinition.ts` → unified panel config) | New `decisions` + `provenance` groups: show/hide decision nodes, inferred-edge translucency, colour-by-author, timeline enable |
| Graph filter (`graph_type` query param, server + client) | Add `decision` to the enum (`knowledge\|ontology\|agent\|decision`), type-filter chips, legend |
| `NodeDetailPanel.tsx` | Attribution section, validity interval display, Trace chain / Blast radius / Find precedent actions |
| `OntologyTabContent.tsx` | *Decisions* sub-panel (list + `find_similar_decisions` search); gate-status chips in `OntologyProposalList.tsx` |
| Context menu (right-click / XR ray-select) | Trace chain · Impact · Show provenance · **Retract (governed)** — retract routes through the governed propose path, never a raw delete |
| Legend/onboarding | Fourth node shape; edge key: solid = asserted, translucent = query-derived, red = conflict |

**Landing order (cheapest-first):** W-A badges + `NodeDetailPanel` attribution (near-zero new architecture) → decision nodes/edges (W-B) → timeline scrubber (W-C, the new subsystem). Known host-client bug patterns to honour: node ID `String()` coercion everywhere decision IDs are compared; full prop destructure-and-forward on any wrapper extraction.

**W-F tie-in:** the timeline scrubber and colour-by-author are the *demonstrable* form of the multi-user/immersive differentiator — semantica renders temporal dashboards in 2D; we re-project a reasoned graph around the operator in XR. Screenshots/capture from W-G feed the W-F website updates.

## 4. Cross-cutting: URN kind, middleware, identity

- **URN kind (ADR-013).** W-B adds one canonical kind: `decision`. Minted **only** through `management-api/lib/uris.js`; ad-hoc `format!()`/template-literal decision URNs are prohibited (ADR-013 discipline). A `DecisionRecord` `IS-A prov:Activity`, so it inherits W-D's runtime-provenance plumbing rather than duplicating it — the single addition to the kind catalogue is justified in ADR-048 §Alternatives (vs reusing `activity`).
- **Middleware (ADR-005).** Every governed write dispatches through the three layers in order: observability (span+log+metrics) → privacy filter (ADR-008, **fail-closed** on the provenance write path — a write whose attribution cannot be privacy-checked is rejected, not merged) → JSON-LD encoder (ADR-012, PROV-O serialised as JSON-LD 1.1 with a build-pinned context).
- **Identity (ADR-013/DID).** Attribution is `did:nostr`, not an opaque actor string; the parent/child signing relationship down a mesh spawn tree (memory: typed-recursive-spawn, commit `1d15a00f`) means a decision made by a child agent is attributable to both the child principal and its parent signing key.

---

## 5. Sequencing (hard gate)

W-A is unblocked *as a batch/corpus guard* and partially shipped. But **wiring W-A as the runtime propose-path guard, and starting W-B/C/D/E, cannot begin** until, in order:

0. **Propose route authenticated (gates even W-A's runtime wiring).** `/api/ontology-agent/propose` is authenticated + NIP-98/signature-verified before any conflict gate or tenant is wired onto it. Wiring an integrity gate onto a forgeable, unauthenticated route would let anyone flood or forge governed writes — the gate would guard a door with no lock (DDD-020 I10). This is step 0 because it is the cheapest and the most dangerous to skip.
1. **VisionClaw restored** — `visionclaw-server:4000` up; `ontology_health` reports the reasoned store, not the `local-markdown` fallback. *(Realised 2026-08-10: VisionClaw is back up and the Whelk EL reasoner is LIVE — `urn:ngm:graph:ontology:inferred` holds ~37k inferred axioms and `/api/ontology/{inferred,inference,metrics,validate}` are reachable. Prior state, now superseded: VisionClaw DOWN, `ontology_health=local-markdown`, 8152 markdown classes.)*
2. **Drift resolved** — load `ontology-output.ttl` (262k triples, generated, gitignored) into `urn:ngm:graph:ontology:assert` to kill the **8,152-vs-~5,975** corpus/store divergence (the markdown corpus is the fuller source of truth). W-C's `state_at()` over a *drifted* store would return incoherent snapshots.
3. **Whelk consistency-check re-enabled** in the propose path, and `VISIONCLAW_DEV_TOKEN`/`AGENTBOX_PUBKEY` set (memory: fix-before-extending list). On a dev build `VISIONCLAW_DEV_TOKEN` must be the literal dev-session bearer `dev-session-token` (a bare pubkey as bearer returns 403); release builds authenticate via NIP-98 signing.

Contract and fixture work for W-E can start immediately. Once steps 0–3 pass:
W-E transaction implementation → W-D (runtime PROV-O) → W-C (bi-temporal,
shares W-D's mechanism) → W-B (decisions, consumes W-D attribution). W-G client
features trail their capabilities in cheapest-first order; W-F publishing trails
verified W-G captures.

## 6. Quality gates (build-with-quality)

Per the build-with-quality pipeline, each landing workstream must clear:
**coverage** ≥ 85% on new native guard/transaction code; **security** — the
authenticated propose-path prerequisite in §5 step 0 plus replay and raw-update
tests; **EDD** — the §1.1 conflict corpus is the expectation set, independently
re-derived from raw graph data; **performance** — Whelk classification and
temporal-projection baselines on a frozen corpus; **recall** —
`./agentbox.sh ruvector recall` only when embeddings, HNSW parameters or retrieval
geometry change; **chaos** — concurrent-writer and mid-transaction failure
injection proving atomicity, idempotency and replay.

## 7. Open questions

- **Q1 (quoted-triple upgrade).** *Resolved by ADR-049:* portable reification (content-addressed assertion-version entities) is the v1 mechanism; RDF 1.2 quoted triples may replace it only after a pinned-build compatibility test proves parse/update/query/export/backup round trips. Public contracts expose assertion-version IDs, so the upgrade never changes callers.
- **Q2 (decision-store locus).** Does the `DecisionRecord` store live in Oxigraph (queryable alongside the ontology, Whelk-classifiable) or in the beads/events adapters (already the agent work ledger)? *ADR-048 recommends Oxigraph for classifiability, with a beads cross-reference for the work-ledger view.*
- **Q3 (external comparison).** Which Semantica interactions merit golden
  behavioural fixtures? Disposable comparison code stays outside production and
  carries no write credentials; ADR-047 forbids a tenant dependency in this sprint.
