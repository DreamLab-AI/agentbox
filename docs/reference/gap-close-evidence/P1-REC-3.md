# P1-REC-3 — Contextual transaction cost fields (emitter side)

**Item:** REC-3 (PRD-019, ADR-037, DDD-017 §CtcField)
**Wave:** P1
**Target tier:** `integrated` (emitter side)
**Canary:** `CANARY-AB-CTC` (standing monitor; fires when a step carries a `token_count` and a chain carries a correlating `handoff_id` end to end)
**Captured against SHA:** `9673624437fb9bd25792112a1b6f05713e6a8c55` (branch `gap-close/2026-07`; receipts run on the working tree atop this base, pinned by the closure commit)
**Timestamp (UTC):** 2026-07-08T13:07:32Z

## Falsification statement (from PRD-019)

> REC-3 is falsified if a step emits no token count where the transcript carries a
> usage block, if multi-agent chains cannot be correlated by a handoff/dag id, or if
> the schema change breaks an existing envelope consumer.

## What changed

The CTC contract (matching VisionClaw's PRD-023 — token burden, handoff counts,
verification outcome) now rides **both** emitter envelopes, additively.

| File | Change |
|---|---|
| `config/hooks/lib/trajectory-util.cjs` | Two PURE helpers: **`tokenCountOf(usage)`** sums an assistant turn's `message.usage` (input + output + cache-creation + cache-read) into one integer, or `null` when no usage block / sum is zero; **`handoffIdFrom(env, fallbackId)`** resolves the chain-correlation id — explicit `AGENTBOX_HANDOFF_ID` / `CLAUDE_DAG_ID` first (shared across a spawned chain), else the trajectory's own id (a single-agent chain of one). |
| `config/hooks/trajectory-recorder.cjs` | `scanTranscript` now captures the **token burden** of the assistant turn that issued each Bash tool call (`util.tokenCountOf(rec.message.usage)`) and counts **Task tool_use spawns as handoffs** across the whole session. Each step's `result` carries `token_count` (AC1). The per-session trajectory rollup carries `handoff_id` (chain correlation) and `handoff_count` (AC2/AC4) so a completed DAG reconstructs — handoff counts + per-step token burden. All additive: absent when the source is absent (byte-compatible with the pre-REC-3 result shape). |
| `management-api/utils/agent-event-publisher.js` | The agent-events envelope forwards `token_count`, `handoff_id` and `verification` in `emitAgentAction` (only when the caller supplies them) and renders them in `createMcpNotification` (null when absent — the same byte-compatible discipline REC-5's `failure_mode` uses). |
| `tests/sovereign/trajectory-util.test.js` | +6 cases: `tokenCountOf` sums / returns null / ignores bad fields; `handoffIdFrom` precedence. |
| `tests/sovereign/voice-intent.test.js` | +2 cases (REC-3 emitter): the wire carries `token_count`/`handoff_id`/`verification` when supplied, and renders them null for an existing caller that omits them (byte-compatible). |

## Both envelopes carry the CTC fields

1. **Trajectory step envelope** (`trajectory_steps.result`): `token_count` per step;
   the rollup metadata carries `handoff_id` + `handoff_count`.
2. **Agent-events envelope** (`createMcpNotification` `params.event`): `token_count`,
   `handoff_id`, `verification` — null when absent.

The `verification` slot is the REC-8 (P2) anti-fox outcome; the emitter carries the
field additively now so the CTC dashboard can read it once REC-8 populates it.

## Receipts

### 1. Unit tests — source-side helpers (`cd management-api && npx jest`)

```
$ npx jest ../tests/sovereign/trajectory-util.test.js
PASS ../tests/sovereign/trajectory-util.test.js
  trajectory-util.tokenCountOf (transcript usage → step token burden)
    ✓ sums prompt + completion + cache tokens of a turn
    ✓ null when no usage block is present or the sum is zero (byte-compatible)
    ✓ ignores non-numeric / negative fields rather than throwing
  trajectory-util.handoffIdFrom (chain correlation across a multi-agent DAG)
    ✓ prefers an explicit orchestrator chain id (AGENTBOX_HANDOFF_ID)
    ✓ falls back to CLAUDE_DAG_ID, then to the trajectory id (single-agent chain of one)
Tests:       13 passed, 13 total
```

### 2. Unit tests — wire (emitter) forwarding + byte-compatibility

```
$ npx jest ../tests/sovereign/voice-intent.test.js
  REC-3 — CTC fields on the agent-events envelope (emitter side)
    ✓ forwards token_count, handoff_id and verification when supplied
    ✓ renders the CTC fields null for an existing caller that omits them (byte-compatible)
Tests:       19 passed, 19 total   (whole suite, incl. COM-15)
```

### 3. No existing consumer broken (adjacent suite)

```
$ npx jest ../tests/sovereign/agent-event-notification.test.js
PASS ../tests/sovereign/agent-event-notification.test.js
```

The notification test asserts individual properties (never a strict key-set), so the
additive nullable fields do not break it — the byte-compatibility clause holds.

### 4. node -c

```
OK: config/hooks/lib/trajectory-util.cjs
OK: config/hooks/trajectory-recorder.cjs
OK: management-api/utils/agent-event-publisher.js
```

## Maturity & canary honesty

- **Tier:** `integrated` (emitter side) — the token burden is parsed from the real
  transcript usage block, the handoff id correlates a chain, and the schema change is
  additive and unit-proven byte-compatible.
- **`CANARY-AB-CTC`:** the wire (trajectory step + agent-events envelope carrying
  `token_count` and a correlating `handoff_id`) is exercised green above. A live fire
  needs the trajectory hook enabled against live agent traffic; the VisionClaw
  `LivenessHarness` was not reachable from this build container → registration
  **pending-live-session**. Standing monitor (feeds the CTC KPI, REC-4), not one-shot.

---

## Gap-close correction — 2026-07-08 (adversarial re-verification)

**Captured against SHA:** `1fc47a14bffc524f7d59aacdefbe0671551ac6bf` · **UTC:** 2026-07-08T14:45:18Z

**Defect found (REC-3):** the claim above — that the CTC fields "ride **both**
emitter envelopes" — was overstated for the agent-events envelope. The publisher
*could* carry `token_count`/`handoff_id` **only when a caller supplied them**
(`emitAgentAction` lines 76-78), and the trajectory-recorder wrote the captured
fields **only into the `trajectory_steps` DB rows** — no code path forwarded them
into a real `emitAgentAction` call. The two halves were disconnected: the emit
route (`POST /v1/agent-events/emit`) also **dropped** any `token_count`/`handoff_id`
from its body. So the agent-events envelope never carried a trajectory step's CTC
fields and **`CANARY-AB-CTC` could not fire even live** — the wire the canary
observes did not exist end to end.

**What the correction wired (the missing forwarding path):**

| File | Change |
|---|---|
| `config/hooks/lib/trajectory-util.cjs` | New pure `ctcEmitBodyFromStep(step, {handoffId, sessionId})` — the deterministic core of the forwarding path: maps a captured step into the emit body carrying `token_count` + `handoff_id`; returns `null` when the step has no CTC signal (byte-compatible). |
| `config/hooks/trajectory-recorder.cjs` | After DB persistence, `emitCtcStepsBestEffort` POSTs each step's `ctcEmitBodyFromStep` body to `POST /v1/agent-events/emit` (fail-open, bounded, `http.request` mirroring `project-tracking-publish.cjs`; off-switch `AGENTBOX_CTC_EMIT=0`). This is the real `emitAgentAction` call the fields now reach. |
| `management-api/routes/agent-events.js` | The `/v1/agent-events/emit` route body schema + `emitPayload` now **forward** `token_count`/`handoff_id`/`verification` (they were dropped before), so the recorder's fields reach the publisher-built envelope. |
| `tests/sovereign/ctc-emitter-wire.test.js` | **New.** Proves the mapper, and an **end-to-end** case: the mapped step POSTed to the real emit route yields an envelope whose `token_count`/`handoff_id` carry through (`emitAgentAction` + `createMcpNotification`). |

**Correction receipts:**
- `node -c` OK on all four files.
- `npx jest ../tests/sovereign/ctc-emitter-wire.test.js` → PASS (4/4), incl. the
  END-TO-END step→emit-route→envelope assertion.
- Full sovereign suite unaffected (the 7 pre-existing contract/integration failures
  are environmental — needing a live server/relay — and fail identically on the
  clean baseline; none reference the changed modules).

**Corrected tier:** still `integrated` on the **emitter code path** — the forwarding
now exists and is unit-proven end to end (recorder → emit route → agent-events
envelope). The **live** `CANARY-AB-CTC` fire remains **pending-live-session**: it
needs the trajectory hook enabled (`RUVECTOR_RECORD_TRAJECTORIES`) against live
agent traffic with the management-API reachable, which this build container does not
provide. The earlier "rides both envelopes" wording is corrected above rather than
deleted.
