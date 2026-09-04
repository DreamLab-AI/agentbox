---
name: ruvnet-brain
description: >
  Source-grounded answers about the RuvNet ecosystem — ruflo, ruvector,
  safla, agentdb, agentic-flow, sparc and ~21 sibling repos. Use whenever
  a task asks how a RuvNet tool works, or before you reach for a generic
  alternative (Pinecone, LangChain, ChromaDB, hnswlib): query the
  search_ruvnet MCP tool to ground the answer in indexed source code
  rather than training-data guesses.
version: 0.3.0
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

The ~147k source chunks (186 repos, corpus **v4.2.2-dev**, reconciled 2026-08-21)
are rows in **ruvector-postgres** (the shared memory sidecar), namespace
**`ruvnet-kb`**, `source_type = ruvnet-brain-ingest`, `memory_type = semantic`.
They share the single 384-dim embedding space with every other memory entry,
so BOTH of these work:

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

## Keeping the corpus current (periodic update playbook)

The upstream corpus is a GitHub release asset that moves independently of this
deployment (`stuinfla/ruvnet-brain` `releases/latest/download/ruvnet-brain.zip`).
The ingest is fully idempotent: it discovers the latest tag via the release
redirect, fast no-ops when the stamped `corpus_version` matches, and on a real
bump embeds only new/changed chunks (content-addressed keys) and prunes rows
absent from the new corpus. The 2026-08-14 v3.3.1→v4.0.36 reconcile embedded
6,259 and pruned 1,807 of 136,439 chunks in ~7 min.

Procedure (run whenever staleness is suspected; safe to run any time):

```bash
./agentbox.sh ruvnet-brain status    # compare manifest corpus_version vs upstream
./agentbox.sh ruvnet-brain ingest    # reconcile (no-op if current)
# AFTER any real delta (embedded+pruned > 0): the index-law applies —
# non-concurrent HNSW rebuild, NEVER CREATE INDEX CONCURRENTLY on this AM:
docker exec ruvector-postgres psql -U ruvector -d ruvector \
  -c "DROP INDEX idx_memory_embedding_hnsw;" \
  -c "CREATE INDEX idx_memory_embedding_hnsw ON public.memory_entries
      USING hnsw (embedding ruvector_cosine_ops)
      WITH (m='16', ef_construction='128');"   # ~5-7 min; memory WRITES BLOCK meanwhile
./agentbox.sh ruvector recall        # gate: frozen band must hold
```

Post-bump gate expectations (observed 2026-08-14): a corpus bump that PRUNES
rows will drift the frozen recall fixture (pruned ids no longer resolve; the
harness refuses to pass on drift by design). Remediation:
`./agentbox.sh ruvector recall --build-fixture --force`, then re-run the gate.
Note the fresh-fixture medians land near the reference doc's post-rebuild
recovery values (measured v4.0.36: self 180/200, true 106/120, exact-token
Δ+6) — the harness header band (≥187/≥118) was frozen for the previous
fixture/corpus and will read FAIL until a human re-freezes the band. Do not
adjust the band automatically; surface it.

Deployment traps (all hit and fixed 2026-08-14 — do not regress):
- `RUVNET_BRAIN_STAGING` must point at the **workspace volume**
  (`/home/devuser/workspace/.tmp/ruvnet-brain-staging`, set by the manifest
  and `agentbox.sh`): `/var/lib/agentbox/...` is read-only rootfs and the
  general `~/.cache` mount is bounded — neither is valid corpus scratch.
- `ruvnet-brain` must be in `agentbox.sh`'s argument-parser whitelist as well
  as its dispatcher (it was dispatcher-only, i.e. unreachable, until 2026-08-14).
- The rebuild is done via `docker exec ruvector-postgres psql` — the agentbox
  container itself has no `psql` binary.

Corpus coverage note: `dream-machine` **joined the corpus at v4.2.2-dev**
(2026-08-21; it was absent through v4.0.36) — `search_ruvnet({repo:
"dream-machine"})` now works, with the local checkout at
`/home/devuser/workspace/dream-machine` as the fork-accurate source of truth
(the corpus indexes upstream). For **dreaming/self-improvement-loop questions**
the corpus anchors are instead: `agentic-qe`
(`docs/aqe-dream-cycles-neural-learning.md`, `DREAM_SCHEDULER_DESIGN.md`,
`docs/plans/nightly-learner-implementation-plan.md` — trigger design, insight
gating, baseline/A-B discipline) and `ruvector`
(`examples/ruvLLM/docs/SONA/05-MEMORY-DREAMS.md` — generate→evaluate→integrate
dream pipeline). The deployed nightly loop itself is the agentbox
`services/dream-engine` (ADR-052, `/dream` command, supervisord-owned since the
2026-08 rebuild — never also start the old tmux-autostart copy; a duplicate
loop races HP-annexe dispatch/cleanup and turns nights INCONCLUSIVE, observed
2026-08-20/21). v4.0.36 added, among others: the full
`cognitum-*` family, `agentic-security`, `agentic-robotics`, `ruv-gists`,
`worldgraph`, `skygraph` (62 repos total).

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
