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

## Closeout extension — 2026-09-04

Work packages: **CP-03/04/07/08**. Owner remains `jjohare`; memory and release maintainers own the cross-service acceptance boundary.

The harness defines its frozen median-of-three band. This pass did not run it against the current corpus. Scoped factory searches rank a materialised subset while reporting the same hnsw-xinference method as unfiltered search.

**Acceptance condition:** Bind each acceptance run to model, preprocessing, corpus/index revision, fixture and effective filters; include large/small namespaces, long values, degraded mode and repaired embeddings. Demonstrate the release gate consumes the receipt.

Dependencies: CP-01 release/model identity and the caller-authority contract. Reopen on model, write/fallback, TTL or retrieval changes. Historical verification fields are retained; this annex records source/mock evidence at `89301ec7c911eab270c00a0cf81596d0d4f15535`, not a new production or recall certification.

See the [shared-memory review](../../../../VisionFlow/docs/estate-review/shared-memory.md), [source/test receipt](../../../../VisionFlow/docs/estate-review/evidence/memory-snapshot.json) and [isolated probe](../../../../VisionFlow/docs/estate-review/evidence/memory-store-probes.json).

## Acceptance progress — 2026-09-05

**Implemented — the run is bound to what it measured.** A verdict is only
evidence if you can say what it was a verdict *about*. Every run now records:
the **effective model identity** (the ADR-2019 fingerprint, not just the
configured name), the **preprocessing** (embed prefix, probe version,
quantisation), the **corpus and index revision** (row counts, embedded count,
rows still awaiting ADR-2014 repair, newest write, and a hash over the live HNSW
index definition — a rebuilt index changes recall without changing a row), the
**fixture** hash and integrity result, the **effective filters** per class with
the actual execution plan each used, and **every observed `RUVECTOR_*` gate**.

**Implemented — the release gate consumes the receipt.** The harness emits a
compact, self-describing receipt at a stable path, hashed so a hand-edited one is
detectable. `scripts/recall-gate.mjs` is the consumer, and it refuses unless all
of: the receipt exists and its hash still covers it; the verdict is PASS; the run
used at least the band's `median_of` runs (a single lucky run is exactly what the
median-of-3 protocol exists to prevent); it is not stale; it was not measured in
a degraded state; the model identity was not rejected and — unless
`--skip-live-probe` — the **currently deployed** fingerprint still matches the
one measured; the checked-in fixture is the one measured; and the
retrieval-geometry gates in force match those observed during the run. Corpus
drift is reported rather than refused, because rows are added continuously and a
gate that refused on that would be bypassed rather than obeyed.

**Tests and results — and a real finding.** A protocol-conformant **median-of-3
run against the live corpus FAILS the frozen band**: self-recall median
**164/200** (band ≥175) and true-recall median **96/120** (band ≥102);
exact-token hybrid delta +4.5 passes. The gate consumed that receipt and refused
with exit 3, naming both reasons. The run also surfaced **1 row awaiting
embedding repair** in the production corpus, invisible to every recall class.
This is not a plumbing artefact — it is the current state of the deployed
retrieval geometry, previously unmeasured because the harness's existence was
being read as evidence about a corpus nobody had run it against.

**Receipts.** `docs/estate-closeout/2026-09-05/adr-2018-recall-receipt.json`
(the bound receipt), `adr-2018-recall-run.json` (the full artefact including
per-namespace breakdown), `adr-2018-recall-gate-verdict.json` (the gate's
machine-readable refusal).

**Governed paths changed.** `scripts/ruvector-recall-harness.mjs`,
`scripts/recall-gate.mjs` (new).

**Remaining.** The FAIL is unexplained: it needs a cause (index degradation under
bulk churn is the documented suspect) before the band can be treated as either
met or wrong. The gate is runnable but not yet wired into a CI workflow. Degraded
mode and repaired embeddings are recorded in the binding but not yet exercised as
deliberate fixture cases. `implementation_status` should not be read as "the
corpus passes": the harness and its gate are complete; the corpus is failing.
