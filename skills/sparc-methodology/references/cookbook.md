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
  mcp__claude-flow__agent_spawn { agentType: "researcher" }
  mcp__claude-flow__agent_spawn { agentType: "coder" }
  mcp__claude-flow__agent_spawn { agentType: "tester" }
  TodoWrite { todos: [8-10 todos] }

// ❌ WRONG: Multiple messages
Message 1: mcp__claude-flow__agent_spawn { agentType: "researcher" }
Message 2: mcp__claude-flow__agent_spawn { agentType: "coder" }
Message 3: TodoWrite { todos: [...] }
```

### 3. Hook Integration

Wire SPARC modes to hooks for lifecycle coordination:

```bash
# Before work
claude-flow hooks pre-task --description "implement auth"

# During work
claude-flow hooks post-edit --file "auth.js"

# After work
claude-flow hooks post-task --task-id "task-123"
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

Historical note: earlier docs ran these workflows via a `claude-flow sparc run|tdd|
pipeline` CLI. That subcommand does not exist in the installed ruflo v3.38.21 binary
(`claude-flow sparc --help` → "Unknown command: sparc"). The workflows below use the
verified `mcp__claude-flow__sparc_mode` path instead. Claude Code only: on Codex /
GPT-6 Astra with no MCP proxy reachable, run each mode's phase sequentially in one
session using the prompt from [modes.md](modes.md).

### Workflow 1: Feature Development

```javascript
mcp__claude-flow__sparc_mode { mode: "researcher", task_description: "authentication patterns" }
mcp__claude-flow__sparc_mode { mode: "architect", task_description: "design auth system" }
mcp__claude-flow__sparc_mode { mode: "tdd", task_description: "user authentication feature" }
mcp__claude-flow__sparc_mode { mode: "reviewer", task_description: "review auth implementation" }
mcp__claude-flow__sparc_mode { mode: "documenter", task_description: "document auth API" }
```

### Workflow 2: Bug Investigation

```javascript
mcp__claude-flow__sparc_mode { mode: "analyzer", task_description: "investigate bug #456" }
mcp__claude-flow__sparc_mode { mode: "debugger", task_description: "fix memory leak in service X" }
mcp__claude-flow__sparc_mode { mode: "tester", task_description: "regression tests for bug #456" }
mcp__claude-flow__sparc_mode { mode: "reviewer", task_description: "validate bug fix" }
```

### Workflow 3: Performance Optimisation

```javascript
mcp__claude-flow__sparc_mode { mode: "analyzer", task_description: "profile API response times" }
mcp__claude-flow__sparc_mode { mode: "optimizer", task_description: "optimize database queries" }
mcp__claude-flow__sparc_mode { mode: "coder", task_description: "implement caching layer" }
mcp__claude-flow__sparc_mode { mode: "tester", task_description: "performance benchmarks" }
```

### Workflow 4: Complete Pipeline

Run each phase's mode in sequence (researcher → architect → coder/tdd → reviewer →
documenter) via `mcp__claude-flow__sparc_mode`; there is no single-call CLI pipeline
in this image.

```
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

### Neural Pattern Learning

```javascript
mcp__claude-flow__neural_patterns { action: "train" }
```
Not baked into this image: `neural_patterns` is a registered MCP tool but
currently returns `{ ok: false, error: "unimplemented" }` in ruvector-mcp — treat
it as a stub, not a working feature.

### Cross-Session Memory

```javascript
// Save session state
mcp__claude-flow__memory_store {
  key: "feature-auth-v1",
  value: "<session summary>",
  namespace: "sparc-sessions"
}

// Restore in a new session
mcp__claude-flow__memory_retrieve {
  key: "feature-auth-v1",
  namespace: "sparc-sessions"
}
```
There is no `memory_persist`/`context_restore` pair in this image; `memory_store`
and `memory_retrieve` are the real tools and cover the same save/restore need.

### GitHub Integration

```javascript
mcp__claude-flow__github_repo_analyze { repo: "owner/repo", analysis_type: "code_quality" }
mcp__claude-flow__github_pr_manage { repo: "owner/repo", pr_number: 123, action: "review" }
```
Not baked into this image: both tools are registered but currently return
`{ ok: false, error: "unimplemented" }` in ruvector-mcp.

### Performance Monitoring

```javascript
// Swarm state (point-in-time, not a live stream)
mcp__claude-flow__swarm_status { swarmId: "current" }

// Bottleneck analysis
mcp__claude-flow__bottleneck_analyze { component: "api-layer" }
```
Not baked into this image: `bottleneck_analyze` is registered but currently
returns `{ ok: false, error: "unimplemented" }`. There is no `swarm_monitor` or
`token_usage` tool in this build — use `swarm_status` for point-in-time state;
`mcp__claude-flow__performance_report` covers token/performance figures and is
also currently unimplemented in ruvector-mcp.

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
