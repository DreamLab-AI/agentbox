# ADR-066: MetaHarness governance boundaries — proposer-only darwin, human-gated promotion

- **Status:** Proposed
- **Date:** 2026-08-27
- **Relates to:** [ADR-062](ADR-062-metaharness-adoption-posture.md),
  [ADR-061](ADR-061-dream-persist-accept-as-draft-pr.md) (draft-PR promotion path),
  upstream metaharness#ADR-322/322A/322B

## Context

Darwin mode self-mutates harness policy surfaces. Upstream governance
(metaharness#ADR-322A/B) frames evolved variants as **candidate-generators**:
proposers hold no promotion authority and no access to sealed holdouts; promotion,
budgets, and rollback stay with the immutable governing layer. Upstream's own
Phases 3–4 (tool/model-policy evolution, unattended `/loop` promotion) ship
disabled behind privilege/spend/corpus-isolation/rollout gates.

Agentbox already has the matching chokepoints: the no-autonomous-merge rule, and the
dream-engine's human-gated draft-PR promotion path (ADR-061, `persist.rs`).

## Decision

1. **Darwin is proposer-only.** No darwin entrypoint — in the dream loop or via
   plugin skills — may promote, merge, or mutate anything outside its variant
   directory. Promotion flows exclusively through the existing accept/reject
   verdict path and the ADR-061 draft-PR chokepoint.
2. **No sealed-holdout access.** Evaluation corpora used for accept/reject gating
   are never readable by variant-generating processes.
3. **`from-repo <git-url>` is never agent-callable.** Turning an untrusted clone
   into an executing harness stays human-in-the-loop permanently; it must not be
   registered as an MCP tool or skill surface.
4. **Upstream Phases 3–4 stay off** until a superseding agentbox ADR owns the
   specific gates (privilege, spend, corpus isolation, staged rollout).
5. **Continuous background evolution is rejected.** Darwin runs are human-initiated
   or dream-window-scheduled one-shots; never an always-on self-modification loop
   (mirrors ruflo's own refusal to auto-evolve itself in CI).

## Consequences

- The gist-era ambition ("harness evolves itself") is retained but bounded: evolution
  proposes, the estate's existing verdict + PR machinery disposes.
- Any future loosening is a supersession of this ADR, not a config drift.
