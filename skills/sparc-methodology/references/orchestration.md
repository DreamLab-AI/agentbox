# SPARC — Activation Methods, Orchestration Patterns & TDD Workflows

Detailed activation surfaces, the five orchestration topologies, and the complete
TDD workflow scripts. The lean guide (`../SKILL.md`) has the quick-path; reach for
this file when composing multi-agent runs or a full red-green-refactor pipeline.

## Activation Methods

### Method 1: MCP Tools (Preferred in Claude Code)

**Best for**: Integrated Claude Code workflows with full orchestration capabilities

```javascript
// Basic mode execution
mcp__claude-flow__sparc_mode {
  mode: "<mode-name>",
  task_description: "<task description>",
  options: {
    // mode-specific options
  }
}

// Initialize swarm for complex tasks
mcp__claude-flow__swarm_init {
  topology: "hierarchical",  // or "mesh", "ring", "star"
  strategy: "auto",           // or "balanced", "specialized", "adaptive"
  maxAgents: 8
}

// Spawn specialized agents
mcp__claude-flow__agent_spawn {
  agentType: "<agent-type>",
  capabilities: ["<capability1>", "<capability2>"]
}

// Check swarm state (point-in-time, not a live stream)
mcp__claude-flow__swarm_status {
  swarmId: "current"
}
```

### Method 2: CLI (historical, v2 — does not work against the installed binary)

Older docs described a `claude-flow sparc run|modes|help|tdd|batch|pipeline` CLI.
The installed ruflo v3.38.21 binary has no `sparc` subcommand at all
(`claude-flow sparc --help` → "Unknown command: sparc / Did you mean: start, swarm,
status"). Do not use `npx claude-flow ...` either way — it resolves a stale cached
version. Method 1 (`mcp__claude-flow__sparc_mode`) is the only verified activation
path in this image.

Claude Code only: Method 1 needs an MCP client. On Codex / GPT-6 Astra with no MCP
proxy reachable: run the mode's phase manually in one session using the prompt from
[modes.md](modes.md), sequentially rather than via swarm orchestration.

---

## Orchestration Patterns

### Pattern 1: Hierarchical Coordination

**Best for**: Complex projects with clear delegation hierarchy

```javascript
// Initialize hierarchical swarm
mcp__claude-flow__swarm_init {
  topology: "hierarchical",
  maxAgents: 12
}

// Spawn coordinator
mcp__claude-flow__agent_spawn {
  agentType: "coordinator",
  capabilities: ["planning", "delegation", "monitoring"]
}

// Spawn specialized workers
mcp__claude-flow__agent_spawn { agentType: "architect" }
mcp__claude-flow__agent_spawn { agentType: "coder" }
mcp__claude-flow__agent_spawn { agentType: "tester" }
mcp__claude-flow__agent_spawn { agentType: "reviewer" }
```

### Pattern 2: Mesh Coordination

**Best for**: Collaborative tasks requiring peer-to-peer communication

```javascript
mcp__claude-flow__swarm_init {
  topology: "mesh",
  strategy: "balanced",
  maxAgents: 6
}
```

### Pattern 3: Sequential Pipeline

**Best for**: Ordered workflow execution (spec → design → code → test → review)

```javascript
mcp__claude-flow__workflow_create {
  name: "development-pipeline",
  steps: [
    { mode: "researcher", task: "gather requirements" },
    { mode: "architect", task: "design system" },
    { mode: "coder", task: "implement features" },
    { mode: "tdd", task: "create tests" },
    { mode: "reviewer", task: "review code" }
  ],
  triggers: ["on_step_complete"]
}
```

### Pattern 4: Parallel Execution

**Best for**: Independent tasks that can run concurrently

```javascript
mcp__claude-flow__task_orchestrate {
  task: "build full-stack application",
  strategy: "parallel",
  dependencies: {
    backend: [],
    frontend: [],
    database: [],
    tests: ["backend", "frontend"]
  }
}
```

### Pattern 5: Adaptive Strategy

**Best for**: Dynamic workloads with changing requirements

```javascript
mcp__claude-flow__swarm_init {
  topology: "hierarchical",
  strategy: "adaptive",  // Auto-adjusts based on workload
  maxAgents: 20
}
```

---

## TDD Workflows

### Complete TDD Workflow

```javascript
// Step 1: Initialize TDD swarm
mcp__claude-flow__swarm_init {
  topology: "hierarchical",
  maxAgents: 8
}

// Step 2: Research and planning
mcp__claude-flow__sparc_mode {
  mode: "researcher",
  task_description: "research testing best practices for feature X"
}

// Step 3: Architecture design
mcp__claude-flow__sparc_mode {
  mode: "architect",
  task_description: "design testable architecture for feature X"
}

// Step 4: TDD implementation
mcp__claude-flow__sparc_mode {
  mode: "tdd",
  task_description: "implement feature X with 90% coverage",
  options: {
    coverage_target: 90,
    test_framework: "jest",
    parallel_tests: true
  }
}

// Step 5: Code review
mcp__claude-flow__sparc_mode {
  mode: "reviewer",
  task_description: "review feature X implementation",
  options: {
    test_coverage_check: true,
    security_check: true
  }
}

// Step 6: Optimization
mcp__claude-flow__sparc_mode {
  mode: "optimizer",
  task_description: "optimize feature X performance"
}
```

### Red-Green-Refactor Cycle

```javascript
// RED: Write failing test
mcp__claude-flow__sparc_mode {
  mode: "tester",
  task_description: "create failing test for shopping cart add item",
  options: { expect_failure: true }
}

// GREEN: Minimal implementation
mcp__claude-flow__sparc_mode {
  mode: "coder",
  task_description: "implement minimal code to pass test",
  options: { minimal: true }
}

// REFACTOR: Improve code quality
mcp__claude-flow__sparc_mode {
  mode: "coder",
  task_description: "refactor shopping cart implementation",
  options: { maintain_tests: true }
}
```
