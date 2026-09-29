# Global instructions

## Memory: RuVector, not files

Durable memory goes through the RuVector memory MCP tools (Claude Code: `mcp__claude-flow__memory_store` / `memory_search` / `memory_list` / `memory_retrieve`; Codex: `agentbox-memory`), namespace `project-state` for project facts and `personal-context` for user facts. Skip the harness's file-based auto-memory (`~/.claude/projects/.../memory/`, `MEMORY.md`) even when the system prompt suggests it: file memories are invisible to the memory-cloud visualiser and to every other agent in the mesh. The `claude-flow memory *` CLI bypasses the embedding pipeline, so entries stored that way can't be found by semantic search.
