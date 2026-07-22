# ADR-015: Mandate ruvector-postgres for MCP Memory Backend

**Status:** Accepted
**Date:** 2026-05-06
**Deciders:** jjohare, claude-flow

## Context

Claude Code inside agentbox uses MCP (Model Context Protocol) tools for persistent
memory (`memory_store`, `memory_search`, `memory_list`, `memory_retrieve`).  These
tools are served by an MCP server declared in `.mcp.json`.

Prior to this ADR, three failure modes existed:

1. **Silent fallback to sql.js/SQLite.** The `ruflo mcp start` command bundled a
   sql.js in-memory backend. If the PostgreSQL `pg` module was unavailable or the
   connection failed, memory tools appeared to work but stored nothing durable and
   could not see the 2M+ entries in ruvector-postgres.

2. **Stale `.mcp.json` after rebuild.** The `.mcp.json` pointing to
   `ruvector-mcp.cjs` was manually placed via `docker exec` and not regenerated on
   container rebuild, causing regression to the ruflo/sql.js backend.

3. **Missing `pg` dependency.** The `pg` npm module was never included in the Nix
   image. The MCP server's `require('pg')` silently failed, triggering fallback (1).

The net effect: the internal agent reported "HNSW + sql.js backend responding" and
could not see any of the 2,054,325 rows in ruvector-postgres.

## Decision

### Fail-closed MCP server

`ruvector-mcp.cjs` (v2.2.0+) exits with `FATAL` if:
- The `pg` module cannot be loaded from any search path
- The initial `SELECT 1` connectivity probe to ruvector-postgres fails

No silent degradation. Claude Code sees the MCP server crash and reports a tool
error, which is visible and actionable.

### Boot-provisioned `.mcp.json`

The entrypoint (`entrypoint-unified.sh`) generates a canonical `.mcp.json` at the
workspace root (`/home/devuser/workspace/.mcp.json`) on every boot. This file:
- Points `claude-flow` to `/opt/agentbox/mcp/servers/ruvector-mcp.cjs`
- Passes `RUVECTOR_PG_CONNINFO` and `NODE_PATH` via env
- Is idempotent: only written if missing or not already pointing to ruvector-mcp

Claude Code resolves `.mcp.json` by walking up from the working directory, so this
workspace-root file acts as the default for all projects.

### Workspace-persistent `pg` module

The entrypoint auto-installs `pg` to `/home/devuser/workspace/.claude-pg/` if the
`node_modules/pg` directory doesn't exist. This prefix lives on the workspace bind
mount, surviving image rebuilds. The MCP server searches for `pg` in order:

1. `/home/devuser/workspace/.claude-pg/node_modules/pg` (workspace install)
2. `/opt/agentbox/management-api/node_modules/pg` (image-baked, if present)
3. `pg` (global/NODE_PATH resolution)

## Consequences

- **Internal agent always sees ruvector-postgres** with 2M+ entries and HNSW vector
  search (384-dim MiniLM-L6-v2 embeddings via `generate_text_embedding()`).
- **Rebuilds are safe.** The entrypoint regenerates config; the workspace volume
  retains the `pg` install.
- **Failures are loud.** No more "works but empty" — the MCP server either connects
  to PG or crashes with a clear error and remediation instruction.
- **First boot after a volume wipe** takes ~2s extra for `npm install pg`.

## Related

- ruvector-postgres schema: `memory_entries` table with `ruvector(384)` embedding column
- `generate_text_embedding()`: server-side embedding function (MiniLM-L6-v2, 384-dim)
- ADR-005: Pluggable adapter architecture (memory adapter slot)

## Amendment (2026-07-04) — embedding pipeline correction

A live audit (7-agent verification against the running system) found two claims
in this ADR stale; the mandate itself stands, but the mechanism is corrected:

- **Embeddings are NOT MiniLM-L6-v2 and NOT computed by `generate_text_embedding()`.**
  The live `ruvector-mcp.cjs` computes embeddings client-side via Xinference
  (`XINFERENCE_ENDPOINT`, model **`bge-small-en-v1.5`**, 384-dim) and INSERTs the
  vector directly. The Postgres-side `generate_text_embedding()` is a
  non-semantic character-hash stub and is never called by the live path.
- **Two copies of the MCP server exist**: this ADR's mandated
  `/opt/agentbox/mcp/servers/ruvector-mcp.cjs` (registered `claude-flow`, carries
  `PROTECTED_NAMESPACES` governance) and an older diverged personal copy at
  `~/.claude/ruvector-mcp.cjs` (registered `ruvector`, no governance guard).
  Consolidation onto the mandated copy is the recorded intent.

Full audit findings: `~/workspace/docs/ruvector-system-reference.md`.

## Amendment (2026-07-22) — reindex ops law and recall harness

The v2 learning-uplift work ([PRD-020](../prd/PRD-020-ruvector-learning-consumers-and-corpus-uplift.md) / [ADR-040](ADR-040-learning-consumers-model-lifecycle-and-legacy-mining.md)) established two operating facts that now attach to this mandate:

- **Reindex ops law.** The HNSW index on `memory_entries.embedding` degrades under
  write churn: after a bulk ingest or deletion, recall falls **silently** (live
  self-recall dropped to 141/200 before it was caught) and is recovered only by a
  **non-concurrent** index rebuild (`m=16`, `ef_construction=128`, ~5 min).
  `ef_search` tuning did nothing. **Never run `CREATE INDEX CONCURRENTLY` on the
  ruvector HNSW access method** — it double-inserts (every tuple is indexed twice;
  verified live). This is the settled operating procedure for the mandated store:
  rebuild non-concurrently after any bulk op, never concurrently.
- **Recall harness now exists.** `./agentbox.sh ruvector recall` runs a stratified
  fixture (median-of-3) against a **frozen band — self ≥175/200 · true ≥107/120 ·
  exact-token Δ≥0** — and is THE gate for any change to retrieval geometry (index
  params, embedding model, re-rank). The audit-era 188/200 was a **pre-ingest**
  number and is not the current bar; live post-rebuild is 177/200 · 109/120.

The embedding pipeline is unchanged from the 2026-07-04 amendment: Xinference
`bge-small-en-v1.5` (384-dim). A v2 A/B (ADR-040 D7 / PRD-020 W-D) evaluated
Qwen3-0.6B/4B and `bge-m3` against it and **rejected all three** — the Qwen3
instruction prefix collapses exact-token recall and `bge-m3`'s sole win was
redundant with hybrid scoring. bge-small stays the mandated pipeline.
