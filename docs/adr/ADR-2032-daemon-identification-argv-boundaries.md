---
id: ADR-2032
title: Daemon reapers identify processes by argv boundaries against a launcher allowlist and fail closed on anything else
date: 2026-09-04
decision_status: accepted
implementation_status: complete
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
