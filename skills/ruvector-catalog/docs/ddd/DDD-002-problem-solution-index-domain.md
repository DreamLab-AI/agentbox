# DDD-002: Problem-Solution Index Domain

**Date**: 2026-03-28
**Status**: Proposal (research document -- no implementation)
**Bounded Context**: Problem-Solution Index

---

## Domain Purpose

The Problem-Solution Index (PSI) is V3's central innovation. It replaces V2's reliance on semantic embeddings as the primary query mechanism with a human-curated index of natural-language problem statements mapped to RuVector technologies.

Each entry in the PSI is a **section header** -- a question phrased as a user would ask it (e.g., "How do I make vector search faster?"). Each section header has a set of synonyms, a ranked list of technologies that address the problem, and a primary crate recommendation.

The PSI provides deterministic, explainable matching. When a user asks "How do I prevent model drift?", the PSI matches that directly to a curated section rather than relying on embedding similarity scores. This makes the system predictable, auditable, and improvable by human editors.

## Bounded Context Definition

**Boundary**: The PSI owns the mapping between human-language problems and RuVector technologies. It does NOT own the technology definitions themselves (that is Catalog Core) or the search ranking algorithm (that is Discovery Engine). It owns the curated problem headers, their synonyms, and the editorial ranking of technologies per section.

**Owns**: Section headers, synonym sets, technology rankings within sections, orphan detection logic.

**Does not own**: Technology metadata, embedding vectors, search scoring, proposal generation.

## Ubiquitous Language

| Term | Definition |
|------|-----------|
| **Section Header** | A natural-language problem statement that users might ask. Written as a question. E.g., "How do I make vector search faster?" or "How do I detect anomalies in streaming data?" |
| **Problem Section** | The full entry: a section header + its synonym set + its ranked technology list + its primary crate. The core entity of this domain. |
| **Synonym Set** | Alternative phrasings for the same problem. Used for fuzzy matching. E.g., for "How do I make vector search faster?" the synonyms might include "speed up similarity search", "optimize nearest neighbor", "reduce search latency". |
| **Technology Ranking** | An ordered list of TechnologyIds within a section, from most relevant to least. The first entry is the recommended default. |
| **Primary Crate** | The single crate most associated with this problem section. Used for quick "start here" recommendations. |
| **Orphaned Technology** | A production-status technology that does not appear in ANY problem section. Indicates a gap in the PSI's coverage. |
| **Stale Header** | A section header that references a technology that has been removed from the Catalog. Indicates the PSI needs updating. |
| **Query Match** | The result of running a user query against the PSI. Returns zero or more ProblemSections ranked by header overlap. |

## Aggregates

### ProblemSolutionMap (Root Aggregate)

The ProblemSolutionMap is the collection of all problem sections. It enforces global invariants like synonym uniqueness and technology coverage.

```
ProblemSolutionMap
  +-- sections: Map<SectionId, ProblemSection>
  +-- synonymIndex: Map<string, SectionId>     (reverse lookup: synonym -> section)
  +-- coverageReport: CoverageReport           (computed: which technologies are/aren't covered)
  |
  +-- ProblemSection
        +-- id: SectionId (generated, stable)
        +-- header: SectionHeader
        +-- synonyms: SynonymSet
        +-- technologies: TechnologyRanking
        +-- primaryCrate: CrateRef
        +-- capabilityId: CapabilityId          (the primary capability this section maps to)
        +-- lastUpdated: ISO8601 date string
```

### Invariants

1. Every production-status technology in the Catalog must appear in at least one ProblemSection. (No orphaned production technologies.)
2. No ProblemSection may have zero technologies. (Empty sections are meaningless.)
3. Synonyms must not overlap between sections. If "anomaly detection" is a synonym in Section A, it cannot also be a synonym in Section B. (Overlapping synonyms create ambiguous routing.)
4. Every TechnologyId referenced in a ProblemSection must resolve to an existing Technology in the Catalog. (No dangling references.)
5. Every ProblemSection must have a primaryCrate that matches one of its listed technologies' crates.
6. Section headers must be unique. No two sections may have the same header text.

## Entities

### ProblemSection

The primary entity. Each ProblemSection represents one human-curated problem-to-technology mapping.

**Identity**: `SectionId` (generated stable identifier, e.g., `ps-vector-search-speed`).

**Lifecycle**: Created by a human curator when a new problem pattern is identified. Updated when technologies are added/removed or synonyms are refined. Removed when the problem is no longer relevant (rare).

**Behavior**:
- `matchesQuery(query: string): boolean` -- returns true if the query overlaps with the header or any synonym.
- `rankScore(query: string): number` -- returns a relevance score [0.0, 1.0] based on token overlap with header and synonyms.

## Value Objects

| Value Object | Structure | Notes |
|-------------|-----------|-------|
| `SectionHeader` | `{ text: string }` | The natural-language problem statement. Must be a question or imperative statement. Immutable once created (renaming creates a new section). |
| `SynonymSet` | `{ terms: string[] }` | Alternative phrasings. Order does not matter. Each term is lowercase, trimmed. |
| `TechnologyRanking` | `{ ranked: Array<{ technologyId: TechnologyId, rank: number }> }` | Ordered list. `rank` is 1-indexed. Lower rank = more relevant. |
| `SectionId` | string | Stable identifier for a ProblemSection. Format: `ps-<kebab-case-summary>`. |
| `CoverageReport` | `{ coveredTechIds: TechnologyId[], orphanedTechIds: TechnologyId[], staleHeaders: SectionId[] }` | Computed from the current state of the PSI and Catalog. |

## Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| `SectionCreated` | Curator adds a new problem section | `{ sectionId, header, synonyms, technologies[], primaryCrate }` |
| `SectionUpdated` | Curator modifies synonyms, ranking, or technologies | `{ sectionId, changedFields[] }` |
| `SectionRemoved` | Curator removes an obsolete section | `{ sectionId, reason }` |
| `OrphanedTechnologyDetected` | Coverage check finds a production technology not in any section | `{ technologyId, capabilityId, status }` |
| `StaleHeaderDetected` | Validation finds a section referencing a removed technology | `{ sectionId, removedTechnologyId }` |
| `SynonymConflictDetected` | Validation finds the same synonym in multiple sections | `{ synonym, conflictingSectionIds[] }` |

## Key Behaviors

### matchQuery(query: string) -> ProblemSection[]

The primary query method. Returns matching sections ranked by relevance.

**Algorithm**:
1. Tokenize the query into lowercase terms.
2. For each ProblemSection, compute overlap score:
   - Header token overlap (weighted x3)
   - Synonym token overlap (weighted x2)
   - Keyword/capability alignment (weighted x1)
3. Filter sections with score below configurable threshold (default: 0.1).
4. Return sorted by score descending.

This is intentionally simple -- it is a curated index, not a search engine. The quality comes from the curation, not the algorithm.

### validateCoverage(catalog: CatalogRepository) -> CoverageReport

Cross-references all production technologies in the Catalog against all ProblemSections. Returns:
- `coveredTechIds`: technologies that appear in at least one section
- `orphanedTechIds`: production technologies missing from all sections
- `staleHeaders`: sections referencing technologies no longer in the Catalog

## Integration Points

| Consuming Domain | Interface | Direction | Notes |
|-----------------|-----------|-----------|-------|
| Catalog Core (DDD-001) | `CatalogRepository.getAllTechnologyIds()` | Catalog -> PSI | PSI reads all tech IDs for coverage validation. Conformist. |
| Discovery Engine (DDD-005) | `ProblemSolutionMap.getSynonymSets()` | PSI -> Discovery | Discovery uses synonyms for query expansion. Customer-supplier. |
| Scope Guard (DDD-004) | `ProblemSolutionMap.matchQuery()` | PSI -> Scope Guard | Scope Guard checks PSI match count to distinguish "out of scope" from "poorly worded". |
| Proposal Generation (DDD-006) | `ProblemSection[]` result | PSI -> Proposals | Proposals consume matched sections as primary input for RVBP generation. |
| Freshness Management (DDD-007) | `CatalogRebuilt` event | Freshness -> PSI | After catalog rebuild, PSI runs `validateCoverage` to detect orphans and stale headers. |
