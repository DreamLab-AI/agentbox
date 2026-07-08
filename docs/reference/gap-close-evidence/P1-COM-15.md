# P1-COM-15 — Voice-intent producer (mandate-gated, `actor_did`, signed 31402 dispatch)

**Item:** COM-15 (PRD-019, ADR-037 D7, DDD-017 §VoiceIntent / §6)
**Wave:** P1
**Target tier:** `integrated` (agentbox producer side); `federation-verified` end-to-end is VisionClaw-led
**Canary:** `CANARY-AB-VOICE` (one-shot correctness wire; fires on an accepted, scene-`actor_did`-targeted signed 31402)
**Captured against SHA:** `9673624437fb9bd25792112a1b6f05713e6a8c55` (branch `gap-close/2026-07`; receipts run on the working tree atop this base, pinned by the closure commit)
**Timestamp (UTC):** 2026-07-08T13:07:32Z

## Falsification statement (from PRD-019)

> COM-15 is falsified if the producer still hashes only a free-text actor with no
> verified `actor_did`, if it dispatches an unsigned or un-targeted intent, or if it
> conflates the speaker identity with the target actor identity.

## What changed

| File | Change |
|---|---|
| `management-api/routes/voice-intent.js` | **Un-gated behind a mandate (ADR-037 D7), no longer the blanket `voice_intent = false` 503.** Added an additive **`actor_did`** field (the scene-selected TARGET principal), validated as `did:nostr` via `mandate.normalisePubkey`. A request must carry a valid, active, signature-verified **mandate** (`lib/mandate.recordFromSignedMandate` → `isMandateActive`, reconciled to the speaker's `auth.did` when auth is on); no/invalid mandate ⇒ **declines** (403). It then **dispatches a signed kind-31402 ActionRequest TARGETING the actor** (`lib/agent-control-surface.buildActionRequest` with a `['p', actorPubkey]` tag, published via an injected dispatcher) and returns the **dispatch evidence** (`dispatch.request_event_id`, `kind:31402`, `target_did`, `panel_id`). The verified **speaker** (`auth.did`, or the mandate grantee when auth off) and the **target** (`actor_did`) are recorded as **distinct** fields (DDD-017 invariant 6). The free-text `actor` is kept as an optional display label. |
| `management-api/server.js` | `buildVoiceIntentDispatcher(manifest, logger)` — a lazily-connected closure over a `NostrBridge` + the agentbox signer (same vendoring pattern as junkiejarvis), wired into the route. Returns `null` when the sovereign bridge / relays / signer stack are unavailable ⇒ the route declines 503 `dispatch-unavailable` (fail-closed, no dead code, no silent success). The bridge connects on the first dispatch, not at boot. |
| `tests/sovereign/voice-intent.test.js` | +7 COM-15 cases (test-caller via Fastify `inject`), +2 REC-3 emitter cases. |

The old `hashString(actor)` numeric-target path is **gone** as the target: the 31402 is
addressed to the verified `actor_did` pubkey (`p` tag + `subjectId`). The beam-parity
`agent_action` emit is kept for the coloured-beam wire, now sourced by the speaker and
targeted at the actor.

## Receipts

### 1. Test-caller — mandate rejection without, acceptance with (`cd management-api && npx jest`)

```
$ npx jest ../tests/sovereign/voice-intent.test.js
PASS ../tests/sovereign/voice-intent.test.js
  COM-15 — /v1/voice-intent mandate gate + signed 31402 dispatch
    ✓ DECLINES 403 mandate-required when no mandate is presented (un-gated behind mandate)
    ✓ ACCEPTS with a valid mandate and DISPATCHES a signed 31402 targeting actor_did
    ✓ DECLINES 403 mandate-invalid for a malformed mandate event
    ✓ DECLINES 403 mandate-unverified when the mandate signature does not verify
    ✓ DECLINES 403 mandate-inactive for an expired mandate
    ✓ DECLINES 400 actor_did-invalid when the target is not a did:nostr
    ✓ DECLINES 503 dispatch-unavailable when no signed-31402 dispatcher is wired (fail-closed)
Tests:       19 passed, 19 total
```

The "accepts" case asserts, against the captured dispatched event: `kind === 31402`, a
`['p', actorPubkey]` tag (targeted), and `content.fields.speaker_did !== content.fields.actor_did`
(the two principals never conflated). The response body carries
`dispatch.request_event_id`, `dispatch.kind === 31402`, `dispatch.target_did`, and
`speaker_did !== actor_did` — each falsification clause is locked.

Auth note: this environment sets `AGENTBOX_AGENT_EVENT_AUTH=nip98`; the COM-15 suite
pins it to `off` (save/restore) to isolate the MANDATE as the sole accept/decline gate
under test. With auth on, the mandate's grantee is additionally reconciled against the
verified NIP-98 speaker (`mandate-speaker-mismatch` path); `reconcileSourceUrn` is the
already-tested helper it reuses (`agent-event-auth.test.js`).

### 2. node -c + validator

```
OK: management-api/routes/voice-intent.js
OK: management-api/server.js
$ node scripts/agentbox-config-validate.js   → exit 1
  (only the 3 pre-existing E016 keys the PRD scopes out: ruvnet_brain,
   mcp_startup_timeout_ms, mcp_tool_timeout_ms — NONE mention voice/actor_did;
   agentbox.toml + schema untouched, drift-neutral)
```

## Maturity & canary honesty

- **Tier:** `integrated` (producer side) — the mandate gate, the verified `actor_did`,
  and the signed-31402 dispatch with returned evidence are wired and test-caller-proven.
  `federation-verified` end-to-end (VisionClaw PTT → STT → this endpoint → audible
  confirmation) is VisionClaw-led and not folded into agentbox's claim.
- **`CANARY-AB-VOICE`:** the producer un-gates before its VisionClaw PTT/STT caller
  exists (DDD-017 Open Issue 1), so the canary fires against the **test-caller** above
  until the cross-substrate path lands this same wave. The VisionClaw `LivenessHarness`
  was not reachable from this build container → registration **pending-live-session**.
  One-shot correctness wire (a single live fire suffices, re-checked on this SHA).
- **Cross-repo boundary:** agentbox owns the producer route, the `actor_did` schema, and
  the signed-31402 dispatch; nostr-rust-forum owns the ACSP 31402 signing/decision loop
  (the producer only mints + dispatches the request — it does not sign the decision).
