---
name: agentdb-memory-patterns
description: "Implement persistent memory patterns for AI agents using AgentDB — session memory, long-term storage, pattern learning, hierarchical memory, consolidation, ReasoningBank migration. Use when building stateful agents, chat systems, or intelligent assistants. NOT for distributed multi-DB/QUIC sync or RL algorithms (use agentdb-advanced), vector-search perf tuning (use agentdb-vector-search), or non-persistent session state."
---

# AgentDB Memory Patterns

For AgentDB architecture and performance overview, see [AgentDB Overview](../agentdb-advanced/docs/agentdb-overview.md).

## What This Skill Covers

Memory management patterns for AI agents: session memory, long-term storage, pattern learning, hierarchical memory organisation, memory consolidation, and ReasoningBank migration. For CLI setup, API initialisation, and common operations, see the [AgentDB Overview](../agentdb-advanced/docs/agentdb-overview.md).

**Additional Prerequisites**: Understanding of agent architectures.

## When Not To Use

- For distributed multi-database setups or QUIC sync -- use the agentdb-advanced skill instead
- For reinforcement learning algorithms -- use the **agentdb-advanced** skill (RL Plugins section) instead
- For pure vector search performance tuning (quantisation, HNSW) -- use the agentdb-vector-search skill instead
- For non-persistent, session-only state that does not need vector search -- standard in-memory data structures suffice
- For unified development and quality engineering workflows -- use the build-with-quality skill which includes memory management

## Pattern Reference

Full code examples live in [references/pattern-examples.md](references/pattern-examples.md):

- **Session Memory** — per-session message store with time-ordered history.
- **Long-Term Memory** — categorised facts with confidence and source.
- **Pattern Learning** — record successful trigger→response pairs and match them against live context.
- **Hierarchical Memory** — organise across immediate / short-term / long-term / semantic tiers.
- **Memory Consolidation** — periodic importance-based pruning to a size/score threshold.
- **ReasoningBank Integration** — migrate a legacy `.swarm/memory.db`, train the learning model, and retrieve with reasoning.

For learning plugins and RL algorithms, see the [agentdb-advanced](../agentdb-advanced/SKILL.md) skill (RL Plugins section). For performance tuning and quantization, see the [agentdb-vector-search](../agentdb-vector-search/SKILL.md) skill.

## KHIVE-Informed Enhancements (v2.0 Roadmap)

Proposed enhancements from KHIVE v2 comparison — orient cold-start dashboard, importance-weighted storage, entity-relationship graph, task dependency DAG, tag retrieval path, and URI/URN addressing. Full proposal with schemas and code in [references/khive-v2-roadmap.md](references/khive-v2-roadmap.md); underlying analysis in [KHIVE-LEARNINGS.md](KHIVE-LEARNINGS.md).

## Troubleshooting

### Issue: Memory growing too large
```bash
# Check database size
npx agentdb@latest stats ./agents.db

# Enable quantization
# Use 'binary' (32x smaller) or 'scalar' (4x smaller)
```

### Issue: Slow search performance
```bash
# Enable HNSW indexing and caching
# Results: <100µs search time
```

### Issue: Migration from legacy ReasoningBank
```bash
# Automatic migration with validation
npx agentdb@latest migrate --source .swarm/memory.db
```

## Learn More

For performance benchmarks, see [AgentDB Overview](../agentdb-advanced/docs/agentdb-overview.md#performance-claims). For general links, see [AgentDB Overview](../agentdb-advanced/docs/agentdb-overview.md#links).
