---
name: "AgentDB Advanced Features"
description: "Master advanced AgentDB features including QUIC synchronization, multi-database management, custom distance metrics, hybrid search, and distributed systems integration. Use when building distributed AI systems, multi-agent coordination, or advanced vector search applications."
---

# AgentDB Advanced Features

For AgentDB architecture, performance benchmarks, and common API patterns, see [AgentDB Overview](./docs/agentdb-overview.md).

## What This Skill Covers

QUIC synchronization for distributed systems, multi-database coordination, custom distance metrics, hybrid search (vector + metadata), MMR diversity, context synthesis, and production deployment patterns.

**Additional Prerequisites**: Understanding of distributed systems (for QUIC sync), vector search fundamentals.

## When Not To Use

- For basic vector search or single-database setups -- use the agentdb-vector-search skill instead
- For simple agent memory patterns (session, long-term) -- use the agentdb-memory-patterns skill instead
- For performance tuning without distributed features -- use the agentdb-vector-search skill instead
- For non-AgentDB vector databases (pgvector, Pinecone, Weaviate) -- this skill is AgentDB-specific

---

## QUIC Synchronization

### What is QUIC Sync?

QUIC (Quick UDP Internet Connections) enables sub-millisecond latency synchronization between AgentDB instances across network boundaries with automatic retry, multiplexing, and encryption.

**Benefits**:
- <1ms latency between nodes
- Multiplexed streams (multiple operations simultaneously)
- Built-in encryption (TLS 1.3)
- Automatic retry and recovery
- Event-based broadcasting

### Enable QUIC Sync

```typescript
import { createAgentDBAdapter } from 'agentic-flow/reasoningbank';

// Initialize with QUIC synchronization
const adapter = await createAgentDBAdapter({
  dbPath: '.agentdb/distributed.db',
  enableQUICSync: true,
  syncPort: 4433,
  syncPeers: [
    '192.168.1.10:4433',
    '192.168.1.11:4433',
    '192.168.1.12:4433',
  ],
});

// Patterns automatically sync across all peers
await adapter.insertPattern({
  // ... pattern data
});

// Available on all peers within ~1ms
```

### QUIC Configuration

```typescript
const adapter = await createAgentDBAdapter({
  enableQUICSync: true,
  syncPort: 4433,              // QUIC server port
  syncPeers: ['host1:4433'],   // Peer addresses
  syncInterval: 1000,          // Sync interval (ms)
  syncBatchSize: 100,          // Patterns per batch
  maxRetries: 3,               // Retry failed syncs
  compression: true,           // Enable compression
});
```

### Multi-Node Deployment

```bash
# Node 1 (192.168.1.10)
AGENTDB_QUIC_SYNC=true \
AGENTDB_QUIC_PORT=4433 \
AGENTDB_QUIC_PEERS=192.168.1.11:4433,192.168.1.12:4433 \
node server.js

# Node 2 (192.168.1.11)
AGENTDB_QUIC_SYNC=true \
AGENTDB_QUIC_PORT=4433 \
AGENTDB_QUIC_PEERS=192.168.1.10:4433,192.168.1.12:4433 \
node server.js

# Node 3 (192.168.1.12)
AGENTDB_QUIC_SYNC=true \
AGENTDB_QUIC_PORT=4433 \
AGENTDB_QUIC_PEERS=192.168.1.10:4433,192.168.1.11:4433 \
node server.js
```

---

## Distance Metrics

### Cosine Similarity (Default)

Best for normalized vectors, semantic similarity:

```bash
# CLI
npx agentdb@latest query ./vectors.db "[0.1,0.2,...]" -m cosine

# API
const result = await adapter.retrieveWithReasoning(queryEmbedding, {
  metric: 'cosine',
  k: 10,
});
```

**Use Cases**:
- Text embeddings (BERT, GPT, etc.)
- Semantic search
- Document similarity
- Most general-purpose applications

**Formula**: `cos(θ) = (A · B) / (||A|| × ||B||)`
**Range**: [-1, 1] (1 = identical, -1 = opposite)

### Euclidean Distance (L2)

Best for spatial data, geometric similarity:

```bash
# CLI
npx agentdb@latest query ./vectors.db "[0.1,0.2,...]" -m euclidean

# API
const result = await adapter.retrieveWithReasoning(queryEmbedding, {
  metric: 'euclidean',
  k: 10,
});
```

**Use Cases**:
- Image embeddings
- Spatial data
- Computer vision
- When vector magnitude matters

**Formula**: `d = √(Σ(ai - bi)²)`
**Range**: [0, ∞] (0 = identical, ∞ = very different)

### Dot Product

Best for pre-normalized vectors, fast computation:

```bash
# CLI
npx agentdb@latest query ./vectors.db "[0.1,0.2,...]" -m dot

# API
const result = await adapter.retrieveWithReasoning(queryEmbedding, {
  metric: 'dot',
  k: 10,
});
```

**Use Cases**:
- Pre-normalized embeddings
- Fast similarity computation
- When vectors are already unit-length

**Formula**: `dot = Σ(ai × bi)`
**Range**: [-∞, ∞] (higher = more similar)

### Custom Distance Metrics

```typescript
// Implement custom distance function
function customDistance(vec1: number[], vec2: number[]): number {
  // Weighted Euclidean distance
  const weights = [1.0, 2.0, 1.5, ...];
  let sum = 0;
  for (let i = 0; i < vec1.length; i++) {
    sum += weights[i] * Math.pow(vec1[i] - vec2[i], 2);
  }
  return Math.sqrt(sum);
}

// Use in search (requires custom implementation)
```

---

## Hybrid Search (Vector + Metadata)

### Basic Hybrid Search

Combine vector similarity with metadata filtering:

```typescript
// Store documents with metadata
await adapter.insertPattern({
  id: '',
  type: 'document',
  domain: 'research-papers',
  pattern_data: JSON.stringify({
    embedding: documentEmbedding,
    text: documentText,
    metadata: {
      author: 'Jane Smith',
      year: 2025,
      category: 'machine-learning',
      citations: 150,
    }
  }),
  confidence: 1.0,
  usage_count: 0,
  success_count: 0,
  created_at: Date.now(),
  last_used: Date.now(),
});

// Hybrid search: vector similarity + metadata filters
const result = await adapter.retrieveWithReasoning(queryEmbedding, {
  domain: 'research-papers',
  k: 20,
  filters: {
    year: { $gte: 2023 },          // Published 2023 or later
    category: 'machine-learning',   // ML papers only
    citations: { $gte: 50 },       // Highly cited
  },
});
```

### Advanced Filtering

```typescript
// Complex metadata queries
const result = await adapter.retrieveWithReasoning(queryEmbedding, {
  domain: 'products',
  k: 50,
  filters: {
    price: { $gte: 10, $lte: 100 },      // Price range
    category: { $in: ['electronics', 'gadgets'] },  // Multiple categories
    rating: { $gte: 4.0 },                // High rated
    inStock: true,                        // Available
    tags: { $contains: 'wireless' },      // Has tag
  },
});
```

### Weighted Hybrid Search

Combine vector and metadata scores:

```typescript
const result = await adapter.retrieveWithReasoning(queryEmbedding, {
  domain: 'content',
  k: 20,
  hybridWeights: {
    vectorSimilarity: 0.7,  // 70% weight on semantic similarity
    metadataScore: 0.3,     // 30% weight on metadata match
  },
  filters: {
    category: 'technology',
    recency: { $gte: Date.now() - 30 * 24 * 3600000 },  // Last 30 days
  },
});
```

---

## Multi-Database Management

### Multiple Databases

```typescript
// Separate databases for different domains
const knowledgeDB = await createAgentDBAdapter({
  dbPath: '.agentdb/knowledge.db',
});

const conversationDB = await createAgentDBAdapter({
  dbPath: '.agentdb/conversations.db',
});

const codeDB = await createAgentDBAdapter({
  dbPath: '.agentdb/code.db',
});

// Use appropriate database for each task
await knowledgeDB.insertPattern({ /* knowledge */ });
await conversationDB.insertPattern({ /* conversation */ });
await codeDB.insertPattern({ /* code */ });
```

### Database Sharding

```typescript
// Shard by domain for horizontal scaling
const shards = {
  'domain-a': await createAgentDBAdapter({ dbPath: '.agentdb/shard-a.db' }),
  'domain-b': await createAgentDBAdapter({ dbPath: '.agentdb/shard-b.db' }),
  'domain-c': await createAgentDBAdapter({ dbPath: '.agentdb/shard-c.db' }),
};

// Route queries to appropriate shard
function getDBForDomain(domain: string) {
  const shardKey = domain.split('-')[0];  // Extract shard key
  return shards[shardKey] || shards['domain-a'];
}

// Insert to correct shard
const db = getDBForDomain('domain-a-task');
await db.insertPattern({ /* ... */ });
```

---

## MMR (Maximal Marginal Relevance)

Retrieve diverse results to avoid redundancy:

```typescript
// Without MMR: Similar results may be redundant
const standardResults = await adapter.retrieveWithReasoning(queryEmbedding, {
  k: 10,
  useMMR: false,
});

// With MMR: Diverse, non-redundant results
const diverseResults = await adapter.retrieveWithReasoning(queryEmbedding, {
  k: 10,
  useMMR: true,
  mmrLambda: 0.5,  // Balance relevance (0) vs diversity (1)
});
```

**MMR Parameters**:
- `mmrLambda = 0`: Maximum relevance (may be redundant)
- `mmrLambda = 0.5`: Balanced (default)
- `mmrLambda = 1`: Maximum diversity (may be less relevant)

**Use Cases**:
- Search result diversification
- Recommendation systems
- Avoiding echo chambers
- Exploratory search

---

## Context Synthesis

Generate rich context from multiple memories:

```typescript
const result = await adapter.retrieveWithReasoning(queryEmbedding, {
  domain: 'problem-solving',
  k: 10,
  synthesizeContext: true,  // Enable context synthesis
});

// ContextSynthesizer creates coherent narrative
console.log('Synthesized Context:', result.context);
// "Based on 10 similar problem-solving attempts, the most effective
//  approach involves: 1) analyzing root cause, 2) brainstorming solutions,
//  3) evaluating trade-offs, 4) implementing incrementally. Success rate: 85%"

console.log('Patterns:', result.patterns);
// Extracted common patterns across memories
```

---

## Production Patterns

### Connection Pooling

```typescript
// Singleton pattern for shared adapter
class AgentDBPool {
  private static instance: AgentDBAdapter;

  static async getInstance() {
    if (!this.instance) {
      this.instance = await createAgentDBAdapter({
        dbPath: '.agentdb/production.db',
        quantizationType: 'scalar',
        cacheSize: 2000,
      });
    }
    return this.instance;
  }
}

// Use in application
const db = await AgentDBPool.getInstance();
const results = await db.retrieveWithReasoning(queryEmbedding, { k: 10 });
```

### Error Handling

```typescript
async function safeRetrieve(queryEmbedding: number[], options: any) {
  try {
    const result = await adapter.retrieveWithReasoning(queryEmbedding, options);
    return result;
  } catch (error) {
    if (error.code === 'DIMENSION_MISMATCH') {
      console.error('Query embedding dimension mismatch');
      // Handle dimension error
    } else if (error.code === 'DATABASE_LOCKED') {
      // Retry with exponential backoff
      await new Promise(resolve => setTimeout(resolve, 100));
      return safeRetrieve(queryEmbedding, options);
    }
    throw error;
  }
}
```

### Monitoring and Logging

```typescript
// Performance monitoring
const startTime = Date.now();
const result = await adapter.retrieveWithReasoning(queryEmbedding, { k: 10 });
const latency = Date.now() - startTime;

if (latency > 100) {
  console.warn('Slow query detected:', latency, 'ms');
}

// Log statistics
const stats = await adapter.getStats();
console.log('Database Stats:', {
  totalPatterns: stats.totalPatterns,
  dbSize: stats.dbSize,
  cacheHitRate: stats.cacheHitRate,
  avgSearchLatency: stats.avgSearchLatency,
});
```

---

## CLI Advanced Operations

### Database Import/Export

```bash
# Export with compression
npx agentdb@latest export ./vectors.db ./backup.json.gz --compress

# Import from backup
npx agentdb@latest import ./backup.json.gz --decompress

# Merge databases
npx agentdb@latest merge ./db1.sqlite ./db2.sqlite ./merged.sqlite
```

### Database Optimisation

```bash
# Vacuum database (reclaim space)
sqlite3 .agentdb/vectors.db "VACUUM;"

# Analyze for query optimization
sqlite3 .agentdb/vectors.db "ANALYZE;"

# Rebuild indices
npx agentdb@latest reindex ./vectors.db
```

---

## QUIC Environment Variables

```bash
AGENTDB_QUIC_SYNC=true
AGENTDB_QUIC_PORT=4433
AGENTDB_QUIC_PEERS=host1:4433,host2:4433
```

For common AgentDB environment variables, see [AgentDB Overview](./docs/agentdb-overview.md#environment-variables).

---

## Troubleshooting

### Issue: QUIC sync not working

```bash
# Check firewall allows UDP port 4433
sudo ufw allow 4433/udp

# Verify peers are reachable
ping host1

# Check QUIC logs
DEBUG=agentdb:quic node server.js
```

### Issue: Hybrid search returns no results

```typescript
// Relax filters
const result = await adapter.retrieveWithReasoning(queryEmbedding, {
  k: 100,  // Increase k
  filters: {
    // Remove or relax filters
  },
});
```

### Issue: Memory consolidation too aggressive

```typescript
// Disable automatic optimization
const result = await adapter.retrieveWithReasoning(queryEmbedding, {
  optimizeMemory: false,  // Disable auto-consolidation
  k: 10,
});
```

---

## Reinforcement Learning Plugins

*RL capabilities merged from agentdb-learning. Use to build self-improving agents trained through experience.*

### Quick Start

```bash
# Interactive wizard
npx agentdb@latest create-plugin

# Use specific template (recommended: decision-transformer)
npx agentdb@latest create-plugin -t decision-transformer -n my-agent

# Preview without creating
npx agentdb@latest create-plugin -t q-learning --dry-run
```

### Available Algorithms (9 Total)

| Algorithm | Type | Best For |
|-----------|------|----------|
| **Decision Transformer** *(recommended)* | Offline RL | Logged experience, imitation learning, safe training |
| **Q-Learning** | Value-Based (Off-Policy) | Discrete actions, navigation, resource allocation |
| **SARSA** | Value-Based (On-Policy) | Safety-critical, risk-sensitive tasks |
| **Actor-Critic** | Policy Gradient | Continuous control, continuous/discrete action spaces |
| **Active Learning** | Query-Based | Human-in-the-loop, label-efficient training |
| **Adversarial Training** | Robustness | Security, adversarial defence, safety testing |
| **Curriculum Learning** | Progressive Difficulty | Complex multi-stage tasks, hard exploration |
| **Federated Learning** | Distributed | Privacy-preserving, multi-agent collaborative training |
| **Multi-Task Learning** | Transfer | Task families, domain adaptation, meta-learning |

### Training API

```typescript
import { createAgentDBAdapter } from 'agentic-flow/reasoningbank';

const adapter = await createAgentDBAdapter({
  dbPath: '.agentdb/learning.db',
  enableLearning: true,
  enableReasoning: true,
  cacheSize: 1000,
});

// Store experiences during agent execution
await adapter.insertPattern({
  id: '',
  type: 'experience',
  domain: 'task-domain',
  pattern_data: JSON.stringify({
    embedding: await computeEmbedding('state-action-reward'),
    pattern: {
      state: [0.1, 0.2, 0.3],
      action: 2,
      reward: 1.0,
      next_state: [0.15, 0.25, 0.35],
      done: false,
    },
  }),
  confidence: 0.9,
  usage_count: 1,
  success_count: 1,
  created_at: Date.now(),
  last_used: Date.now(),
});

// Train
const metrics = await adapter.train({ epochs: 50, batchSize: 32 });
console.log('Loss:', metrics.loss, '| Duration:', metrics.duration, 'ms');
```

### Decision Transformer Config (Recommended)

```json
{
  "algorithm": "decision-transformer",
  "model_size": "base",
  "context_length": 20,
  "embed_dim": 128,
  "n_heads": 8,
  "n_layers": 6
}
```

**When RL is NOT what you need**: For production ML training with PyTorch use `pytorch-ml`;
for cloud sandbox training use `flow-nexus-neural`; for CUDA kernels use `cuda`.

---

## Learn More

- **QUIC Protocol**: docs/quic-synchronization.pdf
- **Hybrid Search**: docs/hybrid-search-guide.md
- See [AgentDB Overview](./docs/agentdb-overview.md#links) for general links.

---

**Category**: Advanced / Distributed Systems
**Difficulty**: Advanced
**Estimated Time**: 45-60 minutes
