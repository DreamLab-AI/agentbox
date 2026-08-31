---
id: ADR-2014
title: Durable memory is MCP-only and the store fails closed
date: 2026-08-31
decision_status: accepted
implementation_status: complete
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
- No NULL-embedding rows enter the corpus; every persisted row is HNSW-findable.
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
