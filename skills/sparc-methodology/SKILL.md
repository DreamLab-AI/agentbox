---
name: sparc-methodology
description: "SPARC — a systematic 5-phase development lifecycle (Specification, Pseudocode, Architecture, Refinement, Completion) run through Claude Flow multi-agent orchestration. Use when driving a feature from spec through review and deployment with coordinated agents, or when you want a structured spec→design→TDD→review→completion pipeline rather than ad-hoc edits."
version: 2.7.0
category: development
tags:
  - sparc
  - tdd
  - architecture
  - orchestration
  - methodology
  - multi-agent
author: Claude Flow
---

# SPARC Methodology

SPARC (Specification, Pseudocode, Architecture, Refinement, Completion) is a
systematic development lifecycle wired into Claude Flow's multi-agent
orchestration. It offers 17 specialized modes covering research, architecture,
TDD, review, and deployment. This guide is the quick-path; the deep detail lives
in `references/`.

## When to use

Reach for SPARC when a task benefits from a structured, multi-phase lifecycle with
coordinated agents — e.g. building a feature from requirements through tested,
reviewed, deployed code, or running a spec→design→TDD→review pipeline.

## When not to use

- Full quality engineering with 111+ agents, coverage gates, and defect prediction — use **build-with-quality**.
- GitHub-specific code-review swarms on PRs — use **github-code-review**.
- Queen-led hive-mind / Byzantine consensus without a full dev lifecycle — use **hive-mind-advanced**.
- PRD-to-documentation generation without the SPARC lifecycle — use **prd2build**.
- Raw swarm-coordination primitives (quick mesh/star/ring, load balancing) without methodology overhead — use **swarm-advanced**.
- Simple single-file changes that need no multi-phase orchestration — edit directly.

## Core philosophy

Specification before code · design before implementation · tests before features ·
review everything · document continuously. Emphasises TDD, parallel agent
execution, persistent Memory sharing across agents/sessions, and modular design.

## The five phases

| Phase | Goal | Key modes |
|-------|------|-----------|
| 1. Specification | Requirements, constraints, success criteria, pseudocode planning | `researcher`, `analyzer`, `memory-manager` |
| 2. Architecture | System structure, interfaces, schema, API contracts, infra | `architect`, `designer`, `orchestrator` |
| 3. Refinement (TDD) | Failing tests → minimum code → pass → refactor → iterate | `tdd`, `coder`, `tester` |
| 4. Review | Quality, security, performance, best-practice validation | `reviewer`, `optimizer`, `debugger` |
| 5. Completion | Integration, deployment, monitoring, docs, knowledge capture | `workflow-manager`, `documenter`, `memory-manager` |

The 17 modes span core orchestration (`orchestrator`, `swarm-coordinator`,
`workflow-manager`, `batch-executor`), development (`coder`, `architect`, `tdd`,
`reviewer`), analysis/research (`researcher`, `analyzer`, `optimizer`), and
creative/support (`designer`, `innovator`, `documenter`, `debugger`, `tester`,
`memory-manager`). Full per-mode capabilities, quality standards, and usage
snippets: **[references/modes.md](references/modes.md)**.

## Quick path

Run a single mode (preferred inside Claude Code):

```javascript
mcp__claude-flow__sparc_mode { mode: "coder", task_description: "implement JWT auth" }
```

Or from the terminal:

```bash
npx claude-flow sparc modes                     # list all modes
npx claude-flow sparc run <mode> "task"         # run one mode
npx claude-flow sparc tdd "feature"             # full TDD workflow
npx claude-flow sparc pipeline "task"           # full spec→completion pipeline
npx claude-flow sparc batch <mode1,mode2> "task"
```

For complex work, initialize a swarm first, then spawn agents and monitor:

```javascript
mcp__claude-flow__swarm_init { topology: "hierarchical", strategy: "auto", maxAgents: 8 }
mcp__claude-flow__sparc_mode { mode: "orchestrator", task_description: "coordinate feature dev" }
mcp__claude-flow__swarm_monitor { swarmId: "current", interval: 5000 }
```

## References

- **[references/modes.md](references/modes.md)** — the five phases in depth and all 17 modes (capabilities, quality standards, usage snippets).
- **[references/orchestration.md](references/orchestration.md)** — activation methods (MCP / NPX / local), the five swarm topologies, and the complete TDD + red-green-refactor workflows.
- **[references/cookbook.md](references/cookbook.md)** — best practices (Memory, batching, hooks, coverage, file layout), worked integration examples (full-stack, innovation, legacy refactor), common CLI workflows, advanced features (neural training, cross-session memory, GitHub, monitoring), and performance context.

## Working principles

- **Memory for coordination**: store architectural decisions and share across agents/sessions (`memory_store` / `memory_retrieve`).
- **Batch related operations** in a single message rather than one call per message.
- **Wire hooks** (`pre-task` / `post-edit` / `post-task`) for lifecycle coordination.
- **Target ~90% coverage** and document as you build.
See `references/cookbook.md` for the full detail on each.
