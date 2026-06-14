---
name: "Ontology Augment"
description: "Ground agent reasoning in DreamLab's formal knowledge graph (5,975 OWL classes, Oxigraph/Whelk) via the pervasive ontology binding (PRD-020/ADR-112). Use when you want to ground or augment thinking in the ontology, check what the knowledge graph says about a concept, retrieve a budget-bounded provenance-scoped subgraph (ontology_ask), run read-only SPARQL, find class neighbours or shortest paths, or propose a governed enrichment. Read-pervasive, write-governed; budget-bounded and fail-open so it never bloats the context window or blocks a turn."
---

# Ontology Augment

The **consumption** side of the ontology binding: pull structured knowledge from
the formal KG into reasoning, on demand and within a strict token budget. It is the
sibling of [`ontology-core`](../ontology-core/SKILL.md) (authoring) and
[`ontology-enrich`](../ontology-enrich/SKILL.md) (validation) — those *produce* the
corpus; this one *consumes* it at inference time.

## When To Use

- **Yes** — grounding a claim/design in the ontology, "what does our KG say about X",
  finding related classes, navigating subclass/neighbour structure, checking domain
  maturity before asserting something, or proposing a new fact back into the graph.
- **No** — authoring/exporting the Logseq corpus (use `ontology-core`), validating or
  enriching source markdown (use `ontology-enrich`), or generic RDF unrelated to our
  KG (use plain SPARQL tools).

## How it reaches you (two channels)

| Channel | Trigger | Cost | What you get |
|---|---|---|---|
| **PUSH** | automatic, every turn (hook) | ≤~80 tokens, floor-gated | a one-line breadcrumb naming the most-relevant seed class, *only* when the prompt is on-topic |
| **PULL** | you ask: `ontology_ask` MCP tool / the CLI / a consultant | budget-bounded per model tier | a provenance-scoped Turtle subgraph + breadcrumb + seed IRIs |

PUSH is ambient — you do not invoke it; it appears as `[ONTOLOGY] seed: …` when
relevant and is silent otherwise. PULL is the deliberate deep retrieval.

## Prerequisites

The `ontology-bridge` MCP server (registered in `agentbox/mcp/mcp.json`) must be
loaded; it talks to VisionClaw's Oxigraph/Whelk KG. Env (set in agentbox):

```
VISIONCLAW_API_URL=http://visionclaw-server:4000   # KG backend
VISIONCLAW_DEV_TOKEN=…  AGENTBOX_PUBKEY=…           # power_user read + governed write
CONSULT_ONTOLOGY_AUGMENT=1                          # enable the consultant seam
ONTOLOGY_PUSH_MIN_RELEVANCE=0.11                    # PUSH relevance floor
```

It is **fail-open**: if the backend is unreachable, every call degrades to empty and
the turn continues — grounding is an augmentation, never a dependency.

## Quick Start

Natural language (the MCP tool is matched autonomously):

> "Ground this in our ontology: escrow with an oracle for dispute resolution."
> "What does our knowledge graph say about agent governance?"

Direct MCP tool:

```jsonc
ontology_ask({ "query": "escrow oracle dispute resolution",
               "model_tier": "sonnet", "mode": "expand" })
// → { turtle, breadcrumb, seed_iris, tokens_used, truncated, provenance, degraded }
```

Shell (outside MCP — same retrieval brain):

```bash
node scripts/ontology-ask.cjs "agent governance and elevation backlog" --tier sonnet
node scripts/ontology-ask.cjs "price oracle" --sparql   # emit the read-only SPARQL it would run
```

## Tool surface (read-pervasive, write-governed)

| Tool | Purpose |
|---|---|
| `ontology_ask` | budget-bounded, provenance-scoped subgraph for a concept (primary) |
| `search` / `class_get` / `class_list` | semantic class lookup / fetch / enumerate |
| `graph_query` | read-only SPARQL (SELECT/ASK/DESCRIBE/CONSTRUCT; clamped, SERVICE blocked) |
| `kg_neighbors` / `kg_pathfind` | local neighbourhood / shortest path between classes |
| `ontology_propose` | **governed** writeback — auth-gated, queued for sign-off |

Writes never land directly: proposals go to the governance queue (broker inbox);
derived facts are fenced to the `:summary` graph and may not touch `:assert`/`:inferred`.

## Reference & Examples

- Full tool params, budget/tier model (ADR-116), provenance scoping, maturity gate,
  PUSH mechanics, consultant seam, governed writeback: **[REFERENCE.md](REFERENCE.md)**
- Worked examples with real live outputs + trigger phrasings: **[EXAMPLES.md](EXAMPLES.md)**
