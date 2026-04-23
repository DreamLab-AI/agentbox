# DDD-000: Context Map -- RuVector Catalog V3

**Date**: 2026-03-28
**Status**: Proposal (research document -- no implementation)
**Supersedes**: ruvector-catalog/docs/ddd/DDD-000-context-map.md (V2)

---

## Overview

V3 reorganizes the catalog from six bounded contexts into eight. The key structural changes from V2:

1. **Problem-Solution Index** is a new core domain (V3's central innovation).
2. **Industry Verticals** is a new core domain for non-technical audiences.
3. **Scope Guard** is a new supporting domain for out-of-scope detection.
4. **Swarm Orchestration** replaces V2's lightweight Skill Router with a full escalation domain.
5. **Discovery Engine** is demoted from core to supporting -- it is now a secondary CLI interface, not the primary query path.
6. **Freshness Management** absorbs V2's Submodule Management into a single domain.
7. **Proposal Generation** remains but now consumes the Problem-Solution Index as its primary input rather than raw search results.

```
+-----------------------------------------------------------------------+
|                           CORE DOMAINS                                |
|                                                                       |
|  +--------------------+       +-------------------------+             |
|  |  Catalog Core      |       |  Problem-Solution Index |             |
|  |  (DDD-001)         |<------+  (DDD-002)              |             |
|  |                    |       |                         |             |
|  |  Technologies      |       |  Section Headers        |             |
|  |  Capabilities (16) |       |  Synonym Mapping        |             |
|  |  Algorithms        |       |  Intent Matching        |             |
|  |  Examples          |       |  Technology Rankings     |             |
|  +--------+-----------+       +--------+----------------+             |
|           |                            |                              |
|           |     +----------------------+                              |
|           |     |                                                     |
|           v     v                                                     |
|  +--------------------+       +-------------------------+             |
|  |  Industry Verticals|       |  Proposal Generation    |             |
|  |  (DDD-003)         |       |  (DDD-006 -- unchanged  |             |
|  |                    |       |   from V2 DDD-003)      |             |
|  |  Healthcare        |       |                         |             |
|  |  Finance           |       |  RVBP Blueprints        |             |
|  |  Robotics          |       |  Integration Plans      |             |
|  |  Edge/IoT          |       |  Code Examples          |             |
|  |  Genomics          |       +-------------------------+             |
|  +--------------------+                                               |
|                                                                       |
+-----------------------------------------------------------------------+
|                        SUPPORTING DOMAINS                             |
|                                                                       |
|  +--------------------+       +-------------------------+             |
|  |  Scope Guard       |       |  Discovery Engine       |             |
|  |  (DDD-004)         |       |  (DDD-005)              |             |
|  |                    |       |                         |             |
|  |  Out-of-scope      |       |  CLI search interface   |             |
|  |  Negative signals  |       |  TF-IDF sparse vectors  |             |
|  |  Partial scope     |       |  Reranking pipeline     |             |
|  +--------------------+       +-------------------------+             |
|                                                                       |
|  +--------------------+       +-------------------------+             |
|  |  Swarm             |       |  Freshness Management   |             |
|  |  Orchestration     |       |  (DDD-007 -- absorbs    |             |
|  |  (DDD-006)         |       |   V2 Submodule Mgmt)    |             |
|  |                    |       |                         |             |
|  |  Deep analysis     |       |  Submodule sync         |             |
|  |  Multi-agent coord |       |  Index regeneration     |             |
|  |  Escalation logic  |       |  Staleness detection    |             |
|  +--------------------+       +-------------------------+             |
|                                                                       |
+-----------------------------------------------------------------------+
```

## Relationships Between Bounded Contexts

### Upstream / Downstream

| Upstream | Downstream | Relationship Type | Interface |
|----------|------------|-------------------|-----------|
| Catalog Core | Problem-Solution Index | Conformist | PSI conforms to Catalog's technology schema. PSI references TechnologyIds owned by Catalog. |
| Catalog Core | Industry Verticals | Conformist | Verticals map Catalog technologies. Catalog owns the schema. |
| Catalog Core | Discovery Engine | Conformist | Discovery indexes Catalog data. Catalog owns the schema. |
| Catalog Core | Proposal Generation | Conformist | Proposals read technology metadata from Catalog. |
| Problem-Solution Index | Proposal Generation | Customer-Supplier | PSI supplies matched sections; Proposals consume them to fill RVBP templates. |
| Problem-Solution Index | Scope Guard | Customer-Supplier | Scope Guard checks PSI for zero-match queries to confirm out-of-scope. |
| Problem-Solution Index | Discovery Engine | Customer-Supplier | Discovery uses PSI's synonym sets for query expansion. |
| Discovery Engine | Swarm Orchestration | Customer-Supplier | Swarm agents invoke Discovery for deep search when analyzing specific technologies. |
| Scope Guard | Swarm Orchestration | Customer-Supplier | Swarm checks Scope Guard before deep analysis to avoid wasted agent work. |
| Freshness Management | Catalog Core | Customer-Supplier | Freshness triggers Catalog rebuilds. Catalog owns the rebuild logic. |
| Freshness Management | Problem-Solution Index | Customer-Supplier | Freshness triggers PSI revalidation after Catalog rebuilds. |
| Freshness Management | Discovery Engine | Customer-Supplier | Freshness triggers index regeneration after Catalog rebuilds. |

### Anti-Corruption Layers

| Consumer | Provider | ACL Mechanism | Purpose |
|----------|----------|---------------|---------|
| Discovery Engine -> Catalog Core | `CatalogRepository` interface | Isolate Discovery from storage format (JSON, redb, or future backends). |
| Swarm Orchestration -> claude-flow | Agent spawn/terminate API | Isolate domain logic from claude-flow CLI internals and version changes. |
| Freshness Management -> Git | Shell script wrapper (`update-submodule.sh`) | Isolate domain from raw git command complexity. |
| Industry Verticals -> Catalog Core | `VerticalCatalogAdapter` | Translate technical Catalog types into audience-appropriate representations. |
| Scope Guard -> Problem-Solution Index | `ScopeCheckAdapter` | Isolate scope logic from PSI's internal matching implementation. |

### Shared Kernel

The following types are shared across ALL bounded contexts. Changes require coordination across every consuming domain.

- `TechnologyId` -- unique identifier for a technology (kebab-case string)
- `CapabilityId` -- unique identifier for a capability domain (snake_case string)
- `CrateId` -- Rust crate name (kebab-case string)
- `Status` -- enum: `production`, `experimental`, `research`
- `DeploymentTarget` -- enum: `native`, `wasm`, `nodejs`, `edge`, `embedded`, `fpga`, `postgresql`
- `CatalogVersion` -- version metadata including commit hash, date, scope counts

### Partnership

| Partners | Nature |
|----------|--------|
| Problem-Solution Index <-> Catalog Core | PSI sections reference technologies by ID. When Catalog adds/removes technologies, PSI must be notified. Both teams coordinate on what metadata a Technology exposes. |
| Scope Guard <-> Problem-Solution Index | Scope Guard relies on PSI's coverage to determine if a query is truly out of scope (vs. just poorly worded). They coordinate on coverage completeness. |

## Data Flow: End-to-End V3 Query

```
User: "I need to detect fraud in real-time financial transactions"
  |
  v
[Scope Guard] -- checkScope("fraud detection real-time financial")
  |              -> verdict: IN_SCOPE (keywords: "financial", "real-time")
  |
  v
[Problem-Solution Index] -- matchQuery("fraud detection real-time financial")
  |  -> Section: "How do I detect anomalies in streaming data?"
  |     synonyms: ["fraud detection", "outlier detection", "anomaly scoring"]
  |     technologies: [spiking-neurons, online-learning, graph-partitioning]
  |  -> Section: "How do I build a real-time scoring pipeline?"
  |     technologies: [attention-router, inference-engine, feature-store]
  |
  v
[Industry Verticals] -- resolveVertical("financial")
  |  -> IndustryVertical: "finance"
  |     regulatory: [SOX]
  |     plain descriptions for each matched technology
  |
  v
[Proposal Generation] -- generate(matchedSections, vertical, problemStatement)
  |  -> RVBP document with:
  |     - ranked technologies with plain-language descriptions
  |     - finance-specific regulatory notes
  |     - phased integration plan
  |
  v
User receives: RVBP tailored to financial services audience

  --- OPTIONAL ESCALATION ---

[Swarm Orchestration] -- escalate(query, initialResults, confidence=0.6)
  |  -> spawns 3 agents:
  |     - domain-expert: reads SKILL.md + capability docs
  |     - code-analyst: reads ADRs + source code for spiking-neurons
  |     - vertical-specialist: reads finance regulatory context
  |  -> synthesizes: DetailedRVBP with code examples and risk analysis
```

## V2 -> V3 Migration Notes

| V2 Domain | V3 Disposition |
|-----------|---------------|
| DDD-001 Catalog Core | Retained as DDD-001 with extensions (useCases, verticals, plainDescription) |
| DDD-002 Technology Discovery | Demoted to DDD-005 Discovery Engine (supporting, CLI-only) |
| DDD-003 Proposal Generation | Retained. Now consumes PSI output instead of raw search results |
| DDD-004 Skill Router | Replaced by DDD-006 Swarm Orchestration (full escalation logic) |
| DDD-005 Freshness Management | Retained as DDD-007, absorbs V2 DDD-006 Submodule Management |
| DDD-006 Submodule Management | Absorbed into Freshness Management |
| (new) | DDD-002 Problem-Solution Index |
| (new) | DDD-003 Industry Verticals |
| (new) | DDD-004 Scope Guard |
