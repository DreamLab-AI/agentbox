# Adapter contract tests

Every adapter slot defined in ADR-005 has a dedicated suite here.  Each suite
runs against all three implementation classes for that slot.

## Enforcement gate (ADR-031)

ADR-005 declared this harness a **merge gate**: every slot must run real
behavioural assertions against all three implementation classes
(local-first, external/federated, off). ADR-031 ratifies that mandate as an
executable CI gate:

- **`isReal: false` is banned** for the local-first and external classes. A
  silent skip of the `[M2]` behavioural block is a contract regression, not a
  convenience. The `off` class is exempt by design — it has no behaviour to
  assert beyond the off-discipline block (`AdapterDisabled` on every method).
- **Federated parity is real, not canned.** Where an external impl cannot reach
  a live host in CI, it is driven by a *stateful loopback* (e.g.
  `fixtures/beads-loopback.js`) that short-circuits only the network hop — the
  adapter still constructs every request, parses every response, and maps wire
  status codes to typed errors. Canned-body stubs that cannot model state are
  not acceptable for slots whose assertions are stateful (beads).
- **Middleware-bypass coverage is required.** A test must prove that a direct
  adapter call which skips the JSON-LD encoder (ADR-012 Layer-3) is detected —
  see `memory-encoder-bypass.contract.spec.js` (route wiring) and
  `linked-data/privacy-handoff.contract.spec.js` (encoder mechanism).

### Registered exemption protocol

If — and only if — a real or loopback assertion is genuinely infeasible in CI,
an impl may carry a **registered exemption** instead of a silent skip. An
exemption is a loud, documented, time-boxed object the harness logs:

```js
{ exemption: { reason: '<why real/loopback parity is infeasible in CI>',
               owner:  '<github-handle or did:nostr>',
               tracking: '<issue/ADR ref, e.g. agentbox#NNN>',
               expires: '<ISO-8601 date>' } }
```

The harness asserts the exemption object is well-formed (all four fields
present) and emits a `console.warn` naming the slot/impl, so an exemption can
never pass as a green silent skip. A missing or malformed exemption fails the
suite. See ADR-031 for the full protocol and the ban rationale.

> Current exemptions: **none**. The beads external leg was converted from
> `isReal: false` to real loopback parity; the orchestrator stdio-bridge gained
> a round-trip assertion. Both run their full `[M2]` blocks.

## Slot × impl × method matrix

| Slot | Impls | Required methods |
|---|---|---|
| `beads` | local-sqlite, external, off | createEpic, createChild, claim, close, getReady, show |
| `pods` | local-solid-rs, external, off | write, read, patch, del, list |
| `memory` | embedded-ruvector, external-pg, off | store, search, retrieve, del |
| `events` | local-jsonl, external, off | dispatch, subscribe, unsubscribe |
| `orchestrator` | local-process-manager, stdio-bridge, off | spawnAgent, streamEvent, listAgents, terminateAgent |

## SLO columns (from ADR-005 §Service-level objectives)

| Slot / method | p95 latency | Throughput floor | Error ceiling |
|---|---|---|---|
| beads write | 200 ms | 50 req/s | 0.5 % |
| beads read | 100 ms | 200 req/s | 0.5 % |
| pods write | 300 ms | 20 req/s | 1.0 % |
| pods read | 150 ms | 100 req/s | 0.5 % |
| memory store | 500 ms | 10 req/s | 1.0 % |
| memory search | 250 ms | 50 req/s | 0.5 % |
| events dispatch | 50 ms | 500 req/s | 0.1 % |
| orchestrator spawn | 2 s | 2 req/s | 2.0 % |
| orchestrator stream | 20 ms/event | — | 0.5 % |

## How to run locally

```bash
# From the repo root — install once
npm install --prefix management-api

# Run all five suites
npx --prefix management-api jest tests/contract/

# Run a single suite
npx --prefix management-api jest tests/contract/beads.contract.spec.js
```

## Promoting a pending test to a real assertion

1. Replace the placeholder import in the spec with the real implementation class.
2. Remove the `.todo` wrapper from the relevant `it` block.
3. Provide a real fixture for the method under test. For an external/federated
   leg, prefer a **stateful loopback** (see `fixtures/beads-loopback.js`) over a
   canned-body stub so the adapter's real request/response/typed-error path is
   exercised. `isReal: false` is banned for non-`off` impls (ADR-031).
4. Ensure the SLO thresholds in `fixtures/contract-versions.fixture.js` are not
   relaxed — they are the merge-gate numbers from ADR-005.
5. CI runs the suite on every PR touching `management-api/adapters/**`.  The
   suite must be green before the PR can merge.

If an external leg truly cannot be exercised in CI, do NOT set `isReal: false`.
Declare a registered exemption and assert it with
`assertRegisteredExemption(slot, impl, exemption)` from `fixtures/shared-assertions`
— it throws on a malformed or expired exemption and warns loudly otherwise
(ADR-031 §Registered exemption protocol).
