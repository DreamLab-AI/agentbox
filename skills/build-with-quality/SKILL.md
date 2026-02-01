---
skill: build-with-quality
version: 1.1.0
description: Unified Claude Code V3 + Agentic QE meta-skill for optimal project building with 111+ specialized agents, unified learning (SONA + ReasoningBank), TinyDancer model routing (75% token reduction), and comprehensive quality gates. Supersedes agentic-qe, reasoningbank-*, and pair-programming skills.
author: Claude Flow
tags: [meta-skill, development, qa, tdd, adr, ddd, agents, quality-gates, sona, hnsw, coverage, security, accessibility, chaos-testing]
mcp_server: false
supersedes: [agentic-qe, reasoningbank-intelligence, reasoningbank-agentdb, pair-programming]
---

# Build with Quality - Unified Meta-Skill

> **Quick Start:** See [BUILD-WITH-QUALITY-PROMPT.md](./BUILD-WITH-QUALITY-PROMPT.md) for a copy-paste activation prompt.
> **Examples:** See [USAGE-EXAMPLES.md](./USAGE-EXAMPLES.md) for 5 complete project examples.

**[Claude Flow V3](https://github.com/ruvnet/claude-flow/tree/main/v3) + [Agentic QE](https://github.com/proffesor-for-testing/agentic-qe) Combined**

A comprehensive meta-skill that unifies development and quality engineering capabilities, replacing multiple specialized skills with a single cohesive system.

## What This Skill Supersedes

This skill **replaces** the following skills:
- `agentic-qe` - All 51 agents and 100 MCP tools are now integrated
- `reasoningbank-intelligence` - Pattern learning is now in unified SONA + ReasoningBank memory
- `reasoningbank-agentdb` - Storage is now in HNSW-indexed unified memory
- `pair-programming` - Driver/navigator workflows are now provided by coder + reviewer + TDD agents

## Quick Start

**Option 1: Copy-Paste Prompt (Recommended)**
```markdown
# Copy the prompt from BUILD-WITH-QUALITY-PROMPT.md and customize:
Build with Quality skill (v1.1.0).
Project: [NAME] | Stack: [TECH] | Task: [DESCRIPTION]
Methodology: DDD + ADR + TDD
Quality: 85% coverage, security scan, WCAG AA
```

**Option 2: CLI Invocation**
```bash
# Use the skill for a feature implementation
claude-flow skill build-with-quality "implement user authentication with JWT"

# Or invoke directly
npx claude-flow@alpha sparc run coder "implement auth" --topology hierarchical-mesh
```

**Option 3: MCP Tools (When Available)**
```javascript
mcp__claude-flow__swarm_init { topology: "hierarchical-mesh", maxAgents: 100 }
mcp__claude-flow__agent_spawn { type: "architect" }
mcp__claude-flow__agent_spawn { type: "coder" }
mcp__claude-flow__task_orchestrate { task: "[PROJECT]", strategy: "parallel" }
```

## Features

### 111+ Specialized Agents

| Source | Count | Examples |
|--------|-------|----------|
| Claude Flow V3 | 60+ | architect, coder, reviewer, security-architect, deployer |
| Agentic QE | 51 | test-strategist, coverage-analyzer, defect-predictor, chaos-engineer |
| Shared | 3 | unified-coordinator, event-bridge, unified-memory-coordinator |

### Unified Learning System

- **SONA (Self-Optimizing Neural Architecture)**: 5 modes (real-time, balanced, research, edge, batch)
- **ReasoningBank**: Pattern storage with confidence tiers (Bronze -> Platinum)
- **HNSW Indexing**: O(log n) vector search - 150x faster than linear
- **Dream Cycles**: Background pattern consolidation
- **Q-Learning**: Coverage optimization with 12-dimensional state space

### Intelligent Model Routing (TinyDancer)

- **3-tier routing**: Haiku (0-20), Sonnet (20-70), Opus (70-100) complexity
- **Flash Attention**: 2.49x-7.47x speedup
- **75% token reduction** through intelligent routing
- **Multi-model voting** for low-confidence decisions

### Comprehensive Quality Gates

- **Coverage**: 85% minimum, 95% critical paths, 100% new code
- **Security**: SAST/DAST scanning, zero critical/high vulnerabilities
- **Accessibility**: WCAG AA/AAA compliance (85% color contrast, 80% keyboard nav)
- **Chaos Testing**: Network resilience (70%), resource exhaustion (75%), graceful degradation (80%)
- **Contract Validation**: Schema validation, backward compatibility
- **Defect Prediction**: ML-powered with F1 > 0.8

### Development Methodologies

#### Domain-Driven Design (DDD)
- **Strategic Design**: Bounded contexts, context mapping, ubiquitous language
- **Tactical Patterns**: Aggregates, entities, value objects, domain events, repositories
- **Guidelines**: Small aggregates, reference by ID, domain events for cross-aggregate communication

#### Architecture Decision Records (ADR)
- **Templates**: Standardized ADR format with context, decision, consequences
- **Categories**: Architecture, technology, patterns, operations decisions
- **Tracking**: Status management (proposed -> accepted -> deprecated -> superseded)

#### Test-Driven Development (TDD)
- **Red-Green-Refactor**: Strict cycle enforcement with TDD-specific agents
- **Test Patterns**: Unit, integration, and contract test templates
- **Best Practices**: Arrange-Act-Assert, descriptive naming, behavior-focused tests

## Usage

### Via Claude Flow CLI

```bash
# Initialize with quality workflow
npx claude-flow@alpha swarm init --topology hierarchical-mesh --strategy specialized

# Spawn development agents
npx claude-flow@alpha agent spawn --type architect
npx claude-flow@alpha agent spawn --type coder
npx claude-flow@alpha agent spawn --type test-strategist
npx claude-flow@alpha agent spawn --type coverage-analyzer

# Execute with quality gates
npx claude-flow@alpha task create --type "implementation" --quality-gates true
```

### Via MCP Tools

```javascript
// Initialize swarm
mcp__claude-flow__swarm_init {
  topology: "hierarchical-mesh",
  maxAgents: 100,
  strategy: "specialized"
}

// Spawn quality agents
mcp__claude-flow__agent_spawn { type: "test-strategist" }
mcp__claude-flow__agent_spawn { type: "coverage-analyzer" }
mcp__claude-flow__agent_spawn { type: "defect-predictor" }
```

### Via Task Tool (Claude Code)

```javascript
// Spawn coder with quality integration
Task({
  prompt: "Implement user authentication with JWT, following TDD",
  subagent_type: "coder",
  model: "sonnet"  // TinyDancer will route optimally
})

// Spawn tester for coverage analysis
Task({
  prompt: "Generate tests for auth module with 95% coverage",
  subagent_type: "tester",
  model: "haiku"
})
```

## Workflow Phases

```
Phase 1: REQUIREMENTS & PLANNING
├── Architect agent analyzes requirements
├── Requirements-validation domain verifies specs
├── Code-intelligence builds knowledge graph
└── SONA retrieves similar project patterns

Phase 2: DEVELOPMENT (Parallel)
├── Coder agent writes implementation
├── Test-generation creates tests IN PARALLEL
├── Security-architect reviews for vulnerabilities
└── Coverage-analysis identifies gaps

Phase 3: QUALITY GATES
├── Quality-assessment evaluates readiness
├── Defect-intelligence predicts bugs
├── Visual-accessibility checks WCAG compliance
└── Chaos-resilience validates fault tolerance

Phase 4: DEPLOYMENT
├── Deployment agent manages CI/CD
├── Contract-testing validates API compatibility
└── Performance agent benchmarks

Phase 5: LEARNING
├── ReasoningBank stores test patterns
├── SONA optimizes future builds
└── Cross-project transfer enables reuse
```

## Agent Domains

### Development Domain (Claude Code V3)
- `architect` - System design and architecture
- `coder` - Code implementation
- `reviewer` - Code review and quality feedback
- `browser-agent` - Web automation and E2E testing
- `deployer` - CI/CD and deployment

### Quality Domain (Agentic QE)
- `test-strategist` - AI-powered test strategy selection
- `unit-test-generator` - Unit test synthesis
- `integration-test-generator` - Integration test synthesis
- `e2e-test-generator` - End-to-end test synthesis
- `coverage-analyzer` - O(log n) coverage gap detection
- `mutation-tester` - Mutation testing for test quality
- `defect-predictor` - ML-powered defect prediction (F1 > 0.8)
- `flaky-test-hunter` - Identify and fix flaky tests
- `chaos-engineer` - Chaos engineering and fault injection
- `resilience-validator` - System resilience validation

### Security Domain (Mixed)
- `security-architect` - Security architecture and threat modeling
- `security-implementer` - Security implementation and fixes
- `security-tester` - Security testing and vulnerability scanning
- `sast-scanner` - Static application security testing
- `dast-scanner` - Dynamic application security testing
- `compliance-auditor` - Regulatory compliance validation

### Learning Domain (Shared)
- `sona-optimizer` - SONA pattern optimization
- `memory-indexer` - HNSW indexing and vector operations
- `trajectory-tracker` - Execution trajectory tracking
- `reasoning-bank-manager` - ReasoningBank pattern management
- `q-learning-optimizer` - Q-Learning for coverage optimization
- `cross-project-transfer` - Cross-project learning transfer

### TDD Subagents
- `tdd-red-phase` - TDD Red phase - failing test creation
- `tdd-green-phase` - TDD Green phase - minimal implementation
- `tdd-refactor-phase` - TDD Refactor phase - code improvement

## Performance Targets

| Metric | Target | Achieved |
|--------|--------|----------|
| Vector Search | <3ms | 150x faster |
| Flash Attention | 2.49x speedup | yes |
| Coordination Latency | <100ms | yes |
| Token Reduction | 75% | yes |
| Defect Prediction F1 | >0.8 | yes |

## Configuration

See `config/skill.yaml` for full configuration options including:
- Swarm topology settings
- Learning mode configurations
- Quality gate thresholds
- Model routing strategies
- TDD/DDD/ADR methodology settings

## Migration from Deprecated Skills

### From agentic-qe
```bash
# Old
npx aqe agent spawn test-generator -t "Generate tests"

# New
npx claude-flow@alpha agent spawn --type unit-test-generator
```

### From reasoningbank-intelligence
```typescript
// Old
import { ReasoningBank } from 'agentic-flow/reasoningbank';
const rb = new ReasoningBank({ persist: true });

// New - Unified memory handles this
import { UnifiedMemory } from '@claude-flow/build-with-quality-skill';
const memory = new UnifiedMemory({ sonaMode: 'balanced' });
```

### From pair-programming
```bash
# Old
claude-flow pair --start --mode tdd

# New - Use TDD agents directly
npx claude-flow@alpha agent spawn --type tdd-red-phase
npx claude-flow@alpha agent spawn --type tdd-green-phase
npx claude-flow@alpha agent spawn --type tdd-refactor-phase
```

## Related Skills (Complementary)

These skills work **alongside** build-with-quality:
- `sparc-methodology` - Higher-level orchestration framework
- `swarm-orchestration` / `swarm-advanced` - Lower-level swarm primitives
- `verification-quality` - Truth scoring and rollback (complementary)
- `github-*` - GitHub-specific integrations
- `hive-mind-advanced` - Specialized Byzantine consensus features

## Consensus Mechanisms

| Decision Type | Algorithm | Threshold |
|--------------|-----------|-----------|
| Code review approval | Weighted Voting | >0.7 weighted |
| Quality gate passage | Byzantine Fault Tolerant | 2/3 majority |
| Pattern storage | CRDT | Conflict-free merge |
| Architecture decisions | Raft | Leader-based |

## Execution Modes

### Dual Execution Support

The skill supports two execution modes:

1. **MCP Tools (Preferred)**: Use `mcp__claude-flow__*` tools when available
2. **CLI Fallback**: Use `npx claude-flow@alpha` commands when MCP is not configured

Detection logic:
```
IF mcp__claude-flow__swarm_init is available:
    USE MCP Tools
ELSE:
    USE CLI Commands
```

### Agent Coordination Protocol

All spawned agents MUST run coordination hooks:

```bash
# Before starting work
npx claude-flow@alpha hooks pre-task --description "[task]"

# After file operations
npx claude-flow@alpha hooks post-edit --file "[file]"

# Share with other agents
npx claude-flow@alpha hooks notification --message "[update]"

# After completing
npx claude-flow@alpha hooks post-task --task-id "[id]"
```

## Documentation

- **[BUILD-WITH-QUALITY-PROMPT.md](./BUILD-WITH-QUALITY-PROMPT.md)** - Copy-paste activation prompt
- **[USAGE-EXAMPLES.md](./USAGE-EXAMPLES.md)** - 5 complete project examples
- **[config/skill.yaml](./config/skill.yaml)** - Full configuration options
- **[README.md](./README.md)** - API reference and installation

## License

MIT
