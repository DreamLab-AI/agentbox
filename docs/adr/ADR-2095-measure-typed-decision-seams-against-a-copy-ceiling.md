---
id: ADR-2095
title: Measure every typed-decision seam against a copy ceiling before choosing a judge
date: 2026-09-21
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: d51df3dfbd6de02d6a4218f5b69c24b7ea029838
verified_paths: []
owner: jjohare
review_trigger: a fourth engine measured on the routing corpus, or the first typed-decision seam other than routing to adopt a judge
repo: agentbox
domain: LEARNING-memory
---

# ADR-2095 — Measure every typed-decision seam against a copy ceiling before choosing a judge

## Context
ADR-2094 put a local typed-decision façade behind the skill router, choosing an engine by
measurement. The first real measurement was wrong in the engine's favour twice over, and
correcting it changed the conclusion: a judge-free BM25 ranker over the same 115 exposed
rubrics reaches 83.7% against the 4B local engine's 88.4%, a difference of 4.7 points at
exact McNemar p=0.455. The cloud judge reaches 93.0% (+9.3, p=0.057) and is 6x faster than
the local engine. None of this was visible until the control was built correctly.

## Decision
**Every typed-decision seam reports a copy ceiling beside its accuracy, computed before a
judge is adopted.** The ceiling is the strongest judge-free procedure over the same exposed
options; the seam's gain over it, not its raw accuracy, is what justifies the judge. This
follows the loom estate's published instrument; `system-one-eval copy-ceiling` implements it.

Four rules, each from a measured failure:

1. **A threshold sweep enumerates breakpoints, never a fixed grid.** A "decline below t"
   rule is a step function whose only breakpoints are the observed scores. A 41-point even
   grid stepped over the maximising window and understated the ceiling by 2.4 points,
   silently withdrawing the floor guarantee that oracle-tuning the baseline exists to buy.
2. **Exclusion clauses are dropped before indexing.** 50 of our 115 skill rubrics say what
   the skill is *not* for. Indexed as ordinary text they are dense in the vocabulary they
   disclaim, so a turn scores highest on the rubric that exists to reject it. This cost the
   ceiling a further 5.8 points. It is also an authoring finding: a negative clause buried
   in positive prose misleads every lexical retrieval over our skill corpus, including
   `/route` and the router's own shortlist.
3. **A ranker that scores every option identically is flagged, not counted.** Where no
   option shares a content token with the state, the "pick" is candidate-map order and the
   ceiling is chance. Our long rubrics hide this; short option labels do not.
4. **A measurement rig refuses to run a remote backend without a credential.** An
   unauthenticated remote run answers 403 on every case, and a report of "0 of 86 answered"
   is indistinguishable from an outage. This cost several hours and produced a false
   conclusion about cloud availability that reached a draft paper.

**Engine selection for the router is not settled by accuracy alone**, and the estate does
not currently have grounds to prefer the local 4B engine on quality: it is not distinguishable
from the cloud judge (p=0.39) and not distinguishable from BM25 (p=0.455) on this corpus.
The grounds that do hold are egress and cost, which are decided by `[features.sovereign_system_one]`
and the data-boundary rules in ADR-2094 §7, not by this measurement.

**Calibration is re-measured on every engine swap.** Three engines showed three behaviours:
the local 4B is under-confident (AUC 0.728, no wrong answer above 0.548), Kev reports
over-confidence (>=0.9 on 8.2% of wrong answers), and the cloud judge was recorded wrong at
0.94 under ADR-2089. No gating threshold transfers between them, which is why ADR-2090's
refusal to gate on confidence stays the default.

## Consequences
- `system-one-eval` gains the three ceiling fixes and the credential guard; `copy-ceiling`
  becomes the expected companion to any `run`, not an optional mode.
- Skill rubric authoring acquires a retrieval constraint: a negative clause should be
  separable from the positive description. Applying this to `SKILL.md` frontmatter is
  follow-on work and is not decided here.
- The cascade that the measurements suggest — rank cheaply, escalate only on boundary and
  late-clause signals where the judge's advantage is concentrated — is viable but must be
  re-derived against the repaired ranking before it is built. The figures computed against
  the defective ceiling do not transfer.
- Latency is the reverse of the intuition that motivated going local: the cloud judge is
  825 ms p50 against the local engine's 4,942 ms. Local buys egress and availability-under-
  our-own-control, and costs latency.
- What is *not* concluded: that a judge is unnecessary for routing. The corpus is 86
  self-authored turns whose prompts overlap their own gold rubric at 37.1% against 2.7% for
  a random rubric, which inflates any surface baseline. The honest statement is that this
  corpus cannot separate the 4B judge from BM25, not that no difference exists.

## Verification
Established at `d51df3dfb`, the commit carrying the three rig fixes. The measurements behind this record are reproducible with
`system-one-eval run … && system-one-eval copy-ceiling --from-report …` against the
released corpus at `tests/system-one/routing-cases.json`, and the three rig fixes carry
regression tests in `crates/system-one/system-one-eval/src/copy.rs` that construct each
failure. `verified_paths` is left empty deliberately: this record asserts a practice and a
set of measurements, not a state of the code that a path diff can check.
