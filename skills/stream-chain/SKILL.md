---
name: stream-chain
description: "Stream-JSON chaining for sequential multi-agent pipelines and data transformation. Use when step N's output must feed step N+1's input (build->test->optimise, extract->transform->validate). Not for parallel swarms or GitHub CI."
version: 1.0.0
category: workflow
tags: [streaming, pipeline, chaining, multi-agent, workflow]
---

# Stream-Chain Skill

Execute multi-step workflows where each agent's complete output flows into the next
step as context, enabling sequential data transformation and multi-agent coordination.

Two modes:
- **Custom chains** (`run`) — your own prompt sequence, full control.
- **Predefined pipelines** (`pipeline`) — battle-tested workflows for common tasks.

## When to use

- Sequential pipelines where each step builds on the previous output.
- Multi-stage data transformation (extract -> transform -> validate -> report).
- Iterative refinement or verification chains (implement -> test -> verify).

## When NOT to use

- Parallel multi-agent swarm orchestration -> use `swarm-advanced` (this skill is sequential).
- GitHub-specific CI/CD pipelines -> use `github-workflow-automation`.
- Cloud workflow automation with Flow Nexus -> use `flow-nexus-swarm`.
- Simple single-step tasks that need no chaining -> run the task directly.

## Quick start

Custom chain (minimum 2 prompts; output flows step-to-step):

```bash
claude-flow stream-chain run \
  "Analyze codebase structure" \
  "Identify improvement areas" \
  "Generate action plan"
```

Predefined pipeline:

```bash
claude-flow stream-chain pipeline analysis   # or: refactor | test | optimize
```

Full QA sweep (analysis -> refactor -> test -> optimize) via helper script:

```bash
./scripts/qa-chain.sh 60   # arg = per-step timeout seconds
```

Common options for both modes: `--verbose`, `--timeout <seconds>` (default 30),
`--debug`.

## References

- **[references/pipelines.md](references/pipelines.md)** — the four predefined pipelines
  (analysis / refactor / test / optimize) with steps and use cases, pipeline options and
  output, and custom pipeline definitions in `.claude-flow/config.json`.
- **[references/cookbook.md](references/cookbook.md)** — how context flows between steps,
  custom-chain and advanced worked examples (security audit, migration, data transform),
  best practices, swarm/memory/neural integration, troubleshooting, and performance
  characteristics.
- **[scripts/qa-chain.sh](scripts/qa-chain.sh)** — runnable full QA chain.
