# Adapter pattern

How agentbox plugs into durable state. Canonical spec: [ADR-005](../reference/adr/ADR-005-pluggable-adapter-architecture.md).

## The shape

Five slots. Three implementation classes per slot. Fifteen derivations total.

| Slot | Purpose | `local-*` | `external` | `off` |
|---|---|---|---|---|
| `beads` | Agent-work receipts (epic/child/claim/close) | `local-sqlite` | HTTP client | AdapterDisabled |
| `pods` | Durable linked-data storage | `local-jss` | HTTP/WS client | AdapterDisabled |
| `memory` | Vector memory for retrieval | `embedded-ruvector` | `external-pg` | AdapterDisabled |
| `events` | Agent lifecycle event sink | `local-jsonl` | HTTP POST | No-op (per spec) |
| `orchestrator` | Agent spawn + monitor channel | `local-process-manager` | `stdio-bridge` | AdapterDisabled (fatal) |

Files live at `management-api/adapters/<slot>/<impl>.js`.

## The contract

Every adapter implementation extends `BaseAdapter`:

```js
// management-api/adapters/base.js
class BaseAdapter {
  constructor({ slot, impl, config, logger }) {
    this.slot = slot;              // 'beads' | 'pods' | ...
    this.impl = impl;              // 'local-sqlite' | 'external' | 'off'
    this.config = config;          // slot-specific config from manifest
    this.logger = logger;
    this.enabled = impl !== 'off';
  }

  async connect() { /* override */ }
  async disconnect() { /* override */ }
  async health() { /* returns 'healthy' | 'degraded' | 'off' */ }

  get contractVersion() { /* semver string */ }
}
```

The per-slot method set is defined in ADR-005 §Service-level objectives. For `beads`, it's `{createEpic, createChild, claim, close, getReady, show, init, sync}`. Methods must return typed errors (`AdapterDisabled`, `AdapterTimeout`, etc.) from `management-api/adapters/errors.js`.

## Resolution at boot

`management-api/adapters/index.js` at startup:

1. Reads `agentbox.toml` via `adapters/manifest-loader.js`.
2. For each slot, reads `manifest.adapters.<slot>` (e.g. `"local-sqlite"`).
3. `require(\`./\${slot}/\${impl}.js\`)` — fails fast on unknown impl.
4. Instantiates with slot-specific config.
5. Calls `connect()` on each with 10 s timeout.
6. On connect failure:
   - non-critical slots → degrade to `off`, `/health` reports `degraded`
   - `orchestrator` failure → `process.exit(1)` (no agent work without it)

The resolved adapters are attached to the Fastify app: `app.adapters.{beads,pods,memory,events,orchestrator}`.

`/health` reports per-slot status; `/v1/meta` reports the resolved impl name per slot.

## Contract versioning

Each slot carries a semver `contractVersion`. Breaking changes bump MAJOR; additive changes bump MINOR; fixes bump PATCH. Wire format per MAJOR version is published at `schemas/adapter-contracts/<slot>-v<MAJOR>.json`.

At boot, the host orchestrator (when `federation.mode = "client"`) calls `/v1/meta` and compares its declared range against agentbox's version. MAJOR mismatch = fatal.

Compat windows: each new MAJOR ships alongside the prior one for 60 days minimum.

## Writing a new impl for an existing slot

Say you're writing a `beads/external-memcached` impl.

### 1. Create the file

```js
// management-api/adapters/beads/external-memcached.js
const BaseAdapter = require('../base');
const { AdapterTimeout, AdapterDisabled } = require('../errors');

class ExternalMemcachedBeadsAdapter extends BaseAdapter {
  constructor(args) {
    super(args);
    // Parse config.servers, config.timeoutMs, etc.
  }

  async connect() { /* connect to memcached */ }
  async disconnect() { /* close pool */ }
  async health() { /* ping */ }

  async createEpic(epic) { /* ... */ }
  async createChild(child) { /* ... */ }
  // ... every method in the beads contract
}

module.exports = ExternalMemcachedBeadsAdapter;
module.exports.contractVersion = '1.2.0';
```

### 2. Register in the resolver

Add the enum value to `schema/agentbox.toml.schema.json`:

```json
"beads": { "enum": ["local-sqlite", "external", "external-memcached", "off"] }
```

Update `adapters/index.js` only if the mapping from impl-name to filename changes (the default convention is `<impl>.js`).

### 3. Add to contract test harness

`tests/contract/beads.contract.spec.js` already iterates `IMPLS = ['local-sqlite', 'external', 'off']`. Add `'external-memcached'` to the list. The parameterised assertions run automatically.

### 4. Write impl-specific tests

Beyond the contract harness, add whatever unit/integration tests are impl-specific:

```
tests/integration/beads-memcached.test.js
```

Use stubbed memcached in-process for CI speed.

### 5. Document

- Add a row in [../user/configuration.md](../user/configuration.md) §`[adapters]`.
- Note the impl's config shape in a new `docs/user/beads-external-memcached.md` if non-trivial.
- Reference from [ADR-005](../reference/adr/ADR-005-pluggable-adapter-architecture.md) §Service-level objectives if it has different SLOs.

## Adding a new slot (rare)

This is an ADR-level decision. Open an ADR proposal first (`docs/reference/adr/ADR-NNN-<name>.md`) covering:

- Why the slot is needed (what use-case requires this durable-state concern)
- Proposed method set
- Which `local-*` implementation to ship on day one
- Which `external` shape (HTTP / stdio / MCP)
- SLO targets per method

Once the ADR is Accepted, implement:

1. `management-api/adapters/<slot>/{local-*,external,off}.js`
2. `tests/contract/<slot>.contract.spec.js` — new parameterised suite
3. `schemas/adapter-contracts/<slot>-v1.json` — wire format
4. Update `adapters/index.js` resolver
5. Update `/v1/meta` response shape
6. Update manifest schema + `agentbox.toml` example

## SLOs

ADR-005 §Service-level objectives defines the p95 latency / throughput / error-rate budgets per (slot, method). Implementations must meet these under the contract test harness with nominal load.

Current targets, in brief:

| Slot | p95 latency | p95 throughput | error rate |
|---|---|---|---|
| beads create/claim/close | 200 ms | 50 req/s | 0.5% |
| beads getReady/show | 100 ms | 200 req/s | 0.5% |
| pods write | 300 ms | 20 req/s | 1.0% |
| pods read | 150 ms | 100 req/s | 0.5% |
| memory store | 500 ms | 10 req/s | 1.0% |
| memory search/retrieve | 250 ms | 50 req/s | 0.5% |
| events dispatch | 50 ms | 500 req/s | 0.1% |
| orchestrator spawn | 2 s | 2 req/s | 2.0% |
| orchestrator stream event | 20 ms/event | — | 0.5% |

Impls below these numbers are not contract-compliant and block merge.

## Observability

Every adapter dispatch is instrumented. The `wrapDispatch(slot, method, fn)` helper from `management-api/observability/metrics.js` wraps each method call with:

- OpenTelemetry span: `agentbox.adapter.<slot>.<method>`
- Prometheus counter: `agentbox_adapter_dispatch_total{slot, method, impl, outcome}`
- Prometheus histogram: `agentbox_adapter_duration_seconds{slot, method, impl}`
- pino structured log: `{ts, level, slot, method, impl, duration_ms, session_id, execution_id, outcome}`

Your impl doesn't need to add anything — just make sure it calls through the BaseAdapter wrappers which apply `wrapDispatch` automatically.

## Federation vs standalone

Same codepath. `agentbox.toml` picks the impl per slot:

```toml
# Standalone — local fallbacks
[adapters]
beads = "local-sqlite"
pods = "local-jss"
memory = "embedded-ruvector"
events = "local-jsonl"
orchestrator = "local-process-manager"

# Federated — plug into a host mesh
[adapters]
beads = "external"
pods = "external"
memory = "external-pg"
events = "external"
orchestrator = "stdio-bridge"

[federation]
mode = "client"
external_url = "http://host-orchestrator:7070"
```

The contract test harness runs every assertion against every impl class. If a test passes for `local-sqlite` but fails for `external`, that's a real regression regardless of which deployment shape the user picks.

## Testing your new impl

See [testing.md](testing.md) §"New adapter impl".
