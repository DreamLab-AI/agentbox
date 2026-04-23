# ADR-008: Data Model Extensions (useCases, verticals, plainDescription)

**Date**: 2026-03-28
**Status**: Proposed
**Deciders**: Mark Allen
**Related ADRs**: ADR-002, ADR-003, ADR-004, ADR-005, ADR-007

---

## Context

V2's `Technology` type has only technical fields:

```typescript
interface Technology {
  id: string;
  name: string;
  crate: string;
  capabilityId: string;
  complexity: string | null;
  latency: string | null;
  status: Status;
  useWhen: string | null;
  features: string | null;
  deploymentTargets: DeploymentTarget[];
  sourcePath: string;
  algorithms: Algorithm[];
}
```

This schema is why V2 struggles with natural-language queries. The `useWhen` field for prime-radiant says "Verify coherence of AI outputs using sheaf cohomology." A user searching for "detect hallucinations" will not match because:

1. The word "hallucination" does not appear in any field
2. The word "detect" does not appear in any field
3. "Sheaf cohomology" is meaningless to both the TF-IDF embedder and non-technical users
4. There is no field that maps prime-radiant to the healthcare vertical
5. There is no field that provides a plain-English explanation

The V1 SKILL.md compensates for this by placing prime-radiant under the section header "I need to verify AI outputs / prevent hallucination / detect drift" -- the header contains the synonyms that the data model lacks. But this means the SKILL.md's human-curated headers are doing work that should be in the structured data.

Every ADR in the V3 proposal depends on data model extensions:

- **ADR-002** (section headers): Needs a `problemDomains` field to auto-assign technologies to headers
- **ADR-003** (scope boundary): Needs an `outOfScope` field on the Catalog type
- **ADR-004** (vertical overlays): Needs a `verticals` field on Technology
- **ADR-005** (response adaptation): Needs a `plainDescription` field
- **ADR-007** (CLI fix): Needs `useCases` for field-weighted search

## Decision

**Extend the Technology, Capability, and Catalog types with fields that bridge the gap between engineering descriptions and user intent.**

### Technology Type Extensions

```typescript
interface Technology {
  // --- Existing fields (unchanged) ---
  id: string;
  name: string;
  crate: string;
  capabilityId: string;
  complexity: string | null;
  latency: string | null;
  status: Status;
  useWhen: string | null;          // Technical use-when (preserved)
  features: string | null;
  deploymentTargets: DeploymentTarget[];
  sourcePath: string;
  algorithms: Algorithm[];

  // --- V3 Extensions ---
  useCases: string[];              // Natural-language problem scenarios
  problemDomains: string[];        // Domain tags for section header assignment
  verticals: string[];             // Industry vertical applicability
  plainDescription: string | null; // Non-technical summary
  relatedExamples: string[];       // Cross-references to examples/ directory
  primaryFor: string[];            // Problem categories where this is the primary recommendation
}
```

### Field Definitions

**`useCases`**: Natural-language descriptions of scenarios where this technology is the right choice. Written in the user's voice, containing the vocabulary users actually use.

Example for prime-radiant:
```json
{
  "useCases": [
    "Detect when an AI is hallucinating or making things up",
    "Verify that AI outputs are internally consistent",
    "Prevent drift in AI behavior over time",
    "Fact-check AI reasoning chains for contradictions",
    "Ensure clinical decision support systems give consistent advice"
  ]
}
```

These use cases serve dual purpose: they improve CLI search quality (ADR-007) by providing natural-language terms for TF-IDF matching, AND they give Claude explicit scenarios to match against in the CAG path.

**`problemDomains`**: Machine-readable tags that map technologies to problem-solution section headers (ADR-002).

Example: `["coherence", "safety", "verification", "hallucination-detection", "drift-detection"]`

These tags are used by the SKILL.md generation pipeline to automatically assign technologies to section headers. A technology tagged with `coherence` appears under "I need to verify AI outputs."

**`verticals`**: Industry verticals where this technology has demonstrated or projected applicability.

Example: `["healthcare", "finance", "legal"]`

These tags are used by the vertical quick-map in SKILL.md (ADR-004) and by the CLI's domain routing filter (ADR-007).

**`plainDescription`**: A single sentence explaining the technology in non-technical terms (ADR-005).

Example: `"A fact-checking engine for AI -- catches contradictions and flags when an AI is making things up."`

**`relatedExamples`**: Paths to example applications that demonstrate this technology.

Example: `["examples/prime-radiant", "examples/verified-applications"]`

These cross-references enable the swarm deep analysis (ADR-006) to find relevant source code without searching the entire codebase.

**`primaryFor`**: Problem categories where this technology should be the top recommendation.

Example for ruvector-core: `["vector-search", "similarity-search", "nearest-neighbor"]`

This is used by the CLI re-ranking step (ADR-007) to boost primary technologies above secondary ones.

### Capability Type Extensions

```typescript
interface Capability {
  // --- Existing fields (unchanged) ---
  id: string;
  description: string;
  primaryCrate: string;
  status: Status;
  docPath: string;
  keywords: string[];
  technologies: Technology[];

  // --- V3 Extensions ---
  problemStatement: string;       // The section header text (ADR-002)
  synonyms: string[];             // Synonym variants for the section header
  relatedCapabilities: string[];  // Cross-references to other capabilities
}
```

**`problemStatement`**: The human-curated section header from SKILL.md (ADR-002). Stored in the data model so SKILL.md can be regenerated from catalog.json.

Example: `"I need to verify AI outputs / prevent hallucination / detect drift"`

**`synonyms`**: Additional phrasings that should match this capability.

Example: `["ensure consistency", "fact-check", "validate AI reasoning", "catch contradictions"]`

**`relatedCapabilities`**: Cross-references to capabilities that often co-occur.

Example for `coherence_safety`: `["graph_intelligence", "attention_mechanisms"]`

### Catalog Type Extensions

```typescript
interface Catalog {
  // --- Existing fields ---
  version: CatalogVersion;
  capabilities: Capability[];
  examples: CatalogExample[];

  // --- V3 Extensions ---
  outOfScope: OutOfScopeCategory[];  // Explicit exclusions (ADR-003)
  verticals: VerticalMapping[];      // Industry vertical definitions (ADR-004)
  problemSolutionMap: ProblemSolutionEntry[];  // Machine-readable section headers (ADR-002)
}

interface OutOfScopeCategory {
  category: string;          // e.g., "Content generation"
  description: string;       // e.g., "No text writing, image generation, or creative tools"
  keywords: string[];        // e.g., ["writing", "generate content", "creative", "author"]
}

interface VerticalMapping {
  vertical: string;          // e.g., "healthcare"
  displayName: string;       // e.g., "Healthcare & Life Sciences"
  primaryTechnologies: string[];  // Technology IDs
  overlayPath: string;       // e.g., "domains/healthcare.md"
}

interface ProblemSolutionEntry {
  problemStatement: string;  // Section header text
  capabilityId: string;      // Maps to a Capability
  synonyms: string[];        // Variant phrasings
}
```

## Consequences

### Positive

- **Bridges the semantic gap structurally**: The root cause of V2's failures is that the data model lacks natural-language fields. Adding `useCases` and `plainDescription` puts user-vocabulary terms into the structured data where both CAG and CLI can use them.
- **Enables all other V3 ADRs**: ADR-002 (section headers from `problemStatement`), ADR-003 (scope boundary from `outOfScope`), ADR-004 (verticals from `verticals` field), ADR-005 (response adaptation from `plainDescription`), ADR-007 (CLI fix from `useCases` field weighting). This ADR is the foundation.
- **Single source of truth**: SKILL.md can be generated from catalog.json. The section headers, technology descriptions, and vertical quick-maps all derive from the same structured data. No manual synchronization needed.
- **Backward compatible**: All new fields are additive. Existing V2 tools continue to work with the existing fields. New fields are nullable or defaulted to empty arrays.

### Negative

- **Significant authoring effort**: Each of the 80 technologies needs `useCases` (3-5 entries), `plainDescription` (1 sentence), `problemDomains` (2-4 tags), and `verticals` (0-3 entries). That is approximately 80 * (4 + 1 + 3 + 1) = 720 individual fields to author. This is a one-time cost but non-trivial.
- **catalog.json size increase**: Rough estimate: 720 fields * average 15 words * 5 characters = ~54KB of additional text. Current catalog.json is ~80KB. The extended version would be ~134KB. This is still well within context window limits but increases load time.
- **Maintenance coupling**: When a technology changes, its `useCases`, `plainDescription`, and `useWhen` must all be updated consistently. Three descriptions of the same technology increases the surface area for inconsistency.
- **Judgment calls in authoring**: What use cases belong to prime-radiant vs ruvector-coherence? Which technologies are "primary" for healthcare? These are editorial decisions that require domain knowledge and will be debated.

### Neutral

- **Existing fields are unchanged**: The `useWhen`, `features`, `status`, and `deploymentTargets` fields retain their current meaning and format. V2 consumers of these fields are unaffected.

## Alternatives Considered

### Alternative A: Improve Descriptions Only, Keep V2 Schema (Rejected)

Rewrite `useWhen` and `features` to include more natural-language synonyms, without adding new fields.

**Why rejected**: This is a structural problem that requires a structural fix. The `useWhen` field serves a specific purpose: it tells a developer WHEN to choose this technology over alternatives. Overloading it with use cases, plain descriptions, and industry verticals would make it an unfocused blob of text. Separate fields with clear semantics are maintainable; a single overloaded field is not.

Example of what "improve descriptions" looks like in practice:
```json
{
  "useWhen": "Verify coherence of AI outputs using sheaf cohomology. Also useful for hallucination detection, drift prevention, fact-checking AI reasoning, ensuring clinical decision support consistency. Non-technical: a fact-checking engine for AI. Healthcare, finance, legal verticals."
}
```

This is unmaintainable and mixes concerns that belong in separate fields.

### Alternative B: Separate Mapping File (Rejected)

Keep the Technology schema unchanged. Create a separate `mappings.json` that maps technology IDs to use cases, verticals, and plain descriptions.

**Why rejected**: The coupling between a technology and its use cases is inherent -- they describe the same thing from different perspectives. Separating them into different files creates a synchronization problem: when a technology is added to catalog.json, someone must remember to also update mappings.json. Keeping them in the same record ensures they are authored and maintained together.

### Alternative C: Auto-Generate Use Cases from Source Code (Considered for V3.1)

Use LLM analysis of each crate's source code, README, and ADR references to auto-generate `useCases` and `plainDescription`.

**Status**: Deferred to V3.1. This is the strategy the hive mind agents used -- reading source code and producing domain-mapped descriptions. Automating this with a generation pipeline (read source -> LLM summarize -> populate fields) would reduce the 720-field authoring burden. However, the initial V3 population should be human-authored to establish quality standards that the auto-generator can be evaluated against.

## Evidence

### Field Impact on Search Quality

Analysis of how each new field would affect the 5 benchmark queries:

| Query | Missing Field | Impact if Present |
|-------|--------------|-------------------|
| Q1: hallucination detection | `useCases` with "hallucination" | Direct term match, CLI jumps from 0.52 to 0.78+ |
| Q2: out-of-scope books | `outOfScope` categories | CLI returns "no match" instead of false positives |
| Q3: database for mobile | `useCases` with "mobile app" | rvlite ranks #1 instead of being missed |
| Q4: bio-inspired edge | `verticals` + `deploymentTargets` | Intersection filter narrows to correct set |
| Q5: healthcare | `verticals` with "healthcare" + `plainDescription` | Correct technologies surface with plain language |

### Data Model Size Projections

| Schema | Fields per Technology | catalog.json Size | Tokens |
|--------|----------------------|-------------------|--------|
| V2 (current) | 11 | ~80KB | ~20,000 |
| V3 (extended) | 17 | ~134KB | ~33,500 |
| Delta | +6 | +54KB | +13,500 |

The 13,500-token increase is for catalog.json (used by the CLI). SKILL.md (used by CAG) remains at ~7,500 tokens because it renders a curated subset of catalog.json, not the full record for every technology.

### Example: prime-radiant Full V3 Record

```json
{
  "id": "prime-radiant",
  "name": "prime-radiant",
  "crate": "prime-radiant",
  "capabilityId": "coherence_safety",
  "complexity": "O(n log n)",
  "latency": "< 10ms per coherence check",
  "status": "production",
  "useWhen": "Verify coherence of AI outputs using sheaf cohomology, governance with immutable witness chains, knowledge substrate with sheaf graph",
  "features": "H^0 global sections, H^1 obstructions, sheaf Laplacian, Blake3 hash chains, GNN learned restriction maps, 256-tile WASM coherence fabric",
  "deploymentTargets": ["native", "wasm"],
  "sourcePath": "examples/prime-radiant",
  "algorithms": [
    { "name": "Sheaf Laplacian", "technologyId": "prime-radiant", "crate": "prime-radiant", "complexity": "O(n^2)", "description": "Spectral analysis of sheaf structure for coherence measurement" }
  ],
  "useCases": [
    "Detect when an AI is hallucinating or making things up",
    "Verify that AI outputs are internally consistent",
    "Prevent drift in AI behavior over time",
    "Fact-check AI reasoning chains for contradictions",
    "Ensure clinical decision support systems give consistent advice",
    "Audit AI trading decisions for logical coherence"
  ],
  "problemDomains": ["coherence", "safety", "verification", "hallucination-detection", "drift-detection"],
  "verticals": ["healthcare", "finance", "legal"],
  "plainDescription": "A fact-checking engine for AI -- catches contradictions, verifies consistency, and flags when an AI system is making things up.",
  "relatedExamples": ["examples/prime-radiant", "examples/verified-applications"],
  "primaryFor": ["hallucination-detection", "coherence-verification", "ai-safety"]
}
```

## Notes

The 720-field authoring effort can be phased:

1. **Phase 1**: Populate `useCases` and `plainDescription` for the top 20 technologies (covers ~80% of queries). Estimated effort: 4-6 hours.
2. **Phase 2**: Populate `verticals` and `problemDomains` for all 80 technologies. Estimated effort: 2-3 hours (mostly tagging, less creative writing).
3. **Phase 3**: Populate remaining technologies' `useCases` and `plainDescription`. Estimated effort: 8-12 hours.
4. **Phase 4**: Auto-generate candidates for review using LLM analysis of source code (V3.1).

Total human effort: approximately 14-21 hours for the full initial population. This is comparable to the effort spent creating V1's SKILL.md (3 rounds of sequential source-file reading).
