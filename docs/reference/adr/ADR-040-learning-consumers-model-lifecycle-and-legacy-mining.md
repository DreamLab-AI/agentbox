---
id: ADR-040
title: "Learning consumers, model lifecycle, and legacy mining"
status: implemented
date: 2026-07-21
type: architecture
author: Dr John O'Hare
depends_on: [ADR-005, ADR-008, ADR-012, ADR-013, ADR-015, ADR-036]
related: [PRD-020, DDD-018, PRD-018, ADR-036, DDD-016, PRD-001, ADR-035, DDD-003, DDD-004, DDD-005, ADR-027, ADR-029]
review_trigger: >-
  a tenth capability-adoption decision is needed (forces another re-evaluation of the
  ADOPT-NOW / ADOPT-LATER / SKIP verdicts); the graph/ontology backbone (D9) is promoted from
  ADOPT-LATER to ADOPT-NOW and needs its linking heuristic reviewed and the ontology-classes mirror
  staleness resolved; an embedding migration is proposed to actually cut over
  (`embedding_active_column` flips) — forcing a fresh W-B harness A/B and a rollback rehearsal;
  the native `ruvector_hybrid_search` collection engine is finally justified over DIY fusion
  (re-opens DDD-016 open question 2 / the `tsvector` migration); the recall-regression baseline
  (188/200, 119/120) is itself re-based after a corpus change; or a learning consumer acquires
  durable state that fits neither the memory + events adapter slots nor the in-process SONA engine
  registry.
"@context": https://schema.org
"@type": TechArticle
---

# ADR-040 — Learning consumers, model lifecycle, and legacy mining

**Status:** Implemented 2026-07-21/22 (D1, D2, D6 live; D3 closed off-by-measurement; D4 blocked upstream at the engine, feeder shipped; D5 reserved as decided; D7 closed — migration rejected on evidence, recall root-cause fixed by index rebuild instead; D8 closed — archive audited, nothing imported by the honesty gate). Landing record: PRD-020 amendment. Verdict updates vs the re-evaluation table: attention re-rank ADOPT-NOW→**CLOSED-NO-BENEFIT** (blend proven an identity on the L2-normalised corpus); SONA ADOPT-NOW-behind-harness→**BLOCKED-UPSTREAM** (engine hardcodes 256-dim); embedding EVALUATE→**EVALUATED-STAY** (bge-small retained; the recall deficit was HNSW graph degradation — rebuild recovered self 141→177/200, true 87→109/120). New ops law from the field: rebuild the HNSW index after bulk ingests/deletions; never `CREATE INDEX CONCURRENTLY` on this AM (double-insertion verified).
**Date:** 2026-07-21
**Repo:** DreamLab-AI/agentbox
**Related:** PRD-020 (Learning consumers and corpus uplift — product goals, the five workstreams, measurable acceptance), DDD-018 (Learning-consumers and model-lifecycle domain — new invariants I14–I23, the aggregator/harness/mining aggregates), PRD-018 / ADR-036 / DDD-016 (the shipped v1 triple this succeeds — severed loop closed additively, D1–D8, invariants I01–I13 + I-GOV), ADR-015 *and its 2026-07-04 amendment* (MCP-RuVector mandate; embeddings via Xinference `bge-small-en-v1.5`, 384-dim), ADR-035 (project-tracking — the additive-substrate precedent), DDD-005 (the `DistilledLesson` / `ExecutionTrace` URN-reuse precedent), ADR-027 (default-secure posture), ADR-029 (fail-open egress precedent).

## This ADR fires ADR-036's review_trigger

ADR-036 named five conditions under which its verdict table must be re-opened. This ADR trips **two** of them directly, so it re-states the affected verdicts explicitly rather than letting them drift, and records two further facts that independently justify a new ADR even though they are not among ADR-036's named conditions:

1. **"A ninth capability-adoption decision is needed (forces a re-evaluation of the ADOPT-NOW / ADOPT-LATER / SKIP verdicts)."** The ninth decision is the **graph/ontology backbone** (D9) — adopting the extension's already-persisted Cypher/SPARQL property-graph engine (`_ruvector_graphs`/`_nodes`/`_edges`) as an ontology backbone linking memories to classes. ADR-036 D8 skipped "GNN aggregates (no node/edge substrate)"; the 2026-07-04 audit conflated *two different subsystems* under that line. The GNN modules (`ruvector_gcn_forward`, `ruvector_gnn_aggregate`) really are substrate-less (they operate on ad-hoc JSON arrays, no persistence) and their **SKIP stands unchanged**. The Cypher/SPARQL graph engine is a *separate, already-installed, persisted* substrate D8 never evaluated on its own. D9 opens it — as ADOPT-LATER, named and designed, not landed in this window.
2. **"An ADOPT-LATER capability (SONA, relevance-feedback, attention re-rank) is promoted to ADOPT-NOW and needs a recall-regression harness."** D3 promotes **attention re-rank** and D4 promotes **SONA** — both to *ADOPT-NOW-behind-the-harness*. The harness ADR-036 named as the precondition (DDD-016 §12 open question 1) is D2 here (workstream W-B).

Beyond those two named triggers, two further findings from the 2026-07-21 live check make this ADR necessary regardless:

3. **The learning loop's producer is live but its consumers cannot run** because the aggregation stage ADR-036 D1 *specified* was **never implemented** (`memory-learning-aggregates` = 0 rows; a repo-wide grep finds no Wilson-bound aggregator). D1 here builds exactly that missing producer.
4. **An embedding-model change is now on the table.** ADR-015 fixed `bge-small-en-v1.5` (384-dim) as the pipeline; Xinference now also serves `bge-m3` (1024-dim, deployed, unused). D7 opens an *evaluation* of the model choice — which ADR-036 did not name as a review trigger — behind the same harness.

None of this breaks the v1 constraints. Every decision below is **additive** (no new adapter slot, no new port, no new URN kind), **manifest-gated and default-off** (the shipped default stays byte-for-byte today's behaviour), routes durable state through the existing **memory** and **events** slots, mints every identifier through `management-api/lib/uris.js`, issues **no raw SQL**, and runs every schema/data change through the gated `ruvector-sidecar-update.sh` snapshot/rehearse/swap/rollback machinery. DDD-016's invariants I01–I13 + I-GOV remain law; this ADR adds I14–I23, formalised in DDD-018.

### Re-evaluation table (every verdict this ADR touches)

| Capability | ADR-036 verdict | ADR-040 verdict | Gate / mechanism |
|---|---|---|---|
| Hybrid DIY fusion (`ruvector_hybrid_score` + PG FTS) | ADOPT-NOW (D4) | **unchanged** | already live |
| Read-only diagnostics (`memory_health`) | ADOPT-NOW (D4) | **unchanged**; a read-only `sona_health` sibling is added (D4 here) | read-only, fail-open |
| Trajectory recording (producer) | ADOPT-NOW (D1) | **unchanged** — now the corpus the consumers read (405 trajectories / 8,806 steps, all judged) | — |
| GIN on `metadata` jsonb | ADOPT-NOW (D4) | **unchanged** | already live |
| **Effectiveness aggregation** (Wilson bound + recency) | specified (D1) but **never implemented** (0 rows) | **IMPLEMENT NOW** — supervisord cron sweep (D1 here / W-A) | `aggregate_sweep`, reads `trajectory_steps` direct (I20) |
| **Attention re-rank** (`ruvector_attention_score`) | ADOPT-LATER, reserved (D4) | **ADOPT-NOW behind the harness** — *first* promotion (stateless, cleanest gate exercise) (D3 / W-C) | `attention_rerank`, gated on I14 |
| **SONA** (`ruvector_sona_learn` / `_apply`) | ADOPT-LATER, reserved (D4) | **ADOPT-NOW behind the harness** — *learn* now (accumulate state), *apply* only after a passing harness run (D4 / W-C) | `sona_learn_enabled` / `sona_apply_enabled`, apply gated on I14 |
| **Relevance-feedback learning** (`ruvector_enable_learning` / `ruvector_record_feedback`) | ADOPT-LATER, reserved (D4) — *conflated with SONA* | **RE-SCOPED and kept ADOPT-LATER (reserved)** — it is an HNSW `ef_search`/`probes` parameter auto-tuner fed by short-lived session feedback, **not** a durable content-relevance model; split from SONA, name corrected (D5) | `param_tuning_enabled`, reserved; narrow latency/recall slice of I14 |
| **Pattern distillation** (trajectories → `patterns`) | implied by D1, not separately decided | **ADOPT-NOW** — scheduled, provenance-disciplined (D6 / W-C) | `pattern_distillation`, provenance tiers (I18) |
| **Embedding model** (`bge-small-en-v1.5`, 384-dim) | fixed baseline (ADR-015) | **EVALUATE** `bge-m3` and `bge-large-en-v1.5` side by side; **migrate only on measured uplift** through the harness (D7 / W-D) | `embedding_dual_write`, `embedding_active_column`; I14 + I17 + I22 |
| **Legacy telemetry corpus** (2.01M archived rows) | archived; "unusable as an effectiveness signal" (D5, PRD-018 §1.2) | **MINE for structural shape only** — provenance-marked candidates, **never** effectiveness (D8 / W-E) | offline throwaway restore; I15 + I16 + I23 |
| **Cypher/SPARQL graph engine** (`_ruvector_graphs`/`_nodes`/`_edges`) | not separately evaluated — D8 conflated it with GNN | **NEWLY OPENED as ADOPT-LATER** — named + designed, **not landed in v2** (the ninth decision) (D9) | `graph_backbone`, reserved; I14 + a linking-heuristic design pass |
| Native `ruvector_hybrid_search` collection engine | SKIP / deferred (D8; DDD-016 OQ2) | **unchanged** — still deferred (DIY fusion wins scoped retrieval; unscoped hybrid still unjustified) | — |
| GNN aggregates (`ruvector_gcn_forward`, …) | SKIP — "no node/edge substrate" (D8) | **unchanged — SKIP stands** — still array-only, no persistence, no agentbox node/edge maintenance story | — |
| Auto-execute self-healing (`ruvector_healing_execute`) | SKIP — irreversible (D4/D8) | **unchanged** | — |
| Multi-tenancy RLS | SKIP — single-tenant (D4/D8) | **unchanged** | — |

## TL;DR for newcomers

*Skip if you already know that v1 closed the loop's producer but never built its aggregator, and that v2 wires the consumers, gates every geometry change on one recall harness, opens an evidence-based embedding evaluation, and mines the legacy archive for shape but never for effectiveness.*

The v1 triple (shipped 2026-07-05) did what it promised at the **producer** end: the agentbox hook records real, graded `(state, action, outcome, duration)` tuples honestly — 405 trajectories, 8,806 steps, every one judged (386 success / 19 failed / 0 unjudged). But a live check on 2026-07-21 found the wire is **still severed one stage downstream**: the Wilson-bound aggregator ADR-036 D1 specified was **never implemented** (`memory-learning-aggregates` holds 0 rows; no aggregator code exists anywhere in the repo), so `feed_retrieval` and `feed_routing` are correctly still off — they have nothing to consume. Meanwhile the ADOPT-LATER capabilities (SONA, attention re-rank, relevance-feedback) stayed reserved because ADR-036 named a **recall-regression harness** as their precondition and that harness was never built either. So the honest state of the box is: a strong store, an honest producer, and an empty gap where the distillation-and-consumption half of the loop should be.

This ADR proposes closing that gap in five workstreams. **W-A** builds the missing aggregator as a supervisord cron sweep that reads `trajectory_steps` directly (never a derived projection — the exact bug that left upstream ruflo's counters stuck at zero, their issue #1686) and materialises `EffectivenessAggregate` rows. **W-B** builds the recall-regression harness — a fixed query set frozen against today's baseline (self-recall@10 188/200, true-recall@10 119/120), runnable as `agentbox.sh ruvector recall` — and makes it **the** universal gate: nothing that changes what is retrieved or how the index is walked may flip its consumer flag without a passing run. **W-C** promotes the ADOPT-LATER capabilities *through* that gate, in ascending order of risk: attention re-rank first (stateless, cleanest), then SONA (learn now, apply behind the gate), then pattern distillation (trajectories → the `patterns` table, with a provenance tier that keeps judged-trajectory patterns separate from structural guesses). **W-D** opens an *evidence-based* embedding-model evaluation — `bge-m3` (already served, free to try, but on the best available benchmark the second-weakest of four BGE variants) and `bge-large-en-v1.5` (stronger quality case, new infra cost) evaluated side by side, with the full parallel-column → dual-write → backfill → harness-A/B → cutover → rollback mechanics designed so the *decision* can be evidence-based — and commits only to the evaluation, never blind to the migration. **W-E** mines the 11 GB legacy archive **offline, in a throwaway container**, for structural shape only (command recipes, co-occurrence, timelines), imports the results as inert, LOW-confidence, provenance-marked *candidates* that earn real meaning only by being independently re-observed in the honest post-2026-07-05 corpus — and **never** feeds legacy telemetry into an effectiveness score, because its outcome labels are ~99.9% positive and its `duration` is hardcoded 0 (that is precisely the pathology I04 exists to forbid, and the one upstream ruflo already hit and fixed).

**If you remember only one thing:** v2 adds *consumers* to v1's honest producer — and it does so under one discipline above all others: **every change to retrieval geometry passes the recall-regression harness before its gate opens** (new invariant I14), and **legacy telemetry supplies candidate *shape*, never an effectiveness *number*** (new invariant I16). Everything else — SONA, attention, the embedding evaluation, the graph backbone — is a variation on those two rules, and every one of them is additive, manifest-gated, and default-off, so a container that upgrades to v2 and changes no flags behaves exactly as it does today.

For the deep version, keep reading.

## Context

### What v1 actually left standing (verified live, 2026-07-21)

The v2 plan is grounded in a live re-check of the shipped v1 system, not on ADR-036's aspirations:

- **The store is healthy and hygiene ran for real.** 178,427 memory rows, 454 namespaces, 178,426 embedded (1 stray NULL). The 178,238 swapped namespaces were repaired; 2,014,173 legacy rows were exported to an 11 GB cold archive (`backups/ruvector-sidecar/archive-legacy-20260705T101743Z.copy.gz` + docker volume `ruvector_pg_snap_archive_20260705T101743Z`); `VACUUM FULL` took the table 34 GB → 614 MB; the metadata GIN is built. HNSW recall baseline: **self-recall@10 188/200, true-recall@10 119/120**. 74% of the live corpus (131,988 rows) is the `ruvnet-kb` documentation mirror.
- **The producer is live and honest.** 405 trajectories / 8,806 steps since 2026-07-05, **all judged** (386 success / 19 failed / 0 unjudged). I04/I05 hold: real graded outcomes, real measured duration. This is the clean corpus ADR-036 D1 said the consumers would need — and it now exists.
- **The aggregation wire is severed.** `memory-learning-aggregates` = **0 rows**. A repo-wide grep finds **no implementation** of the Wilson-bound aggregator ADR-036 D1 specified. The producer writes; nothing distils; the consumers have nothing to consume. This is the single most important finding shaping v2: D1's *math* was never in dispute, but its *execution surface* was never built.
- **The consumers are correctly off.** `feed_retrieval`, `feed_routing`, `sona_enabled`, `relevance_feedback` all `false` — the right state while the aggregator is missing. `patterns` holds 10 rows, all hand-written 3DGS recipes from March, none distilled from trajectories.
- **A second embedding model is already deployed and unused.** Xinference serves exactly two models: `bge-small-en-v1.5` (384-dim, current) and **`bge-m3` (1024-dim, deployed, unused)**. The `memory_entries.embedding` column is `ruvector(384)` — the dimension is baked into the schema and every HNSW index.
- **The SONA surface is real and fail-safe.** Extension 0.3.0 / image 2.0.5 exposes `ruvector_sona_learn(table, trajectory_json)`, `ruvector_sona_apply(table, embedding)`, `ruvector_sona_stats(table)`, `ruvector_sona_ewc_status(table)` — Micro-LoRA + EWC++, returning the input embedding unchanged on error or before any weights are learned. All unused.

### The framing tension (unchanged from v1)

This is genuinely new *behaviour* — consumers, a scheduler, a model evaluation, a mining pipeline — that must land as *additive use of existing substrate*, not a parallel stack. Every decision below names the parallel-stack option and rejects it. The v1 constraints bound the solution space before we start: no new adapter slot, no new port, no new URN kind; durable state rides the **memory** + **events** slots; every durable id minted via `uris.js`; middleware order observability → privacy filter → JSON-LD encoder; every new behaviour manifest-gated and default-preserving; no raw SQL; every schema/data op through the gated sidecar-update machinery.

Two new laws join the v1 set and run through every decision. First, **the harness is the universal gate**: DDD-016 §12 open question 1 already named a recall-regression harness as the precondition for "anything touching retrieval geometry (SONA, attention re-rank, embedding migration, relevance feedback)"; v2 builds it (D2) and elevates that precondition to invariant I14. Second, **honesty extends to the mining path**: I04 forbade a constant outcome label at the trajectory write boundary; v2 extends the same prohibition to the legacy-mining and distillation paths (I15/I16) so structural frequency can never masquerade as effectiveness.

## Decision

Twelve decisions, D1–D12. Each records the decision, the alternatives considered and rejected, and the consequences. D10 carries the consolidated manifest-gate table; D11 carries the adapter-contract compliance statement and the new invariants I14–I23; D12 records the non-goals.

### D1 — Close the aggregation wire: a supervisord cron sweep (W-A)

**Decision.** Implement the aggregation stage ADR-036 D1 *specified but never built*, as a **supervisord cron sweep** — not a hook extension, not an on-demand computation. The Wilson lower-bound + recency-half-life math is **unchanged** from ADR-036 D1's prose; the only new decision is the *execution surface*.

- The sweep runs on a fixed background interval (default 30 minutes, `aggregate_sweep_interval_mins`), gated by a new `aggregate_sweep` flag under `[memory_learning]`, default off.
- It reads **directly** from `trajectory_steps`/`trajectories` — the tables `record_trajectories` actually writes — via a monotonic-rowid cursor (high-water mark stored as ordinary `memory_store` metadata), computes the per-action-pattern Wilson lower-bound success rate with recency decay over the delta since the last run, and **upserts** the result into the `memory-learning-aggregates` namespace through the governed MCP `memory_store` (never raw SQL — I03). It is incremental (never rescans processed rows), non-destructive (never mutates source rows), and gated exactly like the D5 hygiene ops.
- The cron sweep is the **sole writer** of `EffectivenessAggregate` rows; `memory_orient` and `feed_retrieval`/`feed_routing` remain **pure readers** of the already-materialised aggregate (I19). This is the exact division of labour DDD-016 §4.3/§4.4 already describes — v2 supplies only the missing producer.
- Once aggregates materialise and clear `aggregate_min_samples` (default 20, unchanged), `feed_retrieval` and `feed_routing` become enable-able per the existing v1 gates — but `feed_retrieval` is a retrieval-geometry change and so is itself gated on the D2 harness (I14).

**Acceptance (measurable against the live DB):** with `aggregate_sweep = true`, `SELECT count(*) FROM memory_entries WHERE namespace = 'memory-learning-aggregates'` grows from **0**; every aggregate row carries a Wilson lower-bound, a sample count, and a recency-decayed rate; no aggregate below `aggregate_min_samples` influences any consumer.

**Alternatives considered.**
- *Post-task hook extension — compute the aggregate inline on every trajectory write.* Rejected: couples every trajectory write to a growing scan per action-pattern, and layers a second concern (aggregation) onto the I10 fail-open/fail-closed-on-redaction write path. It is the anti-pattern the upstream ruflo `consolidate` worker explicitly avoided by making the sweep "safe to call unconditionally on every tick" *instead of* wiring it inline.
- *On-demand inside `memory_orient`.* Rejected as primary (viable only as a degenerate fallback): either it recomputes the full Wilson scan on every cold-start call (unacceptable latency once the corpus grows, and I12 requires `memory_orient` to fail open within a bounded budget), or it makes `memory_orient` a hidden writer — a direct violation of I12's "read-model, never a write source". The correct shape is a single writer (the sweep) and pure readers.
- *Read from a derived/cached projection with its own filter logic.* Rejected, and named as an invariant (I20): this is precisely the defect that left ruflo's `hooks_metrics` counters stuck at 0 forever (their issue #1686 — the reader key-substring-filtered a store the writer never wrote to). The aggregator reads the trajectory tables directly or it is wrong by construction.

**Consequences.** For the first time the specified-but-absent aggregation stage exists, and `feed_retrieval`/`feed_routing` acquire something real to consume. The sweep inherits the incremental-cursor + non-destructive + gated design already proven upstream, so it is safe to run unconditionally on every tick. Cost: a scheduled process is new operational surface (one supervisord program), and the sweep's cadence is a tunable that trades staleness against load — 30 minutes mirrors the upstream `consolidate` cadence and is defensible given 405 trajectories accrue slowly, but it is a default to revisit once volume grows.

### D2 — The recall-regression harness: the universal geometry gate (W-B)

**Decision.** Build the recall-regression harness DDD-016 §12 open question 1 named, as a standalone `agentbox.sh ruvector recall` subcommand — a **fixed, versioned query set** checked into the repo (never regenerated per run, so measurements compare over time) — and make it **the** gate for every retrieval-geometry change in this ADR. This is not a new subsystem: it is the existing `scripts/ruvector-sidecar-update.sh` smoke/recall suite, formalised into a parameterised, fixed-fixture-driven subcommand.

The fixed query set has three classes, frozen against today's baseline:

| Class | Size | Construction | Pass criterion |
|---|---|---|---|
| Self-recall@10 | 200 (matches the 188/200 baseline) | sample 200 existing rows (own embedding = query), stratified across the 454 namespaces, dominant `ruvnet-kb` capped at ~40% (80 queries) so diversity survives | own row appears in own top-10 HNSW result |
| True-recall@10 vs exact scan | 120 (matches 119/120) | 120 fixed query vectors, brute-force ground truth via forced `enable_seqscan` exact top-10, restricted to namespaces with ≥20 rows | `\|HNSW ∩ exact\| / min(10, \|exact\|)` |
| Exact-token (new) | ~20–30 | literal tokens known verbatim in the corpus (error codes, `CUDA_ARCH`, filenames, function names) — the class pure-vector misses and hybrid/SONA/attention are most likely to regress | hybrid recall ≥ pure-vector recall (delta ≥ 0) |

**Pass/fail band (no-regression, not exact-match).** Pass = self-recall@10 **≥ 187/200** *and* true-recall@10 **≥ 118/120**, each the **median of 3 runs** (to absorb HNSW's inherent `ef_search`-traversal jitter), *and* exact-token hybrid-vs-pure delta ≥ 0. Per-namespace recall is surfaced but not gated (informational — catches a regression localised to one namespace that a corpus-wide average would hide).

**The gate rule (elevated to invariant I14).** Any promotion of an ADOPT-LATER capability, any embedding cutover, and any graph-augmented orient output must clear this exact band **before** its consumer flag flips from reserved to enabled. The harness runs (a) standalone by an operator, (b) automatically inside every `ruvector update`/hygiene-op rehearsal (already true per ADR-036 D5), and (c) as the explicit pre/post gate for W-C, W-D and D9.

**Acceptance:** `agentbox.sh ruvector recall` prints the three class scores and a PASS/FAIL against the band; a baseline run on the untouched store reproduces 188/200 and 119/120 within the band.

**Alternatives considered.**
- *Exact-match gate against 188/200 and 119/120.* Rejected: HNSW's randomised entry point makes recall jitter run-to-run; an exact gate would flap. The median-of-3 no-regression band is the disciplined version.
- *Reuse the extension's own `benches/index_bench.rs` criterion suite as-is.* Considered and partially adopted: `ruvector-postgres` already ships an HNSW-build/query benchmark scoped to 10K/100K/1M vectors, and the *index-build* half of W-D can adapt it rather than build from scratch. But the *content-recall* half must run against the live agentbox corpus with agentbox's own fixtures, so the harness is agentbox-owned; the extension bench is a component, not the whole.
- *A per-capability bespoke check.* Rejected: it would let each promotion define its own success criterion, exactly the "four contradictory sources" fragmentation DDD-016 warns against. One harness, one band, one gate.

**Consequences.** The precondition ADR-036 deferred every ADOPT-LATER capability behind now exists, so those capabilities become promotable on evidence rather than on faith. The gate is the single mechanism that makes the rest of this ADR safe: no geometry change ships without a measured non-regression. Cost: building and freezing a good fixed query set is real up-front work, and the harness must itself be maintained when the corpus changes materially (a re-base of the baseline is a named review trigger).

### D3 — Attention re-rank: the first promotion through the harness (W-C)

**Decision.** Promote **attention re-rank** (`ruvector_attention_score`) from ADOPT-LATER to **ADOPT-NOW-behind-the-harness**, and make it the **first** capability driven through the D2 gate. It is wrapped behind a new `attention_rerank` flag (default off) and, when on, applied as an additive re-rank term over the D3-hybrid candidate set.

Rationale: `ruvector_attention_score(query, key, attention_type)` is marked `immutable, parallel_safe` — it is **pure and stateless**: no learned weights, no trajectory buffer, no engine registry, no warm-up. Promoting it is "swap one deterministic scoring formula for another deterministic scoring formula", A/B-able directly against the harness with zero warm-up period. That makes it the ideal first workload to *exercise the gate itself* with the fewest confounding variables — unlike SONA (which does nothing until it has learned from trajectories) or the parameter-tuning module (which needs recorded query trajectories before it has signal), neither of which can cleanly validate the harness in isolation because both start as identity/no-op.

**Acceptance:** with `attention_rerank = true`, a harness run clears the band (I14); with it off, behaviour is byte-for-byte D3-hybrid.

**Alternatives considered.**
- *Promote SONA first (it is "the" learning feature).* Rejected: SONA's `sona_apply` returns the input unchanged until it has learned weights, so a harness run against a cold SONA proves nothing about the harness *or* SONA. Attention re-rank differs from baseline immediately, so it validates the gate cleanly first.
- *Leave attention reserved and skip straight to SONA/distillation.* Rejected: the harness is new and itself needs a low-risk first workload to prove it gates correctly before it is trusted to gate something with learned state.

**Consequences.** The lowest-risk ADOPT-LATER capability lands first and doubles as the harness's shakedown run. Cost: attention re-rank adds a per-candidate scoring call; its benefit over the existing hybrid blend is unproven and may be marginal — which is exactly what the harness will measure, and if it does not clear the band it stays off (a correct result, not a failure).

### D4 — SONA: learn now, apply behind the harness (W-C)

**Decision.** Promote **SONA** (Micro-LoRA + EWC++ embedding transformation) to **ADOPT-NOW-behind-the-harness**, split across two gates that reflect its two genuinely different risk surfaces:

- **`sona_learn_enabled` (learn — low risk, enable-able now).** Feed the judged 405-trajectory corpus to `ruvector_sona_learn('agentbox_memory', trajectory_json)`, mapping DDD-016's `TrajectoryStep` fields onto the function's `{initial, steps[{embedding, attention_weights?, reward}], final_reward}` shape (a clean 1:1: `state`→`initial`/`steps[i].embedding`, graded `quality`→`reward`, trajectory rollup→`final_reward`; `attention_weights` omitted — no agentbox concept maps to it yet). Learning accumulates state in the extension's in-process engine registry; it changes **nothing** about retrieval until applied, so it is not itself a geometry change.
- **`sona_apply_enabled` (apply — geometry change, gated on I14).** Apply `ruvector_sona_apply('agentbox_memory', query_embedding)` as a **pre-scoring transform on the query embedding** inside `memory_hybrid_search`/`memory_orient`, immediately before the existing `0.6·cosine + 0.2·importance + 0.2·recency` blend — additive to D3's formula, no new weighting term, no schema change. `sona_apply` is fail-safe by construction (catches panics; returns the input unchanged when no weights are learned), so no application-level fallback is needed. This flag flips only after a passing harness run comparing `sona_apply_enabled=false` (baseline) vs `true` (transformed query) within the band.

**Scope key:** one fixed global scope, `'agentbox_memory'`, not per-namespace. 405 trajectories is already thin; fragmenting SONA engines per-namespace would starve each of signal. The scope key must be **dimension-stable** — never reused across 384-dim and any future 1024-dim content (I22) — which interlocks with D7.

The reserved v1 `sona_enabled` flag is **superseded** by this finer pair (both default off); no shipped behaviour changes because `sona_enabled` was never on.

**Acceptance:** `ruvector_sona_stats('agentbox_memory')` reports non-zero `patterns_stored`/`trajectories_buffered` once learning runs; `sona_apply_enabled` flips only with a harness PASS on record.

**Alternatives considered.**
- *One coarse `sona_enabled` switch (as ADR-036 reserved).* Rejected: it conflates the safe half (learning, no retrieval effect) with the risky half (applying a learned transform to the query). Splitting lets learning warm up while the geometry change stays gated.
- *Per-namespace SONA scopes.* Rejected for v2: starves each engine of the already-thin trajectory signal; the scope can be split later once volume justifies it. It also multiplies the dimension-stability surface I22 must guard.

**Consequences.** SONA can begin learning from the honest corpus immediately, so that by the time the harness is ready to gate `sona_apply` there is learned state to evaluate — the warm-up and the gate are decoupled. Cost: `trajectories_dropped`/`buffer_success_rate` (from `sona_ewc_status`) must be watched (D4's `sona_health` sibling below) — a climbing drop rate signals the buffer overflowing faster than it consolidates, the SONA analogue of an inert aggregate below its floor; surface it, never auto-remediate.

**Diagnostics addendum (read-only, ADOPT-NOW).** Wire `ruvector_sona_ewc_status`/`ruvector_sona_stats` into a read-only `sona_health` sibling of the existing `memory_health` tool, feeding `agentbox_adapter_health`. Read-only, fail-open, no remediation — matching D4's diagnostics-stay-read-only rule from v1.

### D5 — Relevance-feedback re-scoped; the parameter-tuning module kept reserved (W-C)

**Decision.** Correct ADR-036 D4's conflation and keep this capability **ADOPT-LATER (reserved)**, under a renamed flag. ADR-036 D4 listed "relevance-feedback learning (`ruvector_enable_learning`/`ruvector_record_feedback`)" alongside SONA as if they were one thing. They are two different extension subsystems:

- `src/sona/*` — the embedding-transformation learner (D4 above).
- `src/learning/*` — a **ReasoningBank for HNSW query-parameter optimisation**. It records `QueryTrajectory{query_vector, index_params, results, latency_ms, recall_estimate}` per table, clusters them, and tunes `ef_search`/`probes` per cluster for a speed/accuracy trade-off. It does **not** re-rank or personalise content; it tunes *how the index is searched*. And `ruvector_record_feedback` matches feedback to a trajectory by **exact `query_vector` equality** against only the 10 most recent recorded trajectories — a narrow, session-scoped match, not a durable relevance model.

So this capability, *as shipped*, is **narrower than its name implies**: an HNSW-parameter auto-tuner fed by short-lived session feedback. ADR-040 records that correction explicitly (so v2 does not seed a second overclaim the way "learns which bash patterns are more effective" had to be walked back), renames the reserved v1 `relevance_feedback` flag to `param_tuning_enabled` (both default off — no shipped behaviour changes), and keeps it reserved. When eventually promoted it needs only the **narrower latency/recall slice** of the harness (it changes traversal speed, not content ranking), not the full content-recall gate SONA needs.

**Alternatives considered.**
- *Repeat ADR-036 D4's framing verbatim.* Rejected: it would carry the conflation and the overclaim forward. The correction is the decision.
- *Promote the parameter-tuner now.* Rejected: it needs `max_trajectories`-worth of recorded *query* trajectories per table before `auto_tune` has any signal, and its exact-vector-match feedback wiring would require agentbox to cache the exact query embedding client-side between search and feedback — real integration work with no evidence of payoff yet. Reserved is the honest verdict.

**Consequences.** The v2 docs describe this capability accurately, so no future correction is needed; the flag name now matches what the code does. Cost: a renamed reserved flag is a small migration note for operators (the old `relevance_feedback` name is documented as superseded).

### D6 — Pattern distillation: trajectories → the `patterns` table, with provenance tiers (W-C)

**Decision.** Adopt a scheduled **pattern-distillation** pass (same cron surface as D1, sharing its incremental-cursor mechanism) that turns the judged trajectory corpus into `patterns`-table entries — the ReasoningBank shape (judge → distil → quality-weighted retrieval) — gated by a new `pattern_distillation` flag, default off. The pass clusters `trajectory_steps` by action-pattern similarity, computes a per-cluster distilled summary using a **deterministic, rule-based extractor** (the ADR-076 4-field schema: `summary`/`detail`/`labels`/`paths`, serialised labels-and-paths-first so the embedder weights high-signal tokens; no LLM judge required — `$0 by default`), embeds it through the existing Xinference pipeline (I03, never raw SQL), and writes it through the governed MCP into `patterns`.

**The provenance tier (new invariant I18).** Every `patterns` row carries `metadata.provenance ∈ {judge:trajectory, proxy:legacy-mining, proxy:structural}`. Only **`judge:trajectory`** — distilled from the real, judged 405-trajectory corpus (execution-tier ground truth) — is eligible for `feed_retrieval` promotion. Proxy tiers (structural co-occurrence, and the D8 legacy-mining candidates) are written and **visible for audit** but **retrieval-inert** — never silently merged into the promoted set. This is the exact "proxy never promotes" discipline upstream ruflo encoded (their ADR-171 `DistillProvenance`), and it is the single mechanism that makes W-C and W-E safe to coexist in one `patterns` table.

The distillation pass is incremental (per-namespace rowid cursor, never rescans), non-destructive (only inserts into `patterns`, never mutates `trajectory_steps`), and per-batch transactional (a failed batch rolls back and advances no cursor).

**Acceptance:** with `pattern_distillation = true`, `patterns` grows beyond its 10 hand-written rows, and `SELECT count(*) FROM patterns WHERE metadata->>'provenance' IS NULL` on newly-distilled rows returns **0** (every row is tiered).

**Alternatives considered.**
- *One undifferentiated `patterns` table.* Rejected: it would let a structural guess (no real outcome) be retrieved as if it were a judged lesson — the same honesty failure I04 forbids at the trajectory boundary, one layer up. The provenance tier is the fix.
- *An LLM-judge distiller.* Rejected for v2: the `$0-by-default` deterministic extractor is auditable and dependency-free, matching the "inspectable, not aspirational" posture of the whole v1 loop. A judge tier can be opted into later without changing the schema.
- *A new `distilled-patterns` table parallel to `patterns`.* Rejected: it would be new durable substrate; the existing `patterns` table already has the target shape (embeddings + free text), and the provenance tier keeps producers separated within it (additive, no new slot).

**Consequences.** The judged corpus finally produces distilled, quality-weighted, retrievable patterns — the ReasoningBank payoff — while the provenance tier guarantees a structural guess can never impersonate a judged lesson. Cost: the tier is a metadata contract DDD-018 must own as domain law (I18), and a prefix/tier-filtering consumer must keep its promoted-set filter current (the same naming-convention cost ADR-035/ADR-036 already accepted).

### D7 — Embedding-model lifecycle: EVALUATE now, migrate only on measured uplift (W-D)

**Decision.** Open an **evidence-based evaluation** of the embedding model, and design the full migration mechanics so the *decision* can be evidence-based — but **commit only to the evaluation, never blind to the migration**. The migration proceeds only if the harness (D2) shows a measured recall uplift that justifies its cost.

**What to evaluate, and the corrected reading.** Evaluate **`bge-m3` (1024-dim, already served) and `bge-large-en-v1.5` (1024-dim, new infra) side by side** — not `bge-m3` alone. The research corrected an earlier selective reading: on the one benchmark that resembles this corpus's content (technical/specialist English prose), `bge-m3` is the **second-weakest of four BGE variants** (clinical-QA nDCG@10: bge-small 58.9, **bge-m3 63.8**, bge-base 67.1, **bge-large 75.9**), and the source paper names bge-large, not bge-m3, as the standout retriever. `bge-m3`'s only genuine advantage is operational — it is *already deployed*, so trying it costs no new Xinference infra — not that it is expected to perform best. Frame it honestly as "cheapest to try, not best expected to perform"; `bge-large-en-v1.5` is the stronger quality candidate carrying a real (but bounded) new-infra cost. `bge-base-en-v1.5` is a named secondary candidate (it too beat bge-m3 on that benchmark, at a smaller model size, and has a documented query-prefix trick).

**The pre-check that must run first.** Before any dual-write code is written, time **100 real Xinference `/v1/embeddings` calls to `bge-m3` and to `bge-small-en-v1.5` on the same host, same batch size** — a five-minute, zero-risk measurement. Two independent research passes found **no published source** comparing these two models' latency on the same hardware; this number does not exist anywhere and must be measured locally. It decides whether dual-write is a synchronous side-effect (if GPU-bound and fast) or an async/queued background job (if CPU-bound and slow).

**Migration mechanics (designed so the decision can be evidence-based; executed only on measured uplift).** A six-step sequence, each mapped to an existing gated pattern in `ruvector-sidecar-update.sh` — reusing the *hygiene-op* pattern (dry-run default / `--yes` / `[memory_hygiene]` gate / pre-op backup), **not** the heavier image-swap machinery (which exists to de-risk an extension/image version bump, which this is not):

1. **Parallel column** — `ALTER TABLE memory_entries ADD COLUMN IF NOT EXISTS embedding_m3 ruvector(1024);` — additive, non-locking; changes nothing until code reads/writes it. (Dimension is a per-column typmod; a second vector column of a different dimension with its own HNSW index is ordinary PostgreSQL, not a special case.)
2. **Dual-write** — extend the governed write path to embed via both models, gated by `embedding_dual_write` (default off), fully reversible by flipping the flag back. Synchronous or async per the pre-check.
3. **Backfill** — a new `backfill-embedding-m3` subcommand structurally identical to `backfill-embeddings` (dry-run default; gated on `[memory_hygiene] allow_embedding_m3_backfill`), pointed at `bge-m3`/`embedding_m3`, with the same quarantine failure path. Build the new index with ruvnet's own **Medium-bracket preset `(m=16, ef_construction=128)`** — *not* the brief's originally-proposed `(32, 200)`, which is ruvnet's preset for >1M-vector datasets; at 178,427 rows this corpus is in the "Medium" bracket, and the lighter preset builds faster. Sample-build a 10–20K-row slice **twice** (both presets), timing and recall-checking each, before the full `CREATE INDEX CONCURRENTLY`; raise `maintenance_work_mem` for the duration.
4. **Harness A/B — the hard gate (I14).** Run D2's fixed query set against `embedding_m3`/its index versus the frozen 384-dim baseline. No step below runs before this passes.
5. **Cutover** — only on a passing A/B (or an accepted, documented trade-off), flip retrieval to the new column via a manifest selector `embedding_active_column` (`"embedding"` | `"embedding_m3"`, default `"embedding"`).
6. **Rollback** — trivially cheap: the original 384-dim column, data and index are never touched in steps 1–5, so rollback is flipping the selector back.

**Cost envelope (bounded, forward-flagged).** Storage: +1024-dim is 2.66× per row; a parallel column + index adds ≈+1.3 GiB at current scale — affordable now, but linear and material at 1–10M rows (`quantization='sq8'/'pq16'` is the mitigation lever). Latency: per-comparison distance cost scales ≈2.7–3.0× from 384→1024-dim — real but not blocking at 178K rows (the index fits in RAM either way). Build: low-single-digit to low-double-digit minutes for a full 1024-dim build (auto-parallelised above 10K rows). `bge-m3`'s sparse/ColBERT modes are a **two-layer deferral** (new Xinference plumbing *and* the not-yet-production `ruvector-maxsim` primitive, PoC status) — explicitly out of scope; treat bge-m3 as a dense-only 1024-dim candidate.

**Acceptance:** the PRD's committed deliverable is the **evaluation**, not the migration — a harness A/B report for both candidate models plus the Xinference pre-check number. `embedding_active_column` flips only on a documented harness PASS; the flip is itself a named review trigger.

**Alternatives considered.**
- *Migrate to `bge-m3` directly (it is already served).* Rejected: the corrected evidence does not single it out as the quality leader; "already deployed" is a reason to *try* it cheaply, not to *adopt* it unmeasured. Evidence-then-migrate, both models, is the disciplined path.
- *Estimate the dual-write latency from published benchmarks.* Rejected: no published source compares bge-small to bge-m3 on the same hardware, and two research passes each confabulated plausible-but-fabricated numbers for it. Measure it (the pre-check); do not estimate it.
- *Use the heavy image-swap machinery for the schema change.* Rejected: that machinery de-risks an extension/image version bump; a nullable additive column with a concurrent index build is a hygiene-op-class change, and reusing the lighter gated pattern is correct.
- *Migrate in place (drop 384-dim, re-embed).* Rejected: irreversible mid-flight, and it discards the frozen baseline the harness needs to A/B against. The parallel-column design keeps rollback to a flag flip.

**Consequences.** The embedding-model question becomes answerable on this corpus's own numbers rather than on contested literature, and the migration — if it happens — is a reversible, gated, harness-proven cutover, not a leap. Cost: the parallel column roughly triples-to-quadruples DB size while it exists (affordable now, forward-flagged for scale), and the evaluation is real engineering effort that may honestly conclude "stay on bge-small" — which is a correct result the harness is designed to reach.

### D8 — Legacy mining: structural shape only, never effectiveness (W-E)

**Decision.** Mine the 11 GB legacy archive (2,014,173 rows) **offline, in a throwaway container**, for **structural/frequency shape only**, and import the results as inert, LOW-confidence, provenance-marked *candidates* that earn real meaning only by independent re-observation in the honest post-2026-07-05 corpus. The archive is ~96% degenerate swarm/hook telemetry (outcome labels ~99.9% positive, `duration` hardcoded 0), so it is **unusable as an effectiveness signal** — feeding it into `EffectivenessAggregate` would reproduce exactly the `feedback(true)` pathology I04 exists to forbid, and the one upstream ruflo already hit and fixed by moving learning off this substrate (their issue #1686 / ADR-093).

**The honesty boundary (new invariant I15 — the effectiveness firewall).** Legacy-mined candidates supply candidate **shape**, never an effectiveness **number**. `confidence_prior` is fixed `LOW` at import (ignoring any raw support-count the extraction SQL computes — frequency is not effectiveness), and can be **replaced** (never blended/averaged) by a real Wilson bound only on live corroboration. **Legacy telemetry never enters an `EffectivenessAggregate`.** This extends I04/I07 one layer earlier in the pipeline.

**The pipeline.**
1. **Isolated restore** — restore the archive into a throwaway container (Option A: logical `gunzip -c … | psql \copy memory_entries FROM STDIN`, the exact command already documented in the sidecar-update script; or Option B, preferred: mount the `pg_basebackup` snapshot volume read-only, which carries its own self-consistent schema and avoids drift). Named distinctly (`mining-*`, **never** `ruvector_pg_snap_*` or anything in `agentbox.toml`), never network-attached to the compose stack. Verify row count == 2,014,173 before mining.
2. **Read-only extraction** (SELECT only) of four structural signal classes: **command-sequence recipes** (time-gap-segmented pseudo-sessions, `LAG()` n-grams length 2–5, ubiquity-filtered so tooling boilerplate present in >80% of buckets is excluded); **error-signature → resolution pairs** (*conditional* — first requires a content audit to confirm real stderr text survives the templating pathology; flagged as a conditional deliverable, not a committed one); **file/tool co-occurrence maps** (regex path/tool extraction, per-bucket co-occurrence matrix — the most robust class, and a natural future input to D9's graph backbone); **namespace activity timelines** (a pure volume/cadence report — trivial, guaranteed).
3. **Redaction (mandatory, fail-closed)** over every exported blob before it leaves the throwaway boundary: the ruflo `gates.rs` `SECRET_PATTERNS` family (api_key/secret/token regexes, PEM headers, `sk-`/`ghp_`/`npm_`/`AKIA` prefixes) plus an Aho-Corasick prompt-injection lexical scan and zero-width/homoglyph normalisation. An unredactable record is **dropped, never persisted** — extending PRD-018 §9 risk-4's fail-closed principle from the trajectory path to the mining path.
4. **Distillation** — the ADR-076 4-field schema (`summary`/`detail`/`labels`/`paths`), rule-based, deterministic, no LLM.
5. **Governed import** — via `memory_store` **only** (never raw SQL — house law), into a dedicated `legacy-mined-candidates` namespace added to `PROTECTED_NAMESPACES`, each record `{pattern_type, provenance:{source:'legacy-mining', archive_ref, mined_at, support_count}, confidence_prior:'LOW', validated:false, corroboration_count:0}`. Inert; nothing reads it at retrieval time. Gated by `[memory_hygiene] allow_legacy_mining_import`, default off.

**Graduation (the only path to real meaning).** Gated by `[memory_hygiene] allow_pattern_graduation`, default off (non-dry-run graduation only). A candidate graduates from `legacy-mined-candidates` into the promoted `patterns` set **only when all of**: (a) N ≥ `aggregate_min_samples` independent corroborations of the same signature appear in the **real** post-2026-07-05 trajectory corpus (reuse W-A's floor — do not invent a second threshold); (b) those corroborations carry real graded `OutcomeLabel`s (I04) whose Wilson lower-bound clears the `feed_retrieval` bar — **the legacy mining never supplies this number, only the shape to look for**; (c) provenance is *appended*, never overwritten (`source: 'legacy-mining+live-corroboration'` + the corroborating trajectory URNs — the audit trail must always show it started as an unvalidated guess); (d) `confidence_prior` is *replaced*, never blended, by the real Wilson bound; (e) a later live-graded contradiction (same context, opposite outcome) **suppresses** the candidate, never merges it (the ADR-098 contradiction-suppression ethic). Non-graduating candidates are garbage-collected after a retention window (default 90 days, zero corroborations).

**Cross-workstream dependency (stated explicitly).** Mining and import can proceed independently of W-A, but **graduation is soft-gated behind W-A shipping** — a candidate cannot corroborate against an aggregator that does not yet exist.

**Acceptance:** `legacy-mined-candidates` populates with tiered, redacted, LOW-confidence candidates; `SELECT count(*) FROM memory_entries WHERE namespace='legacy-mined-candidates' AND metadata->>'confidence_prior' <> 'LOW'` returns **0**; no legacy-derived row ever appears in `memory-learning-aggregates`.

**Alternatives considered.**
- *Feed legacy telemetry into the aggregator to bootstrap effectiveness.* Rejected outright, and named as an invariant (I15): its labels are ~99.9% positive and its duration is 0 — it is the exact degenerate corpus I04 refuses. This is the upstream ruflo pathology, already diagnosed and fixed by moving learning off this substrate.
- *Import candidates directly into `patterns` as normal rows.* Rejected: they would be retrievable as if judged. The `legacy-mined-candidates` quarantine + the I18 proxy tier keep them inert until corroborated.
- *Mine against the live sidecar.* Rejected: house law and blast-radius. A read-only throwaway restore is the only safe substrate; the live store is never touched.
- *A distinct `legacy-mined-candidates` Postgres table.* Rejected: a namespace within `memory_entries` is the additive, no-new-slot option consistent with house law #1 (DDD-018 resolves the schema-shape question; this ADR assumes the namespace shape).

**Consequences.** The archive yields genuine value — command recipes, co-occurrence, timelines — without a single dishonest effectiveness claim, and the provenance/graduation machinery guarantees a mined guess only ever becomes a promoted pattern by being independently re-proven on the honest corpus. Cost: the yield is uncertain (the error-signature class may be empty if the templating pathology extends to error text — flagged as conditional), and the pipeline is real engineering effort (~4–6 engineer-days plus restore wall-clock and human review of the candidate corpus) whose payoff depends on live corroboration that may be slow to accrue.

### D9 — The graph/ontology backbone: the ninth capability-adoption decision (correcting D8's conflation)

**Decision.** Record the **ninth capability-adoption decision** the review_trigger names, and correct ADR-036 D8's framing. D8 skipped "GNN aggregates (no node/edge substrate)" — a line that conflated **two different subsystems**:

- The **GNN modules** (`ruvector_gcn_forward`, `ruvector_gnn_aggregate`, `ruvector_graphsage_forward`) operate on ad-hoc JSON arrays passed in per call, with **no persistence layer**. Their SKIP is **correct and stands unchanged** — still no agentbox node/edge maintenance story, still no validated behaviour.
- The extension *also* ships a **separate, already-persisted Cypher/SPARQL property-graph engine** (`_ruvector_graphs`/`_ruvector_nodes`/`_ruvector_edges` — the very tables the brief describes as "near-empty (1/13/17)"), with real, tested functions (`ruvector_create_graph`, `ruvector_add_node`, `ruvector_cypher`, `ruvector_shortest_path`). This is **not** substrate-less — it is an installed, persisted, queryable graph database sitting almost entirely unused. D8 never evaluated it on its own.

**Verdict: ADOPT-LATER — named and designed here, not landed in this v2 window.** The minimal design: one graph `agentbox-ontology-backbone`; class nodes carrying the existing `urn:ngm:class:…` identifier verbatim in `properties.urn` (the graph engine's internal `bigint` node id is never surfaced as agentbox identity — **no new URN kind is minted**, I01/I11 hold); memory nodes carrying the existing `urn:agentbox:memory:…`; `about` edges from memory to class. This enables GraphRAG-style traversal-augmented `memory_orient` (surface a class's `requires`/`enables` relationships, and *other* memories linked to the same class — a lateral recall path distinct from cosine similarity).

**Why not in v2 (three concrete blockers, mirroring the SONA/attention reasoning):**
1. **It is a new write path** (the memory↔class linking) not covered by any existing D3 retrieval gate, and the **linking heuristic is genuinely unresolved** — a naive per-memory × per-class cosine join is ~973M comparisons (178,427 rows × 5,452 classes), too expensive to run broadly. It needs its own small design pass (candidate cheaper options: restrict to memories already carrying a `typed_metadata.tags` match, or to curated high-value namespaces — the 74% `ruvnet-kb` mirror is not a natural ontology-linking candidate at all).
2. **It changes retrieval geometry** the moment `memory_orient`'s output gains a graph-traversal section — so it is gated on the D2 harness (I14), which is itself only being *built* in this window.
3. **The `ontology-classes` mirror is ~9% stale** (5,452 of 5,975 live classes) — landing a linking feature against a known-stale mirror bakes staleness into a new capability before the mirror-refresh cadence is addressed.

**Unblocking conditions (recorded, not silently dropped):** (a) the W-B harness exists and passes; (b) a linking heuristic is chosen and reviewed; (c) the mirror staleness is fixed or explicitly accepted. A reserved `graph_backbone` flag (default off) holds the gate, exactly as ADR-036 reserved `sona_enabled`.

**Alternatives considered.**
- *Re-open the GNN SKIP.* Rejected: GNN is genuinely substrate-less (array-only, no persistence, no maintenance story). Only the *graph-engine* question is newly opened; the GNN SKIP is re-affirmed unchanged.
- *Land the backbone in v2.* Rejected on all three blockers above — most decisively, it changes retrieval geometry and the gate that would clear it is only being built this window.
- *Mint a new `graph-node` URN kind.* Rejected by house law #1 and I01/I11: the graph node carries the existing `urn:ngm:class:…`/`urn:agentbox:memory:…` in its properties; the engine's internal id is a join key, never agentbox identity.

**Consequences.** The ninth decision is recorded with its verdict and its concrete unblocking conditions, so the review_trigger fires deliberately when it is promoted rather than the capability being silently forgotten (as the graph engine effectively was under D8's conflation). Cost: a real GraphRAG capability rides an already-installed, tested substrate but stays deferred — value left on the table, named as a debt not a denial, exactly as ADR-036 D8 treated its own deferrals.

### D10 — Manifest gates (new keys, all default-off / behaviour-preserving)

**Decision.** Every v2 behaviour is opt-in through `agentbox.toml`, extending the v1 blocks additively. **The default state equals today's shipped v1 behaviour**: producer on, aggregation absent, all consumers off. No orphan top-level table (I13).

```toml
[integrations.ruvector_external]
# existing v1: enabled, conninfo, manage_sidecar, image, data_volume,
#              hybrid_search, typed_metadata, metadata_gin, health_tool,
#              episodic_ttl_sweep, memory_orient
embedding_active_column = "embedding"  # retrieval reads this column; "embedding" | "embedding_m3" (D7 cutover selector)
embedding_dual_write           = false        # dual-write the parallel 1024-dim bge-m3 embedding (D7)

[memory_learning]
# existing v1: enabled, record_trajectories, aggregate_min_samples,
#              recency_half_life_days, feed_retrieval, feed_routing
aggregate_sweep        = false  # D1/W-A: the supervisord cron sweep materialises EffectivenessAggregate rows
aggregate_sweep_interval_mins = 30   # D1 cadence
pattern_distillation               = false  # D6/W-C: scheduled trajectory→patterns distillation (provenance judge:trajectory)
attention_rerank               = false  # D3/W-C: ruvector_attention_score re-rank (ADOPT-NOW behind harness)
sona_learn_enabled             = false  # D4/W-C: feed judged trajectories to ruvector_sona_learn (no retrieval effect)
sona_apply_enabled             = false  # D4/W-C: apply learned SONA transform at query time (geometry change; harness-gated)
param_tuning_enabled           = false  # D5/W-C: HNSW ef_search/probes auto-tuner (renamed from v1 relevance_feedback; reserved)
graph_backbone                 = false  # D9: Cypher/SPARQL ontology backbone (ADOPT-LATER, reserved — not landed in v2)
# superseded (kept for back-compat, both still default-off, no shipped behaviour changes):
#   sona_enabled        → split into sona_learn_enabled / sona_apply_enabled (D4)
#   relevance_feedback  → renamed param_tuning_enabled (D5)

[memory_hygiene]
# existing v1: allow_namespace_repair, allow_embedding_backfill, allow_legacy_archival
allow_embedding_m3_backfill = false  # D7: non-dry-run backfill of the parallel 1024-dim column
allow_legacy_mining_import  = false  # D8/W-E: non-dry-run governed import of legacy-mined candidates
allow_pattern_graduation    = false  # D8/W-E: non-dry-run graduation of corroborated candidates into patterns
```

**Alternatives considered.**
- *A new `[memory_mining]` / `[embedding_migration]` top-level block.* Rejected: I13 forbids orphan top-level tables; mining import is a hygiene-class gated op (`[memory_hygiene]`), the migration selector is sidecar config (`[integrations.ruvector_external]`), and the consumers extend `[memory_learning]`. No new block is needed.
- *Reuse the v1 `sona_enabled`/`relevance_feedback` flags unchanged.* Rejected: they conflate distinct risk surfaces (D4) and carry an overclaim (D5). The finer flags are the honest surface; the old names are documented as superseded, both default-off so nothing shipped changes.

**Consequences.** A default v2 container behaves byte-for-byte as today's v1 — the safe, reversible landing the constraints require — and each capability enables and evaluates in isolation. Cost: the flag surface grows (nine new keys across the existing three blocks); the independence is deliberate because the concerns (aggregation, each consumer, embedding lifecycle, mining) have genuinely different risk profiles and gates.

### D11 — Adapter-contract compliance and new invariants (I14–I23)

**Decision.** Every v2 feature composes onto the existing adapter contract with **no new slot, no new kind, no new port**, and introduces ten new invariants (formalised in DDD-018, continuing the I01–I13 + I-GOV numbering).

**Slots & URNs (no new slot, no new kind).** Aggregates, distilled patterns and mined candidates ride the **memory** slot (as `MemoryEntry`s — the `DistilledLesson`/`effectiveness-` precedent); trajectories continue on the **events** slot. Graph nodes (D9, deferred) carry existing `urn:ngm:class:…`/`urn:agentbox:memory:…` identifiers, never a new kind. The `embedding_m3` column and the `_ruvector_*` graph tables are additive schema, run through the gated machinery.

**Middleware order (unchanged): observability → privacy filter (ADR-008) → JSON-LD encoder (ADR-012).** The mining path's redaction (D8) is a fail-closed application of the same privacy discipline, run inside the throwaway boundary before any candidate is exported.

**New invariants:**

| # | Name | Statement |
|---|---|---|
| **I14** | geometry-change-requires-harness-pass | The recall-regression harness (D2) is the mandatory pre/post gate for every retrieval-geometry change. No consumer gate that alters *what* is retrieved or *how* the index is walked (`feed_retrieval`, `attention_rerank`, `sona_apply_enabled`, `param_tuning_enabled`, an `embedding_active_column` cutover, a graph-augmented orient) flips from reserved to enabled without a run clearing the no-regression band (self-recall@10 ≥ 187/200 **and** true-recall@10 ≥ 118/120, median of 3, exact-token delta ≥ 0). |
| **I15** | mined-candidates-never-feed-effectiveness (legacy-effectiveness firewall) | A `MinedCandidate` (or any `proxy:legacy-mining` record) never contributes to an `EffectivenessAggregate`, an aggregation run's input, or a `feed_retrieval`/`feed_routing` promoted set. `confidence_prior` is fixed `LOW` at import and may be *replaced* (never blended/averaged) by a real Wilson bound only on N live corroborations. Legacy telemetry never enters an `EffectivenessAggregate` (extends I04/I07 to the mining path). |
| **I16** | candidate-inert-until-corroborated | A `MinedCandidate`/`proxy:*` `DistilledPattern` is inert — audit-visible, retrieval-invisible — until N ≥ `aggregate_min_samples` live-graded corroborations clear the `feed_retrieval` bar. On graduation, provenance is *appended* (never overwritten) and confidence is *replaced* (never blended) by the real Wilson bound; a later contradicting live-graded trajectory *suppresses* the candidate, never merges it. |
| **I17** | migration-dual-write-before-cutover | An `EmbeddingMigration` may not cut retrieval over to a new embedding column until (a) the parallel column is fully backfilled, (b) dual-write has been live for the parallel period, and (c) a `RecallHarnessRun` A/B on the new column/index returns PASS. The original 384-dim column, its data, and its index are never mutated during the lifecycle; cutover and rollback are both a manifest selector flip. |
| **I18** | provenance-tier law | Every `patterns` entry (`DistilledPattern`) and `MinedCandidate` carries `metadata.provenance ∈ {judge:trajectory, proxy:legacy-mining, proxy:structural}`. Only `judge:trajectory` (from the real judged corpus) is eligible for `feed_retrieval` promotion; proxy tiers are audit-visible and retrieval-inert. |
| **I19** | aggregation-run is sole producer, consumers are pure readers | The `EffectivenessAggregation` run is the *only* writer of `EffectivenessAggregate` rows; `memory_orient`, `feed_retrieval`, and `feed_routing` are pure readers of already-materialised aggregates — none may become a hidden writer. |
| **I20** | aggregation reads the source of truth | The aggregation and distillation runs read directly from `trajectory_steps`/`trajectories` — the tables `record_trajectories` actually writes — never a derived, cached, or substring-filtered projection with its own filter logic (the ruflo #1686 anti-pattern). |
| **I21** | incremental-non-destructive-sweep | The aggregation and distillation runs are incremental (a shared rowid cursor stored as ordinary `memory_store` metadata), non-destructive (only insert/upsert into target namespaces, never mutate or delete source rows), and `quick_check`-gated — safe to call unconditionally on every scheduled tick. |
| **I22** | scope-key dimension stability (embedding-scope-stability law) | A SONA/engine `table_name` scope key is dimension-stable; a migration never reuses one scope across 384-dim and 1024-dim content. Harness fixtures and aggregates are dimension-tagged so a cutover cannot silently mix geometries. |
| **I23** | mining-isolation law | A `MiningRun` executes only in a throwaway container/volume, distinctly named (`mining-*`, never `ruvector_pg_snap_*` or any `agentbox.toml`-registered name), read-only, never network-attached to the compose stack; redaction is fail-closed and completes before any extracted text crosses the container boundary; an unredactable record is dropped, never persisted. |

**Fail semantics (per new feature):**

| Feature | Semantics |
|---|---|
| aggregation cron sweep (D1) | gated; incremental, non-destructive; fail-open (a failed tick advances no cursor, retries next tick) |
| harness (D2) | read-only measurement; no mutation; a FAIL blocks the gated flag flip, never the store |
| attention re-rank / SONA apply (D3/D4) | **fail-open** → degrade to the D3-hybrid baseline; geometry change gated on I14 |
| SONA learn (D4) | fail-safe (extension returns input unchanged on error); no retrieval effect |
| pattern distillation (D6) | per-batch transactional; non-destructive; fail-open |
| embedding dual-write / backfill / cutover (D7) | gated; parallel column never touches the live column; rollback = selector flip |
| legacy mining import (D8) | offline throwaway restore; redaction **fail-closed** (unredactable → dropped); governed import gated |

**Alternatives considered.**
- *A new `learning` adapter slot for consumers.* Rejected by house law and the ADR-035/DDD-005 precedent — memory + events already fit.
- *Skip the new invariants and rely on decision prose.* Rejected: the two hardest laws (harness-gates-geometry, legacy-never-effectiveness) are exactly the ones a future code path could quietly violate; they must be domain law, not guidance.

**Consequences.** The v2 consumers inherit the three middleware layers, the contract-test harness and both federation modes for free, exactly as v1 did, and the ten new invariants encode the disciplines that keep the consumers honest and the geometry safe. Cost: ten more invariants to enforce and test (DDD-018 owns them); the enforcement points (the gate check, the provenance tier, the firewall) are new code surfaces that must be covered.

### D12 — Non-goals (explicit exclusions)

**Decision.** The following are out of scope for v2 and recorded so a future proposal re-opens them deliberately:

- **No new adapter slot, no new port, no new URN kind.** Aggregates/patterns/candidates ride **memory**; trajectories ride **events**; graph nodes reuse existing URNs.
- **No blind embedding migration.** D7 commits to the *evaluation* only; the cutover flips `embedding_active_column` only on a documented harness PASS and is a named review trigger. `bge-m3` sparse/ColBERT modes are a two-layer deferral.
- **No graph/ontology backbone landing in v2** (D9 is designed and reserved, not built) — and **the GNN SKIP stands re-affirmed**.
- **No native `ruvector_hybrid_search` collection engine / `tsvector` migration** (DIY fusion still wins scoped retrieval; DDD-016 OQ2 stays deferred).
- **No RL/gradient training pipeline.** SONA is Micro-LoRA/EWC++ inside the extension; the aggregator is Wilson bound + recency decay; distillation is a deterministic rule-based extractor. No gradient training is added.
- **No legacy telemetry into effectiveness, ever** (I16) — mining yields structural shape only.
- **No per-caller identity/mandate system, no auto-execute self-healing, no multi-tenancy RLS** — all unchanged from ADR-036 D8.
- **No merge of the stdio MCP server into the HTTP adapter** (v1 reconciliation debt unchanged).
- **No host-project specifics** — host referenced by role only.

**Consequences.** The v2 blast radius is bounded to consumers, one scheduler, one evaluation and one offline mining pipeline; the powerful-but-unproven capabilities (embedding migration, graph backbone, native hybrid) are named and deferred so the review triggers fire when any is promoted. Cost: real value stays reserved (a possibly-better embedding model, a GraphRAG capability on an installed substrate) — recorded as debts, not denials.

## Consequences (overall)

### Positive
- The severed aggregation wire is finally closed: the honest producer (405 judged trajectories) gets its missing distillation stage (D1), and the consumers ADR-036 reserved (`feed_retrieval`, `feed_routing`) acquire something real to consume.
- Every retrieval-geometry change ships behind one measured gate (D2/I14) — the precondition ADR-036 deferred everything behind now exists, so promotions are evidence-based, in ascending risk order (attention → SONA → distillation → the deferred embedding/graph changes).
- The embedding-model question becomes answerable on this corpus's own numbers (D7), with a reversible, harness-proven, flag-flip cutover — and the plan honestly commits only to the evaluation, correcting a selective reading that had favoured the wrong model.
- The 11 GB archive yields genuine structural value (D8) with a hard effectiveness firewall (I15) — the same discipline upstream ruflo learned the hard way, encoded as invariant rather than hope.
- The ninth capability decision (D9) is recorded with its verdict and unblocking conditions, and D8's GNN/graph-engine conflation is corrected on the record.
- The whole surface stays additive: zero new URN kinds, zero new ports, zero new adapter slots, nine new flags all default-off — a v2 container that changes no flags behaves byte-for-byte as today's v1.

### Negative
- The flag surface grows to nine new keys across three blocks, and two v1 flags (`sona_enabled`, `relevance_feedback`) are superseded — operators must learn the finer gates and the supersession notes.
- `patterns` now carries three provenance tiers (I18) and a prefix/tier-filtering consumer must keep its promoted-set filter current — a naming-convention cost, not a type-system guarantee (the same cost ADR-035/ADR-036 accepted).
- The programme is genuinely large (five workstreams, an offline mining pipeline, an embedding evaluation) and several deliverables are conditional on measurements not yet taken (the Xinference latency pre-check, the harness A/B, the error-signature content audit) — the plan is honest that some may conclude "do not proceed", which is a correct result the gates are designed to reach.

### Risks
- A mis-tuned harness band or a thin corpus could let a marginal geometry change pass or block a good one; the median-of-3 band and the per-namespace breakdown bound this, and every consumer defaults off so the risk is live only once an operator opts in.
- The embedding migration, if pursued, roughly triples-to-quadruples DB size while the parallel column exists (affordable at 178K rows, forward-flagged for scale) and consumes real Xinference throughput on dual-write — the pre-check and the async/queued fallback bound this, but it is real cost.
- Legacy mining could surface noise (spurious high-frequency boilerplate) or poisoned content (secrets, prompt-injection text in old telemetry); the ubiquity filter, the fail-closed redaction pass, and the LOW-confidence quarantine bound this, but the candidate corpus needs human review before any graduation, and that review is not schedulable.
- The graph backbone (D9) and the native hybrid engine (DDD-016 OQ2) stay reserved; if they never land the gates could rot into dead config — mitigated by each carrying a concrete, testable unblocking condition (a passing harness, a reviewed linking heuristic, a resolved mirror staleness), not an open-ended "later".

## Docs To Keep In Sync
On landing, update together: `README.md`, `docs/user/quickstart.md`, `CLAUDE.md` (agentbox — extend the RuVector-memory section with the v2 consumers, the harness command, and the embedding-lifecycle note), the new PRD-020 / ADR-040 / DDD-018, and `docs/ruvector-system-reference.md` (record the aggregator implementation, the harness baseline and command, the `bge-m3` evaluation status, and the legacy-mining pipeline). ADR-036's review_trigger is hereby fired and its verdict table re-evaluated in this document; `depends_on: [ADR-005, ADR-008, ADR-012, ADR-013, ADR-015, ADR-036]`.
