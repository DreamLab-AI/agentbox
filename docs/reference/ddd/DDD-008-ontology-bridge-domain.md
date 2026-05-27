# DDD-008: Ontology Bridge Domain Model

**Date**: 2026-05-22
**Status**: Proposed
**Bounded Context**: Ontology Bridge
**Cross-references**: PRD-011 (product requirements), ADR-023 (decision record), DDD-003 (sovereign messaging — relay transport), DDD-004 (linked-data interchange — JSON-LD encoding)

---

## Bounded Context: Ontology Bridge (BC21)

The ontology bridge is a **read-heavy query proxy** between agentbox MCP
agents and VisionClaw's Oxigraph-backed ontology/KG system. It operates
at the federation boundary, translating between MCP tool calls and
VisionClaw REST API requests.

### Upstream Context

**VisionClaw** (BC20) owns:
- Oxigraph quad-store (named graphs: ontology:assert, ontology:inferred,
  knowledge, agent, cache:sssp, cache:apsp)
- Whelk-rs OWL 2 EL++ reasoner
- IRI minting (`vc:<kind>/<slug>`, `urn:ngm:node:<id>`)
- REST API at `/api/ontology/*` and `/api/graph/*`

### Downstream Context

**Agentbox agents** consume:
- OWL class metadata (hierarchy, properties, quality scores)
- Knowledge graph topology (nodes, edges, neighbors)
- SPARQL query results (ad-hoc exploration)
- Validation reports (ontology consistency)

## Aggregates

### A1: OntologyBridge

Root aggregate. Manages connection lifecycle and request routing.

**Value Objects:**
- `BridgeConfig { api_url: string, timeout_ms: number }`
- `BridgeHealth { status: "healthy" | "degraded" | "unavailable", class_count, axiom_count, last_check }`

**Invariants:**
- I01: Bridge MUST NOT cache ontology data beyond a single request (VisionClaw is authoritative)
- I02: Bridge MUST prepend SPARQL prologue to all queries (D6)
- I03: Bridge MUST NOT expose SPARQL UPDATE (read-only surface)
- I04: Bridge MUST return structured errors, never throw unhandled exceptions

### A2: OntologyClassView

Read-only projection of a VisionClaw OWL class.

**Value Objects:**
- `ClassView { iri, term_id, label, description, domain, quality_score, authority_score, relationships }`
- `PropertyView { iri, label, property_type, domain, range }`
- `AxiomView { axiom_type, subject, object, annotations }`

**Invariants:**
- I05: Class IRIs MUST use the `vc:` namespace prefix
- I06: Relationship arrays preserve VisionClaw's relationship model (has_part, is_part_of, requires, depends_on, enables, relates_to, bridges_to)

### A3: KnowledgeNodeView

Read-only projection of a VisionClaw knowledge graph node.

**Value Objects:**
- `NodeView { id, metadata_id, label, node_type, owl_class_iri, metadata }`
- `EdgeView { id, source, target, relationship_type, weight }`
- `PathView { nodes: NodeView[], edges: EdgeView[], total_weight }`

**Invariants:**
- I07: Node IDs are VisionClaw-assigned u32 values, not minted by agentbox
- I08: Edge weights reflect VisionClaw's weight model (hierarchical=2.5, structural=1.5, etc.)

### A4: URNCrossResolver

Resolves `urn:visionclaw:*` URNs to their VisionClaw representations.

**Value Objects:**
- `VisionClawURN { kind: "concept"|"kg"|"bead"|"execution"|"group", scope: hex-pubkey, local: string }`
- `ResolutionResult { found: boolean, iri?: string, metadata?: object }`

**Invariants:**
- I09: `urn:visionclaw:concept:*` resolves via OWL class IRI derivation (`vc:onto/<local>`)
- I10: `urn:visionclaw:kg:*` resolves via knowledge node lookup (`vc:kg/<local>`)
- I11: Resolution returns 404 (not error) when the target doesn't exist in VisionClaw

## Domain Events

| Event | Trigger | Consumer |
|-------|---------|----------|
| `OntologyQueried` | Any tool invocation | Observability (metrics) |
| `AxiomSubmitted` | `ontology_axiom_add` | Audit log |
| `BridgeHealthChanged` | Health check transition | Management API |

## Anti-Corruption Layer

The bridge translates between VisionClaw's data model and agentbox's:

| VisionClaw | Agentbox | Translation |
|------------|----------|-------------|
| `urn:ngm:node:<id>` | `urn:agentbox:thing:<scope>:vc-node-<id>` | Prefix mapping |
| `vc:onto/<slug>` | `urn:visionclaw:concept:<scope>:<slug>` | IRI → URN |
| `vc:kg/<slug>` | `urn:visionclaw:kg:<scope>:<slug>` | IRI → URN |
| SPARQL bindings (JSON) | MCP tool result (JSON) | Passthrough with envelope |
