# DDD-002: Runtime Contract Domain

**Date**: 2026-04-24
**Status**: Proposal
**Bounded Context**: Runtime Contract

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
  |     +-- imageRef: string
  |
  +-- ProbeContract
  |     +-- liveness: ProbeState
  |     +-- readiness: ProbeState
  |     +-- detailEndpoint: string
  |
  +-- ObservabilityBinding
  |     +-- metricsPort: number | null
  |     +-- metricsEndpoint: string
  |     +-- otlpEndpoint: string | null
  |     +-- logLevel: string
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

### ProbeState

Represents the current state of a probe and why.

**Identity**: `probe type + runtime instance`.

**Fields**:

- `status`: `ok | degraded | failed | unknown`
- `reason`
- `lastTransitionAt`

### SecurityException

Represents a controlled expansion of the baseline hardened profile.

**Identity**: `feature mode + exception type`.

**Examples**:

- GPU device access
- desktop/VNC writable display paths

## Value Objects

| Value Object | Structure | Notes |
|---|---|---|
| `ResolvedImageRef` | `{ imageRef, source }` | Final image selection |
| `MetricsBinding` | `{ port, endpoint, exposed }` | Direct metrics exposure state |
| `RuntimeBoundary` | `{ user, readOnlyRootFs, writablePaths[] }` | Compact summary of the security profile |

## Domain Events

| Event | Trigger | Payload |
|---|---|---|
| `ImageReferenceResolved` | Compose/runtime selects an image | `{ imageRef, source }` |
| `ReadinessChanged` | Runtime becomes ready or unready | `{ status, reason }` |
| `MetricsBindingPublished` | Metrics port and endpoint become active | `{ port, endpoint }` |
| `SecurityProfileApplied` | Container boundary is realized | `{ user, readOnlyRootFs, exceptions[] }` |
| `ContractDriftDetected` | Runtime behavior diverges from declared contract | `{ surface, expected, actual }` |

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

