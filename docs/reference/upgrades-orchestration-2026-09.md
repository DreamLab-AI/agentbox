---
title: Utopia and Needle upgrade assessment
status: implemented
updated: 2026-09-04
---

# Utopia and Needle upgrade assessment

Adopt conservative process identification in the existing Rust daemon monitor. Neither repository warrants replacing Agentbox's orchestration or memory infrastructure. This assessment is based on source inspection; no upstream runtime or benchmark was executed.

| Repository | Inspected commit | Decision |
|---|---|---|
| [Utopia](https://github.com/deeplethe/utopia/tree/57680e9996784ff397331f9825676189d7d819d1) | `57680e9996784ff397331f9825676189d7d819d1` | Defer temporal knowledge integration; reject a second memory stack in this upgrade |
| [Needle](https://github.com/jedarden/NEEDLE/tree/a5e9ba6562146e50f1d455ed5d55960aa2eff72b) | `a5e9ba6562146e50f1d455ed5d55960aa2eff72b` | Adopt conservative monitoring principle; defer worker state machine integration |

## Adopted: conservative daemon identification

Needle distinguishes a dead worker from an alive worker with stale heartbeats. Its [peer monitor](https://github.com/jedarden/NEEDLE/blob/a5e9ba6562146e50f1d455ed5d55960aa2eff72b/src/peer/mod.rs) warns about the latter without releasing its work. This prompted a review of Agentbox's own process checks.

Agentbox's Rust process helper flattened argv into text, then searched for `daemon start` and a tool-name substring. A shell, search tool or agent prompt containing that text could therefore be misidentified as a daemon, including during the reaper's final confirmation. Workspace extraction also split on text resembling flags inside paths. Registry numbers were truncated from unsigned 64-bit values into process IDs.

[The process helper](../../services/agentbox-ops/src/procs.rs) now recognises known launchers and separate `daemon`, `start` arguments. It preserves workspace argument boundaries and supports `--workspace=PATH`. Node launchers require a recognised executable name or a `cli.js` under a recognised package path. Shell commands, unrelated `cli.js` files and embedded command text are refused. [The reaper](../../services/agentbox-ops/src/bin/ruflo-daemon-gc.rs) rejects zero and values outside the positive signed PID range before discovery.

Existing behaviour retains the read-only default, explicit `--kill` switch, TTL and workspace policy. This is an original implementation of the conservative identification principle; no Needle source was copied. Unknown wrappers and Node invocations with extra runtime flags are deliberately unconfirmed. Command-line confirmation is not an atomic process identity guarantee: PID reuse between confirmation and signalling remains possible. A future stronger implementation should use Linux pidfds and a captured process start identity.

This binary is already built from this crate by [lib/agentbox-ops.nix](../../lib/agentbox-ops.nix), with crate tests enabled, and included in the image by `flake.nix`. No new service, package dependency, durable store or manifest gate is needed. `token-audit` also benefits from the shared discovery correction.

## Deferred: Needle orchestration

Needle's [outcome handlers](https://github.com/jedarden/NEEDLE/blob/a5e9ba6562146e50f1d455ed5d55960aa2eff72b/src/outcome/mod.rs) explicitly classify completion, interruption and failed verification. Its [bead backend](https://github.com/jedarden/NEEDLE/blob/a5e9ba6562146e50f1d455ed5d55960aa2eff72b/src/bead_store/backend.rs) describes operations and validates timeouts. These are useful references for a future non-interactive worker adapter.

Installing the whole orchestrator would add competing worker lifecycle, claim and recovery authorities alongside Agent of Empires and the existing orchestrator adapter. Defer until there is a concrete headless queue use case with adapter contract tests across local, external and off modes. Acceptance should cover interrupted runs, verification failure despite exit zero, claim ownership, retry bounds, and recovery after a process dies. A stale heartbeat must never alone authorise releasing a live worker's claim.

## Deferred: Utopia temporal knowledge

Utopia's [temporal engine](https://github.com/deeplethe/utopia/blob/57680e9996784ff397331f9825676189d7d819d1/crates/utopia-store/src/temporal.rs) separates validity in the world from recording and invalidation time. Corrections retain supersession history; missing dates, ambiguous ordering and low confidence route to conflicts rather than silently rewriting history. Its [audit store](https://github.com/deeplethe/utopia/blob/57680e9996784ff397331f9825676189d7d819d1/crates/utopia-store/src/audit.rs) is another source for reviewing decision provenance.

This is a strong design reference for evidence reconstruction: record what happened, when the system learned it, its source, and which later assertion corrected it. A useful future prototype would model these fields at the existing governed knowledge boundary, with distinct asserted, derived and hypothetical claims. Test an event learned late, a corrected event date, and an as-of query before and after correction. Unknown time must remain unknown. Automatic inference must not turn reconstruction hypotheses into observed facts.

Adopting Utopia's [Tantivy search and rank fusion](https://github.com/deeplethe/utopia/blob/57680e9996784ff397331f9825676189d7d819d1/crates/utopia-search/src/lib.rs), database schema and vector storage wholesale would create a second retrieval authority. Agentbox already mandates RuVector's embedding pipeline, governed ontology access and adapter boundaries. Such a migration requires a separate ADR, provenance and privacy review, and the existing recall gate before and after any retrieval geometry change. No retrieval settings or memory schema were changed here.

A pre-existing scheduler test also launched the installed Claude provider while claiming to test a missing executable. It now injects a guaranteed missing executable into a private runner helper, so the test is deterministic and cannot call the provider. Production still uses `claude`.

## Validation and rebuild test

Validation on 2026-09-04: 140 library tests and one reaper test passed; formatting and whitespace checks passed. One preceding run hit the existing `the_tick_lock_is_exclusive` timing failure; a subsequent full run passed. Recheck this lock test if it recurs in the rebuild.

Run `cargo test --locked --manifest-path services/agentbox-ops/Cargo.toml` and `cargo fmt --check --manifest-path services/agentbox-ops/Cargo.toml` before rebuild. Regression coverage includes recognised launcher forms, shell/search/prompt false positives, unrelated Node scripts, workspace paths containing spaces and flag-like text, and invalid registry PID values.

After rebuilding, run `ruflo-daemon-gc --json` and `token-audit --help` in the container. Confirm ordinary daemon discovery and workspace reporting against a disposable known daemon if available. Do not use `--kill` against shared running work as a smoke test.
