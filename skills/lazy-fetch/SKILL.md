---
skill: lazy-fetch
name: lazy-fetch
version: 1.0.0
description: >-
  Context management, plan tracking, blueprints, and progressive discovery
  companion for Claude Code sessions. Provides 25 MCP tools for context
  hydration, phased task planning, deterministic+agentic workflow blueprints,
  persistent memory (bridged to RuVector), security scanning, and autonomous
  PRD-to-sprints execution. Ported from Lazy-Fetch by Clemens865.
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
that actually work and combines them into a lightweight CLI + MCP server.

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

## Context Engine

### Symbol Extraction

The context engine extracts symbols from source files using lightweight regex
patterns. No language server required. Supported languages:

| Language | Extracted Symbols |
|----------|------------------|
| TypeScript (.ts) | functions, classes, interfaces, types, consts, exports |
| JavaScript (.js) | functions, classes, consts, exports, module.exports |
| Python (.py) | functions, classes, async functions |
| Rust (.rs) | pub functions, structs, enums, traits |
| Go (.go) | functions, methods, struct types, interface types |
| Ruby (.rb) | methods, classes, modules |

Symbols are cached in `.lazy/context/symbols.json` and rebuilt on each
`gather` or `context` call.

### File Search

Three search strategies run in parallel when `lazy_gather` is called:

1. **Name match** -- file names containing any keyword from the task
2. **Content match** -- files containing keywords (via grep, respects .gitignore)
3. **Symbol match** -- symbols whose names contain keywords

Keywords are extracted by splitting camelCase, snake_case, and kebab-case,
then removing stop words and common verbs.

Results are merged, deduplicated, sorted, and presented as `@`-mentions for
Claude Code to read directly.

## Progressive Discovery

Context builds up over time through four signals:

1. **Watch** (`lazy_watch`) -- tracks file change frequency from the last 20
   git commits. Files with more recent changes score higher. Counts decay by
   50% each time watch runs, so stale files fade out naturally.

2. **Access log** -- stored in `.lazy/context/access.json`. Aggregates change
   counts across multiple watch invocations, giving a cumulative view of
   which files matter.

3. **Gather** -- each `lazy_gather` call rebuilds the full symbol index and
   records which files were relevant to which task descriptions.

4. **Session hooks** -- `session-start.sh` runs both `watch` and `claudemd`
   automatically at session start, ensuring fresh context before any work
   begins.

The net effect: files that matter to the current work surface first. Files
that have not been touched recently fade into the background. No manual
curation required.

## Security Scanner

The `lazy_secure` tool runs a 23-rule pattern-based security audit across all
source files. It scans `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.rb`, `.go`,
`.rs`, `.java`, `.php`, `.sql`, `.yaml`, `.json`, `.env`, `.sh`, `.html`,
and more.

### Rule Categories

**Critical** (6 rules): hardcoded API keys, hardcoded passwords, AWS access
keys, inline private keys, hardcoded JWT secrets, database connection strings
with embedded credentials, committed .env files.

**High** (6 rules): SQL injection via string concatenation, command injection
via unsanitised user input in exec/spawn, path traversal, XSS via
dangerouslySetInnerHTML, eval() usage, unsafe RegExp from user input.

**Medium** (7 rules): CORS wildcard, API routes without auth, HTTP URLs in
production code, insecure cookies, missing rate limiting, unsafe
deserialisation, exposed error details to clients.

**Low** (4 rules): console.log with sensitive data, security-related TODOs,
debug mode enabled, weak crypto algorithms (MD5/SHA1).

### Gate Mode

`lazy_secure(gate: true)` runs only critical and high rules, skipping the
dependency audit. This mode is used as a validation gate in yolo mode and
by `lazy_check` for quick security feedback.

### Dependency Audit

In full mode, the scanner also runs `npm audit` (if `package-lock.json`
exists) and reports critical, high, and moderate vulnerabilities.

## Yolo Mode

Yolo mode parses a PRD (Product Requirements Document) markdown file into
sprints and generates a master prompt for fully autonomous execution.

### Flow

1. **Start**: `lazy_yolo_start(prd_file)` -- parse PRD, create sprint plan,
   take pre-yolo snapshot, return master prompt with full instructions.
2. **Execute**: for each sprint, gather context, implement tasks (using
   blueprints where appropriate), validate with `lazy_check`.
3. **Advance**: `lazy_yolo_advance(notes)` -- run validation + security gate.
   If passed, mark sprint done and advance. If failed, fix and retry (max 3
   attempts per sprint).
4. **Report**: `lazy_yolo_report()` -- generate scorecard with first-pass
   rate, total retries, per-sprint timing and attempt counts.

### PRD Format

PRDs should use `##` headings as sprint/phase boundaries and bullet points
(`-` or `*`) as tasks within each section. If the PRD is unstructured (no
sections with bullet points), tasks are auto-divided into three sprints:
Foundation, Core Features, and Polish.

### Dry Run

`lazy yolo <prd> --dry-run` previews the sprint plan without writing any
state, so you can review the breakdown before committing.

### Event Log

Every yolo run logs structured events to `.lazy/runs/<run-id>/events.jsonl`:
start, validation attempts, sprint completions, failures, and overall
completion. The report command reads these events for the scorecard.

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
