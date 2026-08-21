---
skill: lazy-fetch
name: lazy-fetch
version: 1.0.0
description: >-
  Context, persistence, and process-tracking companion for single-agent Claude
  Code sessions. Use when hydrating session context (git/plan/memory), tracking
  phased read/plan/implement/validate/document task plans, running blueprint
  workflows, doing progressive file discovery, persisting decisions across
  sessions, running a quick security scan before committing, or building
  autonomously from a PRD. Not for multi-agent swarms or hive-mind — use ruflo
  for those.
tags:
  - context-management
  - plan-tracking
  - blueprints
  - progressive-discovery
  - memory-persistence
  - security-scanner
  - session-management
  - yolo-mode
mcp_server: true
protocol: stdio
entry_point: mcp-server/dist/mcp-server.js
dependencies:
  - nodejs >= 23
  - typescript >= 6
author: Clemens865 (ported by agentbox)
---

# Lazy Fetch -- Context, Persistence, and Process Tracking

## Overview

Lazy Fetch solves three things that Claude Code sessions lack out of the box:
**context**, **persistence**, and **process tracking**.

Built from analysing 18 agentic coding frameworks, it extracts only the patterns
that actually work and combines them into a lightweight CLI + MCP server (25 MCP
tools). Ported from Lazy-Fetch by Clemens865.

**Key capabilities:**

- **Progressive discovery** -- symbol-aware context engine that builds relevance
  over time via file access patterns and git history analysis
- **Phased task planning** -- break goals into read/plan/implement/validate/document
  phases with numbered task tracking
- **Blueprint workflows** -- deterministic+agentic YAML pipelines for common tasks
  (fix-bug, add-feature, experiment, review-code)
- **Memory persistence** -- key-value store + append-only journal, bridged to
  RuVector for cross-session durability
- **Security scanning** -- 23-rule pattern-based audit (secrets, injection, auth, deps)
- **Yolo mode** -- parse a PRD into sprints and execute autonomously
- **Hooks** -- session-start context injection, post-edit type checking,
  pre-compact state preservation, session-stop journaling

## When to Use

**Use lazy-fetch when:**

- Starting a session and need context restored (plan, memory, git state)
- Working on a single-agent task that follows the read/plan/implement/validate loop
- Need progressive file discovery for a task before diving into code
- Want deterministic workflow steps (blueprint) with agentic implementation
- Need to persist decisions across sessions
- Running a quick security scan before committing
- Building from a PRD in autonomous mode

**Do NOT use lazy-fetch when:**

- Orchestrating multi-agent swarms (use ruflo/claude-flow swarm orchestration)
- Coordinating hive-mind consensus (use hive-mind skills)
- Managing cross-agent memory (use mcp__claude-flow__memory_* directly)
- Running complex hierarchical agent topologies (use ruflo)
- The task requires more than one agent working simultaneously

## Integration with RuVector

All `remember`/`recall` operations bridge to RuVector via the `lazy-fetch`
namespace. The local `.lazy/memory.json` file serves as a session cache only.

```
lazy remember "auth" "bcrypt passwords, JWT 24h expiry"
  --> local: .lazy/memory.json (cache)
  --> remote: mcp__claude-flow__memory_store(namespace="lazy-fetch", key="auth", value="...")

lazy recall "auth"
  --> primary: mcp__claude-flow__memory_search(query="auth", namespace="lazy-fetch")
  --> fallback: .lazy/memory.json (if RuVector unavailable)
```

## The Loop

Every task follows five phases:

```
read --> plan --> implement --> validate --> document
```

| Phase | Command | Purpose |
|-------|---------|---------|
| Read | `lazy read` | Load git state, plan progress, stored memory |
| Plan | `lazy plan <goal>` | Break goal into phased tasks |
| Implement | (write code) | Claude Code writes the solution |
| Validate | `lazy check` | Typecheck, tests, lint, plan progress |
| Document | `lazy remember` / `lazy journal` | Persist decisions and outcomes |

## MCP Tools (25)

### The Loop
| Tool | Purpose |
|------|---------|
| `lazy_read` | Get up to date -- git, plan, memory |
| `lazy_plan` | Break a goal into phased steps |
| `lazy_add` | Add a task to the current plan |
| `lazy_status` | Phase-grouped view with numbered tasks |
| `lazy_update` | Mark progress (todo, active, done, stuck) |
| `lazy_next` | Show next task and gather context |
| `lazy_remove` | Delete a task from the plan |
| `lazy_reset_plan` | Archive and start fresh |
| `lazy_check` | Validate: tests, lint, types, plan progress |

### Context
| Tool | Purpose |
|------|---------|
| `lazy_context` | Repo map with symbol index |
| `lazy_gather` | Find relevant files for a task (symbol-aware) |
| `lazy_watch` | Learn which files matter from git history |
| `lazy_claudemd` | Generate context file for Claude Code |

### Persistence
| Tool | Purpose |
|------|---------|
| `lazy_remember` | Store a fact across sessions (bridges to RuVector) |
| `lazy_recall` | Retrieve stored knowledge (fuzzy search) |
| `lazy_journal` | Append-only decision log |
| `lazy_snapshot` | Save point-in-time state (plan + memory) |

### Blueprints
| Tool | Purpose |
|------|---------|
| `lazy_blueprint_list` | Show available blueprints |
| `lazy_blueprint_show` | Preview blueprint steps |
| `lazy_blueprint_run` | Execute a blueprint workflow |

### Security and Yolo
| Tool | Purpose |
|------|---------|
| `lazy_secure` | Full security audit (23 rules) |
| `lazy_yolo_start` | Parse PRD into sprints, start autonomous mode |
| `lazy_yolo_status` | Current sprint progress |
| `lazy_yolo_advance` | Advance to next sprint (with validation gate) |
| `lazy_yolo_report` | Process quality scorecard |

## Blueprints

Pre-built YAML workflows in `blueprints/`:

| Blueprint | Trigger | Steps |
|-----------|---------|-------|
| `fix-bug` | bug, error, crash | gather, checkpoint, analyse, fix, typecheck, test, remember |
| `add-feature` | add, implement, create | gather, research, plan, implement, typecheck, test, document |
| `experiment` | try, prototype, spike | gather, branch, implement, validate, evaluate |
| `review-code` | review, audit | gather, diff, typecheck, review, suggest |
| `improve` | refactor, optimise | gather, analyse, implement, validate, remember |

Deterministic steps run automatically. Agentic steps return prompts for Claude Code.

## Hooks

| Event | Hook | Purpose |
|-------|------|---------|
| SessionStart | `session-start.sh` | Inject plan, memory, git state into context |
| PostToolUse | `post-edit-check.sh` | TypeScript check after every code edit |
| PreCompact | `pre-compact.sh` | Preserve plan + memory through context compression |
| Stop | `session-stop.sh` | Auto-journal changes, update file access patterns |

## Slash Commands

Fifteen commands are available in `commands/` for Claude Code's `/project:` prefix:

| Command | Action |
|---------|--------|
| `/project:read` | Load session state (git, plan, memory) |
| `/project:plan` | Create a phased plan for a goal |
| `/project:status` | Show plan progress grouped by phase |
| `/project:done` | Mark a task complete, show next |
| `/project:next` | Show and gather context for next task |
| `/project:gather` | Find relevant files for a task |
| `/project:context` | Show repo map or search for symbols |
| `/project:check` | Run health checks (typecheck, tests, lint, security) |
| `/project:remember` | Store a persistent fact (key-value) |
| `/project:recall` | Retrieve stored knowledge |
| `/project:journal` | Append to or read the decision log |
| `/project:snapshot` | Save current state as a named snapshot |
| `/project:blueprint` | Run a blueprint workflow |
| `/project:init` | Initialise .lazy/ in a project |
| `/project:yolo` | Start autonomous PRD-to-sprints execution |

## Deep-dive references

Load on demand when working the relevant subsystem:

- [`references/context-engine.md`](references/context-engine.md) -- symbol
  extraction, file-search strategies, and the four progressive-discovery signals.
- [`references/security-scanner.md`](references/security-scanner.md) -- the full
  23-rule catalogue (critical/high/medium/low), gate mode, dependency audit.
- [`references/yolo-mode.md`](references/yolo-mode.md) -- PRD-to-sprints
  autonomous flow, PRD format, dry run, event log.
- [`references/file-structure.md`](references/file-structure.md) -- full
  directory tree of the skill.

## Complementing Ruflo

| Dimension | Lazy-Fetch | Ruflo |
|-----------|-----------|-------|
| Agent count | Single | 1-15+ |
| Memory | RuVector bridge (lazy-fetch ns) | RuVector native (all ns) |
| Workflows | YAML blueprints | Swarm topologies |
| Context | Progressive discovery | Agent-scoped worktrees |
| Autonomy | Yolo (single-agent) | Hive-mind (multi-agent) |

Use lazy-fetch for focused single-agent work. Use ruflo for multi-agent coordination.
Use both when a ruflo-spawned agent needs progressive discovery within its scope.

## File Structure

```
skills/lazy-fetch/
  SKILL.md              This documentation
  mcp-config.json       MCP server configuration for Claude Code
  mcp-server/
    src/                TypeScript source (unmodified from upstream)
      mcp-server.ts     MCP server entry point (25 tools)
      cli.ts            CLI entry point
      store.ts          .lazy/ directory I/O helpers
      process.ts        Plan management (plan, status, update, check, read)
      persist.ts        Memory, journal, snapshot
      context.ts        Symbol extraction, file search, repo map
      blueprint.ts      YAML blueprint parser and runner
      secure.ts         23-rule security scanner
      yolo.ts           PRD-to-sprints autonomous execution
      selftest.ts       Self-validation test suite
    dist/               Compiled JavaScript (ready to run)
    package.json        Dependencies
    tsconfig.json       TypeScript configuration
  hooks/
    session-start.sh    SessionStart -- inject plan, memory, git into context
    session-stop.sh     Stop -- auto-journal changes, update access patterns
    post-edit-check.sh  PostToolUse -- typecheck after code edits
    pre-compact.sh      PreCompact -- snapshot state before compaction
    detect-check.sh     Auto-detect project typecheck command
    detect-test.sh      Auto-detect project test runner
  blueprints/
    fix-bug.yaml        Bug fix workflow
    add-feature.yaml    Feature development workflow
    experiment.yaml     Experimental change with rollback
    review-code.yaml    Code review workflow
    improve.yaml        Self-improvement loop (AutoResearch pattern)
  commands/             15 slash command definitions (.md)
  tools/
    install.sh          Global installation script
    test.sh             Smoke test suite
    ruvector-bridge.sh  Memory sync to RuVector
```

## Installation

```bash
cd skills/lazy-fetch/mcp-server
npm install
npm run build
```

The build step compiles TypeScript from `src/` to `dist/`. The MCP server
runs as a stdio process. Add it to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "lazy-fetch": {
      "command": "node",
      "args": ["skills/lazy-fetch/mcp-server/dist/mcp-server.js"]
    }
  }
}
```
