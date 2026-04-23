# DDD-007: Freshness Management Domain

**Date**: 2026-03-28
**Status**: Proposal (research document -- no implementation)
**Bounded Context**: Freshness Management
**Supersedes**: ruvector-catalog/docs/ddd/DDD-005-freshness-management-domain.md (V2), ruvector-catalog/docs/ddd/DDD-006-submodule-management-domain.md (V2)

---

## Domain Purpose

Freshness Management ensures the catalog stays current with the RuVector monorepo. It owns submodule synchronization, staleness detection, and the orchestration of downstream index regeneration after catalog rebuilds.

In V2, this was split across two domains: Freshness Management (DDD-005) and Submodule Management (DDD-006). V3 merges them into a single domain because submodule operations are tightly coupled to freshness -- there is no meaningful use case for managing the submodule outside of freshness concerns.

V3 extends this domain's responsibilities to include triggering regeneration of the Problem-Solution Index validation and the Discovery Engine's search index after a catalog rebuild. In V2, Freshness only triggered catalog rebuilds.

## Bounded Context Definition

**Boundary**: Freshness Management owns the detection of staleness, the execution of submodule sync operations, and the coordination of downstream regeneration. It does NOT own the catalog data itself (Catalog Core), the PSI validation logic (Problem-Solution Index), or the search index build logic (Discovery Engine). It triggers those operations and monitors their completion.

**Owns**: Staleness detection, submodule state tracking, sync execution, downstream regeneration orchestration, version comparison logic.

**Does not own**: Catalog schema, technology definitions, PSI curation, search index structure, proposal templates.

## Ubiquitous Language

| Term | Definition |
|------|-----------|
| **Staleness** | The condition where the catalog's data is behind the RuVector submodule's current commit. Measured in commits or calendar days. |
| **Submodule** | The git submodule pointing to the RuVector monorepo. The source of truth for catalog extraction. |
| **Sync** | The process of updating the submodule to the latest commit and triggering a catalog rebuild. |
| **Freshness Check** | A comparison between the catalog's recorded commit and the submodule's current commit. Returns a StalenessResult. |
| **Downstream Regeneration** | The cascade of rebuilds triggered by a catalog change: PSI revalidation, Discovery index rebuild, Scope Guard keyword refresh. |
| **Catalog Rebuild** | The process of re-extracting all technology, capability, algorithm, and example data from the RuVector submodule. Owned by Catalog Core but triggered by Freshness. |
| **Days Behind** | The calendar distance between the catalog's commit date and the submodule's latest commit date. Used for staleness severity. |

## Aggregates

### FreshnessState (Root Aggregate)

Tracks the current freshness status and coordinates sync operations.

```
FreshnessState
  +-- submodule: SubmoduleState
  +-- catalogCommit: string (the commit hash the catalog was last built from)
  +-- catalogBuildTimestamp: ISO8601 string
  +-- lastCheckTimestamp: ISO8601 string | null
  +-- lastSyncTimestamp: ISO8601 string | null
  +-- isStale: boolean
  +-- daysBehind: number | null
  +-- pendingRegeneration: RegenerationStatus
  |
  +-- SubmoduleState
  |     +-- status: SubmoduleStatus
  |     +-- localCommit: string | null
  |     +-- remoteCommit: string | null
  |     +-- path: string
  |     +-- url: string
  |     +-- isShallow: boolean
  |     +-- hasLocalChanges: boolean
  |
  +-- RegenerationStatus
        +-- catalogRebuilt: boolean
        +-- psiValidated: boolean
        +-- discoveryIndexRebuilt: boolean
        +-- scopeGuardRefreshed: boolean
        +-- allComplete: boolean
```

### Invariants

1. A freshness check must compare the catalog's commit against the submodule's current commit. (No checking against stale references.)
2. Sync operations must not proceed if the submodule has local changes (`hasLocalChanges: true`). (Prevents overwriting local work.)
3. After a successful catalog rebuild, downstream regeneration must be triggered for ALL dependent domains: PSI validation, Discovery index rebuild, Scope Guard keyword refresh. (No partial regeneration.)
4. The submodule status must be one of: `absent`, `present`, `stale`, `current`, `detached`, `dirty`. (Complete state machine.)
5. If the submodule is `absent`, the system must offer to initialize it rather than failing silently.
6. `daysBehind` must be null when the catalog is current (not stale).

## Entities

### SubmoduleState

The git submodule tracking the RuVector monorepo.

**Identity**: Singleton (there is exactly one submodule).

**Lifecycle**: Initialized when the catalog project is first set up. Updated during sync operations. Status changes drive freshness logic.

**State Machine**:
```
absent -> present (git submodule add)
present -> current (commits match)
present -> stale (commits diverge)
present -> detached (HEAD detached)
present -> dirty (local changes)
stale -> current (after sync)
detached -> current (after checkout + sync)
dirty -> current (after stash/commit + sync)
```

## Value Objects

| Value Object | Structure | Notes |
|-------------|-----------|-------|
| `SubmoduleStatus` | enum: `absent`, `present`, `stale`, `current`, `detached`, `dirty` | Complete state machine for the submodule. |
| `StalenessResult` | `{ isStale: boolean, catalogCommit: string, submoduleCommit: string, daysBehind: number | null, message: string }` | Result of a freshness check. |
| `RebuildResult` | `{ success: boolean, previousVersion: CatalogVersion | null, newVersion: CatalogVersion, added: TechnologyId[], removed: TechnologyId[], changed: TechnologyId[], durationMs: number }` | Result of a catalog rebuild. |
| `RegenerationStatus` | `{ catalogRebuilt: boolean, psiValidated: boolean, discoveryIndexRebuilt: boolean, scopeGuardRefreshed: boolean, allComplete: boolean }` | Tracks which downstream systems have been regenerated. |

## Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| `StalenessDetected` | Freshness check finds catalog behind submodule | `{ catalogCommit, submoduleCommit, daysBehind }` |
| `SyncStarted` | Submodule update begins | `{ previousCommit, targetCommit }` |
| `SyncCompleted` | Submodule update succeeds | `{ previousCommit, newCommit, durationMs }` |
| `SyncFailed` | Submodule update fails | `{ error, previousCommit }` |
| `CatalogRebuildTriggered` | Freshness triggers a catalog rebuild | `{ submoduleCommit }` |
| `DownstreamRegenerationStarted` | Downstream systems begin regeneration | `{ affectedDomains: string[] }` |
| `DownstreamRegenerationCompleted` | All downstream systems have regenerated | `{ durationMs, results: RegenerationStatus }` |
| `SubmoduleAbsent` | Submodule not found in project | `{ expectedPath }` |

## Key Behaviors

### checkFreshness() -> StalenessResult

Compares the catalog's recorded commit against the submodule's current commit.

**Algorithm**:
1. Read the catalog's `CatalogVersion.ruvectorCommit`.
2. Read the submodule's current HEAD commit.
3. If they match, return `{ isStale: false }`.
4. If they differ, compute `daysBehind` from commit dates and return `{ isStale: true, daysBehind }`.
5. If the submodule is absent, return a special staleness result with `submoduleCommit: null`.

### syncAndRebuild() -> RebuildResult

The full sync pipeline:

1. **Preflight**: Check submodule status. Abort if `dirty` (local changes).
2. **Sync submodule**: Run `git submodule update --remote --merge`.
3. **Trigger catalog rebuild**: Invoke `CatalogRepository` rebuild (owned by Catalog Core).
4. **Trigger downstream regeneration**:
   a. PSI: `ProblemSolutionMap.validateCoverage()` -- detect orphaned technologies and stale headers.
   b. Discovery: `SearchIndex.buildIndex()` -- rebuild the sparse search index.
   c. Scope Guard: `ScopeDefinition.refreshInScopeKeywords()` -- update positive signal keywords.
5. **Report**: Return RebuildResult with added/removed/changed technologies.

### ensureCurrent() -> SubmoduleState

Quick check that the submodule is present and current. If absent, offers initialization. If stale, reports but does not auto-sync (sync is a deliberate operation).

## Integration Points

| Consuming Domain | Interface | Direction | Notes |
|-----------------|-----------|-----------|-------|
| Catalog Core (DDD-001) | `CatalogRepository` rebuild trigger | Freshness -> Catalog | Freshness triggers rebuilds. Catalog owns rebuild logic. Customer-supplier. |
| Problem-Solution Index (DDD-002) | `ProblemSolutionMap.validateCoverage()` | Freshness -> PSI | Freshness triggers PSI revalidation after rebuild. |
| Discovery Engine (DDD-005) | `SearchIndex.buildIndex()` | Freshness -> Discovery | Freshness triggers index rebuild after rebuild. |
| Scope Guard (DDD-004) | `ScopeDefinition.refreshInScopeKeywords()` | Freshness -> Scope Guard | Freshness triggers keyword refresh after rebuild. |
| Git (external) | Shell script wrapper (`update-submodule.sh`) | Freshness -> Git | Anti-corruption layer isolates from raw git commands. |

## Anti-Corruption Layer: Git Operations

All git operations are isolated behind a shell script wrapper (`scripts/update-submodule.sh`). The domain logic never executes raw git commands. This ensures:

- Git command syntax changes do not affect domain logic.
- Error handling is centralized in the script.
- The script can be tested independently.
- Platform differences (macOS, Linux, Windows) are handled in one place.
