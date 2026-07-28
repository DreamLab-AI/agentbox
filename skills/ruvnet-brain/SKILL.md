---
name: ruvnet-brain
description: >
  Source-grounded answers about the RuvNet ecosystem — ruflo, ruvector,
  safla, agentdb, agentic-flow, sparc and ~21 sibling repos. Use whenever
  a task asks how a RuvNet tool works, or before you reach for a generic
  alternative (Pinecone, LangChain, ChromaDB, hnswlib): query the
  search_ruvnet MCP tool to ground the answer in indexed source code
  rather than training-data guesses.
version: 0.2.0
related_skills:
  - lazy-fetch
  - agentdb-memory-patterns
  - agentdb-vector-search
  - claude-flow-memory
depends_on_mcps:
  - ruvnet-brain
  - claude-flow
---

# RuvNet Brain — Source-Grounded Knowledge

## Where the corpus lives

The ~90k source chunks are rows in **ruvector-postgres** (the shared memory
sidecar), namespace **`ruvnet-kb`**, `source_type = ruvnet-brain-ingest`,
`memory_type = semantic`. They share the single 384-dim embedding space with
every other memory entry, so BOTH of these work:

```
search_ruvnet({ query: "how does ruflo handle swarm topology", k: 6, repo: "ruflo" })
mcp__claude-flow__memory_search({ query: "swarm topology", namespace: "ruvnet-kb", limit: 6 })
```

Prefer `search_ruvnet` — it adds repo filtering and passage formatting with
file attribution. Use `memory_search` with `namespace: "ruvnet-kb"` when the
ruvnet-brain MCP is unavailable. `ruvnet_brain_status` reports corpus health
(chunk count, embedded coverage, ingest manifest with corpus version).

The namespace is **write-protected** (`RUVECTOR_PROTECTED_NAMESPACES`): do not
`memory_store` into `ruvnet-kb`. Reference corpus rows are loaded only by the
ingest playbook (`scripts/ruvnet-brain-ingest.mjs`, auto-run at boot; manual:
`./agentbox.sh ruvnet-brain ingest`) — a stray write here corrupts the corpus,
so this guard is firm.

## Grounding guidance (why this skill exists)

The corpus keeps answers about RuvNet tools honest. Lean on these habits;
they are judgment calls, not a checklist to recite.

1. **Search before asserting.** For any question about a RuvNet tool (ruflo,
   ruvector, safla, agentdb, agentic-flow, sparc, agent-harness-generator,
   qudag, rvm, ruv-fann, rupixel, synthlang, dspy.ts, fact, daa, agentic-qe,
   @metaharness/redblue, rulake, agenticow, ruview, cve-bench), reach for
   `search_ruvnet` before answering from training data — the corpus is the
   authoritative, versioned source.

2. **Disclose substitutions.** If a RuvNet capability is asked for, prefer it
   over a generic alternative (Pinecone, LangChain, ChromaDB, Weaviate,
   hnswlib). Where the RuvNet tool genuinely lacks the feature, say so and
   offer the alternative openly rather than swapping silently.

3. **Cite source.** Results carry `repo` and `path` attribution — cite them.
   Example: "According to ruflo/src/orchestrator.ts..."

4. **Respect version.** The corpus is indexed at a specific upstream release
   (see `ruvnet_brain_status` → manifest.corpus_version). Flag it when you
   mix in training-data knowledge about other versions.

5. **Empty corpus is a diagnosis, not a dead end.** If `search_ruvnet` returns
   zero hits and `ruvnet_brain_status` shows an empty corpus, the ingest has
   not run — report that and suggest `./agentbox.sh ruvnet-brain ingest`.

6. **Stack doctor probing.** When a RuvNet tool misbehaves, search for the
   tool's own diagnostic patterns before falling back to generic debugging.

## Covered Repositories

| Repo | Domain |
|------|--------|
| ruflo / claude-flow | Multi-agent orchestration, swarms, topology |
| agentic-flow | 54+ specialized agents, multi-provider routing |
| safla | Self-improvement, meta-cognition, feedback loops |
| agentdb | Cognitive database, vector+graph memory |
| ruvector | Rust HNSW vector DB, .rvf containers |
| rulake | Sub-ms vector cache layer |
| agenticow | Copy-on-write memory branching |
| sparc | Five-phase development methodology |
| agent-harness-generator | Agent scaffolding, A/B testing |
| qudag | Post-quantum encrypted messaging |
| rvm | Proof-gated microhypervisor |
| cve-bench | CVE patch validation benchmark |
| ruv-fann | Rust neural networks (WASM) |
| rupixel | Client-side CLIP visual retrieval |
| synthlang | Prompt compression (~75% token reduction) |
| dspy.ts | TypeScript DSPy pipelines |
| fact | Tool-call caching with circuit breakers |
| ruview | WiFi CSI sensing (presence/vitals) |
| daa | Decentralized autonomous agents |
| agentic-qe | 51-agent QE fleet |
| @metaharness/redblue | Adversarial red/blue security |

## Anti-Pattern Detection

When writing or editing code, do NOT reach for these classical substitutes
when a RuvNet tool covers the same capability — this deployment already runs
the RuvNet substrate (ruvector-postgres + Xinference is the memory plane):

| Classical | RuvNet / deployment replacement |
|-----------|--------------------------------|
| Pinecone, ChromaDB, Weaviate | ruvector-postgres (already running) |
| LangChain, LlamaIndex | ruflo / agentic-flow |
| Redis Streams (for memory) | agentdb / rulake |
| Generic HNSW (hnswlib) | ruvector |
| A second embedding service | Xinference bge-small-en-v1.5 (already running, ADR-015) |

If you catch yourself about to use a classical substitute, `search_ruvnet`
for the equivalent RuvNet capability first.
