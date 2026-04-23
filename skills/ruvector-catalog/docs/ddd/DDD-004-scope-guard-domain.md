# DDD-004: Scope Guard Domain

**Date**: 2026-03-28
**Status**: Proposal (research document -- no implementation)
**Bounded Context**: Scope Guard

---

## Domain Purpose

The Scope Guard prevents the catalog from giving confident wrong answers. When a user asks "Can RuVector generate marketing copy?", the system should not shoehorn an answer from the nearest-matching technology -- it should clearly state that content generation is out of scope for RuVector, and optionally suggest how RuVector could play a supporting role (e.g., "RuVector does not generate content, but its coherence gates could validate LLM-generated content for factual consistency").

This domain is the gatekeeper that runs BEFORE the Problem-Solution Index. It classifies every query into one of three verdicts: `in_scope`, `out_of_scope`, or `partial_scope`.

## Bounded Context Definition

**Boundary**: Scope Guard owns the definition of what RuVector does and does not do. It owns the excluded category list, the scope classification logic, and the supporting-infrastructure suggestions for out-of-scope queries.

**Owns**: Excluded categories with reasons, scope verdict logic, alternative suggestions, confidence scoring.

**Does not own**: Technology metadata (Catalog Core), problem-to-technology matching (PSI), search ranking (Discovery Engine), proposal generation.

## Ubiquitous Language

| Term | Definition |
|------|-----------|
| **Scope Verdict** | The classification of a query: `in_scope` (RuVector directly addresses this), `out_of_scope` (RuVector does not do this), `partial_scope` (RuVector does not do this directly, but can support it). |
| **Excluded Category** | A problem domain that RuVector explicitly does NOT address. E.g., "content generation", "image rendering", "database administration", "network routing". Each has a brief explanation of why. |
| **Supporting Infrastructure Mapping** | For out-of-scope queries, a mapping that suggests how RuVector could play a supporting role. E.g., for "content generation" -> RuVector's coherence gates can validate generated content. |
| **Confidence Score** | A float [0.0, 1.0] representing how confident the system is in its scope verdict. Low confidence triggers cautious responses or swarm escalation. |
| **Alternative Suggestion** | A concrete recommendation of what RuVector CAN do that is adjacent to an out-of-scope query. |
| **Negative Signal** | A keyword or phrase pattern that strongly indicates a query is out of scope. E.g., "generate text", "render image", "translate language". |

## Aggregates

### ScopeDefinition (Root Aggregate)

The single aggregate for this domain. It encapsulates the complete definition of RuVector's scope boundaries.

```
ScopeDefinition
  +-- excludedCategories: Map<string, ExcludedCategory>
  +-- negativeSignals: NegativeSignal[]
  +-- supportingMappings: Map<string, SupportingInfrastructureMapping>
  +-- inScopeKeywords: string[]     (positive indicators from capability keywords)
  |
  +-- ExcludedCategory
  |     +-- id: string (e.g., "content-generation")
  |     +-- name: string (e.g., "Content Generation")
  |     +-- reason: string (e.g., "RuVector provides infrastructure for AI systems, not end-user content creation")
  |     +-- negativeSignals: string[] (keywords that indicate this category)
  |     +-- supportingTechnologies: SupportingInfrastructureMapping | null
  |
  +-- SupportingInfrastructureMapping
  |     +-- excludedCategoryId: string
  |     +-- description: string (e.g., "While RuVector does not generate content, its coherence gates can validate LLM output")
  |     +-- technologies: TechnologyId[]
  |     +-- useCaseDescription: string
  |
  +-- NegativeSignal
        +-- pattern: string (keyword or phrase)
        +-- excludedCategoryId: string
        +-- weight: number (0.0-1.0, how strongly this signal indicates out-of-scope)
```

### Invariants

1. The `excludedCategories` list must be non-empty. (A scope guard with no exclusions provides no value.)
2. Every ExcludedCategory must have a non-empty `reason`. (Users deserve an explanation, not just a rejection.)
3. A `partial_scope` verdict must include at least one supporting technology suggestion. (Partial scope without a suggestion is equivalent to out-of-scope.)
4. Every `TechnologyId` in a SupportingInfrastructureMapping must resolve to an existing Technology in the Catalog.
5. Negative signals must be associated with exactly one ExcludedCategory. (Ambiguous signals should be resolved by the curator.)
6. `inScopeKeywords` must be populated from the Catalog's capability keywords. (Ensures scope guard stays in sync with what the catalog actually offers.)

## Entities

### ExcludedCategory

A named domain that RuVector explicitly does NOT address.

**Identity**: `id` string (kebab-case, e.g., `content-generation`).

**Lifecycle**: Created when a scope boundary is identified (typically from user queries that were incorrectly matched). Updated when the boundary needs refinement. Removed if RuVector expands into that domain (rare).

**Initial excluded categories** (V3 proposal):
- `content-generation` -- text, image, video, audio generation
- `database-administration` -- SQL tuning, backup, replication management
- `network-infrastructure` -- routing, firewalls, load balancing, DNS
- `ui-rendering` -- frontend frameworks, CSS, component libraries
- `data-warehousing` -- ETL pipelines, data lake management, BI dashboards
- `devops-tooling` -- CI/CD, container orchestration, monitoring
- `natural-language-understanding` -- NLU, NER, sentiment analysis (RuVector provides infrastructure, not NLU models)

### SupportingInfrastructureMapping

When a query is out of scope, this entity explains what RuVector CAN contribute as supporting infrastructure.

**Identity**: Composite of `excludedCategoryId` + mapping description.

**Lifecycle**: Created alongside the ExcludedCategory it supports. Updated as new technologies become relevant.

## Value Objects

| Value Object | Structure | Notes |
|-------------|-----------|-------|
| `ScopeVerdict` | `{ classification: "in_scope" | "out_of_scope" | "partial_scope", confidence: ConfidenceScore, explanation: string, suggestions: AlternativeSuggestion[] }` | The complete result of a scope check. |
| `ConfidenceScore` | `{ value: number }` | Float [0.0, 1.0]. Above 0.8 = high confidence. 0.5-0.8 = medium. Below 0.5 = low (may need swarm escalation). |
| `AlternativeSuggestion` | `{ description: string, technologies: TechnologyId[], relevance: number }` | A concrete "instead, RuVector can..." suggestion. |
| `NegativeSignal` | `{ pattern: string, excludedCategoryId: string, weight: number }` | A keyword/phrase that pushes toward out-of-scope. |

## Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| `OutOfScopeQueryDetected` | Scope check returns `out_of_scope` | `{ query, excludedCategoryId, confidence, hasSupportingSuggestion: boolean }` |
| `PartialScopeQueryHandled` | Scope check returns `partial_scope` | `{ query, excludedCategoryId, supportingTechnologies[] }` |
| `ExcludedCategoryAdded` | Curator defines a new exclusion | `{ categoryId, name, reason }` |
| `ScopeDefinitionUpdated` | Negative signals or exclusions modified | `{ changedCategories[] }` |

## Key Behaviors

### checkScope(query: string) -> ScopeVerdict

The primary method. Runs BEFORE the Problem-Solution Index.

**Algorithm**:
1. Tokenize the query into lowercase terms.
2. Score negative signals: for each NegativeSignal, check if its pattern appears in the query. Sum weighted scores by ExcludedCategory.
3. Score positive signals: check query tokens against `inScopeKeywords` (derived from Catalog capability keywords).
4. Decision logic:
   - If negative score > threshold AND positive score is low -> `out_of_scope`
   - If negative score > threshold AND positive score is also significant -> `partial_scope`
   - If negative score <= threshold -> `in_scope`
5. For `out_of_scope`: attach the ExcludedCategory's reason and any SupportingInfrastructureMapping.
6. For `partial_scope`: attach the SupportingInfrastructureMapping technologies as suggestions.
7. For `in_scope`: return with confidence based on positive signal strength.

**Threshold tuning**: The negative/positive thresholds are configurable. Initial values should be conservative (err toward `in_scope` or `partial_scope` rather than `out_of_scope`).

### refreshInScopeKeywords(catalog: CatalogRepository) -> void

Rebuilds the `inScopeKeywords` set from the Catalog's current capability keywords. Should be called after every `CatalogRebuilt` event.

## Integration Points

| Consuming Domain | Interface | Direction | Notes |
|-----------------|-----------|-----------|-------|
| Problem-Solution Index (DDD-002) | `ProblemSolutionMap.matchQuery()` result count | PSI -> Scope Guard | Scope Guard uses zero PSI matches as a confirming signal for `out_of_scope`. |
| Catalog Core (DDD-001) | `CatalogRepository` capability keywords | Catalog -> Scope Guard | Scope Guard reads capability keywords to build its positive signal set. Conformist. |
| Industry Verticals (DDD-003) | `resolveVertical()` result | Verticals -> Scope Guard | Vertical detection helps refine scope: a query that matches a vertical is more likely in-scope even if negative signals fire. |
| Swarm Orchestration (DDD-006) | `ScopeVerdict` | Scope Guard -> Swarm | Swarm checks scope before committing agents to deep analysis. Low-confidence verdicts may trigger swarm escalation for clarification. |
| Discovery Engine (DDD-005) | `ScopeVerdict` | Scope Guard -> Discovery | Discovery can short-circuit search for clearly out-of-scope queries. |

## Design Notes

### Why a Separate Domain?

Scope guarding could be implemented as a method on the Problem-Solution Index (zero matches = out of scope). However, this conflates two different concerns:

1. **PSI zero matches** means "we do not have a curated answer for this problem" -- which could be a coverage gap, not a true scope exclusion.
2. **Scope Guard exclusion** means "this is fundamentally not what RuVector does" -- a deliberate editorial decision.

By separating these, the system can distinguish between "we should add a PSI section for this" (coverage gap) and "we should never try to answer this" (scope exclusion).
