# ADR-072: Evaluator-before-schedule for dream-cycle deeps

- Status: Proposed (dream night 2026-08-29, slot 1; human review required)
- Deciders: human maintainers of DreamLab-AI/agentbox
- Relates to: [ADR-052](ADR-052-dream-machine-hp-annexe.md) (HP annexe), [ADR-065](ADR-065-dream-darwin-evaluator-liveness.md) (evaluator liveness contract)
- Evidence: ../../dream-cycle/LEDGER.md rows 2026-08-17 .. 2026-08-29

## Context

Five consecutive dream nights (2026-08-17 x2, 2026-08-18 x2, 2026-08-27)
ended INCONCLUSIVE. Post-mortem of the ledger shows two distinct failure
modes with one shared root cause: the deep under study had no runnable,
decidable evaluator at the moment the night opened.

- 2026-08-17 (hooks-pipeline): the inline double-quoted evaluator was
  mangled by the annexe ssh dispatch (bash -lc consumes one escaping
  level), so no decidable receipt could be produced.
- 2026-08-18 (sovereign-mesh): the named evaluator cannot resolve
  sibling path dependencies inside the annexe clone, so it can never
  produce a green receipt there.
- 2026-08-27 (ontology-monitor): no evaluator entrypoint named the deep
  at all; coverage was undecidable from truncated receipts.

On 2026-08-28 an operator converted the affected evaluators to
checked-in scripts (scripts/dream-*.sh) invoked quote-free. On the
first night after that fix (2026-08-29), the hooks-pipeline deep
produced its first decidable receipt: scripts/dream-hooks-syntax.sh
reported "hooks-checked: 7  failures: 0 / HOOKS-SYNTAX-OK".

## Decision

A deep is schedulable for a dream night only if, before the night
opens, it names at least one evaluator that is:

1. a checked-in script under scripts/ (no inline quoted logic in
   dream.config.json — see the ssh-quoting bug class), and
2. runnable inside the target execution environment (the HP annexe for
   annexe nights), and
3. decidable: it emits an unambiguous pass/fail token on stdout.

Deeps that cannot meet all three are not scheduled; they are recorded
as HANDOFF to the environment or repository that can run them.

## Consequences

- Dead-on-arrival nights (evaluator missing, mangled, or environment-
  infeasible) are prevented at scheduling time instead of being
  discovered mid-night.
- The evaluator list becomes the gating inventory for the deep
  rotation; adding a deep requires adding its script first.
- sovereign-mesh remains unschedulable in the annexe until its sibling
  repos are vendored or the deep is handed off to those repos' cycles.
