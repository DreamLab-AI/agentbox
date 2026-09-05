---
id: ADR-2032
title: Daemon reapers identify processes by argv boundaries against a launcher allowlist and fail closed on anything else
date: 2026-09-04
decision_status: accepted
implementation_status: partial
activation_status: staged
supersedes: []
superseded_by: []
verified_commit: ec257a2567993518b25d69a34541544a2a54ef6c
verified_paths: [services/agentbox-ops/src/procs.rs, services/agentbox-ops/src/bin/ruflo-daemon-gc.rs]
owner: jjohare
review_trigger: a new daemon launcher shape (new package path, wrapper script or runtime flags), any new binary that signals processes, or adoption of pidfd-based identity
repo: agentbox
---

# ADR-2032 — Daemon reapers identify processes by argv boundaries against a launcher allowlist and fail closed on anything else

## Context
`ruflo-daemon-gc` and `token-audit` share one process helper that flattened
argv into a string and matched `"daemon start"` plus a tool-name substring. A
shell running `sh -c "ruflo daemon start"`, a search tool with that query, or an
agent prompt containing the phrase satisfied the predicate, including in the
reaper's final confirmation before `kill`. Workspace extraction split on text
resembling flags inside paths, and registry PIDs were truncated from u64 to u32.
A review of NEEDLE's peer monitor (alive-but-stale is not dead) prompted the fix.

## Decision
Process identity for any signalling tool is decided on argv elements, never on
joined text. A process is a daemon only when its program basename is `ruflo` or
`claude-flow`, or is `node`/`nodejs` running a script whose basename is one of
those names or a `cli.js` under a `ruflo`, `claude-flow` or `@claude-flow`
package path, and the following arguments begin with the separate elements
`daemon`, `start` (`services/agentbox-ops/src/procs.rs:23`). Unknown wrappers,
shells and embedded command text are refused. The workspace is read as one
argument in either `--workspace PATH` or `--workspace=PATH` form
(`procs.rs:60`). Registry PIDs outside `1..=i32::MAX` are discarded before
discovery (`ruflo-daemon-gc.rs:91`). Read-only default, explicit `--kill`, TTL
and workspace policy are unchanged. Tests that exercise a provider CLI inject a
guaranteed-missing executable rather than invoking the installed one.

## Consequences
False positives from shells, searches and prompts are gone; the price is that a
daemon launched through an unrecognised wrapper or with extra Node runtime
flags is not discovered and must be added to the allowlist deliberately.
Argv confirmation is still not an atomic identity: PID reuse between confirm
and signal remains possible, so a pidfd plus captured start time is the next
strengthening step. Wholesale adoption of NEEDLE's orchestrator and Utopia's
temporal store stays deferred (`docs/reference/upgrades-orchestration-2026-09.md`).

## Verification
Working tree of 2026-09-04: `cargo test --locked` in `services/agentbox-ops`
(141 passed, including recognised launcher forms, shell/search/prompt false
positives, unrelated `cli.js` paths, workspace paths with spaces and flag-like
text, and PID range rejection). The freshly built `ruflo-daemon-gc --json`
discovered and confirmed the six live daemons in this container, whose argv is
`node …/@claude-flow/cli/bin/cli.js daemon start --foreground --quiet`, and
signalled nothing.

## Closeout extension — 2026-09-04

CP-01/04/08. Owner remains jjohare with runtime/operations maintainers. Four existing native helper tests pass. The ruflo reaper implements the argv allowlist and registry PID bounds, but this decision's rule for any signalling tool is not estate-wide: the Hermes scheduler Stop path checks PID existence without argv/start-time identity. Implementation is partial; staged activation and the historical verification account are retained.

Registry workspace data wins over a live sweep entry; confirmation checks launcher shape without captured process identity, and SIGTERM success does not prove exit. The [source review](../../../../VisionFlow/docs/estate-review/process-lifecycle.md) distinguishes these findings from tested behaviour; the [receipt](../../../../VisionFlow/docs/estate-review/evidence/process-lifecycle-snapshot.json) records source hashes and targeted test commands. No daemon signal or runtime PID-state mutation ran.

**Acceptance condition:** Inventory every signalling caller, bind identity and authority to the intended process instance, reconcile registry/live workspace disagreement, and specify whether staleness is rechecked immediately before action. Exercise stale/reused PIDs, recognised replacement daemons, unknown wrappers, missing proc access, signal failure and delayed exit with isolated owned subprocesses. Preserve default read-only reaper behaviour. Report signal delivery separately from confirmed shutdown and retain recoverable state after failure. Reopen on launcher, signal caller, registry, TTL or process-identity changes; dependency is the CP-08 release and recovery receipt.

## Acceptance progress — 2026-09-05

**Implemented.** The rule the reaper already applied is now applied on the Hermes
Stop path, via one shared module rather than a second copy.

- *Shared identity module.* `services/agentbox-ops/src/process_identity.rs` (new)
  factors the argv-allowlist and start-time logic out of the reaper; the Hermes
  Stop path uses it.
- *Identity before signal.* The target PID must match **both** the recorded argv
  (`/proc/<pid>/cmdline`) and the recorded start time (`/proc/<pid>/stat` field
  22). Both are captured at launch into the job record
  (`hermes/jobs.rs`); a record lacking them is **unverifiable** and refuses to
  signal rather than guessing. The previous code checked PID existence only, so a
  reused PID could be signalled.
- *Staleness is re-checked immediately before the signal*, not at plan time.
- *Delivery is reported separately from shutdown.* After SIGTERM a bounded grace
  period re-checks identity, giving distinct outcomes for confirmed-exited,
  signalled-but-still-running, identity-mismatch-refused and no-such-process.
  Missing `/proc` access is an explicit refusal, never an assumed match, and
  recoverable state is preserved on failure.
- The reaper's default read-only behaviour is unchanged and asserted.

**Tests and results.** `cd services/agentbox-ops && cargo test --offline` —
**182 passed, 0 failed** (plus 1 doc-test), including the new
`process_identity`/`hermes` stop cases with isolated owned subprocesses (stale
and reused PID, recognised process, unknown wrapper argv, injected missing-/proc
reader, signal failure, delayed exit) and
`tests/reaper_default_is_read_only.rs`.

**Receipts.** `docs/estate-closeout/2026-09-05/adr-2032-process-identity.json`.

**Remaining.** A complete inventory of every signalling caller across the estate
is not finished, so the rule is enforced at the two known boundaries rather than
proven estate-wide. Registry-versus-live-workspace disagreement is unchanged, and
no deployed daemon was signalled.

**Governed paths changed.** `services/agentbox-ops/src/process_identity.rs` (new),
`services/agentbox-ops/src/process_identity_tests.rs` (new),
`services/agentbox-ops/src/hermes/mod.rs`,
`services/agentbox-ops/src/hermes/jobs.rs`,
`services/agentbox-ops/src/hermes/stop_tests.rs` (new),
`services/agentbox-ops/src/procs.rs`,
`services/agentbox-ops/src/bin/hermes-scheduler.rs`,
`services/agentbox-ops/src/lib.rs`.
