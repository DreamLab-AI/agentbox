# PRD-020: RuVector Learning Consumers and Corpus Uplift

**Status:** Proposed / Draft v1 — NOT implemented (nothing in this document has shipped)
**Date:** 2026-07-21
**Repo:** [github.com/DreamLab-AI/agentbox](https://github.com/DreamLab-AI/agentbox)
**Related:** PRD-018 (RuVector-native memory and learning — the **shipped predecessor**; this PRD is its v2 successor and consumes the corpus PRD-018's producer now generates), ADR-040 (Learning consumers, model lifecycle and legacy mining — this PRD's decision record; it fires ADR-036's `review_trigger` as the ninth capability-adoption decision), DDD-018 (Learning-consumers and model-lifecycle domain — this PRD's domain model, continuing DDD-016's invariants at I14+), ADR-036 (RuVector capability adoption and learning loop — the eight decisions D1–D8 this PRD builds on; its `review_trigger` names exactly the promotions below), DDD-016 (Memory-learning domain — the invariants I01–I13 + I-GOV that remain law), PRD-001 (Capabilities and adapters), PRD-008 (Code-as-Harness — URN-reuse precedent), PRD-017 (Sovereign project tracking — additive-substrate precedent), ADR-005 (Pluggable adapter architecture — dispatch contract and observability), ADR-008 (Privacy filter routing — fail-closed on the trajectory/mining write paths), ADR-012 (JSON-LD 1.1 adoption), ADR-013 (Canonical URI grammar — the 18 kinds), ADR-015 (MCP RuVector mandate + its 2026-07-04 embedding-pipeline amendment), PRD-011 (Ontology bridge — the class corpus the sixth stream would link against)

## TL;DR for newcomers

*Skip if you already know that PRD-018 shipped a live, honest trajectory **producer** but the **aggregator that distils it was never built**, that the consumers therefore correctly sit off, and that the fix is again wiring and disciplined evaluation, not new capability.*

PRD-018 shipped on 2026-07-05 and did most of what it promised: the six retrieval gates and the `[memory_learning]` producer are `true` in the live manifest, the hygiene ops ran for real (178,238 namespaces repaired, 2,014,173 legacy rows exported to an 11G cold archive, `memory_entries` VACUUM-FULLed 34 GB → 614 MB), and the trajectory recorder has been capturing honest, graded tuples ever since. A fresh audit on 2026-07-21 confirms the producer works: **405 trajectories / 8,806 steps, every one judged (386 success / 19 failed / 0 unjudged)**. The honesty invariants held — no `feedback(true)`, no `duration=0`, no fabricated labels. The same fresh audit finds the store at **178,427 memory_entries across 454 namespaces, 178,426 embedded — one stray NULL** has appeared since the 2026-07-05 backfill left zero; it is noted here as a residual I03 watch item, not actioned by this PRD (no workstream below targets it specifically, and one row is not worth a dedicated hygiene op).

But the loop is still open, at a different point than PRD-018's four break-points. The **aggregation stage that PRD-018 specified in ADR-036 D1 was never implemented**: the `memory-learning-aggregates` namespace holds **0 rows**, and a repo-wide grep finds no Wilson-bound aggregator anywhere. The wire is severed between *capture* (live) and *distillation* (absent). The consumers (`feed_retrieval`, `feed_routing`, `sona_enabled`, `relevance_feedback`) are therefore all `false` — correctly, because there is nothing to consume. The `patterns` table still holds only the 10 hand-written 3DGS recipes from March; nothing has ever been distilled into it. Separately, three capabilities sit deployed-but-idle: the SONA surface (`ruvector_sona_learn` / `sona_apply` / `sona_stats` / `sona_ewc_status`, all fail-safe, all unused); `bge-m3` (1024-dim), already served by Xinference alongside the current `bge-small-en-v1.5` (384-dim) and never touched; and an 11G, 2.01M-row legacy archive that has never been mined.

This PRD closes that gap the same way its predecessor did — **additively, manifest-gated, default-off, honestly graded, and never claiming a loop it has not actually closed.** Five workstreams: **W-A** implements the missing aggregator (a scheduled Wilson/recency sweep over the now-real 405-trajectory corpus); **W-B** builds the recall-regression harness (fixed query set, baseline 188/200 and 119/120, `agentbox.sh ruvector recall`) that is the mandatory gate for *any* change to retrieval geometry; **W-C** promotes the ADOPT-LATER capabilities (attention re-rank, SONA, relevance feedback) and distils judged trajectories into `patterns` — each only through the W-B gate; **W-D** *evaluates* (does not migrate to) `bge-m3`/`bge-large-en-v1.5` and designs the parallel-column migration mechanics so the decision can be evidence-based; **W-E** mines the 11G archive **offline, read-only, in a throwaway container** for structural/frequency shape only — never as an effectiveness signal, because that corpus is ~96% degenerate telemetry (~99.9% positive labels, `duration=0` everywhere). A sixth, reserved stream names and designs the ontology-backbone graph but does not land it in v2.

**If you remember only one thing:** the producer is live and honest but the aggregator that consumes it was never built, so the learning loop is still open — v2 closes it by building the aggregator, building the recall harness that must gate every retrieval-geometry change, and consuming the corpus (SONA, distillation, attention re-rank) and the wider substrate (bge-m3, legacy shape) **only** behind that harness and behind honest provenance, adding no adapter slot, no URN kind, and no port, with every new gate defaulting to today's behaviour.

For the deep version, keep reading.

---

## 1. Problem

### 1.1 The producer is live and honest — and the aggregator it feeds was never built

PRD-018 / ADR-036 D1 specified two halves of one mechanism: a producer (the agentbox hook writing real `(state, action, outcome, duration)` tuples) and a distiller (a Wilson lower-bound plus recency-decay aggregator that turns those tuples into a retrievable `EffectivenessAggregate` per action-pattern). The producer shipped and works. The distiller did not ship at all.

Verified live on 2026-07-21:

| Component | ADR-036 spec | Live state 2026-07-21 | Verdict |
|---|---|---|---|
| Trajectory producer (`HookObservationPort`) | Records honest graded tuples | **405 trajectories / 8,806 steps; 386 success / 19 failed / 0 unjudged** | Live, honest |
| Effectiveness aggregator (D1 distillation stage) | Wilson lower-bound + recency decay → `memory-learning-aggregates` | **`memory-learning-aggregates` = 0 rows; no aggregator implementation exists in the repo** | **Never built** |
| `feed_retrieval` / `feed_routing` | Gated consumers of the aggregates | Both `false` | Correctly off (nothing to consume) |
| `sona_enabled` / `relevance_feedback` | Reserved ADOPT-LATER consumers | Both `false` | Reserved, unbuilt |
| `patterns` table | Distilled action-pattern lessons | **10 rows, all hand-written 3DGS recipes from March; 0 distilled** | Untouched |

This is not a degradation of a working loop; it is a loop that was **half-shipped**. The tuples accumulate honestly and then reach a dead end — there is no code path that reads `trajectory_steps` and writes an `EffectivenessAggregate`. Until that stage exists, the consumers cannot be anything but off, and the "does it learn from its own outcomes yet?" question still answers *no* — not because the corpus is degenerate (it is now genuinely clean and graded) but because nothing distils it.

The upstream ecosystem hit and fixed this exact class of severed-wire bug. `ruflo`'s `hooks_metrics` reader key-substring-filtered a store that its writer never wrote to (upstream issue #1686), so counters stayed at 0 forever; their fix (ADR-093 F1) was not a new algorithm but making the reader consume *the same store the writer actually writes to*, via one shared function. The lesson for W-A is precise: the agentbox aggregator must read directly from `trajectory_steps` / `trajectories` (the tables the live producer actually writes), never a derived or cached projection with its own filter logic — that derived-projection pattern is what produced #1686 and the "four contradictory sources" fragmentation DDD-016 already warns about (I06/I07).

### 1.2 The legacy archive is honestly mineable only for structure, never for effectiveness

The 11G cold archive (`archive-legacy-20260705T101743Z.copy.gz` + snapshot volume `ruvector_pg_snap_archive_20260705T101743Z`) holds the 2,014,173 rows PRD-018's `archive-legacy` op exported. Its content is **~96% swarm/hook telemetry whose outcome labels are ~99.9% positive and whose `duration` is hardcoded to 0** (PRD-018 §1.2, audit-verified). As an effectiveness signal it is worse than useless — feeding it into `EffectivenessAggregate` would reproduce the precise `feedback(true)` pathology that DDD-016 I04/I07 exist to forbid, and would repeat the upstream mistake `ruflo` corrected by moving learning off that substrate entirely (their ADR-093 / ADR-095: the contract was fixed, the degenerate execution substrate was abandoned, not read back).

What the archive *can* honestly yield is **structural / frequency shape** — command-sequence recipes, tool/file co-occurrence maps, error signatures (conditional on a content audit), namespace activity timelines — imported as **provenance-marked, LOW-confidence, inert candidates** that carry a raw support-count (a frequency, never a rate) and earn real effectiveness meaning only by being independently re-observed in the honest post-2026-07-05 trajectory corpus. This distinction is the load-bearing honesty constraint of the whole mining workstream (§3.5): mining supplies *the shape to look for*, never *the effectiveness number*.

### 1.3 High-value capabilities sit deployed and idle

Three levers are installed and untouched:

- **SONA (Micro-LoRA + EWC++).** The extension (0.3.0, image 2.0.5) exposes `ruvector_sona_learn(table, trajectory_json)`, `ruvector_sona_apply(table, embedding)`, `ruvector_sona_stats(table)`, `ruvector_sona_ewc_status(table)` — all fail-safe (they return the input unchanged on error or before any weights are learned), all verified live, all unused. `sona_learn`'s `trajectory_json` shape maps cleanly onto DDD-016's `TrajectoryStep` (initial/steps[].embedding/reward/final_reward), and `sona_apply` is safe to wire unconditionally behind its gate because it degrades to the identity transform when it has learned nothing. But SONA changes the embedding itself before scoring — a retrieval-geometry change — and so cannot be trusted until the W-B harness exists.
- **`bge-m3` (1024-dim), already served, never used.** Xinference serves exactly two models: the current `bge-small-en-v1.5` (384-dim) and `bge-m3` (1024-dim), the latter deployed and idle. The `memory_entries.embedding` column is `ruvector(384)` — the dimension is baked into the schema and every HNSW index — so any model change is a genuine migration, not a config flip. Whether `bge-m3` is even the right upgrade is an open question: on the one benchmark that resembles this corpus's technical-English content it is the **second-weakest of four BAAI English-family models**, beaten by `bge-base` and beaten badly by `bge-large-en-v1.5`; its only genuine advantage is that it is *already deployed*, so it costs no new infra to try. This must be evaluated, not assumed (§3.4).
- **The 11G archive** (§1.2), never mined.

### 1.4 The retrieval-geometry gate that everything above needs still does not exist

DDD-016 §12 open question 1 named a **recall-regression harness** as the precondition for anything that changes retrieval geometry — SONA, attention re-rank, embedding migration, relevance feedback. ADR-036's `review_trigger` names the same gate for promoting any ADOPT-LATER capability. That harness was never built. The frozen baseline exists as a one-off measurement (self-recall@10 188/200, true-recall@10 119/120) but not as a runnable, fixed-fixture suite. Every consumer in §1.3, and the model migration in §3.4, is blocked on it. Building it (W-B) is therefore the spine of this programme: no phase below enables a retrieval-geometry change before it lands.

### 1.5 This re-opens ADR-036's adoption menu deliberately

ADR-036 recorded eight capability-adoption decisions (D1–D8) with a `review_trigger` that fires when "a ninth capability-adoption decision is needed" or "an ADOPT-LATER capability is promoted to ADOPT-NOW and needs a recall-regression harness". This programme does **both**: it promotes SONA, relevance feedback and attention re-rank (ADOPT-LATER → gated-adopt behind W-B), it opens a new embedding-lifecycle decision (D8's model was fixed at `bge-small`), and it re-opens the graph substrate D8 skipped — but re-opens it correctly, distinguishing the *substrate-less GNN module* (still SKIP) from the *already-persisted Cypher/SPARQL graph engine* the 2026-07-04 audit conflated with it. ADR-040 is the record that fires this trigger and re-states each verdict it changes; PRD-020 states the product requirements those decisions realise.

---

## 2. Goals and non-goals

### 2.1 Goals

1. **Close the aggregation wire (W-A).** Implement the missing D1 distillation stage: a scheduled, incremental, non-destructive Wilson lower-bound plus recency-decay aggregator that reads `trajectory_steps` directly and materialises `EffectivenessAggregate` rows into `memory-learning-aggregates` through the governed MCP — turning the live 405-trajectory corpus from a dead end into a retrievable signal.
2. **Build the recall-regression harness (W-B).** A fixed, versioned query set reproducing the 188/200 and 119/120 baselines, runnable as `agentbox.sh ruvector recall`, that is the mandatory pre/post gate for every retrieval-geometry change in this programme and after.
3. **Promote the ADOPT-LATER capabilities honestly (W-C).** Wire attention re-rank, SONA and relevance feedback behind their gates and behind the W-B harness; distil judged trajectories into embedded `patterns` rows with explicit provenance so a real, quality-weighted retrieval corpus exists — the ReasoningBank shape (judge → distil → quality-weighted retrieval).
4. **Make the embedding-model decision evidence-based (W-D).** Design the additive parallel-column migration mechanics (1024-dim column + parallel HNSW + dual-write + backfilled re-embed + harness A/B + cutover + rollback) and *evaluate* `bge-m3` and `bge-large-en-v1.5` against `bge-small-en-v1.5` through W-B — committing to the evaluation, not the migration.
5. **Mine the legacy archive honestly (W-E).** Offline, read-only mining of the 11G archive in a throwaway container into structural/frequency candidates that are provenance-marked, LOW-confidence, and inert until independently corroborated by the live corpus — never an effectiveness signal, never touching the live sidecar.
6. **Keep every new behaviour additive and off by default.** New manifest keys extend the existing `[integrations.ruvector_external]` / `[memory_learning]` / `[memory_hygiene]` blocks; the default state is byte-for-byte today's behaviour; no new adapter slot, port or URN kind.

### 2.2 Non-goals

These are closed decisions for v2, not deferrals-pending-reconsideration (ADR-040 records each with its rejection):

- **No retrieval-geometry change before W-B.** No phase enables SONA, attention re-rank, relevance feedback, `feed_retrieval`'s re-rank term, an embedding cutover, or the graph-backbone traversal until the harness exists and records a passing run at that configuration. This is a hard sequencing law, not a preference.
- **No migration to a new embedding model in v2.** W-D delivers the evaluation and the migration *mechanics*; the cutover decision is deferred to its evidence. `embedding_active_column` stays `"embedding"` (384-dim) unless a recorded harness pass justifies otherwise.
- **No new adapter slot, no new port, no new URN kind.** Durable state rides the existing **memory** and **events** slots; identifiers reuse the `activity` and `memory` kinds; the two new record shapes (distilled patterns, mined candidates) are new *local-part prefixes* on the existing `memory` kind, minted via `management-api/lib/uris.js`.
- **No effectiveness signal from legacy telemetry, ever.** The archive feeds structural candidates only; a mined candidate carries a raw support-count and `confidence_prior: LOW`, never a rate, and never contributes to any `EffectivenessAggregate` (extends I04 to the mining path).
- **No RL training pipeline.** SONA is a fail-safe extension primitive fed graded trajectories, not a gradient-training loop agentbox owns; the aggregator remains simple inspectable statistics.
- **No mining against the live sidecar.** W-E restores into a distinctly-named throwaway container/volume, never the production sidecar, never a `ruvector_pg_snap_*` volume, never network-attached to the agentbox compose stack.
- **No graph-backbone landing in v2.** The ontology-backbone graph is named, designed and reserved (§3.6); it is the "ninth decision" ADR-040 records, adopted in a later phase, not this one. The GNN module stays SKIPPED, un-revisited.
- **No raw SQL writes.** Every durable write goes through the governed MCP and the Xinference embedding pipeline; every schema/data op runs through the gated `ruvector-sidecar-update.sh` snapshot/rehearse/swap/rollback machinery.
- **No host-project specifics.** The host is referenced by role only.

---

## 3. Capabilities

The design is five workstreams (W-A…W-E) plus one reserved sixth stream, expressed as decisions D1–Dn in ADR-040; this PRD states the *product* requirements. Every workstream is independently gated and — except where a soft dependency is named — independently landable.

### 3.1 W-A — Close the aggregation wire (the missing D1 distillation stage)

**Requirement.** Implement the Wilson lower-bound plus recency-decay aggregator ADR-036 D1 specified but never shipped, reading the live `trajectory_steps` corpus directly and materialising `EffectivenessAggregate` records into the `memory-learning-aggregates` namespace via the governed MCP `memory_store` — never raw SQL (I03), never a derived projection with its own filter logic (the §1.1 anti-pattern).

**Execution surface: a scheduled sweep, not an inline hook.** The aggregator runs as a **supervisord-managed periodic sweep** (agentbox already runs supervisord), mirroring `ruflo`'s `consolidate` worker (ADR-174): incremental via a rowid/id high-water-mark cursor stored as ordinary `memory_store` metadata (never rescans processed steps), non-destructive (only inserts/updates aggregate rows, never mutates `trajectory_steps`), and gated/quick-check-safe so it is safe to call unconditionally on every tick. Cadence defaults to 30 minutes — the 405-trajectory / 8,806-step corpus accrues slowly, so minutes-to-hourly avoids both staleness and needless load. Inline-on-write aggregation is rejected (couples every trajectory write to a corpus-wide scan, and adds a second concern to the I10 fail-closed-on-redaction hot path); lazy on-`memory_orient` aggregation is rejected (would make the I12 read-model a hidden writer, or force a full Wilson scan on every cold start).

**The math is unchanged from ADR-036 D1** — Wilson lower-bound success rate over the graded `quality` scores, recency half-life decay (`recency_half_life_days`, default 14), inert below `aggregate_min_samples` (default 20). Only the execution surface (a scheduled sweep) is the new decision. The sweep is the sole writer of aggregate rows; `memory_orient`, `feed_retrieval` and `feed_routing` remain pure readers, exactly the division of labour DDD-016 §4.3/§4.4 already describes with the producer missing.

**Then enable the consumers, respecting the geometry gate.** `feed_routing` surfaces aggregates as advisory `[INTELLIGENCE]` hints — it does not re-rank retrieval, so it is enabled once the corpus clears the sample floor (a corpus-gate, not a geometry gate). `feed_retrieval` *does* alter ranking (it adds a re-rank bonus term to `memory_hybrid_search` scoring), so — belt-and-braces beyond the aggregate sample floor — its enablement is **additionally gated on the W-B harness** recording a no-regression run. This keeps W-A landable now (producer + advisory routing) while honouring the §2.2 sequencing law.

### 3.2 W-B — The recall-regression harness (the gate for everything geometric)

**Requirement.** A fixed, versioned query set and a runnable `agentbox.sh ruvector recall` subcommand that reproduces the frozen baseline and is the mandatory pre/post gate for every retrieval-geometry change. This is not a new subsystem — it is the existing `scripts/ruvector-sidecar-update.sh` smoke/recall suite formalised into a standalone, parameterisable, fixed-fixture-driven command, generalising the self-recall / true-recall SQL snippets already documented in `docs/ruvector-system-reference.md` §7.

**Fixed query set (built once, checked into the repo, never regenerated per run):**

| Class | Size | Construction | Baseline / pass |
|---|---|---|---|
| Self-recall@10 | 200 | Sample 200 existing rows (own stored embedding is the query), stratified across the 454 namespaces (floor of ≥1 per namespace holding ≥50 rows), the dominant `ruvnet-kb` corpus (74%) capped at ~40% (80 queries) so diversity survives. Pass = the query's own row appears in its own top-10. | Baseline 188/200; pass ≥ **187/200** |
| True-recall@10 | 120 | 120 fixed query vectors; brute-force ground truth via forced exact scan (`enable_seqscan=on`, no index), compared against live HNSW top-10; restricted to namespaces with ≥20 rows. | Baseline 119/120; pass ≥ **118/120** |
| Exact-token | 20–30 | Queries built from literal tokens known to exist verbatim (error codes, `CUDA_ARCH`, filenames, function names) — the class pure-vector misses and `memory_hybrid_search` exists to fix. | Hybrid recall must be **≥ pure-vector** on this class (never worse) |

**Metrics and gate.** Self-recall@10, true-recall@10, a per-namespace recall breakdown (surfaced but not gated — catches a regression localised to one namespace a corpus-wide average hides), and the hybrid-vs-pure-vector delta on the exact-token class (must be ≥ 0). The gate is a **no-regression band with a small absorption margin** for HNSW's inherent `ef_search` traversal jitter, taken as the **median of 3 runs**: pass = self-recall@10 ≥ 187/200 **and** true-recall@10 ≥ 118/120. The exact-token class specifically guards `hybrid_search`, SONA and attention re-rank against silently trading exact-token recall for semantic gains.

**Where it runs.** `agentbox.sh ruvector recall`, invocable (a) standalone by an operator, (b) automatically inside every `ruvector update` / hygiene-op rehearsal (already true per ADR-036 D5), and (c) as the explicit pre/post gate for every W-C promotion, the W-D A/B, and the reserved sixth stream. The extension already ships a criterion-style build/recall benchmark suite (`crates/ruvector-postgres/benches/index_bench.rs`) that W-B/W-D can adapt for the index-build half rather than build from scratch.

### 3.3 W-C — Promote ADOPT-LATER through the harness, and distil the corpus

Four capabilities, each gated behind W-B, promoted in a deliberate order chosen by confounding-variable risk.

**Promotion order (least to most retrieval-geometry risk):**

1. **Attention re-rank first.** `ruvector_attention_score(query, key, attention_type)` is `immutable, parallel_safe` — a pure, stateless function with no learned weights, no trajectory buffer, no warm-up. Promoting it is "swap one deterministic scoring formula for another" and can be A/B'd against W-B with zero confounding variables — making it the ideal *first* real workload to exercise the harness itself, before any capability with learned state.
2. **Relevance feedback / parameter-tuning second.** `ruvector_enable_learning` / `ruvector_record_feedback` are **not** the durable content-relevance model the name implies — they are an HNSW `ef_search`/`probes` auto-tuner fed by short-lived, exact-`query_vector`-matched session feedback (matched against only the 10 most recent trajectories per table). ADR-040 must restate this plainly rather than repeat ADR-036 D4's conflated "relevance-feedback learning" line, so a second overclaim is not seeded. Its promotion gate is a latency/recall tradeoff check — a narrower slice of W-B than a content-ranking change.
3. **SONA third.** `ruvector_sona_learn` is fed the judged trajectory corpus (mapping `TrajectoryStep` → `initial`/`steps[].embedding`/`reward`/`final_reward`); `ruvector_sona_apply` is wired as a **pre-scoring transform on the query embedding** inside `memory_hybrid_search`/`memory_orient`, immediately before the existing `0.6·cosine + 0.2·importance + 0.2·recency` blend — additive to D3's formula, no new weighting term, no schema change. It is fail-safe (identity transform until it has learned weights), so it needs no application-level fallback. Use **one fixed global `table_name` scope** (`'agentbox_memory'`), not per-namespace: 405 trajectories is already thin against `aggregate_min_samples`, and the engine registry is in-process (nothing durable is lost by consolidating scope). `ruvector_sona_ewc_status` (`trajectories_dropped`, `buffer_success_rate`) wires into the read-only `memory_health` diagnostics surface as a `sona_health` sibling — surfaced, never auto-remediated, matching D4's read-only rule. Because SONA changes the embedding itself, it needs the **broadest** W-B coverage and is promoted last.

**Pattern distillation (the ReasoningBank shape).** A scheduled distillation pass (sharing W-A's cron surface and cursor mechanism) clusters `trajectory_steps` by action-pattern similarity, computes a deterministic structural summary (no LLM judge required — `$0 by default`, reusing the embeddings already on each row), embeds it through the existing Xinference pipeline (I03), and writes it into the `patterns` table via the governed MCP with `metadata.provenance = 'judge:trajectory'` — execution-tier, because these derive from the already-judged 405-trajectory corpus (386 success / 19 failed, all real outcomes). This grows `patterns` beyond its 10 hand-written rows into a real quality-weighted retrieval corpus.

**Provenance discipline (the single mechanism that makes W-C and W-E safe together).** Every `patterns` row carries `metadata.provenance ∈ {'judge:trajectory', 'proxy:legacy-mining', 'proxy:structural'}`. Only `judge:trajectory` is eligible for `feed_retrieval` promotion; `proxy:*` rows are written for audit but stay inert — never silently merged into the promoted set. This is `ruflo` ADR-171's "proxy never promotes" rule, the exact shape DDD-016 I04 implies and DDD-018 spells out as a `patterns`-table-level invariant (I18).

### 3.4 W-D — Embedding-model lifecycle (evaluate, do not migrate)

**Requirement.** Design the additive migration mechanics and *evaluate* candidate models through W-B, so the migration decision is evidence-based. **The PRD commits to the evaluation, not the migration.**

**The candidates, read honestly.** The brief's steer ("bge-m3 is already deployed") is operationally correct but is not a quality argument. On the one benchmark resembling this corpus's technical-English content (clinical-QA nDCG@10), the four-way BGE comparison is `bge-small` 58.9 / **bge-m3 63.8** / bge-base 67.1 / **bge-large 75.9** — `bge-m3` is the *second-weakest*, beaten by a smaller `bge-base` and beaten by 12.1 pp by `bge-large-en-v1.5`, which the source paper names as its standout retriever. `bge-m3`'s only genuine advantage here is that it costs no new Xinference infra to try. Therefore **evaluate `bge-m3` and `bge-large-en-v1.5` side by side in the same W-B pass** (one free, one requiring new infra whose cost is weighed against its stronger quality case), with `bge-base-en-v1.5` named as a secondary candidate. `bge-m3`'s sparse/ColBERT modes are a **two-layer deferral** — they need new Xinference plumbing *and* the not-yet-production `ruvector-maxsim` primitive (PoC status, ADR-252) — and are explicitly out of scope.

**Migration mechanics (additive, six steps, each mapped to an existing gated-op pattern):**

1. **Parallel column** — `ALTER TABLE memory_entries ADD COLUMN IF NOT EXISTS embedding_m3 ruvector(1024);` — a plain additive change (per-column typmod; nullable new column changes nothing until code reads it), same posture as the shipped `migrate-trajectories` `ADD COLUMN IF NOT EXISTS`.
2. **Dual-write** — extend the governed write path to embed new/updated memories through both models, gated by `embedding_dual_write = false` (default off), fully reversible by flipping the flag. **Design decision blocked on a pre-check** (below).
3. **Backfill** — a `backfill-embedding-m3` subcommand structurally identical to the shipped `backfill-embeddings` (dry-run default; gated on `[memory_hygiene].allow_embedding_m3_backfill`; same `curl → Xinference /v1/embeddings → UPDATE` loop pointed at `bge-m3` and `embedding_m3`; same quarantine failure path). HNSW build for the new 1024-dim index runs `CREATE INDEX CONCURRENTLY` (non-locking); at 178,427 rows the honest estimate is **low-single-digit to low-double-digit minutes** using ruvnet's own Medium-bracket preset `(m=16, ef_construction=128)` — the corpus sits in its "Medium (100K–1M)" bracket, so the brief's heavier `(32, 200)` is not indicated. Raise `maintenance_work_mem` for the build's duration.
4. **Harness A/B — the hard gate.** Run W-B against `embedding_m3`/`idx_memory_embedding_m3_hnsw` and compare directly to the frozen 384-dim baseline. No cutover runs before this passes.
5. **Cutover** — only on non-regression (or an accepted documented trade-off), flip retrieval to read the new column behind `embedding_active_column = "embedding" | "embedding_m3"` (default `"embedding"`).
6. **Rollback** — trivially cheap: the 384-dim column, data and index are never touched in steps 1–5; rollback is flipping the selector back.

**Mandatory pre-check before any dual-write code.** Time 100 real Xinference `/v1/embeddings` calls against **both** `bge-m3` and `bge-small-en-v1.5` on the same host and batch size — a five-minute, zero-risk operation. This is the one number two independent research passes could not find published anywhere (no source compares `bge-small` directly against `bge-m3` on the same hardware, and `bge-m3`'s 568M params vs `bge-small`'s 33M make the ratio real but unmeasured). If the pre-check shows CPU-bound multi-hundred-millisecond `bge-m3` calls, dual-write is implemented **async/queued** (write the 384-dim embedding synchronously, enqueue the `bge-m3` call for a background worker), never as a blocking addition to the write path. Storage cost is real and linear (2.66× per row; ≈+1.3 GiB combined column+index at current scale, affordable now but material at 1–10M rows); `sq8`/`pq16` quantization on the new index is the mitigation lever if needed.

### 3.5 W-E — Legacy mining (offline, read-only, structural-only, inert-by-default)

**Requirement.** Mine the 11G archive **offline in a throwaway container** for structural/frequency shape only, importing provenance-marked LOW-confidence candidates into a dedicated inert namespace via the governed MCP — never as an effectiveness signal, never against the live sidecar.

**Isolation (non-negotiable).** Restore the archive into a **distinctly-named throwaway container/volume** (`mining-<ts>`, never `ruvector_pg_snap_*`, never a name registered in `agentbox.toml`, never network-attached to the compose stack), via either the documented logical restore (`gunzip -c archive-legacy-*.copy.gz | psql \copy memory_entries FROM STDIN`, the exact command already in `ruvector-sidecar-update.sh`) or a physical mount of the snapshot volume (preferred — carries its own self-consistent schema, avoiding drift). Verify the row count equals 2,014,173 before mining; run read-only `SELECT`s only; `docker rm -v` the container and volume when done.

**What is honestly mineable (all structural/frequency, zero dependency on the corrupted outcome/duration fields):**

| Signal | Method | Confidence |
|---|---|---|
| Command-sequence recipes | Pseudo-session bucketing by `created_at` gap; window-function n-grams (length 2–5) over ordered command fields; frequency-count; **exclude near-ubiquitous sequences** (present in >80% of buckets — tooling boilerplate, not a recipe) | Committed |
| Tool/file co-occurrence maps | Regex path/tool extraction; undirected co-occurrence matrix per bucket; aggregate edge counts | Committed (most robust — names survive outcome degeneracy) |
| Error-signature → resolution pairs | **Conditional on a content audit first** — sample 100–500 raw rows to confirm real stderr/exit text survives independent of the broken outcome/duration fields; the `duration=0` pathology may extend to error text | **Conditional deliverable, caveated** |
| Namespace activity timelines | Volume/cadence report by namespace × day | Trivial; a scoping tool, not a retrieval pattern |

**Distillation and candidate record.** Reuse `ruflo` ADR-076's measured 4-field schema (`summary` / `detail` / `labels` / `paths`, serialised labels+paths first) — rule-based, deterministic, no LLM. Each candidate is written via governed MCP `memory_store` into a dedicated `legacy-mined-candidates` namespace (added to `PROTECTED_NAMESPACES`; inert; nothing reads it at retrieval time until graduation) carrying `{ pattern_type, provenance:{ source:'legacy-mining', archive_ref, mined_at, support_count }, confidence_prior:'LOW', validated:false, corroboration_count:0 }`. `support_count` is a raw frequency, never a rate; `confidence_prior` is fixed `LOW` unconditionally, ignoring any support-derived number the SQL computes (the §1.2 honesty law, one layer earlier than the aggregator).

**Mandatory redaction/injection screening (fail-closed) before any blob leaves the throwaway boundary.** Run the `ruflo` `gates.rs` `SECRET_PATTERNS` family (api_key/secret/password/token, PEM headers, `sk-`/`ghp_`/`npm_`/`AKIA` prefixes; redact first-4/last-4) and an Aho-Corasick prompt-injection lexical scan plus zero-width/homoglyph normalisation over every extracted blob. Any unredactable record is dropped, never persisted — extending PRD-018 §9 risk-4's fail-closed principle from the trajectory path to the mining path. The archive pre-dates any secret-scanning discipline and may embed adversarial stdout/stderr (indirect prompt injection via memory poisoning), so this screen is a hard gate.

**Graduation (soft-dependent on W-A).** A candidate graduates from `legacy-mined-candidates` into `patterns` **only when all of**: (1) N ≥ `aggregate_min_samples` independent live corroborations of the same signature in the real post-2026-07-05 trajectory corpus; (2) those corroborations carry real graded `OutcomeLabel`s and their Wilson lower-bound clears the `feed_retrieval` bar — **the mining never supplies the effectiveness number, only the shape**; (3) provenance is appended (`source: 'legacy-mining+live-corroboration'` plus the corroborating trajectory URNs), never overwritten; (4) `confidence_prior` is *replaced* by the real Wilson bound, never blended (ADR-098 contradiction-suppression ethic); (5) a candidate later contradicted by a live-graded trajectory in the same context is suppressed, not merged. Non-graduating candidates are garbage-collected after a retention window (default 90 days). Because graduation depends on N live corroborations against W-A's aggregator, **mining/import can proceed independently of W-A, but graduation is meaningfully gated behind W-A shipping** — a soft cross-workstream dependency.

### 3.6 Reserved sixth stream — ontology-backbone graph (named, designed, NOT landed in v2)

**Requirement.** Record — but do not land — the ontology-backbone graph as the "ninth capability-adoption decision" that fires ADR-036's `review_trigger`, correcting D8's framing and reserving a manifest gate.

**The correction D8 needs.** ADR-036 D8 skipped "GNN aggregates (no node/edge substrate)" — correct for the **GNN module** (`ruvector_gcn_forward` etc. operate on ad-hoc JSON arrays, no persistence; GNN stays SKIPPED, un-revisited). But the extension *also* ships a separate, **already-persisted Cypher + SPARQL property-graph engine** backing the `_ruvector_graphs`/`_nodes`/`_edges` tables the audit found near-empty (1/13/17) — a real, tested, durable substrate D8 conflated with GNN and never separately evaluated. Adopting *that* engine as an ontology backbone is the newly-opened decision.

**Minimal design (for the record, to land in a later phase).** One graph (`agentbox-ontology-backbone`); class nodes carrying the existing `urn:ngm:class:...` in `properties.urn` (the graph's internal bigint id is never surfaced as agentbox identity — no new URN kind); `MemoryEntry` nodes carrying their existing `urn:agentbox:memory:...`; `about` edges linking memories to classes. The linking heuristic is the **unresolved design question** (a naive 178,427 × 5,452 cosine join is ~973M comparisons — too expensive), with two cheaper options to evaluate (restrict to memories already carrying a `typed_metadata.tags` class match; restrict to high-value namespaces like `patterns`/`project-state`, since the 74% `ruvnet-kb` corpus is not naturally "about" ontology classes). This would enable GraphRAG-style traversal in `memory_orient` — a genuine capability upgrade on an already-real substrate.

**Verdict: ADOPT-LATER, reserved.** Not landed in v2 for three concrete reasons: (1) it is a new write path not covered by any existing D3 retrieval gate, with an unresolved linking heuristic; (2) it changes retrieval geometry the moment `memory_orient` gains a traversal section — gated by W-B, which is itself being built here; (3) the `ontology-classes` mirror is ~9% stale (5,452 of 5,975 classes), and landing a graph feature against a known-stale mirror bakes staleness in. Unblocking conditions, recorded in ADR-040: (a) W-B exists and passes; (b) a linking heuristic is chosen and reviewed; (c) the mirror staleness is addressed or explicitly accepted.

---

## 4. Manifest gates

Every new behaviour is gated in `agentbox.toml`, extending the three existing blocks PRD-018 established — no orphan top-level table is added. **The default state equals today's post-PRD-018 behaviour**: the aggregator does not run, no consumer re-ranks, no model migration, no mining. New keys are shown below; existing PRD-018 keys are elided except where their meaning changes.

```toml
[integrations.ruvector_external]
# ── existing PRD-018 keys (unchanged): hybrid_search, typed_metadata, metadata_gin,
#    health_tool, episodic_ttl_sweep, memory_orient — all currently true ──
# ── PRD-020 / ADR-040 additions (retrieval geometry — all default-off, all W-B-gated) ──
embedding_dual_write   = false        # W-D: dual-embed new writes through bge-m3 into embedding_m3 (evaluation only)
embedding_active_column = "embedding" # W-D: retrieval reads this column; cutover selector (default = current 384-dim)
graph_backbone         = false        # sixth stream: ontology-backbone Cypher/SPARQL traversal in memory_orient (RESERVED — not landed in v2)

[memory_learning]
# ── existing PRD-018 keys: enabled=true, record_trajectories=true, aggregate_min_samples=20,
#    recency_half_life_days=14, feed_retrieval=false, feed_routing=false,
#    sona_enabled=false, relevance_feedback=false ──
# ── PRD-020 / ADR-040 additions (all default-off) ──
aggregate_sweep          = false      # W-A: run the scheduled Wilson/recency aggregator (the missing producer)
aggregate_sweep_interval_mins = 30    # W-A: supervisord sweep cadence
pattern_distillation     = false      # W-C: distil judged trajectories → patterns rows (provenance judge:trajectory)
attention_rerank         = false      # W-C: ruvector_attention_score re-rank (stateless; ADOPT-LATER, W-B-gated, promoted first)
sona_learn_enabled       = false      # W-C: feed judged trajectories to ruvector_sona_learn (no retrieval effect; supersedes v1 sona_enabled)
sona_apply_enabled       = false      # W-C: apply the learned SONA transform at query time (geometry change; W-B-gated; supersedes v1 sona_enabled)
param_tuning_enabled     = false      # W-C: HNSW ef_search/probes auto-tuner (renamed from v1 relevance_feedback; reserved)
# feed_retrieval now additionally W-B-gated (re-rank alters ranking); feed_routing is advisory (corpus-gated only)
# v1 sona_enabled / relevance_feedback are superseded by the three keys above (both kept default-off for back-compat)

[memory_hygiene]
# ── existing PRD-018 keys: allow_namespace_repair, allow_embedding_backfill, allow_legacy_archival (all false) ──
# ── PRD-020 / ADR-040 additions (all default-off; enable only the non-dry-run path) ──
allow_embedding_m3_backfill = false   # W-D: non-dry-run bge-m3 backfill into embedding_m3
allow_legacy_mining_import  = false   # W-E: non-dry-run import of mined candidates into legacy-mined-candidates
allow_pattern_graduation    = false   # W-E: non-dry-run graduation of corroborated candidates into patterns
```

| Key | Type | Default | Controls | W-B-gated? |
|---|---|---|---|---|
| `[memory_learning].aggregate_sweep` | bool | `false` | run the W-A Wilson/recency aggregator; off ⇒ `memory-learning-aggregates` stays 0 rows (today) | No (producer only; writes inert aggregates) |
| `…aggregate_sweep_interval_mins` | int | `30` | supervisord sweep cadence | — |
| `…feed_retrieval` (meaning extended) | bool | `false` | aggregates re-rank `memory_hybrid_search`; **now additionally requires a passing W-B run** because it alters ranking | **Yes** |
| `…feed_routing` | bool | `false` | aggregates surface as advisory `[INTELLIGENCE]` hints (not a re-rank) | No (corpus-gated only) |
| `…pattern_distillation` | bool | `false` | distil judged trajectories → embedded `patterns` rows (`provenance: judge:trajectory`) | No (write path; retrieval unchanged until a consumer reads them) |
| `…attention_rerank` | bool | `false` | `ruvector_attention_score` re-rank; stateless; promoted first as the harness's cleanest workload | **Yes** |
| `…sona_learn_enabled` | bool | `false` | feed judged trajectories to `ruvector_sona_learn` (no retrieval effect; supersedes v1 `sona_enabled`) | No (learn only; no retrieval effect) |
| `…sona_apply_enabled` | bool | `false` | apply the learned `ruvector_sona_apply` pre-scoring transform at query time; promoted last (supersedes v1 `sona_enabled`) | **Yes** |
| `…param_tuning_enabled` | bool | `false` | `ruvector_enable_learning`/`record_feedback` HNSW param auto-tuner (not a content-relevance model; renamed from v1 `relevance_feedback`) | **Yes** (latency/recall slice) |
| `[integrations.ruvector_external].embedding_dual_write` | bool | `false` | dual-embed new writes through `bge-m3` into `embedding_m3` (evaluation) | No (write path; retrieval reads `embedding_active_column`) |
| `…embedding_active_column` | string | `"embedding"` | which column retrieval reads; the W-D cutover selector | **Yes** (any value ≠ `"embedding"`) |
| `…graph_backbone` | bool | `false` | ontology-backbone traversal in `memory_orient`; **reserved, not landed in v2** | **Yes** |
| `[memory_hygiene].allow_embedding_m3_backfill` | bool | `false` | non-dry-run `backfill-embedding-m3` | — (gated op) |
| `…allow_legacy_mining_import` | bool | `false` | non-dry-run import of mined candidates into `legacy-mined-candidates` | — (gated op) |
| `…allow_pattern_graduation` | bool | `false` | non-dry-run graduation of corroborated candidates into `patterns` | — (gated op) |

Independent gates remain a deliberate choice (ADR-036 D6): W-A, W-B, W-C, W-D and W-E have different risk profiles and different readiness, so each capability lands and is evaluated alone. A single master switch is rejected. Two meanings change from PRD-018, and two v1 flags are superseded: `feed_retrieval` gains an explicit W-B precondition (it was previously gated only on the sample floor); `relevance_feedback` is renamed `param_tuning_enabled` and documented as the HNSW parameter-tuner it actually is, not the content-relevance model its name implied; and `sona_enabled` is split into `sona_learn_enabled` (low-risk, enable-able now, no retrieval effect) and `sona_apply_enabled` (the geometry change, W-B-gated, promoted last).

---

## 5. URN allocation

**No new kind is added.** Every durable identifier is minted through `management-api/lib/uris.js` `mint()`; ad-hoc construction is prohibited (ADR-013, `CLAUDE.md` §"URI/URN Scheme"). `<scope>` is the 64-character BIP-340 x-only hex pubkey; every record carries `owner_did = did:nostr:<hex>`.

W-A reuses the existing `EffectivenessAggregate` URN exactly (`urn:agentbox:memory:<scope>:effectiveness-<sha256-12>`) — it implements the producer for a record shape PRD-018 already allocated, minting no new identifier grammar. Trajectories continue to use the existing `urn:agentbox:activity:<scope>:sha256-12-<hash>`. Two new record *shapes* (W-C distilled patterns, W-E mined candidates) are new **local-part prefixes on the existing `memory` kind**, exactly as `lesson-` and `effectiveness-` already are:

| Concept | Kind | Shape | Slot | New identifier? |
|---|---|---|---|---|
| **EffectivenessAggregate** (W-A, producer implemented) | `memory` | `urn:agentbox:memory:<scope>:effectiveness-<sha256-12>` | memory | No — reuses PRD-018's allocation |
| **DistilledPattern** (W-C) | `memory` | `urn:agentbox:memory:<scope>:pattern-<sha256-12>` | memory | New prefix only, same `memory` kind |
| **MinedCandidate** (W-E) | `memory` | `urn:agentbox:memory:<scope>:candidate-<sha256-12>` | memory | New prefix only, same `memory` kind |
| **Trajectory** (existing) | `activity` | `urn:agentbox:activity:<scope>:sha256-12-<hash>` | events | No — unchanged |
| **Ontology-backbone node** (sixth stream, reserved) | — | reuses existing `urn:ngm:class:...` / `urn:agentbox:memory:...` in node properties | — | No — the graph's internal bigint id is never agentbox identity |

Both new memory-slot shapes follow the DDD-005 / PRD-008 precedent: distilled or candidate knowledge is `memory`, content-addressed, disambiguated by the local-part prefix (`pattern-`, `candidate-`) — a naming convention, the same cost ADR-035/ADR-036 accepted. The grammar's closure (18 kinds, one resolver, one `/v1/uri/<urn>` route) survives intact; a new kind would fork it and is rejected (ADR-040 records this, continuing ADR-036 §D7/D8).

---

## 6. Success metrics

Acceptance is measurable. Each metric is binary or numeric, verifiable against the live database with the inspection snippets in `docs/ruvector-system-reference.md` §7 and the W-B harness.

1. **Master gate forces silence.** With every PRD-020 key at its default (`aggregate_sweep=false`, `feed_retrieval`/`feed_routing`/`attention_rerank`/`sona_learn_enabled`/`sona_apply_enabled`/`param_tuning_enabled`/`pattern_distillation`/`embedding_dual_write`/`graph_backbone` false, `embedding_active_column="embedding"`, all `allow_*` false), a container exhibits **zero behavioural change** from the shipped PRD-018 state: `memory-learning-aggregates` stays 0 rows, no re-rank, no distillation, no new column, no mining.
2. **W-A aggregation wire closed.** With `aggregate_sweep=true`, `SELECT count(*) FROM memory_entries WHERE namespace='memory-learning-aggregates'` grows from **0** and is nonzero after one sweep — the direct refutation of the 2026-07-21 "0 rows / no aggregator" finding. Each aggregate carries a Wilson lower-bound and a sample count; the sweep is incremental (its cursor advances; a second run over an unchanged corpus writes no new rows).
3. **W-A honesty preserved.** Aggregates are computed only from judged `trajectory_steps` (the 386 success / 19 failed real outcomes); no row from the legacy archive ever contributes; the aggregated positive fraction reflects real spread (not a ~99.9% degenerate constant), and `aggregate_min_samples` keeps thin patterns inert.
4. **W-B exists and reproduces the baseline.** `agentbox.sh ruvector recall` runs the fixed fixture and reports self-recall@10 and true-recall@10; on the frozen fixture the numbers reproduce **188/200 and 119/120 within the absorption band** (≥187/200 and ≥118/120, median of 3 runs). The exact-token class reports hybrid ≥ pure-vector.
5. **W-B is the gate (the sequencing law is enforced).** No geometry-changing flag (`attention_rerank`, `sona_apply_enabled`, `param_tuning_enabled`, `feed_retrieval`, `embedding_active_column≠"embedding"`, `graph_backbone`) is enabled without an accompanying **recorded passing W-B run at that exact configuration**. Verifiable: each such enablement carries a harness artifact; a diff enabling one without it fails review.
6. **W-C distillation grows a real corpus.** With `pattern_distillation=true`, the `patterns` table grows beyond its 10 hand-written rows; every distilled row carries `metadata.provenance='judge:trajectory'` and a non-null Xinference embedding; `SELECT count(*) FROM patterns WHERE embedding IS NULL` on the distilled path returns **0** (the I03 anti-degeneracy check applied to distillation).
7. **W-C promotion order honoured.** `attention_rerank` is the first ADOPT-LATER flag enabled, with a passing W-B run showing no regression; `param_tuning_enabled` and `sona_apply_enabled` follow only after, each with its own recorded passing run (`sona_learn_enabled` may run earlier, since it has no retrieval effect); `sona_health` surfaces `trajectories_dropped`/`buffer_success_rate` read-only.
8. **W-D evaluation delivered, migration not committed.** The additive schema exists (`embedding_m3 ruvector(1024)` + `idx_memory_embedding_m3_hnsw`); the Xinference latency pre-check (100 calls each to `bge-m3` and `bge-small-en-v1.5`) is recorded; a W-B A/B compares `embedding` vs `embedding_m3` (and `bge-large-en-v1.5`); `embedding_active_column` **remains `"embedding"`** unless a recorded harness pass justifies a cutover. The 384-dim column, data and index are untouched throughout.
9. **W-E honesty.** Every mined candidate lands only in `legacy-mined-candidates`, carrying `source:'legacy-mining'`, `confidence_prior:'LOW'`, `validated:false`, and a raw `support_count`; **no legacy-mined candidate ever appears in any `EffectivenessAggregate`**; graduation into `patterns` occurs only after N ≥ `aggregate_min_samples` live corroborations with real graded outcomes, and on graduation provenance is appended (`legacy-mining+live-corroboration`), never overwritten.
10. **W-E isolation.** Mining ran in a distinctly-named throwaway container/volume (`mining-*`), never attached to the agentbox compose stack, never the live sidecar, never a `ruvector_pg_snap_*` volume; the row count `2,014,173` was verified before mining; the container/volume was torn down (`docker rm -v`) after; the mandatory redaction/injection screen ran fail-closed before any blob was persisted.
11. **No new substrate.** A diff of this programme introduces no new adapter slot, no new port, and no new URN kind. All durable writes route through the **memory** and **events** adapters; all URNs are minted through `uris.js`; the two new record shapes are `pattern-`/`candidate-` prefixes on the existing `memory` kind.
12. **Review trigger fired and recorded.** ADR-040 records this as the ninth capability-adoption decision, re-states each ADOPT-NOW/ADOPT-LATER/SKIP verdict it changes (SONA/relevance-feedback/attention re-rank promoted behind W-B; embedding-lifecycle newly opened; Cypher/SPARQL graph engine distinguished from the still-SKIPPED GNN module), and names W-B as the gate for every retrieval-geometry change (DDD-016 §12 open question 1). This is an ADR deliverable cross-referenced here.

---

## 7. Adapter-contract compliance

### 7.1 Slots and URNs

Aggregation, distillation and mining all read/write on the **memory** slot; trajectory records continue on the **events** slot. No new slot (I11). The aggregator writes `EffectivenessAggregate` rows through `memory_store`; distillation writes `DistilledPattern` rows through `memory_store`; mining writes `MinedCandidate` rows through `memory_store`. All three follow the established `agentbox:<namespace>:<key>` row-id scheme with the URN carried in metadata, minted via `uris.js` (§5). Raw SQL is never issued (I03); schema changes (the W-D parallel column, its HNSW index) run through the gated `ruvector-sidecar-update.sh` machinery.

### 7.2 Middleware order

Every management-api dispatch wraps in the mandated order: **observability → privacy filter (ADR-008) → JSON-LD encoder (ADR-012)**, redaction completing before encode (DDD-004 §L08). This matters acutely on two new paths: distilled `patterns` may embed command text from judged trajectories, and mined candidates embed historical command text — both are privacy-filtered before persist, and the W-E redaction/injection screen (§3.5) is an additional fail-closed gate specific to the untrusted archive.

### 7.3 Observability

The aggregator sweep, the distillation sweep, the W-B harness, the W-D backfill and the W-E import each emit the ADR-005 span `agentbox.adapter.memory.<method>`, the `agentbox_adapter_dispatch_total{slot,method,impl,outcome}` counter, and `agentbox_adapter_duration_seconds`; `sona_health` feeds `agentbox_adapter_health` alongside the existing `memory_health` diagnostics. The stdio-versus-HTTP reconciliation debt PRD-018 §7.4 recorded is unchanged and inherited, not paid here.

### 7.4 Fail semantics

| Feature | Semantics |
|---|---|
| W-A aggregator sweep | fail-open, non-destructive, quick-check-gated; a failed tick advances no cursor and re-runs next tick; store unavailable ⇒ aggregates stale, retrieval degrades to baseline |
| `feed_retrieval` / `feed_routing` | fail-open, advisory; store unavailable ⇒ baseline ranking (I06) |
| W-C attention_rerank / SONA | fail-open → SONA `apply` degrades to identity transform; attention degrades to the baseline scoring formula |
| pattern distillation | fail-open per batch (rolls back the batch, advances no cursor); **fail-closed on privacy redaction** — skip the row rather than persist unredacted |
| W-D dual-write | fail-open (async/queued if the pre-check shows CPU-bound); the synchronous 384-dim write is never blocked by the `bge-m3` call |
| W-D backfill / index build | gated, dry-run by default; snapshot + auto-rollback; `CREATE INDEX CONCURRENTLY` non-locking |
| W-E mining | offline, read-only, throwaway-isolated; **fail-closed on redaction/injection** — unredactable candidate dropped, never persisted |
| W-E graduation | gated (`allow_pattern_graduation`); contradicted candidate suppressed, never merged |

---

## 8. Rollout and migration

The programme lands in phases, each independently gated and reversible. **No phase enables a retrieval-geometry change before the W-B harness exists** — this ordering is the binding sequencing law (§2.2), not a preference. W-B is therefore the spine: it lands before any consumer, any embedding cutover, or the reserved sixth stream.

**Phase 0 — W-B harness first (no behavioural risk).** Formalise the existing recall SQL into `agentbox.sh ruvector recall` with the fixed, checked-in query fixture (200 self-recall, 120 true-recall, 20–30 exact-token). Prove it reproduces the 188/200 and 119/120 baseline within the absorption band. This phase changes no retrieval behaviour; it builds the gate everything else depends on and ships first.

**Phase 1 — W-A aggregator + advisory routing (opt-in, low risk).** Land the supervisord sweep behind `aggregate_sweep`, incremental and non-destructive, writing inert `EffectivenessAggregate` rows. Enable `feed_routing` (advisory hints, not a re-rank) once the corpus clears `aggregate_min_samples`. **`feed_retrieval` is NOT enabled in this phase** — its re-rank alters ranking and waits for Phase 2's harness gate. This phase makes the loop's output *visible and inspectable* without changing what is retrieved.

**Phase 2 — W-C promotions through the harness (opt-in, geometry-gated).** With W-B live, promote in order: `attention_rerank` first (stateless, cleanest harness workload) with a recorded passing run; then `feed_retrieval` (now that a harness exists to gate its ranking change); then `param_tuning_enabled` (latency/recall slice); then `sona_apply_enabled` last (broadest coverage) — `sona_learn_enabled` can run earlier since it has no retrieval effect. Land `pattern_distillation` (a write path, retrieval-neutral until a consumer reads the distilled rows) alongside. Every geometry flag flip carries its harness artifact (metric 5).

**Phase 3 — W-D evaluation (opt-in, no cutover).** Run the five-minute Xinference latency pre-check. Add the parallel `embedding_m3` column and its concurrent HNSW index through the gated ops machinery. Enable `embedding_dual_write` (async/queued if the pre-check indicates), run `backfill-embedding-m3`, then run W-B A/B across `embedding`, `embedding_m3` and `bge-large-en-v1.5`. **`embedding_active_column` stays `"embedding"`**; a cutover is a separate, evidence-gated decision deferred to ADR-040's follow-up, not this programme.

**Phase 4 — W-E mining (offline, isolated, inert import).** Restore the archive into a throwaway container, run the content audit (gating the conditional error-signature deliverable), extract structural candidates, run the fail-closed redaction/injection screen, and import into `legacy-mined-candidates` via governed MCP (`allow_legacy_mining_import`). Candidates are inert. Graduation (`allow_pattern_graduation`) is soft-blocked on W-A (Phase 1) having accrued live corroborations, so it trails naturally.

**Sixth stream — reserved, not scheduled.** The ontology-backbone graph is designed (§3.6) and gated (`graph_backbone`) but landed in no v2 phase; ADR-040 records its ADOPT-LATER verdict and unblocking conditions.

**The precedent.** Every phase touching the database reuses the sidecar-update machinery already trusted in production — `pg_dump` + `pg_basebackup` snapshot, candidate rehearsal, smoke/recall suites, swap, auto-rollback — the same envelope PRD-018's hygiene ops ran through on 2026-07-05. The W-D parallel column and its index, the W-E throwaway restore, and the W-A/W-C sweeps all inherit that safety envelope rather than inventing a new one; raw SQL fixes in place are rejected precisely because they bypass both the embedding pipeline and the snapshot/rollback (ADR-036 §D5, unchanged).

---

## 9. Risks

1. **The aggregator distils a thin corpus prematurely.** 405 trajectories is a small base for per-action-pattern Wilson bounds. *Mitigation:* `aggregate_min_samples` (default 20) keeps thin patterns inert; the Wilson lower-bound (not the raw rate) prevents a handful of labels from moving the ranking; `feed_retrieval` is additionally W-B-gated and fail-open. A thin corpus produces *inert* aggregates, which is the correct result, not a failure.
2. **A promoted consumer silently regresses recall.** SONA/attention/relevance change retrieval geometry. *Mitigation:* none is enabled without a recorded passing W-B run at that configuration (metric 5); the exact-token class specifically guards against trading exact-token recall for semantic gains; every consumer is fail-open (SONA to the identity transform, attention to the baseline formula). This is the exact gate DDD-016 §12 open question 1 named.
3. **The embedding evaluation is mis-read as a migration mandate.** `bge-m3`'s "already deployed" convenience could be mistaken for a quality argument. *Mitigation:* the PRD commits to evaluation only; the honest benchmark reading (bge-m3 second-weakest of four) is stated up front; `bge-large-en-v1.5` is evaluated alongside; `embedding_active_column` stays 384-dim absent a recorded harness pass; the parallel column keeps the current index untouched so rollback is a flag flip.
4. **The Xinference latency profile is unknown and could make dual-write block writes.** No source measures `bge-small` vs `bge-m3` on this hardware; `bge-m3` is 17× the parameters. *Mitigation:* the mandatory five-minute pre-check runs before any dual-write code; if CPU-bound, dual-write is async/queued and never blocks the synchronous 384-dim write.
5. **Legacy mining re-introduces the degenerate-signal pathology.** Feeding archive telemetry into effectiveness would repeat the `feedback(true)` failure. *Mitigation:* structural/frequency signals only; `confidence_prior:LOW` set unconditionally; candidates inert in a dedicated namespace; graduation requires real live-corroborated graded outcomes; a hard metric (metric 9) asserts no mined candidate ever enters an `EffectivenessAggregate`. This is the load-bearing honesty constraint (extends I04).
6. **The throwaway mining container leaks into production.** Reusing the live snapshot machinery, or network-attaching the container, could corrupt the sidecar. *Mitigation:* distinctly-named `mining-*` container/volume, never registered in `agentbox.toml`, never on the compose network; read-only SELECTs; `docker rm -v` teardown; physical snapshot mount preferred to avoid schema drift.
7. **Prompt-injection / secrets in old telemetry.** The archive pre-dates secret-scanning discipline and may embed adversarial output. *Mitigation:* the fail-closed `SECRET_PATTERNS` + Aho-Corasick injection + zero-width/homoglyph screen runs over every blob before it leaves the throwaway boundary; unredactable records are dropped, never persisted.
8. **Provenance dilution merges proxy candidates into promoted retrieval.** A mined or structural candidate could be silently promoted. *Mitigation:* the `metadata.provenance ∈ {judge:trajectory, proxy:legacy-mining, proxy:structural}` tier (DDD-018 I18) makes only `judge:trajectory` eligible for `feed_retrieval`; contradiction suppresses rather than merges (ADR-098 ethic).
9. **The reserved capabilities rot as dead config.** The sixth stream and any un-promoted consumer sit behind off gates. *Mitigation:* each is a concrete, testable precondition (a passing W-B run, a chosen linking heuristic, a mirror-staleness fix), not an open-ended "later"; if the evidence never justifies them, staying off is the correct outcome, recorded in ADR-040 with unblocking conditions.
10. **W-B's absorption band masks a real regression.** Too wide a band lets a genuine recall loss pass. *Mitigation:* the band is tight (≥187/200, ≥118/120), taken as the median of 3 runs to filter only HNSW `ef_search` jitter, with a per-namespace breakdown surfaced to catch a regression localised to one namespace that a corpus-wide average would hide.

---

## 10. Docs to keep in sync

On landing, update together (the `CLAUDE.md` §"Docs To Keep In Sync" list applies):

- [`README.md`](../../../README.md)
- [`docs/user/quickstart.md`](../../user/quickstart.md)
- [`CLAUDE.md`](../../../CLAUDE.md) (agentbox — the RuVector-memory section)
- [`docs/ruvector-system-reference.md`](../../../../docs/ruvector-system-reference.md) — the 2026-07-21 state (producer live, aggregator absent, consumers off, bge-m3 idle, 11G archive unmined) and, on landing, the entries this PRD closes
- this PRD-020, [ADR-040](../adr/ADR-040-learning-consumers-model-lifecycle-and-legacy-mining.md), [DDD-018](../ddd/DDD-018-learning-consumers-and-model-lifecycle-domain.md)
- [PRD-018](PRD-018-ruvector-native-memory-and-learning.md), [ADR-036](../adr/ADR-036-ruvector-capability-adoption-and-learning-loop.md), [DDD-016](../ddd/DDD-016-memory-learning-domain.md) — the shipped predecessor triple; ADR-036's `review_trigger` is fired by ADR-040

### Cross-references

- [PRD-018 — RuVector-native memory and learning](PRD-018-ruvector-native-memory-and-learning.md) — **the shipped predecessor**; W-A implements the D1 aggregation stage PRD-018 specified but never built, and this PRD consumes the corpus PRD-018's producer now generates
- [ADR-040 — Learning consumers, model lifecycle and legacy mining](../adr/ADR-040-learning-consumers-model-lifecycle-and-legacy-mining.md) — this PRD's decision record; fires ADR-036's `review_trigger`
- [DDD-018 — Learning-consumers and model-lifecycle domain](../ddd/DDD-018-learning-consumers-and-model-lifecycle-domain.md) — this PRD's domain model; continues DDD-016's invariants at I14+
- [ADR-036 — RuVector capability adoption and learning loop](../adr/ADR-036-ruvector-capability-adoption-and-learning-loop.md) — the eight decisions D1–D8 and the `review_trigger` this programme fires
- [DDD-016 — Memory-learning domain](../ddd/DDD-016-memory-learning-domain.md) — invariants I01–I13 + I-GOV that remain law; §12 open question 1 (the recall harness) is answered by W-B
- [PRD-011 — Ontology bridge](PRD-011-ontology-bridge.md) — the 5,975-class corpus the reserved sixth stream would link against
- [PRD-008 — Code-as-Harness integration](PRD-008-code-as-harness-integration.md) — URN-reuse precedent
- [PRD-017 — Sovereign project tracking](PRD-017-sovereign-project-tracking.md) — additive-substrate precedent
- [ADR-005 — Pluggable adapter architecture](../adr/ADR-005-pluggable-adapter-architecture.md)
- [ADR-008 — Privacy filter routing](../adr/ADR-008-privacy-filter-routing.md)
- [ADR-012 — JSON-LD 1.1 adoption](../adr/ADR-012-jsonld-federation-grammar.md)
- [ADR-013 — Canonical URI grammar](../adr/ADR-013-canonical-uri-grammar.md)
- [ADR-015 — MCP RuVector mandate](../adr/ADR-015-mcp-ruvector-mandate.md) (amended 2026-07-04)
- [`docs/ruvector-system-reference.md`](../../../../docs/ruvector-system-reference.md) — verified ground truth
- [`management-api/lib/uris.js`](../../../management-api/lib/uris.js) — URN minting
- [`scripts/ruvector-sidecar-update.sh`](../../../scripts/ruvector-sidecar-update.sh) — the gated snapshot/rehearse/swap/rollback machinery every DB-touching phase reuses
