# Adapter contract tests

Every adapter slot defined in ADR-005 has a dedicated suite here.  Each suite
runs against all three implementation classes for that slot.

## Slot × impl × method matrix

| Slot | Impls | Required methods |
|---|---|---|
| `beads` | local-sqlite, external, off | createEpic, createChild, claim, close, getReady, show |
| `pods` | local-jss, external, off | write, read, patch, del, list |
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
3. Provide real fixtures or lightweight mocks for the method under test.
4. Ensure the SLO thresholds in `fixtures/contract-versions.fixture.js` are not
   relaxed — they are the merge-gate numbers from ADR-005.
5. CI runs the suite on every PR touching `management-api/adapters/**`.  The
   suite must be green before the PR can merge.
