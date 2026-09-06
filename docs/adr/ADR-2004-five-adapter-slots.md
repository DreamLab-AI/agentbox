---
id: ADR-2004
title: Durable state rides exactly five adapter slots; orchestrator boot-probe failure is fatal, the other four degrade to off
date: 2026-08-31
decision_status: accepted
implementation_status: partial
activation_status: live
supersedes: []
superseded_by: []
verified_commit: cbe7335b9
owner: jjohare
review_trigger: A durable-state integration proposed that does not fit one of the five slots, or a sixth slot requested
repo: agentbox
domain: BASELINE-container
lineage: legacy ADR-005 (pluggable adapters), PRD-001 (capabilities and adapters), ADR-031 (adapter contract enforcement)
---

# ADR-2004 — Durable state rides exactly five adapter slots; orchestrator boot-probe failure is fatal, the rest degrade to off

## Context
Durable-state integrations must not proliferate into bespoke per-feature persistence. Each must be
swappable between a local implementation, an external/stdio-bridge, and a disabled state behind one
identical contract, so a feature is never client-only or standalone-only. Boot-time behaviour matters
differently per slot: the orchestrator is load-bearing for session lifecycle, whereas beads/pods/
memory/events can be absent without bricking the box — but they must degrade *loudly and safely*, not
silently return broken state. Prior state (ADR-005/PRD-001/ADR-031) set the pluggable-adapter shape
without pinning the slot count or the failure asymmetry.

## Decision
Every durable-state integration resolves to exactly one of five slots — `beads`, `pods`, `memory`,
`events`, `orchestrator` — each a `local-*`, external-bridge, or `off` implementation behind an
identical per-slot contract. At the once-per-boot connect probe, an `orchestrator` failure is fatal
(`process.exit(1)`); any other slot's failure is non-fatal — its health goes `degraded` and the slot
hot-swaps its live impl to the `off` impl, so callers get an explicit `AdapterDisabled` rather than a
half-broken adapter. This forecloses a sixth slot, a client-only integration, and any slot that fails
open by silently returning stale or partial state.

## Consequences
- One uniform substitution model; `tests/contract/` must pass for all three impl classes per slot.
- Successfully replaced off slots reject cleanly. Connect timeout and failed replacement require explicit readiness handling before broader correctness can be claimed.
- Cost: a genuinely new kind of durable state has nowhere to go without an ADR that widens the model;
  the orchestrator is a hard single point of boot failure by design.

## Verification
Historical verification recorded complete at cbe7335b9. The 2026-09-04 review below narrows that guarantee and changes implementation status to partial.
`management-api/adapters/index.js:17` declares `const SLOTS = ['beads','pods','memory','events','orchestrator']`;
`resolveAdapters` (from :153) defaults any unresolved slot to `'off'` (:158). In
`management-api/server.js`, the boot probe fans out per slot: the `orchestrator` branch calls
`process.exit(1)` (:1218-1220), while every other slot sets `adapterHealth[slot]='degraded'` (:1223)
and swaps in the off impl (:1224-1234).

## Closeout extension — 2026-09-04

CP-03/04/08. Owner remains jjohare with adapter/runtime maintainers. Explicit orchestrator connect rejection is fatal, but the aggregate ten-second timeout continues startup with partially connected adapters. Failed off-adapter construction leaves the degraded original in place. The accepted lifecycle requirement is not fully enforced across these cases.

**Acceptance condition:** Exercise never-settling connect, late failure and failed replacement. Expose per-slot readiness, define load-bearing timeout policy and demonstrate recovery without dispatch into an ambiguous adapter. Dependencies include effective configuration and failure receipts. Reopen on slot methods, lifecycle, privacy or encoding changes. See the [dispatch review](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/adapter-dispatch.md) and [source/probe receipt](https://github.com/DreamLab-AI/VisionFlow/blob/main/docs/estate-review/evidence/dispatch-privacy-probe.json). No real sidecar, adapter persistence or startup fault injection ran.

## Acceptance progress — 2026-09-05

**Implemented.** The inline connect phase in `management-api/server.js` is
replaced by `management-api/adapters/lifecycle.js`, which makes the accepted
lifecycle requirement enforceable rather than aspirational.

- *Per-slot readiness.* Every slot ends in exactly one state — `off`, `ready`,
  `disabled` or `unavailable` — carrying the reason, the failure mode
  (`rejected` | `timeout` | `replacement-failed`), the deadline applied, the
  duration, and any late settle. It is published on the app as
  `adapterReadiness`; `toLegacyHealth()` preserves the existing
  healthy/degraded/off vocabulary in the `/health` payload. Previously a slot
  caught by the aggregate timeout had no health value set at all.
- *Load-bearing timeout policy.* One deadline **per slot**, from
  `[adapters] connect_timeout_ms` (a number, or a per-slot table with a
  `default` key; a non-positive or non-finite value falls back to 10 000 rather
  than failing every slot). Exceeding it is a connect **failure** for that slot,
  identical in consequence to an explicit rejection — never a reason to continue
  with the slot in an unknown state.
- *No dispatch into an ambiguous adapter.* A slot that fails to connect has its
  instance **quarantined before any replacement is attempted**: own properties
  and the whole prototype chain are replaced by an async thrower
  (`AdapterQuarantined`), with underscore-private helpers and `disconnect()`
  exempt so shutdown can still release resources. This is what makes a
  never-settling connect safe — a connect that settles late finds an object
  nobody can dispatch into, and the late settle is recorded on the readiness
  record without re-arming the slot. The abandoned promise is handled at source,
  so a late rejection is never an unhandled rejection.
- *Failed replacement is loud and fail-closed.* If the `off` replacement cannot
  be constructed, the slot is left quarantined and marked `unavailable` with an
  error-level log. The degraded original is never left wired; the previous
  `catch (_) { /* leave degraded adapter in place */ }` is gone.
- *Fail-closed slots.* `orchestrator` aborts startup on rejection **and** on
  timeout — an orchestrator that never connects is operationally identical to
  one that refused — and is never silently replaced with `off`.

**Tests and results.** `tests/contract/adapter-lifecycle.contract.spec.js`
(new) — **18 passed, 0 failed**, run as CI does
(`cd management-api && npx jest ../tests/contract/… --ci --forceExit`). Covers
never-settling connect, late resolution and late rejection, explicit rejection,
slow-but-in-time connect, concurrent per-slot deadlines, failed and empty
replacement, both fail-closed paths, timeout resolution from the manifest, and
quarantine mechanics over an inherited prototype chain. The three specs run
together (`adapter-lifecycle`, `privacy-coverage`, `privacy-filter`) report
**53 passed, 0 failed**.

**Receipts.** `docs/estate-closeout/2026-09-05/adr-2004-adapter-lifecycle.json`.

**Remaining.** Fake adapters only: no real sidecar, no adapter persistence, no
fault injection against a booted management-api, and no deployed readiness
observation. Recovery *after* a failed slot — reconnect, or operator-driven
re-arm — is deliberately not implemented; quarantine is terminal for the process
lifetime. Effective-configuration and failure-receipt dependencies are unchanged.

**Governed paths changed.** `management-api/adapters/lifecycle.js` (new),
`management-api/server.js` (connect phase only),
`tests/contract/adapter-lifecycle.contract.spec.js` (new).
