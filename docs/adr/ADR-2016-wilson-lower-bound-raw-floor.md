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

## Closeout extension — 2026-09-04

Work packages: CP-04/07/08. Owner remains `jjohare`, with learning/privacy and operations maintainers responsible for acceptance across persistence boundaries.

Twenty-seven learning/helper tests pass. Wilson weighting and the raw-count floor are implemented; their input is primarily command error status, not verified task achievement. Repeated observations can remain correlated.

**Acceptance condition:** Retain the raw-count floor while binding promotion to representative, attributable outcomes; test duplicate/correlated samples, stale evidence, misleading zero-exit commands and replayed persistence.

Dependencies: shared-memory value/vector recovery, release identity and an explicit outcome/retention policy. Reopen on grader, redactor, transcript shape, persistence or promotion changes. Existing verification/activation fields retain their historical scope; this annex is source/helper evidence, not a live-loop certification.

See [learning evidence review](../../../../VisionFlow/docs/estate-review/learning-evidence.md) and [receipt](../../../../VisionFlow/docs/estate-review/evidence/learning-snapshot.json).

## Acceptance progress — 2026-09-05

**Implemented.** The raw-count floor is retained exactly as it was; three
corrections bind promotion to representative, attributable evidence, and all
three make promotion *harder*.

*Attributability.* Some verbs' zero exit carries no information about task
achievement — `echo`, `ls`, `cd`, `true`, `cat` succeed almost unconditionally.
Their patterns are now excluded from promotion outright, because otherwise they
accumulate a near-1.0 bound and outrank real work. This is the concrete form of
the review's "misleading zero-exit commands".

*Independence.* Forty repetitions inside one session are not forty independent
observations. The Wilson interval is now computed over an **effective sample
deflated by the observed correlation** (distinct trajectories ÷ raw
observations), and a second floor requires evidence from at least three distinct
trajectories. The success *proportion* is untouched — only the confidence in it
changes, which is the honest correction. Worked example: 40 observations at 100%
success from **one** trajectory fall from a 0.9124 bound to 0.2065 and are
refused; the same 40 across 20 trajectories give 0.8389 and are promoted.

*Ambiguity.* A zero-exit command that wrote to stderr is graded 0.85 — real but
ambiguous evidence. It now stays in the denominator and leaves the numerator:
only a clean success counts, and ambiguous observations are counted separately as
`n_ambiguous`. A staleness window additionally excludes evidence older than 90
days, because recency decay never reaches zero and a pattern last seen a year ago
would otherwise stay eligible on its raw count alone.

Each aggregate now carries `n_trajectories`, `n_distinct_commands`,
`n_ambiguous`, `independence` and `wilson_uncorrected` beside `wilson`, so the
cost of the correction is visible rather than hidden inside one number, and
`summariseGates` reports `patterns_withheld` by reason so "nothing promoted" is a
diagnosis rather than a silence.

**Tests and results.** `tests/sovereign/learning-evidence-closeout.test.js`
(ADR-2016 block) and the updated `tests/sovereign/effectiveness-learning.test.js`
— 47 pass, 0 fail across the two. Covered: the retained raw floor, duplicate and
correlated samples, the interval widening under correlation at an identical
proportion, misleading zero-exit verbs, stale evidence, replayed persistence
(identical input gives identical output), and the withheld-reason reporting. Four
pre-existing cases encoded the pre-closeout definition of `wilson` and the bare
gate check; they are updated to the new contract with the reason recorded inline.

**Receipts.**
`docs/estate-closeout/2026-09-05/adr-2016-promotion-evidence.json`.

**Governed paths changed.** `mcp/servers/lib/aggregate-effectiveness.js`,
`tests/sovereign/effectiveness-learning.test.js`.

**Remaining.** Independence is approximated by distinct trajectories: two
trajectories driven by the same agent on the same task still count as
independent. Attributability is a verb allowlist, not a measurement of task
achievement — a `cargo build` that succeeds while producing the wrong artefact
still counts as a clean success, which is the honest limit of an
execution-status signal. The corrected bounds have not been applied to the live
aggregate corpus, because a sweep run writes.
