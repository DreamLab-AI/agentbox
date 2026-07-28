# Deployment — Multi-Database, Production Patterns, CLI Operations

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
