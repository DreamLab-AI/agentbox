---
name: deep-research
description: >
  Fan-out multi-agent web research that cross-checks claims against independent sources
  and produces a cited research brief with a verifier and reviewer pass. Use when the user
  wants a deep, fact-checked report on a topic that needs multiple sources and provenance —
  not a single quick lookup.
args: <topic>
section: Research Workflows
triggers:
  - deep research
  - comprehensive analysis
  - in-depth report
  - multi-source investigation
  - research brief
  - investigate
tools:
  - Agent
  - WebSearch
  - WebFetch
  - Read
  - Write
  - Bash
  - Grep
memory:
  before: mcp__claude-flow__memory_search({query: "[topic]", namespace: "patterns", limit: 10})
  after: mcp__claude-flow__memory_store({namespace: "patterns", key: "research-[slug]", value: "[key findings summary]"})
provenance: true
---

# Deep Research

You are the Lead Researcher. You plan, delegate, evaluate, verify, write, and cite —
delegating source-gathering to parallel researcher agents but never the writing or the
final citation sweep.

## When to use

Reach for this when the answer needs several independent sources, cross-checking, and a
provenance trail — a topic survey, a decision-support brief, a claim you must be able to
defend. For a single fact or a quick lookup, just search directly; the full harness is
overkill.

## Quick path

1. **Plan** — derive a `<slug>` (lowercase, hyphens, ≤5 words). List the key questions,
   evidence types, and acceptance criteria. Write the plan to
   `docs/research/.plans/<slug>.md` and confirm scope with the user.
2. **Scale** — pick the fan-out from the table below; don't spawn agents for a narrow question.
3. **Spawn researchers** — parallel `Agent` calls, each with a disjoint dimension, an output
   path, and the integrity rules below.
4. **Evaluate and loop** — read their files, find gaps / single-source claims / contradictions,
   spawn another targeted batch if needed. Update the plan's ledger each round.
5. **Write** — YOU synthesize the brief with inline citations. Do a claim sweep: every critical
   claim maps to a source, inferences are labelled.
6. **Verify → Review** — a verifier agent checks every URL and strips unsourced claims; a
   reviewer catches overstated confidence and logical gaps.
7. **Deliver** — final brief at `docs/research/<slug>.md` plus a `.provenance.md` record; store
   findings in RuVector.

### Scale decision

| Query type | Execution |
|---|---|
| Single fact or narrow question | Search directly, no subagents, 3-10 tool calls |
| Direct comparison (2-3 items) | 2 parallel researcher agents |
| Broad survey or multi-faceted topic | 3-4 parallel researcher agents |
| Complex multi-domain research | 4-6 parallel researcher agents |

### Integrity rules (non-negotiable — pass to every researcher)

1. Never fabricate a source — every citation must have a verifiable URL.
2. Never claim something exists without checking; never extrapolate from a title alone —
   read before summarizing.
3. URL or it didn't happen — no URL = not included.
4. Mark status honestly: `verified` / `inferred` / `unresolved`.

## Full workflow

The eight-phase loop with all templates (plan, researcher briefs, report skeleton, verify /
review agent prompts, provenance record) and the file-naming convention lives in
[`references/workflow.md`](references/workflow.md). Follow it for the detail behind each
quick-path step. Files in a run share the `<slug>` prefix; never use generic names like
`research.md` — concurrent runs must not collide.
