# DDD-007: Runtime Integrity Domain

**Date**: 2026-05-22
**Status**: Accepted
**Bounded Context**: Runtime Integrity
**Cross-references**: PRD-010 (product requirements), ADR-022 (decision record), DDD-002 (runtime contract — supplies SecurityProfile consumed by WritablePathPolicy), ADR-007 (security profile), ADR-005 (pluggable adapters)

---

## TL;DR for newcomers
*Skip if you already know the runtime-integrity bounded context.*

This DDD captures the Runtime Integrity bounded context: the part of the system that owns whether features that claim to work actually produce output in a read-only container. The pain point is that agentbox grew features (Code-as-Harness, consultants, payment gates, swarm orchestration) faster than the mount whitelist, middleware wiring, and error-handling discipline kept pace. The result is a container where the operator sees "healthy" while multiple subsystems silently produce nothing. The shape of the answer is a domain with explicit aggregates (WritablePathPolicy, MiddlewareWiringContract, ErrorHandlingPolicy, ConfigurationPreservationPolicy), a ubiquitous language for silent failure vs. fail-fast vs. warn-and-continue, and invariants that prevent future drift. You get the glossary, aggregates, invariants, domain events, and the anti-corruption layer that keeps this domain aligned with DDD-002 (runtime contract).

**If you remember only one thing:** this domain owns the truth about whether declared features actually function at runtime — mounts exist, middleware is wired, errors are visible, config survives round-trips.

For the deep version, keep reading.

## Domain Purpose

The Runtime Integrity domain ensures that every feature declared in the manifest (`agentbox.toml`) and advertised in the tool registry actually functions at runtime. It owns the invariants that prevent silent degradation: writable paths are mounted, middleware is registered, authentication fails closed, orchestration state persists, and configuration round-trips are lossless.

## Bounded Context Definition

**Boundary**: This domain owns the runtime integrity contract — the gap between "feature is enabled" and "feature actually works."

**Owns**: Writable path policy, middleware wiring verification, error handling classification, configuration preservation, tool registry integrity.

**Does not own**: Feature business logic (owned by respective domains), build-time packaging (DDD-001), operator-facing runtime contract (DDD-002), adapter dispatch (ADR-005).

**Consumes from DDD-002**: `SecurityProfile.readOnlyRootFs`, `SecurityProfile.writablePaths`, `ProbeContract.readinessRequirements`.

**Publishes to DDD-002**: `IntegrityDegradation` events that should influence readiness state.

## Ubiquitous Language

| Term | Definition |
|---|---|
| **Silent Failure** | A runtime error that is suppressed (via `\|\| true`, empty catch, `2>/dev/null`) such that the operator cannot detect the failure without inspecting individual feature output. |
| **Fail-Fast** | Error handling where a prerequisite failure prevents the dependent feature from starting and is visible in container logs or health probes. |
| **Warn-and-Continue** | Error handling where a non-prerequisite failure is logged with a warning and a degraded status flag, but the feature continues with reduced capability. |
| **Mount Gap** | A filesystem path that runtime code writes to but that is not covered by any named volume, tmpfs mount, or security exception volume in the generated compose file. |
| **Dead Middleware** | A middleware function that is exported from its module but never imported or registered on any route or hook, making its enforcement non-operational. |
| **Ghost Tool** | An MCP tool that is defined in the tool registry schema (visible to clients via introspection) but has no handler implementation, causing silent failure when invoked. |
| **Configuration Round-Trip** | The cycle of reading `agentbox.toml`, modifying it (via TUI wizard or manual edit), and writing it back. A lossless round-trip preserves all sections; a lossy round-trip silently drops sections the writer does not know about. |
| **Exception Whitelist Drift** | The state where a security exception is declared in the manifest but is silently filtered out by a hardcoded name list in the Nix evaluator, preventing its volumes and capabilities from being generated. |
| **Dual-Write** | The pattern of writing state to both a volatile in-process store (for low-latency reads) and a durable external store (for cross-session persistence). |

## Aggregates

### WritablePathPolicy (Root Aggregate)

Owns the invariant that every runtime write path is covered by a mount.

```
WritablePathPolicy
  +-- declaredMounts: MountEntry[]
  |     +-- MountEntry
  |           +-- source: string        // volume name or host path
  |           +-- target: string        // container path
  |           +-- type: "volume" | "tmpfs" | "bind"
  |           +-- writable: boolean
  |
  +-- runtimeWritePaths: WritePathEntry[]
  |     +-- WritePathEntry
  |           +-- path: string          // absolute container path
  |           +-- sourceFile: string    // code file that writes here
  |           +-- sourceLine: number
  |           +-- operation: "mkdir" | "write" | "append" | "chmod"
  |           +-- feature: string       // which manifest feature requires this
  |
  +-- exceptionVolumes: ExceptionVolumeEntry[]
  |     +-- ExceptionVolumeEntry
  |           +-- exceptionName: string
  |           +-- volumes: string[]
  |           +-- featureGate: string
  |           +-- inWhitelist: boolean
  |
  +-- gaps: MountGap[]
        +-- MountGap
              +-- path: string
              +-- feature: string
              +-- severity: "critical" | "high" | "medium" | "low"
              +-- impact: string
```

**Invariants:**
- I01: Every entry in `runtimeWritePaths` must resolve to a writable mount in `declaredMounts` or `exceptionVolumes`. Violations produce `MountGap` entries.
- I02: Every entry in `exceptionVolumes` where `featureGate` is enabled must have `inWhitelist = true`. Violations indicate exception whitelist drift.
- I03: No `MountGap` with severity "critical" may exist when the container reports readiness.

### MiddlewareWiringContract

Owns the invariant that every exported middleware is either registered or explicitly marked as deferred.

```
MiddlewareWiringContract
  +-- exportedMiddleware: MiddlewareExport[]
  |     +-- MiddlewareExport
  |           +-- file: string
  |           +-- exportName: string
  |           +-- purpose: string
  |           +-- registeredOn: RouteBinding[]   // empty = dead middleware
  |           +-- status: "wired" | "dead" | "deferred"
  |
  +-- routeBindings: RouteBinding[]
  |     +-- RouteBinding
  |           +-- routeFile: string
  |           +-- method: string
  |           +-- path: string
  |           +-- middlewareChain: string[]   // ordered list of middleware names
  |
  +-- schemaFieldDependencies: SchemaFieldDep[]
        +-- SchemaFieldDep
              +-- routeFile: string
              +-- fieldName: string          // e.g., "cost_sats"
              +-- setBy: string | null       // middleware that should set it; null = orphan
              +-- readBy: string             // handler code that reads it
```

**Invariants:**
- I04: No `MiddlewareExport` may have `status = "dead"`. It must be either `"wired"` (has RouteBindings) or `"deferred"` (explicitly documented with a target milestone).
- I05: Every `SchemaFieldDep` must have a non-null `setBy` that is wired. Orphan fields indicate phantom middleware.
- I06: Authentication middleware must fail closed — if the auth secret/token is absent, the response must be 500 or 401, never silent passthrough.

### ErrorHandlingPolicy

Owns the classification of error suppression patterns.

```
ErrorHandlingPolicy
  +-- patterns: ErrorPattern[]
  |     +-- ErrorPattern
  |           +-- file: string
  |           +-- line: number
  |           +-- suppressionType: "or-true" | "dev-null" | "empty-catch" | "except-pass"
  |           +-- operation: string         // what fails silently
  |           +-- tier: "fail-fast" | "warn-and-continue" | "suppress"
  |           +-- currentBehaviour: string  // what happens now
  |           +-- requiredBehaviour: string // what should happen
  |
  +-- tierPolicy: TierPolicy
        +-- failFast: string[]     // operation categories that must propagate
        +-- warnContinue: string[] // operation categories that log + degrade flag
        +-- suppress: string[]     // operation categories that may be silent
```

**Invariants:**
- I07: Operations classified as `fail-fast` must not use `|| true`, `2>/dev/null`, or empty catch blocks. Violations must propagate or set container unhealthy.
- I08: Operations classified as `warn-and-continue` must emit a log line at WARN level with the error code and set a degraded status flag.
- I09: The tier classification of an operation must match its `TierPolicy` category. Reclassification requires an ADR amendment.

### ToolRegistryIntegrity

Owns the invariant that advertised MCP tools have handlers.

```
ToolRegistryIntegrity
  +-- registeredTools: ToolEntry[]
  |     +-- ToolEntry
  |           +-- name: string
  |           +-- schema: object         // JSON Schema for tool input
  |           +-- hasHandler: boolean
  |           +-- handlerFile: string | null
  |           +-- status: "implemented" | "ghost" | "deferred"
  |
  +-- ghostTools: string[]   // tool names with no handler
```

**Invariants:**
- I10: No tool may be advertised in the registry with `status = "ghost"`. It must be either `"implemented"` (handler exists and is reachable) or `"deferred"` (removed from the registry until implemented).
- I11: The count of `registeredTools` where `hasHandler = true` must equal the count of case branches in `processTool()`.

### ConfigurationPreservationPolicy

Owns the invariant that configuration round-trips are lossless.

```
ConfigurationPreservationPolicy
  +-- knownSections: string[]      // TOML sections the wizard writes
  +-- preservedSections: string[]  // TOML sections passed through unchanged
  +-- roundTripLoss: string[]      // sections lost on wizard write (must be empty)
  |
  +-- exceptionFilter: ExceptionFilter
        +-- strategy: "hardcoded-whitelist" | "dynamic"
        +-- knownNames: string[]
        +-- validatorWarningCode: string   // e.g., "W060"
```

**Invariants:**
- I12: `roundTripLoss` must be empty. Every TOML section present before a wizard run must be present after.
- I13: `exceptionFilter.strategy` must be `"dynamic"`. Hardcoded whitelists are prohibited because they create silent drift.
- I14: Every exception name that is not in the validator's known set must emit the validator warning.

## Domain Events

| Event | Emitted when | Consumer |
|---|---|---|
| `MountGapDetected` | A runtime write path has no covering mount | DDD-002 readiness evaluator; operator alert |
| `DeadMiddlewareDetected` | An exported middleware has zero importers | CI lint; build-time validation |
| `GhostToolDetected` | A registered tool has no handler | MCP server startup; tool registry pruning |
| `ConfigRoundTripLoss` | Wizard write dropped a TOML section | TUI wizard; operator warning |
| `ExceptionWhitelistDrift` | A manifest exception is filtered by the Nix evaluator | `nix build` validation; operator warning |
| `FailOpenAuthDetected` | An auth check is conditional on secret presence | Security scan; CI lint |
| `SilentFailurePromoted` | A `fail-fast` operation was found with suppression | Entrypoint audit; readiness probe |
| `IntegrityDegradation` | Any I01-I14 invariant is violated at runtime | DDD-002 `ProbeContract.readinessRequirements` |

## Anti-Corruption Layer

### Relationship to DDD-002 (Runtime Contract)

DDD-002 owns the operator-facing contract (image, probes, observability, security profile). DDD-007 owns the *internal* truth about whether features behind that contract actually function. The boundary:

- DDD-002's `SecurityProfile.writablePaths` is an input to DDD-007's `WritablePathPolicy.declaredMounts`
- DDD-007's `IntegrityDegradation` event feeds into DDD-002's `ProbeContract.readinessRequirements`
- DDD-007 never modifies DDD-002 aggregates directly; it publishes events that DDD-002 consumes

### Relationship to ADR-005 (Pluggable Adapters)

Adapter dispatch goes through the five adapter slots. DDD-007 does not own adapter business logic — it owns the fact that the middleware chain wrapping adapter dispatch (observability → privacy → encoder) is complete and that payment gates are registered before resource-consuming adapter calls.

### Relationship to Feature Domains (DDD-003 through DDD-006)

Each feature domain assumes its infrastructure works (mounts exist, state persists, tools are callable). DDD-007 is the domain that validates those assumptions. It does not duplicate feature logic — it verifies the wiring.

## Validated Finding Inventory

The audit that motivated this domain model confirmed:

| # | Finding | Aggregate | Invariant violated |
|---|---------|-----------|-------------------|
| 1 | pip install targets Nix store | WritablePathPolicy | I01 |
| 2 | Payment/cost gate unwired | MiddlewareWiringContract | I04, I05 |
| 3 | Webhook HMAC fail-open | MiddlewareWiringContract | I06 |
| 4 | NIP-17 DMs stored encrypted | (out of scope — DDD-003 feature gap) | — |
| 5 | Admin stubs return 501 | (deferred — documented) | — |
| 6 | TUI wizard wipes TOML | ConfigurationPreservationPolicy | I12 |
| 7 | Code-harness EROFS | WritablePathPolicy | I01, I03 |
| 8 | Consultant volume filtered | WritablePathPolicy | I02 |
| 9 | Swarm state volatile | (state durability — cross-cutting) | — |
| 10 | TCP proxy ENOENT | (build-time path — DDD-001) | — |
| 11 | 53 ghost MCP tools | ToolRegistryIntegrity | I10, I11 |
| 12 | 207 silent error suppressions | ErrorHandlingPolicy | I07, I08 |
| 13 | `/var/lib/agentbox/events` unmounted | WritablePathPolicy | I01 |
| 14 | `/app/mcp-logs` unmounted | WritablePathPolicy | I01 |
