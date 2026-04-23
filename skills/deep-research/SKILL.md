---
name: deep-research
description: >
  Run a thorough, source-heavy investigation on any topic. Produces a cited research brief with
  provenance tracking, verification, and inline citations. Uses parallel researcher agents with
  a verifier and reviewer pass.
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

You are the Lead Researcher. You plan, delegate, evaluate, verify, write, and cite.

## 1. Plan

Derive a short **slug** from the topic (lowercase, hyphens, no filler, ≤5 words).

Analyze the research question. Develop a strategy:
- Key questions that must be answered
- Evidence types needed (papers, web, code, data, docs)
- Sub-questions disjoint enough to parallelize
- Acceptance criteria: what evidence makes the answer "sufficient"

Write the plan to `docs/research/.plans/<slug>.md`:

```markdown
# Research Plan: [topic]

## Questions
1. ...

## Strategy
- Researcher allocations and dimensions

## Acceptance Criteria
- [ ] All key questions answered with ≥2 independent sources
- [ ] Contradictions identified and addressed
- [ ] No single-source claims on critical findings

## Task Ledger
| ID | Owner | Task | Status | Output |
|---|---|---|---|---|
| T1 | researcher-1 | ... | todo | ... |

## Verification Log
| Item | Method | Status | Evidence |
|---|---|---|---|
```

Store plan in RuVector memory:
```javascript
mcp__claude-flow__memory_store({namespace: "patterns", key: "research-[slug]-plan", value: "[plan summary]"})
```

Present the plan and get user confirmation before proceeding.

## 2. Scale Decision

| Query type | Execution |
|---|---|
| Single fact or narrow question | Search directly, no subagents, 3-10 tool calls |
| Direct comparison (2-3 items) | 2 parallel researcher agents |
| Broad survey or multi-faceted topic | 3-4 parallel researcher agents |
| Complex multi-domain research | 4-6 parallel researcher agents |

## 3. Spawn Researchers

Launch parallel agents via the Agent tool. Each gets a structured brief:
- **Objective**: what to find
- **Output format**: numbered sources, evidence table, inline references
- **Tool guidance**: which search tools to use (WebSearch, WebFetch, Grep for local code)
- **Task boundaries**: what NOT to cover (another researcher handles that)
- **Output file**: `docs/research/<slug>-research-[dimension].md`

```
Agent({
  description: "Research [dimension]",
  subagent_type: "researcher",
  name: "researcher-[N]",
  run_in_background: true,
  prompt: "[structured brief with objective, boundaries, output path]"
})
```

### Researcher Integrity Rules (passed to each agent)
1. Never fabricate a source — every citation must have a verifiable URL
2. Never claim something exists without checking
3. Never extrapolate details from titles alone — read before summarizing
4. URL or it didn't happen — no URL = not included
5. Mark status honestly: `verified` / `inferred` / `unresolved`

## 4. Evaluate and Loop

After researchers return, read their output files and assess:
- Which questions remain unanswered?
- Which answers rest on only one source?
- Any contradictions needing resolution?
- Did every ledger task get completed, blocked, or superseded?

If gaps are significant, spawn another targeted batch. Iterate until evidence is sufficient.

Update the plan artifact task ledger and verification log after each round.

## 5. Write the Report

YOU write the full research brief. Do not delegate writing. Synthesize findings:

```markdown
# [Topic]

## Executive Summary
2-3 paragraph overview.

## Section 1: ...
Detailed findings with inline citations [1], [2].

## Open Questions
Unresolved issues, source disagreements, evidence gaps.
```

### Claim Sweep (before finalizing)
- Map each critical claim to its supporting source
- Downgrade or remove anything that cannot be grounded
- Label inferences as inferences

Save draft to `docs/research/.drafts/<slug>-draft.md`.

## 6. Verify

Spawn a verifier agent to add inline citations and verify URLs:

```
Agent({
  description: "Verify citations",
  subagent_type: "reviewer",
  prompt: "Add inline citations to docs/research/.drafts/<slug>-draft.md using the research files. Verify every URL resolves. Remove unsourced claims. Output: docs/research/<slug>-brief.md"
})
```

## 7. Review

Spawn a reviewer agent to check for:
- Unsupported claims that slipped past citation
- Logical gaps or contradictions
- Single-source claims on critical findings
- Overstated confidence relative to evidence quality

If FATAL issues found, fix and re-verify. MAJOR issues noted in Open Questions.

## 8. Deliver

Save final output as `docs/research/<slug>.md`.

Write provenance record as `docs/research/<slug>.provenance.md`:

```markdown
# Provenance: [topic]

- **Date:** [date]
- **Rounds:** [number of researcher rounds]
- **Sources consulted:** [total unique sources]
- **Sources accepted:** [survived verification]
- **Sources rejected:** [dead links, unverifiable]
- **Verification:** [PASS / PASS WITH NOTES]
- **Plan:** docs/research/.plans/<slug>.md
- **Research files:** [list]
```

Store key findings in RuVector:
```javascript
mcp__claude-flow__memory_store({namespace: "patterns", key: "research-[slug]-findings", value: "[key findings, sources, confidence levels]"})
```

## File Naming Convention

All files in a single run use the same slug prefix:
- Plan: `docs/research/.plans/<slug>.md`
- Research: `docs/research/<slug>-research-[dimension].md`
- Draft: `docs/research/.drafts/<slug>-draft.md`
- Final: `docs/research/<slug>.md`
- Provenance: `docs/research/<slug>.provenance.md`
- Verification: `docs/research/<slug>-verification.md`

Never use generic names like `research.md` or `draft.md`. Concurrent runs must not collide.
