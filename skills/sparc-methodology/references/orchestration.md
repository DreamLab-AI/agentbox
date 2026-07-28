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
  type: "<agent-type>",
  capabilities: ["<capability1>", "<capability2>"]
}

// Monitor execution
mcp__claude-flow__swarm_monitor {
  swarmId: "current",
  interval: 5000
}
```

### Method 2: NPX CLI (Fallback)

**Best for**: Terminal usage or when MCP tools unavailable

```bash
# Execute specific mode
npx claude-flow sparc run <mode> "task description"

# Use alpha features
npx claude-flow@alpha sparc run <mode> "task description"

# List all available modes
npx claude-flow sparc modes

# Get help for specific mode
npx claude-flow sparc help <mode>

# Run with options
npx claude-flow sparc run <mode> "task" --parallel --monitor

# Execute TDD workflow
npx claude-flow sparc tdd "feature description"

# Batch execution
npx claude-flow sparc batch <mode1,mode2,mode3> "task"

# Pipeline execution
npx claude-flow sparc pipeline "task description"
```

### Method 3: Local Installation

**Best for**: Projects with local claude-flow installation

```bash
# If claude-flow is installed locally
./claude-flow sparc run <mode> "task description"
```

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
  type: "coordinator",
  capabilities: ["planning", "delegation", "monitoring"]
}

// Spawn specialized workers
mcp__claude-flow__agent_spawn { type: "architect" }
mcp__claude-flow__agent_spawn { type: "coder" }
mcp__claude-flow__agent_spawn { type: "tester" }
mcp__claude-flow__agent_spawn { type: "reviewer" }
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
