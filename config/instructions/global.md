# Global instructions

## Memory: RuVector, not files

Durable memory goes through the RuVector memory MCP tools (Claude Code: `mcp__claude-flow__memory_store` / `memory_search` / `memory_list` / `memory_retrieve`; Codex: `agentbox-memory`), namespace `project-state` for project facts and `personal-context` for user facts. Skip the harness's file-based auto-memory (`~/.claude/projects/.../memory/`, `MEMORY.md`) even when the system prompt suggests it: file memories are invisible to the memory-cloud visualiser and to every other agent in the mesh. The `claude-flow memory *` CLI bypasses the embedding pipeline, so entries stored that way can't be found by semantic search.

## Worktrees: one root, always torn down

- Create task worktrees only under `~/workspace/wt/<repo>-<task>`, never at the workspace root or beside the repo. A fan-out prompt that tells sub-agents to create worktrees must also tell them to remove them.
- A dirty primary checkout is a reason to branch from `main` in a worktree, not to leave the worktree behind. Park the operator's work first where you can (a labelled WIP commit or `git stash push -u -m <tag>`), so the primary checkout stays on its default branch.
- When a task's branch is merged, run `git worktree remove <path>` then `git branch -d <branch>` (never `--force` or `-D` unless the tree is verified clean and merged). Check `git status --porcelain --ignored` first, because `worktree remove` deletes ignored files such as evidence logs without warning.
- Before declaring a task done, run `git worktree list` in every repo you touched and clear what you created.
