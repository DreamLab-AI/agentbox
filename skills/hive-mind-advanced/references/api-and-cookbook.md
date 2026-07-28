# Hive Mind — Troubleshooting, API Reference & Cookbook

## Troubleshooting

### Memory Issues

**High Memory Usage**
```bash
# Run garbage collection
npx claude-flow hive-mind memory --gc

# Optimize database
npx claude-flow hive-mind memory --optimize

# Export and clear
npx claude-flow hive-mind memory --export --clear
```

**Low Cache Hit Rate**
```javascript
// Increase cache size in config
{
  "cacheSize": 2000,
  "cacheMemoryMB": 100
}
```

### Performance Issues

**Slow Task Assignment**
```javascript
// Enable worker type caching
// The system caches best worker matches for 5 minutes
// Automatic - no configuration needed
```

**High Queue Utilization**
```javascript
// Increase async queue concurrency
{
  "asyncQueueConcurrency": 20 // Default: min(maxWorkers * 2, 20)
}
```

### Consensus Failures

**No Consensus Reached (Byzantine)**
```bash
# Switch to weighted consensus for more decisive results
npx claude-flow hive-mind spawn "..." --consensus weighted

# Or use simple majority
npx claude-flow hive-mind spawn "..." --consensus majority
```

## Advanced Topics

### Custom Worker Types

Define specialized workers in `.claude/agents/`:

```yaml
name: security-auditor
type: specialist
capabilities:
  - vulnerability-scanning
  - security-review
  - penetration-testing
  - compliance-checking
priority: high
```

### Neural Pattern Training

The system trains on successful patterns:

```javascript
// Automatic pattern learning
// Happens after successful task completion
// Stores in collective memory
// Improves future task matching
```

### Multi-Hive Coordination

Run multiple hive minds simultaneously:

```bash
# Frontend hive
npx claude-flow hive-mind spawn "Build UI" --name frontend-hive

# Backend hive
npx claude-flow hive-mind spawn "Build API" --name backend-hive

# They share collective memory for coordination
```

### Export/Import Sessions

```bash
# Export session for backup
npx claude-flow hive-mind export <session-id> --output backup.json

# Import session
npx claude-flow hive-mind import backup.json
```

## API Reference

### HiveMindCore

```javascript
const hiveMind = new HiveMindCore({
  objective: 'Build system',
  queenType: 'strategic',
  maxWorkers: 8,
  consensusAlgorithm: 'byzantine'
});

await hiveMind.initialize();
await hiveMind.spawnQueen(queenData);
await hiveMind.spawnWorkers(['coder', 'tester']);
await hiveMind.createTask('Implement feature', 7);
const decision = await hiveMind.buildConsensus('topic', options);
const status = hiveMind.getStatus();
await hiveMind.shutdown();
```

### CollectiveMemory

```javascript
const memory = new CollectiveMemory({
  swarmId: 'hive-123',
  maxSize: 100,
  cacheSize: 1000
});

await memory.store(key, value, type, metadata);
const data = await memory.retrieve(key);
const results = await memory.search(pattern, options);
const related = await memory.getRelated(key, limit);
await memory.associate(key1, key2, strength);
const stats = memory.getStatistics();
const analytics = memory.getAnalytics();
const health = await memory.healthCheck();
```

### HiveMindSessionManager

```javascript
const sessionManager = new HiveMindSessionManager();

const sessionId = await sessionManager.createSession(
  swarmId, swarmName, objective, metadata
);

await sessionManager.saveCheckpoint(sessionId, name, data);
const sessions = await sessionManager.getActiveSessions();
const session = await sessionManager.getSession(sessionId);
await sessionManager.pauseSession(sessionId);
await sessionManager.resumeSession(sessionId);
await sessionManager.stopSession(sessionId);
await sessionManager.completeSession(sessionId);
```

## Examples

### Full-Stack Development

```bash
# Initialize hive mind
npx claude-flow hive-mind init

# Spawn full-stack hive
npx claude-flow hive-mind spawn "Build e-commerce platform" \
  --queen-type strategic \
  --max-workers 10 \
  --consensus weighted \
  --claude

# Output generates Claude Code commands:
# - Queen coordinator
# - Frontend developers (React)
# - Backend developers (Node.js)
# - Database architects
# - DevOps engineers
# - Security auditors
# - Test engineers
# - Documentation specialists
```

### Research and Analysis

```bash
# Spawn research hive
npx claude-flow hive-mind spawn "Research GraphQL vs REST" \
  --queen-type adaptive \
  --consensus byzantine

# Researchers gather data
# Analysts process findings
# Queen builds consensus on recommendation
# Results stored in collective memory
```

### Code Review

```bash
# Review coordination
npx claude-flow hive-mind spawn "Review PR #456" \
  --queen-type tactical \
  --max-workers 6

# Spawns:
# - Code analyzers
# - Security reviewers
# - Performance reviewers
# - Test coverage analyzers
# - Documentation reviewers
# - Consensus on approval/changes
```

## Skill Progression

### Beginner
1. Initialize hive mind
2. Spawn basic swarms
3. Monitor status
4. Use majority consensus

### Intermediate
1. Configure queen types
2. Implement session management
3. Use weighted consensus
4. Access collective memory
5. Enable auto-scaling

### Advanced
1. Byzantine fault tolerance
2. Memory optimisation
3. Custom worker types
4. Multi-hive coordination
5. Neural pattern training
6. Session export/import
7. Performance tuning

## References

- [Hive Mind Documentation](https://github.com/ruvnet/claude-flow/docs/hive-mind)
- [Collective Intelligence Patterns](https://github.com/ruvnet/claude-flow/docs/patterns)
- [Byzantine Consensus](https://github.com/ruvnet/claude-flow/docs/consensus)
- [Memory Optimisation](https://github.com/ruvnet/claude-flow/docs/memory)
