---
title: "Agentbox Memory & Learning — Ground Truth"
doc_id: AB-LEARNING
version: 0.1.2
status: draft-for-ratification
verified_commit: 
changelog:
  - "0.1.2 (2026-09-06): Remediation — 2026-09-05 section: ADR-2057/2061/2062/2063/2064/2065/2066/2068/2069/2070/2072 and proposed 2071/2073–2078, the ADR-2018 recall diagnosis, landed in 796d85fcf — re-verified at "
  - "0.1.1: correct duration invariant — zero/null durations are recorded, not skipped (no bug-skip branch exists)"
sources:
  - agentbox/agentbox.toml
  - agentbox/config/hooks/trajectory-recorder.cjs
  - agentbox/config/hooks/lib/trajectory-util.cjs
  - agentbox/mcp/servers/lib/aggregate-effectiveness.js
  - agentbox/mcp/servers/lib/memory-hybrid.js
  - agentbox/mcp/servers/lib/ruvector-gates.js
  - agentbox/scripts/ruvector-aggregate-sweep.mjs
  - agentbox/scripts/ruvector-pattern-distill.mjs
  - agentbox/scripts/ruvector-sona-feeder.mjs
  - agentbox/scripts/ruvector-recall-harness.mjs
  - agentbox/docs/reference/claude-context/ruvector-memory-state.md
date: 2026-08-31
---

# Agentbox Memory & Learning

## Purpose

Ground truth for how agentbox stores durable memory and how it learns from its own
work — the RuVector store, the capture→judge→distil loop, and the gates that decide
what learning reaches retrieval. Present-state only; historical decisions are cited
into the legacy corpus, not narrated.

## Current State

### Store and access invariant

All durable agent memory lives in the `ruvector-postgres` sidecar (Postgres +
RuVector HNSW). The governed `mcp/servers/ruvector-mcp.cjs` server **fails closed**
if Postgres is unreachable — there is no `sql.js` fallback (legacy ADR-015, amended
2026-07-04). Embeddings are computed **client-side** via Xinference
`bge-small-en-v1.5`, **384-dim** (`aggregate-effectiveness.js:48`,
`EMBEDDING_DIM = 384`); never MiniLM, and an A/B rejected `bge-m3`/Qwen3.

**Access invariant (load-bearing):** memory is written and read **only** through the
`mcp__claude-flow__memory_*` MCP tools. The `claude-flow memory` CLI and any raw
`INSERT INTO memory_entries` bypass the Xinference embedding step, producing
NULL-embedding rows that are invisible to HNSW search (DDD-016 I03). Every learning
component below honours this: aggregates and cursors are upserted through the
governed `createMemoryTools({backend:'external-pg'}).memStore` path, never raw SQL
(`aggregate-effectiveness.js:24-30`, `ruvector-aggregate-sweep.mjs:16-28`).

**Namespaces in use.** Learning writes land in `memory-learning-aggregates`
(`aggregate-effectiveness.js:45`). Context namespaces searched before tasks:
`project-state` (current focus/priorities), `personal-context` (owner identity),
and `patterns` (what-worked notes). The distiller writes machine-distilled patterns
into a separate first-class `patterns` **table** (not `memory_entries`), keyed by
content address (`ruvector-pattern-distill.mjs` header §4.1).

**Index law.** HNSW graphs degrade silently under write churn. After any bulk
ingest/deletion recall must be recovered by a **non-concurrent** rebuild (`m=16`,
`ef_construction=128`, ~5 min). `CREATE INDEX CONCURRENTLY` on the RuVector HNSW
access method is forbidden — verified double-insertion (every tuple indexed twice)
(`docs/reference/claude-context/ruvector-memory-state.md:8`).

### The learning loop, as it is

The loop is **closed for capture→judge→distil** (v2 uplift 2026-07-21/22, legacy
PRD-018/ADR-036 producer + PRD-020/ADR-040 aggregator+consumers). Stage by stage:

**1. Capture (producer) — `config/hooks/trajectory-recorder.cjs`.**
Registered as a Claude Code `Stop` / `SubagentStop` hook. It is **transcript-driven,
not per-PostToolUse**, because on this Claude Code build a successful Bash
`tool_response` carries no exit code and PostToolUse does not fire at all for
non-zero-exit commands — the transcript's `tool_result.is_error` is the only source
that sees both outcomes (`trajectory-recorder.cjs:22-26`). On each fire it scans the
session transcript from a per-session line watermark (incremental), grades every
Bash call, and inserts one `trajectory_steps` row per graded step plus a
per-session `trajectories` rollup. Deterministic step ids make re-fires idempotent.

Hard rules enforced in code:
- **Default-off:** silent `exit 0` unless BOTH `RUVECTOR_MEMORY_LEARNING_ENABLED`
  and `RUVECTOR_RECORD_TRAJECTORIES` are on (`trajectory-recorder.cjs:29-31`).
- **Fail-open:** any error exits 0, never blocks Claude.
- **Fail-closed on privacy (I10):** if a command cannot be redacted, the step is
  skipped, never persisted unredacted (`trajectory-util.cjs:116-127`, conservative
  over-redaction of URI creds, `*KEY/TOKEN/SECRET` assignments, bearer tokens,
  40+-char base64 and 32+-char hex runs).
- **Outcome honesty (I04):** the outcome is a real graded signal or **nothing is
  written**. `gradeResult(is_error, stderr, interrupted)` returns
  `success/quality/signal`, or `null` when `is_error` is absent (undetermined) or
  the call was user-interrupted (`trajectory-util.cjs:203-213`). Quality is graded:
  clean success `1.0`, success with stderr noise `0.85`, failure `0.0`.
- **Duration** is measured wall-clock from transcript timestamps and left `null`
  when either timestamp is unparseable or the end precedes the start
  (`trajectory-recorder.cjs:317-319`). A zero duration (both timestamps rounding to
  the same millisecond) is a valid `0`, not a skip — the step is pushed regardless
  of `durationMs` (`:331`), so `duration_ms` may legitimately be `0` or `null`.

**Trajectory schema** (parameterised INSERTs, `trajectory-recorder.cjs:386-424`):
- `trajectories(id, task, agent, status, started_at, metadata)`
- `trajectory_steps(id, trajectory_id, action, result, quality, step_order,
  duration_ms)` — `duration_ms` written only when the column exists (probed and
  cached, `:251-261`).

The durable `action` value is a **low-cardinality command pattern**
(`commandPattern`, `trajectory-util.cjs:38-83`): `<verb>[ <subcommand>] [args:N
flags:N markers]`, carrying no raw args or secrets. The `result` JSON carries the
graded outcome, signal, an optional MAST `failure_mode` tag on failures (REC-5, via
`failure-taxonomy.js`, fail-open to `unmapped`), and optional CTC fields
`token_count` / `duration_ms`. Contextual transaction cost (CTC, legacy PRD-019
REC-3) is captured per step — `tokenCountOf(usage)` sums the whole assistant turn's
token burden and `handoffIdFrom` resolves the chain-correlation id — and forwarded
into a best-effort agent-events emit (`ctcEmitBodyFromStep`,
`trajectory-util.cjs:227-304`; emit fail-open, DB persistence already done).

**2. Judge/aggregate — `scripts/ruvector-aggregate-sweep.mjs` +
`mcp/servers/lib/aggregate-effectiveness.js`.**
A scheduled, incremental, non-destructive sweep (gate `agentbox.toml [memory_learning].aggregate_sweep`,
30-min cadence from `.aggregate_sweep_interval_mins`) groups `trajectory_steps` by `action`
pattern and produces one effectiveness aggregate per pattern. The sweep is a thin
wrapper; the maths lives in `aggregate-effectiveness.js`:
- successes are steps with `quality >= 0.5`, **recency-weighted** by half-life decay
  `weight = 0.5^(age_days / RECENCY_HALF_LIFE_DAYS)` (default 14 days,
  `agentbox.toml [memory_learning].recency_half_life_days`);
- **Wilson score-interval LOWER bound** (z = 1.96) of the recency-weighted success
  proportion over the recency-weighted effective sample size — not the raw rate
  (`wilsonLower`, `aggregate-effectiveness.js:71-80`). A single degenerate label
  cannot move the aggregate;
- the **sample floor uses the RAW observation count** `n`: patterns with
  `n < aggregate_min_samples` (default 20, `agentbox.toml [memory_learning].aggregate_min_samples`) are skipped (I06).

Each surviving aggregate is upserted through the governed `memStore` into
`memory-learning-aggregates`, content-addressed key
`effectiveness-sha256-12-<hash(pattern)>`, typed metadata
`{ importance: wilson, tags: ['action:<pattern>'], memory_type: 'semantic' }`
(`aggregate-effectiveness.js:28-30,86`). The incremental cursor binds on
`max(created_at)` of `trajectory_steps` (steps have `text`, non-monotonic ids) and
is stored as ordinary governed memory tagged `sweep:cursor` so consumers never
surface it as an aggregate (`ruvector-aggregate-sweep.mjs:20-31,105-107`).

**3. Distil — `scripts/ruvector-pattern-distill.mjs`.**
Gate `pattern_distillation` (live, `agentbox.toml [memory_learning].pattern_distillation`). Distils the judged corpus
into content-addressed rows in the `patterns` table (id
`distilled-sha256-12-<hash(action)>`, `ON CONFLICT DO UPDATE`), each carrying a real
Xinference embedding and `metadata.provenance = 'judge:trajectory'`. It **embeds
before insert** and skips any row whose embedding fails, so no NULL-embedding,
HNSW-invisible pattern is ever written (I03-faithful even off `memory_entries`). Its
cursor key is `__pattern_distill_cursor__` tagged `distill:cursor` — distinct from
the sweep and SONA cursors. A provenance firewall keeps W-E legacy-mining candidates
(`proxy:legacy-mining`) out of this feeder's output.

**Corpus size** (reference-doc snapshot, `ruvector-memory-state.md:8`): 405
trajectories / 8,806 judged steps → 12 Wilson aggregates past the floor → 13
`judge:trajectory` patterns, all embedded. See divergence D2 on aggregate counts.

### Consumers and their gates

Consumers are gated separately from producers; the validator flags enabling a
consumer ahead of its producer as W066 (`agentbox.toml [memory_learning]` header comment). Gate resolution is
`RUVECTOR_FEED_RETRIEVAL` / `RUVECTOR_FEED_ROUTING`
(`ruvector-gates.js:38-39`), mirrored from `agentbox.toml` by the entrypoint.

- **`feed_retrieval = true`** (enabled 2026-08-31, `agentbox.toml [memory_learning].feed_retrieval`). The
  consumer is the effectiveness re-rank in `memory-hybrid.js:57-101`: one bounded
  read (LIMIT 500) over `memory-learning-aggregates`, building a
  `action:<pattern> → max wilson` map, then adding a bounded bonus of
  `0.1 * wilson` to any result row whose `metadata.tags` intersect a
  high-effectiveness action tag. Fail-open: any error leaves base ranking untouched.
- **`feed_routing = false`** (`agentbox.toml [memory_learning].feed_routing`) — aggregates surface only as
  advisory `[INTELLIGENCE]` hints; gated on a passing observation window after the
  `feed_retrieval` flip.

### Recall gate (the geometry gate)

No consumer that changes what a query returns may flip its gate without a passing
run of `scripts/ruvector-recall-harness.mjs` (`./agentbox.sh ruvector recall`,
legacy ADR-040 D2 / I14). It runs a frozen, checked-in fixture
(`scripts/recall-fixtures/recall-fixture.v1.json`) against the live HNSW index,
**median of 3 runs** to absorb `ef_search` jitter, and reports three classes:
`self-recall@10` (200 rows), `true-recall@10` (120 rows vs a brute-force exact
scan), and `exact-token` (literal tokens; hybrid must never regress pure-vector).
The harness is read-only against the DB. Pass band in code:
`median(self) ≥ 175/200 AND median(true) ≥ 102/120 AND median(exact-token hybrid
delta) ≥ 0` (`ruvector-recall-harness.mjs` header). See divergence D3.

### Schedulers

Both learning loops are imaged and supervised
(`[program:ruvector-aggregate-sweep]` / `[program:ruvector-pattern-distill]` in the
generated supervisord config, `ruvector-memory-state.md:8`). Each script is
**self-gating**: launched unconditionally, it exits fast when its gate is off, so a
default-off manifest is byte-identical to the pre-learning product. A sibling
scheduler `scripts/ontology-condense-scheduler.mjs` follows the same house pattern
(gated, fail-open, staleness-driven) for the ontology condensation cache.

## Known divergences & open items

- **D1 — SONA inert; `sona_learn`/`sona_apply` OFF.** `ruvector-sona-feeder.mjs`
  streams judged trajectories into `ruvector_sona_learn` under a fixed 384-dim scope
  `agentbox_memory`, but the prebuilt `@ruvector/sona@0.1.5` NAPI binary hardcodes
  `embedding_dim = 256`: 384-dim learns return `status:learned` but accumulate
  nothing (verified live). Both gates stay off until a 384-dim-capable binary
  (`agentbox.toml [memory_learning].sona_learn_enabled` / `.sona_apply_enabled`).
  `attention_rerank` is OFF **by measurement** — on an L2-normalised corpus the
  attention blend is a mathematical identity (max diff 4e-7), not caution
  (`agentbox.toml [memory_learning].attention_rerank`).
- **D2 — aggregate-count drift.** `agentbox.toml [memory_learning].feed_retrieval`
  justifies the `feed_retrieval`
  flip with "78 aggregates ≥20 samples (2026-08-31)", while the reference-state doc
  records "12 aggregates" from the 2026-07-21 sweep (`ruvector-memory-state.md:8`).
  The toml is the running config and the more recent number; the reference doc is a
  July snapshot. Reconcile the reference doc on next ratification.
- **D3 — recall band conflict.** The harness code gates `true` at **≥102/120**
  (`ruvector-recall-harness.mjs` header); `agentbox/CLAUDE.md` and the reference doc
  quote **≥107/120** (live post-rebuild 109/120). Code is authoritative for the
  gate; the prose band is a tighter operational target. `self ≥175/200` agrees
  across both.
- **D4 — README lags the toml.** `agentbox/README.md:314` still lists
  `feed_retrieval` / `feed_routing` as open gates (`false`); the running
  `agentbox.toml` has `feed_retrieval = true` since 2026-08-31. Update the README
  table.
- **D5 — pod-sync deletion has no reverse tombstone (cross-store).** Agent memory is
  primary in RuVector; the VisionClaw Solid Pod is a separate write-master for other
  agent state. `deleteAgentMemory()` in the Pod has **no reverse tombstone into
  RuVector**, so deleting the pod copy does not revoke the RuVector-held agent
  memory. This is an estate-wide erasure gap tracked in the VisionClaw **DATA**
  ground-truth doc; cross-reference it before designing any right-to-erasure flow.
  No point-in-time RuVector backup exists (SQLite-only `backup-sqlite.sh`), so there
  is no cross-store consistent restore, RPO or RTO for memory today.
  **Design recorded — ADR-2060 (proposed, 2026-09-05):** a durable, replayable reverse
  tombstone applied through the governed delete path plus a point-in-time RuVector backup
  with a stated RPO/RTO. Note that VisionClaw has **no RuVector write client at all**, so
  the tombstone must travel as a message to a RuVector-side consumer. D5 stays open until
  that lands; cite it before any right-to-erasure work.
- **D6 — v2 model-lifecycle keys RESERVED.** `embedding_dual_write`,
  `embedding_active_column`, `graph_backbone`, `param_tuning_enabled` and the m3/
  legacy-mining hygiene ops are declared and default-off, gated on a passing recall
  harness run before any may flip (`agentbox.toml [memory_learning]` and
  `[memory_hygiene]`).
- **D7 — Resolved: manifest line citations.** Every `agentbox.toml:<line>` citation
  in this document had drifted (the `[memory_learning]` keys had all moved). Prose
  now cites `agentbox.toml [section].key` — Resolved — ADR-2052 (2026-09-05).

## Invariants (must not silently change)

1. **MCP-only writes, and embedding is enforced.** No raw
   `INSERT INTO memory_entries`; writes use the governed `memStore`. An embedding
   failure **rejects the write** (`reason: 'embedding-unavailable'`) — the store
   does not degrade silently, so no unsearchable row is created. The single route
   to a row without an embedding is the explicit `RUVECTOR_EMBED_REPAIR=true`
   path, which marks `embedding_state: 'pending'` for `memory_repair_embeddings`
   to recover (ADR-2014, ADR-2051).
2. **Producer-before-consumer, enforced at runtime.** A learning consumer takes
   effect only when `consumerAdmission()` in `mcp/servers/lib/ruvector-gates.js`
   admits it: the master gate on, the consumer's gate on, and **either** the
   producer currently capturing **or** an operator-named retained-corpus receipt
   (`RUVECTOR_RETAINED_CORPUS_ACCEPTED`) that is non-empty, dateable, and fresher
   than `RUVECTOR_RETAINED_CORPUS_MAX_AGE_DAYS`. There is no environment override
   that means "trust me". The static validator rule (E066/W066) mirrors the same
   invariant at config time (ADR-2017, ADR-2051).
3. **Outcome honesty (I04).** A step is written only with a real graded signal;
   never default an undetermined or interrupted call to success.
4. **Privacy fail-closed (I10).** An un-redactable command is skipped, never
   persisted raw.
5. **Raw-count sample floor (I06).** The Wilson floor gates on the raw observation
   count, not the recency-weighted effective size.
6. **Recall gate before geometry change (I14).** Any change to what a query returns
   requires a passing median-of-3 harness run against the frozen fixture.
7. **384-dim embedding model** (`bge-small-en-v1.5`) is the active column; a
   dimension migration mints a fresh SONA scope, never reusing `agentbox_memory`.
8. **Non-concurrent AND serial HNSW rebuild only** after bulk churn — `max_parallel_maintenance_workers = 0` (pinned at database level 2026-09-05); the extension's parallel build leaves rows unreachable (ADR-2018 diagnosis 2026-09-05).

## Change process

This is a living document. On any change to the loop: read the code, update the
cited file:line and the `verified_commit`, bump `version`, and reconcile the
divergences above (they are the ratification checklist). Retrieval-geometry changes
additionally require a passing `./agentbox.sh ruvector recall` run recorded under
`backups/ruvector-sidecar/recall-runs/`. Cross-store erasure/backup changes must be
co-designed with the VisionClaw DATA doc (D5).

## Estate closeout qualification — 2026-09-04

The [shared-memory review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/shared-memory.md) and [probe](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/memory-store-probes.json) establish that Postgres failure and embedding failure differ. The latter can persist a NULL vector or retain the previous value's embedding. ADR-2014 is partial for the full searchable-write guarantee; MCP-only access remains mandatory. TTL defaults to semantic metadata, whereas the expiry sweep selects episodic rows only; ordinary reads do not immediately exclude expiry. Model identity/preprocessing, value/vector coherence, repair and expiry semantics need explicit acceptance receipts. Ten existing factory tests pass with mocks; no live recall, sweep or database mutation ran.

**Resolved in part — ADR-2051 (2026-09-05).** The write-path half of this
qualification no longer holds: `memStore` now *rejects* on embedding failure rather
than persisting a NULL vector, and the `ON CONFLICT` clause assigns
`EXCLUDED.embedding` rather than `COALESCE(...)`, so a re-store cannot retain the
previous value's embedding. Invariant 1 above states the enforced rule. The
model-identity, expiry-semantics and live-recall receipts this section asks for are
still outstanding.

## Trajectory privacy and recovery qualification — 2026-09-04

The [learning evidence review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/learning-evidence.md) qualifies I10: redaction exceptions skip writes, but successful regex processing can retain quoted-password fragments or short JSON secret fields. ADR-2015 is partial for its full privacy guarantee. Outcome quality measures command error status; Wilson confidence does not establish task achievement. Missing pg-module handling advances the local watermark, while query exceptions permit retry; partial writes and rollup/event consistency need recovery tests. Twenty-seven helper tests pass; no real transcript or deployed-loop validation ran.

## Learning ordering qualification — 2026-09-04

ADR-2017 is partial: W066 is advisory, and three consumer-before-producer manifests pass the actual validator. The actual hybrid helper with injected dependencies consumes an invented retained aggregate with recording off; this is not a deployed route test. Capture being off does not establish that durable aggregates are absent. [Evidence and acceptance](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/learning-evidence.md#producer-ordering-is-advisory) require explicit retained-corpus policy, master/consumer admission checks, freshness/provenance and restart/override coverage. No existing recall or sample gate is waived.

**Resolved — ADR-2051 (2026-09-05).** Every item this section asks for is now
implemented as `consumerAdmission()` in `mcp/servers/lib/ruvector-gates.js`: an
explicit retained-corpus policy (an operator-named receipt in
`RUVECTOR_RETAINED_CORPUS_ACCEPTED`), master **and** consumer admission checks, a
freshness bound (`RUVECTOR_RETAINED_CORPUS_MAX_AGE_DAYS`, default 30) with
empty-corpus and undateable-corpus both refused, and coverage of the runtime
override case — the helper is the single decision every consumer calls before
applying an effect, so an env override on a running process is caught. W066 is no
longer the only control. Invariant 2 above states the enforced rule.

## Remediation — 2026-09-05

- **ADR-2051** — Invariants 1 and 2 restated as the enforcement the code provides
  (embedding fail-closed; runtime `consumerAdmission`). Resolves the write-path half
  of the estate-closeout qualification and all of the ordering qualification.
- **ADR-2052** — `agentbox.toml` is cited by `[section].key`, never by line number;
  every line citation in this document had drifted. Recorded as D7 above.
- **ADR-2060** (proposed) — the D5 cross-store erasure gap gets a designed target: a
  durable reverse tombstone into RuVector and a restorable memory backup. Authority stays
  with VisionClaw's `DATA-authority-erasure`.

- **ADR-2073** (proposed) — split the Loom store into `assert` and `inferred` named graphs so
  seed and expand both carry a `GRAPH` clause and provenance scope is backend-enforced; until the
  split, an unenforceable scope is refused with an explicit limitation rather than silently
  merged. ADR-2023's "Remaining" is the ORIGIN of this gap and is referenced (`see`), not
  superseded. `GOVERNANCE-capabilities.md` keeps the harness-side Loom façade authority.
- **ADR-2076** (proposed) — benchmark the agent retrieval path (`/loom/search` + `/loom/sparql`)
  on its own terms with a frozen recall band, in the shape of the ADR-040 D2/W-B RuVector recall
  gate; scaffold and chat benchmark numbers are never cited as evidence for this path.

## Remediation — 2026-09-05

- ADR-2018 recall FAIL diagnosed and closed: not index churn (a 16-worker parallel `REINDEX` reproduced 151/200 self-recall, worse than the incrementally grown index) but the ruvector 0.3.0 HNSW **parallel build**, which leaves rows unreachable from the graph at any `ef_search` and any LIMIT. A serial rebuild (`SET max_parallel_maintenance_workers = 0; REINDEX INDEX idx_memory_embedding_hnsw;`, ~8 min) restores self 189/200 and true 115/120 (median-of-3, gate PASS). `ALTER DATABASE ruvector SET max_parallel_maintenance_workers = 0` pins it; the sidecar's `postgresql.auto.conf` still carries the `ALTER SYSTEM` 16 for other databases.
