---
id: ADR-2018
title: The recall harness is the mandatory merge gate for any retrieval-geometry change
date: 2026-08-31
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: cbe7335b9
owner: jjohare
review_trigger: The pass band (175/102/0) is changed, the fixture is re-frozen, or a new retrieval consumer is added
repo: agentbox
domain: LEARNING-memory
lineage: "legacy PRD-020 / ADR-040 D2 (I14)."
---

# ADR-2018 — The recall harness is the mandatory merge gate for any retrieval-geometry change

## Context
Any change to what a query returns — a rerank, a blend, an index rebuild, a new
consumer — can silently degrade recall. Single-run recall numbers are noisy, so a
one-shot check can pass or fail on variance. A no-regression gate needs a frozen
reference and a variance-absorbing protocol (ADR-040 D2, I14). The harness runs
read-only against the DB so it can gate merges without mutating the corpus.

## Decision
No consumer that changes what a query returns may flip its gate without a passing
run of the recall harness against the frozen, checked-in fixture. The verdict is
the **median of 3 runs** against a hard-coded pass band: median self-recall@10
≥ **175/200** AND median true-recall@10 ≥ **102/120** AND median exact-token hybrid
delta ≥ **0**. The band constants live in the harness, not in config, and the
fixture carries its own baseline+band so build-time drift is detectable. This
forecloses shipping a retrieval change on a lucky single run or an unpinned
fixture.

## Consequences
- Retrieval regressions are caught pre-merge against a stable reference.
- Three runs cost wall-clock time on every geometry change — the price of absorbing
  variance.
- The band is deliberately rigid; raising or lowering it is an explicit ADR-level
  change (review_trigger), not a config tweak.
- Re-freezing the fixture requires care: a bad baseline would rubber-stamp
  regressions.

## Verification
implementation_status = complete at verified_commit cbe7335b9. Confirmed by grep of
`scripts/ruvector-recall-harness.mjs`: header lines 30-33 state the median-of-3
band; `verdictFromMedians(medians, band)` at line 226 checks `self_recall`,
`true_recall`, and `exact_token_delta` against the band mins; the band constants
`self_recall_min: 175`, `true_recall_min: 102`, `median_of: 3` are hard-coded at
lines 414-420 and the exact-token delta gate at line 232. The harness is read-only
against the DB.
