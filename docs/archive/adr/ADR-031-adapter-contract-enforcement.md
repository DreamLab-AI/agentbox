---
id: ADR-031
title: Adapter contract enforcement — the merge gate is executable
status: accepted
date: 2026-06-11
type: quality
author: Dr John O'Hare
depends_on: [ADR-005, ADR-008, ADR-012]
review_trigger: a new adapter slot is added; an impl class is added to a slot; a contract suite gains an `isReal:false` skip; or the privacy→encoder middleware order changes
---

# ADR-031 — Adapter contract enforcement: the merge gate is executable

**Related:** ADR-005 (Pluggable adapter architecture — the contract harness and its merge-gate mandate), ADR-008 (Privacy filter routing — fail-closed/fail-open per-slot posture), ADR-012 (Linked-Data interchange — the JSON-LD encoder, Layer 3), DDD-004 §L08 (privacy redaction completes before the encoder), commit `f518120e` (per-dispatch privacy→encoder invariant).

## TL;DR for newcomers
*Skip if you already know why a green contract suite must mean what it says.*

ADR-005 declared the adapter contract harness in `tests/contract/` a **merge gate**: every slot must run real behavioural assertions against all three implementation classes (local-first, external/federated, off) before a PR can merge. The 2026-06-11 audit (anomaly register O1/O2) found the gate was partly aspirational. Three holes: the beads `external` leg was flagged `isReal:false`, so every behavioural assertion silently skipped — zero federated parity. The orchestrator `stdio-bridge` was tested with a write-only stub that never read anything back, so a federated spawn was never actually verified. And `routes/memory.js` wrote pod fallbacks by calling `pods.write()` directly, skipping the JSON-LD encoder (ADR-012 Layer 3) entirely — there were **no production callers** of `encoder.dispatch`, so the per-dispatch privacy→encoder invariant that `f518120e` made real never ran on a real path.

This ADR ratifies the ADR-005 mandate as an *executable* CI gate and bans the silent skip. `isReal:false` is no longer a legal way to make a suite green: an external leg either runs real behavioural assertions (against a live host, or — when that is infeasible in CI — against a **stateful loopback** that short-circuits only the network hop), or it carries a **registered, time-boxed, owner-attributed exemption** that the harness logs loudly and refuses to accept malformed or expired. The gate also requires **middleware-bypass coverage**: a test that proves a direct adapter call which skips the encoder is detected.

**If you remember only one thing:** a green adapter contract suite means all three classes per slot ran real assertions — a skip is a registered exemption with a name and an expiry attached, never a silent `false`.

For the deep version, keep reading.

## Context

ADR-005 §Contract test harness specifies: *"the contract test harness in `tests/contract/` must pass for all three implementation classes per slot."* The agentbox repo notes (CLAUDE.md, §Important Rules) restate it as non-negotiable: *"Never ship a feature that only works in `client` mode or only in `standalone` mode — the contract test harness ... must pass for all three implementation classes per slot."*

The harness parameterises each suite over an `IMPLS` array. Each entry carries an `isReal` flag. The `[M2]` behavioural assertions — the ones that verify the adapter actually *does the right thing*, not merely that it exposes a method of the right name — are gated `if (isReal) { ... }`. Setting `isReal:false` therefore silently removes a class's behavioural coverage while the suite still reports green. That is exactly what happened to the beads external leg (`beads.contract.spec.js:68`, register O1).

Three forces shape the decision:

1. **A federated leg is the whole point of the `external` class.** ADR-005's entire thesis is "never hardcode a backend; never ship a feature that only works in one mode." An external impl whose behaviour is never asserted is an untested second codepath — precisely the tech debt the adapter pattern exists to escape.

2. **CI cannot always reach a live host.** The `external`/`external-pg`/`stdio-bridge` classes federate to a host mesh that does not exist in a unit-test runner. A canned-body fetch stub is the lazy answer, but it cannot model *stateful* behaviour: beads assertions require that `createChild` links to a previously-created epic, that `claim` then `getReady` excludes the just-claimed child, and that wire 404/409 surface as typed `NotFound`/`AlreadyClaimed`. A stub returning fixed bodies asserts nothing about state.

3. **The encoder (ADR-012 Layer 3) is a *caller*-invoked middleware, not an adapter wrapper.** `wrapDispatch` composes Layer 1 (observability) and Layer 2 (privacy filter) around the raw adapter method; Layer 3 is invoked by the route via `encoder.dispatch`. A route that calls `adapter.write()` directly silently drops the encoder — and with it the DDD-004 §L08 per-dispatch privacy assertion that `f518120e` made real. With no production caller of `encoder.dispatch`, the invariant was load-bearing in tests only.

## Decision

### D1 — `isReal:false` is banned for the local-first and external classes

Every adapter slot's contract suite MUST run its `[M2]` behavioural block against both its local-first class and its external/federated class. The `off` class is exempt by construction — it has no behaviour to assert beyond the off-discipline block (`AdapterDisabled` on every method).

A green suite with `isReal:false` on a non-`off` class is a contract regression. Reviewers reject it; CI is expected to grow a lint that flags `isReal: false` on any entry whose `label` is not `off`.

### D2 — Federated parity is real, via a stateful loopback when a live host is infeasible

Where the external class cannot reach a live host in CI, it is driven by a **stateful loopback**: a fixture that implements the host's wire contract (paths, methods, status codes) backed by an in-memory store mirroring the local-first impl's semantics, exposed to the adapter as its `fetchFn` (or `stdio` sink). The loopback short-circuits *only the network hop*. The adapter still constructs every request, emits its headers, parses the response body, and maps wire status codes to typed errors. This is a contract loopback, not a mock: every assertion exercises the adapter's real serialisation and error-mapping path.

The canonical example is `tests/contract/fixtures/beads-loopback.js`, which routes the `ExternalBeadsAdapter`'s HTTP calls (`POST /v1/beads/epics`, `POST /v1/beads/:id/claim`, `GET /v1/beads/ready?parent_id=...`, …) to a stateful store with the same semantics as `adapters/beads/local-sqlite.js`, returning 404/409 so the adapter's typed-error mapping is exercised end to end.

A stateless canned-body stub remains acceptable *only* for slots whose external assertions are single-round-trip and stateless (e.g. events `dispatch` returning `{ts, kind, payload}`; pods `write` returning a Location). It is NOT acceptable for stateful slots (beads).

### D3 — Silent skips are banned; exemptions are registered, loud, and time-boxed

If — and only if — a real or loopback assertion is genuinely infeasible, an impl MAY declare a **registered exemption** instead of `isReal:false`. The exemption is an object of exactly this shape:

```js
{
  reason:   '<why real or loopback parity is infeasible in CI>',
  owner:    '<github-handle or did:nostr of the accountable engineer>',
  tracking: '<issue/ADR ref that will resolve it, e.g. agentbox#NNN>',
  expires:  '<ISO-8601 date after which the exemption is a hard failure>',
}
```

The harness asserts the exemption via `assertRegisteredExemption(slot, impl, exemption)`
(`tests/contract/fixtures/shared-assertions.js`). That helper:

- **throws** if the exemption object is missing or not an object (a bare `isReal:false` with no exemption is a hard failure — silent skips cannot pass);
- **throws** if any of the four fields is missing or empty;
- **throws** if `expires` is not a valid ISO-8601 date, or is in the past (an expired exemption fails the build — exemptions rot deliberately);
- otherwise **emits a `console.warn`** naming `slot::impl`, the reason, owner, tracking ref, and expiry, so an exemption is always visible in CI logs and can never masquerade as a green skip.

The distinction is the whole point: a silent `isReal:false` claims coverage it does not have; a registered exemption *advertises* its missing coverage with a name and a deadline attached.

### D4 — Middleware-bypass coverage is required

Each cross-cutting middleware layer (ADR-005 observability, ADR-008 privacy, ADR-012 encoder) must have a test proving that a dispatch which *skips* it is detected, not silently tolerated. Specifically:

- The encoder's per-dispatch privacy guard (`assertPrivacyFilterApplied`, DDD-004 §L08, `f518120e`) must be covered by a test that an unmarked payload reaching the encoder trips `opf_middleware_order_violations_total` and — for the fail-closed slots `pods` and `memory` (ADR-008) — throws `MiddlewareOrderViolation`. (Covered by `tests/contract/linked-data/privacy-handoff.contract.spec.js`.)
- Any route that writes through an adapter for a slot with a linked-data surface must either invoke the encoder, or be covered by a test proving the bypass is caught. (Covered for the memory→pods path by `tests/contract/memory-encoder-bypass.contract.spec.js`.)

### D5 — The memory→pods fallback writes through the encoder (register O2 closed)

`routes/memory.js` resolves whether the S1 pods linked-data surface is enabled (`[linked_data].enabled` && `[linked_data].pods != "off"`). When enabled, the pod-fallback write is routed through `fastify.linkedData.dispatch({ slot:'pods', operation:'write', payload, adapterCall })` instead of calling `pods.write()` directly. The route stamps the per-dispatch privacy marker (`_markPrivacyApplied`) on the payload before dispatch — redaction itself still runs as Layer 2 inside the wrapped `pods.write` — so the encoder's fail-closed L08 guard recognises the dispatch as privacy-traversed rather than a bypass.

When the surface is off, the raw path remains, but the route still stamps the privacy marker and calls `assertPrivacyFilterApplied(entry, 'pods', …)` so that any future refactor dropping the privacy wrapper is caught loudly — pods is a fail-closed slot, so an unmarked write trips `MiddlewareOrderViolation`. This is the ADR-008 fail-closed posture for pods, applied at the route boundary.

The `f518120e` invariant in `privacy-filter.js` / `encoder.js` is consumed unchanged; this ADR adds a production caller of `encoder.dispatch`, which previously had none.

## Consequences

**Positive.** A green adapter contract suite now means what ADR-005 always claimed it meant: all three classes per slot ran real assertions. The beads federated leg has genuine behavioural parity (it drives the real HTTP serialisation and typed-error path against a stateful backend). The orchestrator stdio-bridge verifies a real round-trip (the emitted JSON-RPC frame is read back and checked). The encoder has its first production caller, so the per-dispatch privacy invariant runs on a real path, not only in tests.

**Negative / cost.** Loopback fixtures are additional code to maintain alongside the local-first impl; if the wire contract drifts, the loopback must track it (this is a feature — the drift surfaces as a test failure). The exemption protocol adds ceremony, deliberately: making a skip expensive is the mechanism.

**Known pre-existing failures (NOT regressions of this ADR).** Two contract suites fail on clean HEAD for environment reasons unrelated to enforcement: the beads `local-sqlite` suite when `better-sqlite3`'s native ABI does not match the runner's Node, and the memory `external-pg` suite when no RuVector Postgres table is reachable. These are infrastructure gaps, not contract regressions; they are tracked separately and are out of scope here.

## Alternatives considered

- **Leave `isReal:false` as an honest "not yet" marker.** Rejected: it is indistinguishable from a regression in a green run, and ADR-005 already mandated all-three-classes. An honest "not yet" is exactly what the registered exemption (D3) provides — with a name and a deadline.
- **Spin up a real host service in CI for the external legs.** Rejected as the default: heavy, slow, and flaky for a unit-test gate. It remains the right answer for an integration-test job; the loopback is the unit-gate answer.
- **Wire the encoder globally into `wrapDispatch` so every adapter write is encoded.** Rejected as too broad for this change: the encoder is per-surface gated and operation-specific, and the privacy→encoder ordering (DDD-004 §L08) is intentionally caller-invoked so redaction completes first. Routing the one known bypass (memory→pods, D5) through `encoder.dispatch` closes O2 without changing the middleware composition the rest of the system relies on.
