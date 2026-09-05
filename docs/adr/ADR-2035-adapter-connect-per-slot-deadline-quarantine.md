---
id: ADR-2035
title: Adapter connect uses a per-slot deadline and quarantines a failed adapter before replacing it
date: 2026-09-05
decision_status: accepted
implementation_status: complete
activation_status: live
supersedes: []
superseded_by: []
verified_commit: 89301ec7c911eab270c00a0cf81596d0d4f15535
verified_paths: []
owner: jjohare
review_trigger: A proposal to reintroduce an aggregate connect deadline, to re-arm a quarantined adapter, or to add a slot to FAIL_CLOSED_SLOTS
repo: agentbox
domain: BASELINE-container
lineage: amends ADR-2004 (five adapter slots, orchestrator fatal); closes the "Adapter acceptance qualification — 2026-09-04" estate review item
---

# ADR-2035 — Adapter connect uses a per-slot deadline and quarantines a failed adapter before replacing it

## Context
BASELINE-container §Adapter spine stage 2 describes the boot probe as `server.js:1206` connecting all
five slots under a **10 s total budget**. That has not been the implementation since the connect
phase moved into `adapters/lifecycle.js`. The estate review reproduced three holes in the old inline
version, recorded verbatim at `lifecycle.js:9-27`: **L1** one aggregate timeout let a slot whose
`connect()` never settled proceed with its original adapter in an unknown state; **L2** a failed `off`
replacement was swallowed by `catch (_) {}`, leaving the broken original wired and still receiving
dispatch; **L3** `adapterHealth` had no notion of "connecting", "timed out" or "quarantined".
The module rewrote the policy; the governing doc was never updated to match. Exposed by diagrams
**AB-04.6**, **AB-04.7**, **AB-04.8**.

## Decision
Each adapter slot connects under **its own deadline**. Exceeding it is a connect failure for that
slot, identical in consequence to an explicit rejection — never a reason to continue with the slot in
an unknown state. Aggregate wall-clock is bounded by the slowest single slot, not by a race that
abandons work still in flight. The default is `DEFAULT_CONNECT_TIMEOUT_MS = 10000`
(`lifecycle.js:70`), overridable per slot or globally via `[adapters] connect_timeout_ms`
(`lifecycle.js:106-107`); a non-positive or non-finite value is ignored in favour of the default
(`:124`).

An adapter that failed to connect **never receives dispatch again**. On failure the original instance
is quarantined before any replacement is attempted (`lifecycle.js:274`): every dispatch method is
replaced by a thrower (`AdapterQuarantined`, `:78-91`, `statusCode` 503), leaving `constructor` and
`disconnect` callable so shutdown can still release what the adapter opened (`:76`). A connect that
settles late therefore finds an object nobody can dispatch into; the late settle is *recorded* for
operator diagnosis and never re-arms the slot (`:264-270`).

Replacement failure is loud and fail-closed. If the `off` replacement cannot be constructed the slot
stays quarantined and is marked `unavailable` (`:292-299`); the degraded original is never left wired.

Every slot ends in exactly one of four states — `off`, `ready`, `disabled`, `unavailable`
(`lifecycle.js:55-66`) — each carrying its reason, failure mode (`rejected | timeout |
replacement-failed`) and whether a late settle was observed. `toLegacyHealth` (`:324`) collapses these
to the `healthy | degraded | off` vocabulary `/health` already publishes, so existing consumers keep
working while `app.adapterReadiness` (`server.js:1257`) carries the richer record.

`orchestrator` remains the sole fail-closed slot (`FAIL_CLOSED_SLOTS`, `:73`), and is now equally
fatal on timeout and on quarantine as on explicit rejection (`:50-53`, `:276-281`, `:303-309`) — an
orchestrator that never connects is operationally identical to one that refused.

## Consequences
- ADR-2004's invariant "orchestrator boot-probe failure is FATAL; other slots go degraded and swap
  their live impl to `off`" still holds, and is strengthened: the swap is now preceded by quarantine,
  and a failed swap is itself fatal to the slot rather than silently ignored.
- Callers see two distinct typed errors where there was one: `AdapterDisabled` when a slot degraded
  cleanly to `off`, and `AdapterQuarantined` (503) when the replacement could not be built. Anything
  that treated all adapter failures as `AdapterDisabled` must handle both.
- A slow sidecar now costs its own deadline rather than the whole boot, but a *very* slow slot no
  longer hides behind a shared race — boot takes as long as the slowest slot's deadline.
- The BASELINE text and the "Adapter acceptance qualification — 2026-09-04" section are corrected
  under ADR-2039 in the same change; the qualification's specific complaints (explicit failure and
  aggregate timeout having different outcomes, replacement being able to fail) are exactly what this
  policy resolves.

## Verification
Verification ran on the **uncommitted working tree** above SHA
`89301ec7c911eab270c00a0cf81596d0d4f15535`; `verified_commit` and `verified_paths` must be re-run and
restored at the landing commit.

- `sed -n '9,27p' agentbox/management-api/adapters/lifecycle.js` → the three holes L1/L2/L3 this
  module was written to close.
- `grep -n "DEFAULT_CONNECT_TIMEOUT_MS\|FAIL_CLOSED_SLOTS\|QUARANTINE_EXEMPT" .../lifecycle.js`
  → `:70` = 10000, `:73` = `Set(['orchestrator'])`, `:76` = `Set(['constructor','disconnect'])`.
- `sed -n '177,200p' .../lifecycle.js` → `connectOneSlot` races `observed` against a per-slot
  `setTimeout` that is deliberately **not** `unref()`'d (`:189-195`), returning the still-running
  promise as `latePromise` when the deadline wins (`:199`).
- `sed -n '250,300p' .../lifecycle.js` → `ready` on resolve (`:251`), `failureMode` derivation
  (`:256`), quarantine before replacement (`:274`), fail-closed branch (`:276-281`), `disabled` on
  successful replacement (`:289-291`), `replacement-failed` → `unavailable` (`:292-299`).
- `grep -n "connectAdapters\|toLegacyHealth\|adapterReadiness" agentbox/management-api/server.js`
  → wired at `:1241-1242`, `:1256`, `:1257`.
- `npx jest ../tests/contract/adapter-lifecycle.contract.spec.js
  ../tests/contract/memory-encoder-bypass.contract.spec.js --ci --forceExit` **run from
  `management-api/`** (the runner CI uses — `contract-tests.yml:52-54`; `node --test` fails
  because most suites expect injected globals, and the root `package.json` restricts jest's
  `roots` to `tests/config`) → **2 suites passed, 21 tests passed**.
