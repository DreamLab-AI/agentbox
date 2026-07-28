# SPARC — Best Practices, Integration Examples & Advanced Features

Worked end-to-end examples, project best practices, advanced feature snippets, and
performance context. The lean guide (`../SKILL.md`) points here for anything beyond
the quick-path.

## Best Practices

### 1. Memory Integration

Use Memory for cross-agent coordination:

```javascript
// Store architectural decisions
mcp__claude-flow__memory_store {
  namespace: "architecture",
  key: "api-design-v1",
  value: JSON.stringify(apiDesign),
  ttl: 86400000  // 24 hours
}

// Retrieve in subsequent agents
mcp__claude-flow__memory_retrieve {
  namespace: "architecture",
  key: "api-design-v1"
}
```

### 2. Parallel Operations

Batch related operations in a single message:

```javascript
// ✅ CORRECT: All operations together
[Single Message]:
  mcp__claude-flow__agent_spawn { type: "researcher" }
  mcp__claude-flow__agent_spawn { type: "coder" }
  mcp__claude-flow__agent_spawn { type: "tester" }
  TodoWrite { todos: [8-10 todos] }

// ❌ WRONG: Multiple messages
Message 1: mcp__claude-flow__agent_spawn { type: "researcher" }
Message 2: mcp__claude-flow__agent_spawn { type: "coder" }
Message 3: TodoWrite { todos: [...] }
```

### 3. Hook Integration

Wire SPARC modes to hooks for lifecycle coordination:

```bash
# Before work
npx claude-flow@alpha hooks pre-task --description "implement auth"

# During work
npx claude-flow@alpha hooks post-edit --file "auth.js"

# After work
npx claude-flow@alpha hooks post-task --task-id "task-123"
```

### 4. Test Coverage

Target minimum 90% coverage:

- Unit tests for all functions
- Integration tests for APIs
- E2E tests for critical flows
- Edge case coverage
- Error path testing

### 5. Documentation

Document as you build:

- API documentation (OpenAPI)
- Architecture decision records (ADR)
- Code comments for complex logic
- README with setup instructions
- Changelog for version tracking

### 6. File Organisation

Keep the root folder clean:

```
project/
├── src/           # Source code
├── tests/         # Test files
├── docs/          # Documentation
├── config/        # Configuration
├── scripts/       # Utility scripts
└── examples/      # Example code
```

---

## Integration Examples

### Example 1: Full-Stack Development

```javascript
[Single Message - Parallel Agent Execution]:

// Initialize swarm
mcp__claude-flow__swarm_init {
  topology: "hierarchical",
  maxAgents: 10
}

// Architecture phase
mcp__claude-flow__sparc_mode {
  mode: "architect",
  task_description: "design REST API with authentication",
  options: { memory_enabled: true }
}

// Research phase
mcp__claude-flow__sparc_mode {
  mode: "researcher",
  task_description: "research authentication best practices"
}

// Implementation phase
mcp__claude-flow__sparc_mode {
  mode: "coder",
  task_description: "implement Express API with JWT auth",
  options: { test_driven: true }
}

// Testing phase
mcp__claude-flow__sparc_mode {
  mode: "tdd",
  task_description: "comprehensive API tests",
  options: { coverage_target: 90 }
}

// Review phase
mcp__claude-flow__sparc_mode {
  mode: "reviewer",
  task_description: "security and performance review",
  options: { security_check: true }
}

// Batch todos
TodoWrite {
  todos: [
    {content: "Design API schema", status: "completed"},
    {content: "Research JWT implementation", status: "completed"},
    {content: "Implement authentication", status: "in_progress"},
    {content: "Write API tests", status: "pending"},
    {content: "Security review", status: "pending"},
    {content: "Performance optimization", status: "pending"},
    {content: "API documentation", status: "pending"},
    {content: "Deployment setup", status: "pending"}
  ]
}
```

### Example 2: Research-Driven Innovation

```javascript
// Research phase
mcp__claude-flow__sparc_mode {
  mode: "researcher",
  task_description: "research AI-powered search implementations",
  options: {
    depth: "comprehensive",
    sources: ["academic", "industry"]
  }
}

// Innovation phase
mcp__claude-flow__sparc_mode {
  mode: "innovator",
  task_description: "propose novel search algorithm",
  options: { memory_enabled: true }
}

// Architecture phase
mcp__claude-flow__sparc_mode {
  mode: "architect",
  task_description: "design scalable search system"
}

// Implementation phase
mcp__claude-flow__sparc_mode {
  mode: "coder",
  task_description: "implement search algorithm",
  options: { test_driven: true }
}

// Documentation phase
mcp__claude-flow__sparc_mode {
  mode: "documenter",
  task_description: "document search system architecture and API"
}
```

### Example 3: Legacy Code Refactoring

```javascript
// Analysis phase
mcp__claude-flow__sparc_mode {
  mode: "analyzer",
  task_description: "analyze legacy codebase dependencies"
}

// Planning phase
mcp__claude-flow__sparc_mode {
  mode: "orchestrator",
  task_description: "plan incremental refactoring strategy"
}

// Testing phase (create safety net)
mcp__claude-flow__sparc_mode {
  mode: "tester",
  task_description: "create comprehensive test suite for legacy code",
  options: { coverage_target: 80 }
}

// Refactoring phase
mcp__claude-flow__sparc_mode {
  mode: "coder",
  task_description: "refactor module X with modern patterns",
  options: { maintain_tests: true }
}

// Review phase
mcp__claude-flow__sparc_mode {
  mode: "reviewer",
  task_description: "validate refactoring maintains functionality"
}
```

---

## Common Workflows

### Workflow 1: Feature Development

```bash
# Step 1: Research and planning
npx claude-flow sparc run researcher "authentication patterns"

# Step 2: Architecture design
npx claude-flow sparc run architect "design auth system"

# Step 3: TDD implementation
npx claude-flow sparc tdd "user authentication feature"

# Step 4: Code review
npx claude-flow sparc run reviewer "review auth implementation"

# Step 5: Documentation
npx claude-flow sparc run documenter "document auth API"
```

### Workflow 2: Bug Investigation

```bash
# Step 1: Analyze issue
npx claude-flow sparc run analyzer "investigate bug #456"

# Step 2: Debug systematically
npx claude-flow sparc run debugger "fix memory leak in service X"

# Step 3: Create tests
npx claude-flow sparc run tester "regression tests for bug #456"

# Step 4: Review fix
npx claude-flow sparc run reviewer "validate bug fix"
```

### Workflow 3: Performance Optimisation

```bash
# Step 1: Profile performance
npx claude-flow sparc run analyzer "profile API response times"

# Step 2: Identify bottlenecks
npx claude-flow sparc run optimizer "optimize database queries"

# Step 3: Implement improvements
npx claude-flow sparc run coder "implement caching layer"

# Step 4: Benchmark results
npx claude-flow sparc run tester "performance benchmarks"
```

### Workflow 4: Complete Pipeline

```bash
# Execute full development pipeline
npx claude-flow sparc pipeline "e-commerce checkout feature"

# This automatically runs:
# 1. researcher - Gather requirements
# 2. architect - Design system
# 3. coder - Implement features
# 4. tdd - Create comprehensive tests
# 5. reviewer - Code quality review
# 6. optimizer - Performance tuning
# 7. documenter - Documentation
```

---

## Advanced Features

### Neural Pattern Training

```javascript
// Train patterns from successful workflows
mcp__claude-flow__neural_train {
  pattern_type: "coordination",
  training_data: "successful_tdd_workflow.json",
  epochs: 50
}
```

### Cross-Session Memory

```javascript
// Save session state
mcp__claude-flow__memory_persist {
  sessionId: "feature-auth-v1"
}

// Restore in new session
mcp__claude-flow__context_restore {
  snapshotId: "feature-auth-v1"
}
```

### GitHub Integration

```javascript
// Analyze repository
mcp__claude-flow__github_repo_analyze {
  repo: "owner/repo",
  analysis_type: "code_quality"
}

// Manage pull requests
mcp__claude-flow__github_pr_manage {
  repo: "owner/repo",
  pr_number: 123,
  action: "review"
}
```

### Performance Monitoring

```javascript
// Real-time swarm monitoring
mcp__claude-flow__swarm_monitor {
  swarmId: "current",
  interval: 5000
}

// Bottleneck analysis
mcp__claude-flow__bottleneck_analyze {
  component: "api-layer",
  metrics: ["latency", "throughput", "errors"]
}

// Token usage tracking
mcp__claude-flow__token_usage {
  operation: "feature-development",
  timeframe: "24h"
}
```

---

## Performance Context

Reported results for the claude-flow SPARC stack (upstream figures, not
independently verified here):

- **84.8%** SWE-Bench solve rate
- **32.3%** token reduction through optimizations
- **2.8-4.4x** speed improvement with parallel execution
- **27+** neural models for pattern learning
- **90%+** test coverage standard

---

## Support and Resources

- **Documentation**: https://github.com/ruvnet/claude-flow
- **Issues**: https://github.com/ruvnet/claude-flow/issues
- **NPM Package**: https://www.npmjs.com/package/claude-flow
- **Community**: Discord server (link in repository)
