---
name: stream-chain
description: "Sequential multi-agent pipelines and data transformation via Claude Flow MCP workflow tools. Use when step N's output must feed step N+1's input (build->test->optimise, extract->transform->validate). Not for parallel swarms or GitHub CI."
version: 2.0.0
category: workflow
tags: [streaming, pipeline, chaining, multi-agent, workflow]
---

# Stream-Chain Skill

Execute multi-step workflows where each step's complete output flows into the next
step as context, enabling sequential data transformation and multi-agent coordination.

**Rewritten 2026-09-09**: the `claude-flow stream-chain` CLI command this skill
originally documented does not exist in the deployed CLI (verified: `claude-flow
stream-chain --help` → "[ERROR] Unknown command: stream-chain"; confirmed absent
from the full `claude-flow --help` command list). ruvnet-brain's upstream corpus
shows this is a faithful vendor copy of a real ruflo skill, so the break is a
deployment/version mismatch, not invented content — the command may return in a
future image. Until then, use the MCP tools below.

Claude Code only: the `mcp__claude-flow__*` tools below need the claude-flow MCP
server registered (already wired in this container). On Codex / GPT-6 Astra:
there is no claude-flow MCP wiring unless registered in `~/.codex/config.toml` —
run the steps sequentially yourself in one session instead, pasting each step's
output into the next prompt by hand.

## When to use

- Sequential pipelines where each step builds on the previous output.
- Multi-stage data transformation (extract -> transform -> validate -> report).
- Iterative refinement or verification chains (implement -> test -> verify).

## When NOT to use

- Parallel multi-agent swarm orchestration -> use `swarm-advanced` (this skill is sequential).
- GitHub-specific CI/CD pipelines -> use `github-workflow-automation`.
- Cloud workflow automation with Flow Nexus -> use `flow-nexus-swarm`.
- Simple single-step tasks that need no chaining -> run the task directly.

## Quick start (MCP tools)

Two ways to chain, verified against the live tool list (`mcp__claude-flow__workflow_create`,
`workflow_execute`, `parallel_execute`, `task_orchestrate` all present):

### Ad hoc chain — feed output forward yourself

For a one-off chain, call `task_orchestrate` with `strategy: "sequential"` once
per step, passing the previous step's result back in as context for the next:

```javascript
const step1 = await mcp__claude-flow__task_orchestrate({
  task: "Analyze codebase structure",
  strategy: "sequential"
})

const step2 = await mcp__claude-flow__task_orchestrate({
  task: `Previous step output:\n${step1.result}\n\nNext task: Identify improvement areas`,
  strategy: "sequential"
})

const step3 = await mcp__claude-flow__task_orchestrate({
  task: `Previous step output:\n${step2.result}\n\nNext task: Generate action plan`,
  strategy: "sequential"
})
```

### Reusable chain — a named workflow

For a chain you will reuse, define it once with `workflow_create` (steps run in
the order listed; omit `parallel: true` to keep them sequential — see
`swarm-advanced` for the parallel form) and run it with `workflow_execute`:

```javascript
mcp__claude-flow__workflow_create({
  name: "analysis-chain",
  steps: [
    { phase: "structure",        task: "Map directory structure and identify components" },
    { phase: "issues",           task: "Find potential improvements and problems" },
    { phase: "recommendations",  task: "Generate actionable improvement report" }
  ]
})

mcp__claude-flow__workflow_execute({ workflowId: "analysis-chain" })
```

The CLI equivalent for named workflows, `claude-flow workflow run -t <template>
--task "..."` and `claude-flow workflow list`, is real (verified: `claude-flow
workflow --help`) but runs a workflow template file, not an inline prompt
sequence — it is not the same as the retired `stream-chain run`/`pipeline`
subcommands.

## References

- **[references/pipelines.md](references/pipelines.md)** — the four predefined
  pipeline shapes (analysis / refactor / test / optimize) as `workflow_create`
  step lists, and the retired CLI syntax kept as a dated historical note.
- **[references/cookbook.md](references/cookbook.md)** — how context flows
  between steps, worked examples translated to MCP calls, best practices, and
  the retired CLI syntax kept as a dated historical note.
- **[scripts/qa-chain.sh](scripts/qa-chain.sh)** — currently a stub: the
  `stream-chain pipeline` command it drove does not exist, and there is no
  single-shot CLI substitute (the MCP tools above are the working path, and
  they are not scriptable from bash without an MCP client). Run the four
  pipelines from Claude Code interactively via the workflow calls above
  instead.
