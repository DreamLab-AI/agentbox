# DDD-018: Learning Consumers and Model Lifecycle Domain

**Status**: Proposed / Draft v1 — NOT implemented (nothing in this domain has shipped)
**Date**: 2026-07-21
**Repo**: `github.com/DreamLab-AI/agentbox`
**Bounded Context**: Learning Consumers & Model Lifecycle (the materialisation, distillation, evaluation, migration, and mining layer over DDD-016's honest producer/store)
**Related**: [PRD-020](../prd/PRD-020-ruvector-learning-consumers-and-corpus-uplift.md) (product goals, corpus-uplift programme, measurable acceptance), [ADR-040](../adr/ADR-040-learning-consumers-model-lifecycle-and-legacy-mining.md) (the v2 decisions with alternatives and rejections; fires ADR-036's `review_trigger`), [DDD-016](./DDD-016-memory-learning-domain.md) (Memory & Learning domain — the producer/store context this domain **extends, does not replace**), [PRD-018](../prd/PRD-018-ruvector-native-memory-and-learning.md) (the shipped v1 product spec), [ADR-036](../adr/ADR-036-ruvector-capability-adoption-and-learning-loop.md) (the eight v1 decisions D1–D8 whose ADOPT-LATER reservations this domain consumes), [PRD-001](../prd/PRD-001-capabilities-and-adapters.md) (capabilities and adapter slots — memory is one of five), [ADR-005](../adr/ADR-005-pluggable-adapter-architecture.md) (memory + events adapter slots, observability middleware, dispatch metrics), [ADR-008](../adr/ADR-008-privacy-filter-routing.md) (privacy redaction — fail-closed on the trajectory *and* mining paths), [ADR-012](../adr/ADR-012-jsonld-federation-grammar.md) (JSON-LD encoder — opt-in per surface), [ADR-013](../adr/ADR-013-canonical-uri-grammar.md) (canonical URI grammar; every identity minted via `management-api/lib/uris.js` under an existing kind), [ADR-015](../adr/ADR-015-mcp-ruvector-mandate.md) *and its 2026-07-04 amendment* (MCP-ruvector mandate; embedding pipeline is Xinference `bge-small-en-v1.5`, 384-dim), [DDD-005](./DDD-005-code-execution-domain.md) (the `DistilledLesson` / `ExecutionTrace` memory-and-events precedent both domains extend), [DDD-003](./DDD-003-sovereign-messaging-domain.md) (owner identity `did:nostr`, consumed not owned), [DDD-004](./DDD-004-linked-data-interchange-domain.md) (linked-data interchange), [DDD-015](./DDD-015-project-tracking-domain.md) (sibling additive-substrate precedent). Ground truth: [`docs/ruvector-system-reference.md`](../../ruvector-system-reference.md) (seven-agent audit, 2026-07-04; live-state re-verification 2026-07-21).

---

## TL;DR for newcomers

*Skip if you already know that DDD-016 wired an honest **producer** but left the **consumers** severed.*

DDD-016 shipped on 2026-07-05 and did exactly what it promised: it made the RuVector sidecar record **real** `(state, action, outcome, duration)` tuples into the two purpose-built tables that had sat empty. As of 2026-07-21 that producer is live and honest — **405 trajectories / 8,806 steps, every one judged** (386 success, 19 failed, 0 unjudged). What DDD-016 did **not** ship is the other half of the loop: the wire from that clean corpus to anything that consumes it. The `memory-learning-aggregates` namespace holds **0 rows** — a repo-wide grep finds no implementation of the Wilson-bound aggregator ADR-036 D1 specified. The `patterns` table holds **10 hand-written 3DGS recipes from March**, none distilled. `feed_retrieval`, `feed_routing`, `sona_enabled`, `relevance_feedback` are all correctly `false`, because there is nothing yet to consume. The recall-regression harness that DDD-016 §12 named as the precondition for touching retrieval geometry **still does not exist**.

This domain owns that missing consumer-and-lifecycle layer. It is the **materialisation** of effectiveness (the aggregation run that closes the severed wire), the **distillation** of trajectories into retrievable patterns, the **gate** that every geometry change must pass (the recall harness), the **model lifecycle** by which the 384-dim embedding contract itself could change under evidence (a parallel-column migration evaluating `bge-m3` and `bge-large-en-v1.5`, both already reachable or a single Xinference load away), and the **honest mining** of the 2.01M-row cold archive for *structural shape only* — never for the outcome labels it degenerately holds. It also re-opens, deliberately, one capability DDD-016's parent ADR skipped on a since-corrected premise: the extension's already-persisted Cypher/SPARQL graph engine as an optional ontology backbone. Everything here is additive, manifest-gated, default-off, and — for anything that moves a retrieved result — held behind a harness that does not yet exist and must be built first.

**If you remember only one thing:** this domain adds **no new adapter slot, no new port-slot, and no new URN kind**. Consumers and lifecycle receipts ride the same **memory** and **events** slots DDD-016's producers already use; run receipts are `activity` kind, distilled/mined records are `memory` kind, all minted via `uris.js`. Two hard laws govern everything new. **First**, no change to retrieval geometry — SONA, attention re-rank, relevance feedback, an embedding-model cutover, or a graph-augmented `orient` — ever ships until a `RecallHarnessRun` proves non-regression against the frozen baseline (self-recall@10 188/200, true-recall@10 119/120) — **I14**. **Second**, the 2,014,173-row legacy archive supplies candidate **shape** only, never an outcome: a mined candidate is inert — visible for audit, invisible to every retrieval consumer — until real, graded, post-2026-07-05 trajectories independently corroborate it, at which point its provenance is *appended to*, never overwritten (**I15**, **I16**). The constant `true` that DDD-016 outlawed at the write boundary (I04) is outlawed one layer deeper here: **frequency is not effectiveness, and a proxy label never earns a promotion**.

For the deep version, keep reading.

---

## 1. Domain Purpose

DDD-016 owns the *truth of what happened* — a durable semantic memory and an honest record of the system's own actions. This domain owns the *consequences of that truth*: turning the recorded corpus into signal, deciding whether the substrate that stores it should change, and honestly reclaiming what value the pre-honesty archive still holds.

Three things separate this from a batch of scripts bolted onto DDD-016. First, **materialisation is a first-class process, not a side effect**. The severed wire ADR-036 D1 specified but never implemented is not repaired by a hidden `cron` line; it is an `EffectivenessAggregation` run — a PROV-O activity receipt with a cursor, a delta, a sample-floor crossing count, and a durable identity — so "did the aggregation run, over what, and what did it change" is inspectable state, exactly as "what did the system do" is inspectable state in DDD-016. Second, **evaluation gates behaviour, not the other way round**. A `RecallHarnessRun` is the artefact that authorises a geometry change; nothing in this domain that alters what a query returns is permitted to enable itself. This is the mechanism DDD-016 §12 open question 1 asked for by name. Third, **honesty is preserved by construction across two new failure surfaces the v1 domain did not face**: the temptation to read the corrupt archive as an effectiveness signal (I15), and the temptation to let a candidate model or a mined recipe influence retrieval before it has earned it (I16, I17, I18).

Nothing in this domain trains a gradient model of its own, opens a new datastore, issues raw SQL, mints a new URN kind, or federates to the nostr mesh. The aggregation and distillation are simple, inspectable, incremental sweeps. SONA, attention re-rank, and the parameter-tuning module are consumed as gated extension surfaces behind the harness, not re-implemented. The embedding-model migration is a parallel-column mechanic that never touches the live 384-dim column until a harness A/B authorises cutover. The legacy mining runs offline, read-only, in a throwaway container that is never the live sidecar.

This domain re-opens exactly one decision ADR-036 recorded as closed: **D8's SKIP of graph aggregates**. That SKIP was correct for the GNN module (still substrate-less — array-in, array-out, no persistence). It was, on the 2026-07-04 audit's own conflation, applied by mistake to a *different* capability the extension also ships: an installed, persisted, queryable Cypher/SPARQL property-graph engine backing the near-empty `_ruvector_graphs`/`_ruvector_nodes`/`_ruvector_edges` tables (1/13/17 rows). Re-opening that — as the "ninth capability-adoption decision" ADR-036's `review_trigger` names — is this domain's remit; the GNN SKIP stands, un-revisited. ADR-040 carries the verdict re-statement; this DDD carries the domain model for it.

---

## 2. Bounded Context Definition

This domain is the **consumer and lifecycle** half of the same Memory & Learning bounded context DDD-016 opened. It does not fork the context, mint a parallel store, or duplicate an aggregate. It reads DDD-016's producer output, materialises DDD-016's under-specified `EffectivenessAggregate` record via a process DDD-016 named but never built, adds new distilled/candidate/mined record types on the *existing* slots, and governs the one contract DDD-016 fixed that this domain is allowed to change under evidence — the embedding model.

The precise split — the load-bearing statement of this document:

**DDD-016 keeps (unchanged, still law):**

| Concern | Owner |
|---|---|
| `MemoryEntry` aggregate — content-addressed identity, typed metadata, embedding contract | **DDD-016** |
| `Trajectory` / `TrajectoryStep` — the honest **producer** recording `(state, action, outcome, duration)` | **DDD-016** |
| `EffectivenessAggregate` — the *record shape* (Wilson lower bound + recency decay, memory-slot, `memory-learning-aggregates` namespace) | **DDD-016** (record) |
| `OrientSnapshot` read-model — the OODA cold-start bundle | **DDD-016** |
| `OutcomeLabel`, `ImportanceScore` value objects and their honesty rules | **DDD-016** |
| The single governed MCP writer, `PROTECTED_NAMESPACES`, **I-GOV** | **DDD-016** |
| The embedding-pipeline *rule* — every durable write embeds through `EmbeddingPort` (**I03**) | **DDD-016** |
| Data hygiene ops (`repair-namespaces`, `backfill-embeddings`, `archive-legacy`) | **DDD-016** |
| Invariants **I01–I13** and **I-GOV** | **DDD-016** |

**DDD-018 owns (new):**

| Concern | Owner |
|---|---|
| `EffectivenessAggregation` **run** — the materialisation *process* that produces `EffectivenessAggregate` records (closes ADR-036 D1's severed wire) | **DDD-018** |
| Activation of the **consumers** DDD-016 reserved: `feed_retrieval`, `feed_routing`, SONA apply, attention re-rank, the parameter-tuning module | **DDD-018** |
| `DistilledPattern` — trajectory-cluster → retrievable pattern, with a provenance tier | **DDD-018** |
| `RecallHarnessRun` — the fixed-query recall-regression suite and its PASS/FAIL verdict; **the gate for every geometry change** | **DDD-018** |
| `EmbeddingModelCandidate` / `EmbeddingMigration` — the dual-column model lifecycle by which **I03's model** may change under evidence, without weakening I03 | **DDD-018** |
| `MiningRun` / `MinedCandidate` — offline, provenance-marked, inert-until-corroborated legacy structural mining | **DDD-018** |
| The optional **ontology-backbone** graph substrate (re-opening ADR-036 D8's graph question, not its GNN SKIP) | **DDD-018** |
| Invariants **I14+** | **DDD-018** |

**The one boundary that needs stating carefully.** DDD-016 **I03** fixes the durable-write embedding pipeline at Xinference `bge-small-en-v1.5`, 384-dim. This domain's embedding-model lifecycle (§4.4) re-opens precisely that. It does **not** weaken I03. I03 says *every durable write is embedded through the port before persist, never raw-SQL-inserted*; that rule is untouched. What DDD-018 adds is **I17**, which governs *how the model behind the port may change*: additively, through a parallel column that never mutates the 384-dim column, with dual-write and a harness A/B before any cutover, and cutover itself behind a manifest selector defaulting to today's column. I03 governs *that a write is embedded*; I17 governs *which model embeds it and how that changes*. The two compose; neither is relaxed.

**Owns (IN):** the aggregation-run and distillation processes; the consumer activations; the recall harness and its verdicts; the embedding-model candidate evaluation and migration mechanics; the legacy mining pipeline and its candidate records; the ontology-backbone graph substrate and its traversal-augmented retrieval; invariants I14+.

**Does not own (OUT):**

- **The producer.** `Trajectory`/`TrajectoryStep` recording, `OutcomeLabel` grading, and the four failure modes DDD-016 refutes remain DDD-016's. This domain only *reads* the corpus they produce; it never records a trajectory step and never re-grades an outcome.
- **The `EffectivenessAggregate` record shape and its consumer contracts.** DDD-016 defines the Wilson-bound record and that `feed_retrieval`/`feed_routing` are advisory, fail-open, never a hard gate (I06). DDD-018 owns the *run that writes those records* and the *act of turning the gates on*, not the record's definition.
- **The embedding model itself.** Xinference remains an external inference dependency reached through `EmbeddingPort`. DDD-018 owns the *rule for changing which model the port serves*, never the model's weights, serving infrastructure, or sparse/ColBERT internals (explicitly deferred — §10).
- **The ontology corpus.** The DreamLab knowledge graph (5,975 OWL classes; `urn:ngm:class:*`) is owned by the ontology domain and consumed here as class identifiers, verbatim. This domain mints no ontology URN and asserts no class axiom (§11).
- **Raw SQL, new stores, new slots, new kinds, gradient training, nostr federation.** As DDD-016. Every new record rides memory or events; every identity is minted via `uris.js` under an existing kind.

The context map to adjacent domains — and the precise Shared-Kernel relationship with DDD-016 — is drawn in §11.

---

## 3. Ubiquitous Language

| Term | Definition |
|---|---|
| **EffectivenessAggregation (run)** | The aggregate root of the materialisation subdomain: one execution of the Wilson-lower-bound + recency-decay sweep over the *delta* of `trajectory_steps` accrued since the last run's cursor. Produces / updates `EffectivenessAggregate` records (the DDD-016 record) in `memory-learning-aggregates`. A PROV-O activity receipt: `urn:agentbox:activity:<scope>:sha256-12-<hash>`, payload `type: 'aggregation-run'`, on the **events** slot. Incremental (rowid cursor), non-destructive (only inserts/upserts into the target namespace), `quick_check`-gated — safe to call on every scheduled tick (I19–I21). It is the sole writer of `EffectivenessAggregate` rows; every consumer is a pure reader. This is the process ADR-036 D1 specified in prose and never implemented. |
| **EffectivenessAggregate** | *DDD-016's record*, referenced here as the aggregation run's output. Unchanged: per-action-pattern Wilson lower-bound success rate with recency half-life decay, plus sample count; influences retrieval/routing only past `aggregate_min_samples` (default 20) — I06. DDD-018 makes it *exist*; it does not redefine it. |
| **DistilledPattern** | The aggregate root of the distillation subdomain: one retrievable pattern distilled from a cluster of `trajectory_steps` (or, for proxy tiers, from structural/legacy shape). Carries the ADR-076 four-field body (`summary`/`detail`/`labels`/`paths`, serialised labels-and-paths-first), a real Xinference embedding, a **provenance tier**, a support/sample count, and — for judge-tier — a Wilson-bound quality. Identity `urn:agentbox:memory:<scope>:pattern-<sha256-12>`, **memory** slot; natural physical home is the existing (currently 10-row, hand-written) `patterns` table, an open target question (§12). The ReasoningBank "judge → distil → quality-weighted retrieval" shape, made honest by the provenance tier. |
| **ProvenanceTier** | A value object on every `DistilledPattern` and `MinedCandidate`: one of `judge:trajectory` (derived from the real, judged 405-trajectory corpus — **promotable**), `proxy:structural` (co-occurrence / frequency with no graded outcome — **inert**), or `proxy:legacy-mining` (from the pre-honesty archive — **inert**). Only `judge:trajectory` may enter a `feed_retrieval` promoted set (I18). Directly reuses ruflo ADR-171's "proxy never promotes" discipline; it is the `patterns`-table-level spelling-out of DDD-016 I04. |
| **RecallHarnessRun** | The aggregate root of the evaluation subdomain: one execution of the fixed-query recall-regression suite against a named retrieval configuration, yielding a PASS/FAIL **verdict**. Records the frozen baseline (self-recall@10 188/200, true-recall@10 119/120), the versioned query-set fixture hash, the measured self-/true-recall@10, the per-namespace breakdown, the exact-token hybrid-vs-pure delta, the median-of-3 result, and which geometry change it gates. A measurement receipt: `urn:agentbox:activity:<scope>:sha256-12-<hash>`, payload `type: 'recall-harness-run'`, **events** slot. Runnable as `agentbox.sh ruvector recall`. **The** gate named by I14. |
| **QuerySetFixture** | The versioned, checked-in fixed query set the harness runs: a self-recall@10 set (200 queries, namespace-stratified, the dominant `ruvnet-kb` corpus capped at ~40%), a true-recall@10 set (120 queries vs a forced exact scan), and an exact-token class (~20–30 literal-token queries — error codes, `CUDA_ARCH`, filenames — the class most likely to regress under a learned re-rank). Built once, never regenerated per run, so measurements are comparable over time. |
| **EmbeddingModelCandidate** | A value object naming one candidate embedding model under evaluation: its identifier, dimension, Xinference availability, and the honest quality reading against this corpus. The live registry: `bge-small-en-v1.5` (384-dim, current); `bge-m3` (1024-dim, **already served, unused** — cheapest to try, *not* the presumed quality winner); `bge-large-en-v1.5` (1024-dim, new Xinference load — the strongest corpus-analogous quality evidence available); `bge-base-en-v1.5` (768-dim, secondary). |
| **EmbeddingMigration** | The aggregate root of the model-lifecycle subdomain: one governed traversal of the parallel-column lifecycle for a chosen `EmbeddingModelCandidate` — `proposed → parallel-column-added → dual-write → backfilled → harness-A/B → cutover → (rollback)`. A PROV-O activity receipt: `urn:agentbox:activity:<scope>:sha256-12-<hash>`, payload `type: 'embedding-migration'`, **events** slot. Never mutates the live 384-dim column, its data, or its index at any step; rollback is a selector flip (I17). |
| **MiningRun** | The aggregate root of the legacy-mining subdomain: one execution of the offline, read-only structural mining pass over the 11G cold archive (`archive-legacy-20260705T101743Z.copy.gz` / snapshot volume `ruvector_pg_snap_archive_20260705T101743Z`, 2,014,173 rows) inside a **throwaway** container that is never the live sidecar. Records the restore method, the row-count verification (== 2,014,173), the extraction query set, the redaction outcome, the candidates emitted, and the container teardown. Identity `urn:agentbox:activity:<scope>:sha256-12-<hash>`, payload `type: 'mining-run'`, **events** slot (I23). |
| **MinedCandidate** | A provenance-marked structural candidate emitted by a `MiningRun`: `command-recipe` \| `error-resolution` \| `file-cooccurrence` \| `namespace-timeline`. Rides the **memory** slot in the dedicated, protected namespace `legacy-mined-candidates`; identity `urn:agentbox:memory:<scope>:mined-<sha256-12>`. Carries `provenance = proxy:legacy-mining`, `confidence_prior = LOW` (fixed, non-negotiable), `support_count` (raw frequency, **never a rate**), `validated = false`, `corroboration_count = 0`. Inert — nothing reads it at retrieval time — until it graduates (§9.3). |
| **OntologyBackbone** | The optional (ADOPT-LATER, reserved) graph substrate: one named graph `agentbox-ontology-backbone` in the extension's already-persisted Cypher/SPARQL engine (`_ruvector_graphs`/`_nodes`/`_edges`), linking `MemoryEntry` nodes to `OntologyClass` nodes by `about` edges, enabling GraphRAG-style traversal alongside vector similarity. Node identity carries the *existing* `urn:agentbox:memory:*` / `urn:ngm:class:*` verbatim in node properties — no new URN kind (I11 preserved). |
| **GeometryChange** | Any behaviour that alters what a query returns or in what order: enabling `feed_retrieval`, applying SONA to the query embedding, attention re-rank, relevance-feedback parameter tuning, cutting over to a new embedding column, or adding a graph-traversal section to `orient`. Every `GeometryChange` is gated behind a passing `RecallHarnessRun` (I14). |

---

## 4. Aggregates

### 4.1 EffectivenessAggregation (Root — the run)

The consistency boundary of the materialisation subdomain: one scheduled sweep that reads the honest trajectory corpus and writes distilled effectiveness. It is the process ADR-036 D1 described and DDD-016 assumed, that a repo-wide grep confirms was never built (`memory-learning-aggregates` = 0 rows on 2026-07-21).

**Identity**: `urn:agentbox:activity:<scope>:sha256-12-<hash>` — minted via `uris.js` against the `activity` kind (a run is a lifecycle/process receipt, exactly like a `Trajectory`); `aggregation-run` semantics travel in the payload, never the local part. **Events** slot.

**Fields**: `runUrn`, `ownerDid`, `cursorBefore` / `cursorAfter` (the `max(trajectory_steps.id)` high-water-mark processed, stored as ordinary `memory_store` metadata — the shared cursor mechanism of I21), `stepsProcessed`, `aggregatesWritten`, `aggregatesCrossingFloor` (first to reach `aggregate_min_samples` this run), `startedAt`, `endedAt`, `status`.

**Execution surface (the decision, deferred to ADR-040 D1 but modelled here)**: a **supervisord cron sweep** at a 30-minute default cadence (`aggregate_sweep_interval_mins`), *not* a post-task hook extension and *not* an on-demand `memory_orient` computation. Rationale is recorded in ADR-040; the domain consequence is I19–I21. The Wilson-bound mathematics is unchanged from ADR-036 D1's existing prose; only the *execution surface* (a scheduled, cursored, non-destructive sweep) is new.

**Lifecycle**:

```
Scheduled tick → quick_check gate → read Δ(trajectory_steps) since cursor
      │ (corpus healthy, delta non-empty)
      ▼
  compute Wilson lower bound + recency decay per action-pattern over Δ
      ▼
  upsert EffectivenessAggregate rows via governed memory_store (I03, never raw SQL)
      ▼
  advance cursor; emit run receipt on events slot
      │
      └─ delta empty / quick_check fails → skip, advance nothing (non-destructive)
```

**Invariants**: **I19** (sole producer), **I20** (reads the trajectory source of truth, never a derived projection), **I21** (incremental / non-destructive / `quick_check`-gated), plus DDD-016 **I01**, **I03**, **I06** (the record it writes is inert below the sample floor).

### 4.2 DistilledPattern (Root — memory-backed)

The consistency boundary of the distillation subdomain: one retrievable pattern, embedded and searchable like any `MemoryEntry`, carrying an explicit provenance tier that decides whether it may influence retrieval.

**Identity**: `urn:agentbox:memory:<scope>:pattern-<sha256-12>` — minted via `uris.js` against the `memory` kind (a distilled lesson sibling of DDD-005's `DistilledLesson` and DDD-016's `EffectivenessAggregate`). **Memory** slot.

**Fields**:

| Field | Type | Notes |
|---|---|---|
| `patternUrn` | `urn:agentbox:memory:…` | Canonical identity via `uris.js` (I01). |
| `patternText` | `string` | ADR-076 four-field body: `summary` / `detail` / `labels` / `paths`, serialised labels-and-paths-first (the measured +41.8% MRR ordering). |
| `embedding` | `vector(384)` | Real Xinference vector; never null on a durable write (I03). During an active embedding migration, a parallel `embedding_m3`/`_large` may co-exist (§4.4) — the 384-dim value remains the durable-write invariant. |
| `provenance` | `ProvenanceTier` | `judge:trajectory` (promotable) \| `proxy:structural` \| `proxy:legacy-mining` (both inert) — I18. |
| `supportCount` | `int` | Contributing step/observation count. A count, never presented as a rate. |
| `quality` | `float?` | Wilson-bound quality — **present only for `judge:trajectory`**; absent (not zero) for proxy tiers, which have no graded outcome. |
| `corroborationCount` | `int` | Independent live-graded corroborations (drives graduation for proxy tiers — I16). |
| `promoted` | `bool` | Whether it is in the `feed_retrieval` promoted set. Only ever `true` for `judge:trajectory` (I18). |

**Production**: a scheduled distillation sweep, sharing the I21 cursor mechanism with §4.1, clusters `trajectory_steps` by action-pattern similarity, computes a deterministic (no-LLM, `$0`-by-default) four-field summary per cluster, embeds it through the existing Xinference pipeline, and writes it via the governed `memory_store`. Judge-tier by construction (the source is the already-judged corpus). Proxy-tier `DistilledPattern`s arise only from the mining path (§4.5) and stay inert.

**Lifecycle**:

```
cluster judged trajectory_steps → distil 4-field body → embed → store (judge:trajectory, promotable)
proxy-tier (from MiningRun) ─────────────────────────────────────────► store (inert until corroborated, I16)
contradicted by a later live-graded trajectory (same context, opposite outcome) → suppressed, not merged (I16)
```

**Invariants**: DDD-016 **I01**, **I03**; **I18** (provenance tier); **I16** (proxy tiers inert until corroborated). Inherits I06's sample-floor discipline for any effectiveness-derived quality.

### 4.3 RecallHarnessRun (Root — the gate)

The consistency boundary of the evaluation subdomain: one measurement that authorises — or refuses — a `GeometryChange`. It is the artefact DDD-016 §12 open question 1 asked for and ADR-036's `review_trigger` names. It does not exist yet; building it (W-B) is the first, unconditional deliverable of the v2 programme, because every other consumer in this domain is gated behind it.

**Identity**: `urn:agentbox:activity:<scope>:sha256-12-<hash>` — `activity` kind, payload `type: 'recall-harness-run'`. **Events** slot (a measurement receipt, sibling to a `ProjectScan`).

**Fields**: `runUrn`, `ownerDid`, `fixtureHash` (the versioned `QuerySetFixture`), `config` (the retrieval configuration under test — which flag/candidate/column), `baseline` (`{selfRecall: 188/200, trueRecall: 119/120}`, frozen), `selfRecallAt10`, `trueRecallAt10`, `perNamespaceBreakdown` (surfaced, not gated — catches a regression localised to one namespace a corpus-wide average would hide), `exactTokenHybridDelta` (must be ≥ 0), `medianOfRuns` (3, to filter HNSW entry-point jitter), `verdict` (`PASS` \| `FAIL`).

**Pass band** (a *no-regression* gate with a small absorption band for HNSW non-determinism, not an exact-match gate): `PASS` iff **self-recall@10 ≥ 187/200** *and* **true-recall@10 ≥ 118/120** (each the median of 3 runs) *and* **exact-token hybrid-vs-pure delta ≥ 0**. Any weaker result is `FAIL` and blocks the flag it gates.

**Where it lives**: `agentbox.sh ruvector recall` — a parameterised, fixed-fixture generalisation of the self-recall / true-recall SQL the sidecar-update flow already runs (`docs/ruvector-system-reference.md` §7), reusing the smoke/recall machinery, not a new subsystem. The extension's own `benches/index_bench.rs` ("HNSW build time 10K/100K/1M") is a candidate to adapt for the index-build half.

**Invariants**: **I14** (its verdict is the sole authoriser of a `GeometryChange`). Read-derived, but durably recorded as a receipt so a promotion's evidence is auditable, not ephemeral.

### 4.4 EmbeddingModelCandidate and EmbeddingMigration (model lifecycle)

The consistency boundary of the model-lifecycle subdomain: the mechanics by which the model behind DDD-016 I03 may change on evidence, additively, without ever weakening I03.

**EmbeddingModelCandidate** is a value object; the live evaluation registry, with the *honest* corpus-analogous reading (the corrected clinical-QA benchmark, read in full, names `bge-large` as the standout, not `bge-m3` — the PRD commits to evaluating, not to a pre-chosen winner):

| Candidate | Dim | Already served? | Honest reading for this corpus |
|---|---|---|---|
| `bge-small-en-v1.5` | 384 | Yes (current) | Baseline. The frozen recall reference. |
| `bge-m3` (dense) | 1024 | **Yes — zero new infra** | Cheapest to try (a pure `ADD COLUMN` + `CREATE INDEX CONCURRENTLY`); **second-weakest of four BGE variants** on the one domain-analogous benchmark. Evaluate as the "free experiment," not the presumed winner. |
| `bge-large-en-v1.5` | 1024 | No (new Xinference load) | **Strongest quality evidence available** (+2.61pp MTEB retrieval-avg over small; the clinical-QA benchmark's own named standout). Evaluate in the *same harness pass* as `bge-m3`, not held back as a fallback. |
| `bge-base-en-v1.5` | 768 | No | Secondary — beat `bge-m3` on the same benchmark at a smaller size; has a documented query-prefix trick (+0.009 nDCG@10). Middle storage/latency ground (2×, not 2.66×). |

**EmbeddingMigration** is the aggregate: one governed lifecycle for a chosen candidate.

**Identity**: `urn:agentbox:activity:<scope>:sha256-12-<hash>` — `activity` kind, payload `type: 'embedding-migration'`. **Events** slot.

**Lifecycle** (each step mapped to an existing gated-ops pattern, additive throughout):

```
proposed
  → parallel-column-added   ALTER TABLE memory_entries ADD COLUMN embedding_m3 ruvector(1024);   (additive, no lock)
                            CREATE INDEX CONCURRENTLY … USING ruhnsw (embedding_m3 …);           (non-locking)
  → dual-write              governed write embeds via both models, gated [integrations.ruvector_external].embedding_dual_write = false
                            (async/queued if the Xinference latency pre-check shows CPU-bound calls)
  → backfilled              backfill-embedding-m3 subcommand (dry-run default, [memory_hygiene]-gated), pg_dump first
  → harness-A/B             RecallHarnessRun against embedding_m3 vs the frozen 384-dim baseline — THE gate (I14, I17)
  → cutover                 flip embedding_active_column = "embedding" | "embedding_m3" (default "embedding")
  → (rollback)              flip the selector back — the 384-dim column/data/index were never touched
```

**Pre-checks the domain requires before code is written** (recorded so the evaluation is evidence-based, not analogy-based): (a) a five-minute Xinference latency check timing 100 real `/v1/embeddings` calls against `bge-m3` **and** `bge-small-en-v1.5` on the same host — the one number no published source provides, deciding synchronous-vs-queued dual-write; (b) a sample HNSW build at 10–20K rows under both the extension's own Medium-bracket `(16, 128)` preset and the heavier `(32, 200)`, timing and recall-checking both. Storage cost is real and linear (2.66× per row at 1024-dim; +≈1.3 GiB combined for the parallel column+index at current row count) — affordable now, a forward cost at 1–10M rows, with `sq8`/`pq16` quantization available as a mitigation lever.

**Invariants**: **I17** (dual-write and harness-A/B before cutover; the 384-dim column never mutated; rollback is a flag flip), **I14** (the A/B is a `RecallHarnessRun`), **I22** (no logical scope — a SONA `table_name`, a distillation cluster — spans two dimensions), plus additive-only (house law #1) and I03 (the 384-dim durable write remains embedded through the port throughout).

### 4.5 MiningRun and MinedCandidate (legacy structural mining)

The consistency boundary of the legacy-mining subdomain: reclaiming *structural shape* from the pre-honesty archive without ever reading its corrupt outcome signal.

**MiningRun** — the process aggregate. **Identity**: `urn:agentbox:activity:<scope>:sha256-12-<hash>`, `activity` kind, payload `type: 'mining-run'`, **events** slot.

**Fields**: `runUrn`, `ownerDid`, `archiveRef` (`archive-legacy-20260705T101743Z.copy.gz`), `restoreMethod` (`logical` \| `physical-snapshot`), `rowCountVerified` (must == 2,014,173), `extractionQueries[]`, `redactionOutcome` (`{secretsRedacted, injectionDropped, unredactableDropped}`), `candidatesEmitted`, `containerTornDown` (bool), `startedAt` / `endedAt`.

**MinedCandidate** — the record aggregate, riding the memory slot. **Identity**: `urn:agentbox:memory:<scope>:mined-<sha256-12>`, `memory` kind. Namespace `legacy-mined-candidates` (added to `PROTECTED_NAMESPACES`).

**Fields**: `candidateUrn`, `patternType` (`command-recipe`\|`error-resolution`\|`file-cooccurrence`\|`namespace-timeline`), `patternText` (ADR-076 four-field, post-redaction), `provenance = proxy:legacy-mining` (with `archiveRef`, `minedAt`, `extractionQueryId`), `supportCount` (raw n-gram frequency — **never a rate, never a duration, never an outcome**), `confidencePrior = LOW` (fixed), `validated = false`, `corroborationCount = 0`.

**What may honestly be mined** (all zero-dependency on the corrupt outcome/duration fields): command-sequence recipes (time-gap-bucketed n-grams, ubiquity-filtered), error-signature → resolution pairs (**conditional** — presence of real stderr text is unverified until the archive is opened; may share the same templating pathology that zeroed `duration`), tool/file co-occurrence maps (most robust — path/tool tokens survive outcome degeneracy), namespace activity timelines (trivial, a scoping tool). Distillation reuses the ADR-076 four-field schema; extraction is rule-based, no LLM.

**Lifecycle**:

```
throwaway restore (Option A logical \copy / Option B physical snapshot mount) → verify 2,014,173 rows
  → read-only SELECT extraction (§9.1) → REDACTION (secrets + injection, fail-closed, before any text leaves the container)
  → distil (4-field) → CANDIDATE (provenance:legacy-mining, confidence:LOW, validated:false)
  → governed memory_store into legacy-mined-candidates  (INERT)
  → docker rm -v the throwaway container+volume
  ─────────────────────────────────────────────────────────────────
  graduation (§9.3): N ≥ aggregate_min_samples live-graded corroborations → promote to DistilledPattern (judge:trajectory)
                     provenance APPENDED (never overwritten); confidence REPLACED by real Wilson bound (never blended)
  non-graduating: garbage-collect after a retention window (e.g. 90 days) with zero corroborations
```

**Invariants**: **I15** (never feeds effectiveness), **I16** (inert until corroborated; provenance appended, confidence replaced), **I18** (proxy tier), **I23** (throwaway isolation; fail-closed redaction before the container boundary). Inherits DDD-016 I04's honesty at one layer deeper: `confidence_prior` is set unconditionally to `LOW`, ignoring any support-count-derived number.

---

## 5. Value Objects and Domain Rules (cross-aggregate)

Continuing DDD-016's R01–R07:

- **R08** (materialisation-is-a-process): the wire from producer to consumer is a first-class, cursored, receipted **run** (§4.1), never an inline hook side effect and never a lazy read-time computation. The Wilson-bound maths is DDD-016's; the *execution surface* is this domain's (I19–I21).
- **R09** (the harness is the gate, always): every `GeometryChange` is authorised by a passing `RecallHarnessRun` and by nothing else — not a reviewer's judgement, not a plausibility argument, not a benchmark analogue from another corpus (I14). The harness is built first, before any consumer it gates.
- **R10** (frequency is not effectiveness): a raw support count — from n-gram mining or structural co-occurrence — is a *frequency heuristic*, never a quality or effectiveness estimate. Proxy-tier records carry `confidence_prior = LOW` and stay inert; only real, graded outcomes earn a Wilson-bound quality and a promotion (I15, I16, I18).
- **R11** (change the model additively): the embedding model behind I03 may change only through a parallel column that never mutates the live column, with dual-write and a harness A/B before cutover, cutover behind a manifest selector defaulting to today's column (I17). The migration is reversible by a flag, not a restore.
- **R12** (isolate the archive): all legacy mining runs offline, read-only, in a throwaway container that is never the live sidecar, never `agentbox.toml`/compose-registered, and never network-attached; redaction is fail-closed and completes before any extracted text crosses the container boundary (I23).
- **R13** (provenance is append-only): a record's provenance is only ever *appended to*; a candidate that graduates gains `+live-corroboration` and the corroborating trajectory URNs — the audit trail must always show it started as an unvalidated structural guess (I16).
- **R14** (every consumer self-gates, default-off, behaviour-preserving): each new capability — the aggregation run, each consumer, the harness, the migration, the mining, the ontology backbone — has its own manifest flag; the default state equals today's live behaviour (producer on, all consumers off). No coarse master switch (continuing DDD-016 R06 / I13).

New invariants (continuing DDD-016 I01–I13, I-GOV):

- **I14** (geometry-change-requires-harness-pass): no `GeometryChange` is enabled until a `RecallHarnessRun` returns `PASS` against the frozen baseline (self-recall@10 ≥ 187/200 **and** true-recall@10 ≥ 118/120, median of 3, exact-token hybrid delta ≥ 0). The `QuerySetFixture` is versioned and checked in, never regenerated per run. This is the literal mechanism DDD-016 §12 open question 1 names.
- **I15** (mined-candidates-never-feed-effectiveness): a `MinedCandidate` (or any `proxy:legacy-mining` record) never contributes to an `EffectivenessAggregate`, an `EffectivenessAggregation` run's input, or a `feed_retrieval`/`feed_routing` promoted set. The legacy corpus supplies candidate *shape* only. This is DDD-016 **I04** (OutcomeLabel honesty) extended to the mining path — the exact failure mode upstream ruflo hit (issue #1686) and fixed by moving learning off the corrupt substrate (ADR-093).
- **I16** (candidate-inert-until-corroborated): a `MinedCandidate` and any `proxy:*` `DistilledPattern` is inert — visible for audit, invisible to every retrieval consumer — until independently corroborated N ≥ `aggregate_min_samples` times by real, graded, post-2026-07-05 trajectories whose Wilson lower bound clears the `feed_retrieval` bar. On graduation its provenance is **appended** (never overwritten) and its confidence **replaced** by the real Wilson bound (never blended). A later contradicting live-graded trajectory (same context, opposite outcome) **suppresses** the candidate; it is never merged.
- **I17** (migration-dual-write-before-cutover): an `EmbeddingMigration` may not cut retrieval over to a new embedding column until (a) the parallel column is fully backfilled, (b) dual-write has been live for the parallel period, and (c) a `RecallHarnessRun` A/B on the new column/index returns `PASS`. The original 384-dim column, its data, and its index are never mutated during the lifecycle; cutover and rollback are both a manifest selector flip. This specialises I14 to the model-change case and preserves house-law additivity and DDD-016 I03.
- **I18** (provenance-tier law): every `DistilledPattern` and `MinedCandidate` carries a `ProvenanceTier`; only `judge:trajectory` — derived from the real, judged 405-trajectory corpus — is promotable into a `feed_retrieval` set. `proxy:structural` and `proxy:legacy-mining` are written for audit and stay inert. Reuses ruflo ADR-171's "proxy never promotes."
- **I19** (aggregation-run is sole producer, consumers are pure readers): the `EffectivenessAggregation` run is the *only* writer of `EffectivenessAggregate` rows. `memory_orient`, `feed_retrieval`, and `feed_routing` are pure readers of already-materialised aggregates — none may become a hidden writer (extends DDD-016 I12's read-model law to the aggregate producer split).
- **I20** (aggregation reads the source of truth): the aggregation and distillation runs read directly from `trajectory_steps`/`trajectories` — the tables `record_trajectories` actually writes — never a derived, cached, or substring-filtered projection with its own filter logic. This is the direct guard against ruflo's #1686 / the "four contradictory sources" fragmentation (extends I06).
- **I21** (incremental-non-destructive-sweep): the aggregation and distillation runs are incremental (a shared rowid cursor stored as ordinary `memory_store` metadata), non-destructive (they only insert/upsert into target namespaces, never mutate or delete source rows), and `quick_check`-gated (they skip rather than throw on a recovered/corrupt DB) — so they are safe to call unconditionally on every scheduled tick. Reuses ADR-174's `distill_state` cursor precedent for both sweeps.
- **I22** (scope-key dimension stability): no logical learning scope — a SONA `table_name`, a distillation cluster, an aggregation key — ever spans two embedding dimensions. A SONA engine keyed for 384-dim content is never reused for 1024-dim content during an embedding migration; the migration mints a fresh scope for the new dimension (connects W-C and W-D).
- **I23** (mining-isolation law): a `MiningRun` executes only in a throwaway container/volume, distinctly named (`mining-*`, never `ruvector_pg_snap_*` or any `agentbox.toml`-registered name), read-only (`SELECT` only), never network-attached to the compose stack; redaction (secrets and injection) is **fail-closed** and completes before any extracted text crosses the container boundary; an unredactable record is dropped, never persisted. Extends DDD-016 I10 (privacy fail-closed) from the trajectory write path to the mining path.

---

## 6. Domain Events (operator-visible)

Continuing DDD-016 §6's catalogue; all emitted through the ADR-005 observability middleware as plain domain projections, JSON-LD encoded only when `[linked_data]` is on.

| Event | Trigger | Key Payload Fields |
|---|---|---|
| `AggregationRunStarted` | A scheduled `EffectivenessAggregation` sweep begins | `run_urn`, `cursor_before`, `owner_did` (I19) |
| `AggregationRunCompleted` | A sweep finishes and advances its cursor | `run_urn`, `cursor_after`, `steps_processed`, `aggregates_written` (I21) |
| `AggregationRunSkipped` | `quick_check` failed or the delta was empty | `run_urn`, `reason` — cursor unchanged, non-destructive (I21) |
| `EffectivenessAggregated` | An `EffectivenessAggregate` is (re)computed and stored | `effectiveness_urn`, `action_pattern`, `wilson_lower`, `samples` (DDD-016 record, now actually written) |
| `EffectivenessBecameInfluential` | An aggregate first clears `aggregate_min_samples` | `effectiveness_urn`, `samples`, `threshold` (I06) |
| `PatternDistilled` | A `DistilledPattern` is embedded and stored | `pattern_urn`, `provenance`, `support_count`, `promoted` (I18) |
| `RecallHarnessRunCompleted` | The recall suite finishes against a configuration | `run_urn`, `config`, `self_recall`, `true_recall`, `exact_token_delta`, `verdict` (I14) |
| `GeometryChangeGated` | A consumer flag was refused because the harness has not passed | `flag`, `blocking_run_urn`, `reason: "harness-not-passed"` (I14, fail-closed) |
| `GeometryChangeEnabled` | A consumer flag flipped on after a passing harness run | `flag`, `authorising_run_urn` (I14) |
| `SonaBufferPressure` | SONA `trajectories_dropped` / `buffer_success_rate` crosses an alarm threshold | `table_name`, `dropped`, `buffer_success_rate` — surfaced, never auto-remediated (D4 read-only rule) |
| `EmbeddingMigrationAdvanced` | An `EmbeddingMigration` transitions lifecycle state | `migration_urn`, `candidate`, `from_state`, `to_state` (I17) |
| `EmbeddingMigrationCutover` | Retrieval cut over to a new embedding column after a passing A/B | `migration_urn`, `column`, `authorising_run_urn` (I17, I14) |
| `EmbeddingMigrationRolledBack` | The active-column selector was flipped back | `migration_urn`, `column: "embedding"` — 384-dim never mutated (I17) |
| `MiningRunCompleted` | A `MiningRun` extracts, redacts, emits candidates, and tears down | `run_urn`, `row_count_verified`, `candidates_emitted`, `container_torn_down` (I23) |
| `MiningRedactionDropped` | An extracted blob failed redaction and was discarded | `run_urn`, `reason: "secret" \| "injection" \| "unredactable"` — never persisted (I23) |
| `MinedCandidateStored` | A `MinedCandidate` lands inert in `legacy-mined-candidates` | `candidate_urn`, `pattern_type`, `support_count`, `confidence_prior: "LOW"` (I15, I16) |
| `MinedCandidateGraduated` | A candidate reached N live corroborations and became a judge-tier `DistilledPattern` | `candidate_urn`, `pattern_urn`, `corroborations`, `wilson_lower`, `provenance: "legacy-mining+live-corroboration"` (I16) |
| `MinedCandidateSuppressed` | A candidate was contradicted by a live-graded trajectory | `candidate_urn`, `reason: "contradicted"` — suppressed, not merged (I16) |
| `MinedCandidateExpired` | A non-corroborating candidate hit its retention window | `candidate_urn`, `age_days`, `corroborations: 0` |
| `OntologyBackboneLinked` | A `MemoryEntry` was linked to an `OntologyClass` by an `about` edge | `memory_urn`, `class_urn`, `confidence` (reserved; ADOPT-LATER) |

Where a tool runs inside the Claude-Code-spawned stdio MCP server (outside the management-api HTTP adapter), it emits the equivalent structured JSON log plus a metrics beacon, and the stdio↔HTTP reconciliation debt inherited from DDD-016 D2/D7 continues to be recorded, not paid.

---

## 7. Repository Interfaces (Ports)

Mapped to the two existing adapter slots — **no new slot** (I11 inherited). Ports reused from DDD-016 §7 are marked *(reused)*; the rest are new to this domain but mint no new slot.

| Port | Direction | Counterpart | Contract |
|---|---|---|---|
| **VectorMemoryPort** *(reused)* | Outbound (writes + reads) | RuVector, memory slot | Now also persists `DistilledPattern`, `MinedCandidate`, and the `EffectivenessAggregate` rows the aggregation run produces — all through the governed MCP `memory_store`, embedded (I03), URN via `uris.js` (I01). Never raw SQL. |
| **TrajectoryEventsPort** *(reused)* | Outbound (publish) | RuVector, events slot | Now also persists the run receipts (`aggregation-run`, `recall-harness-run`, `embedding-migration`, `mining-run`) as `activity` records. |
| **EmbeddingPort** *(reused, extended)* | Outbound (required) | Xinference | The ACL over the embedding model (§10). During a migration it serves the parallel candidate (`bge-m3`/`bge-large`) alongside `bge-small-en-v1.5`; the domain expresses only "durable writes are embedded" (I03) and "no scope spans two dimensions" (I22). Sparse/ColBERT modes are explicitly *not* crossed into the domain. |
| **ExtensionDiagnosticsPort** *(reused, extended)* | Outbound (read-only) | RuVector diagnostics | Gains a `sona_health` sibling wrapping `ruvector_sona_ewc_status`/`ruvector_sona_stats`, feeding `agentbox_adapter_health`. Read-only — `trajectories_dropped`/`buffer_success_rate` are surfaced and alarmed, never auto-remediated (D4 rule). |
| **EffectivenessFeedPort** *(reused, activated)* | Outbound (advisory) | Retrieval + routing | The `feed_retrieval` re-rank bonus and `feed_routing` `[INTELLIGENCE]` hints DDD-016 defined but left inert — now fed by a real corpus once the aggregation run produces one and the harness passes. Still advisory, still fail-open, never a hard gate (I06). |
| **AggregationSchedulePort** | Inbound (scheduled) | supervisord | Drives the `EffectivenessAggregation` and `DistilledPattern` sweeps on a 30-minute default tick. Incremental (shared cursor), non-destructive, `quick_check`-gated, `[memory_learning]`-flag-gated, dry-run-capable (I19–I21). |
| **RecallHarnessPort** | Outbound (measure) | `agentbox.sh ruvector recall` | Runs the fixed `QuerySetFixture` against a named configuration, produces a `RecallHarnessRun` verdict, and is the gate consulted before any `GeometryChange` flag flips (I14). Reuses the sidecar-update smoke/recall machinery. |
| **SonaTransformPort** | Outbound (gated) | `ruvector_sona_learn` / `ruvector_sona_apply` / `ruvector_sona_stats` / `ruvector_sona_ewc_status` | Applies the learned Micro-LoRA/EWC++ transform as a **pre-scoring transform on the query embedding** inside `memory_hybrid_search`/`memory_orient`, behind `sona_apply_enabled` (learning itself runs unconditionally behind the separate, retrieval-inert `sona_learn_enabled`). Fail-safe by construction (returns the input unchanged when no weights are learned — no application-level fallback needed). Fed by judged trajectories at one fixed global scope (`agentbox_memory`), not per-namespace (the 405-trajectory corpus is too thin to fragment). Gated by I14. |
| **AttentionRerankPort** | Outbound (gated) | `ruvector_attention_score` / `_scores` | A pure, stateless (`immutable, parallel_safe`) re-score — no corpus, no buffer, no warm-up. The **lowest-risk** consumer and the recommended *first* harness workload (it exercises the gate with the least confounding state). Gated by I14. |
| **ParameterTuningPort** | Outbound (gated) | `ruvector_enable_learning` / `ruvector_record_feedback` | The HNSW `ef_search`/`probes` auto-tuner — **not** a durable content-relevance model (its `record_feedback` matches by exact `query_vector` equality against only the 10 most recent trajectories; a narrow, session-scoped tool). Behind `param_tuning_enabled` (renamed from v1 `relevance_feedback`). ADR-040 restates D4's line honestly to avoid a second overclaim. Gated by a latency/recall slice of I14. |
| **EmbeddingMigrationPort** | Outbound (gated, snapshot-backed) | `agentbox.sh ruvector <op>` | Extends DDD-016's HygienePort pattern: the parallel `ADD COLUMN`, `CREATE INDEX CONCURRENTLY`, dual-write, `backfill-embedding-m3`, the `embedding_active_column` selector, and rollback — dry-run default, `[memory_hygiene]`/`[integrations.ruvector_external]`-gated. Does *not* invoke the heavier image-swap machinery (that de-risks an extension/image bump, which this is not). Gated by I17/I14. |
| **ArchiveMiningPort** | Outbound (offline, isolated) | Throwaway container over the 11G archive | The ACL over the legacy archive (§10): restore into a throwaway container, read-only `SELECT` extraction, fail-closed redaction, candidate export, teardown. Never the live sidecar (I23). |
| **OntologyGraphPort** | Outbound (reserved, gated) | `ruvector_create_graph` / `ruvector_add_node` / `ruvector_cypher` / `ruvector_shortest_path` over `_ruvector_graphs`/`_nodes`/`_edges` | The `OntologyBackbone` write path (linking) and read path (traversal-augmented `orient`). Reserved (ADOPT-LATER) behind its own gate; adding a graph section to `orient` is a `GeometryChange` (I14). Consumes `urn:ngm:class:*` verbatim; mints no new URN kind (§10, §11). |
| **PrivacyFilterPort** *(reused, extended)* | Outbound | ADR-008 | Fail-closed on the trajectory path (DDD-016 I10) **and** the mining path (I23). |
| **MetricsRegistryPort** *(reused)* | Outbound (register) | ADR-005 registry | Registers the new run/consumer series on the existing `/metrics`. No new exporter. |
| **LinkedDataPort** *(reused)* | Outbound (opt-in) | DDD-004 | JSON-LD encodes the new surfaces only when `[linked_data]` is on. |

---

## 8. Adapter-Contract Compliance

**Slots and URNs (no new slot, no new kind — I11 inherited).** Every new record maps onto an existing kind, exactly as DDD-016's did:

| Entity | URN | Slot | Kind rationale |
|---|---|---|---|
| EffectivenessAggregation run | `urn:agentbox:activity:<scope>:sha256-12-<hash>` | **events** | A lifecycle/process receipt → `activity` (content-addressed; `aggregation-run` in the payload). |
| RecallHarnessRun | `urn:agentbox:activity:<scope>:sha256-12-<hash>` | **events** | A measurement receipt → `activity` (`recall-harness-run` in the payload). |
| EmbeddingMigration | `urn:agentbox:activity:<scope>:sha256-12-<hash>` | **events** | A lifecycle receipt → `activity` (`embedding-migration` in the payload). |
| MiningRun | `urn:agentbox:activity:<scope>:sha256-12-<hash>` | **events** | A process receipt → `activity` (`mining-run` in the payload). |
| DistilledPattern | `urn:agentbox:memory:<scope>:pattern-<sha256-12>` | **memory** | A retrievable distilled lesson → `memory` (the `DistilledLesson`/`effectiveness-` precedent; supports the semantic prefix). |
| MinedCandidate | `urn:agentbox:memory:<scope>:mined-<sha256-12>` | **memory** | A retrievable (inert) candidate record → `memory`. |
| OntologyBackbone node | `urn:agentbox:memory:*` / `urn:ngm:class:*` carried verbatim in node `properties` | n/a (graph engine internal id is a join key only) | No new URN minted; existing identifiers reused (I11 preserved). |

`<scope>` = the 64-character BIP-340 x-only hex pubkey; every record carries `owner_did = did:nostr:<hex>` (DDD-016 I09).

**Middleware order (every management-api dispatch): observability → privacy filter (ADR-008) → JSON-LD encoder (ADR-012)**, redaction before encode (DDD-004 §L08). The mining path adds a second fail-closed redaction point *inside the throwaway container* (I23), before extracted text is even eligible to reach the management-api dispatch.

**Observability**: new tools emit the ADR-005 span `agentbox.adapter.memory.<method>` / `agentbox.adapter.events.<method>`, the `agentbox_adapter_dispatch_total{slot,method,impl,outcome}` counter, and `agentbox_adapter_duration_seconds`; `sona_health` feeds `agentbox_adapter_health` alongside the existing diagnostics.

**Fail semantics (explicit per feature):**

| Feature | Semantics |
|---|---|
| aggregation / distillation sweep | `quick_check`-gated; skips (never throws) on a recovered/corrupt DB; non-destructive (I21) |
| `feed_retrieval` / `feed_routing` (activated) | fail-open, advisory; store or aggregate unavailable → baseline ranking (I06) |
| SONA apply | fail-safe by construction — returns the input embedding unchanged with no learned weights; gated behind a passing harness (I14) |
| attention re-rank / parameter tuning | gated behind a passing harness (I14); fail-open to the baseline formula |
| recall harness | read-only measurement; a `FAIL` **blocks** the gated flag (fail-closed on the gate itself) |
| embedding migration | additive throughout; the 384-dim column never mutated; rollback is a selector flip (I17) |
| legacy mining | offline, isolated, read-only; redaction fail-closed; unredactable dropped (I23) |
| ontology backbone (reserved) | adding a graph section to `orient` is a `GeometryChange`, gated (I14) |

---

## 9. Legacy-Archive Mining Operations

Sibling to DDD-016 §9's hygiene programme, but read-only and offline — this domain *reads* the archive DDD-016's `archive-legacy` op *created*, and never writes back to the live store except as inert candidates through the governed MCP.

### 9.1 Extraction (read-only, in the throwaway container)

Four structural signals, all zero-dependency on the corrupt outcome/duration fields (SQL over the restored throwaway copy):

1. **Command-sequence recipes** — time-gap-bucketed pseudo-sessions; `LAG()`/window n-grams (length 2–5) over the ordered command field; frequency-counted; **ubiquity-filtered** (exclude sequences present in > ~80% of buckets — those are tooling boilerplate, not recipes). Low hundreds of distinctive candidates after dedup against the existing `patterns` rows.
2. **Error-signature → resolution pairs** — **conditional**: gated on a content audit confirming real stderr/exit text survives inside `value` independent of the broken outcome/duration fields. If the templating pathology that zeroed `duration` also emptied the error text, this category yields nothing — flagged as a conditional deliverable, not a committed one (§12).
3. **Tool/file co-occurrence maps** — regex path/tool extraction, per-bucket undirected co-occurrence, aggregated edge counts. The most robust category (tokens survive outcome degeneracy) and a natural first input to the ontology backbone (§11).
4. **Namespace activity timelines** — pure volume/cadence report; a scoping tool to prioritise which windows are worth the heavier mining.

### 9.2 Redaction (mandatory, fail-closed, before the container boundary — I23)

Every extracted blob passes, *inside the throwaway container*: a secret-pattern scan (the ruflo `gates.rs` `SECRET_PATTERNS` family — `api_key`/`secret`/`password`/`token`, PEM headers, `sk-`/`ghp_`/`npm_`/`AKIA` prefixes; redact first-4/last-4 or drop) and a prompt-injection scan (Aho-Corasick phrase list — "ignore previous instructions" and kin — plus zero-width / homoglyph normalisation). An unredactable record is dropped, never persisted. The archive pre-dates any secret-scanning discipline and may embed adversarial stdout/stderr from a historical session — re-embedding it unscanned would be classic memory-poisoning indirect injection.

### 9.3 Graduation (soft-gated behind the aggregation wire)

A `MinedCandidate` graduates from `legacy-mined-candidates` into a judge-tier `DistilledPattern` **only when all of**: (1) N ≥ `aggregate_min_samples` independent corroborations of the same signature in the **real** post-2026-07-05 trajectory corpus; (2) those corroborations carry real, graded `OutcomeLabel`s (DDD-016 I04) whose Wilson lower bound clears the `feed_retrieval` bar — **the legacy mining never supplies the effectiveness number, only the shape to look for** (I15); (3) provenance is *appended* (`legacy-mining+live-corroboration` plus the corroborating trajectory URNs), never overwritten (I16, R13); (4) `confidence_prior` is *replaced* by the real Wilson bound, never blended (I16); (5) a later contradicting trajectory suppresses the candidate, never merges it. Because graduation depends on the aggregation wire, **mining/import can proceed independently of the aggregation workstream, but graduation is meaningfully gated behind it** — a soft cross-workstream dependency ADR-040 states explicitly.

---

## 10. Anti-Corruption Layer

Three external surfaces sit at this domain's edge; each gets a thin translation layer so the domain speaks only its own language.

**Legacy archive → domain (ArchiveMiningPort).** The archive is 2,014,173 rows, ~96% degenerate swarm/hook telemetry whose outcome labels are ~99.9% positive and whose `duration` is hardcoded `0`. The ACL translates it into inert, provenance-marked `MinedCandidate`s that carry **only structural/frequency shape** — recipes, co-occurrence, timelines — and **never** the outcome/duration fields (I15). It is the exact discipline upstream ruflo learned the hard way: their #1686 read-wire fed the corrupt substrate into learning; their ADR-093 fixed the *contract* and their ADR-095 noted the *execution layer* still had to move off the substrate entirely. This ACL is that move, applied pre-emptively: the domain never sees a legacy outcome; it sees a `LOW`-confidence candidate shape it must independently re-earn. Redaction (§9.2) runs fail-closed before any text crosses the container boundary (I23).

**Xinference / bge-m3 → domain (EmbeddingPort, extended).** The port remains the single place the model identity and dimension are known; the domain expresses only "durable writes are embedded" (I03) and "no scope spans two dimensions" (I22). Three translations the ACL enforces, so the domain is not corrupted by the serving layer's shape: (a) a candidate is treated as **"cheapest to try, not best expected to perform"** — the honest reading of the corrected clinical-QA evidence, where `bge-large` is the named standout and `bge-m3` the second-weakest of four BGE variants; the domain evaluates, it does not pre-decide. (b) bge-m3's **sparse/ColBERT modes are not crossed into the domain** — a two-layer deferral (new Xinference-facing plumbing beyond the flat `/v1/embeddings` route, *and* a not-yet-production RuVector primitive, `ruvector-maxsim`, at PoC status). The domain treats every candidate as **dense-only**. (c) the actual per-model latency ratio is treated as **unknown until measured on this host** — no published source compares `bge-small` against `bge-m3` on the same hardware; the domain requires the Xinference pre-check (§4.4) rather than importing a benchmark analogue.

**Graph engine → domain (OntologyGraphPort, reserved).** ADR-036 D8 skipped "GNN aggregates (no node/edge substrate)" — correct for the GNN module (array-in, array-out, no persistence; the SKIP stands). But the extension *also* ships a separate, **already-persisted** Cypher/SPARQL property-graph engine backing `_ruvector_graphs`/`_nodes`/`_edges` (1/13/17 rows — smoke-tested once, then unused). The ACL translates that engine into a single named graph `agentbox-ontology-backbone`, links `MemoryEntry`↔`OntologyClass` by `about` edges, and — critically — carries the *existing* `urn:agentbox:memory:*` / `urn:ngm:class:*` identifiers verbatim in node `properties`, using the engine's internal `bigint` node id purely as a join key never surfaced as agentbox identity. This keeps I01/I11's "no new URN kind" intact while re-opening the capability the 2026-07-04 audit's "GNN" line conflated it with.

---

## 11. Context Map (adjacent domains)

**DDD-016 (Memory & Learning) — Shared Kernel, extended not replaced.** This is the load-bearing relationship. DDD-018 is the *consumer and lifecycle* half of the *same* bounded context DDD-016 opened as the *producer and store* half. It shares DDD-016's ubiquitous language, its two adapter slots, its governed writer, its `PROTECTED_NAMESPACES`/I-GOV guard, and its honesty invariants I01–I13 verbatim. It reads DDD-016's `Trajectory` corpus, materialises DDD-016's `EffectivenessAggregate` record via a run DDD-016 named but never built, and adds new record types (`DistilledPattern`, `MinedCandidate`, run receipts) on DDD-016's existing slots. The one contract it is licensed to change — the embedding model behind I03 — it changes additively (I17), never weakening I03. No aggregate is forked; no store is duplicated. §2's IN/OUT split is the precise seam.

**Ontology / Knowledge-Graph domain — Conformist, consumed not owned (reserved).** The DreamLab ontology (5,975 OWL classes, Oxigraph/Whelk; `urn:ngm:class:*`) is owned elsewhere and consumed here as class identifiers, verbatim, through the reserved `OntologyGraphPort`. This domain mints no ontology URN, asserts no class axiom, and adds no memory-type taxonomy to the ontology (which currently has `urn:ngm:class:agent-memory` but no semantic/episodic/trajectory taxonomy and no experience-replay classes). It notes, as an unblocking condition not a commitment, that the `ontology-classes` RuVector mirror is ~9% stale (5,452 of 5,975 mirrored) — a graph backbone should land after, or alongside a fix to, that staleness, not before.

**DDD-005 (Code Execution) — Shared Kernel, precedent extended again.** DDD-005 established the memory-slot `DistilledLesson` and the events-slot `ExecutionTrace`. DDD-016 extended it once (`EffectivenessAggregate`/`Trajectory`); DDD-018 extends it a second time: `DistilledPattern` is another memory-slot distillation sibling, and the four run receipts (`aggregation-run`, `recall-harness-run`, `embedding-migration`, `mining-run`) are activity-receipt siblings of `ExecutionTrace`. Same URN-reuse discipline — new capability, existing eighteen kinds, no new slot.

**DDD-003 (Sovereign Messaging) — Customer/Supplier, consumed not owned (unchanged).** As DDD-016: this domain consumes only the public `did:nostr:<AGENTBOX_PUBKEY>` as record scope; the nsec never enters it; **no memory-learning nostr kind is federated in v2** (as in v1). A future effectiveness digest to the mesh would reuse the existing `event` kind and the DDD-003 bridge; it does not in v2.

**DDD-004 (Linked-Data Interchange) — Conformist, opt-in (unchanged).** New surfaces are JSON-LD encoded only when `[linked_data]` is on, encoder last in the middleware chain (DDD-004 §L08). The mining path's in-container redaction is *additional* to, not a replacement for, this order.

**DDD-015 (Project Tracking) — sibling precedent (unchanged).** The same additive-substrate, memory-and-events-slots, `uris.js`-only discipline; no runtime dependency, shared adapter-contract lineage only.

---

## 12. Open Questions

1. **The recall harness must land first, unconditionally, and does not yet exist.** Every consumer in this domain is gated behind a passing `RecallHarnessRun` (I14), and the harness (W-B) is a v2 deliverable, not a precondition already met. The design (fixed self-/true-recall/exact-token fixture, no-regression band, median-of-3) is settled here; the build order is: harness first, then attention re-rank (the cleanest first workload), then the parameter-tuning module, then SONA, then — later, and only after its own linking design — the ontology backbone. Until the harness passes for a given consumer, that consumer's flag stays fail-closed (I14).

2. **Where does `DistilledPattern` physically live?** The natural home is the existing `patterns` table (already embedding-plus-free-text shaped, currently 10 hand-written rows), but house law #1 routes durable state through the memory/events slots, and the governed `memory_store` writes `memory_entries`, not `patterns`. Options: (a) extend the governed writer to target `patterns` (a small additive change), or (b) ride `memory_entries` under a `distilled-patterns` namespace exactly as `EffectivenessAggregate` rides `memory-learning-aggregates`. This DDD leads with the memory-slot framing (I01/I03/I11 clean); the physical target is an ADR-040 decision, not resolved here. The same question applies to whether `legacy-mined-candidates` is a namespace or a distinct table (this domain assumes the namespace shape).

3. **Which embedding candidate, and does migration happen at all?** The PRD commits to *evaluating* `bge-m3` and `bge-large-en-v1.5` in the same harness pass (with `bge-base` as a secondary look), not to migrating. Three numbers nobody has published must be measured on this host before any migration code: the `bge-small`-vs-`bge-m3` Xinference latency ratio, the recall delta between the `(16,128)` and `(32,200)` HNSW presets at this row count, and the corpus-specific recall of each candidate against the frozen baseline. If none beats `bge-small` by a harness-visible margin, staying on `bge-small` is a correct result, not a failure.

4. **Error-signature mining yield is genuinely unknown** until the archive content audit (§9.1 category 2) runs. Do not commit to it as a deliverable without the caveat that the templating pathology that zeroed `duration` may also have emptied the error text. The `value` JSON shape for `hooks:pre-bash`/`post-bash` rows is likewise unverified until the throwaway copy is opened; the extraction SQL sketches assume a `value->>'command'`-shaped field that must be confirmed first.

5. **SONA scope granularity and buffer health.** v2 uses one fixed global scope (`agentbox_memory`), because 405 trajectories are already thin against `aggregate_min_samples = 20` and per-namespace fragmentation would starve each engine (I22 forbids spanning dimensions regardless). When the corpus justifies splitting scope, and what `trajectories_dropped`/`buffer_success_rate` alarm thresholds mean in practice, are empirical questions deferred until SONA is actually fed.

6. **The ontology backbone's linking heuristic is unresolved.** A naive per-memory × per-class cosine join is ~973M comparisons — too broad. Two cheaper options (restrict to memories already carrying a `typed_metadata.tags` class match; restrict to high-value namespaces like `patterns`/`project-state`, excluding the 74% `ruvnet-kb` documentation mirror) need their own small design pass before any code lands. This, plus the ~9% mirror staleness and the harness gate, are the three explicit unblocking conditions ADR-040 records for the "ninth capability-adoption decision."

7. **Cron cadence and the shared cursor.** The aggregation and distillation sweeps share one incremental-cursor mechanism (I21) at a 30-minute default cadence; whether that cadence, and the retention window for non-corroborating `MinedCandidate`s (provisionally 90 days), are right values is an empirical question deferred until the corpus and candidate set are non-trivial — the same posture DDD-016 §12 took for `aggregate_min_samples`/`recency_half_life_days`.

---

## 13. References

| Reference | Notes |
|---|---|
| PRD-020 | Product requirements — the corpus-uplift programme (W-A aggregation wire, W-B harness, W-C consumer promotion, W-D embedding lifecycle, W-E legacy mining, optional ontology backbone); measurable acceptance against the live DB. |
| ADR-040 | The v2 decisions with alternatives and rejections; explicitly fires ADR-036's `review_trigger` (the ninth capability-adoption decision) and re-states each ADOPT-NOW/ADOPT-LATER/SKIP verdict it changes, with the recall harness (I14) as the gate. |
| DDD-016 | The Memory & Learning domain this domain **extends, does not replace** — the producer/store half; its I01–I13 + I-GOV remain law (§2, §11 Shared Kernel). |
| PRD-018 / ADR-036 | The shipped v1 triple: the honest producer, the four refuted failure modes, the eight decisions D1–D8 whose ADOPT-LATER reservations (SONA, relevance feedback, attention) and D8 graph question this domain consumes and re-opens. |
| PRD-001 / ADR-005 | Capabilities and adapter slots; memory + events slots, observability middleware, dispatch metrics. |
| ADR-008 | Privacy filter — fail-closed on the trajectory path (I10) and the mining path (I23). |
| ADR-012 / ADR-013 | JSON-LD encoder (opt-in, last in the chain); canonical URI grammar (every identity via `uris.js` under an existing kind). |
| ADR-015 (+ 2026-07-04 amendment) | MCP-ruvector mandate; the embedding pipeline (Xinference `bge-small-en-v1.5`, 384-dim) whose *model* this domain's lifecycle may change under evidence, without weakening the mandate (I17 composes with I03). |
| DDD-005 | Code execution — the `DistilledLesson` (memory) and `ExecutionTrace` (activity) precedent this domain extends a second time. |
| DDD-003 / DDD-004 / DDD-015 | Sovereign messaging (owner identity, consumed); linked-data interchange (opt-in); project tracking (sibling additive-substrate precedent). |
| `docs/ruvector-system-reference.md` | Verified ground truth (seven-agent audit 2026-07-04; live re-verification 2026-07-21) — the 405-trajectory honest corpus, the 0-row aggregate namespace, the 10-row hand-written `patterns` table, the 11G archive, the two served embedding models, the recall baseline. |
