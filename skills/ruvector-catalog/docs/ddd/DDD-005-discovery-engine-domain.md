# DDD-005: Discovery Engine Domain (CLI Secondary Interface)

**Date**: 2026-03-28
**Status**: Proposal (research document -- no implementation)
**Bounded Context**: Discovery Engine
**Supersedes**: ruvector-catalog/docs/ddd/DDD-002-technology-discovery-domain.md (V2)

---

## Domain Purpose

The Discovery Engine is the programmatic search path for V3. In V2, Discovery was the core domain -- the primary way to match queries to technologies. In V3, the Problem-Solution Index takes that role for the conversational (SKILL.md) path. Discovery is demoted to a supporting domain that serves the CLI interface (`bun ruvector-catalog/src/cli.ts search "..."`) and provides the embedding/ranking infrastructure that other domains can leverage.

The Discovery Engine remains important for:
- CLI users who prefer programmatic access
- Batch operations (searching for many queries at once)
- Fuzzy matching when the PSI has no curated section
- Providing ranking infrastructure to Swarm Orchestration agents

## Bounded Context Definition

**Boundary**: Discovery owns the search index, query processing pipeline, TF-IDF scoring, query expansion, and result ranking. It does NOT own the technology data (Catalog Core), the curated problem mappings (PSI), or the scope definitions (Scope Guard).

**Owns**: Search index, sparse vectors, field weights, intent classification, query expansion (using PSI synonyms), reranking, score thresholds.

**Does not own**: Technology metadata, problem-section curation, scope exclusions, proposal templates.

## Ubiquitous Language

| Term | Definition |
|------|-----------|
| **Search Index** | The queryable index built from the Catalog. Contains one IndexedDocument per technology and per example. Rebuilt whenever the Catalog changes. |
| **Indexed Document** | A technology or example with its precomputed sparse vector representation. The unit of search. |
| **Sparse Vector** | A full-vocabulary TF-IDF vector representation of a document's text fields. Unlike V2's dense 384-dimensional embeddings, V3 uses sparse vectors for transparency and determinism. |
| **Field Weights** | Multipliers that control the relative importance of different text fields during scoring. E.g., `useWhen` x3, `keywords` x2, `description` x1, `name` x1. |
| **Score Threshold** | The minimum score a result must achieve to be returned. Prevents low-quality matches. Configurable. |
| **Domain Filter** | A predicate that restricts results to specific capabilities, deployment targets, or statuses. |
| **Intent Classifier** | A lightweight classifier that routes queries into one of three paths: problem-section lookup, technology-name lookup, or out-of-scope. |
| **Query Expander** | A component that enriches a query with synonyms from the PSI before scoring. |
| **Reranker** | A post-retrieval component that boosts results for primaryCrate alignment, capability relevance, and production status. |
| **Ranked Match** | A search result: a technology with its score, explanation, and capability context. |

## Aggregates

### SearchIndex (Root Aggregate)

The SearchIndex is the queryable data structure. It is rebuilt from scratch whenever the Catalog changes (no incremental updates -- the catalog is small enough that full rebuilds are fast).

```
SearchIndex
  +-- documents: Map<string, IndexedDocument>
  +-- vocabulary: Set<string>           (all unique terms across all documents)
  +-- idfScores: Map<string, number>    (inverse document frequency per term)
  +-- fieldWeights: FieldWeights
  +-- scoreThreshold: number
  +-- buildTimestamp: ISO8601 string
  +-- documentCount: number
  |
  +-- IndexedDocument
  |     +-- id: string (TechnologyId or example name)
  |     +-- type: "technology" | "example"
  |     +-- sparseVector: SparseVector
  |     +-- technologyId: TechnologyId | null
  |     +-- capabilityId: CapabilityId | null
  |     +-- fields: Map<string, string>  (original text fields used to build the vector)
  |
  +-- SearchResult
        +-- query: SearchQuery
        +-- matches: RankedMatch[]
        +-- mode: "sparse" | "keyword" | "hybrid"
        +-- latencyMs: number
        +-- totalCandidates: number
```

### Invariants

1. All technologies in the Catalog must be indexed. (No technology may be unsearchable.)
2. All examples in the Catalog must be indexed. (Examples are first-class search targets.)
3. The score threshold must be configurable (default: 0.15).
4. No result below the score threshold is returned to consumers.
5. The index must be rebuilt after every `CatalogRebuilt` event. (Stale index = stale results.)
6. Field weights must be non-negative. At least one field weight must be > 0.

## Entities

### IndexedDocument

A searchable representation of a technology or example.

**Identity**: `id` (TechnologyId for technologies, name for examples).

**Lifecycle**: Created when the SearchIndex is built. Destroyed when the index is rebuilt. Never updated in place.

### SearchResult

The output of a query. Contains ranked matches with scores and explanations.

**Identity**: Ephemeral. Not persisted. Identified by query + timestamp.

## Value Objects

| Value Object | Structure | Notes |
|-------------|-----------|-------|
| `SparseVector` | `Map<string, number>` | Term -> TF-IDF weight. Sparse: most entries are zero (not stored). |
| `FieldWeights` | `{ useWhen: number, keywords: number, description: number, name: number, features: number, useCases: number, plainDescription: number }` | Default: `useWhen: 3, keywords: 2, useCases: 2, description: 1, name: 1, features: 1, plainDescription: 1`. |
| `ScoreThreshold` | `{ value: number }` | Float [0.0, 1.0]. Default: 0.15. |
| `DomainFilter` | `{ capability?: CapabilityId, status?: StatusLevel, deploymentTarget?: DeploymentTarget, vertical?: VerticalId }` | Optional predicates to narrow results. |
| `SearchQuery` | `{ rawText: string, expandedTerms: string[], filters: DomainFilter | null, limit: number }` | The processed query after expansion. |
| `RankedMatch` | `{ documentId: string, score: number, technology: Technology, capability: Capability, explanation: string }` | A single search result with its score and context. |

## Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| `IndexBuilt` | SearchIndex built or rebuilt | `{ documentCount, vocabulary size, buildDurationMs, timestamp }` |
| `IndexStale` | Catalog has been rebuilt but index has not | `{ catalogVersion, indexBuildTimestamp }` |
| `QueryExecuted` | A search query completes | `{ query, matchCount, topScore, latencyMs }` |
| `OutOfScopeDetected` | Intent classifier routes query to out-of-scope | `{ query, confidence }` |

## Services

### IntentClassifier

Routes a query into one of three paths before search begins:

1. **problem-section**: Query looks like a problem statement ("How do I...?", "I need to..."). Route to PSI first, fall back to sparse search.
2. **technology-lookup**: Query looks like a technology name ("HNSW", "FlashAttention"). Route to direct Catalog lookup.
3. **out-of-scope**: Query matches Scope Guard negative signals. Short-circuit with scope verdict.

### QueryExpander

Enriches the query with synonyms from the Problem-Solution Index:

1. Tokenize the query.
2. For each token, check PSI synonym sets.
3. If a synonym match is found, add all synonyms from that set to the expanded query (with reduced weight).
4. Return the expanded query for scoring.

### Reranker

Post-retrieval boost applied to raw TF-IDF scores:

1. **primaryCrate boost** (+0.1): If the result's crate is the primaryCrate for its capability.
2. **Capability alignment boost** (+0.05): If the result's capability matches the query's detected intent.
3. **Production status boost** (+0.05): If the result has `status: production`.
4. **PSI presence boost** (+0.1): If the result appears in a PSI section that was matched.

## Key Behaviors

### search(query: string, filters?: DomainFilter, limit?: number) -> RankedMatch[]

The primary search pipeline:

1. **Intent classification**: Route query through IntentClassifier.
2. **Query expansion**: Enrich query via QueryExpander (PSI synonyms).
3. **Sparse TF-IDF scoring**: Compute cosine similarity between expanded query vector and all IndexedDocument vectors.
4. **Filtering**: Apply DomainFilter predicates.
5. **Threshold**: Remove results below ScoreThreshold.
6. **Reranking**: Apply Reranker boosts.
7. **Limit**: Return top-N results.

### buildIndex(catalog: CatalogRepository) -> SearchIndex

Rebuilds the entire search index from the Catalog:

1. Load all technologies and examples.
2. For each document, concatenate text fields with field weights.
3. Tokenize, stem, compute TF.
4. Compute IDF across all documents.
5. Store sparse TF-IDF vectors.

## Integration Points

| Consuming Domain | Interface | Direction | Notes |
|-----------------|-----------|-----------|-------|
| Catalog Core (DDD-001) | `CatalogRepository` read methods | Catalog -> Discovery | Discovery reads all technologies/examples to build the index. Conformist. |
| Problem-Solution Index (DDD-002) | `ProblemSolutionMap.getSynonymSets()` | PSI -> Discovery | Discovery uses PSI synonyms for query expansion. Customer-supplier. |
| Scope Guard (DDD-004) | `ScopeVerdict` | Scope Guard -> Discovery | Discovery short-circuits for out-of-scope queries. |
| Swarm Orchestration (DDD-006) | `search()` method | Discovery -> Swarm | Swarm agents invoke Discovery for deep technology search. Customer-supplier. |
| Freshness Management (DDD-007) | `CatalogRebuilt` event | Freshness -> Discovery | Discovery rebuilds its index after catalog changes. |
| Proposal Generation (DDD-006) | `RankedMatch[]` | Discovery -> Proposals | Proposals may use Discovery results to supplement PSI matches. |

## V2 -> V3 Changes

| Aspect | V2 | V3 |
|--------|-----|-----|
| Role | Core domain, primary query path | Supporting domain, CLI secondary interface |
| Embedding type | Dense 384-dim (all-MiniLM-L6-v2) | Sparse TF-IDF (full vocabulary) |
| Index format | HNSW binary file | In-memory sparse vectors (no external binary) |
| Query expansion | None | PSI synonym integration |
| Intent classification | None | Three-way classifier (problem/technology/out-of-scope) |
| Primary consumer | SKILL.md conversational path | CLI interface, Swarm agents |
