---
id: ADR-2024
title: Dream cycles are evidence-gated and human-merge-gated, and darwin evaluators must emit surface-dependent output
date: 2026-08-31
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: cbe7335b9
owner: jjohare
review_trigger: any change to the recall band, the nightly window, or the darwin sandbox contract
repo: agentbox
domain: GOVERNANCE-capabilities
lineage: legacy ADR-052 (dream machine HP annexe), ADR-065 (darwin evaluator liveness contract), ADR-070 (self-GC dream evidence governance); recall band reuses the LEARNING harness gate (ADR-2018)
---

# ADR-2024 — Dream cycles are evidence-gated and human-merge-gated, and darwin evaluators must emit surface-dependent output

## Context

The nightly dream-engine evolves nominated repos overnight on the HP annexe,
and agentbox contains the very crate that dreams it (`services/dream-engine`) —
a self-modifying surface. Two failure modes to foreclose: a self-referential
change slipping in unwitnessed, and a darwin evaluator running the default
`--sandbox real` mode, which is surface-independent and therefore silently
no-ops (ADR-065). Prior art: ADR-052 (HP annexe), ADR-070 (dream evidence
governance).

## Decision

The dream-engine may self-modify only under **extra review scrutiny** and
**never bypasses the human-merge gate** — cycles stay evidence-gated and
witnessed. Every `@metaharness/darwin` entrypoint MUST run `--sandbox mock` (or
`--sandbox agent`), never the no-op `real` default, so it provably produces
surface-dependent output. Cycles are recall-band gated
(`recall_band_self_min = 175`, `recall_band_true_min = 102`, reused from the
LEARNING harness) and run only inside the nightly 1–5 UTC window, dispatched to
HP. The engine is shipped and live; the merge-gate and darwin-liveness rules are
enforced as config/toml discipline, not central policy code — hence
implementation partial.

## Consequences

- No overnight change reaches `main` without a human merge, and a mis-wired
  evaluator fails loudly rather than green-lighting a night of no-ops.
- The recall band means a cycle that would regress retrieval is rejected before
  it lands (REJECT still counts as learning).
- Cost/caveat: the discipline lives in `dream.config.json` + `[dream_machine]`,
  so a repo that omits the `--sandbox` flag or mis-declares its evaluators can
  still no-op until caught by review; there is no single enforcing policy engine.
  Governing detail in `docs/GOVERNANCE-capabilities.md`.

## Verification

At `cbe7335b9`, `dream.config.json` `extraDisciplines` (:57-58) states the
self-referential rule and "never let a self-modifying hypothesis bypass the
human-merge gate". `agentbox.toml` `[dream_machine]` (:1560-1595): mandatory
`--sandbox mock` evaluator-liveness note, `recall_band_self_min = 175`,
`recall_band_true_min = 102`, nightly window `window_start = 1`/`window_end = 5`
UTC, dispatched to `john@10.10.10.1`.
