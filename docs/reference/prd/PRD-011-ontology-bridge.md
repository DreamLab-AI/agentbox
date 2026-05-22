---
id: PRD-011
title: VisionClaw Ontology Bridge
status: proposed
date: 2026-05-22
author: Dr John O'Hare
parent: PRD-001
depends_on: [ADR-005, ADR-012, ADR-013, ADR-023]
---

# PRD-011 — VisionClaw Ontology Bridge

## Problem

Agentbox has `[skills.ontology] enabled = false` as a placeholder and no
connection to the rich OWL2 DL ontology / knowledge graph infrastructure
in VisionClaw. VisionClaw maintains an Oxigraph SPARQL 1.1 quad-store
with named-graph segregation (asserted ontology, inferred axioms,
knowledge graph, agent telemetry), Whelk-rs EL++ reasoning, and a full
REST + WebSocket API surface at port 4000 — all on the shared
`visionclaw_network` Docker network.

Agents inside agentbox currently have no way to:
1. Query the knowledge graph (search nodes, traverse edges, pathfinding)
2. Look up ontology classes (OWL class metadata, hierarchy, properties)
3. Submit new axioms or knowledge for reasoning
4. Receive real-time graph updates

## Solution

An **ontology bridge adapter** that exposes VisionClaw's ontology and
knowledge graph services as MCP tools available to agentbox agents,
following the existing adapter architecture (ADR-005) and pluggable
through the `[skills.ontology]` manifest gate.

## Workstreams

### W1: Ontology Bridge MCP Server

A lightweight Node.js MCP server (`mcp/servers/ontology-bridge.js`) that
proxies to VisionClaw's REST API at `http://webxr:4000/api/`.

**Tools exposed:**

| MCP Tool | VisionClaw Endpoint | Purpose |
|----------|-------------------|---------|
| `ontology_search` | GET `/graph/paginated` | Search nodes by label/metadata |
| `ontology_class_get` | GET `/ontology/health` + SPARQL | Get OWL class by IRI |
| `ontology_class_list` | SPARQL query | List classes in a domain |
| `ontology_axiom_add` | POST `/ontology/load` | Submit new axiom for reasoning |
| `ontology_validate` | POST `/ontology/validate` | Validate ontology consistency |
| `ontology_graph_query` | SPARQL via POST | Execute arbitrary SPARQL SELECT |
| `ontology_health` | GET `/ontology/health` | Check ontology service status |
| `kg_node_search` | GET `/graph/paginated` | Knowledge graph node search |
| `kg_neighbors` | SPARQL query | Get node neighbors + edge metadata |
| `kg_pathfind` | SPARQL + cached SSSP | Shortest path between nodes |

### W2: Manifest Integration

- Enable `[skills.ontology]` gate in `agentbox.toml`
- Add `visionclaw_api_url` config key (default: `http://webxr:4000`)
- Register ontology-bridge in `.mcp.json` generation (entrypoint-unified.sh)
- Health check: bridge verifies VisionClaw reachability at startup

### W3: URN Cross-Resolution

Extend `management-api/lib/uris.js` to resolve `urn:visionclaw:concept:*`
and `urn:visionclaw:kg:*` URNs by proxying to VisionClaw's API. The BC20
anti-corruption layer maps between `urn:agentbox:*` and `urn:visionclaw:*`
at the federation boundary.

### W4: Real-Time Graph Sync (Phase 2)

WebSocket bridge to VisionClaw's `/wss` binary protocol for real-time
graph topology updates. Deferred to post-alpha.

## Acceptance Criteria

- [ ] `ontology_search` returns results when VisionClaw is running
- [ ] `ontology_class_get` resolves OWL class metadata by IRI
- [ ] `ontology_graph_query` executes SPARQL and returns bindings
- [ ] `kg_node_search` finds knowledge graph nodes by label substring
- [ ] Bridge returns structured error when VisionClaw is unreachable
- [ ] `[skills.ontology] enabled = false` prevents bridge registration
- [ ] Zero impact on agentbox startup when VisionClaw is absent
