# Hive Mind — Operations & Workflows

## Getting Started

Verified against the deployed CLI (`claude-flow hive-mind --help` and each
subcommand's `--help`, ruflo v3.38.21). Use the bare `claude-flow` binary
(baked on PATH) — `npx claude-flow` resolves a separate, older cached package.

### 1. Initialize Hive Mind

```bash
# Basic initialization (defaults: hierarchical-mesh topology, byzantine consensus, 15 agents)
claude-flow hive-mind init

# Custom topology, consensus, and agent cap
claude-flow hive-mind init -t hierarchical-mesh -c byzantine -m 20
```

There is no `--force` or `--config <file>` option on `init` in this build.

### 2. Spawn Workers

```bash
# Basic spawn with objective
claude-flow hive-mind spawn -o "Build microservices architecture"

# Spawn 12 workers for implementation-style work
claude-flow hive-mind spawn -n 12 -o "Implement API"

# Generate Claude Code commands
claude-flow hive-mind spawn --claude -o "Build full-stack app"
```

There is no `--queen-type` or `--consensus` flag on `spawn` — set consensus at
`init` time (above); the queen-type framing (strategic/tactical/adaptive)
shapes the objective text, not a CLI flag.

### 3. Monitor Status

```bash
# Check hive mind status
claude-flow hive-mind status

# Inspect collective memory (there is no `hive-mind metrics` subcommand)
claude-flow hive-mind memory
```

## Advanced Workflows

### Session Management

There is no `hive-mind sessions`/`pause`/`resume`/`stop`/`export`/`import`
subcommand in the deployed CLI (verified: `hive-mind --help` lists init, spawn,
status, task, join, leave, consensus, broadcast, memory, optimize-memory,
shutdown only — no session-lifecycle subcommands). Session-level save/restore
is generic Claude Flow session management, not hive-mind-specific:

```bash
# Save/restore the encompassing Claude Flow session (not hive-specific)
claude-flow session save -n "checkpoint-1"
claude-flow session restore <session-id>

# End the hive mind itself (persists state by default)
claude-flow hive-mind shutdown
```

**Session Features** (persistent-memory-backed, not a distinct session API)
- Collective memory persists across `hive-mind` invocations via RuVector/SQLite
- `hive-mind shutdown -s` (default: on) saves state before terminating
- Export/import of collective memory: use `memory export`/`memory import`
  (generic Claude Flow memory commands), not a hive-specific session format

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
claude-flow hive-mind spawn --claude -o "Build REST API"
```

Output:
```javascript
Task("Queen Coordinator", "Orchestrate REST API development...", "coordinator")
Task("Backend Developer", "Implement Express routes...", "backend-dev")
Task("Database Architect", "Design PostgreSQL schema...", "code-analyzer")
Task("Test Engineer", "Create Jest test suite...", "tester")
```

### With SPARC Methodology

There is no `sparc` top-level command in the deployed CLI (verified:
`claude-flow sparc --help` → "Unknown command: sparc", suggesting
start/swarm/status instead). SPARC-style phased development under hive-mind
coordination is a matter of the objective text and worker roles you spawn, not
a `--hive-mind` flag:

```bash
claude-flow hive-mind spawn -o "User authentication: spec, architecture, TDD implementation, review"
```

### With GitHub Integration

```bash
# Repository analysis with hive mind (there is no --objective flag; put the
# repo in the objective text itself)
claude-flow hive-mind spawn -o "Analyze repo quality: owner/repo"

# PR review coordination
claude-flow hive-mind spawn -o "Review PR #123"
```
