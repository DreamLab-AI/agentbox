# ADR-065: Dream-engine darwin evaluator liveness contract

- **Status:** Accepted — implemented and verified live (2026-08-27 rebuild)
- **Date:** 2026-08-27
- **Relates to:** [ADR-052](ADR-052-dream-machine-hp-annexe.md),
  [ADR-060](ADR-060-dream-annexe-path-dependencies.md),
  [ADR-062](ADR-062-metaharness-adoption-posture.md), upstream metaharness#ADR-071/099/101/102/106

## Context

The dream-engine is agentbox's primary live MetaHarness consumer: target repos
declare `@metaharness/darwin` evaluator entrypoints in `dream.config.json`
(`config.rs::DreamConfig.evaluator_entrypoints`), executed on the HP annexe, with
output fed as evidence receipts into the nightly LLM verdict.

Darwin's default `--sandbox real` mode is **surface-independent**: it emits the same
output regardless of the code under test (`nicheEntropy 0`, flat `[0.985]` fitness),
so a night runs green while learning nothing (upstream metaharness#ADR-099/101/102
lesson). Only `--sandbox mock` (entropy 0.6899 measured) and `--sandbox agent`
(executes the evolved planner/contextBuilder/retryPolicy in a child process) exercise
the mutation surfaces. Today this rule is a **comment** in `agentbox.toml` (~L1514),
not an enforced invariant.

## Decision

1. **Enforce the sandbox gate in code.** Dream-engine config validation (`config.rs`,
   or evaluator dispatch in `engine.rs`) rejects any `@metaharness/darwin` entrypoint
   whose args lack `--sandbox mock` or `--sandbox agent`. The night fails with a
   `BLOCKED-ENV`-style verdict — loud, not a silent green.
2. **Liveness receipt.** Darwin evaluators must emit an entropy/manifold signal;
   entropy-0 output is scored `INCONCLUSIVE` (feeding the existing
   `prune_dry_streak` standby logic), never `ACCEPT`.
3. **Contract surfaced to repo authors.** Target-repo `evaluatorEntrypoints` must
   honour darwin's invariants: seven mutation surfaces, one mutation per variant,
   `inspectVariant` hard-gate, and exit code 99 = safety-disqualified (propagated
   verbatim, never remapped).
4. **Version independence.** The annexe supplies its own darwin; container-baked
   versions (ADR-064) are not assumed identical.

## Consequences

- The 63%-INCONCLUSIVE failure mode class from the one-week audit (ADR-060 context)
  gains a second structural guard: nights can no longer look green on degenerate
  evaluators.
- A small validation addition to `services/dream-engine/src/config.rs` +
  `engine.rs`; unit tests assert rejection of `--sandbox real` and of missing
  sandbox args.
