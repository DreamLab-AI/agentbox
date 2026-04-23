---
name: "AgentDB Memory Patterns"
description: "Implement persistent memory patterns for AI agents using AgentDB. Includes session memory, long-term storage, pattern learning, and context management. Use when building stateful agents, chat systems, or intelligent assistants."
---

# AgentDB Memory Patterns

For AgentDB architecture and performance overview, see [AgentDB Overview](../agentdb-advanced/docs/agentdb-overview.md).

## What This Skill Covers

Memory management patterns for AI agents: session memory, long-term storage, pattern learning, hierarchical memory organisation, memory consolidation, and ReasoningBank migration. For CLI setup, API initialisation, and common operations, see the [AgentDB Overview](../agentdb-advanced/docs/agentdb-overview.md).

**Additional Prerequisites**: Understanding of agent architectures.

## When Not To Use

- For distributed multi-database setups or QUIC sync -- use the agentdb-advanced skill instead
- For reinforcement learning and training plugins -- use the agentdb-learning skill instead
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

For learning plugins and RL algorithms, see the [agentdb-learning](../agentdb-learning/SKILL.md) skill. For performance tuning and quantization, see the [agentdb-vector-search](../agentdb-vector-search/SKILL.md) skill.

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
