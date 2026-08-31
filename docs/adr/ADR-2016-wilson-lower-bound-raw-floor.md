---
id: ADR-2016
title: Aggregate eligibility is a Wilson lower bound floored on the raw observation count
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: cbe7335b9
owner: jjohare
review_trigger: The recency half-life, z-value, or min-samples floor is changed, or the floor is proposed to gate on effective size
repo: agentbox
domain: LEARNING-memory
lineage: "legacy PRD-020 / ADR-040, ADR-037 D3 (sample floor), DDD-018 (I06)."
---

# ADR-2016 — Aggregate eligibility is a Wilson lower bound floored on the raw observation count

## Context
Ranking patterns by their raw success rate over-promotes lucky small samples: one
success out of one looks perfect. Recency weighting (a 14-day half-life) is needed
so stale evidence decays, but recency weighting also shrinks effective sample size
— so a single recent label could otherwise dominate the count and slip a pattern
past any sample floor (ADR-037 D3, DDD-018 I06). Two separate protections are
required: a conservative point estimate, and a floor that a recency trick cannot
inflate.

## Decision
An effectiveness aggregate is the **Wilson score-interval lower bound (z = 1.96)**
of the recency-weighted (14-day half-life) success proportion — not the raw rate —
so uncertainty penalises thin evidence. The min-samples floor gates on the **raw
observation count `n`**, not the recency-weighted effective size, so a single
degenerate or recent label cannot move a pattern past the gate. Default floor is
20 (`RUVECTOR_AGGREGATE_MIN_SAMPLES`). This forecloses both small-sample optimism
(via Wilson) and recency-weighting the count past the floor (via the raw-`n` gate).

## Consequences
- New patterns need genuine repeated evidence (raw n ≥ 20) before they can rank.
- Established patterns decay gracefully as their evidence ages (half-life weighting
  in the numerator/denominator of the Wilson input).
- The two-signal design costs some latency to promotion — a good new pattern is
  invisible until it clears the raw floor, by design.
- Tuning the floor or half-life shifts the corpus's conservatism and is a
  review_trigger.

## Verification
implementation_status = complete at verified_commit cbe7335b9. Confirmed by grep of
`mcp/servers/lib/aggregate-effectiveness.js`: `Z = 1.96` (line 47), `wilsonLower(succ, n, z)`
over fractional recency-weighted inputs (line 71, called at line 194),
`eligible = list.filter((r) => (Number(r.n) || 0) >= minSamples)` gating on the RAW
count (line 168), `minSamples` sourced from `gateParams.aggregateMinSamples()`
(line 166). `ruvector-gates.js:48` sets the default floor to 20.
