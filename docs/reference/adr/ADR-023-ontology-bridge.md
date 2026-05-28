---
id: ADR-023
title: VisionClaw Ontology Bridge via MCP
status: proposed
date: 2026-05-22
type: integration
author: Dr John O'Hare
depends_on: [ADR-005, ADR-012, ADR-013, ADR-015]
review_trigger: VisionClaw API schema changes or Oxigraph upgrade
---

# ADR-023 — VisionClaw Ontology Bridge via MCP

## Context

VisionClaw maintains a comprehensive ontology and knowledge graph system:

- **Oxigraph** SPARQL 1.1 quad-store with RocksDB backend (ADR-11 in VisionClaw)
- **Named graph segregation**: `urn:ngm:graph:ontology:assert` (authored OWL),
  `urn:ngm:graph:ontology:inferred` (Whelk-derived), `urn:ngm:graph:knowledge`
  (KG entities), `urn:ngm:graph:agent` (telemetry)
- **Whelk-rs** OWL 2 EL++ reasoner for materialised inference
- **REST API** at `http://visionclaw-server:4000/api/` (graph, ontology, health endpoints)
- **WebSocket** at `/wss` (binary physics protocol) and `/ws/mcp-relay` (MCP bridge)
- **IRI namespace**: `vc:` → `https://narrativegoldmine.com/ns/v1#`
- **URN scheme**: `urn:visionclaw:{concept,kg,bead,execution,group}:<pubkey>:<local>`

Both systems share `visionclaw_network` (Docker), `did:nostr:<hex-pubkey>`
identity, and `sha256-12` content addressing.

Agentbox agents need ontology context for:
1. Grounding agent reasoning in domain knowledge (class hierarchies, properties)
2. Navigating the knowledge graph (pathfinding, neighbor traversal)
3. Contributing learned concepts back to the ontology
4. Cross-referencing VisionClaw URNs from agentbox context

## Decision

### D1: HTTP Bridge, Not Direct Oxigraph Access

The ontology bridge is a **Node.js MCP server** that proxies to VisionClaw's
existing REST API, not a direct Oxigraph client.

**Rationale**: VisionClaw owns Oxigraph (single-writer model). Direct access
would bypass its named-graph routing, SPARQL prologue injection, and IRI
minting rules. The HTTP API is the stable contract.

**Rejected**: Shared Oxigraph volume mount (violates single-writer), gRPC
sidecar (no gRPC surface exists), embedded Oxigraph in agentbox (data
duplication).

### D2: Adapter Slot = Skills (Not Adapters)

The bridge registers as a skill (`[skills.ontology]`) gated in `agentbox.toml`,
not as a sixth adapter slot. Ontology is a **query surface**, not a durable-state
backend — it doesn't implement the adapter contract (SLOs, circuit breakers,
privacy filter middleware).

### D3: MCP Tool Granularity

Ten tools spanning three concerns:

| Concern | Tools |
|---------|-------|
| Ontology (TBox) | `ontology_class_get`, `ontology_class_list`, `ontology_axiom_add`, `ontology_validate` |
| Knowledge Graph (ABox) | `kg_node_search`, `kg_neighbors`, `kg_pathfind` |
| Infrastructure | `ontology_search`, `ontology_graph_query`, `ontology_health` |

`ontology_graph_query` accepts raw SPARQL SELECT (read-only). SPARQL UPDATE is
not exposed — mutations go through typed tools that enforce IRI minting rules.

### D4: Fail-Open on Unreachable VisionClaw

If VisionClaw is down, the bridge:
- Returns `{ error: "ontology_unavailable", ... }` per tool call
- Does NOT block agentbox startup
- Does NOT retry in a loop (agents can retry at their discretion)
- Health endpoint reports `degraded` (not `unhealthy`)

### D5: URN Cross-Resolution

`urn:visionclaw:concept:<pubkey>:<local>` resolves by:
1. Deriving the OWL class IRI: `https://narrativegoldmine.com/ns/v1#<local>`
2. Querying VisionClaw's ontology API for class metadata
3. Returning the class as a JSON-LD document (if `[linked_data]` enabled)

The BC20 anti-corruption layer in `management-api/lib/uris.js` handles the
`urn:visionclaw:*` → `urn:agentbox:*` mapping at the federation boundary.

### D6: SPARQL Prefix Injection

All SPARQL queries submitted via `ontology_graph_query` are prepended with
VisionClaw's standard prologue:
```sparql
PREFIX vc: <https://narrativegoldmine.com/ns/v1#>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX owl: <http://www.w3.org/2002/07/owl#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
```

### D7: Configuration

```toml
[skills.ontology]
enabled = true
visionclaw_api_url = "http://visionclaw-server:4000"
```

The URL defaults to `http://visionclaw-server:4000` (the VisionClaw container hostname on
`visionclaw_network`). Operators can override for external deployments.

## Consequences

- Agents gain ontology-grounded reasoning without VisionClaw coupling
- Zero-impact degradation when VisionClaw is absent
- SPARQL query surface enables ad-hoc exploration
- Future: WebSocket bridge for real-time graph updates (Phase 2)
