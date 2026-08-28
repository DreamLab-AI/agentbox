# ADR-067: MetaHarness pin discipline and cross-repo ADR namespacing

- **Status:** Proposed
- **Date:** 2026-08-27
- **Relates to:** [ADR-062](ADR-062-metaharness-adoption-posture.md),
  [ADR-063](ADR-063-enable-ruflo-metaharness-plugin.md), [ADR-064](ADR-064-bake-metaharness-runtime-binaries.md)

## Context

MetaHarness packages are 0.x with a fast early cadence (metaharness 0.1.0→0.1.11 in
~23h; router 0.1.0→0.3.2 in 2.7h). An `@latest` fetch executes arbitrary upstream code
on the next skill invocation — unacceptable in a sovereign container. Upstream ruflo
already hardened this: tilde/caret pins enforced by `check-metaharness-pins.mjs`, and
plugin scripts moved from `npx` to offline-first `node <abs-path>` invocation.

Separately, cross-repo ADR numbering collides: ruflo#ADR-155 (nightly self-learning
security harness) vs metaharness#ADR-155 (Darwin Shield); bare "ADR-155" references
in skill docs are ambiguous, and attribution errors were observed in source material
during the 2026-08-27 research mesh.

## Decision

1. **Pins:** every MetaHarness package reference (Nix closure, plugin config, skill
   invocation) uses a tilde/caret range; `@latest` and unpinned `npx -y` are
   prohibited. Port `check-metaharness-pins.mjs` as a pre-rebuild gate alongside
   `skills/lint-skills.sh`.
2. **Invocation:** offline-first `node <abs-path>` against baked/symlinked packages;
   network fetch at call time is a failure, not a fallback.
3. **Install route:** `source = "ruflo-git"` only; the `registry` (IPFS/IPNS) route
   stays disabled.
4. **Namespacing:** all cross-repo ADR references in agentbox docs are written
   `<repo>#ADR-NNN` (`ruflo#ADR-150`, `metaharness#ADR-322`). Agentbox's own sequence
   remains bare (`ADR-062`).

## Consequences

- Supply-chain exposure is bounded to explicitly reviewed version bumps at rebuild
  time; drift cannot arrive silently through a skill invocation.
- Cross-repo citations stay resolvable as all three ADR suites grow.
