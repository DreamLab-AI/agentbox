---
id: ADR-2014
title: Durable memory is MCP-only and the store fails closed
date: 2026-08-31
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: cbe7335b9
owner: jjohare
review_trigger: A new memory backend is proposed, or a learning component needs to write rows without going through memStore
repo: agentbox
domain: LEARNING-memory
lineage: "legacy ADR-015 (MCP-RuVector mandate, amended 2026-07-04 to drop sql.js), DDD-016 I03 (raw INSERTs → NULL-embedding rows invisible to HNSW)."
---

# ADR-2014 — Durable memory is MCP-only and the store fails closed

## Context
Rows written to RuVector without going through the Xinference embedding pipeline
land with a NULL embedding and are invisible to HNSW search — a silent corpus
leak (DDD-016 I03). The bundled sql.js fallback embeds nothing, so a transparent
fallback would degrade every write to unsearchable. Learning components are
tempted to `INSERT INTO memory_entries` directly for speed. The mandate
(ADR-015) was amended on 2026-07-04 to remove the sql.js path entirely.

## Decision
Every durable-memory read/write goes through the governed
`mcp__claude-flow__memory_*` path so it embeds via Xinference. The
RuVector-Postgres store **throws** when the `pg` module cannot be located rather
than falling back to an embedding-less sql.js store, and no learning component
ever issues a raw `INSERT`: effectiveness aggregates are upserted only through
the `createMemoryTools({ backend: 'external-pg' })` `memStore` path. This
forecloses transparent degradation — an unreachable Postgres is a hard error the
caller must see, never a silent switch to an unsearchable local store.

## Consequences
- The intended searchable-write guarantee is incomplete: embedding failure can
  persist NULL vectors or retain a previous vector on replacement. See the
  dated closeout extension; Postgres unavailability still fails the operation.
- Memory is unavailable, loudly, when Postgres is down — callers must handle the
  throw rather than receiving stale or empty results (this is the intended cost).
- A break-glass raw write exists only behind `RUVECTOR_ADMIN_WRITE=true`
  (`ruvector-gates.js` `adminWrite`), keeping the exception explicit and gated.
- Contributors cannot add a "convenient" local cache without violating the ADR.

## Verification
implementation_status = complete at verified_commit cbe7335b9. Confirmed by
grep: `mcp/servers/ruvector-mcp.cjs:42` throws `pg not found in any search path`
with no sql.js branch (header comment line 7 documents the removed fallback);
`mcp/servers/lib/aggregate-effectiveness.js:24-25,294,324` upserts THROUGH the
`memStore` external-pg backend and its header forbids raw SQL INSERT, and line 60
throws when no `pg` module resolves; `ruvector-gates.js:41` gates the admin-write
override on an env flag.

## Closeout extension — 2026-09-04

Work packages: **CP-03/04/07/08**. Owner remains `jjohare`; memory and release maintainers own the cross-service acceptance boundary.

The ten existing factory tests pass. An isolated production-factory probe shows embedding failure still stores with embedded=false; replacements preserve the old vector through COALESCE. The full no-NULL/searchable-value guarantee is therefore not implemented.

**Acceptance condition:** Choose fail-closed embedding or explicit durable repair; verify failed initial/replacement writes, coherent value/vector versions and eventual searchable recovery. Define TTL visibility/deletion across semantic and episodic records.

Dependencies: CP-01 release/model identity and the caller-authority contract. Reopen on model, write/fallback, TTL or retrieval changes. Historical verification fields are retained; this annex records source/mock evidence at `89301ec7c911eab270c00a0cf81596d0d4f15535`, not a new production or recall certification.

See the [shared-memory review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/shared-memory.md), [source/test receipt](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/memory-snapshot.json) and [isolated probe](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/memory-store-probes.json).

## Acceptance progress — 2026-09-05

**Implemented.** The searchable-write guarantee is now enforced rather than
documented. `memStore` chooses **fail-closed by default**: an embedding failure
returns `success:false, stored:false, reason:'embedding-unavailable'` and writes
nothing at all. `RUVECTOR_EMBED_REPAIR=1` opts into the alternative the
acceptance condition allows — an **explicit durable repair state**: the row is
written with a NULL vector plus an `embedding_state:'pending'` marker and the
caller is told (`repair_pending:true`, `searchable:false`). The replacement
defect is closed structurally: `ON CONFLICT` now assigns `embedding =
EXCLUDED.embedding`, so a replacement's vector is either this value's or
explicitly NULL and the two versions can never disagree; under typed metadata the
row also records `value_digest`, `embed_digest`, `embed_model` and
`embed_prefix_chars`. `memRepairEmbeddings()` drives pending rows back to
searchable by re-embedding **from the stored value**, is idempotent (`WHERE
embedding IS NULL`), is bounded, and has a `dry_run` that reports the pending
census — the "expose pending/unsearchable rows" half. It is registered as the MCP
tool `memory_repair_embeddings`.

TTL is now defined for both memory types: it is a **visibility deadline** applied
by `notExpiredPredicate()` on every read path (retrieve, list, vector search, the
ILIKE fallback, hybrid and orient), and **deletion** is the separate act of the
sweep, which now covers semantic rows too — the review's finding was that a
TTL-only write defaults to `semantic` and was therefore never deleted. A missed
sweep delays erasure; it never resurrects an expired row. A malformed
`expires_at` is treated as absent so corrupt metadata can neither hide nor
destroy a row.

**Tests and results.** `mcp/servers/lib/memory-tools.test.js` — 23 assertions
pass, 0 fail. The pre-closeout suite *asserted* the degraded write this ADR
forbids; that case is replaced by fail-closed coverage. New cases: failed initial
write, failed replacement, the absence of COALESCE, repair-mode pending writes
with the gate on and off, repair success, repair failure surfaced rather than
claimed, repair refused when the embedder is down, and TTL visibility on every
read path plus both sweep behaviours.

**Receipts.** `docs/estate-closeout/2026-09-05/adr-2014-memory-fail-closed.json`.
The live ADR-2018 recall run independently observed **1 row awaiting embedding
repair** out of 196,896 in the production corpus, so the pending census is
exercised against real data (read-only).

**Governed paths changed.** `mcp/servers/lib/memory-tools.js`,
`mcp/servers/lib/memory-metadata.js`, `mcp/servers/lib/memory-hybrid.js`,
`mcp/servers/ruvector-mcp.cjs`, `mcp/servers/lib/memory-tools.test.js`.

**Remaining.** Rows written under the old behaviour may already carry NULL
vectors; the repair tool exists but has not been run against production because
it writes. With the typed-metadata gate off the value/vector binding is
structural rather than evidenced per row. Backup participation in TTL is still
undefined: an expired row the sweep deletes may survive in a retained backup.
`implementation_status` stays `partial` until a production repair run and a
passing recall receipt exist together.
