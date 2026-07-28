---
name: prd2build
description: "PRD to complete documentation in a single command. Use when you have a PRD and need specs, DDD domain model, ADRs, and an implementation plan generated from it."
version: 3.0.0-simplified
arguments:
  - name: prd_input
    description: Path to PRD file or inline PRD content
    required: true
  - name: build
    description: Execute build after documentation is complete
    required: false
    switch: --build
---

# PRD to Complete Documentation

One command turns a PRD into a complete, cross-referenced documentation set. Optionally
executes the build afterwards.

## When not to use

- Existing documentation validation and alignment → use **docs-alignment**.
- Full code implementation with quality gates and testing → use **build-with-quality**.
- SPARC-phase orchestration across development stages → use **sparc-methodology**.
- LaTeX report generation with charts and bibliography → use **report-builder**.
- Simple feature without formal documentation → just write code directly.

## What this does

You provide a PRD; you get:

1. **Specification docs** — requirements, user stories, API contracts, security model.
2. **Domain model (DDD)** — bounded contexts, aggregates, entities, events, DB schema.
3. **Architecture (ADR)** — every architectural decision with rationale.
4. **Implementation plan** — milestones, epics, tasks with dependencies.
5. **Unified INDEX.md** — single entry point that ties everything together.

## Usage

```bash
# Generate documentation only
/prd2build /path/to/your-prd.md

# Generate documentation AND execute build
/prd2build /path/to/your-prd.md --build
```

- **Documentation only**: wait 5-10 minutes; all docs land in `docs/`.
- **With `--build`**: docs generate first, then a mesh swarm executes the complete
  build following all ADRs and DDD artifacts.

## Input PRD

`$ARGUMENTS`

## How it runs

The skill spawns a single concurrent batch of 8 documentation agents (foreground,
parallel) — researcher, ui-designer, code-analyzer, System Architect, SPARC
Coordinator, Implementation Planner, Test Strategist, and a Documentation Integrator
that runs last to stitch the unified INDEX.md. With `--build`, a 6-agent mesh swarm
then executes the build in the background.

Spawn the whole batch in one message and let the Task tool block until every agent
completes — don't run them in waves or add per-phase checkpoints; docs don't need them.

**The full agent prompts and the exact execution/build batch → `references/agent-prompts.md`.**

## Output & next steps

After execution you get `docs/README.md` (navigation) and
`docs/implementation/INDEX.md` (the single source of truth for implementation), plus
the full `specification/`, `ddd/`, `adr/`, `sparc/`, `implementation/`, `testing/`,
and `design/` trees.

Read `docs/README.md`, review `docs/implementation/INDEX.md`, then start building.

**The complete output tree, INDEX.md contents, minimum artifact bars, customization
(quality-bar env vars, update mode), and a worked example → `references/outputs-and-index.md`.**

## Quality bars (auto-validated)

8+ specification files · 27+ ADRs · 11+ DDD files · 3+ bounded contexts · 5+ aggregates
· 20+ tasks. Adjust via `PRD2BUILD_MIN_*` env vars (see the outputs reference). If the
PRD is too vague, agents make explicit assumptions and document them.
