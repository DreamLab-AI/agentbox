# AgentDB Overview

Shared reference for all AgentDB skills. Individual skills should link here rather than duplicating this content.

---

## What is AgentDB?

AgentDB is a high-performance vector database for AI agent memory, learning, and retrieval. It provides persistent storage with HNSW indexing, quantization, caching, and reasoning agent integration. AgentDB serves as the unified memory backend for agentic-flow, replacing legacy ReasoningBank with 100% backward compatibility.

## Performance Claims

- **Vector Search**: <100us (HNSW indexing)
- **Pattern Retrieval**: <1ms (with cache)
- **Batch Insert**: 2ms for 100 vectors (500x faster than individual inserts)
- **Large-scale Query**: 8ms at 1M vectors (12,500x faster than linear scan)
- **Memory Efficiency**: 4-32x reduction with quantization
- **Scalability**: Handles 1M+ vectors efficiently

### Benchmark Results

```bash
# Run comprehensive benchmarks
npx agentdb@latest benchmark

# Results:
# Pattern Search: 150x faster (100us vs 15ms)
# Batch Insert: 500x faster (2ms vs 1s for 100 vectors)
# Large-scale Query: 12,500x faster (8ms vs 100s at 1M vectors)
# Memory Efficiency: 4-32x reduction with quantization
```

**Test System**: AMD Ryzen 9 5950X, 64GB RAM

| Operation | Vector Count | No Optimization | Optimized | Improvement |
|-----------|-------------|-----------------|-----------|-------------|
| Search | 10K | 15ms | 100us | 150x |
| Search | 100K | 150ms | 120us | 1,250x |
| Search | 1M | 100s | 8ms | 12,500x |
| Batch Insert (100) | - | 1s | 2ms | 500x |
| Memory Usage | 1M | 3GB | 96MB | 32x (binary) |

---

## Architecture

### Core Components

1. **Vector Storage** - SQLite-backed persistent vector database with configurable dimensions
2. **HNSW Indexing** - Hierarchical Navigable Small World graph for O(log n) approximate nearest neighbour search
3. **Quantization Engine** - Binary (32x), scalar (4x), and product (8-16x) quantization for memory reduction
4. **In-Memory Cache** - LRU cache (configurable size) for sub-millisecond pattern retrieval
5. **Reasoning Agents** - Four modules: PatternMatcher, ContextSynthesizer, MemoryOptimizer, ExperienceCurator
6. **Learning Plugins** - 9 reinforcement learning algorithms (Decision Transformer, Q-Learning, SARSA, Actor-Critic, and more)

### Quantization Options

| Type | Memory Reduction | Speed Gain | Accuracy Loss | Best For |
|------|-----------------|------------|---------------|----------|
| Binary | 32x | 10x | 2-5% | Large-scale (1M+), mobile/edge |
| Scalar | 4x | 3x | 1-2% | Production, balanced performance |
| Product | 8-16x | 5x | 3-7% | High-dimensional embeddings |
| None | 1x | 1x | 0% | Maximum accuracy, small datasets |

### Distance Metrics

- **Cosine Similarity** (default) - Best for text embeddings, semantic search
- **Euclidean (L2)** - Best for spatial data, image embeddings
- **Dot Product** - Best for pre-normalised vectors, fast computation

---

## Prerequisites

- Node.js 18+
- AgentDB v1.0.7+ (via `agentic-flow` or standalone `agentdb`)

---

## Common CLI Operations

### Initialise Database

```bash
npx agentdb@latest init ./vectors.db
npx agentdb@latest init ./vectors.db --dimension 768
npx agentdb@latest init ./vectors.db --preset large
npx agentdb@latest init ./vectors.db --in-memory
```

### Query Database

```bash
npx agentdb@latest query ./vectors.db "[0.1,0.2,0.3,...]" -k 10
npx agentdb@latest query ./vectors.db "[...]" -m cosine -t 0.75
npx agentdb@latest query ./vectors.db "[...]" -f json
```

### Import/Export

```bash
npx agentdb@latest export ./vectors.db ./backup.json
npx agentdb@latest import ./backup.json
npx agentdb@latest stats ./vectors.db
```

### MCP Server (Claude Code Integration)

```bash
npx agentdb@latest mcp
claude mcp add agentdb npx agentdb@latest mcp
```

---

## Common API Pattern

```typescript
import { createAgentDBAdapter } from 'agentic-flow/reasoningbank';

const adapter = await createAgentDBAdapter({
  dbPath: '.agentdb/reasoningbank.db',
  enableLearning: true,
  enableReasoning: true,
  quantizationType: 'scalar',  // binary | scalar | product | none
  cacheSize: 1000,
});

// Store a pattern
await adapter.insertPattern({
  id: '',
  type: 'pattern',
  domain: 'my-domain',
  pattern_data: JSON.stringify({
    embedding: myEmbedding,
    text: 'content',
  }),
  confidence: 0.95,
  usage_count: 1,
  success_count: 1,
  created_at: Date.now(),
  last_used: Date.now(),
});

// Retrieve with reasoning
const result = await adapter.retrieveWithReasoning(queryEmbedding, {
  domain: 'my-domain',
  k: 10,
  useMMR: true,
  synthesizeContext: true,
});
```

---

## Environment Variables

```bash
AGENTDB_PATH=.agentdb/reasoningbank.db
AGENTDB_ENABLED=true
AGENTDB_QUANTIZATION=binary     # binary|scalar|product|none
AGENTDB_CACHE_SIZE=2000
AGENTDB_HNSW_M=16
AGENTDB_HNSW_EF=100
AGENTDB_LEARNING=true
AGENTDB_REASONING=true
```

---

## Links

- **GitHub**: https://github.com/ruvnet/agentic-flow/tree/main/packages/agentdb
- **Website**: https://agentdb.ruv.io
- **MCP Integration**: `npx agentdb@latest mcp`
- **Documentation**: `node_modules/agentic-flow/docs/AGENTDB_INTEGRATION.md`
