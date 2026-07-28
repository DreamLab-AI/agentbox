# Hive Mind — Operations & Workflows

## Getting Started

### 1. Initialize Hive Mind

```bash
# Basic initialization
npx claude-flow hive-mind init

# Force reinitialize
npx claude-flow hive-mind init --force

# Custom configuration
npx claude-flow hive-mind init --config hive-config.json
```

### 2. Spawn a Swarm

```bash
# Basic spawn with objective
npx claude-flow hive-mind spawn "Build microservices architecture"

# Strategic queen type
npx claude-flow hive-mind spawn "Research AI patterns" --queen-type strategic

# Tactical queen with max workers
npx claude-flow hive-mind spawn "Implement API" --queen-type tactical --max-workers 12

# Adaptive queen with consensus
npx claude-flow hive-mind spawn "Optimize system" --queen-type adaptive --consensus byzantine

# Generate Claude Code commands
npx claude-flow hive-mind spawn "Build full-stack app" --claude
```

### 3. Monitor Status

```bash
# Check hive mind status
npx claude-flow hive-mind status

# Get detailed metrics
npx claude-flow hive-mind metrics

# Monitor collective memory
npx claude-flow hive-mind memory
```

## Advanced Workflows

### Session Management

**Create and Manage Sessions**

```bash
# List active sessions
npx claude-flow hive-mind sessions

# Pause a session
npx claude-flow hive-mind pause <session-id>

# Resume a paused session
npx claude-flow hive-mind resume <session-id>

# Stop a running session
npx claude-flow hive-mind stop <session-id>
```

**Session Features**
- Automatic checkpoint creation
- Progress tracking with completion percentages
- Parent-child process management
- Session logs with event tracking
- Export/import capabilities

### Consensus Building

The Hive Mind builds consensus through structured voting:

```javascript
// Programmatic consensus building
const decision = await hiveMind.buildConsensus(
  'Architecture pattern selection',
  ['microservices', 'monolith', 'serverless']
);

// Result includes:
// - decision: Winning option
// - confidence: Vote percentage
// - votes: Individual agent votes
```

**Consensus Algorithms**

1. **Majority** - Simple democratic voting
2. **Weighted** - Queen has 3x voting power
3. **Byzantine** - 2/3 supermajority required

### Collective Memory

**Storing Knowledge**

```javascript
// Store in collective memory
await memory.store('api-patterns', {
  rest: { pros: [...], cons: [...] },
  graphql: { pros: [...], cons: [...] }
}, 'knowledge', { confidence: 0.95 });
```

**Memory Types**
- `knowledge`: Permanent insights (no TTL)
- `context`: Session context (1 hour TTL)
- `task`: Task-specific data (30 min TTL)
- `result`: Execution results (permanent, compressed)
- `error`: Error logs (24 hour TTL)
- `metric`: Performance metrics (1 hour TTL)
- `consensus`: Decision records (permanent)
- `system`: System configuration (permanent)

**Searching and Retrieval**

```javascript
// Search memory by pattern
const results = await memory.search('api*', {
  type: 'knowledge',
  minConfidence: 0.8,
  limit: 50
});

// Get related memories
const related = await memory.getRelated('api-patterns', 10);

// Build associations
await memory.associate('rest-api', 'authentication', 0.9);
```

### Task Distribution

**Automatic Worker Assignment**

The system intelligently assigns tasks based on:
- Keyword matching with agent specialization
- Historical performance metrics
- Worker availability and load
- Task complexity analysis

```javascript
// Create task (auto-assigned)
const task = await hiveMind.createTask(
  'Implement user authentication',
  priority: 8,
  { estimatedDuration: 30000 }
);
```

**Auto-Scaling**

```javascript
// Configure auto-scaling
const config = {
  autoScale: true,
  maxWorkers: 12,
  scaleUpThreshold: 2, // Pending tasks per idle worker
  scaleDownThreshold: 2 // Idle workers above pending tasks
};
```

## Integration Patterns

### With Claude Code

Generate Claude Code spawn commands directly:

```bash
npx claude-flow hive-mind spawn "Build REST API" --claude
```

Output:
```javascript
Task("Queen Coordinator", "Orchestrate REST API development...", "coordinator")
Task("Backend Developer", "Implement Express routes...", "backend-dev")
Task("Database Architect", "Design PostgreSQL schema...", "code-analyzer")
Task("Test Engineer", "Create Jest test suite...", "tester")
```

### With SPARC Methodology

```bash
# Use hive mind for SPARC workflow
npx claude-flow sparc tdd "User authentication" --hive-mind

# Spawns:
# - Specification agent
# - Architecture agent
# - Coder agents
# - Tester agents
# - Reviewer agents
```

### With GitHub Integration

```bash
# Repository analysis with hive mind
npx claude-flow hive-mind spawn "Analyze repo quality" --objective "owner/repo"

# PR review coordination
npx claude-flow hive-mind spawn "Review PR #123" --queen-type tactical
```
