---
name: agentdb-vector-search
description: "Use when building RAG pipelines, running semantic/similarity vector search, optimising search speed, tuning HNSW indexing or quantization, or scaling to millions of vectors with local AgentDB. Covers CLI, TypeScript API, caching, batch operations, and MCP integration. NOT for distributed multi-database/QUIC sync or RL training plugins (use agentdb-advanced), conversation-memory patterns (use agentdb-memory-patterns), plain full-text search, or cloud vector services (Pinecone/Weaviate)."
---

# AgentDB Vector Search

Semantic vector search, RAG pipelines, similarity matching, quantization and HNSW tuning, caching, batch operations, and MCP server integration with local AgentDB. (Includes all content previously in the deprecated agentdb-optimisation skill.)

For AgentDB architecture and performance overview, see [AgentDB Overview](../agentdb-advanced/docs/agentdb-overview.md).

**Additional prerequisites**: OpenAI API key (for embeddings) or a custom embedding model.

## When Not To Use

- Distributed multi-database or QUIC sync features — use **agentdb-advanced** instead
- Reinforcement learning algorithms and training plugins (Decision Transformer, Q-Learning, SARSA, Actor-Critic, etc.) — use **agentdb-advanced** (RL Plugins section)
- Agent conversation memory and session patterns — use **agentdb-memory-patterns**
- Full-text search without vector embeddings — a standard database with FTS is simpler
- Cloud-managed vector search (Pinecone, Weaviate) — this skill is specific to local AgentDB

## References

Load the relevant reference on demand:

- **[references/cli-cookbook.md](references/cli-cookbook.md)** — CLI recipes: `init` (dimensions, presets, in-memory), `query` (top-k, thresholds, distance metrics, output formats), import/export, and `stats`.
- **[references/api-and-rag.md](references/api-and-rag.md)** — TypeScript API: adapter setup, vector storage, similarity and hybrid search, RAG pipeline, batch operations, HNSW/caching/MMR feature notes, and MCP server integration.
- **[references/performance-and-troubleshooting.md](references/performance-and-troubleshooting.md)** — performance tuning tips and fixes for slow search, high memory, poor relevance, and wrong dimensions.

## Learn More

- CLI Help: `npx agentdb@latest --help`
- Command Help: `npx agentdb@latest help <command>`
- See [AgentDB Overview](../agentdb-advanced/docs/agentdb-overview.md#links) for general links.
