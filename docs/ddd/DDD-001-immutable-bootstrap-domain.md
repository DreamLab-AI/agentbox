# DDD-001: Immutable Bootstrap Domain

**Date**: 2026-04-24
**Status**: Proposal
**Bounded Context**: Immutable Bootstrap

---

## Domain Purpose

The Immutable Bootstrap domain ensures that agentbox startup realizes a pre-built runtime rather than assembling one. Its job is to answer one question truthfully: "Does this image already contain everything required to boot the capabilities declared by the manifest?"

## Bounded Context Definition

**Boundary**: This domain owns startup-time artifact validation, bootstrap policy, and the legal mutation surface during boot.

**Owns**: Bootstrap policy, packaged artifact inventory, startup validation outcomes, bootstrap completion state.

**Does not own**: Image build mechanics themselves, operator-facing compose selection, steady-state health aggregation, metrics server binding.

## Ubiquitous Language

| Term | Definition |
|---|---|
| **Runtime Closure** | The complete set of executables, libraries, assets, and packaged dependencies required to boot the selected capabilities. |
| **Bootstrap Policy** | The explicit rules that define what startup is allowed to mutate or execute. |
| **Artifact Probe** | A deterministic check proving that a required packaged artifact exists and is runnable. |
| **Bootstrap Completion** | The moment startup has finished legal initialization and the runtime is eligible for readiness evaluation. |
| **Illegal Mutation** | Any startup action that resolves software dependencies, downloads runtime artifacts, or mutates `/opt/agentbox`. |

## Aggregates

### RuntimeClosure (Root Aggregate)

The central aggregate describing whether the built image is bootable for the selected manifest.

```
RuntimeClosure
  +-- capabilities: CapabilityArtifact[]
  +-- bootstrapPolicy: BootstrapPolicy
  +-- completionState: BootstrapCompletionState
  |
  +-- CapabilityArtifact
  |     +-- capabilityId: string
  |     +-- entrypoint: string
  |     +-- requiredAssets: string[]
  |     +-- probe: ArtifactProbe
  |     +-- requiredForReadiness: boolean
  |
  +-- BootstrapPolicy
  |     +-- allowedWrites: string[]
  |     +-- forbiddenOperations: string[]
  |     +-- immutableRoots: string[]
  |
  +-- BootstrapCompletionState
        +-- phase: "not_started" | "validating" | "completed" | "failed"
        +-- failedCapabilityId: string | null
        +-- reason: string | null
```

### Invariants

1. Every readiness-critical capability must have an Artifact Probe.
2. `/opt/agentbox` is always an immutable root.
3. A Runtime Closure cannot be `completed` if any required Artifact Probe fails.
4. Bootstrap Policy must forbid dependency-resolution operations.

## Entities

### CapabilityArtifact

Represents one runtime capability that must already exist in the image.

**Identity**: `capabilityId`.

**Lifecycle**: Materialized from the manifest and packaged image contents; validated at startup; fails closed if missing.

### ArtifactProbe

Represents how the system proves that a packaged artifact exists.

**Identity**: `capabilityId + probe type`.

**Examples**:

- executable exists on disk
- entrypoint launches with `--version` or equivalent
- required asset path exists

## Value Objects

| Value Object | Structure | Notes |
|---|---|---|
| `BootstrapOutcome` | `{ status, failedCapabilityId, reason }` | Immutable summary of bootstrap result |
| `MutationScope` | `{ writableRoots[], immutableRoots[] }` | Encodes the allowed startup write surface |
| `ProbeResult` | `{ success: boolean, detail: string }` | Result of one artifact validation |

## Domain Events

| Event | Trigger | Payload |
|---|---|---|
| `BootstrapStarted` | Startup begins validation | `{ timestamp }` |
| `CapabilityValidated` | One required artifact probe passes | `{ capabilityId }` |
| `MissingArtifactDetected` | A required probe fails | `{ capabilityId, reason }` |
| `BootstrapCompleted` | All required probes pass and legal setup finishes | `{ timestamp }` |
| `BootstrapFailed` | Startup cannot continue | `{ failedCapabilityId, reason }` |

## Key Behaviors

### validateRuntimeClosure() -> BootstrapOutcome

Checks every readiness-critical Capability Artifact and fails on the first required missing artifact.

### enforceBootstrapPolicy(operation) -> allowed | denied

Guards startup operations against the Bootstrap Policy. Any dependency-resolution action is denied.

### completeBootstrap() -> BootstrapCompletionState

Transitions the aggregate to `completed` only after all required probes succeed and legal initialization work finishes.

## Integration Points

| Consuming Domain | Interface | Direction | Notes |
|---|---|---|---|
| Manifest Validation | enabled capabilities | Validation -> Immutable Bootstrap | Determines what must exist in the Runtime Closure |
| Nix Build | packaged runtime artifacts | Build -> Immutable Bootstrap | Supplies the closure that bootstrap validates |
| Runtime Contract Domain (DDD-002) | bootstrap completion state | Immutable Bootstrap -> Runtime Contract | Readiness depends on bootstrap completion |
| Observability | bootstrap events/logs | Immutable Bootstrap -> Observability | Emits startup evidence |

## Design Notes

This domain exists because "startup script" is too vague a concept. The real boundary is whether boot **realizes** a built runtime or **constructs** one. Once startup is modeled as a domain with invariants, mutable package installation becomes a domain violation rather than an implementation detail.

