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
   ceiling a further 4.6 points (79.1 to 83.7). It is also an authoring finding: a negative clause buried
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

## Addendum 2026-09-23 — the escalation cascade, measured

The cascade named under Consequences is now measured by `system-one-eval cascade`, an offline
replay: a judge-free ranker answers a turn locally when the margin between its top two options
reaches a cutoff, and the turn escalates to the judge's recorded answer otherwise. The cutoff is
reported two ways. First in-sample, over every breakpoint, which is optimistic. Then
leave-one-out, where each turn's cutoff is chosen on the other 85 as the fewest escalations that
keep accuracy at or above the judge's own there, which is the number a deployed cutoff would
earn. The margin signal is fixed per ranker, not searched: relative for BM25, absolute for
cosine and for reciprocal-rank fusion.

Both judges were re-run on 2026-09-23 against the 116-option tree with per-item `--json`. This
closes the gap `loom/uplift-results/routing/README.md` records for the cloud row: Jev 93.0%
(80/86, p50 419 ms, $0.00062/route), openjev 88.4% (76/86, p50 4,937 ms). The judges are not
separable (8 v 4 discordant, exact McNemar p=0.388).

| Front ranker → judge | Held-out top-1 | Escalated | vs judge alone |
|---|---|---|---|
| BM25 → Jev (cloud) | 93.0% | 81.4% | −0 +0, p=1.000 |
| BM25 → Jev, 5 pt tolerance | 84.9% | 40.7% | −7 +0, **p=0.016** |
| BM25 → openjev (local) | 86.0% | 50.0% | −4 +2, p=0.688 |
| bge-small → openjev | 87.2% | 69.8% | −1 +0, p=1.000 |
| RRF(BM25+bge) → openjev | 87.2% | 80.2% | −3 +2, p=1.000 |

Three findings follow.

1. **In front of the cloud judge the cascade is not worth building.** At parity it saves about
   one call in five. Halving egress costs a significant 8 points, because BM25's high-margin
   errors are spread across the corpus rather than concentrated where a cutoff can catch them.
2. **In front of the local judge it halves latency at no detectable cost.** Half the turns are
   answered in microseconds, which takes mean latency from 4.8 s to 2.4 s. The two judges'
   errors are partly complementary: at 59% escalation the in-sample frontier (89.5%) sits above
   openjev alone. This is the fully local route with zero prompt egress. It is 7 points below
   Jev on this corpus, a difference 86 items cannot resolve.
3. **The sovereign path cannot run as the per-turn hook today.** `[skills.routing].timeout_ms`
   is 4000 and openjev's p50 is 4,937 ms, so with `[features.sovereign_system_one]` enabled on
   openjev nearly every hook call would time out and fail open to no injection. A local cascade
   in the hook would route half the turns within budget. The other half still needs the budget
   raised, and the hook is registered at 8000 ms.

Per-item evidence: `loom/uplift-results/routing/runs/{jev-cloud,openjev}-2026-09-23.json` and
`cascade-2026-09-23.json`.

**Implemented, gated off.** `[skills.routing].cascade = false`, `cascade_cutoff = 0.3718` (the
openjev parity point). The hook library carries a port of the rig's BM25 ranker, held to it
turn by turn by `tests/system-one/cascade-parity.test.mjs`. W074 flags the openjev latency
budget. Turning it on is a boot-class flip. With `[features.sovereign_system_one]` on the
openjev engine, it is the zero-egress routing path measured above.

## Addendum 2026-09-23 — a fourth engine: `@ruvector/typesafe` 0.1.0

Proposed as a local, fee-free Jev replacement. Measured zero-shot on the same corpus and tree,
served by its own `typesafe serve` on loopback.

- **Not a drop-in for this estate's callers.** Both consumers send `state` as an object
  (`{"user_request": …}`), which Jev accepts. typesafe 0.1.0 accepts only a string and answers
  HTTP 400 to all 86 cases. The run below goes through a loopback shim that flattens the state
  (`loom/uplift-results/routing/runs/ruvector-typesafe-state-shim-2026-09-23.mjs`).
- **The default embedder is a test double.** `hash` (bag-of-words, the default for `decide`
  and `serve`) scored 26.7%. Real accuracy needs `--embedder onnx` with fetched weights, which
  `serve --help` does not list.
- **With bge-small ONNX: 62.8% (54/86)**, soft 73.3%, p50 60 ms. That is the embedding copy
  ceiling this record already measured (61.6% bare), and below BM25 alone (66.3%). Against Jev,
  30 v 4 discordant, exact McNemar p=6.2e-06. Against openjev, 29 v 7, p=0.00031.
- **Abstention did not fire on this corpus**: `none` recall 6.2% (1 of 16).
- **Its embedder is the one the estate already serves.** bge-small-en-v1.5 is what the RuVector
  sidecar embeds with (Xinference). Zero-shot, the package adds a decision head, not a new
  signal.

The package's own ADR-003 and README agree: zero-shot cosine sits well below Jev, and parity
needs a linear probe with at least 4 labelled examples per option. It reached 83% against
Jev's 85% on an 8-option fixture with about 17 examples per option. For 116 skills that is
464 to 1,856 labelled prompts, and this estate has none. The 86 corpus turns are the test set,
and the router log deliberately stores no prompts (ADR-2090), so none can be harvested.
**Decision: not adopted for routing.** The zero-egress path remains the gated BM25 → openjev
cascade. Revisit if a labelled routing set of that size is built.

## See also

The research write-up of this measurement, the operational harness notes, the corpus, per-run reports and analysis scripts all live in the loom repository: `loom/docs/research/companion-routing/` (write-up, `HARNESS-NOTES.md`, drafts), `loom/uplift-results/routing/` (evidence), `loom/tools/routing-eval/` (rig snapshot). Split from the loom paper on 2026-09-21 after external review; nothing paper-facing is kept in this repository.
