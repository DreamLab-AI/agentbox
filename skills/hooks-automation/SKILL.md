---
name: hooks-automation
description: "Automate coordination, formatting, and learning around Claude Code operations with claude-flow hooks. Use when setting up pre/post task hooks, session handoffs between agents, risk assessment before a command runs, memory coordination, or agent-routing/neural-pattern learning. Not for one-off swarm orchestration without persistent hooks, full TDD/quality-gate pipelines, or single-agent plan/memory/security-scan hooks (see Related Skills)."
compatibility: "Claude Code only -- hooks are a Claude Code harness feature (PreToolUse/PostToolUse/SessionStart/SessionEnd matchers in .claude/settings.json). On Codex/GPT-6 Astra: no hook equivalent; call the underlying mcp__claude-flow__* tools directly, or run the claude-flow hooks CLI as a plain shell step in your own workflow."
---

# Hooks Automation

Intelligent automation system that coordinates, validates, and learns from
Claude Code operations through hooks integrated with MCP tools and
neural/routing pattern training.

See [references/examples.md](references/examples.md) for complete
configuration templates and Git hook scripts.

## What This Skill Does

**Key capabilities:**
- **Pre-operation hooks**: risk-assess a command, get agent-routing suggestions before a file edit or task
- **Post-operation hooks**: record edit/task/command outcomes for learning
- **Session management**: persist and restore session state
- **Memory coordination**: read/write shared context via `mcp__claude-flow__memory_usage`
- **Agent routing**: `route`/`explain` — route a task to the best-fit agent and see why
- **Pattern learning**: outcomes recorded by hooks feed `claude-flow hooks pretrain`/`metrics`

## When Not To Use

- One-off swarm orchestration without persistent hooks -- use `swarm-advanced` instead
- Full development pipelines with quality gates -- use `build-with-quality` instead
- Single-agent plan/memory/security-scan hooks -- use `lazy-fetch` instead (see Related Skills for the ownership split)
- GitHub-specific CI/CD workflow authoring -- use a GitHub workflow-automation skill instead
- Standalone performance profiling -- use a performance-analysis skill instead

## Prerequisites

**Required:**
- `claude-flow` already on PATH as the baked ruflo CLI (Nix store derivation) -- no install needed; do not run `npm install -g claude-flow@alpha`, it is redundant and may fail in this read-only-Nix-store container
- Claude Code with hooks enabled
- `.claude/settings.json` with hook configurations

**Optional:**
- Git repository for version control (for the Git hook scripts in references/examples.md)

## Quick Start

```bash
# Verify the CLI and see every real subcommand
claude-flow hooks --help
```

Add hook entries under `.claude/settings.json`'s `hooks` key (Claude Code's
own config, not a claude-flow subcommand):

### Basic Hook Usage

```bash
claude-flow hooks pre-task -d "Implement authentication"
claude-flow hooks post-edit -f "src/auth.js" --success true
claude-flow hooks session-end
```

### Minimal `settings.json`

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^(Write|Edit|MultiEdit)$",
        "hooks": [{ "type": "command", "command": "claude-flow hooks pre-edit -f '${tool.params.file_path}'" }]
      },
      {
        "matcher": "^Bash$",
        "hooks": [{ "type": "command", "command": "claude-flow hooks pre-command -c '${tool.params.command}'" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "^(Write|Edit|MultiEdit)$",
        "hooks": [{ "type": "command", "command": "claude-flow hooks post-edit -f '${tool.params.file_path}' --success true" }]
      },
      {
        "matcher": "^Bash$",
        "hooks": [{ "type": "command", "command": "claude-flow hooks post-command -c '${tool.params.command}' --success true" }]
      }
    ]
  }
}
```

---

## Available Hooks (verified against `claude-flow hooks --help`, 2026-09-09)

### Pre-operation hooks (run BEFORE the tool)

| Hook | Purpose | Key options |
|------|---------|-------------|
| `pre-edit` | Get context and agent suggestions before editing | `-f/--file`, `-o/--operation` (create/update/delete/refactor), `-c/--context` |
| `pre-command` (alias `pre-bash`) | Assess risk before executing a command | `-c/--command`, `-d/--dry-run` (default true) |
| `pre-task` | Record task start and get agent suggestions | `-i/--task-id`, `-d/--description` (required), `-a/--auto-spawn` |

```bash
claude-flow hooks pre-edit -f src/auth.js -o refactor
claude-flow hooks pre-command -c "rm -rf dist"
claude-flow hooks pre-task -d "Implement user authentication" --auto-spawn
```

### Post-operation hooks (run AFTER the tool)

| Hook | Purpose | Key options |
|------|---------|-------------|
| `post-edit` | Record editing outcome for learning | `-f/--file`, `-s/--success`, `-o/--outcome`, `-m/--metrics` |
| `post-command` (alias `post-bash`) | Record command execution outcome | `-c/--command`, `-s/--success`, `-e/--exit-code`, `-d/--duration` |
| `post-task` | Record task completion for learning | `-i/--task-id`, `-s/--success`, `-q/--quality`, `-a/--agent`, `-t/--task`, `--store-results` |

```bash
claude-flow hooks post-edit -f src/auth.js --success true
claude-flow hooks post-command -c "npm test" --success true
claude-flow hooks post-task -i task-123 --success true -q 0.9
```

### Routing hooks

| Hook | Purpose | Key options |
|------|---------|-------------|
| `route` | Route task to optimal agent using learned patterns | `-t/--task` (required), `-K/--top-k`, `--mode` (single/moa) |
| `explain` | Explain a routing decision with transparency | `-t/--task`, `-a/--agent`, `-v/--verbose` |

```bash
claude-flow hooks route -t "Fix authentication bug"
claude-flow hooks explain -t "Fix authentication bug" -a coder --verbose
```

### Session hooks

| Hook | Purpose | Key options |
|------|---------|-------------|
| `session-end` | End current session and persist state | `-s/--save-state` (default true) |
| `session-restore` | Restore a previous session | `-i/--session-id` (default "latest"), `-a/--restore-agents`, `-t/--restore-tasks` |
| `notify` | Send a notification message (logged to session) | `-m/--message` (required), `-l/--level`, `-c/--channel` |

```bash
claude-flow hooks session-end
claude-flow hooks session-restore -i latest
claude-flow hooks notify -m "Task complete" -l info
```

### Learning and diagnostics

| Hook | Purpose |
|------|---------|
| `pretrain` | Bootstrap intelligence from the repository (4-step pipeline + embeddings) |
| `metrics` | View the learning-metrics dashboard (`-p/--period`, `--v3-dashboard`) |
| `list` | List all registered hooks (alias `ls`) |

```bash
claude-flow hooks metrics --period 7d --v3-dashboard
claude-flow hooks list --enabled
```

`claude-flow hooks --help` lists every subcommand, including
`worker`/`progress`/`statusline`/`coverage-*`/`token-optimize`/`model-*` --
check there before relying on a flag not shown above, the CLI is the source
of truth, not this table.

---

## Which Hook to Use When

| Situation | Hook |
|-----------|------|
| About to run a risky shell command | `pre-command` (`-d false` to actually assess, not just dry-run) |
| Starting a multi-file task | `pre-task` |
| Finished editing a file | `post-edit` |
| Completed a task | `post-task` |
| Need to know which agent should own a task | `route` / `explain` |
| Ending a session | `session-end` |
| Resuming a session | `session-restore` |
| Agent-to-agent handoff | `notify`, then `session-restore` on the receiver |

---

## Memory Coordination

Hooks that need to share state across agents do it through
`mcp__claude-flow__memory_usage` directly (namespace `coordination`), not
through a dedicated hook subcommand. A three-phase status -> progress ->
complete pattern is a convention you can apply in a custom hook script, not
an automatic behaviour of the built-in hooks above. Worked example:
[references/examples.md#memory-coordination-pattern](references/examples.md#memory-coordination-pattern).

---

## Performance Tips

1. Prefer the deprecation-free, current subcommand names (`pre-command`, not the deprecated `route-task`/`session-start` aliases)
2. Keep custom hook scripts fast; heavy work belongs in a background job, not the hook's PreToolUse/PostToolUse path
3. Batch related `memory_usage` writes rather than one call per field
4. Set an explicit `"timeout"` in `settings.json` hook entries for anything that shells out

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Hooks not executing | Bad `settings.json` syntax or wrong matcher regex | Validate the JSON; check the matcher against the actual tool name |
| Unknown command errors | A documented flag/subcommand that isn't real | `claude-flow hooks --help` and `claude-flow hooks <cmd> --help` are the source of truth -- this file can drift, the binary cannot |
| Nothing shows in `metrics` | No hooks have run yet, or `pretrain` was never run | `claude-flow hooks list` to confirm registration; `claude-flow hooks pretrain` to bootstrap |

---

## Integration with Other Skills

- **SPARC Methodology** -- hooks enhance SPARC workflows
- **build-with-quality** -- automated quality gates in a full dev+QE pipeline (supersedes the old "Pair Programming" skill, deprecated and merged in)
- **lazy-fetch** -- owns the single-agent plan/memory/security-scan hook lifecycle (SessionStart/PostToolUse/PreCompact/Stop); this skill owns swarm-coordination and neural/routing-pattern hooks. Install both together if you need both lifecycles; they do not register the same hook events.
- **GitHub workflows** -- Git integration for commits/PRs (see references/examples.md)
- **Performance analysis** -- metrics collection in hooks

---

## Related Commands

```bash
claude-flow hooks --help              # every real subcommand
claude-flow hooks list                # list registered hooks
claude-flow hooks metrics             # learning metrics dashboard
claude-flow hooks pretrain            # bootstrap intelligence from repo
```
