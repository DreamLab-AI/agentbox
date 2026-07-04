# DDD-016: Memory & Learning Domain

**Status**: Draft v1
**Date**: 2026-07-04
**Repo**: `github.com/DreamLab-AI/agentbox`
**Bounded Context**: Memory & Learning (semantic memory store + honest learning loop over the RuVector sidecar)
**Related**: [PRD-018](../prd/PRD-018-ruvector-native-memory-and-learning.md) (product goals, capability-adoption menu, retrieval UX, hygiene programme), [ADR-036](../adr/ADR-036-ruvector-capability-adoption-and-learning-loop.md) (the eight decisions D1–D8 with alternatives and rejections), [PRD-001](../prd/PRD-001-capabilities-and-adapters.md) (capabilities and adapter slots — memory is one of the five), [ADR-005](../adr/ADR-005-pluggable-adapter-architecture.md) (memory + events adapter slots, observability middleware, dispatch metrics), [ADR-008](../adr/ADR-008-privacy-filter-routing.md) (privacy redaction — fail-closed on the trajectory write path), [ADR-012](../adr/ADR-012-jsonld-federation-grammar.md) (JSON-LD encoder — opt-in per surface), [ADR-013](../adr/ADR-013-canonical-uri-grammar.md) (canonical URI grammar; all identities minted via `management-api/lib/uris.js`), [ADR-015](../adr/ADR-015-mcp-ruvector-mandate.md) *and its 2026-07-04 amendment* (MCP-ruvector mandate; the embedding-pipeline claim corrected from MiniLM/`generate_text_embedding()` to Xinference `bge-small-en-v1.5`), [DDD-003](./DDD-003-sovereign-messaging-domain.md) (sovereign messaging — owner identity `did:nostr`, consumed not owned), [DDD-004](./DDD-004-linked-data-interchange-domain.md) (linked-data interchange — JSON-LD encoding surface), [DDD-005](./DDD-005-code-execution-domain.md) (code-execution domain — the `DistilledLesson` / memory-slot precedent this domain extends), [DDD-015](./DDD-015-project-tracking-domain.md) (project tracking — sibling precedent: memory/events slots plus `uris.js` discipline for a prior additive capability). Ground truth: [`docs/ruvector-system-reference.md`](../../ruvector-system-reference.md) (7-agent audit, 2026-07-04).

---

## TL;DR for newcomers

*Skip if you already know the memory-and-learning bounded context.*

This DDD captures the Memory & Learning bounded context: the part of agentbox that owns what the system remembers across tasks and sessions, and — for the first time honestly — what it *learns* from the outcomes of its own actions. The store already exists and is genuinely strong: a pinned `ruvector-postgres` sidecar (image `2.0.5@sha256:7fb09d43`, extension `0.3.0`, PostgreSQL 17.9) holding 2.06M memory rows, indexed by a fast HNSW extension over real 384-dimension embeddings produced client-side by Xinference `bge-small-en-v1.5`. What was missing was never *capability* — the extension exposes 191 live SQL functions and ships two purpose-built tables (`trajectories`, `trajectory_steps`) that sat empty — it was *wiring*. The widely-believed claim that "the system learns which bash-call patterns are more effective" was refuted by two adversarial verifiers: `post-bash` is a no-op, `feedback(true)` is hardcoded, `duration` is `0` everywhere, and the confidence field is fetched but never scored. This domain closes those severed wires additively. It records real `(state, action, outcome, duration)` tuples into the empty tables, aggregates per-action effectiveness with defensible statistics (Wilson lower bound plus recency decay, behind a sample floor), and — only when gated on — lets those aggregates re-rank retrieval and advise routing. Alongside, it upgrades retrieval: typed metadata (importance, tags, episodic-versus-semantic, TTL), DIY hybrid vector+keyword fusion, tag filtering, and a cold-start `orient` bundle. Every write goes through one governed MCP server; every durable identifier is minted via `uris.js`; every new behaviour is manifest-gated and default-off.

**If you remember only one thing:** this domain adds no new adapter slot, no new port, and no new URN kind. Memory reads and writes ride the existing **memory** slot; durable learning receipts (trajectories) ride the existing **events** slot as PROV-O activity records; effectiveness aggregates are ordinary retrievable **memory** entries. The two hard laws are that **no durable write ever bypasses the Xinference embedding pipeline** (raw SQL INSERT is forbidden — it produces the NULL-embedding rows that are invisible to HNSW), and **every `TrajectoryStep` carries a real, graded outcome label or it is not written at all** — the constant `true` that broke the old loop is domain-illegal here. The `PROTECTED_NAMESPACES` guard is promoted from a code convenience to an enforced invariant (I-GOV).

For the deep version, keep reading.

---

## 1. Domain Purpose

The truth this domain owns is twofold: the operator's **durable semantic memory** — curated retrospectives, lessons, and the searchable historical corpus — and the **evidence of the system's own effectiveness** — what actions were taken, in what state, with what real outcome, and how that distils into advice.

The store is not a new thing being built; it is a strong thing being wired correctly. The sidecar already delivers because of three real mechanisms: HNSW semantic search over curated agent memory with genuine 384-dim embeddings, high-quality free-text retrospectives as the payload, and reliable cosine (`<=>`) retrieval. What this domain adds is the missing half of the loop — turning outcomes into a corpus, and the corpus into retrieval and routing signal — and the missing retrieval ergonomics: typed metadata, hybrid scoring, tag filtering, TTL-bounded episodic memory, and a cold-start orient bundle.

Three things make this a domain rather than a script. First, **identity**: a memory is not a row keyed by an ad-hoc string; a trajectory is not a log line. Each is a content-addressed URN minted through `uris.js`, stable and resolvable, carrying the sovereign owner identity. Second, **evidence**: a `Trajectory` is a first-class PROV-O activity receipt — "what did the system do, and what came of it" is itself durable, inspectable state, not a side effect. Third, **honesty as an invariant**: the domain refuses to store the failure modes that made the old loop a fiction. An outcome is a real graded label derived from an exit code, a test result, a subagent success flag, or a downstream correction — or the step is skipped. A duration is measured wall-clock — a zero is a bug signal, never a stored value. An aggregate influences nothing until it clears a sample floor and passes through a Wilson lower bound.

Nothing in this domain trains a model, opens its own datastore, issues raw SQL, or federates to the nostr mesh in v1. Effectiveness is computed with simple, inspectable statistics. SONA and relevance-feedback learning are reserved consumers of the corpus behind off gates, not v1 behaviour.

---

## 2. Bounded Context Definition

**Boundary**: this domain owns memory identity and typed storage, the embedding-pipeline contract, the learning loop (trajectory recording and effectiveness aggregation), gated hybrid/tag/orient retrieval, the read-only diagnostics surface, and the data-hygiene operations over the memory store. It owns the single governed MCP writer and the `PROTECTED_NAMESPACES` guard.

**Owns** (IN):

- The `MemoryEntry` aggregate — its content-addressed identity, its typed metadata (importance, tags, episodic-versus-semantic, TTL), and its embedding contract.
- The `Trajectory` aggregate and its `TrajectoryStep` entities — the PROV-O action receipts recording real `(state, action, outcome, duration)` tuples into the `trajectories` / `trajectory_steps` sidecar tables.
- The `EffectivenessAggregate` read-through-memory record — per-action-pattern effectiveness distilled with Wilson lower bound plus recency decay, stored as an ordinary retrievable memory entry.
- The `OrientSnapshot` read-model — the OODA cold-start bundle (semantic memories + relevant aggregates + live episodic context) assembled per task string.
- `OutcomeLabel` and `ImportanceScore` as domain value objects with enforced ranges and provenance.
- The single governed MCP writer (`mcp/servers/ruvector-mcp.cjs`) and the `PROTECTED_NAMESPACES` invariant.
- The hygiene operations — namespace repair, embedding backfill, legacy archival — as gated, snapshot-backed tasks.

**Does not own** (OUT):

- Vector-store internals and the extension's 191 SQL functions. RuVector is consumed as a port (the ADR-005 memory slot). This domain wraps exactly the four `ADOPT-NOW` capabilities and reserves the rest behind off gates; it never issues raw SQL and never opens its own store.
- The embedding model. Xinference (`bge-small-en-v1.5`, 384-dim) is an external inference dependency reached through the `EmbeddingPort`; this domain owns only the *rule* that every durable write is embedded through it. The Postgres-side `generate_text_embedding()` is a stub and is never on the live path (ADR-015 amendment).
- Nostr cryptography, signing, relay transport, and pod-mailbox durability. DDD-003 owns these. This domain consumes only the public owner identity `did:nostr:<AGENTBOX_PUBKEY>` as record scope; the nsec never enters this domain. There is no memory-learning nostr kind in v1.
- JSON-LD encoding. DDD-004 owns the encoding surface; this domain emits plain domain projections and exposes an opt-in JSON-LD port, encoded only when `[linked_data]` is on.
- Privacy redaction policy. ADR-008 owns the filter; this domain routes every adapter write through it, and contributes the constraint that the trajectory write path is **fail-closed** on redaction (I10).
- Router/orchestrator decision-making. Effectiveness aggregates surface as *advisory* `[INTELLIGENCE]` hints under `feed_routing`; they are never a hard gate and never override the router.
- Model training. No gradient pipeline exists in v1 (D8). SONA and relevance-feedback are reserved v2 consumers.

The context map to adjacent domains is drawn in §11.

---

## 3. Ubiquitous Language

| Term | Definition |
|---|---|
| **MemoryEntry** | The aggregate root of the memory subdomain: one stored, embedded, retrievable unit of durable knowledge. Persisted in `memory_entries` via the governed MCP server with a real 384-dim Xinference embedding. Identity is a content-addressed `urn:agentbox:memory:<scope>:<local>` minted via `uris.js`; the sidecar row keeps its established `id = agentbox:<namespace>:<key>`, `source_type = 'agentbox'` write scheme. Carries `namespace`, `value` (the payload — the live column is `jsonb`, in practice a jsonb string scalar of free text), `embedding`, and — under `typed_metadata` — a typed `metadata` object. |
| **EpisodicEntry** | A `MemoryEntry` with `memory_type = 'episodic'`: session- or task-scoped, TTL-bounded (default 30 days), swept when expired. The transient working memory of a run. Deleting one is what finally implements the long-dead `delete` operation (unimplemented at `ruvector-mcp.cjs:366`). |
| **SemanticEntry** | A `MemoryEntry` with `memory_type = 'semantic'`: a durable, curated lesson with no TTL, never auto-swept. The lasting knowledge — retrospectives, patterns, distilled lessons. The `DistilledLesson` of DDD-005 is a `SemanticEntry`. |
| **ImportanceScore** | A value object in `[0.0, 1.0]` carried in `MemoryEntry.metadata.importance`. Contributes the `0.2·importance` term of the hybrid score. Absent → treated as a neutral default, never as zero-by-omission. |
| **Tag** | A free-text label in `MemoryEntry.metadata.tags[]`. Enables tag retrieval via `metadata @> '{...}'`, made cheap by a `gin(metadata jsonb_path_ops)` index (turns a ~365k-cost seq scan into a bitmap index scan). |
| **HybridQuery** | A retrieval request served by `memory_hybrid_search`: baseline score `0.6·cosine_sim + 0.2·importance + 0.2·recency` (where `cosine_sim = 1 − (embedding <=> qv)` and `recency` is half-life decay on `updated_at`), blended with keyword relevance via `ruvector_hybrid_score(vec_dist, ts_rank, alpha)` over builtin `websearch_to_tsquery` FTS. Namespace-scoped and production-ready today (~75 ms via `idx_memory_namespace`, no GIN needed). The DIY fusion path — not the native collection engine. |
| **Trajectory** | The aggregate root of the learning subdomain: one ordered sequence of `TrajectoryStep`s representing a task or session run. A PROV-O action receipt. Persisted in the purpose-built, previously-empty `trajectories` table. Identity `urn:agentbox:activity:<scope>:sha256-12-<hash>` (the `activity` kind is content-addressed; `trajectory` semantics travel in the record payload). |
| **TrajectoryStep** | An immutable step within a `Trajectory`: one observed `(state, action, outcome, duration)` tuple. Persisted in `trajectory_steps`. `state` = task/session context (prompt digest, active namespace, prior step id). `action` = the observed unit (a bash command pattern, an edit, a subagent task). `outcome` = an `OutcomeLabel`. `duration_ms` = locally-measured wall-clock (an additive migration column — the shipped schema has no duration column). The graded score lands in the schema's existing `trajectory_steps.quality` (double precision). |
| **OutcomeLabel** | A value object: a **real, graded** outcome, never a constant. Sources, in priority order: bash `exitCode`; test pass/fail; a subagent's actual success flag from the tool payload; a downstream-correction signal (an edit reverted, or a later command failed within the same trajectory). If the outcome cannot be determined, **no step is written** — it is never defaulted to `true`. This is the domain's direct answer to the refuted `feedback(true)`. |
| **EffectivenessAggregate** | A distilled, retrievable record of one action-pattern's effectiveness: its Wilson lower-bound success rate (not the raw rate) with recency half-life decay, plus its sample count. Stored as an ordinary `MemoryEntry` in namespace `memory-learning-aggregates`; identity `urn:agentbox:memory:<scope>:effectiveness-<sha256-12>`. Influences retrieval/routing only once it clears `aggregate_min_samples` (default 20). |
| **OrientSnapshot** | The OODA cold-start read-model returned by `memory_orient`: for a given task string, one bundle of top-k `SemanticEntry` memories + relevant `EffectivenessAggregate`s + live `EpisodicEntry` context for the session, assembled via CTEs over the sidecar. Ephemeral — never persisted, never a write source. This is the `orient()` the `agentdb-*` skills already assume; provided as an MCP tool with **no new extension function**. |
| **PROTECTED_NAMESPACES** | The governance guard carried only by the governed MCP server: every write passes `checkProtectedNamespace` (default protected set: `governance-precedents`; `RUVECTOR_ADMIN_WRITE` override). Promoted here from a code convenience to enforced domain law (I-GOV). |
| **DiagnosticsSnapshot** | The read-only health projection from `memory_health`, wrapping `ruvector_health_status`, `ruvector_is_healthy`, `ruvector_system_metrics`, `ruvector_simd_info`. Feeds the `agentbox_adapter_health` gauge. Read-only — never triggers remediation (auto-execute self-healing is skipped, D4). |
| **owner_did** | The sovereign owner identity on every record this domain emits: `did:nostr:<AGENTBOX_PUBKEY>`, the public 64-char BIP-340 x-only pubkey hex, also the `<scope>` of every URN. Public by construction; no nsec is ever read here (I09). |

---

## 4. Aggregates

### 4.1 MemoryEntry (Root)

The `MemoryEntry` is the consistency boundary of the memory subdomain: one embedded, retrievable unit of durable knowledge.

**Identity**: `urn:agentbox:memory:<scope>:<local>` — minted through `management-api/lib/uris.js` against the `memory` kind, `<scope>` the owner pubkey. The sidecar row retains its established `id = agentbox:<namespace>:<key>`, `source_type = 'agentbox'` scheme; because both the governed server and the deprecated fork wrote this identical scheme, D2 requires **no data migration** — de-registration of the fork is sufficient.

**Fields**:

| Field | Type | Notes |
|---|---|---|
| `urn` | `urn:agentbox:memory:…` | Canonical identity, minted via `uris.js`. |
| `id` | `string` | Sidecar row key `agentbox:<namespace>:<key>`. |
| `ownerDid` | `did:nostr:<hex>` | `did:nostr:<AGENTBOX_PUBKEY>`. Public. (I09) |
| `namespace` | `string` | Logical partition (`patterns`, `project-state`, `memory-learning-aggregates`, …). Scoping only; not a secret. |
| `value` | `string` | The free-text payload. Retrieval quality is bounded by note quality. |
| `embedding` | `vector(384)` | Real Xinference `bge-small-en-v1.5` vector. **Never null on a durable write** (I03). |
| `metadata` | `jsonb` | Under `typed_metadata`: `{importance:float, tags:[…], memory_type:'episodic'\|'semantic', ttl_seconds?}`. Default off → `{}` (status quo). |
| `memory_type` | `'episodic' \| 'semantic'` | In metadata. Drives TTL and sweep behaviour (I08). |
| `importance` | `float [0,1]` | `ImportanceScore`. Hybrid-score term. |
| `updated_at` | timestamptz | Recency basis for the hybrid `recency` term. |

**The enabling fix**: `memory_store` stops hardcoding `metadata = '{}'` (`memory-tools.js:114`). Under `typed_metadata` it writes the typed object; the 6,121 existing `agentbox` rows carry empty metadata, so this is a clean slate, not a migration.

**Lifecycle**:

```
Drafted → Embedded → Stored → (Retrieved)*
                        │
        episodic ───────┴──────► Expired → Swept (delete)
        semantic ──────────────► Durable (never auto-swept)
```

**Invariants**:

- **I01**: Every `MemoryEntry` URN is minted through `uris.js` against the `memory` kind with the owner pubkey as scope. Ad-hoc template-literal or `format!()` URN construction is prohibited (ADR-013 R1).
- **I03** (embedding-pipeline law): **No durable write bypasses the embedding pipeline.** Every `MemoryEntry` is embedded through the `EmbeddingPort` (Xinference `bge-small-en-v1.5`, 384-dim) by the governed MCP server before persist. Raw SQL `INSERT` into `memory_entries` is forbidden — it is the exact anti-pattern that produced the 429 NULL-embedding rows (413 migration artefacts plus 16 raw-SQL bypasses as recent as 2026-06-09), which are invisible to HNSW. A value that cannot be embedded is quarantined, never stored embedding-less as durable truth.
- **I08** (episodic/semantic law): `EpisodicEntry` carries a TTL (default 30 days) and is swept when expired by `episodic_ttl_sweep`; `SemanticEntry` has no TTL and is never auto-swept. This finally honours the `ttl` parameter that was advertised (`ruvector-mcp.cjs:196`) but silently dropped (`ruvector-mcp.cjs:348`), and implements the `delete` operation that was unimplemented (`ruvector-mcp.cjs:366`) via the episodic sweep.
- **I09** (owner-identity law): every durable record this domain emits carries `owner_did = did:nostr:<AGENTBOX_PUBKEY>` — the **public** 64-character BIP-340 x-only hex pubkey, which is also the `<scope>` of every URN. Only the public key enters this domain; the nsec never crosses its boundary (signing and key custody live in DDD-003, consumed not owned).
- **I-GOV** (governance law, elevated to invariant): every write passes `checkProtectedNamespace`. The protected set defaults to `governance-precedents`; the `RUVECTOR_ADMIN_WRITE` env override is the only bypass. Only the governed server (`mcp/servers/ruvector-mcp.cjs`, registered `claude-flow`) carries this guard; the ungoverned personal fork (`~/.claude/ruvector-mcp.cjs`, registered `ruvector`) is **deprecated and de-registered at boot** — the entrypoint rewrites both the Claude and Codex configs to point only at the governed script (D2).

---

### 4.2 Trajectory (Root) and TrajectoryStep

The `Trajectory` is the consistency boundary of the learning subdomain: one ordered run of observed actions with real outcomes. It is a PROV-O action receipt — a fact about *what the system did*, distinct from the memories it produced. It is written into the purpose-built `trajectories` / `trajectory_steps` tables which the audit found **empty** (0 rows) — the schema was always fit for purpose; the wiring was severed.

**Identity**: `urn:agentbox:activity:<scope>:sha256-12-<hash>` — minted via `uris.js` against the `activity` kind (a trajectory is a lifecycle/action receipt, routed to the **events** slot exactly as ADR-035 routed scans to events). The `activity` kind is content-addressed: `mint()` computes the bare `sha256-12-<hash>` local part unconditionally, so the `trajectory` semantics travel in the record payload (`type: 'trajectory'`), never the local part. The sidecar table's `id text` primary key holds the URN.

**Trajectory fields**: `trajectoryUrn`, `ownerDid`, `sessionId` (stored in the existing `trajectories.metadata` jsonb — the table has no `session_id` column), `startedAt`, `endedAt`, `stepCount`, `outcome` (rollup).

**TrajectoryStep fields**:

| Field | Type | Notes |
|---|---|---|
| `state` | object | Task/session context: prompt digest, active namespace, prior step id. Captured at the pre-hook. |
| `action` | object | The observed unit: a bash command *pattern*, an edit, or a subagent task. Command text is redacted before persist (I10). |
| `outcome` | `OutcomeLabel` | Real graded label from a real signal (I04). |
| `quality` | `double precision` | The graded score, written to the schema's existing `trajectory_steps.quality` column. |
| `durationMs` | `number` | Locally-measured wall-clock (pre-hook → post-hook). Never the ruflo `0` (I05). Lands in `trajectory_steps.duration_ms` — an **additive migration column** (ADR-036 D1); the shipped schema has no duration column. |

**Invariants**:

- **I04** (outcome-honesty law): **Every `TrajectoryStep` carries a real, graded `OutcomeLabel`.** The label is derived from a real signal (bash `exitCode` → test result → subagent success flag → downstream-correction signal, in that priority). **If the outcome cannot be determined, the step is not written** — it is never defaulted to `true`. This is the domain-level prohibition of the refuted `feedback(true)` hardcode (`hook-handler.cjs:243`) and the degenerate ~99.9%-positive historical corpus. The score is graded into `quality`, not binary.
- **I05** (duration law): `durationMs` is measured locally by the agentbox hook itself (pre-hook timestamp → post-hook timestamp). A zero duration is a bug signal, not a stored value — this directly refuses the `duration=0` that is hardcoded in 100% of the legacy `performance-metrics` rows.
- **I06** (aggregation-influence law): an `EffectivenessAggregate` influences retrieval or routing **only** when (a) its sample count ≥ `aggregate_min_samples` (default 20) and (b) its rate is the **Wilson lower bound**, not the raw rate, with recency half-life decay (`recency_half_life_days`, default 14). A single degenerate label cannot move the needle.
- **I07** (label-balance law): aggregation guards against a degenerate outcome distribution. Because I04 already refuses undetermined and constant labels at the write boundary, the corpus carries real spread by construction; the Wilson bound plus the sample floor of I06 mean an all-one-class pattern below the sample floor is inert, and the graded `quality` (not binary success) is what is aggregated. The confidence-style signal is consumed by an explicit, inspectable re-rank term — never fetched-and-dropped as it was at `intelligence.cjs:459`.
- **I10** (privacy-fail-closed law): the trajectory write path is **fail-closed on privacy redaction**. Because `action` contains command text, the ADR-008 privacy filter must complete redaction of secrets and paths *before* persist; if redaction cannot be applied, the write is **skipped** rather than persisted unredacted. The recording hook is otherwise **fail-open** — it never blocks Claude.
- **I11** (slot-reuse law): a `Trajectory` rides the existing **events** slot and an `EffectivenessAggregate` rides the existing **memory** slot. No new adapter slot, no new URN kind, no new port is minted (D8). The `activity` and `memory` kinds already fit — this follows the DDD-005 Code-as-Harness URN-reuse precedent.

---

### 4.3 EffectivenessAggregate (memory-backed)

`EffectivenessAggregate` is the distillation: the effectiveness of one action-pattern, computed from its `TrajectoryStep`s. It is not a new table — it is an ordinary `MemoryEntry` in namespace `memory-learning-aggregates`, embedded and retrievable like any other, so it participates in semantic search directly.

**Identity**: `urn:agentbox:memory:<scope>:effectiveness-<sha256-12>` — minted via `uris.js` against the `memory` kind, content-addressed over the action-pattern (the `DistilledLesson` precedent of DDD-005 / the Code-as-Harness allocation).

**Computation**: per action-pattern, the Wilson lower-bound success rate with recency half-life decay over the contributing steps' graded `quality`, plus the sample count. Recomputed as trajectories accrue.

**Consumers** (both gated, both advisory):

- `feed_retrieval` — memories linked to high-effectiveness patterns receive a re-rank bonus in `memory_search`.
- `feed_routing` — aggregates surface as advisory `[INTELLIGENCE]` hints, **never a hard gate**.

**Invariants**: inherits I01, I03, I06. An aggregate below the sample floor exists but is inert; it is materialised and stored but does not influence any consumer until it clears `aggregate_min_samples`.

---

### 4.4 OrientSnapshot (read-model)

`OrientSnapshot` is the OODA cold-start bundle returned by `memory_orient`. Given a task string it returns, in one call, the top-k `SemanticEntry` memories, the relevant `EffectivenessAggregate`s, and the live `EpisodicEntry` context for the session — assembled via CTEs over the sidecar, with **no new extension function**. It is the `orient()` the `agentdb-*` skills already assume exists.

**Invariants**:

- **I12** (read-model law): `OrientSnapshot` is a derived read-model, never a write source. It is assembled on demand and never persisted, never mutated, never the basis for any aggregate's state. It **fails open** — the store being unavailable degrades to pure-vector, then ILIKE, never an error to the caller.

---

## 5. Value Objects and Domain Rules (cross-aggregate)

- **R01**: Memory & Learning is read-mostly plus honest recording — not a new backend. All durable state routes through the existing **memory** slot (entries, aggregates) and **events** slot (trajectories). No new store is opened; raw SQL is never issued (I03, I11).
- **R02**: One governed writer. The single durable writer is `mcp/servers/ruvector-mcp.cjs`; the personal fork is de-registered at boot. `PROTECTED_NAMESPACES` is enforced on every write (I-GOV) (D2).
- **R03**: Every durable identifier is minted through `management-api/lib/uris.js`. No ad-hoc URNs exist in this domain (I01).
- **R04**: Honesty over optimism. An `OutcomeLabel` is a real graded signal or the step is not written; a `durationMs` is measured or the step is a bug signal, not stored (I04, I05). The domain refuses to reproduce the four documented failure modes (post-bash no-op, `feedback(true)`, `duration=0`, confidence-fetched-but-unused).
- **R05**: Influence is earned and inspectable. Aggregates re-rank retrieval and advise routing only past a sample floor, via a Wilson bound with recency decay, through an explicit re-rank term — never a hidden constant, never a hard gate (I06, I07).
- **R06**: Every feature self-gates and is default-off. The default state equals today: pure-vector `<=>` search, no typed metadata, no learning, no hygiene ops. Each capability (hybrid, typed metadata, GIN, health, TTL sweep, learning, each hygiene op) has its own flag so it can land and be evaluated alone (I13 below; D6).
- **R07**: Every external hop is gated and fail-open, except privacy on the trajectory path which is fail-closed. The embedding call, the diagnostics call, retrieval upgrades, and aggregate feed are fail-open; privacy redaction on trajectory writes is fail-closed (I10); hygiene ops are gated and snapshot-backed with auto-rollback.

- **I13** (manifest law): every new behaviour is manifest-gated in `agentbox.toml`, default preserving current behaviour. Retrieval flags extend `[integrations.ruvector_external]` (`hybrid_search`, `typed_metadata`, `metadata_gin`, `health_tool`, `episodic_ttl_sweep`); learning lives in its own `[memory_learning]` block (`enabled`, `record_trajectories`, `aggregate_min_samples`, `recency_half_life_days`, `feed_retrieval`, `feed_routing`, plus reserved `sona_enabled`/`relevance_feedback`); hygiene lives in `[memory_hygiene]` (`allow_namespace_repair`, `allow_embedding_backfill`, `allow_legacy_archival`). No orphan top-level `[ruvector]` table.

---

## 6. Domain Events (operator-visible)

| Event | Trigger | Key Payload Fields |
|---|---|---|
| `MemoryStored` | A `MemoryEntry` is embedded and persisted through the governed server | `memory_urn`, `namespace`, `memory_type`, `importance`, `owner_did` |
| `MemoryWriteRejected` | A write hits a `PROTECTED_NAMESPACE` without `RUVECTOR_ADMIN_WRITE` | `namespace`, `reason: "protected-namespace"` (I-GOV, fail-closed) |
| `EmbeddingUnavailable` | The `EmbeddingPort` (Xinference) cannot embed a value | `namespace`, `reason` — value quarantined, never stored embedding-less (I03) |
| `EpisodicSwept` | An expired `EpisodicEntry` is deleted by the TTL sweep | `count`, `namespace` — implements the long-dead `delete` (I08) |
| `TrajectoryStarted` | A run begins; a `Trajectory` URN is minted at the pre-hook | `trajectory_urn`, `session_id`, `owner_did` |
| `TrajectoryStepRecorded` | A real graded `(state, action, outcome, duration)` tuple is persisted | `trajectory_urn`, `action_kind`, `outcome`, `quality`, `duration_ms` (I04, I05) |
| `TrajectoryStepSkipped` | The outcome could not be determined | `trajectory_urn`, `reason: "undetermined-outcome"` — never written as `true` (I04) |
| `TrajectoryWriteRedactionFailed` | Privacy redaction could not be applied to `action` text | `trajectory_urn`, `reason` — write skipped, fail-closed (I10) |
| `EffectivenessAggregated` | An `EffectivenessAggregate` is (re)computed and stored | `effectiveness_urn`, `action_pattern`, `wilson_lower`, `samples` |
| `EffectivenessBecameInfluential` | An aggregate first clears `aggregate_min_samples` | `effectiveness_urn`, `samples`, `threshold` (I06) |
| `HybridSearchDegraded` | Hybrid/orient fell back to pure-vector or ILIKE | `reason` — fail-open (I12) |
| `DiagnosticsSampled` | `memory_health` read the extension's read-only diagnostics | `is_healthy`, `simd`, `feeds: "agentbox_adapter_health"` |
| `HygieneOpProposed` | A hygiene op ran in dry-run (default) | `op` (`repair-namespaces`\|`backfill-embeddings`\|`archive-legacy`), `affected_rows` |
| `HygieneOpApplied` | A gated hygiene op ran non-dry-run with snapshot | `op`, `affected_rows`, `snapshot_ref` — auto-rollback armed |
| `ForkDeregistered` | The ungoverned MCP fork was de-registered at boot | `former_registration: "ruvector"`, `now: "claude-flow"` (D2) |

All events are emitted through the ADR-005 observability middleware as plain domain projections in JSON. DDD-004 JSON-LD encoding is applied as an opt-in surface when `[linked_data]` is on. Where a tool runs inside the Claude-Code-spawned stdio MCP server (outside the management-api HTTP adapter), it emits the equivalent structured JSON log plus a metrics beacon, and the stdio-versus-HTTP reconciliation debt is recorded (D2 alternative; D7).

---

## 7. Repository Interfaces (Ports)

Mapped to the two existing adapter slots — no new slot (I11).

| Port | Direction | Counterpart | Contract |
|---|---|---|---|
| **VectorMemoryPort** | Outbound (writes + reads) | RuVector via ADR-005 **memory** slot | Stores/retrieves `MemoryEntry`, `EffectivenessAggregate` and serves `HybridQuery`/`OrientSnapshot` through the governed MCP tools (`memory_store`, `memory_search`, `memory_hybrid_search`, `memory_orient`) — never raw SQL. URNs minted via `uris.js` (I01, I03). |
| **TrajectoryEventsPort** | Outbound (publish) | ADR-005 **events** slot | Persists `Trajectory` and `TrajectoryStep` PROV-O receipts into the `trajectories`/`trajectory_steps` tables and publishes the domain events through the existing agent-event publisher. Fail-open, fail-closed on redaction (I10). |
| **EmbeddingPort** | Outbound (required) | Xinference `bge-small-en-v1.5` (384-dim) | Every durable write is embedded here before persist (I03). The Postgres `generate_text_embedding()` stub is *not* this port (ADR-015 amendment). Fail: value quarantined, never stored embedding-less. |
| **ExtensionDiagnosticsPort** | Outbound (read-only) | RuVector extension diagnostics | Wraps `ruvector_health_status`, `ruvector_is_healthy`, `ruvector_system_metrics`, `ruvector_simd_info` behind `memory_health`; feeds `agentbox_adapter_health`. Read-only — never remediates (auto-heal skipped, D4). Fail-open. |
| **HookObservationPort** | Inbound (capture) | agentbox hook path | The agentbox-owned pre/post hook that captures `(state, action, outcome, duration)`. Does **not** delegate to ruflo's dispatch table (which has no `post-bash` case). Writes the tuple explicitly (D1). |
| **EffectivenessFeedPort** | Outbound (advisory) | Retrieval + routing | Applies the aggregate re-rank bonus (`feed_retrieval`) and surfaces advisory `[INTELLIGENCE]` hints (`feed_routing`). Both gated, both fail-open, never a hard gate (I06). |
| **PrivacyFilterPort** | Outbound | ADR-008 | Wraps every adapter dispatch. Fail-closed on the trajectory write path (I10); the standard filter elsewhere. |
| **MetricsRegistryPort** | Outbound (register) | ADR-005 observability registry | Registers the `agentbox_adapter_*` series (dispatch, duration, health) for memory methods on the shared `/metrics`. No new exporter. |
| **LinkedDataPort** | Outbound (opt-in) | DDD-004 | JSON-LD encodes memory/learning surfaces only when `[linked_data]` is on; context documents pinned at build time, never fetched at runtime. |
| **HygienePort** | Outbound (gated, snapshot-backed) | `agentbox.sh ruvector <op>` | Runs `repair-namespaces`, `backfill-embeddings`, `archive-legacy` — dry-run by default; the non-dry-run path requires the matching `[memory_hygiene]` flag and reuses the existing gated update machinery (pg_dump + pg_basebackup snapshot + candidate rehearsal + smoke/recall suite + swap + auto-rollback). Fail-closed (D5). |

---

## 8. Adapter-Contract Compliance

**Slots and URNs** (no new slot, no new kind — I11). Memory reads/writes (store, hybrid_search, orient, health) route through the **memory** slot; durable learning records route through the **events** slot as PROV-O activity. Identities minted via `uris.js`; storage differs by record — the trajectory URN lands in the `trajectories.id text` primary key, while the effectiveness aggregate is written through `memory_store` (row id follows the established `agentbox:<namespace>:<key>` scheme, the URN carried in the record's metadata):

- Trajectory → `urn:agentbox:activity:<scope>:sha256-12-<hash>` (content-addressed kind; `trajectory` semantics in the payload).
- Effectiveness aggregate → `urn:agentbox:memory:<scope>:effectiveness-<sha256-12>`.
- `<scope>` = 64-char BIP-340 x-only hex pubkey; every record carries `owner_did = did:nostr:<hex>`.

**Middleware order** (every management-api dispatch): **observability → privacy filter (ADR-008) → JSON-LD encoder (ADR-012)**. Privacy redaction completes before encode (DDD-004 §L08). Because trajectory records contain command text, the privacy filter redacts secrets and paths before persist; on this path redaction is fail-closed (I10).

**Observability**: memory tools emit the ADR-005 span `agentbox.adapter.memory.<method>`, the `agentbox_adapter_dispatch_total{slot,method,impl,outcome}` counter, and `agentbox_adapter_duration_seconds`; `memory_health` feeds `agentbox_adapter_health`. This closes the surface-audit gap where the MCP path emitted no ADR-005 telemetry.

**Fail semantics** (explicit per feature):

| Feature | Semantics |
|---|---|
| `memory_store` typed metadata | fail-closed on `PROTECTED_NAMESPACES` (I-GOV); embedding degrade preserved (I03) |
| `memory_hybrid_search` / `memory_orient` | **fail-open** → degrade to pure-vector, then ILIKE (I12) |
| trajectory recording hook | **fail-open** (never blocks Claude) but **fail-closed on privacy redaction** — skip the write rather than persist unredacted (I10) |
| `memory_health` | read-only, fail-open |
| effectiveness aggregates feeding retrieval/routing | fail-open, advisory; store unavailable → baseline ranking (I06) |
| hygiene ops (D5) | fail-closed / gated; snapshot + auto-rollback |

---

## 9. Data Hygiene Operations

Three operational tasks as `agentbox.sh ruvector <op>` subcommands, all **dry-run by default**, non-dry-run gated by the matching `[memory_hygiene]` flag, all reusing the existing snapshot-backed update machinery:

1. **`repair-namespaces`** — 178,238 rows (8.65%) have `namespace` ↔ `value` swapped by a migration bug. Detect (namespace looks like JSON / value looks like a bare namespace token), swap back. Low urgency: embeddings were computed on the real content, so semantic search already reaches these rows; this restores namespace *scoping*.
2. **`backfill-embeddings`** — 429 NULL-embedding rows (413 migration artefacts + 16 raw-SQL bypasses to 2026-06-09). Recompute via Xinference for non-empty values; quarantine the un-embeddable. Enforces the MCP-only-writes rule going forward (I03).
3. **`archive-legacy`** — ~1.84M rows (~89%) of frozen legacy telemetry (`legacy/*`, `swarm/*`, dead hooks namespaces; write-only, never read). Dump to cold storage, then delete from the hot table to free the HNSW index. Reversible (dump retained).

Also closes catalogue gap #12: `ruvector_postgres_data_v2` is added to `agentbox.sh backup` `cmd_backup`. Raw SQL fixes in place are rejected — they bypass the embedding pipeline (the exact NULL-embedding anti-pattern) and have no snapshot/rollback.

---

## 10. Anti-Corruption Layer

Three external systems sit at the edge; each gets a thin translation layer so the domain speaks only its own language.

**Extension → domain**: the `ExtensionDiagnosticsPort` and the DIY hybrid path translate the extension's raw surface (191 functions, `ruvector_hybrid_score`, `<=>` operator, `websearch_to_tsquery`) into exactly four `ADOPT-NOW` domain capabilities — hybrid fusion, read-only diagnostics, trajectory recording, and the `metadata` GIN. The rest of the surface (SONA `ruvector_sona_learn`, relevance-feedback `ruvector_enable_learning`/`ruvector_record_feedback`, `attention_score`) is reserved behind off gates; the irreversible (`ruvector_healing_execute`), the substrate-less (GNN aggregates), and the single-tenant-irrelevant (multi-tenancy RLS) are skipped outright. The domain never sees a bare function name; it sees `memory_health`, `memory_hybrid_search`, `memory_orient`.

**Xinference → domain**: the `EmbeddingPort` is the ACL over the embedding model. It translates free-text into a 384-dim vector and is the single point where the model identity (`bge-small-en-v1.5`) is known. The domain expresses only the rule "durable writes are embedded"; it does not know the model except through this port, and it explicitly does *not* route through the Postgres `generate_text_embedding()` stub (ADR-015 amendment).

**ruflo → domain**: the domain does **not** consume ruflo's severed learning wires. It does not re-wire `feedback()`, does not read the `Confidence: 80.0%` constant, does not delegate to the dispatch table with no `post-bash` case. The `HookObservationPort` is an agentbox-owned path that observes outcomes directly. ruflo is a Nix-baked, ungoverned vendored binary whose scoring ignores confidence anyway; patching a severed wire inside code the repo does not own is invisible to governance and re-drifts on every upstream bump — so the domain replaces the wire rather than mending it.

---

## 11. Context Map (adjacent domains)

**DDD-003 (Sovereign Messaging) — Customer/Supplier, consumed not owned.** This domain consumes exactly one thing from DDD-003: the public owner identity `did:nostr:<AGENTBOX_PUBKEY>`, used as record scope and `owner_did`. It owns no nostr crypto, no signing, no relay transport, no pod mailbox, and — deliberately — federates **no** memory-learning nostr kind in v1 (unlike DDD-015's kind-30841 digest). The nsec never crosses into this domain (I09). If a future version publishes an effectiveness digest to the mesh, it would reuse the existing `event` kind and the DDD-003 bridge; it does not in v1.

**DDD-004 (Linked-Data Interchange) — Conformist, opt-in.** DDD-004 owns the JSON-LD encoding surface and the middleware position of the encoder (last, after privacy — DDD-004 §L08). This domain emits plain domain projections and exposes an opt-in `LinkedDataPort`; memory/learning surfaces are JSON-LD encoded only when `[linked_data]` is on, with build-pinned context documents. The middleware order (observability → privacy → encoder) is DDD-004's law, applied here verbatim.

**DDD-005 (Code Execution) — Shared Kernel, precedent extended.** DDD-005 established the memory-slot `DistilledLesson` (`urn:agentbox:memory:<scope>:lesson-<sha256-12>`) and the `ExecutionTrace` activity receipt (`urn:agentbox:activity:<scope>:trace-<id>`). This domain extends exactly that pattern: `EffectivenessAggregate` is a memory-slot distillation sibling of `DistilledLesson`, and `Trajectory` is an activity receipt sibling of `ExecutionTrace`. Both domains share the URN-reuse discipline — new capability, existing eighteen kinds, no new slot — and both write durable knowledge through the same **memory** slot. A `SemanticEntry` and a `DistilledLesson` are the same aggregate shape under different producers.

**DDD-015 (Project Tracking) — sibling precedent.** DDD-015 routed durable state through the memory (primers) and events (scans) slots and minted all identity via `uris.js`; this domain follows the identical slot-and-URN discipline for aggregates and trajectories. The two domains do not depend on each other at runtime; the lineage is the shared adapter contract.

---

## 12. Open Questions

1. **When SONA becomes a first-class consumer.** SONA (Micro-LoRA/EWC++), relevance-feedback learning, and attention re-rank are reserved behind off gates (`sona_enabled`, `relevance_feedback`). They consume the D1 trajectory corpus and change retrieval geometry with as-yet-unvalidated behaviour. The gate to open them is a recall regression harness proving no self-recall degradation against the current 188/200 self-recall@10 and 119/120 true-recall@10 baseline. Until that harness exists, v1 only *produces* a clean, inspectable trajectory corpus; it does not consume it through SONA.

2. **Native hybrid engine versus DIY fusion.** v1 ships DIY fusion (`ruvector_hybrid_score` + builtin FTS), namespace-scoped, ~75 ms, zero schema change. The native `ruvector_hybrid_search` collection engine needs a `tsvector` generated column and a heavy 2.06M-row FTS GIN (unscoped hybrid EXPLAINs to a 6-worker parallel seq scan, cost ~432k). Whether unscoped hybrid is ever justified enough to pay that enabling migration is deferred; DIY fusion wins scoped retrieval today.

3. **stdio MCP server versus HTTP adapter reconciliation.** The governed MCP server is a Claude-Code-spawned stdio process with a different lifecycle from the management-api HTTP adapter, so v1 records the reconciliation debt rather than paying it (tools in the stdio path emit equivalent structured logs + a metrics beacon). Whether to fold the stdio server into the ADR-005 HTTP adapter as a single code path is a larger refactor deferred to a future ADR.

4. **Aggregate recency-decay and sample-floor tuning.** The defaults (`aggregate_min_samples = 20`, `recency_half_life_days = 14`) are chosen conservatively so a small or stale corpus stays inert. The right values once real trajectories accrue — and whether the floor should vary by action kind (a bash pattern versus a subagent task carry different base rates) — is an empirical question deferred until the corpus is non-empty. The CLAUDE.local.md experiment posture (independent gates, measured autonomy) is the intended tuning harness.

---

## 13. References

| Reference | Notes |
|---|---|
| PRD-018 | Product requirements — capability-adoption menu, retrieval UX, hygiene programme, non-goals; the why and acceptance criteria this domain realises. |
| ADR-036 | The eight decisions (D1–D8) with alternatives and rejections; `depends_on: [ADR-005, ADR-008, ADR-012, ADR-013, ADR-015]`. |
| PRD-001 | Capabilities and adapters — the memory slot as one of the five. |
| ADR-005 | Pluggable adapter architecture — memory + events slots, observability middleware, dispatch metrics, the shared metrics registry. |
| ADR-008 | Privacy filter — wraps adapter dispatch; fail-closed on the trajectory write path (I10). |
| ADR-012 | JSON-LD encoder — applied opt-in per surface, last in the middleware chain. |
| ADR-013 | Canonical URI grammar — `urn:agentbox:<kind>:[<scope>:]<local>`, minted via `management-api/lib/uris.js`. |
| ADR-015 (+ 2026-07-04 amendment) | MCP-ruvector mandate; embedding claim corrected from MiniLM/`generate_text_embedding()` to Xinference `bge-small-en-v1.5`. |
| DDD-003 | Sovereign messaging — owner identity `did:nostr`, consumed not owned; no nsec enters this domain. |
| DDD-004 | Linked-data interchange — JSON-LD encoding surface; opt-in port only. |
| DDD-005 | Code execution — the `DistilledLesson` (memory slot) and `ExecutionTrace` (activity receipt) precedent this domain extends. |
| DDD-015 | Project tracking — sibling precedent: durable state on the memory (primers) and events (scans) slots, all identity via `uris.js`; this domain follows the identical slot-and-URN discipline. |
| `docs/ruvector-system-reference.md` | Verified ground truth (7-agent audit, 2026-07-04) — live sidecar state, the refuted learning claim, the catalogue of rot addressed by PRD-018. |
