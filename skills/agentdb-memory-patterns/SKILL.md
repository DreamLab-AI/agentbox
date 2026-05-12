---
name: agentdb-memory-patterns
description: "Implement persistent memory patterns for AI agents using AgentDB. Includes session memory, long-term storage, pattern learning, and context management. Use when building stateful agents, chat systems, or intelligent assistants."
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

## Memory Patterns

### 1. Session Memory
```typescript
class SessionMemory {
  async storeMessage(role: string, content: string) {
    return await db.storeMemory({
      sessionId: this.sessionId,
      role,
      content,
      timestamp: Date.now()
    });
  }

  async getSessionHistory(limit = 20) {
    return await db.query({
      filters: { sessionId: this.sessionId },
      orderBy: 'timestamp',
      limit
    });
  }
}
```

### 2. Long-Term Memory
```typescript
// Store important facts
await db.storeFact({
  category: 'user_preference',
  key: 'language',
  value: 'English',
  confidence: 1.0,
  source: 'explicit'
});

// Retrieve facts
const prefs = await db.getFacts({
  category: 'user_preference'
});
```

### 3. Pattern Learning
```typescript
// Learn from successful interactions
await db.storePattern({
  trigger: 'user_asks_time',
  response: 'provide_formatted_time',
  success: true,
  context: { timezone: 'UTC' }
});

// Apply learned patterns
const pattern = await db.matchPattern(currentContext);
```

## Advanced Patterns

### Hierarchical Memory
```typescript
// Organize memory in hierarchy
await memory.organize({
  immediate: recentMessages,    // Last 10 messages
  shortTerm: sessionContext,    // Current session
  longTerm: importantFacts,     // Persistent facts
  semantic: embeddedKnowledge   // Vector search
});
```

### Memory Consolidation
```typescript
// Periodically consolidate memories
await memory.consolidate({
  strategy: 'importance',       // Keep important memories
  maxSize: 10000,              // Size limit
  minScore: 0.5                // Relevance threshold
});
```

For CLI query, import/export, and benchmark operations, see [AgentDB Overview](../agentdb-advanced/docs/agentdb-overview.md#common-cli-operations).

## Integration with ReasoningBank

```typescript
import { createAgentDBAdapter, migrateToAgentDB } from 'agentic-flow/reasoningbank';

// Migrate from legacy ReasoningBank
const result = await migrateToAgentDB(
  '.swarm/memory.db',           // Source (legacy)
  '.agentdb/reasoningbank.db'   // Destination (AgentDB)
);

console.log(`✅ Migrated ${result.patternsMigrated} patterns`);

// Train learning model
const adapter = await createAgentDBAdapter({
  enableLearning: true,
});

await adapter.train({
  epochs: 50,
  batchSize: 32,
});

// Get optimal strategy with reasoning
const result = await adapter.retrieveWithReasoning(queryEmbedding, {
  domain: 'task-planning',
  synthesizeContext: true,
  optimizeMemory: true,
});
```

For learning plugins and RL algorithms, see the [agentdb-advanced](../agentdb-advanced/SKILL.md) skill (RL Plugins section). For performance tuning and quantization, see the [agentdb-vector-search](../agentdb-vector-search/SKILL.md) skill.

## KHIVE-Informed Enhancements (v2.0 Roadmap)

Operational learnings from KHIVE v2 comparison during cross-ecosystem engineering.
Full analysis: [KHIVE-LEARNINGS.md](./KHIVE-LEARNINGS.md)

### Orient Pattern — Cold-Start Dashboard

Every session should start with one call that returns the workspace state:

```typescript
// Proposed: single call replaces 4-5 sequential queries
const state = await agentdb.orient({
  namespace: "project-state",
  task_limit: 10,
  recent_limit: 5
});
// Returns: { counts: {memory, task, entity}, open_tasks, recent, stale_count }
```

**Implementation note:** The sidecar Postgres (ruvector-postgres:5432) can serve this as a single SQL query with CTEs — no new infrastructure needed.

### Importance-Weighted Storage

```typescript
// High-importance: architecture decisions, security findings
await agentdb.store({
  key: "ecosystem-dep-map",
  value: "...",
  importance: 0.95,        // Biases retrieval ranking
  memory_type: "semantic"  // Durable — no TTL auto-expire
});

// Low-importance: session state, progress notes
await agentdb.store({
  key: "sprint-progress-may12",
  value: "...",
  importance: 0.4,
  memory_type: "episodic"  // Decays — auto-expire via TTL
});
```

Retrieval blends: `score = 0.6 * cosine_similarity + 0.2 * importance + 0.2 * recency_decay`

### Entity-Relationship Graph

Lightweight graph layer alongside the vector store. Enables structural queries that embeddings can't answer.

```typescript
// Create typed entities
await agentdb.entityCreate({ name: "solid-pod-rs", kind: "project", properties: { layer: 0, sloc: 42000 } });
await agentdb.entityCreate({ name: "nostr-rust-forum", kind: "project", properties: { layer: 1, sloc: 54000 } });

// Link with typed relations
await agentdb.entityLink({ source: "nostr-rust-forum", target: "solid-pod-rs", relation: "depends_on" });

// Structural query: "what depends on solid-pod-rs?"
const dependents = await agentdb.entitySearch({ linked_to: "solid-pod-rs", relation: "depends_on" });
```

**Schema** (sidecar Postgres):
```sql
CREATE TABLE entities (id TEXT PK, kind TEXT, name TEXT, properties JSONB, created_at TIMESTAMPTZ);
CREATE TABLE edges (source TEXT REFERENCES entities(id), target TEXT REFERENCES entities(id),
                    relation TEXT, weight FLOAT DEFAULT 1.0, metadata JSONB);
CREATE INDEX idx_edges_target ON edges(target, relation);  -- "what links TO this entity?"
CREATE INDEX idx_edges_source ON edges(source, relation);  -- "what does this entity link TO?"
```

### Task Dependency DAG

Tasks as a first-class memory kind with dependency ordering:

```typescript
await agentdb.taskCreate({ title: "SSO parity verification", priority: "p0", depends_on: [] });
await agentdb.taskCreate({ title: "Build panel registry", priority: "p1", depends_on: ["sso-parity-id"] });

// Returns only unblocked tasks — respects dependency graph
const actionable = await agentdb.taskNext({ limit: 3 });
```

### Tag Retrieval Path

Exact-match categorical filter bypassing vector search:

```typescript
// Find all P0 security issues — no embedding similarity, just tag match
const p0s = await agentdb.recall({ tags: ["security", "p0"], tag_mode: "all" });
```

**Schema:** `ALTER TABLE memories ADD COLUMN tags JSONB DEFAULT '[]'; CREATE INDEX idx_tags ON memories USING GIN (tags);`

### URI/URN Addressing

Three-level addressing for cross-referencing:

```
urn:agentdb:{namespace}:{kind}:{key}[@version]

Examples:
  urn:agentdb:project-state:memory:ecosystem-dep-map
  urn:agentdb:project-state:entity:solid-pod-rs
  urn:agentdb:project-state:task:fix-nip98-parity
  urn:agentdb:project-state:edge:nrf→solid-pod-rs:depends_on
```

Tasks reference entities by URN. Memories reference tasks by URN. Edges connect entities by URN. Enables graph traversal from any starting node.

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
