---
name: agentdb-advanced
description: "Advanced AgentDB beyond single-database vector search: distributed QUIC sync across nodes, multi-database coordination and sharding, custom distance metrics, hybrid vector+metadata search, MMR diversity, context synthesis, and reinforcement-learning plugins. Use when an AgentDB deployment needs cross-node sync, cross-database routing, filtered/weighted hybrid retrieval, or self-improving RL agents."
---

# AgentDB Advanced Features

Distributed and advanced AgentDB patterns. For AgentDB architecture, performance
benchmarks, and common API patterns, see [AgentDB Overview](./docs/agentdb-overview.md).

## When to use

Reach for this skill when a plain AgentDB setup no longer covers the need:

- **Distributed sync** — keep patterns consistent across AgentDB instances on
  different hosts (QUIC).
- **Multiple / sharded databases** — route or scale across separate `.db` files.
- **Advanced retrieval** — custom distance metrics, hybrid vector+metadata
  filtering, weighted scoring, MMR diversity, or synthesized context.
- **Reinforcement learning** — build self-improving agents that train on logged
  experience (9 RL algorithms).

## When not to use

- Basic vector search or single-database setups → `agentdb-vector-search`.
- Simple agent memory (session, long-term) → `agentdb-memory-patterns`.
- Performance tuning without distributed features → `agentdb-vector-search`.
- Non-AgentDB vector databases (pgvector, Pinecone, Weaviate) — this skill is
  AgentDB-specific.

**Prerequisites**: distributed-systems basics (for QUIC sync) and vector-search
fundamentals.

## Quick path

```typescript
import { createAgentDBAdapter } from 'agentic-flow/reasoningbank';

// Distributed adapter with QUIC sync + hybrid retrieval
const adapter = await createAgentDBAdapter({
  dbPath: '.agentdb/distributed.db',
  enableQUICSync: true,
  syncPort: 4433,
  syncPeers: ['192.168.1.11:4433', '192.168.1.12:4433'],
});

const result = await adapter.retrieveWithReasoning(queryEmbedding, {
  metric: 'cosine',      // or 'euclidean' | 'dot'
  k: 20,
  useMMR: true,          // diverse results
  filters: { year: { $gte: 2023 } },  // hybrid metadata filter
});
```

## Reference tiers (load on demand)

| Topic | File |
|-------|------|
| QUIC synchronization — enable, config, multi-node deploy, env vars, troubleshooting | [references/quic-sync.md](./references/quic-sync.md) |
| Search features — distance metrics, hybrid/weighted search, MMR, context synthesis | [references/search-features.md](./references/search-features.md) |
| Deployment — multi-database, sharding, connection pooling, error handling, CLI import/export/optimise | [references/deployment.md](./references/deployment.md) |
| Reinforcement-learning plugins — 9 algorithms, training API, decision-transformer config | [references/reinforcement-learning.md](./references/reinforcement-learning.md) |

## Learn more

- **QUIC Protocol**: docs/quic-synchronization.pdf
- **Hybrid Search**: docs/hybrid-search-guide.md
- See [AgentDB Overview](./docs/agentdb-overview.md#links) for general links.

---

**Category**: Advanced / Distributed Systems · **Difficulty**: Advanced ·
**Estimated Time**: 45-60 minutes
