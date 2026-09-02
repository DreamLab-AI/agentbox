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
- **No** — authoring/exporting the vault corpus (use `ontology-core`), validating or
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

## Local route (internal dev path — VisionClaw-free)

When the VisionClaw/Oxigraph service is unreachable (`ontology_health` →
`ontology_unavailable`), the bridge falls back to a **local backend** that indexes
the authored vault markdown corpus on disk and serves the same read tools plus a real
**write** path. No production round-trip, no long loop — it reads the JSON-LD
`Class` block of every page directly.

- **Auto-fallback**: any `ontology_*` / `kg_*` MCP tool that hits a network-family
  error transparently retries against the local corpus (`_route: "local-fallback"`).
- **Force local**: set `AGENTBOX_ONTOLOGY_LOCAL=1` to use the local route
  unconditionally (offline dev).
- **Corpus path**: `VAULT_PAGES` — the `[vault]` path authority in `agentbox.toml`
  that the entrypoint resolves (ADR-2028). `AGENTBOX_ONTOLOGY_LOCAL_PATH` overrides
  it for a scratch corpus. Reflects uncommitted edits immediately. With neither
  set the backend serves an empty index and says so, rather than reading a stale
  tree.
- **Writes**: the local write path edits the JSON-LD fence in place and leaves the
  page in vault format — V2 YAML frontmatter, converting a legacy leading
  `key:: value` block if it finds one (`project/docs/VAULT-corpus-format.md` §V5).

### Use it now from the shell (bypasses the MCP entirely)

```bash
S=/home/devuser/workspace/project/agentbox/mcp/servers
node $S/ontology-local.cjs health
node $S/ontology-local.cjs search "gaussian splatting" --limit 5
node $S/ontology-local.cjs get 3-d-gaussian-splatting
node $S/ontology-local.cjs neighbors 3-d-gaussian-splatting --depth 2
node $S/ontology-local.cjs path <src-slug> <tgt-slug>
node $S/ontology-local.cjs ask "differentiable rendering" --mode menu
# WRITE — edits the page's Class block in place (SubClassOf|relatedTo|contrastsWith|requires|partOf|sameAs)
node $S/ontology-local.cjs add <subject-slug> relatedTo <object-slug>
```

Backend: `mcp/servers/lib/ontology-local.js`; CLI: `mcp/servers/ontology-local.cjs`.

> **Activation note (MCP tools):** the running MCP loads the baked, read-only
> `/opt/agentbox/mcp/servers/ontology-bridge.js`. The source edits above live in the
> repo checkout and become active in-tool only after the agentbox image is rebuilt
> and the MCP restarts. Until then, use the **CLI** for local search/write — it
> resolves the repo `lib/` first, so it is live immediately.
