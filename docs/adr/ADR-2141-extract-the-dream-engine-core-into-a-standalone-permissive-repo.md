---
id: ADR-2141
title: Extract the dream engine core into a standalone permissive repo
date: 2026-10-15
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: 5b2abd13ea0f34e2cd9941448337a9191aaedcc0   # the base the extraction was cut from; verified_paths is empty, so nothing is staleness-checked until the pin flips
verified_paths: []
owner: jjohare
review_trigger: the extracted repository is pushed and the two path dependencies in services/dream-engine/Cargo.toml flip to a git rev, or any new module is added under services/dream-engine/src that is not estate-specific
repo: agentbox
---

# ADR-2141 — Extract the dream engine core into a standalone permissive repo

## Context
- `services/dream-engine` (AGPL-3.0-only) held three kinds of code in one crate: the gate that decides whether a model-written patch may be ACCEPTed, the loop mechanism around it (worktrees, ledger, source reading, prompts), and the estate wiring (Z.AI/Loom, the annexe, RuVector, the forum).
- The first two are reusable and carry no estate secret; only the third links `nostr-bbs-core` and `zone_crypto`.
- The extracted workspace (`pairwise-gate`, `failure-fingerprint`, `dream-gate`, `dream-core`) is permissive and lives in its own repository, built clean-room from this code with the estate scrubbed out.
- The engine's own dry-streak rule contradicted its comment (REJECT reset the streak), and it had no protected-path guard before a patch was applied.

## Decision
- The engine consumes `dream-core` and `dream-gate` (and through them `pairwise-gate` and `failure-fingerprint`) instead of its own copies. The modules that moved are deleted from `services/dream-engine`; nothing is duplicated.
- The adapter stays here and stays AGPL-3.0-only because it links `nostr-bbs-core` and because `zone_crypto` is never published. It supplies every estate default as an explicit parameter: the annexe host and directory, the Loom URL, the roster path, the `DREAM_SOURCE_*` and `DREAM_SELF_GC*` environment reads, and the source denylist entry for the session-mirror key file (`estate.rs`).
- The seams are implemented here: `Llm` (Z.AI, Loom), `EvaluatorRunner` (SSH to the annexe), `MemorySink` (RuVector by direct SQL, a documented exception that pins `bge-small-en-v1.5` and asserts 384 dimensions on every write), `Notifier` (inbox, journal). The agentbox prompt template stays here and is passed to `dream_core::compile`.
- Call order: every candidate is built through `dream_core::candidate::run`, so `guard::check` runs before any git command, build or evaluator; the gate context is always built from the night's single policy (`policy::for_night`), with the self-referential protections set when the target is the engine's own source.
- Behaviour changes, by design: a protected-path patch is a REJECT; config drift under the night is BLOCKED-ENV; the dry streak advances on REJECT and INCONCLUSIVE and resets only on ACCEPT (the old engine reset on REJECT); a harness failing identically on consecutive nights raises a `HarnessStuck` notice. Everything else is pinned by tests (`docs/developer/dream-engine-extraction-ledger.md`).
- Pinning: until the repository is pushed the two dependencies are path dependencies. The flip is one line per crate to a git dependency on one shared `rev`; a path/git mix links two copies of `dream-gate`. `lib/dream-engine.nix` is not touched until then, because it cannot build with path dependencies outside this repository.

## Consequences
- The gate and the loop can be reviewed, versioned and reused without the estate, and a change to either is a change to a pinned revision here, not an edit to an in-tree copy.
- `dream-gate` validates `dream.config.json` more strictly than the old loader. `ontomark/dream.config.json` (`"adrConvention": "ADR-OM-NNN"`) no longer loads and must be corrected.
- `replay::capture` is not used: its inputs cannot carry the self-referential flag, so judging with it would weaken the policy on the nights that matter most. Reported upstream as a gap in `NightInputs`.
- Relay, digest and governance stay night-level drivers rather than `Notifier`s: they publish the night's state, and a per-notice forum post would be new behaviour.
- Follow-on: flip the pins and refresh the lockfile, add the pin to `lib/dream-engine.nix`, then retire the `dream-engine` deep slot in `dream.config.json`.

## Verification
`cargo test`, `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check` in `services/dream-engine` pass against the path dependencies; every deleted test is accounted for in `docs/developer/dream-engine-extraction-ledger.md`. `implementation_status` stays `partial` until the pin flips to a pushed rev and the Nix derivation builds against it; `verified_commit` is the base the work was cut from and `verified_paths` is empty, so the record asserts nothing checkable until then.
