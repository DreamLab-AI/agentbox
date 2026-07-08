# P1-REC-5 — MAST 14-mode failure taxonomy replacing free-text errors

**Item:** REC-5 (PRD-019, ADR-037 D1, DDD-017 §MastFailureMode / §8 `FailureTaxonomy`)
**Wave:** P1
**Target tier:** `integrated`
**Canary:** `CANARY-AB-MAST`
**Captured against SHA:** `d13f8688f5dc5cb39c4081f416ef4457e7738af5` (branch `gap-close/2026-07`; receipts run on the working tree atop this base, pinned by the closure commit)
**Timestamp (UTC):** 2026-07-08T12:44:16Z

## Falsification statement (from PRD-019)

> REC-5 is falsified if any failure path through the trajectory hook or the agent-events
> envelope still emits a free-text error without a MAST tag, or if an unclassifiable failure
> is dropped rather than tagged `unmapped`.

## What changed

| File | Change |
|---|---|
| `management-api/lib/failure-taxonomy.js` | **New.** The single canonical definition of the 14 MAST modes (Cemri et al. 2025) — ids `FM-1.1`…`FM-3.3` across 3 categories — plus the `unmapped` sentinel, a `classify(context)` that maps only on genuine signal (explicit mode / symbolic reason / 2 high-precision stderr heuristics) and returns `unmapped` otherwise, and `tagFailure()` which always yields `{failure_mode, failure_detail}` (the human text kept as detail). Pure, dependency-free — a field on envelopes that already flow, never a standalone service (ADR-037 D1). |
| `config/hooks/trajectory-recorder.cjs` | Loads the taxonomy via the same candidate-path resolver it already uses for `uris.js`; a graded **failure** step now writes `result.failure_mode` (a mode or `unmapped`); a graded **success** writes no mode. A redacted, capped stderr hint feeds the classifier in-memory only — never persisted (I10). Fail-open: if the shared lib cannot load, the step is still tagged with the inline `unmapped` sentinel. |
| `management-api/utils/agent-event-publisher.js` | `emitAgentAction` stamps `failure_mode` on any event whose outcome is a failure (a caller-supplied valid tag is kept; else classified from the `failure` context / `unmapped`); `createMcpNotification` forwards `failure_mode` on the wire (null on success — byte-compatible for existing success-only callers). |
| `management-api/routes/agent-events.js` | The two `{success:false}` error-return sites (auth-signature reject; `reconcileSourceUrn` identity mismatch) now classify through the taxonomy: the mismatch → `FM-1.2` (Disobey Role Specification), the transport-auth reject → `unmapped`, both with the human text preserved as `failure_detail`. |
| `tests/sovereign/failure-taxonomy.test.js` | **New.** 13 cases locking the 14-mode registry, the reason/heuristic/unmapped classification honesty, and the "always a tag, never dropped" rule. |

## Receipts

### 1. Syntax checks (`node -c`) — 2026-07-08T12:41Z

```
$ node -c management-api/lib/failure-taxonomy.js && ... (all changed files)
OK: management-api/lib/failure-taxonomy.js
OK: config/hooks/trajectory-recorder.cjs
OK: management-api/utils/agent-event-publisher.js
OK: management-api/routes/agent-events.js
OK: tests/sovereign/failure-taxonomy.test.js
```

### 2. Unit test — the taxonomy mapper (jest, management-api runner)

```
$ cd management-api && npx jest tests/sovereign/failure-taxonomy.test.js
PASS ../tests/sovereign/failure-taxonomy.test.js
Test Suites: 1 passed  (13 tests within the REC-5 file; 25 with authority)
```

Cases proving the falsification bar:
- exactly 14 modes across 3 categories; id set matches the paper's three-category structure.
- `IDENTITY_MISMATCH → FM-1.2`, `permission denied → FM-1.2`, `max context length → FM-1.4` (real mappings).
- a generic non-zero-exit failure with no resolving signal → `unmapped` (NOT fabricated); an unknown reason → `unmapped`; an invalid mode id does not pass through.
- `tagFailure` always returns a valid tag and keeps the detail — a failure is never dropped.

### 3. End-to-end envelope wiring (real emit, not asserted)

```
SUCCESS failure_mode on envelope : undefined       # success carries no mode
SUCCESS failure_mode on wire     : null            # byte-compatible
FAILURE failure_mode on envelope : FM-1.2          # {outcome:'failure', failure:{reason:'IDENTITY_MISMATCH'}}
FAILURE failure_mode on wire     : FM-1.2          # forwarded through createMcpNotification
UNRESOLVABLE failure_mode        : unmapped        # {outcome:'failure', failure:{error:'opaque tool crash'}}
```

Route error-return parity:
```
auth-signature reject → {"failure_mode":"unmapped","failure_detail":"invalid NIP-98 signature"}
urn mismatch          → {"failure_mode":"FM-1.2","failure_detail":"source_urn mismatch"}
```

### 4. No regression on adjacent consumers

```
$ npx jest tests/sovereign/{trajectory-util,agent-event-notification,agent-event-auth,agent-control-surface,elevation-publisher}.test.js
Test Suites: 5 passed, 5 total   Tests: 41 passed, 41 total
```

The `failure_mode`/wire addition is additive: the ADR-059 canonical-envelope conformance test
(`agent-event-notification.test.js`) still passes — no existing field moved or changed type.

## Maturity & canary honesty

- **Tier claimed:** `integrated` — both the trajectory hook path and the agent-events envelope (plus the route error returns) now emit the taxonomy; the classifier is the single shared library. The meta-PRD's "QE fleet emits the taxonomy" clause is a downstream consumer of the same library and is not claimed fired here.
- **Honest scope of mapping (ADR-037 D1):** on the raw Bash-failure signal the honest classification is predominantly `unmapped` — a binary success/failure grade cannot distinguish 14 inter-agent modes, and the library refuses to fabricate one. The mapping power is exercised where a caller has real context (the identity-mismatch route return → `FM-1.2`) and by future orchestrators passing a symbolic `reason`. `unmapped` is the taxonomy's own honesty rule, not a gap.
- **`CANARY-AB-MAST`:** registered as the code/config that fires when a real failure carries a MAST `failure_mode` tag (or explicit `unmapped`) end to end on the `trajectory_steps.result` + agent-events envelope wire. The live VisionClaw `LivenessHarness` (`POST /api/canary/register`, port 4000) was not reachable from this build container, so registration is recorded as **pending-live-session** per the honesty rule; the wire is exercised green above. It is a standing KPI monitor (Augmentation Ratio), not a one-shot.
