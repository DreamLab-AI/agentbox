---
id: ADR-2141
title: Extract the dream engine core into a standalone permissive repo
date: 2026-10-15
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 8e1ef8e3410ffacb2a49bba5324d8a60917b7522
verified_paths: [services/dream-engine/Cargo.toml, services/dream-engine/Cargo.lock, lib/dream-engine.nix, services/dream-engine/src/engine.rs, services/dream-engine/tests/night_e2e.rs]
owner: jjohare
review_trigger: the image rebuild activates the registry-pinned crates, a new release of dream-core or dream-gate is adopted, or any new module is added under services/dream-engine/src that is not estate-specific
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
- Pinning (resolved 2026-10-16, moved to 0.1.1 the same day): the crates are published on crates.io and `services/dream-engine/Cargo.toml` pins `dream-core = "=0.1.1"` and `dream-gate = "=0.1.1"` from the registry, with registry checksums in `Cargo.lock`. Both must move together, otherwise two copies of `dream-gate` link. `lib/dream-engine.nix` is unchanged: all dependencies are registry crates, so no `outputHashes` are needed.

## Consequences
- The gate and the loop can be reviewed, versioned and reused without the estate, and a change to either is a change to a pinned revision here, not an edit to an in-tree copy.
- `dream-gate` validates `dream.config.json` more strictly than the old loader, but accepts the legacy free-form `adrConvention` template (`"ADR-OM-NNN"`, with the padding taken from the longest `N` run) so existing configs keep loading; `ontomark/dream.config.json` loads unchanged. Until 0.1.1 the compiled prompt dropped the template's prefix and told the model to propose `ADR-001`; 0.1.1 renders `ADR-OM-001` (`AdrConvention::example`).
- `replay::capture` is used for every night that reaches the gate (`judge::judge`). `dream-core` now carries the self-referential flag and extra protected globs in `NightInputs::policy` (replay schema 2), so `replay verify` judges under the same protected set as the live night. Nights that end before the gate record nothing.
- The adapter workarounds for the typed apply error and `MemoryRecord` fields are gone; the upstream types carry them.
- Relay, digest and governance stay night-level drivers rather than `Notifier`s, as a deliberate boundary: they publish the night's state, and a per-notice forum post would be new behaviour. No `Notice` variant exists for them because nothing consumes one.
- Restart safety (2026-10-15): a night is identified by its directory, not the run id, which hashes a HEAD the engine's own ledger commit moves. `dream-core` now treats a `Persisted`/`Complete` night as finished whatever the run id (upstream ADR-DE-007), the adapter skips it before freezing a manifest, `Persisted` is entered before the forge request and ledger commit (at-most-once publish), and `dream-engine reset-night <repo> <date>` archives the journal to reopen a night. The published 0.1.0 releases carry this fix.
- Follow-on after the 2026-10-16 activation, done: the `dream-engine` deep slot is retired from `dream.config.json`, so the engine's own source is no longer a rotating scan target; the self-referential protections still apply if it is nominated explicitly.

## Verification
`cargo build --release --locked` and the 163 tests pass against the registry crates; every deleted test is accounted for in `docs/developer/dream-engine-extraction-ledger.md`. `implementation_status` is `complete` for the extraction and the pin only. The operator rebuilt and activated the registry-pinned image on 2026-10-16. Caveats that remain: the forge automerge calls are not yet exercised against real GitHub, and the adapter publishes through `Forge::publish_draft`, so `autoMerge` is inert there. The tracked verification paths cover the registry pins, Nix packaging, engine and whole-night tests.

## Activation evidence (2026-10-16)

Image source `9fcd1eef98b2a3eb8469df0fb6bf62ec7a34cc76` is active with a clean source receipt. The Nix sandbox passed 152 unit tests and all 11 whole-night tests after resolving the generated test-shim Bash shebangs in `lib/dream-engine.nix`. The supervised daemon is RUNNING and readiness reports no degradation. This activates the extraction; the forge automerge caveat above remains.
