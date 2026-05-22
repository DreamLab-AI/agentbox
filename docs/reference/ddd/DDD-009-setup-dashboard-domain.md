# DDD-009: Setup Wizard and Operations Dashboard Domain

**Date**: 2026-05-22
**Status**: Draft
**Bounded Context**: Host-Side Configuration and Operational Observability
**Cross-references**: PRD-012, ADR-024, PRD-001, ADR-005, ADR-013, DDD-002

---

## TL;DR for newcomers

*Skip if you already know the setup-dashboard bounded context.*

This DDD captures the domain model for `agentbox-setup`, the host-side binary that owns two concerns: editing the agentbox manifest before the container boots, and observing the running container's operational state after it boots. The pain point is that these look like one product surface but are two fundamentally different domains glued by a mode transition. Pre-boot is a stateless document editor with schema validation. Post-boot is a real-time distributed-system observer consuming 8 independent service endpoints, each with its own health semantics. The shape of the answer is four aggregates — `SetupWizard` (manifest editing), `ServiceRegistry` (port discovery and health), `AgentMonitor` (real-time event streaming), and `MetricsCollector` (Prometheus scraping) — with a clean mode boundary enforced at the domain level: pre-boot code never touches the network; post-boot code never writes to the manifest file.

**If you remember only one thing:** four aggregates, one mode boundary — the wizard edits files, the dashboard observes services, and neither crosses into the other's territory.

---

## Domain Purpose

This domain owns the truth about two things:

1. **What the user intends to run** — the manifest as a validated, section-structured document with cross-field constraints.
2. **What is actually running** — the real-time operational state of the container's services, agents, and resources.

The domain does not own container lifecycle (start/stop/rebuild), secret generation, or the management API itself. It consumes the management API as an external dependency.

---

## Bounded Context Definition

**Boundary**: Host-side binary process. No code from this context runs inside the container.

**Owns**:
- Manifest parsing, validation, and round-trip editing (`SetupWizard` aggregate).
- Service discovery, health polling, and status aggregation (`ServiceRegistry` aggregate).
- Agent event streaming, buffering, and fan-out (`AgentMonitor` aggregate).
- Prometheus metric scraping, aggregation, and time-series windowing (`MetricsCollector` aggregate).
- Mode detection and transition logic.
- API key loading and proxy injection.

**Does not own**:
- The management API routes or their implementation (container-side, management-api/).
- Container lifecycle (docker compose, launch scripts).
- Secret generation or rotation (bootstrap context, DDD-001).
- The agentbox.toml schema definition itself (maintained alongside the Nix flake; this domain consumes it as an embedded asset).
- Service liveness/readiness probe semantics (DDD-002 owns these; this domain interprets probe results but does not define them).

---

## Ubiquitous Language

| Term | Definition |
|------|-----------|
| **Manifest** | The `agentbox.toml` file. The single source of truth for what features an agentbox image includes and how its adapters are configured. |
| **ManifestSection** | A top-level TOML table (`[core]`, `[federation]`, `[adapters]`, `[gpu]`, `[desktop]`, `[providers.*]`, `[skills.*]`, `[linked_data]`). The wizard navigates section-by-section. |
| **SchemaRule** | A JSON Schema constraint applied to a manifest field or cross-field combination. Evaluated server-side on every edit. |
| **ServiceSurface** | One of the 8 localhost endpoints the dashboard monitors. Each has a port, a health endpoint, an auth model, and a feature gate in the manifest. |
| **HealthState** | The tri-state assessment of a service surface: `Healthy`, `Degraded`, or `Unavailable`. Determined by polling the service's health endpoint. |
| **FeatureGate** | A boolean derived from the manifest that determines whether a service surface is expected to exist. A gated-off surface is hidden, not shown as failed. |
| **AgentEvent** | A JSON object received from the management API's `/v1/agent-events` WebSocket. Types include `task.started`, `task.completed`, `agent.spawned`, `agent.exited`, `error`. |
| **EventBuffer** | The in-memory ring buffer (capacity: 200) of recent agent events, replayed to newly connected browser clients. |
| **MetricSample** | A single Prometheus metric value at a point in time, scraped from `localhost:9091/metrics`. |
| **MetricWindow** | A sliding time window (default: 15 minutes) of metric samples retained for chart rendering. |
| **ModeTransition** | The event fired when the binary detects the container becoming available (pre-boot to post-boot) or unavailable (post-boot to pre-boot). Pushed to the frontend via SSE. |
| **ProxyDispatch** | A single proxied HTTP request from the browser through the binary to the management API, with the Bearer token injected server-side. |

---

## Aggregates

### SetupWizard (Root)

The `SetupWizard` owns the manifest document lifecycle: load, validate, navigate, edit, preview diff, and write.

**State**:
- `manifest: TomlDocument` — the round-trip-preserving parsed document (via `toml_edit`).
- `schema: JsonSchema` — the embedded validation schema.
- `current_section: ManifestSection` — the section the user is viewing/editing.
- `validation_errors: Vec<ValidationError>` — current errors, updated on every edit.
- `dirty: bool` — true if unsaved changes exist.

**Commands**:
- `LoadManifest(path)` — parse the TOML file. Fail if unparseable.
- `CreateFromTemplate(path)` — write the default manifest template.
- `EditField(section, key, value)` — update a field. Triggers re-validation.
- `NavigateSection(section)` — change the active section.
- `PreviewDiff() -> String` — compute a unified diff of current vs on-disk.
- `WriteManifest()` — write the document back to disk. Rejected if validation errors exist.
- `ResetSection(section)` — restore section defaults from schema.

**Invariants**:
- **I01**: `WriteManifest` is rejected if `validation_errors` is non-empty. The wizard never writes an invalid manifest.
- **I02**: Comments and formatting in the original file are preserved through the round-trip. Programmatic edits do not reformat unrelated sections.
- **I03**: Cross-field constraints are evaluated eagerly on every `EditField`, not deferred to write time.
- **I04**: The wizard never performs network I/O. All operations are local file reads and writes.

### ServiceRegistry

The `ServiceRegistry` owns discovery and health assessment for all service surfaces.

**State**:
- `surfaces: Vec<ServiceSurface>` — the known surfaces, each with port, health endpoint, auth model.
- `feature_gates: HashMap<String, bool>` — derived from the manifest, indicating which surfaces are expected.
- `health_states: HashMap<String, HealthState>` — current health per surface, updated by polling.
- `poll_interval: Duration` — default 5 seconds.

**Commands**:
- `InitFromManifest(manifest)` — populate `feature_gates` from the parsed manifest.
- `PollHealth()` — hit each non-gated-off surface's health endpoint. Update `health_states`.
- `GetServiceCard(name) -> ServiceCard` — return the display model for one surface.

**Domain Events**:
- `ServiceHealthChanged { name, old_state, new_state }` — emitted when a surface transitions between health states.
- `ModeTransition { from, to }` — emitted when the management API (port 9090) transitions from unavailable to healthy (pre-boot to post-boot) or vice versa.

**Invariants**:
- **I05**: A feature-gated-off surface is never polled and never shown to the frontend. Its `HealthState` is `None`, not `Unavailable`.
- **I06**: `ModeTransition` is emitted exactly once per transition, not on every poll cycle.
- **I07**: Health polling runs on a dedicated async task. A slow or hanging health endpoint does not block other surfaces. Each poll has a 3-second timeout.

**Service Surface Registry**:

| Name | Port | Health Endpoint | Auth | Feature Gate |
|------|------|----------------|------|-------------|
| Management API | 9090 | `/health` | Bearer | always on |
| RuVector | 9700 | `/health` | none | always on |
| Prometheus | 9091 | `/metrics` | none | always on |
| Solid Pod | 8484 | `/.well-known/solid` | WAC | `adapters.pods != "off"` |
| Jupyter | 8888 | `/api/status` | token | `skills.data_science.jupyter` |
| VNC | 5901 | TCP connect | password | `desktop.enabled` |
| code-server | 8080 | `/healthz` | password | `skills.code_editor.code_server` |
| Nostr relay | 7777 | WS handshake | NIP-42 | `adapters.events` contains `nostr` |

### AgentMonitor

The `AgentMonitor` owns the real-time agent event stream.

**State**:
- `ws_connection: Option<WebSocketClient>` — the upstream connection to `localhost:9090/v1/agent-events`.
- `event_buffer: RingBuffer<AgentEvent, 200>` — the most recent 200 events.
- `browser_clients: Vec<WebSocketSender>` — connected browser tabs.
- `filters: HashMap<ClientId, EventFilter>` — per-client event type filters.

**Commands**:
- `Connect()` — establish the upstream WebSocket. Reconnect with exponential backoff on failure.
- `Disconnect()` — close the upstream connection.
- `RegisterClient(sender) -> ClientId` — add a browser WebSocket client. Replay the event buffer immediately.
- `UnregisterClient(id)` — remove a browser client.
- `SetFilter(client_id, filter)` — set event-type filter for a client.

**Event Flow**:
```
Container /v1/agent-events  --WS-->  AgentMonitor  --WS-->  Browser clients
                                         |
                                    event_buffer (ring, 200)
```

**Invariants**:
- **I08**: The event buffer is a fixed-capacity ring. It never grows unbounded. Oldest events are evicted silently.
- **I09**: A failing upstream WebSocket does not crash the binary. Reconnect uses exponential backoff (1s, 2s, 4s, ... max 30s).
- **I10**: Events are relayed verbatim. The monitor adds no fields, removes no fields, and applies no transformation. Filtering is client-side presentation logic only.
- **I11**: The monitor only operates in post-boot mode. It does not attempt connections in pre-boot mode.

### MetricsCollector

The `MetricsCollector` owns Prometheus metric ingestion and windowed aggregation for chart rendering.

**State**:
- `metric_window: Duration` — default 15 minutes.
- `scrape_interval: Duration` — default 10 seconds.
- `samples: HashMap<MetricName, TimeSeries>` — windowed samples per metric.
- `tracked_metrics: Vec<MetricName>` — the subset of Prometheus metrics rendered in the dashboard.

**Commands**:
- `Scrape()` — fetch `localhost:9091/metrics`, parse the Prometheus exposition format, and append samples to tracked time series.
- `GetTimeSeries(name, window) -> Vec<MetricSample>` — return samples within the requested window.
- `SetTrackedMetrics(names)` — configure which metrics to retain.

**Default Tracked Metrics**:
- `process_cpu_seconds_total` (CPU usage)
- `process_resident_memory_bytes` (memory)
- `http_requests_total` (request rate, by status code)
- `agentbox_active_agents` (agent count)
- `agentbox_task_duration_seconds` (task latency histogram)

**Invariants**:
- **I12**: Samples older than `metric_window` are evicted on every scrape. Memory usage is bounded.
- **I13**: A failed scrape is logged and skipped. The collector does not crash or retry aggressively on Prometheus unavailability.
- **I14**: The collector only operates in post-boot mode.

---

## Value Objects

| Value Object | Fields | Semantics |
|---|---|---|
| `ValidationError` | `section: String`, `field: String`, `message: String`, `severity: Error \| Warning` | A schema violation on a manifest field. Displayed inline in the wizard. |
| `ServiceCard` | `name: String`, `port: u16`, `health: HealthState`, `feature_gated: bool`, `last_checked: Instant`, `url: String` | The display model for one service surface in the dashboard. |
| `HealthState` | enum: `Healthy`, `Degraded(reason: String)`, `Unavailable` | Tri-state health assessment. |
| `AgentEvent` | `type: String`, `timestamp: DateTime`, `payload: serde_json::Value` | A single event from the agent event stream. Opaque payload — the dashboard renders known types and shows raw JSON for unknown types. |
| `MetricSample` | `name: String`, `value: f64`, `timestamp: Instant`, `labels: HashMap<String, String>` | One Prometheus metric observation. |
| `TimeSeries` | `samples: VecDeque<MetricSample>` | A windowed, ordered collection of samples for one metric. |
| `EventFilter` | `included_types: HashSet<String>` | Client-side filter for agent event types. Empty set means "all events". |
| `ManifestDiff` | `unified: String` | The unified diff between in-memory and on-disk manifest, for the preview pane. |

---

## Domain Events

| Event | Emitted By | Consumed By | Semantics |
|-------|-----------|-------------|-----------|
| `ManifestValidated` | SetupWizard | Frontend (via HTTP response) | Validation completed; carries error list (may be empty). |
| `ManifestWritten` | SetupWizard | Frontend (via HTTP response) | File successfully written to disk. |
| `ServiceHealthChanged` | ServiceRegistry | Frontend (via SSE) | A service transitioned health state. |
| `ModeTransition` | ServiceRegistry | All aggregates, Frontend (via SSE) | System mode changed between pre-boot and post-boot. |
| `AgentEventReceived` | AgentMonitor | Frontend (via WebSocket) | A new agent event arrived from the container. |

---

## Context Map

```
┌──────────────────────────────────────────────────────────┐
│                    agentbox-setup (Host Binary)           │
│                                                          │
│  ┌──────────────┐  ┌────────────────┐  ┌──────────────┐ │
│  │ SetupWizard  │  │ ServiceRegistry│  │ AgentMonitor │ │
│  │              │  │                │  │              │ │
│  │ manifest.toml│  │  health polls  │  │  WS relay    │ │
│  │ JSON Schema  │  │  mode detect   │  │  event buf   │ │
│  └──────┬───────┘  └───────┬────────┘  └──────┬───────┘ │
│         │                  │                   │         │
│         │         ┌────────┴────────┐          │         │
│         │         │MetricsCollector │          │         │
│         │         │ prom scrape     │          │         │
│         │         │ time series     │          │         │
│         │         └────────┬────────┘          │         │
│         │                  │                   │         │
│  ───────┴──────────────────┴───────────────────┴──────── │
│                     HTTP/WS Proxy Layer                   │
│                 (Bearer token injection)                  │
└─────────────────────────┬────────────────────────────────┘
                          │ localhost only
          ┌───────────────┼───────────────────┐
          │               │                   │
    ┌─────▼─────┐  ┌──────▼──────┐  ┌────────▼────────┐
    │ Mgmt API  │  │ Prometheus  │  │ Other surfaces  │
    │ :9090     │  │ :9091       │  │ :8484,:9700,... │
    └───────────┘  └─────────────┘  └─────────────────┘
              (inside agentbox container)
```

---

## Anti-Corruption Layer

The binary consumes multiple external APIs with different formats:

- Management API: JSON REST, Bearer auth.
- Prometheus: exposition format (text/plain), no auth.
- Solid Pod: LDP/Turtle, WAC auth.
- VNC: TCP, password.
- Nostr relay: WebSocket, NIP-42.

Each `ServiceSurface` in the `ServiceRegistry` encapsulates its health-check protocol behind the `HealthState` abstraction. The dashboard never leaks protocol-specific details into the UI — every surface is reduced to `Healthy | Degraded | Unavailable` with an optional reason string.

---

## Invariant Summary

| ID | Aggregate | Rule |
|----|-----------|------|
| I01 | SetupWizard | Never write an invalid manifest |
| I02 | SetupWizard | Preserve TOML comments and formatting |
| I03 | SetupWizard | Eager cross-field validation |
| I04 | SetupWizard | No network I/O |
| I05 | ServiceRegistry | Gated-off surfaces are invisible, not failed |
| I06 | ServiceRegistry | One ModeTransition event per transition |
| I07 | ServiceRegistry | Health polls are independent and timeout-bounded |
| I08 | AgentMonitor | Fixed-capacity event buffer |
| I09 | AgentMonitor | Reconnect with bounded backoff |
| I10 | AgentMonitor | Verbatim event relay |
| I11 | AgentMonitor | Post-boot only |
| I12 | MetricsCollector | Bounded memory via window eviction |
| I13 | MetricsCollector | Graceful scrape failure |
| I14 | MetricsCollector | Post-boot only |
