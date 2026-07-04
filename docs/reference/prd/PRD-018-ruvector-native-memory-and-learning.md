# PRD-018: RuVector-Native Memory and Learning

**Status:** Draft v1
**Date:** 2026-07-04
**Repo:** [github.com/DreamLab-AI/agentbox](https://github.com/DreamLab-AI/agentbox)
**Related:** PRD-001 (Capabilities and adapters), PRD-008 (Code-as-Harness integration — URN-reuse precedent), PRD-017 (Sovereign project tracking — additive-substrate precedent), ADR-005 (Pluggable adapter architecture — dispatch contract and observability), ADR-008 (Privacy filter routing), ADR-012 (JSON-LD 1.1 adoption), ADR-013 (Canonical URI grammar), ADR-015 (MCP RuVector mandate) + its 2026-07-04 amendment (embedding pipeline correction), ADR-035 (Project-tracking telemetry and Nostr kind — additive-substrate framing), ADR-036 (RuVector capability adoption and learning loop — this PRD's decision record), DDD-003 (Sovereign messaging domain), DDD-004 (Linked-data interchange domain), DDD-016 (Memory-learning domain — this PRD's domain model)

## TL;DR for newcomers

*Skip if you already know that the sidecar is a strong semantic store, that its "learning loop" is severed, and that the fix is wiring not capability.*

Every agentbox session leans on one piece of infrastructure it barely understands: the `ruvector-postgres` sidecar. A 7-agent investigation on 2026-07-04 (five investigators, two adversarial verifiers, recorded in `docs/ruvector-system-reference.md`) put the running system under a microscope and found a split verdict. The store itself is excellent — a real PostgreSQL 17.9 with the RuVector extension 0.3.0 exposing **191 live SQL functions** (attention, GNN, hyperbolic geometry, SONA, self-healing, hybrid search — all returning real output when called), genuine 384-dimensional embeddings from Xinference `bge-small-en-v1.5`, a fast HNSW index with AVX-512 SIMD confirmed active, and stable recall (self-recall@10 188/200, true recall@10 119/120). We use a sliver of it: `memory_store` plus cosine `<=>` search.

The learning story, by contrast, is a fiction we told ourselves. The widely-believed claim that "the system learns which bash-call patterns are more effective" is **refuted** (two independent verifiers, confidence 0.97 and 0.93). The loop is severed at four points: the `post-bash` hook falls through to a bare `console.log` and touches nothing; the router's "Confidence: 80.0%" box is a literal constant; the one genuine feedback wire is fed `intelligence.feedback(true)` hardcoded and its confidence field is fetched but never used in the scoring formula; and the two purpose-built tables — `trajectories`, `trajectory_steps` — hold **zero rows**. The historical telemetry that *would* feed a loop is degenerate anyway: outcome labels ~99.9% positive, `duration` hard-coded to 0 in every performance-metrics row, dead since 2026-01-23. On top of that: **two diverged MCP server copies** write to one database (one governed, one an ungoverned personal fork missing the `PROTECTED_NAMESPACES` guard), 178,238 rows (8.65%) have their `namespace` and `value` columns swapped, 429 rows carry NULL embeddings (16 of them raw-SQL bypasses as recent as 2026-06-09), and ~1.84M rows (~89%) are frozen legacy telemetry that is written and never read.

The unifying insight: **these are wiring gaps, not capability gaps.** The tables to record trajectories exist and are empty. The functions to fuse keyword and vector search exist and are unused. The metadata column exists and is hardcoded to `{}`. This PRD closes the gaps *additively* — one governed MCP server, durable state on the existing **memory** and **events** adapter slots, every identifier minted through `management-api/lib/uris.js` under an existing kind, every new behaviour gated in `agentbox.toml` and defaulting off. It reuses the gated sidecar-update machinery (`agentbox.sh ruvector update`: snapshot, rehearse, smoke, swap, auto-rollback) as the safety precedent for every hygiene operation.

**If you remember only one thing:** the sidecar is already a high-quality learning substrate with 191 live functions and two empty purpose-built tables; we are not building intelligence, we are connecting wires that were left dangling — additively, gated-off by default, honestly graded, and never claiming a loop we have not actually closed.

For the deep version, keep reading.

---

## 1. Problem

### 1.1 The learning loop is severed, and we shipped documentation saying otherwise

The single most consequential finding of the 2026-07-04 audit is that agentbox's implicit promise of outcome learning does not hold. The proposition tested — *"the running system learns over time which bash-call patterns are more effective, and that learning influences future behaviour"* — fails at four independent break points, each verified against live code and the live database:

1. **`post-bash` is a no-op.** `~/.claude/settings.json` wires `PostToolUse/Bash → hook-handler.cjs post-bash`, but the handler dispatch table has **no `post-bash` case**; execution falls through to a bare `console.log`. The one place a bash outcome could be observed touches nothing.
2. **Router confidence is a constant.** The "Confidence: 80.0%" box is `router.js` returning a literal `0.8` on regex match (`0.5` default). No state is read or written, ever.
3. **The one real feedback wire is doubly disconnected.** `intelligence.cjs` has a genuine confidence write/read-back (`feedback() → boostConfidence()`), but (a) it is fed only by `intelligence.feedback(true)` — **hardcoded always-true** on `SubagentStop`, never by an actual bash or test outcome; and (b) the live scoring formula `getContext()` uses `0.6·trigram-Jaccard + 0.4·PageRank` and **never includes the confidence field it fetches** (`intelligence.cjs:459`).
4. **The database confirms stasis.** The `patterns` table holds 10 hand-seeded rows from one batch (`created_at = updated_at`). The `trajectories` and `trajectory_steps` tables — whose schema is purpose-built for exactly this loop — hold **zero rows**. `memory_entries.access_count` is nonzero only in frozen legacy rows; the live write path never touches it.

This is not a subtle degradation. It is a loop that was designed, half-wired, and then documented as if complete. The correct response is not to quietly patch the severed wire inside code we do not own (the ruflo CLI is a Nix-baked, ungoverned vendored binary whose scoring formula ignores confidence regardless); it is to build an **agentbox-owned, governed, inspectable** loop that records real tuples into the empty tables the sidecar already provides.

### 1.2 The telemetry substrate is degenerate where it exists at all

Even if the loop were wired, the historical corpus is unusable as a training signal. The audit found outcome labels ~99.9% positive (a degenerate constant), `duration` hard-coded to `0` in 100% of `performance-metrics` rows, and the whole hooks corpus dead since 2026-01-23. Orphaned learning scripts (`learning-service.mjs`, `learning-hooks.sh`, April 2026) exist but are wired to nothing — no hooks entry, no cron, no supervisor program. Any new loop must therefore refuse to reproduce these pathologies: outcomes must be **really graded** (never a constant), duration must be **really measured** (never zero), and an undetermined outcome must be **skipped, never fabricated as `true`**.

### 1.3 A high-value extension sits almost entirely unleveraged

The extension is real, not vapour: 191 SQL functions, five distance operators, `hnsw` + `ruivfflat` access methods, all confirmed via `pg_depend`. Attention (12 functions), GNN (GCN/GraphSAGE), hyperbolic geometry (Poincaré/Lorentz), self-healing strategies, multi-tenancy, hybrid search, and SONA (Micro-LoRA/EWC++) **all returned real output when called live**. We use store + HNSW search. The gap between what is installed and what is wired is enormous — but most of the unused surface has **no agentbox substrate** (GNN needs a node/edge graph we do not maintain; multi-tenancy RLS is meaningless in a single-tenant container) or **unvalidated behaviour** (SONA changes retrieval geometry and needs a recall regression harness before it can be trusted). The right move is disciplined: adopt only the handful of functions that are production-ready today, reserve the rest behind off gates, and skip outright the ones that are irreversible or substrate-less.

### 1.4 Two MCP servers, one database, one governance guard

Two directly-spawned node scripts write to the same sidecar with the same write scheme (`id=agentbox:<ns>:<key>`, `source_type='agentbox'`):

| MCP name | Script | Governance |
|---|---|---|
| `claude-flow` | `mcp/servers/ruvector-mcp.cjs` (boot-generated `.mcp.json`) | ADR-015-mandated copy; carries the `PROTECTED_NAMESPACES` guard + headroom compression |
| `ruvector` | `~/.claude/ruvector-mcp.cjs` (user-level `~/.claude/.claude.json`) | **Older diverged fork**; missing the governance guard |

Two diverged copies re-drift on every change, and a user-level ungoverned server sits entirely outside repo control — it can write to protected namespaces the governed server refuses. This is a standing governance hole, not a cosmetic duplication.

### 1.5 The corpus itself needs hygiene

Three data-quality defects degrade the store. 178,238 rows (8.65%) have their `namespace` and `value` columns swapped by a migration bug — semantic search still reaches them (their embeddings were computed on the real content), but they are invisible to *namespace-scoped* queries. 429 rows carry NULL embeddings (413 migration artifacts plus **16 raw-SQL bypasses as recent as 2026-06-09** — the exact anti-pattern `CLAUDE.md` forbids), invisible to HNSW entirely. And ~1.84M rows (~89%) are frozen legacy telemetry (`legacy/*`, `swarm/*`, dead hooks namespaces) that is write-only and never read back, bloating the HNSW index for no retrieval benefit. Separately, `agentbox.sh backup` omits the `ruvector_postgres_data_v2` volume entirely (known gap #12).

None of these is catastrophic — the store works and recall is stable — but each is a slow tax on scoping precision, index size, and durability, and each has a clean, reversible remedy.

---

## 2. Goals and non-goals

### 2.1 Goals

1. **Close the learning loop honestly.** Record real `(state, action, outcome, duration)` tuples into the empty `trajectories`/`trajectory_steps` tables via an agentbox-owned hook path, with graded outcomes and locally-measured duration, and aggregate them into a retrievable effectiveness signal that can (gated) re-rank retrieval and advise routing.
2. **Consolidate onto one governed MCP server.** Make `mcp/servers/ruvector-mcp.cjs` the single durable writer, de-register the ungoverned fork at boot, and elevate `PROTECTED_NAMESPACES` to a domain invariant.
3. **Upgrade retrieval.** Add hybrid (keyword + vector) scoring, typed metadata with TTL, tag retrieval, and a cold-start `orient` bundle — all on the memory slot, all gated, all fixing real defects (hardcoded `metadata='{}'`, the dead `ttl` param, the unimplemented `delete`).
4. **Leverage the extension where it is ready.** Wrap exactly the four `ADOPT-NOW` capabilities (DIY hybrid fusion, read-only diagnostics, trajectory recording, the metadata GIN) as first-class MCP surfaces; reserve the rest.
5. **Restore corpus hygiene.** Provide reversible, snapshot-backed operations to repair the swapped rows, backfill NULL embeddings, and archive frozen legacy telemetry, and add the data volume to the backup.
6. **Keep every new behaviour additive and off by default.** Independent manifest gates in `agentbox.toml`; the default state is byte-for-byte today's behaviour.

### 2.2 Non-goals

These are closed decisions for v1, not deferrals-pending-reconsideration (ADR-036 §D8 records each with its rejection):

- **No new adapter slot, no new port, no new URN kind.** Durable state rides the existing **memory** and **events** slots; identifiers reuse the `activity` and `memory` kinds.
- **No RL training pipeline.** Trajectories are aggregated with simple, inspectable statistics (Wilson lower-bound plus recency decay). No gradient training. SONA and relevance-feedback are the *v2 consumers* of the corpus, reserved behind off gates.
- **No per-caller identity or mandate system.** `PROTECTED_NAMESPACES` stays the existing global env gate, elevated to an invariant — not a new auth subsystem.
- **No native `ruvector_hybrid_search` collection engine and no `tsvector` migration in v1.** DIY fusion (`ruvector_hybrid_score` + PostgreSQL builtin FTS) only.
- **No auto-execute self-healing, no GNN graph substrate, no multi-tenancy RLS.** These are irreversible, substrate-less, or meaningless in this container.
- **No merge of the stdio MCP server into the management-api HTTP adapter in v1.** The reconciliation debt is recorded (§7.4), not paid.
- **No host-project specifics.** The host is referenced by role only.

---

## 3. Capabilities

The design is expressed as eight decisions in ADR-036 (D1–D8); this PRD states the *product* requirements. Five capability areas: the learning loop (§3.1), MCP consolidation (§3.2), retrieval upgrades (§3.3), extension leverage (§3.4), and hygiene operations (§3.5).

### 3.1 The learning loop — recorded honestly (ADR-036 D1)

An **agentbox-owned hook path** — not the refuted ruflo CLI path — records real tuples into the empty, purpose-built sidecar tables and aggregates them into a retrievable effectiveness signal.

**The tuple.**

- **State** = task/session context: prompt digest, active namespace, prior step id. Captured at the pre-hook.
- **Action** = the observed unit: a bash command pattern, an edit, or a subagent task.
- **Outcome** = a **real, graded** label, never a constant. Derived, in priority order, from: bash `exitCode`; test pass/fail; a subagent's actual success flag from the tool payload; a downstream-correction signal (an edit reverted, or a later command in the same trajectory failing). The graded score lands in `trajectory_steps.quality` (double precision, already in the schema). **If the outcome cannot be determined, the step is skipped — never written as `true`.**
- **Duration** = wall-clock measured *by the agentbox hook itself* (pre-hook timestamp → post-hook timestamp). A zero duration is a bug signal, not a stored value.

**Aggregation → retrieval and routing.** Steps are aggregated by action-pattern into an effectiveness record scored by **Wilson lower-bound** success rate (not the raw rate) with **recency half-life decay** (`recency_half_life_days`, default 14). An aggregate influences nothing until it clears `aggregate_min_samples` (default 20). Aggregates are stored on the **memory** slot under namespace `memory-learning-aggregates` — not a new table. Two gated consumers: `feed_retrieval` gives memories linked to high-effectiveness patterns a re-rank bonus in search; `feed_routing` surfaces aggregates as *advisory* `[INTELLIGENCE]` hints, never a hard gate.

**Designed against the four documented failure modes.** The post-hook handler explicitly writes the tuple (defeats the `post-bash` no-op); outcomes are derived from real signals and skipped when undetermined (defeats the `feedback(true)` degenerate label); duration is measured locally (defeats `duration=0`); and aggregates are consumed by an explicit, inspectable re-rank term with a Wilson bound and a sample floor (defeats the "confidence fetched but unused" pathology and prevents a single degenerate label from moving the ranking).

### 3.2 MCP consolidation — one governed writer (ADR-036 D2)

The single durable writer is `mcp/servers/ruvector-mcp.cjs` (registered `claude-flow`, carrying `PROTECTED_NAMESPACES`). The ungoverned fork `~/.claude/ruvector-mcp.cjs` (registered `ruvector`) is **deprecated and de-registered at boot**: the entrypoint rewrites both the Claude and Codex configs to point only at the governed script, replacing the fork registration if present. **`PROTECTED_NAMESPACES` is elevated to an invariant** — every write passes `checkProtectedNamespace` (default protected set `governance-precedents`; `RUVECTOR_ADMIN_WRITE` override), and DDD-016 records it as domain law (I-GOV). No data migration is needed: both copies used the identical `id`/`source_type` scheme, so de-registration is sufficient.

### 3.3 Retrieval upgrades (ADR-036 D3)

Five upgrades, all on the memory slot, all gated.

- **Enabling fix.** `memory_store` stops hardcoding `metadata='{}'`. Under `typed_metadata`, it writes `{importance:float, tags:[…], memory_type:'episodic'|'semantic', ttl_seconds?}`. The existing agentbox rows have empty metadata, so this is a clean slate.
- **Hybrid scoring** (`memory_hybrid_search`, gated `hybrid_search`). Baseline `0.6·cosine_sim + 0.2·importance + 0.2·recency` (cosine_sim = `1 − (embedding <=> qv)`; recency = half-life decay on `updated_at`), blended with keyword via `ruvector_hybrid_score(vec_dist, ts_rank, alpha)` over the builtin `websearch_to_tsquery` FTS. Namespace-scoped retrieval is production-ready today (EXPLAIN ANALYZE ~75 ms via `idx_memory_namespace`, no GIN required). This is the **DIY fusion** path (`ADOPT-NOW`), not the native collection engine.
- **Tag retrieval** via `metadata @> '{...}'`, made cheap by a `gin(metadata jsonb_path_ops)` index that turns a seq scan into a bitmap index scan. The GIN build is a gated hygiene op (§3.5), flag `metadata_gin`.
- **Episodic vs semantic, with TTL.** `memory_type` in metadata. *Episodic* = session/task-scoped, TTL-bounded (default 30 days), swept. *Semantic* = durable curated lessons, no TTL. This finally honours the dead `ttl` param (advertised but silently dropped) and **implements the unimplemented `delete`** via the episodic sweep (`episodic_ttl_sweep`).
- **`memory_orient`** (gated, `ADOPT-NOW`). An OODA cold-start tool: given a task string, it returns one bundle — top-k semantic memories, relevant effectiveness aggregates (§3.1), and live episodic context for the session — via CTEs over the sidecar. This is the `orient()` the `agentdb-*` skills already assume, provided as an MCP tool with **no new extension function**.

### 3.4 Extension leverage — ADOPT-NOW only (ADR-036 D4)

Exactly four `ADOPT-NOW` capabilities are wrapped as first-class surfaces; everything else is reserved or skipped.

| Capability | Surface | Verdict |
|---|---|---|
| Hybrid DIY fusion (`ruvector_hybrid_score` + PG FTS) | `memory_hybrid_search` tool (§3.3) | ADOPT-NOW |
| Read-only diagnostics (`ruvector_health_status`, `ruvector_is_healthy`, `ruvector_system_metrics`, `ruvector_simd_info`) | `memory_health` tool + `agentbox.sh ruvector health`; feeds `agentbox_adapter_health` | ADOPT-NOW |
| Trajectory recording (`trajectories`/`trajectory_steps` INSERTs) | §3.1 hook path | ADOPT-NOW |
| GIN on `metadata` jsonb | gated hygiene build (§3.5) | ADOPT-NOW |

**Reserved (gate present, default off):** SONA (`ruvector_sona_learn`), relevance-feedback learning (`ruvector_enable_learning`/`ruvector_record_feedback`), and attention re-rank (`attention_score`) — all `ADOPT-LATER`, all downstream consumers of the §3.1 corpus, gated behind a recall regression harness. **Skipped outright:** auto-execute self-healing (`ruvector_healing_execute` includes irreversible reindex/replica-failover), GNN aggregates (no node/edge substrate), and multi-tenancy RLS (single-tenant container). Diagnostics stay read-only; remediation is always manual.

### 3.5 Data hygiene operations (ADR-036 D5)

Three operational tasks, each an `agentbox.sh ruvector <op>` subcommand, **reusing the existing gated update machinery** (`scripts/ruvector-sidecar-update.sh`: `pg_dump` + `pg_basebackup` snapshot + candidate rehearsal + smoke/recall suite + swap + auto-rollback). All are **dry-run by default**; the non-dry-run path requires the corresponding `[memory_hygiene]` flag.

1. **`repair-namespaces`** — repairs the 178,238 rows (8.65%) with `namespace`↔`value` swapped. Detect (namespace looks like JSON, value looks like a bare namespace token), swap back. Low urgency — semantic search already reaches these rows — this restores namespace *scoping*.
2. **`backfill-embeddings`** — recomputes the 429 NULL-embedding rows (413 migration + 16 raw-SQL bypasses) via Xinference for non-empty values; quarantines the un-embeddable. Enforces the MCP-only-writes rule going forward.
3. **`archive-legacy`** — dumps the ~1.84M frozen legacy telemetry rows (~89%; `legacy/*`, `swarm/*`, dead hooks namespaces) to cold storage, then deletes them from the hot table to free the HNSW index. Reversible: the dump is retained.

Separately, known gap #12 is closed: `ruvector_postgres_data_v2` is added to `agentbox.sh backup`'s `cmd_backup`.

---

## 4. Manifest gates

Every new behaviour is gated in `agentbox.toml`. Retrieval flags extend the existing `[integrations.ruvector_external]` section (where the sidecar already lives); the learning loop gets its own `[memory_learning]` block (a distinct concern); hygiene gets `[memory_hygiene]`. No orphan top-level table is added. **The default state equals today's behaviour**: pure-vector `<=>` search, no typed metadata, no learning, no ops.

```toml
[integrations.ruvector_external]
# existing: enabled, conninfo, manage_sidecar, image, data_volume
hybrid_search      = false   # memory_hybrid_search (DIY fusion)
typed_metadata     = false   # honour importance/tags/memory_type/ttl on memory_store
metadata_gin       = false   # require/build GIN on metadata jsonb
health_tool        = false   # memory_health read-only diagnostics
episodic_ttl_sweep = false   # honour TTL, sweep expired episodic entries (implements delete)

[memory_learning]
enabled               = false   # master gate for the learning loop
record_trajectories   = false   # agentbox hook writes trajectories/trajectory_steps
aggregate_min_samples = 20      # Wilson-bound sample floor before an aggregate influences retrieval
recency_half_life_days = 14
feed_retrieval        = false   # effectiveness aggregates re-rank memory_search
feed_routing          = false   # aggregates surface as advisory [INTELLIGENCE] hints
sona_enabled          = false   # ADOPT-LATER, reserved
relevance_feedback    = false   # ADOPT-LATER, reserved

[memory_hygiene]                # flags only enable the non-dry-run path of agentbox.sh ruvector <op>
allow_namespace_repair   = false
allow_embedding_backfill = false
allow_legacy_archival    = false
```

| Key | Type | Default | Controls |
|---|---|---|---|
| `[integrations.ruvector_external].hybrid_search` | bool | `false` | enable `memory_hybrid_search`; off ⇒ pure-vector only |
| `…typed_metadata` | bool | `false` | write structured metadata on `memory_store`; off ⇒ `metadata` stays `{}` |
| `…metadata_gin` | bool | `false` | require/build the GIN on `metadata` for tag retrieval |
| `…health_tool` | bool | `false` | expose `memory_health` read-only diagnostics |
| `…episodic_ttl_sweep` | bool | `false` | honour TTL, sweep expired episodic entries (this is the `delete` implementation) |
| `[memory_learning].enabled` | bool | `false` | master gate; off ⇒ no hook writes, no aggregation, no consumers |
| `…record_trajectories` | bool | `false` | the agentbox hook writes to `trajectories`/`trajectory_steps` |
| `…aggregate_min_samples` | int | `20` | Wilson-bound sample floor before an aggregate influences retrieval |
| `…recency_half_life_days` | int | `14` | recency half-life for aggregation and hybrid recency term |
| `…feed_retrieval` | bool | `false` | effectiveness aggregates re-rank `memory_search` |
| `…feed_routing` | bool | `false` | aggregates surface as advisory `[INTELLIGENCE]` hints |
| `…sona_enabled` | bool | `false` | reserved (ADOPT-LATER); wraps `ruvector_sona_learn` behind a recall harness |
| `…relevance_feedback` | bool | `false` | reserved (ADOPT-LATER); wraps `ruvector_enable_learning`/`ruvector_record_feedback` |
| `[memory_hygiene].allow_namespace_repair` | bool | `false` | enable the non-dry-run `repair-namespaces` path |
| `…allow_embedding_backfill` | bool | `false` | enable the non-dry-run `backfill-embeddings` path |
| `…allow_legacy_archival` | bool | `false` | enable the non-dry-run `archive-legacy` path |

Independent gates are a deliberate choice. Retrieval upgrades are useful without the learning loop and vice-versa; independent flags let each capability land and be evaluated alone — the posture the `CLAUDE.local.md` "Guidance Control Plane" experiment already adopts. A single coarse master switch is rejected (ADR-036 §D6).

---

## 5. URN allocation

Two durable record types are minted, both onto **existing** kinds — no kind is added. Every URN is minted through `management-api/lib/uris.js` `mint()`; ad-hoc construction is prohibited (ADR-013, `CLAUDE.md` §"URI/URN Scheme"). The `<scope>` is always the 64-character BIP-340 x-only hex pubkey; every record carries `owner_did = did:nostr:<hex>`.

| Concept | Kind | Shape | Slot | Addressing |
|---|---|---|---|---|
| **Trajectory** (action receipt) | `activity` | `urn:agentbox:activity:<scope>:sha256-12-<hash>` | **events** | PROV-O action receipt for one recorded trajectory; the `trajectory` semantics travel in the record payload (`type: 'trajectory'`), not the local part |
| **EffectivenessAggregate** (distilled lesson) | `memory` | `urn:agentbox:memory:<scope>:effectiveness-<sha256-12>` | **memory** | retrievable effectiveness record per action-pattern |

These follow the PRD-008 precedent exactly: `activity` for the action receipt (as execution traces are `activity`), `memory` for the retrievable distilled record (as distilled lessons are `memory`). The shape difference is deliberate and matches `uris.js` as it exists: the `activity` kind is content-addressed — `mint()` computes the `sha256-12-<hash>` local part unconditionally, exactly as every existing `activity` caller receives it — so no semantic prefix is possible there, while the `memory` kind supports the `effectiveness-` prefix exactly as `lesson-` works for PRD-008 distilled lessons. The trajectory URN is stored in the `trajectories.id text` primary key. A trajectory is a lifecycle/action receipt and therefore routes to the **events** slot — exactly as ADR-035 routed project scans to events — while the effectiveness aggregate is retrievable memory and routes to the **memory** slot. No new `trajectory` slot or kind is introduced; the grammar's value is its closure (18 kinds, one resolver), and a new kind would fork it (ADR-036 §D7 records the rejection).

---

## 6. Success metrics

Acceptance is measurable. The metrics below are the landing gates; each is binary or numeric, verifiable against the live database with the inspection snippets in `docs/ruvector-system-reference.md` §7.

1. **Master gate forces silence.** With `[memory_learning].enabled = false` and every `[integrations.ruvector_external]` retrieval flag false, a container exhibits **zero behavioural change** from this PRD: pure-vector `<=>` search, `metadata` written as `{}`, no hook writes, no new tools registered, no ops runnable outside dry-run.
2. **Trajectory row growth.** With the loop on, `SELECT count(*) FROM trajectory_steps` grows from **0** and is nonzero after a working session — the direct refutation of the audit's "0 rows" finding. Every recorded step carries a non-null graded `quality` and a non-zero `duration_ms` (a column the Phase 2 additive migration adds — the shipped `trajectory_steps` schema has no duration column at all); `SELECT count(*) FROM trajectory_steps WHERE quality IS NULL OR duration_ms = 0` on rows written by the agentbox path returns **zero** (the anti-degeneracy invariant).
3. **Outcome label balance.** The distribution of graded outcomes on agentbox-written steps is **not** ~99.9% positive; failures and downstream-corrections are represented. Concretely: the positive-label fraction on a real working session sits materially below the 0.99 degenerate threshold, and undetermined outcomes appear as *skipped writes*, never as fabricated `true`.
4. **Governance consolidation.** After boot, exactly one MCP server is registered as the durable RuVector writer across the Claude and Codex configs; the `ruvector`-named fork registration is absent. A write attempt to a protected namespace without `RUVECTOR_ADMIN_WRITE` is refused by whichever path attempts it.
5. **Hybrid-recall uplift protocol.** On a fixed evaluation query set with known keyword-bearing targets (error codes, `CUDA_ARCH`, filenames — the exact-token queries pure vector misses), `memory_hybrid_search` recall@10 **meets or exceeds** pure-vector `memory_search` recall@10, measured pre/post with the existing recall suite the sidecar-update flow already runs. Baseline pure-vector recall is preserved as the fail-open floor.
6. **Typed metadata and TTL.** With `typed_metadata` on, new `memory_store` writes carry non-empty `metadata`; with `episodic_ttl_sweep` on, expired episodic entries are removed by the sweep (the first working `delete` in this system) and semantic entries are never swept.
7. **Hygiene correctness and reversibility.** After `repair-namespaces`, the count of `namespace`↔`value`-swapped rows drops toward zero and namespace-scoped queries reach the repaired rows. After `backfill-embeddings`, the NULL-embedding count drops from 429 toward zero (un-embeddable rows quarantined, not deleted). After `archive-legacy`, the hot-table row count drops by ~1.84M with the archive dump retained and restorable. Each op ran through snapshot + auto-rollback and left a clean recall suite.
8. **Backup completeness.** `agentbox.sh backup` includes `ruvector_postgres_data_v2` (known gap #12 closed).
9. **No new substrate.** A diff of this feature introduces no new adapter slot, no new port, and no new URN kind. All durable writes route through the **memory** and **events** adapters; all URNs are minted through `uris.js`; new tool telemetry registers on the existing observability surface.

---

## 7. Adapter-contract compliance

### 7.1 Slots and URNs

Memory reads and writes (`store`, `hybrid_search`, `orient`, `health`) route through the **memory** slot. Durable learning records route through the **events** slot — a trajectory is a lifecycle/action receipt, routed exactly as ADR-035 routed scans to events. Both durable identifiers are minted via `uris.js` (§5). Storage differs by record: the trajectory URN lands in the `trajectories.id text` primary key, while the effectiveness aggregate is written through `memory_store` — its row id follows the established `agentbox:<namespace>:<key>` scheme and the URN is carried in the record's metadata.

### 7.2 Middleware order

Every management-api dispatch wraps in the mandated order: **observability → privacy filter (ADR-008) → JSON-LD encoder (ADR-012)**. Privacy redaction completes before encode (DDD-004 §L08). This matters acutely here: trajectory records contain command text, so the privacy filter redacts secrets and paths **before** persist.

### 7.3 Observability

New memory tools emit the ADR-005 span `agentbox.adapter.memory.<method>`, the `agentbox_adapter_dispatch_total{slot,method,impl,outcome}` counter, and `agentbox_adapter_duration_seconds`; `memory_health` feeds `agentbox_adapter_health`. This closes the surface gap where the MCP path emitted no ADR-005 telemetry. Where a tool must run inside the stdio server (outside the HTTP adapter), it emits the equivalent structured JSON log plus a metrics beacon, and the reconciliation debt (§7.4) is recorded.

### 7.4 Fail semantics

| Feature | Semantics |
|---|---|
| `memory_store` typed metadata | fail-closed on `PROTECTED_NAMESPACES`; existing embedding-degrade behaviour preserved |
| `memory_hybrid_search` / `memory_orient` | **fail-open** → degrade to pure-vector, then ILIKE |
| trajectory recording hook | **fail-open** (never blocks Claude) but **fail-closed on privacy redaction** — skip the write rather than persist unredacted |
| `memory_health` | read-only, fail-open |
| effectiveness aggregates feeding retrieval | fail-open, advisory; store unavailable ⇒ baseline ranking |
| hygiene ops (§3.5) | fail-closed / gated; snapshot + auto-rollback |

**Recorded reconciliation debt.** The stdio MCP server has a different lifecycle (a Claude-Code-spawned stdio process) than the HTTP adapter, so folding it into the ADR-005 HTTP path is a larger refactor deliberately deferred (non-goal §2.2). v1 reconciles *observability* across the two paths and records the merge as intent, not a v1 deliverable.

---

## 8. Rollout and migration

The programme lands in phases, each independently gated and independently reversible. No phase depends on a later one; each can ship, be evaluated, and either advance or hold.

**Phase 0 — Governance and backup (no behavioural risk).** Consolidate onto the governed MCP server: de-register the fork at boot, elevate `PROTECTED_NAMESPACES` to an invariant. Add `ruvector_postgres_data_v2` to `cmd_backup`. No data migration (identical write scheme). This phase is pure hardening and ships first.

**Phase 1 — Retrieval upgrades (opt-in, low risk).** Land `typed_metadata`, `memory_hybrid_search`, `metadata_gin`, `health_tool`, `episodic_ttl_sweep`, and `memory_orient` behind their gates, all default-off. The metadata fix is a clean slate (existing rows have empty metadata). Evaluate hybrid recall against the fixed query set (§6.5) before recommending the flag.

**Phase 2 — The learning loop (opt-in, needs a clean corpus first).** The phase opens with the additive schema migration, run through the gated ops machinery: `ALTER TABLE trajectory_steps ADD COLUMN duration_ms double precision;` and `CREATE INDEX idx_trajectory_steps_trajectory ON trajectory_steps(trajectory_id);` — the shipped table has neither a duration column nor an index on `trajectory_id`, and per-trajectory aggregation would seq-scan without one. Then land the agentbox-owned hook path behind `[memory_learning]`. Turn on `record_trajectories` first to accumulate a clean, inspectable trajectory corpus; only then enable `feed_retrieval` and `feed_routing` once the corpus clears `aggregate_min_samples` and passes label-balance and non-degeneracy checks (§6.2, §6.3). SONA and relevance-feedback stay reserved.

**Phase 3 — Hygiene operations (gated, snapshot-backed).** Run each `agentbox.sh ruvector <op>` in dry-run first, review the diff, then enable the corresponding `[memory_hygiene]` flag and run for real through the update machinery's snapshot + auto-rollback. Recommended order: `backfill-embeddings` (smallest, restores HNSW visibility), then `repair-namespaces` (restores scoping), then `archive-legacy` (largest, frees the index). Each op is reversible from its retained dump.

**The precedent.** Every phase that touches the database reuses the sidecar-update machinery already trusted in production — `agentbox.sh ruvector update` performs a `pg_dump` + `pg_basebackup` snapshot, rehearses on a candidate, runs the smoke and recall suites, swaps, and auto-rolls-back on failure. The 2026-07-04 image bump from 0.3.2 to 2.0.5 went through exactly this flow with byte-identical pre/post recall. The hygiene ops inherit that safety envelope rather than inventing a new one; raw SQL fixes in place are rejected precisely because they bypass both the embedding pipeline and the snapshot/rollback (ADR-036 §D5).

---

## 9. Risks

1. **The learning loop produces low-quality signal.** If outcome grading is noisy or action-pattern extraction is coarse, aggregates could mislead retrieval. *Mitigation:* the Wilson lower-bound plus `aggregate_min_samples` floor prevent a single or few labels from moving the ranking; `feed_retrieval` and `feed_routing` are advisory and independently gated; a bad aggregate degrades to baseline, never blocks. The loop is inspectable end-to-end (real rows, real durations, an explicit re-rank term) precisely so its quality can be audited rather than assumed — the exact failure of the system it replaces.
2. **Hybrid recall regresses on some query classes.** Blending keyword and vector could hurt purely semantic queries. *Mitigation:* the DIY-fusion path is namespace-scoped and measured against a fixed query set before recommendation (§6.5); it is fail-open to pure-vector; the native collection engine (heavier, full-corpus GIN) is explicitly deferred until unscoped hybrid is justified.
3. **Hygiene ops damage the corpus.** A mis-detection in `repair-namespaces` or an over-broad `archive-legacy` could lose data. *Mitigation:* dry-run by default, gated non-dry-run, snapshot + auto-rollback on every run, retained archive dumps (archival, never deletion-without-backup). Raw SQL is prohibited.
4. **Privacy leak through trajectory command text.** Recorded commands can contain secrets and paths. *Mitigation:* the privacy filter is mandatory and **fail-closed** on this path — an unredactable record is skipped, not persisted. Redaction completes before persist and before any JSON-LD encode.
5. **The reserved capabilities never land, and the gates rot.** SONA, relevance-feedback, and the native hybrid engine sit behind off gates that could become dead config. *Mitigation:* each is explicitly a *consumer of the §3.1 corpus* gated behind a recall regression harness — a concrete, testable precondition, not an open-ended "later". If the corpus proves poor, the honest outcome is that they stay off, which is a correct result, not a failure.
6. **The two-server reconciliation debt lingers.** Deferring the stdio→HTTP merge keeps two observability paths. *Mitigation:* the debt is recorded as intent (§7.4) with observability reconciled across both paths in v1; the governance invariant (single durable writer, elevated `PROTECTED_NAMESPACES`) is *not* deferred — it lands in Phase 0.
7. **Upstream drift re-severs a wire.** ruflo is a Nix-baked vendored binary; an upstream bump could reintroduce a competing hook path. *Mitigation:* the loop is agentbox-owned and governed — it does not patch ruflo's severed wire, so it does not re-drift with ruflo. This is the core reason the "re-wire ruflo's `feedback()`" alternative was rejected (ADR-036 §D1).

---

## 10. Docs to keep in sync

On landing, update together (the `CLAUDE.md` §"Docs To Keep In Sync" list applies):

- [`README.md`](../../../README.md)
- [`docs/user/quickstart.md`](../../user/quickstart.md)
- [`CLAUDE.md`](../../../CLAUDE.md) (agentbox)
- [`docs/ruvector-system-reference.md`](../../../../docs/ruvector-system-reference.md) — §5 rot-table entries #3, #4, #5, #6, #11, #12 move to "addressed by PRD-018"
- this PRD-018, [ADR-036](../adr/ADR-036-ruvector-capability-adoption-and-learning-loop.md), [DDD-016](../ddd/DDD-016-memory-learning-domain.md)
- ADR-015 is already amended (2026-07-04, embedding pipeline correction); ADR-036 declares `depends_on: [ADR-005, ADR-008, ADR-012, ADR-013, ADR-015]`.

### Cross-references

- [ADR-036 — RuVector capability adoption and learning loop](../adr/ADR-036-ruvector-capability-adoption-and-learning-loop.md) — the eight decisions (D1–D8)
- [DDD-016 — Memory-learning domain](../ddd/DDD-016-memory-learning-domain.md) — ubiquitous language, entities, invariants
- [PRD-017 — Sovereign project tracking](PRD-017-sovereign-project-tracking.md) — additive-substrate precedent
- [PRD-008 — Code-as-Harness integration](PRD-008-code-as-harness-integration.md) — URN-reuse precedent
- [PRD-001 — Capabilities and adapters](PRD-001-capabilities-and-adapters.md)
- [ADR-005 — Pluggable adapter architecture](../adr/ADR-005-pluggable-adapter-architecture.md)
- [ADR-008 — Privacy filter routing](../adr/ADR-008-privacy-filter-routing.md)
- [ADR-012 — JSON-LD 1.1 adoption](../adr/ADR-012-jsonld-federation-grammar.md)
- [ADR-013 — Canonical URI grammar](../adr/ADR-013-canonical-uri-grammar.md)
- [ADR-015 — MCP RuVector mandate](../adr/ADR-015-mcp-ruvector-mandate.md) (amended 2026-07-04)
- [DDD-003 — Sovereign messaging domain](../ddd/DDD-003-sovereign-messaging-domain.md)
- [DDD-004 — Linked-data interchange domain](../ddd/DDD-004-linked-data-interchange-domain.md)
- [`docs/ruvector-system-reference.md`](../../../../docs/ruvector-system-reference.md) — verified ground truth (7-agent audit, 2026-07-04)
- [`management-api/lib/uris.js`](../../../management-api/lib/uris.js) — URN minting
- [`scripts/ruvector-sidecar-update.sh`](../../../scripts/ruvector-sidecar-update.sh) — the gated snapshot/rehearse/swap/rollback machinery the hygiene ops reuse
