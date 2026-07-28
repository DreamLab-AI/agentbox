---
name: codebase-memory
description: >
  Structural code-intelligence MCP for large codebases — trace call graphs, get
  architecture overviews, score git-diff impact, search symbols, and manage ADRs
  from a persistent tree-sitter knowledge graph. Use on large or unfamiliar repos
  (500+ files) for "what calls X?", blast-radius / diff-risk analysis, module
  architecture, or symbol lookup — when Grep/Glob are slow or noisy. Prefer direct
  Read/Grep for small projects and one-off fixes.
version: 1.0.0
author: DeusData
mcp_server: true
protocol: stdio
entry_point: codebase-memory-mcp
tags:
  - code-intelligence
  - call-graph
  - architecture
  - mcp
  - large-codebase
env_vars:
  - CBM_CACHE_DIR
---

# Codebase Memory — Structural Code Intelligence MCP

Builds a persistent knowledge graph of your codebase and answers structural
questions (call chains, architecture, diff impact) without pulling file contents
into context. Single binary, no API keys, tree-sitter across 66 languages. The
binary is pre-installed in this container; the MCP server starts on demand.

## When to Use

Deploy for large codebases (500+ files) when:
- **Call chains**: "What calls ProcessOrder? Show the full chain."
- **Architecture**: "Give me an overview of the payment module."
- **Diff impact**: "What does this git diff affect? Risk score it."
- **Symbol search**: "Find all classes that implement IRepository."
- **ADR management**: "Create an ADR for switching to PostgreSQL."
- **Session start**: index once, then query instantly for the rest of the session.

### When NOT to
- Small projects (< 100 files) — direct Read/Grep is sufficient.
- One-off fixes — the indexing overhead (30s–5min) isn't worth it.
- Already indexed — check `index_status` before re-indexing.

## Quick Path

```
# 1. Index once (~30s small repos, up to ~5min for 1M+ files)
index_repository(repo_path="/home/devuser/workspace/project")

# 2. Query the graph instead of Grep/Glob
trace_call_path(...)   # who calls / is called by X (depth 1–5)
get_architecture(...)  # languages, routes, endpoints, clusters
detect_changes(...)    # git diff → affected symbols + risk score
search_graph(...)      # find a class/symbol by name
get_code_snippet(...)  # fetch source by qualified name

# 3. Verify freshness at session start
index_status(...)      # if stale (last sync > latest commit) → index_repository
```

Full tool catalog (14 tools), parameters, and the token-efficiency figures are in
[`references/reference.md`](references/reference.md).

## Permanent Project Upgrade (one-time setup, lasting benefit)

Once a project is indexed, append a "Codebase Memory MCP (ACTIVE — USE FIRST)"
block to its `CLAUDE.md` / `CLAUDE.local.md` so future sessions default to these
tools before Grep/Glob. Consider this when starting exploratory work on an
unfamiliar large repo, before a refactor that needs blast-radius awareness, or
when "what calls X?" questions recur. The ready-to-paste block, its tool-routing
table, and the trigger checklist are in
[`references/reference.md`](references/reference.md#permanent-claudemd-upgrade-block).

## More

- Tool catalog, token-efficiency table, architecture, env vars, setup, and
  cross-skill integration: [`references/reference.md`](references/reference.md).
- Attribution: codebase-memory-mcp by DeusData
  (https://github.com/DeusData/codebase-memory-mcp).
