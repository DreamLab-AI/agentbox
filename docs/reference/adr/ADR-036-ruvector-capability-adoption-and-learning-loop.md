---
id: ADR-036
title: "RuVector capability adoption and learning loop"
status: proposed
date: 2026-07-04
type: architecture
author: Dr John O'Hare
depends_on: [ADR-005, ADR-008, ADR-012, ADR-013, ADR-015]
related: [PRD-018, DDD-016, PRD-001, ADR-035, DDD-003, DDD-004, ADR-027, ADR-029]
review_trigger: a ninth capability-adoption decision is needed (forces a re-evaluation of the ADOPT-NOW / ADOPT-LATER / SKIP verdicts); an ADOPT-LATER capability (SONA, relevance-feedback, attention re-rank) is promoted to ADOPT-NOW and needs a recall-regression harness; the native ruvector_hybrid_search collection engine is justified over DIY fusion (forces a tsvector migration decision); a second durable writer to ruvector-postgres is proposed (re-opens D2 consolidation); or the learning loop acquires state that does not fit the memory + events adapter slots
"@context": https://schema.org
"@type": TechArticle
---

# ADR-036 — RuVector capability adoption and learning loop

**Status:** Proposed (v1)
**Date:** 2026-07-04
**Repo:** DreamLab-AI/agentbox
**Related:** PRD-018 (RuVector-native memory and learning — product goals, adoption menu, retrieval UX, hygiene programme), DDD-016 (Memory-learning domain — ubiquitous language, aggregates, invariants), PRD-001 (Capabilities and adapters — the five-slot product spec), ADR-005 (Pluggable adapter architecture + observability middleware), ADR-008 (Privacy filter routing), ADR-012 (JSON-LD encoder), ADR-013 (Canonical URI grammar — the 18 kinds), ADR-015 (MCP RuVector mandate) **and its 2026-07-04 amendment** (embedding-pipeline correction: Xinference/bge-small-en-v1.5, two MCP copies), ADR-035 (Project tracking — the additive-substrate precedent this ADR follows), DDD-003 (Sovereign data-stack invariants), DDD-004 (Adapter middleware ordering, §L08), ADR-027 (Default-secure posture), ADR-029 (Fail-open egress precedent)

## TL;DR for newcomers
*Skip if you already know that the sidecar is a strong store with a severed learning loop, and that we close the gap additively — no new slot, no new kind, no new port, everything default-off.*

A live 7-agent audit on 2026-07-04 (`docs/ruvector-system-reference.md`) established the ground truth: the `ruvector-postgres` sidecar in this container is a **high-quality semantic memory store** — 191 live SQL functions, AVX-512 SIMD HNSW, solid and stable recall (self-recall@10 188/200, true recall@10 119/120) — wrapped around a **learning loop that does not exist**. The widely-believed claim that "the system learns which bash-call patterns are more effective" was **refuted** by two independent adversarial verifiers (confidence 0.97 and 0.93). It fails at four break points: `post-bash` is a no-op (no dispatch case), router confidence is a hardcoded constant, the one real feedback wire is fed only `feedback(true)` and its confidence field is fetched but never scored, and the purpose-built `trajectories`/`trajectory_steps` tables are **empty**. The historical hooks corpus is unusable as training data: outcome labels ~99.9% positive, `duration` hardcoded 0 everywhere. Alongside this: two diverged MCP server copies (one governed, one ungoverned fork), 178,238 rows with `namespace`↔`value` swapped, 429 NULL-embedding rows (16 as recent as 2026-06-09), and ~1.84M rows (~89%) of frozen legacy telemetry bloating the HNSW index.

The insight that drives every decision below: **these are wiring gaps, not capability gaps.** The extension already exposes hybrid fusion, diagnostics and trajectory tables; the retrieval features the `agentdb-*` skills assume are one MCP tool away; the learning loop needs an honest hook path, not a training pipeline. So we close the gaps the way ADR-035 landed project tracking — additively. One governed MCP server is the sole durable writer; durable state rides the existing **memory** and **events** adapter slots; every identifier is minted through `management-api/lib/uris.js` under an existing kind; every new behaviour is manifest-gated in `agentbox.toml` and default-off so the shipped default is byte-for-byte today's behaviour. We adopt exactly the four capabilities that have a live substrate and validated behaviour (ADOPT-NOW), reserve the rest behind off gates (ADOPT-LATER), and refuse the ones with no substrate or irreversible action (SKIP).

**If you remember only one thing:** the learning loop was severed, not absent — we re-wire it honestly (real graded outcomes, real measured duration, Wilson-bounded aggregates) into empty tables that already exist, adding no adapter slot, no URN kind, and no port, with every gate defaulting to today's behaviour.

For the deep version, keep reading.

## Context

### What the audit established (treat as fact)

The reference document `docs/ruvector-system-reference.md` is the verified ground truth for this ADR; PRD-018 and DDD-016 draw the same conclusions from the same evidence. The findings that shape the decisions:

- **The store is genuinely strong.** 191 SQL functions on extension 0.3.0 (image `2.0.5@sha256:7fb09d43`, PG 17.9), five operators (`<=>` cosine, `<->` L2, `<#>` inner product), `hnsw` + `ruivfflat` access methods, AVX-512 confirmed active. Attention, GNN, hyperbolic, SONA, self-healing and hybrid search all returned real output when called live. We use a fraction: store + HNSW cosine search.
- **Embeddings are client-side.** Both MCP servers compute embeddings via Xinference (`bge-small-en-v1.5`, 384-dim) and INSERT the vector directly. The Postgres-side `generate_text_embedding()` is a character-hash stub, never called on the live path. This is the substance of the **2026-07-04 ADR-015 amendment** — the mandate stands, the mechanism was mis-documented as MiniLM/`generate_text_embedding()`.
- **The learning claim is refuted**, at four exact break points: (1) `post-bash` handler is a bare `console.log` fall-through — the one place a bash outcome could be observed touches nothing; (2) router "Confidence: 80.0%" is a literal `0.8` on regex match, read and written nowhere; (3) the one real confidence write/read-back in `intelligence.cjs` is fed only `intelligence.feedback(true)` (hardcoded) and its scoring formula (`0.6·Jaccard + 0.4·PageRank`) never includes the confidence it fetches (`intelligence.cjs:459`); (4) `trajectories`/`trajectory_steps` — schema purpose-built for exactly this — hold **0 rows**.
- **The telemetry substrate is degenerate.** Historical outcome labels ~99.9% positive; `duration` hardcoded 0 in 100% of `performance-metrics` rows; the hooks corpus dead since 2026-01-23. Any loop that consumes this as-is learns nothing.
- **Two MCP servers, one database.** Governed `mcp/servers/ruvector-mcp.cjs` (registered `claude-flow`, carries `PROTECTED_NAMESPACES`) versus the ungoverned personal fork `~/.claude/ruvector-mcp.cjs` (registered `ruvector`, no governance guard). Same DB, identical write scheme.
- **Data rot.** 178,238 rows (8.65%) `namespace`↔`value` swapped (invisible to namespace-scoped queries, still reachable semantically because embeddings were computed on the real content); 429 NULL-embedding rows (413 migration + 16 raw-SQL bypasses to 2026-06-09 — the exact anti-pattern CLAUDE.md forbids); ~1.84M rows (~89%) frozen legacy telemetry, write-only, bloating the index; `agentbox.sh backup` omits `ruvector_postgres_data_v2`.

### The framing tension

Like ADR-035, this work is genuinely *new behaviour* that must land as *additive use of existing substrate*, not a parallel stack. Every decision below names the parallel-stack option and rejects it. The non-negotiable repo rules bound the solution space before we start: no new adapter slot, no new port, no new URN kind; durable state rides the memory + events slots; every durable id minted via `uris.js`; adapter middleware order is observability → privacy filter → JSON-LD encoder; every new behaviour manifest-gated and default-preserving.

## Decision

Eight decisions, D1–D8. Each records the decision, the alternatives considered and rejected, and the consequences. D6 carries the consolidated manifest-gate table; D7 carries the adapter-contract compliance statement and the URN allocations.

### D1 — Learning loop: close the severed loop honestly

**Decision.** Introduce an **agentbox-owned** hook path (not the refuted ruflo CLI path) that records real `(state, action, outcome, duration)` tuples into the empty, purpose-built `trajectories`/`trajectory_steps` sidecar tables, then aggregates per-action **effectiveness** into a retrievable memory namespace that — gated — re-ranks retrieval and advises routing.

- **State** = task/session context: prompt digest, active namespace, prior step id. Captured at the pre-hook.
- **Action** = the observed unit: a bash command pattern, an edit, a subagent task.
- **Outcome** = a **real, graded** label, never a constant. Sources, in priority: bash `exitCode`; test pass/fail; a subagent's actual success flag from the tool payload; a downstream-correction signal (edit reverted, or a later command failed within the same trajectory). `trajectory_steps.quality` (double precision, already in schema) holds the graded score.
- **Duration** = wall-clock measured *by the agentbox hook itself* (pre-hook timestamp → post-hook timestamp), never the ruflo `duration=0`.
- **Schema migration (additive):** the shipped `trajectory_steps` table has **no duration column** and no index on `trajectory_id` (live columns: `id, trajectory_id, action, result, quality, step_order, created_at`). D1 therefore includes `ALTER TABLE trajectory_steps ADD COLUMN duration_ms double precision;` and `CREATE INDEX idx_trajectory_steps_trajectory ON trajectory_steps(trajectory_id);`, run through the D5 gated-ops machinery before recording begins.

**Aggregation → retrieval/routing.** A step is aggregated by action-pattern into an effectiveness record: **Wilson lower-bound** success rate (not raw rate) with **recency half-life decay** (`recency_half_life_days`, default 14). An aggregate influences nothing until it clears `aggregate_min_samples` (default 20). Aggregates live on the **memory** slot (`namespace = memory-learning-aggregates`), not a new table. Gated consumers: (a) `feed_retrieval` — memories linked to high-effectiveness patterns get a re-rank bonus in `memory_search`; (b) `feed_routing` — aggregates surface as *advisory* `[INTELLIGENCE]` hints, never a hard gate.

Designed against the four documented failure modes: the agentbox hook has an explicit post-command handler that writes the tuple (no delegation to ruflo's caseless dispatch table); outcome is derived from a real signal and **if it cannot be determined the step is skipped, never written as `true`** (graded `quality`, not binary); duration is measured locally so a zero is a bug signal, not a stored value; aggregates are consumed by an explicit, inspectable re-rank term, with the Wilson bound and sample floor preventing a single degenerate label from moving the needle.

**Alternatives considered.**
- *Re-wire ruflo's `feedback()` to pass a real bool.* Rejected: ruflo is a Nix-baked, ungoverned vendored binary; its scoring formula ignores confidence anyway; patching a severed wire inside code we do not own is invisible to governance and re-drifts on every upstream bump.
- *Wire SONA / relevance-feedback as the primary loop now.* Rejected: both change retrieval geometry with unvalidated behaviour and are ADOPT-LATER (need a recall-regression harness first). v1 must first produce a clean, inspectable trajectory corpus; SONA is a downstream *consumer* of it (D4 reserves the gate).
- *Binary success only.* Rejected: reproduces the degenerate-label failure. Graded `quality` + real `duration` are the point.

**Consequences.** For the first time the empty trajectory tables carry real, graded, timed records, and the "does it learn?" question has an inspectable answer instead of a marketing box. The loop is honest by construction (skip-on-undetermined, Wilson bound, sample floor) so it cannot regress to the 99.9%-positive corpus. Cost: a corpus takes time to reach `aggregate_min_samples`, so `feed_retrieval`/`feed_routing` are inert until the box has done real work — acceptable, because the alternative is influence from noise.

### D2 — MCP consolidation: one governed server

**Decision.** The single durable writer is `mcp/servers/ruvector-mcp.cjs` (registered `claude-flow`, carries `PROTECTED_NAMESPACES`). The ungoverned personal fork `~/.claude/ruvector-mcp.cjs` (registered `ruvector`) is **deprecated and de-registered** at boot: the entrypoint rewrites both Claude and Codex configs to point only at the governed script, replacing the fork registration if present. **`PROTECTED_NAMESPACES` is elevated to an invariant** — every write passes `checkProtectedNamespace` (default `governance-precedents`, `RUVECTOR_ADMIN_WRITE` override) — and DDD-016 records it as domain law **I-GOV**.

No data migration: both copies used the identical `id=agentbox:<ns>:<key>`, `source_type='agentbox'` scheme, so de-registration is sufficient.

**Alternatives considered.**
- *Keep both, add the guard to the fork.* Rejected: two diverged copies re-drift; a user-level ungoverned server is outside repo control and defeats the invariant.
- *Fold the MCP server into the management-api ADR-005 adapter (single code path).* Rejected for v1: the MCP server is a Claude-Code-spawned stdio process with a different lifecycle than the HTTP adapter. Unifying is a larger refactor; D7 instead reconciles observability across the two paths and records the merge as intent (D8 non-goal).

**Consequences.** Every durable write to `ruvector-postgres` now passes one governance guard, closing the ungoverned-write hole the fork left open (the mechanism behind finding #3). One code path to reason about and version. The recorded cost is honest: the stdio↔HTTP unification is deferred, so two dispatch surfaces coexist in v1 and their observability must be reconciled by hand (D7) until the merge is paid.

### D3 — Retrieval upgrades (KHIVE-informed)

**Decision.** Fix the metadata write, add hybrid scoring, typed memory with TTL, tag retrieval, and a cold-start orient tool — all on the memory slot, all gated.

- **Enabling fix:** `memory_store` stops hardcoding `metadata='{}'` (`memory-tools.js:114`). Under `typed_metadata` it writes `{importance:float, tags:[…], memory_type:'episodic'|'semantic', ttl_seconds?}`. The 6,121 existing `agentbox` rows have empty metadata → clean slate.
- **Hybrid scoring** (`memory_hybrid_search`, gated `hybrid_search`): baseline **`0.6·cosine_sim + 0.2·importance + 0.2·recency`** (cosine_sim = `1 − (embedding <=> qv)`; recency = half-life decay on `updated_at`), **blended with keyword** via `ruvector_hybrid_score(vec_dist, ts_rank, alpha)` + `websearch_to_tsquery` builtin FTS. Namespace-scoped is production-ready today (EXPLAIN ANALYZE 75 ms via `idx_memory_namespace`, no GIN needed). This is the DIY fusion path (ADOPT-NOW), not the native collection engine.
- **Tag retrieval** via `metadata @> '{...}'`, made cheap by a `gin(metadata jsonb_path_ops)` index (turns a 365k-cost seq scan into a bitmap index scan). GIN build is a gated hygiene op (D5), flag `metadata_gin`.
- **Episodic vs semantic + TTL:** `memory_type` in metadata. *Episodic* = session/task-scoped, TTL-bounded (default 30 d), swept. *Semantic* = durable curated lessons, no TTL. This **finally honours the dead `ttl` param** (advertised at `ruvector-mcp.cjs:196`, silently dropped at `ruvector-mcp.cjs:348`) and **implements `delete`** (currently unimplemented at `ruvector-mcp.cjs:366`) via the episodic sweep (`episodic_ttl_sweep`).
- **`memory_orient`** (gated, ADOPT-NOW): an OODA cold-start tool. Given a task string it returns one bundle — top-k semantic memories + relevant effectiveness aggregates (D1) + live episodic context for the session — via CTEs over the sidecar. This is the `orient()` the `agentdb-*` skills already assume; we provide it as an MCP tool with **no new extension function**.

**Alternatives considered.**
- *Keep pure-vector `<=>` only (status quo).* Rejected: misses exact-token queries (error codes, `CUDA_ARCH`, filenames), has no importance/recency weighting, returns nothing structured at cold start.
- *Native `ruvector_hybrid_search` collection engine now.* Rejected for v1 (ADOPT-LATER): needs a `tsvector` generated column + a heavy 2.06M-row FTS GIN (full-corpus hybrid EXPLAINs to a 6-worker parallel seq scan, cost 432k). DIY fusion wins scoped retrieval today at zero schema change; the native path is the *enabling migration* only if unscoped hybrid is later justified.
- *External reranker / embedding service.* Rejected: adds a non-sovereign hop; the extension + builtin FTS are entirely local.

**Consequences.** Retrieval gains exact-token recall, importance/recency weighting, typed lifecycle and a cold-start bundle — the features the skills assumed existed — while the metadata fix and `delete`/`ttl` implementation close three long-standing dead-code gaps. All at zero schema change and inside the sovereign boundary. Cost: `typed_metadata` introduces a metadata contract that DDD-016 must own as domain law, and the DIY fusion ceiling is scoped queries; unscoped hybrid remains a future migration.

### D4 — Extension leverage: first-class MCP wrappers (ADOPT-NOW only)

**Decision.** Wrap exactly the four ADOPT-NOW capabilities; reserve the rest behind off gates.

| Capability | Surface | Verdict |
|---|---|---|
| Hybrid DIY fusion (`ruvector_hybrid_score` + PG FTS) | `memory_hybrid_search` tool (D3) | ADOPT-NOW |
| Read-only diagnostics (`ruvector_health_status`, `ruvector_is_healthy`, `ruvector_system_metrics`, `ruvector_simd_info`) | `memory_health` tool + `agentbox.sh ruvector health` line; feeds `agentbox_adapter_health` | ADOPT-NOW |
| Trajectory recording (`trajectories`/`trajectory_steps` INSERTs) | D1 hook path | ADOPT-NOW |
| GIN on `metadata` jsonb | gated hygiene build (D5) | ADOPT-NOW |

**Explicitly deferred (gate reserved, default off):** SONA (`ruvector_sona_learn`), relevance-feedback learning (`ruvector_enable_learning`/`ruvector_record_feedback`), attention re-rank (`attention_score`) — all ADOPT-LATER, consume the D1 corpus, gate behind a recall harness. **Skipped:** auto-execute self-healing (`ruvector_healing_execute` — irreversible reindex/replica-failover), GNN aggregates (no node/edge substrate), multi-tenancy RLS (single-tenant container).

**Alternatives considered.**
- *Surface all 191 functions.* Rejected: most have no agentbox substrate (GNN, tenancy) or unvalidated behaviour (SONA); a broad wrapper is untested surface area.
- *Auto-run self-healing on the health signal.* Rejected: `healing_execute` includes irreversible strategies; diagnostics stay read-only, remediation manual.

**Consequences.** The four capabilities with a live substrate and validated behaviour become first-class MCP surface; the powerful-but-unvalidated remainder is reserved, not exposed, so v1 ships no untested surface. Cost: the ADOPT-LATER set (SONA, relevance-feedback, attention) stays latent until a recall-regression harness exists to validate the change in retrieval geometry — a deliberate deferral, recorded so the review trigger fires when they are promoted.

### D5 — Data hygiene operations (gated, rollback-backed)

**Decision.** Three operational tasks as `agentbox.sh ruvector <op>` subcommands, **reusing the existing gated update machinery** (`ruvector-sidecar-update.sh`: pg_dump + pg_basebackup snapshot + candidate rehearsal + smoke/recall suite + swap + auto-rollback). All **dry-run by default**; the non-dry-run path requires the corresponding `[memory_hygiene]` flag.

1. **`repair-namespaces`** — 178,238 rows (8.65%) have `namespace`↔`value` swapped. Detect (namespace looks like JSON / value looks like a bare namespace token) and swap back. Low urgency: embeddings were computed on real content so semantic search already reaches them; this restores namespace *scoping*.
2. **`backfill-embeddings`** — 429 NULL-embedding rows (413 migration + 16 raw-SQL bypasses to 2026-06-09). Recompute via Xinference for non-empty values; quarantine the un-embeddable. Enforces the MCP-only-writes rule going forward.
3. **`archive-legacy`** — ~1.84M rows (~89%) frozen legacy telemetry (`legacy/*`, `swarm/*`, dead hooks namespaces; write-only, never read). Dump to cold storage, then delete from the hot table to free the HNSW index. Reversible (dump retained).

Also close known gap #12: add `ruvector_postgres_data_v2` to `agentbox.sh backup` `cmd_backup`.

**Alternatives considered.**
- *Raw SQL fixes in place.* Rejected: raw INSERT/UPDATE bypasses the embedding pipeline (the exact NULL-embedding anti-pattern CLAUDE.md forbids) and has no snapshot/rollback.
- *Leave legacy rows.* Rejected: 89% frozen rows bloat the HNSW index; archival (not deletion-without-backup) frees the index while staying reversible.

**Consequences.** The three data-rot findings become operator-runnable repairs that inherit the audited snapshot + auto-rollback flow, and the backup gap is closed so the 2M-row volume is captured. All destructive paths are dry-run-by-default and flag-gated, so the safe default is inspect-only. Cost: `archive-legacy` deletes from the hot table (reversible via retained dump), so the operator must trust the dump — the same trust the existing update flow already requires.

### D6 — Manifest gates (exact keys, all default-off / behaviour-preserving)

**Decision.** Every new behaviour is opt-in through `agentbox.toml`. The default state equals today: pure-vector `<=>` search, no typed metadata, no learning, no ops.

```toml
[integrations.ruvector_external]
# existing: enabled, conninfo, manage_sidecar, image, data_volume
hybrid_search      = false   # memory_hybrid_search (DIY fusion)
typed_metadata     = false   # honour importance/tags/memory_type/ttl on memory_store
metadata_gin       = false   # require/build GIN on metadata jsonb
health_tool        = false   # memory_health read-only diagnostics
episodic_ttl_sweep = false   # honour TTL, sweep expired episodic entries (implements delete)

[memory_learning]
enabled              = false  # master gate for the learning loop
record_trajectories  = false  # agentbox hook writes trajectories/trajectory_steps
aggregate_min_samples = 20    # Wilson-bound sample floor before an aggregate influences retrieval
recency_half_life_days = 14
feed_retrieval       = false  # effectiveness aggregates re-rank memory_search
feed_routing         = false  # aggregates surface as advisory [INTELLIGENCE] hints
sona_enabled         = false  # ADOPT-LATER, reserved
relevance_feedback   = false  # ADOPT-LATER, reserved

[memory_hygiene]             # flags only enable the non-dry-run path of agentbox.sh ruvector <op>
allow_namespace_repair   = false
allow_embedding_backfill = false
allow_legacy_archival    = false
```

**Alternatives considered.**
- *One coarse `[memory_learning].enabled` master switch.* Rejected: retrieval upgrades (D3) are useful without the learning loop and vice-versa; independent gates let each land and be evaluated alone (the CLAUDE.local.md experiment posture).
- *A new `[ruvector]` top-level table.* Rejected: the sidecar config already lives under `[integrations.ruvector_external]`; retrieval flags extend it, learning gets its own `[memory_learning]` block (a distinct concern), hygiene its own. No orphan top-level table.

**Consequences.** A default agentbox behaves exactly as today — the safe, reversible landing PRD-018 requires — and each capability can be enabled and evaluated in isolation, matching the guidance-control-plane experiment posture in CLAUDE.local.md. Cost: three config blocks and fourteen flags are a broader surface than one switch; the independence is worth it because retrieval, learning and hygiene are genuinely separable concerns with different risk profiles.

### D7 — Adapter-contract compliance (per feature)

**Decision.** Every feature composes onto the existing adapter contract with no new slot, no new kind and no new port.

**Slots & URNs (no new slot, no new kind).**
- Memory reads/writes (store, hybrid_search, orient, health) → **memory** slot.
- Durable learning records → **events** slot (a trajectory is a lifecycle/action receipt, exactly as ADR-035 routed scans to events). Ids minted via `management-api/lib/uris.js`, stored in the sidecar tables' `id text PK`:

| Entity | URN | Kind rationale |
|---|---|---|
| Trajectory | `urn:agentbox:activity:<scope>:sha256-12-<hash>` | A trajectory is a PROV-O action receipt → `activity` (the ExecutionTrace/ProjectScan precedent). The `activity` kind is content-addressed in `uris.js` — `mint()` computes the bare `sha256-12-<hash>` local part unconditionally, so the `trajectory` semantics travel in the record payload (`type: 'trajectory'`), never the local part |
| Distilled effectiveness aggregate | `urn:agentbox:memory:<scope>:effectiveness-<sha256-12>` | A retrievable, distilled lesson → `memory` (the DistilledLesson/ProjectPrimer precedent) |

`<scope>` = the 64-character BIP-340 x-only hex pubkey; every record carries `owner_did = did:nostr:<hex>`. This is the Code-as-Harness / ADR-035 pattern applied verbatim: new capabilities map onto the existing 18 kinds rather than extend the grammar. The grammar's value is its closure — one resolver, one `/v1/uri/<urn>` route — and the BC20 anti-corruption bridge's mapping surface is unchanged.

**Middleware order (every management-api dispatch): observability → privacy filter (ADR-008) → JSON-LD encoder (ADR-012)**, in that order, with privacy redaction completing before the encoder runs (DDD-004 §L08). Trajectory records contain command text → the privacy filter redacts secrets/paths before persist.

**Observability.** New memory tools emit the ADR-005 span `agentbox.adapter.memory.<method>` + `agentbox_adapter_dispatch_total{slot,method,impl,outcome}` + `agentbox_adapter_duration_seconds`; `memory_health` feeds `agentbox_adapter_health`. This closes the surface gap where the MCP path emitted no ADR-005 telemetry. Where a tool must run in the stdio server (outside the HTTP adapter), it emits the equivalent structured JSON log + a metrics beacon, and the reconciliation debt (the D2 stdio↔HTTP merge) is recorded as intent.

**Fail semantics (explicit per feature).**

| Feature | Semantics |
|---|---|
| `memory_store` typed metadata | fail-closed on PROTECTED_NAMESPACES; embedding-degrade behaviour preserved |
| `memory_hybrid_search` / `memory_orient` | **fail-open** → degrade to pure-vector, then ILIKE |
| trajectory recording hook | **fail-open** (never blocks Claude) but **fail-closed on privacy redaction** — skip the write rather than persist unredacted |
| `memory_health` | read-only, fail-open |
| effectiveness aggregates feeding retrieval | fail-open, advisory; store unavailable → baseline ranking |
| hygiene ops (D5) | fail-closed / gated; snapshot + auto-rollback |

**Alternatives considered.**
- *A new `trajectory` slot/kind.* Rejected by repo rule and by the ADR-035 precedent — `activity`/`memory`/`event` already fit; the grammar's value is its closure (18 kinds, one resolver).
- *Persist raw command text.* Rejected: leaks secrets/paths; the privacy filter is mandatory and fail-closed on this path.

**Consequences.** The learning loop and retrieval upgrades inherit the three middleware layers, the contract-test harness and both federation modes for free, exactly as project tracking did — and the previously-untelemetered MCP path finally emits ADR-005 spans and metrics. The one genuinely new privacy obligation (command text on the trajectory path is fail-closed on redaction) is stated as domain law in DDD-016. Cost: the stdio-server tools emit an *equivalent* structured-log + beacon rather than a native span until the D2 merge is paid — reconciliation debt, recorded, not hidden.

### D8 — Non-goals (explicit exclusions)

**Decision.** The following are out of scope for v1 and recorded so a future proposal re-opens them deliberately:

- **No new adapter slot, no new port, no new URN kind.** Durable state rides memory + events; ids reuse `activity` / `memory`.
- **No RL training pipeline.** Trajectories are recorded and aggregated with simple, inspectable statistics (Wilson bound + recency decay). No gradient training. SONA and relevance-feedback are reserved behind off gates as the v2 consumers of the corpus.
- **No per-caller identity/mandate system.** `PROTECTED_NAMESPACES` stays the existing global env gate (elevated to invariant, not a new auth subsystem).
- **No native `ruvector_hybrid_search` collection engine / tsvector migration** (DIY fusion only).
- **No auto-execute self-healing, no GNN graph substrate, no multi-tenancy RLS.**
- **No merge of the stdio MCP server into the management-api HTTP adapter** (reconciliation debt recorded, not paid).
- **No host-project specifics** — host referenced by role only.

**Consequences.** The v1 blast radius is bounded to wiring and hygiene; the powerful, unvalidated or substrate-less capabilities are named and deferred so the review triggers fire when any is promoted. Cost: the deferred items are real value left on the table (native hybrid, SONA, the adapter merge) — the ADR is explicit that these are debts, not denials.

## Amendment note — operationalising the 2026-07-04 ADR-015 amendment

This ADR **operationalises** the 2026-07-04 amendment to ADR-015. That amendment corrected the record — embeddings are Xinference `bge-small-en-v1.5` (384-dim), not MiniLM via `generate_text_embedding()`; two MCP copies exist, one governed, one an ungoverned fork — and named consolidation onto the mandated copy as "the recorded intent." ADR-036 turns that recorded intent into decisions: **D2** de-registers the fork at boot and elevates `PROTECTED_NAMESPACES` to invariant I-GOV; **D5 `backfill-embeddings`** recomputes NULL embeddings through the corrected Xinference path and enforces MCP-only writes going forward, closing the 16 raw-SQL bypasses the amendment implicitly indicts. The ADR-015 mandate itself (fail-closed MCP server, no silent sql.js fallback) stands unchanged and is a dependency of this ADR.

## Consequences (overall)

### Positive
- The learning loop is closed **honestly**: real graded outcomes, locally-measured duration, Wilson-bounded aggregates behind a sample floor, skip-on-undetermined — the four documented break points are each addressed by construction, and the "does it learn?" claim becomes inspectable instead of aspirational.
- Retrieval gains hybrid fusion, typed lifecycle, tag search and a cold-start orient bundle, closing three dead-code gaps (`ttl`, `delete`, hardcoded `metadata='{}'`) at zero schema change and inside the sovereign boundary.
- One governed MCP server is the sole durable writer; every write passes the governance guard; the previously-untelemetered MCP path now emits ADR-005 observability.
- Data rot becomes operator-runnable, rollback-backed repairs; the backup gap is closed.
- The whole surface is additive: zero new URN kinds, zero new ports, zero new adapter slots, everything default-off and behaviour-preserving — the grammar's closure (18 kinds, one resolver) and the adapter contract both survive intact.

### Negative
- `activity` and `memory` now hold trajectories/effectiveness alongside execution traces and distilled lessons; disambiguation rests on the local-part prefix (`trajectory-`, `effectiveness-`), a naming convention, not a type-system guarantee — a prefix-filtering consumer must keep its list current (the same cost ADR-035 accepted).
- Fourteen manifest flags across three blocks are a broader configuration surface than a single switch; the independence is deliberate but must be documented so operators do not enable a consumer (`feed_retrieval`) ahead of its producer (`record_trajectories`).
- The D2 stdio↔HTTP merge is deferred, so two dispatch surfaces coexist and their observability is reconciled by hand in v1 (recorded reconciliation debt).

### Risks
- The effectiveness aggregates are advisory and fail-open, but a mis-tuned `recency_half_life_days` or `aggregate_min_samples` could let a stale or thin aggregate nudge retrieval; the Wilson bound + sample floor bound this, and `feed_retrieval`/`feed_routing` default off so the risk is only live once an operator opts in.
- The trajectory path persists command text; the privacy filter is mandatory and fail-closed on this path, so the control point is `management-api` middleware plus the DDD-016 invariant — a future code path that persists a tuple outside that middleware would leak secrets/paths. The single write point is the control surface and must remain the only producer.
- `archive-legacy` deletes ~1.84M rows from the hot table; reversibility rests entirely on the retained dump, the same trust model the existing `ruvector-sidecar-update.sh` flow already carries.
- The ADOPT-LATER set (SONA, relevance-feedback, attention re-rank) changes retrieval geometry; promoting any of them without first building the recall-regression harness the review trigger names would risk a silent recall regression — hence the gates are reserved, not merely off.

## Docs To Keep In Sync
On landing, update together: `README.md`, `docs/user/quickstart.md`, `CLAUDE.md` (agentbox — a RuVector-memory section mirroring the Project-Tracking section), the new PRD-018 / ADR-036 / DDD-016, and `docs/ruvector-system-reference.md` (§5 rot-table entries #3, #4, #5, #6, #11, #12 move to "addressed by PRD-018"). ADR-015 is already amended (2026-07-04). `depends_on: [ADR-005, ADR-008, ADR-012, ADR-013, ADR-015]`.
