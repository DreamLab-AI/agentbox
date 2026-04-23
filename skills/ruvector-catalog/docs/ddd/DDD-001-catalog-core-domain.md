# DDD-001: Catalog Core Domain

**Date**: 2026-03-28
**Status**: Proposal (research document -- no implementation)
**Bounded Context**: Catalog Core
**Supersedes**: ruvector-catalog/docs/ddd/DDD-001-catalog-core-domain.md (V2)

---

## Domain Purpose

The Catalog Core is the heart of V3. It owns the authoritative registry of all technologies, capabilities, algorithms, and examples within the RuVector monorepo. Every other bounded context depends on Catalog Core as its source of truth.

V3 extends the V2 Catalog with three new fields on Technology (`useCases`, `verticals`, `plainDescription`) and richer metadata on Capability to support the Problem-Solution Index and Industry Verticals domains.

## Bounded Context Definition

**Boundary**: The Catalog Core owns all data describing WHAT RuVector contains. It does NOT own how that data is searched (Discovery Engine), how it is presented to specific audiences (Industry Verticals), or how it is matched to problems (Problem-Solution Index). Those domains consume Catalog data through its repository interface.

**Owns**: Technology definitions, capability groupings, algorithm listings, example references, crate metadata, version tracking.

**Does not own**: Search ranking, problem-to-technology mapping, audience-specific descriptions, out-of-scope definitions, proposal templates.

## Ubiquitous Language

| Term | Definition |
|------|-----------|
| **Capability** | A high-level problem domain that RuVector addresses (e.g., `vector_search`, `graph_intelligence`). There are 16 capabilities. Each contains one or more technologies. |
| **Technology** | A specific implementation within a capability (e.g., "HNSW", "FlashAttention-3"). Each technology belongs to exactly one capability and lives in exactly one crate. |
| **Algorithm** | A named computational procedure implemented within a technology (e.g., "Dijkstra", "Sinkhorn", "EWC++"). The finest grain of the catalog. |
| **Example** | A working demonstration in `ruvector/examples/` that uses one or more technologies. |
| **Crate** | A Rust package in `ruvector/crates/` containing one or more technologies. The atomic unit of compilation. |
| **Status** | Maturity level: `production` (stable, tested), `experimental` (working, API may change), `research` (proof of concept). |
| **Deployment Target** | Runtime environment: `native`, `wasm`, `nodejs`, `edge`, `embedded`, `fpga`, `postgresql`. |
| **Use Case** | A concrete scenario where a technology provides value (V3 extension). Plain-language, audience-independent. |
| **Plain Description** | A non-technical summary of what a technology does, suitable for non-developer audiences (V3 extension). |
| **Performance Metric** | A quantified characteristic: latency, throughput, memory footprint, or accuracy (V3 extension). |
| **Complexity Class** | The algorithmic complexity of a technology or algorithm: O(1), O(log n), O(n), O(n log n), O(n^2), etc. |

## Aggregates

### Catalog (Root Aggregate)

The Catalog is the single root aggregate. It enforces global invariants across all capabilities, technologies, and examples.

```
Catalog
  +-- version: CatalogVersion
  +-- capabilities: Map<CapabilityId, Capability>
  +-- examples: Map<string, CatalogExample>
  |
  +-- Capability
  |     +-- id: CapabilityId
  |     +-- description: string
  |     +-- primaryCrate: CrateRef
  |     +-- status: StatusLevel
  |     +-- docPath: string
  |     +-- keywords: string[]
  |     +-- technologies: Technology[]
  |
  +-- Technology
  |     +-- id: TechnologyId (globally unique)
  |     +-- name: string
  |     +-- crate: CrateRef
  |     +-- capabilityId: CapabilityId
  |     +-- complexity: ComplexityClass | null
  |     +-- latency: PerformanceMetric | null
  |     +-- status: StatusLevel
  |     +-- useWhen: string | null
  |     +-- features: string | null
  |     +-- deploymentTargets: DeploymentTarget[]
  |     +-- sourcePath: string
  |     +-- algorithms: Algorithm[]
  |     +-- useCases: string[]              [V3 NEW]
  |     +-- verticals: VerticalId[]          [V3 NEW]
  |     +-- plainDescription: string | null  [V3 NEW]
  |
  +-- Algorithm
  |     +-- name: string
  |     +-- technologyId: TechnologyId
  |     +-- crate: CrateRef
  |     +-- complexity: ComplexityClass | null
  |     +-- description: string
  |
  +-- CatalogExample
        +-- name: string
        +-- path: string
        +-- description: string
        +-- technologiesUsed: TechnologyId[]
```

### Invariants

1. Every Technology belongs to exactly one Capability.
2. Every Technology references exactly one Crate via `CrateRef`.
3. Every Capability must have at least one Technology.
4. `CapabilityId` is unique across the catalog.
5. `TechnologyId` is unique across the catalog.
6. Every Capability must have a `primaryCrate` that resolves to a real crate.
7. `useCases` must be non-empty for any Technology with `status: production`. (V3 invariant -- production technologies must explain when they are useful.)
8. Every `CatalogExample.technologiesUsed` entry must resolve to an existing Technology.
9. Example names are unique.

## Entities

### Technology

The primary entity. Technologies are what users ultimately care about -- they are the things that solve problems. A Technology is identified by its `TechnologyId` and is mutable only during catalog rebuilds.

**Identity**: `TechnologyId` (kebab-case string, e.g., `flash-attention-3`)

**Lifecycle**: Created during catalog extraction. Updated when the underlying crate changes. Removed when the crate is deleted or the technology is deprecated.

### Capability

A grouping entity that organizes technologies into problem domains. Capabilities are the primary navigation structure.

**Identity**: `CapabilityId` (snake_case string, e.g., `vector_search`)

**Lifecycle**: Relatively stable. New capabilities are added when RuVector expands into a new domain. Removal is rare.

### Algorithm

A child entity of Technology. Algorithms are the finest-grained catalog entry.

**Identity**: Composite of `technologyId` + `name`.

### CatalogExample

A standalone entity referencing technologies by ID. Examples demonstrate integration patterns.

**Identity**: `name` (unique string).

## Value Objects

| Value Object | Structure | Notes |
|-------------|-----------|-------|
| `CrateRef` | `{ name: string }` | Identifies a Rust crate. Immutable. Two CrateRefs with the same name are equal. |
| `DeploymentTarget` | enum: `native`, `wasm`, `nodejs`, `edge`, `embedded`, `fpga`, `postgresql` | Where a technology can run. |
| `StatusLevel` | enum: `production`, `experimental`, `research` | Maturity level. Ordered: production > experimental > research. |
| `PerformanceMetric` | `{ value: string, unit: string, percentile: string | null }` | E.g., `{ value: "61", unit: "us", percentile: "p50" }`. |
| `ComplexityClass` | `{ notation: string }` | E.g., `{ notation: "O(log n)" }`. Comparable by growth rate. |
| `CatalogVersion` | `{ inventoryVersion, ruvectorVersion, ruvectorCommit, ruvectorCommitShort, ruvectorCommitDate, generatedAt, scope: Scope }` | Full provenance of the catalog build. |
| `Scope` | `{ rustLines, sourceFiles, crates, adrs, examples, npmPackages }` | Quantifies the monorepo's size at build time. |
| `VerticalId` | string | Identifies an industry vertical (e.g., `healthcare`, `finance`). Defined in the Industry Verticals domain but referenced here. |

## Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| `TechnologyAdded` | New technology detected during catalog rebuild | `{ technologyId, capabilityId, crate, status }` |
| `TechnologyUpdated` | Existing technology changed (new algorithms, updated status, new useCases) | `{ technologyId, changedFields[] }` |
| `TechnologyRemoved` | Crate deleted or technology deprecated | `{ technologyId, reason }` |
| `CapabilityExpanded` | New technology added to a capability, or capability metadata changed | `{ capabilityId, newTechnologyCount }` |
| `CatalogRebuilt` | Full catalog rebuild completes | `{ newVersion, previousVersion, added[], removed[], changed[], durationMs }` |
| `CatalogStale` | Staleness detection finds catalog behind submodule | `{ currentCommit, catalogCommit, daysBehind }` |

## Repository Interface

```
CatalogRepository
  -- Reads --
  getCapability(id: CapabilityId): Capability | null
  getTechnology(id: TechnologyId): Technology | null
  getAlgorithm(technologyId: TechnologyId, name: string): Algorithm | null
  getExample(name: string): CatalogExample | null
  listCapabilities(): Capability[]
  listTechnologies(filter?: TechnologyFilter): Technology[]
  listTechnologiesByVertical(verticalId: VerticalId): Technology[]    [V3 NEW]
  listTechnologiesWithUseCases(): Technology[]                       [V3 NEW]
  getVersion(): CatalogVersion
  getAllTechnologyIds(): TechnologyId[]                               [V3 NEW]

  -- Writes (only during rebuild) --
  upsertCapability(capability: Capability): void
  upsertExample(example: CatalogExample): void
  setVersion(version: CatalogVersion): void
  removeTechnology(id: TechnologyId): void
```

## Integration Points

| Consuming Domain | Interface | Direction | Notes |
|-----------------|-----------|-----------|-------|
| Problem-Solution Index (DDD-002) | `CatalogRepository` read methods | Catalog -> PSI | PSI references technologies by ID. Conformist relationship. |
| Industry Verticals (DDD-003) | `CatalogRepository.listTechnologiesByVertical()` | Catalog -> Verticals | Verticals map technologies. Conformist. |
| Discovery Engine (DDD-005) | `CatalogRepository.listTechnologies()` | Catalog -> Discovery | Discovery indexes all technologies. Conformist. |
| Proposal Generation (DDD-006) | `CatalogRepository` read methods | Catalog -> Proposals | Proposals read metadata to fill templates. |
| Freshness Management (DDD-007) | `CatalogRebuilt` event | Freshness -> Catalog | Freshness triggers rebuilds; Catalog publishes completion. |
