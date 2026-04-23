# DDD-003: Industry Vertical Domain

**Date**: 2026-03-28
**Status**: Proposal (research document -- no implementation)
**Bounded Context**: Industry Verticals

---

## Domain Purpose

The Industry Verticals domain provides domain-specific technology mappings for non-technical audiences. When a user asks about fraud detection, the system should not just return "spiking-neurons" -- it should explain what spiking neurons do in the context of financial services, what regulatory requirements apply, and what business impact to expect.

Each vertical (healthcare, finance, robotics, edge-iot, genomics) maintains its own mapping of RuVector technologies to industry-specific use cases, plain-language descriptions, and regulatory context.

This domain bridges the gap between RuVector's deeply technical catalog and the business stakeholders who need to evaluate it.

## Bounded Context Definition

**Boundary**: Industry Verticals owns audience-specific presentations of RuVector technologies. It does NOT own the technology definitions (Catalog Core), the problem-to-technology mapping (PSI), or the search mechanism (Discovery Engine). It owns plain-language descriptions, regulatory context, use case scenarios, and audience-level tagging.

**Owns**: Vertical definitions, capability-to-vertical mappings, plain-language descriptions, regulatory context, use case scenarios, audience level classifications.

**Does not own**: Technology metadata, capability groupings, search ranking, proposal structure.

## Ubiquitous Language

| Term | Definition |
|------|-----------|
| **Industry Vertical** | A specific industry domain with its own vocabulary, regulatory requirements, and use case patterns. V3 defines five: `healthcare`, `finance`, `robotics`, `edge-iot`, `genomics`. |
| **Vertical Capability** | A Catalog capability as seen through the lens of a specific vertical. Includes a plain-language description and mapped use case scenarios. |
| **Use Case Scenario** | A concrete, industry-specific scenario describing how a RuVector technology solves a real business problem. Includes expected business impact. |
| **Audience Level** | The technical sophistication of the reader: `technical` (developers), `semi-technical` (tech leads, data scientists), `non-technical` (product managers, business analysts), `executive` (C-suite, board). |
| **Plain Description** | A non-technical explanation of what a technology does, written for the specified audience level. Avoids jargon. |
| **Regulatory Context** | Industry-specific compliance requirements that affect technology selection: HIPAA (healthcare), SOX (finance), GDPR (privacy), FDA (medical devices). |
| **Reference Document** | A pointer to an ADR, example, or external document that provides evidence for a regulatory claim or technical assertion. |

## Aggregates

### IndustryVertical (Aggregate Root)

One aggregate instance per vertical. Each vertical is independent -- healthcare does not depend on finance.

```
IndustryVertical
  +-- id: VerticalId (e.g., "healthcare")
  +-- name: string (e.g., "Healthcare & Life Sciences")
  +-- description: string
  +-- audienceLevels: AudienceLevel[] (which levels this vertical supports)
  +-- capabilities: Map<CapabilityId, VerticalCapability>
  +-- useCaseScenarios: UseCaseScenario[]
  +-- regulatoryContexts: RegulatoryContext[]
  |
  +-- VerticalCapability
  |     +-- capabilityId: CapabilityId
  |     +-- technologies: TechnologyId[]
  |     +-- plainDescription: PlainDescription
  |     +-- audienceLevel: AudienceLevel
  |     +-- relevanceScore: number (0.0-1.0, how relevant this capability is to this vertical)
  |
  +-- UseCaseScenario
  |     +-- id: string
  |     +-- title: string (e.g., "Real-time patient monitoring anomaly detection")
  |     +-- description: string
  |     +-- technologies: TechnologyId[]
  |     +-- businessImpact: string (e.g., "Reduces false alarm rate by 40%")
  |     +-- audienceLevel: AudienceLevel
  |     +-- regulatoryContextIds: string[] (links to applicable regulations)
  |
  +-- RegulatoryContext
        +-- id: string
        +-- name: string (e.g., "HIPAA")
        +-- description: string
        +-- applicableTechnologies: TechnologyId[]
        +-- referenceDocuments: ReferenceDocument[]
```

### Invariants

1. Each vertical must map at least 5 technologies. (A vertical with fewer than 5 technologies does not justify a dedicated vertical.)
2. Every mapped technology must have a `plainDescription` at the vertical's default audience level. (No naked technology references.)
3. If a `RegulatoryContext` is specified, it must have at least one `ReferenceDocument`. (No unsubstantiated regulatory claims.)
4. Every `TechnologyId` referenced in a VerticalCapability or UseCaseScenario must resolve to an existing Technology in the Catalog. (No dangling references.)
5. `UseCaseScenario.technologies` must be non-empty. (Every scenario must involve at least one technology.)
6. Each vertical's `VerticalCapability` entries must reference capabilities that exist in the Catalog.

## Entities

### VerticalCapability

A capability mapped into a specific vertical's context. This is not a copy of the Catalog capability -- it is a projection with audience-specific language.

**Identity**: Composite of `VerticalId` + `CapabilityId`.

**Lifecycle**: Created when a vertical is first defined. Updated when the Catalog changes or when the plain-language description is refined.

### UseCaseScenario

A concrete business scenario. Scenarios are the most valuable artifact for non-technical audiences because they connect abstract technology to tangible outcomes.

**Identity**: `id` string (e.g., `uc-finance-fraud-realtime`).

**Lifecycle**: Created by domain experts familiar with the industry. Updated as technologies evolve or new patterns emerge.

## Value Objects

| Value Object | Structure | Notes |
|-------------|-----------|-------|
| `AudienceLevel` | enum: `technical`, `semi-technical`, `non-technical`, `executive` | Determines the vocabulary and detail level of descriptions. |
| `PlainDescription` | `{ text: string, audienceLevel: AudienceLevel }` | A non-technical explanation. Two PlainDescriptions with same text and level are equal. |
| `RegulatoryContext` | `{ id: string, name: string, description: string, applicableTechnologies: TechnologyId[], referenceDocuments: ReferenceDocument[] }` | A compliance framework relevant to this vertical. |
| `ReferenceDocument` | `{ type: "adr" | "example" | "external", path: string, title: string }` | Pointer to supporting evidence. ADRs and examples use relative paths. External uses URLs. |
| `VerticalId` | string | One of: `healthcare`, `finance`, `robotics`, `edge-iot`, `genomics`. |

## Domain Events

| Event | Trigger | Payload |
|-------|---------|---------|
| `VerticalCreated` | New industry vertical defined | `{ verticalId, name, initialCapabilityCount }` |
| `VerticalCapabilityMapped` | A capability is mapped to a vertical with plain-language description | `{ verticalId, capabilityId, technologyCount }` |
| `UseCaseScenarioAdded` | New use case scenario defined | `{ verticalId, scenarioId, title, technologyIds[] }` |
| `RegulatoryRequirementAdded` | Regulatory context added to a vertical | `{ verticalId, regulatoryName, affectedTechnologyIds[] }` |
| `VerticalStale` | Catalog rebuild detected technologies that are in a vertical but no longer in the Catalog | `{ verticalId, removedTechnologyIds[] }` |

## Key Behaviors

### resolveVertical(query: string) -> IndustryVertical | null

Detects the industry vertical from query keywords. Returns null if no vertical is detected.

**Algorithm**:
1. Tokenize the query into lowercase terms.
2. Match against a keyword dictionary per vertical:
   - `healthcare`: patient, clinical, medical, HIPAA, EHR, diagnosis, hospital, pharmaceutical, FDA
   - `finance`: trading, fraud, risk, portfolio, SOX, banking, compliance, transaction, market
   - `robotics`: robot, actuator, SLAM, navigation, sensor, motor, control loop, kinematics
   - `edge-iot`: edge, IoT, sensor, embedded, microcontroller, gateway, MQTT, OTA, firmware
   - `genomics`: genome, DNA, RNA, sequencing, alignment, variant, protein, BLAST, phylogenetic
3. Return the vertical with the highest keyword match count.
4. If no keywords match, return null (query is vertical-agnostic).

### getPlainDescription(technologyId: TechnologyId, audienceLevel: AudienceLevel) -> PlainDescription | null

Returns the plain-language description for a technology at the requested audience level within this vertical. Falls back to the closest available level if exact match is not found.

## Integration Points

| Consuming Domain | Interface | Direction | Notes |
|-----------------|-----------|-----------|-------|
| Catalog Core (DDD-001) | `CatalogRepository.listTechnologiesByVertical()`, `Technology.verticals[]` | Catalog -> Verticals | Verticals read technology metadata. Conformist. Technologies carry `verticals[]` as V3 extension. |
| Problem-Solution Index (DDD-002) | `ProblemSection.capabilityId` | PSI -> Verticals | Verticals can look up which problem sections are relevant to their mapped capabilities. |
| Proposal Generation (DDD-006) | `IndustryVertical` payload | Verticals -> Proposals | Proposals include vertical-specific descriptions and regulatory notes in RVBP output. |
| Scope Guard (DDD-004) | `resolveVertical()` result | Verticals -> Scope Guard | Scope Guard uses vertical detection to refine in/out-of-scope verdicts for domain-specific queries. |

## Anti-Corruption Layer

### VerticalCatalogAdapter

The Verticals domain does not consume Catalog Core types directly in its public interface. The `VerticalCatalogAdapter` translates between:

- `Technology` (Catalog type with technical fields) -> `VerticalCapability` (vertical type with plain descriptions)
- `CapabilityId` + `Technology[]` (Catalog grouping) -> audience-appropriate capability summary

This prevents Catalog schema changes from cascading into vertical-specific documents and presentation logic.
