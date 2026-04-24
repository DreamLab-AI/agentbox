# DDD-002: Runtime Contract Domain

**Date**: 2026-04-24
**Status**: Accepted
**Bounded Context**: Runtime Contract
**Cross-references**: PRD-003 (product requirements), ADR-007 (decision record + exception mechanism), DDD-001 (immutable bootstrap domain — supplies `BootstrapCompleted` consumed by `evaluateReadiness()`)

---

## Domain Purpose

The Runtime Contract domain defines what an operator can trust about a running agentbox container: which image is being run, whether it is live, whether it is ready, where observability is exposed, and what security boundary is in force.

## Bounded Context Definition

**Boundary**: This domain owns the operator-facing runtime contract.

**Owns**: Image reference resolution, probe semantics, observability binding, runtime security profile.

**Does not own**: Build-time packaging, capability taxonomy, internal adapter business logic.

## Ubiquitous Language

| Term | Definition |
|---|---|
| **Image Reference Policy** | The rule set that determines which OCI image the runtime should start. |
| **Liveness State** | Whether the main service process is alive and responsive enough to be restarted or not. |
| **Readiness State** | Whether the runtime is actually able to serve its declared responsibilities. |
| **Observability Binding** | The concrete mapping from manifest config to ports, env vars, and endpoints for metrics and tracing. |
| **Security Profile** | The enforced runtime boundary: user, capabilities, writable paths, tmpfs, and exceptions. |
| **Contract Drift** | Any mismatch between docs, generated compose, helper scripts, and actual runtime behavior. |

## Aggregates

### RuntimeContract (Root Aggregate)

The authoritative operator-facing contract for one agentbox deployment.

```
RuntimeContract
  +-- imageReferencePolicy: ImageReferencePolicy
  +-- probeContract: ProbeContract
  +-- observabilityBinding: ObservabilityBinding
  +-- securityProfile: SecurityProfile
  |
  +-- ImageReferencePolicy
  |     +-- source: "local" | "registry" | "pinned"
  |     +-- imageRef: string            // resolved value; local default or AGENTBOX_IMAGE_REF
  |     +-- envVarName: string          // always "AGENTBOX_IMAGE_REF"
  |     +-- localDefault: string        // "agentbox:runtime-<system>"
  |
  +-- ProbeContract
  |     +-- liveness: ProbeState        // /livez — process alive, no dep checks
  |     +-- readiness: ProbeState       // /ready — all ReadinessRequirements satisfied
  |     +-- detailEndpoint: "/health"   // human aggregate, not used for automation
  |     +-- livenessEndpoint: "/livez"
  |     +-- readinessEndpoint: "/ready"
  |     +-- readinessRequirements: ReadinessRequirement[]
  |
  +-- ObservabilityBinding
  |     +-- metricsPort: number         // [observability].metrics_port; default 9091
  |     +-- metricsEndpoint: string     // "http://0.0.0.0:<metricsPort>/metrics"
  |     +-- otlpEndpoint: string | null // [observability].otlp_endpoint; null = disabled
  |     +-- logLevel: string            // [observability].log_level; default "info"
  |     +-- composePortExposed: boolean // true when metricsPort appears in compose ports:
  |     +-- envVarInjected: boolean     // true when AGENTBOX_METRICS_PORT set in imageEnv
  |     +-- metaEndpointPublishes: boolean // true when /v1/meta includes observability field
  |
  +-- SecurityProfile
        +-- user: string
        +-- readOnlyRootFs: boolean
        +-- droppedCaps: string[]
        +-- writableMounts: string[]
        +-- tmpfsMounts: string[]
        +-- exceptions: SecurityException[]
```

### Invariants

1. The Image Reference Policy must resolve to exactly one image reference.
2. Readiness cannot be `ready` until Immutable Bootstrap reports completion.
3. If a metrics port is configured and documented, the Observability Binding must expose it.
4. Security Profile exceptions must be explicit and attributable to a feature mode.
5. Docs, helper scripts, and compose generation must all derive from the same Runtime Contract inputs.

## Entities

### ImageReferencePolicy

Encapsulates the resolution rule that produces the concrete image reference for a deployment.

**Identity**: deployment instance (singleton per runtime).

**Fields**:

| Field | Type | Description |
|---|---|---|
| `envVarName` | `string` | Always `"AGENTBOX_IMAGE_REF"` |
| `envVarValue` | `string \| null` | Runtime value of `AGENTBOX_IMAGE_REF`; `null` when unset |
| `localDefault` | `string` | `"agentbox:runtime-<system>"` — platform-specific Nix build tag |
| `source` | `"local" \| "registry" \| "pinned"` | `"local"` when `envVarValue` is null; `"registry"` when value is a tag like `:latest`; `"pinned"` when value contains a digest (`@sha256:...`) |
| `resolvedRef` | `string` | Final value: `envVarValue` if set, else `localDefault` |

**Invariant**: `resolvedRef` is always non-empty. `source` is derived from `resolvedRef`, never set independently.

**Behavior — `resolveImageReference()`**:

```
if AGENTBOX_IMAGE_REF is non-empty:
  resolvedRef = AGENTBOX_IMAGE_REF
  source = "registry" or "pinned" (by digest-presence heuristic)
else:
  resolvedRef = "agentbox:runtime-<system>"
  source = "local"
emit ImageReferenceResolved { imageRef: resolvedRef, source }
```

### ReadinessRequirement

Represents one evaluable condition that must be satisfied for the runtime to be considered ready.

**Identity**: `requirementId` (unique string per requirement type, e.g. `"bootstrap-sentinel"`, `"adapter:memory"`, `"mount:/workspace"`, `"relay:wss://relay.damus.io"`).

**Fields**:

| Field | Type | Description |
|---|---|---|
| `requirementId` | `string` | Stable identifier |
| `kind` | `"sentinel" \| "adapter" \| "mount" \| "relay"` | Category |
| `description` | `string` | Human-readable name |
| `satisfied` | `boolean` | Current evaluation result |
| `lastCheckedAt` | `ISO-8601` | Timestamp of last evaluation |
| `failureReason` | `string \| null` | Why unsatisfied; `null` when satisfied |
| `mandatory` | `boolean` | If `true`, unsatisfied blocks readiness. If `false`, unsatisfied is reported but does not block. |

**Concrete requirements evaluated by `evaluateReadiness()`**:

| `requirementId` | `kind` | `mandatory` | Check |
|---|---|---|---|
| `"bootstrap-sentinel"` | `sentinel` | yes | `/run/agentbox/bootstrap.done` is readable |
| `"adapter:<slot>"` | `adapter` | yes (one per non-`"off"` slot) | Adapter `connect()` completed without error |
| `"mount:/workspace"` | `mount` | yes | `fs.access("/workspace", W_OK)` succeeds |
| `"mount:/projects"` | `mount` | yes | `fs.access("/projects", W_OK)` succeeds |
| `"mount:/var/lib/ruvector"` | `mount` | yes | `fs.access("/var/lib/ruvector", W_OK)` succeeds |
| `"relay:<url>"` | `relay` | conditional | WebSocket connect within 3 s; mandatory only when `sovereign_mesh.enabled=true` AND `publish_agent_events=true` |

### ProbeState

Represents the current state of a probe and why.

**Identity**: `probe type + runtime instance`.

**Fields**:

- `status`: `ok | degraded | failed | unknown`
- `reason`: string — for `failed`/`degraded`, the first failing `ReadinessRequirement.failureReason`
- `lastTransitionAt`: ISO-8601 — timestamp of most recent status change
- `since`: ISO-8601 — for `status: ok`, the timestamp of the UNREADY → READY transition (same as `lastTransitionAt`)

### SecurityException

Represents a controlled expansion of the baseline hardened profile.

**Identity**: `feature + exception type`. Each exception is keyed by the feature flag that gates it (e.g. `desktop`, `gpu-rocm`, `playwright`). Two exceptions for different features are always distinct entities.

**Fields**:

| Field | Type | Required | Description |
|---|---|---|---|
| `feature` | `string` | yes | The `agentbox.toml` feature key that enables this exception (e.g. `"desktop"`, `"gpu-rocm"`, `"playwright"`) |
| `reason` | `string` | yes | Human-readable justification for the privilege expansion; included verbatim in `SecurityProfileApplied` audit event |
| `devices` | `string[]` | no | Raw device bind-mounts (`host:container` pairs); default `[]` |
| `tmpfs` | `string[]` | no | Additional tmpfs entries beyond baseline `/tmp` and `/run`; default `[]` |
| `writable_volumes` | `string[]` | no | Paths that must not be `read_only` for this feature; default `[]` |
| `cap_add` | `string[]` | no | Linux capabilities added back from `cap_drop: [ALL]`; default `[]` |
| `group_add` | `string[]` | no | Supplementary GIDs required (e.g. `["video", "988"]` for ROCm); default `[]` |
| `security_opt_override` | `string[]` | no | Replaces matching `security_opt` entries by key prefix; default `[]` |
| `runtime_override` | `string \| null` | no | Replaces service `runtime:` field (e.g. `"nvidia"`); default `null` |
| `status` | `"active" \| "orphaned" \| "suppressed"` | computed | `active` when feature enabled; `orphaned` triggers E020 error; `suppressed` when `security.audit_acknowledged = true` suppresses W021 |

**Lifecycle**:

1. **Declared** — operator adds `[security.exceptions.<feature>]` block to `agentbox.toml`.
2. **Validated** — `agentbox config validate` checks parent feature gate (E020 if orphaned); checks privilege delta (W021 if non-empty `cap_add`, `devices`, or `seccomp=unconfined`).
3. **Applied** — flake compose generator merges exception fields into affected service block when parent feature is enabled; emits `SecurityProfileApplied` event.
4. **Orphaned** — parent feature is disabled while exception block remains; validator emits E020 and blocks compose generation.

**Concrete instances per feature**:

| Feature gate | Exception key | Key privilege delta |
|---|---|---|
| `[desktop].enabled = true` | `desktop` | `tmpfs: ["/tmp/.X11-unix:mode=1777,rw", "/run/user/1000:mode=755,rw"]`; no extra caps |
| `[gpu].backend = "ollama-rocm"` | `gpu-rocm` | `devices: ["/dev/kfd", "/dev/dri"]`; `group_add: ["video","988"]`; `security_opt_override: ["seccomp=unconfined"]` |
| `[gpu].backend ∈ {"ollama-cuda","local-cuda"}` | `gpu-cuda` | `runtime_override: "nvidia"`; no extra caps (toolkit handles device access) |
| `[skills.spatial_and_3d].gaussian_splatting = true` | `gaussian-splatting` | inherits `gpu-cuda`; no additional delta (CUDA device access sufficient) |
| `[skills.browser].playwright = true` | `playwright` | `security_opt_override: ["seccomp=unconfined"]` (Chromium `--no-sandbox` path; no `SYS_ADMIN`) |
| `[toolchains].code_server = true` | `code-server` | `writable_volumes: ["/workspace/.local/share/code-server"]`; no extra caps |
| `[sovereign_mesh].telegram_mirror = true` | `telegram-mirror` | `writable_volumes: ["/workspace/.config/claude-telegram-mirror"]`; no extra caps |

### ObservabilityBinding

Represents the concrete mapping from `[observability]` config to runtime endpoints and env vars.

**Identity**: deployment instance (singleton per runtime).

**Fields**:

| Field | Type | Source | Description |
|---|---|---|---|
| `metricsPort` | `number` | `[observability].metrics_port` | Port the metrics server binds. Default: `9091`. |
| `metricsEndpoint` | `string` | derived | `"http://0.0.0.0:<metricsPort>/metrics"` |
| `otlpEndpoint` | `string \| null` | `[observability].otlp_endpoint` | OTLP gRPC/HTTP endpoint; `null` or empty string disables export. |
| `logLevel` | `string` | `[observability].log_level` | One of `debug`, `info`, `warn`, `error`. Default: `"info"`. |
| `composePortExposed` | `boolean` | derived | `true` when `metricsPort` appears in compose `ports:`. |
| `envVarInjected` | `boolean` | derived | `true` when `AGENTBOX_METRICS_PORT` is emitted by `flake.nix` `imageEnv`. |
| `metaEndpointPublishes` | `boolean` | derived | `true` when `/v1/meta` response includes `observability` field. |

**Invariant**: `composePortExposed`, `envVarInjected`, and `metaEndpointPublishes` must all be `true` when `metricsPort` is configured. Any one being `false` constitutes a `ContractDriftDetected { surface: "compose" | "env" | "meta" }` event.

**Behavior — `publishObservabilityBinding()`**:

1. Read `metricsPort` from `AGENTBOX_METRICS_PORT` env var (set by `imageEnv`).
2. Start metrics server on `metricsPort`.
3. Log `[metrics] Prometheus endpoint: http://0.0.0.0:<metricsPort>/metrics`.
4. Emit `MetricsBindingPublished { port: metricsPort, endpoint: metricsEndpoint }`.
5. The `/v1/meta` handler reads `process.env.AGENTBOX_METRICS_PORT` and `process.env.AGENTBOX_OTLP_ENDPOINT` to construct the response `observability` field at request time.

## Value Objects

| Value Object | Structure | Notes |
|---|---|---|
| `ResolvedImageRef` | `{ imageRef, source }` | Final image selection — output of `ImageReferencePolicy.resolveImageReference()` |
| `MetricsBinding` | `{ port, endpoint, exposed }` | Snapshot of `ObservabilityBinding` state for event payloads |
| `RuntimeBoundary` | `{ user, readOnlyRootFs, writablePaths[] }` | Compact summary of the security profile for audit events |

## Domain Events

| Event | Trigger | Payload |
|---|---|---|
| `ImageReferenceResolved` | Compose/runtime selects an image | `{ imageRef, source }` |
| `ReadinessChanged` | Runtime becomes ready or unready | `{ status, reason }` |
| `MetricsBindingPublished` | Metrics port and endpoint become active | `{ port, endpoint }` |
| `SecurityProfileApplied` | Container boundary is realized | `{ baseline: { user, readOnlyRootFs, capDrop, tmpfs, securityOpt }, exceptions_applied: [{ feature, reason, delta }], effectiveProfile, timestamp }` |
| `ContractDriftDetected` | Runtime behavior diverges from declared contract | `{ surface, driftKind, expected, actual, severity }` |

## ContractDriftDetected — Mechanism Specification

`ContractDriftDetected` is raised by three independent detectors. Each detector is a separate concern; they share only the event shape.

### Detector 1 — Static drift (compose-generation time)

**Trigger**: `nix build .#compose` evaluation.

**What it checks**: The generated compose file is diffed against the output that the declared `RuntimeContract` inputs would produce. Specifically:
- image reference in compose matches `ImageReferencePolicy.imageRef`
- every port in compose matches `ObservabilityBinding.metricsPort` and the management-api port
- the compose security fields (user, `read_only`, `cap_drop`, `tmpfs`, writable mounts) match `SecurityProfile`

**Fires**: Build-time assertion failure (not an in-process event). The Nix `checkPhase` of the compose derivation raises `ContractDriftDetected { surface: "compose", driftKind: "static", expected, actual, severity: "fatal" }` and writes it to stderr. The build fails; no image is produced.

**Consumer**: Nix evaluation / CI pipeline. Fatal — blocks image production.

### Detector 2 — Runtime drift (periodic reconciler)

**Trigger**: A reconciler goroutine/process in management-api that runs on startup and then every 60 seconds.

**What it checks** via `docker inspect` / `/proc` or management-api self-inspection:
- actual image ref (`docker inspect --format '{{.Config.Image}}'`) vs `ImageReferencePolicy.imageRef`
- actual bound ports vs `ObservabilityBinding.metricsPort`
- actual Linux capabilities (`/proc/self/status` or `docker inspect .HostConfig.CapDrop`) vs `SecurityProfile.droppedCaps`
- actual writable mounts vs `SecurityProfile.writableMounts`

**Fires**: In-process event `ContractDriftDetected { surface: "runtime", driftKind: "runtime", expected, actual, severity: "warning" | "fatal" }`.
- `severity: "warning"` — observable drift (e.g. image ref mismatch on a dev build); logged and surfaced on `/health` as a degraded component.
- `severity: "fatal"` — security profile regression (e.g. dropped caps absent); management-api enters `ContractViolation` state and returns HTTP 503 on `/ready` until reconciled.

**Consumer**: Management-api health aggregate and `/ready` endpoint. Warning is non-blocking; fatal blocks readiness.

### Detector 3 — Doc drift (CI-time scan)

**Trigger**: CI job on every PR touching `README.md`, `docs/**`, `agentbox.toml`, or `config/`.

**What it checks**: Regex scan of all documentation for:
- hardcoded port numbers — cross-referenced against `[observability].metrics_port` and management-api port in the manifest
- hardcoded paths (e.g. `/opt/agentbox`, `/workspace`) — verified to match canonical values in `agentbox.toml` and `entrypoint-unified.sh`
- env var names mentioned in docs — verified to exist in the compose env block or manifest schema

**Fires**: CI step exits non-zero with `ContractDriftDetected { surface: "docs", driftKind: "doc", expected, actual, severity: "fatal" }` written to the job log.

**Consumer**: CI pipeline. Fatal — blocks PR merge.

### Summary

| Detector | When it runs | Severity | Consumer | Blocking |
|---|---|---|---|---|
| Static | `nix build .#compose` | fatal | Nix/CI | Yes — no image produced |
| Runtime | management-api startup + every 60s | warning or fatal | `/ready`, `/health` | Fatal only |
| Doc | CI on PR | fatal | CI pipeline | Yes — blocks merge |

## Key Behaviors

### resolveImageReference() -> ResolvedImageRef

Chooses the effective image reference for the deployment from the operator contract.

### evaluateReadiness() -> ProbeState

Returns ready only when bootstrap is complete and required runtime dependencies are actually usable.

### publishObservabilityBinding() -> ObservabilityBinding

Makes the metrics and tracing contract explicit for both docs and runtime.

### applySecurityProfile() -> SecurityProfile

Enforces the hardened baseline and records any feature-specific exceptions.

## Integration Points

| Consuming Domain | Interface | Direction | Notes |
|---|---|---|---|
| Immutable Bootstrap (DDD-001) | bootstrap completion state | Immutable Bootstrap -> Runtime Contract | Readiness depends on bootstrap completion |
| Compose Generator | resolved image ref, ports, security fields | Runtime Contract -> Compose | Materializes the operator contract |
| Management API | probe states, observability binding | Runtime Contract -> API | Exposes liveness, readiness, health detail, and metrics |
| Helper Scripts | readiness contract, image selection | Runtime Contract -> Tooling | `agentbox.sh` must follow this domain's semantics |
| Documentation | image, probe, observability, hardening surfaces | Runtime Contract -> Docs | Prevents contract drift |

## Design Notes

This domain exists because runtime behavior is part of the product surface, not just implementation detail. Once image selection, readiness, metrics exposure, and hardening are modeled as one contract, inconsistencies become visible as domain drift instead of "small docs bugs."

