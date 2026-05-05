---
name: swarm-advanced
description: Advanced swarm orchestration patterns for research, development, testing, and complex distributed workflows. Use when: (1) running 3+ parallel agents locally, (2) needing adaptive topology, (3) doing research/dev tasks requiring parallel coordination.
version: 2.0.0
category: orchestration
tags: [swarm, distributed, parallel, research, testing, development, coordination]
author: Claude Flow Team
---

# Advanced Swarm Orchestration

Master advanced swarm patterns for distributed research, development, and testing workflows. This skill covers comprehensive orchestration strategies using both MCP tools and CLI commands.

## When Not To Use

- For queen-led hierarchical coordination with Byzantine consensus -- use the hive-mind-advanced skill instead
- For cloud-based swarm deployment with Flow Nexus platform (cloud-based swarm: requires Flow Nexus account -- not currently installed)
- For sequential pipeline processing where output chains between steps -- use the stream-chain skill instead
- For full development + quality engineering with 111+ agents -- use the build-with-quality skill instead
- For GitHub-specific PR review coordination -- use the github-code-review skill instead
- For structured development workflows with 17 SPARC modes -- use the sparc-methodology skill instead
- For Byzantine fault-tolerant consensus -- use the hive-mind-advanced skill instead

## Quick Start

### Prerequisites
```bash
# Ensure Claude Flow is installed
npm install -g claude-flow@alpha

# Add MCP server (if using MCP tools)
claude mcp add claude-flow npx claude-flow@alpha mcp start
```

### Basic Pattern
```javascript
// 1. Initialize swarm topology
mcp__claude-flow__swarm_init({ topology: "mesh", maxAgents: 6 })

// 2. Spawn specialized agents
mcp__claude-flow__agent_spawn({ type: "researcher", name: "Agent 1" })

// 3. Orchestrate tasks
mcp__claude-flow__task_orchestrate({ task: "...", strategy: "parallel" })
```

### CLI Alternative
```bash
npx claude-flow swarm "your task here" --strategy research --mode distributed --max-agents 6
```

## Core Concepts

### Swarm Topologies

| Topology | Structure | Best For |
|----------|-----------|----------|
| **Mesh** | Peer-to-peer, all agents communicate directly | Research, analysis, brainstorming |
| **Hierarchical** | Coordinator with subordinates | Development, structured workflows |
| **Star** | Central coordinator, parallel spokes | Testing, validation, QA |
| **Ring** | Sequential processing chain | Multi-stage pipelines |

### Agent Strategies

- **Adaptive** - Dynamic adjustment based on task complexity
- **Balanced** - Equal distribution of work across agents
- **Specialized** - Task-specific agent assignment
- **Parallel** - Maximum concurrent execution

## Swarm Patterns Overview

See [PATTERNS.md](PATTERNS.md) for detailed topology examples including full agent configuration and multi-phase workflows for each pattern below.

### Pattern 1: Research Swarm (Mesh)
- 6 agents: 2 researchers, 2 analysts, 1 documenter
- Phases: Gather → Validate → Knowledge graph → Report
- Key tools: `parallel_execute`, `memory_usage`, `neural_patterns`

### Pattern 2: Development Swarm (Hierarchical)
- 8 agents: architect, 2 coders, db engineer, 2 testers, reviewer, devops
- Phases: Design → Parallel implement → Test → Review/Deploy
- Key tools: `task_orchestrate`, `parallel_execute`, `workflow_execute`

### Pattern 3: Testing Swarm (Star)
- 7 agents: 4 test specialists, security tester, analyst, documenter
- Phases: Plan → Parallel execute → Performance/Security → Report
- Key tools: `parallel_execute`, `bottleneck_analyze`, `performance_report`

### Pattern 4: Analysis Swarm (Mesh)
- 5 agents: 4 specialist analyzers, reporter
- Phases: Parallel analysis → Bottleneck detect → Report
- Key tools: `parallel_execute`, `bottleneck_analyze`, `performance_report`

## Valid MCP Tools Reference

The following `mcp__claude-flow__*` tools are available in this environment:

| Tool | Purpose |
|------|---------|
| `swarm_init` | Initialize swarm with topology and agent count |
| `agent_spawn` | Spawn a named agent with type and capabilities |
| `task_orchestrate` | Assign and orchestrate tasks with strategy |
| `swarm_status` | Get current swarm health and agent status |
| `memory_usage` | Store/retrieve/search coordination memory |
| `memory_store` | Store a value to RuVector memory |
| `memory_search` | Semantic search over memory |
| `memory_retrieve` | Retrieve by key |
| `memory_list` | List memory entries |
| `neural_patterns` | Analyze/learn neural coordination patterns |
| `parallel_execute` | Execute tasks in parallel across agents |
| `performance_report` | Generate performance metrics report |
| `bottleneck_analyze` | Identify performance bottlenecks |
| `load_balance` | Balance task load across swarm agents |
| `sparc_mode` | Activate a SPARC methodology mode |
| `coordination_sync` | Synchronize state across swarm |
| `workflow_create` | Create a reusable named workflow |
| `workflow_execute` | Execute a named workflow |
| `github_repo_analyze` | Analyze a GitHub repository |
| `github_pr_manage` | Manage GitHub pull requests |

Tools NOT in this list (e.g. `swarm_monitor`, `batch_process`, `quality_assess`, `pattern_recognize`, `neural_train`, `pipeline_create`, `daa_fault_tolerance`, `memory_persist`, `state_snapshot`, `metrics_collect`, `health_check`, `trend_analysis`, `automation_setup`, `cost_analysis`) are ghost tools — not currently available. Use `claude-flow` CLI equivalents or `swarm_status` / `performance_report` as substitutes. See PATTERNS.md for annotated examples.

## Real-World Quick Examples

```javascript
// Research AI trends, analyze findings, generate report
mcp__claude-flow__swarm_init({ topology: "mesh", maxAgents: 6 })
// Spawn: 2 researchers, 2 analysts, 1 synthesizer, 1 documenter
// Parallel gather → Analyze patterns → Synthesize → Report

// Build complete web application with testing
mcp__claude-flow__swarm_init({ topology: "hierarchical", maxAgents: 8 })
// Spawn: 1 architect, 2 devs, 1 db engineer, 2 testers, 1 reviewer, 1 devops
// Design → Parallel implement → Test → Review → Deploy

// Comprehensive security analysis
mcp__claude-flow__swarm_init({ topology: "star", maxAgents: 5 })
// Spawn: 1 coordinator, 1 code analyzer, 1 security scanner, 1 penetration tester, 1 reporter

// Identify and fix performance bottlenecks
mcp__claude-flow__swarm_init({ topology: "mesh", maxAgents: 4 })
// Spawn: 1 profiler, 1 bottleneck analyzer, 1 optimizer, 1 tester
```

## Best Practices

### Choosing the Right Topology
- **Mesh**: Research, brainstorming, collaborative analysis
- **Hierarchical**: Structured development, sequential workflows
- **Star**: Testing, validation, centralized coordination
- **Ring**: Pipeline processing, staged workflows

### Agent Specialization
- Assign specific capabilities to each agent
- Avoid overlapping responsibilities
- Use coordinator agents for complex workflows
- Leverage `memory_usage` for agent-to-agent communication

### Parallel Execution
- Identify independent tasks before calling `parallel_execute`
- Use sequential strategy for dependent tasks
- Monitor resource usage: `performance_report`
- Implement error handling with `swarm_status` checks

### Memory Management
- Use namespaces to organise memory (e.g. `research/`, `development/design`)
- Set appropriate TTL values (e.g. 604800 = 7 days, 2592000 = 30 days)
- Store decisions and findings continuously during workflows
- Retrieve context at session start for continuity

### Error Recovery
```javascript
try {
  await mcp__claude-flow__task_orchestrate({ "task": "complex operation", "strategy": "parallel" })
} catch (error) {
  const status = await mcp__claude-flow__swarm_status({})
  if (status.healthy) {
    await mcp__claude-flow__task_orchestrate({ "task": "retry failed operation", "strategy": "sequential" })
  }
}
```

## Troubleshooting

| Issue | Solution |
|-------|---------|
| Agents not coordinating | Check topology selection; verify `memory_usage` calls use consistent namespaces |
| Parallel execution failing | Verify task dependencies; check resource limits; add error handling |
| Memory persistence issues | Verify namespaces; check TTL settings; use `memory_list` to audit |
| Performance degradation | Use `bottleneck_analyze`; reduce agent count; run `performance_report` |
| Ghost tool error | See Valid MCP Tools table above; use CLI fallback instead |

## Related Skills

- `sparc-methodology` - Systematic development workflow (17 modes)
- `hive-mind-advanced` - Byzantine fault-tolerant queen-led coordination
- `github-code-review` - Repository management and PR automation
- `build-with-quality` - 111+ agent QE pipeline

## References

- [Claude Flow Documentation](https://github.com/ruvnet/claude-flow)
- [Swarm Orchestration Guide](https://github.com/ruvnet/claude-flow/wiki/swarm)
- [PATTERNS.md](PATTERNS.md) - Detailed topology examples

---

**Version**: 2.0.0 | **Last Updated**: 2025-10-19 | **Skill Level**: Advanced
