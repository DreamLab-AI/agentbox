# Build with Quality - Consolidated Skill Prompt

## Overview

This is a **self-contained, copy-paste prompt** that invokes the full Claude Flow V3 + Agentic QE skill for building software with integrated quality engineering. Use this prompt when starting any new project or feature.

> **EXECUTION REQUIREMENT:** Claude Code MUST use **Claude Flow** to orchestrate the swarm. Use MCP tools (`mcp__claude-flow__*`) if available, otherwise use **CLI commands** (`npx claude-flow@alpha ...`) as fallback. See [CLAUDE FLOW SWARM ORCHESTRATION](#claude-flow-swarm-orchestration) section for both approaches.

## Configuration Reference

This prompt is derived from the skill configuration at:
- **Skill Config:** [`config/skill.yaml`](./config/skill.yaml)
- **Usage Examples:** [`USAGE-EXAMPLES.md`](./USAGE-EXAMPLES.md)

All thresholds, agent definitions, methodology settings, and quality gates are defined in `skill.yaml`. This prompt summarizes them for human-readable activation.

| Prompt Says | skill.yaml Source |
|-------------|-------------------|
| "85% coverage" | `quality_gates.coverage.minimum: 85` |
| "TDD red-green-refactor" | `methodologies.tdd.phases` |
| "111+ agents" | `swarm.domains[*].agents` |
| "SONA balanced mode" | `learning.sona.mode: balanced` |
| "WCAG AA" | `quality_gates.accessibility.level: AA` |

---

## THE PROMPT

Copy everything below the line and paste it when starting a new project:

---

```markdown
# Build with Quality - Claude Flow V3 Swarm Architecture

## SKILL ACTIVATION

I am invoking the **Build with Quality** skill (v1.1.0) which combines:
- **Claude Flow V3**: 60+ development agents
- **Agentic QE**: 51 quality engineering agents
- **Shared Coordination**: 3 coordination agents
- **Total**: 111+ specialized agents

## PREREQUISITES

Before proceeding, ensure **BOTH** orchestration tools are initialized:

### 1. Claude Flow V3 (Development & Coordination Agents)
```bash
# Check if installed
npx claude-flow --version

# If not installed, initialize:
npx claude-flow@alpha init

# Or full installation with MCP:
curl -fsSL https://cdn.jsdelivr.net/gh/ruvnet/claude-flow@main/scripts/install.sh | bash -s -- --full
```

### 2. Agentic QE (Quality Engineering Agents)
```bash
# Install globally
npm install -g agentic-qe

# Initialize in your project
aqe init --auto

# Add as MCP server to Claude Code
claude mcp add aqe -- aqe-mcp

# Verify connection
claude mcp list  # Should show 'aqe' server
```

### 3. Verify Both Tools
```bash
npx claude-flow --version   # Should show version
aqe --version               # Should show version
claude mcp list             # Should show 'aqe' in list
```

> **Without both tools**: The skill falls back to single-agent execution with manual quality checks. You lose swarm coordination, AI test generation, mutation testing, defect prediction, and pattern learning.

## PROJECT CONTEXT

**Project Name:** [YOUR_PROJECT_NAME]
**Project Type:** [web-app | api | library | cli | mobile | data-pipeline]
**Tech Stack:** [e.g., React + TypeScript + Node.js]
**Description:** [Brief description of what you're building]

## FEATURE/TASK REQUEST

**Task:** [Describe what you want to build]
**Acceptance Criteria:**
- [ ] [Criterion 1]
- [ ] [Criterion 2]
- [ ] [Criterion 3]

---

## SWARM TOPOLOGY

**Architecture:** Hierarchical-mesh
**Max Concurrent Agents:** 100

### Domain Configuration

| Domain | Max Concurrent | Agents |
|--------|---------------|--------|
| **Coordination** | 1 | unified-coordinator, event-bridge, mcp-coordinator |
| **Development** | 4 | architect, coder, reviewer, browser-agent, deployer |
| **Quality** | 4 | test-strategist, unit-test-generator, integration-test-generator, e2e-test-generator, coverage-analyzer, mutation-tester, defect-predictor, flaky-test-hunter, chaos-engineer, resilience-validator |
| **Security** | 2 | security-architect, security-implementer, security-tester, sast-scanner, dast-scanner, compliance-auditor |
| **Learning** | 2 | sona-optimizer, memory-indexer, trajectory-tracker, reasoning-bank-manager, q-learning-optimizer |

---

## EXECUTION WORKFLOW

### Phase 1: Planning & Design
```
Agents: unified-coordinator, architect, security-architect, test-strategist
Tasks:
1. Analyze requirements and decompose into bounded contexts (DDD)
2. Create Architecture Decision Record (ADR)
3. Define test strategy with coverage targets
4. Perform threat modeling
5. Select optimal swarm topology for task complexity
```

### Phase 2: Implementation (TDD Cycle)
```
Agents: coder, unit-test-generator, reviewer, coverage-analyzer
Cycle:
1. RED: Generate failing test first
2. GREEN: Implement minimum code to pass
3. REFACTOR: Clean up while maintaining green
4. COMMIT: After each green phase
Repeat until feature complete
```

### Phase 3: Quality Validation
```
Agents: integration-test-generator, e2e-test-generator, mutation-tester,
        defect-predictor, chaos-engineer, compliance-auditor
Tasks:
1. Generate integration tests
2. Generate e2e tests (Playwright)
3. Run mutation testing
4. Execute defect prediction model
5. Perform chaos testing
6. Audit compliance (WCAG, security)
```

### Phase 4: Learning & Persistence
```
Agents: sona-optimizer, reasoning-bank-manager, memory-indexer
Tasks:
1. Capture successful patterns
2. Store in ReasoningBank with confidence tiers
3. Update Q-learning model for coverage optimization
4. Enable cross-project transfer
```

---

## QUALITY GATES

### Gate 1: Pre-Implementation
| Check | Threshold | Required |
|-------|-----------|----------|
| ADR documented | Yes | Y |
| Threat model complete | Yes | Y |
| Test strategy defined | Yes | Y |

### Gate 2: Pre-Merge
| Check | Threshold | Required |
|-------|-----------|----------|
| Code coverage | >=85% overall | Y |
| Critical path coverage | >=95% | Y |
| New code coverage | 100% | Y |
| TypeScript compilation | 0 errors | Y |
| Lint | 0 errors | Y |
| Code review approved | Yes | Y |

### Gate 3: Security
| Check | Threshold | Required |
|-------|-----------|----------|
| SAST scan | 0 critical/high | Y |
| DAST scan | 0 critical/high | Y |
| Compliance score | >=90% | Y |
| Secrets scan | 0 exposed | Y |

### Gate 4: Accessibility
| Check | Threshold | Required |
|-------|-----------|----------|
| WCAG level | AA minimum | Y |
| Color contrast | >=85% | Y |
| Keyboard navigation | >=80% | Y |

### Gate 5: Resilience
| Check | Threshold | Required |
|-------|-----------|----------|
| Network resilience | >=70% | Y |
| Resource exhaustion | >=75% | Y |
| Graceful degradation | >=80% | Y |

---

## MODEL ROUTING (TinyDancer)

| Model | Complexity Range | Use Cases |
|-------|-----------------|-----------|
| **Haiku** | 0-20 | Syntax fixes, simple tests, type annotations |
| **Sonnet** | 20-70 | Implementation, test generation, bug fixes, reviews |
| **Opus** | 70-100 | Architecture, security scans, chaos tests, defect prediction |

- Escalation trigger: confidence < 0.6
- Multi-model voting threshold: 0.85

---

## DEVELOPMENT METHODOLOGIES

### Domain-Driven Design (DDD)
```yaml
strategic:
  - Identify subdomains (core, supporting, generic)
  - Define bounded contexts
  - Establish ubiquitous language

tactical:
  - Aggregates (consistency boundaries)
  - Entities (identity-based)
  - Value Objects (immutable)
  - Domain Events (state transitions)
  - Repositories (persistence abstraction)
```

### Architecture Decision Records (ADR)
```markdown
# ADR-XXX: [Title]

## Status
[Proposed | Accepted | Deprecated | Superseded]

## Context
[Why is this decision needed?]

## Decision
[What is the change being proposed?]

## Consequences
[What are the positive and negative effects?]
```

### Test-Driven Development (TDD)
```yaml
cycle:
  red: Write failing test first
  green: Minimum code to pass
  refactor: Clean up, maintain green

naming: "should_[expected]_when_[condition]"
commit_policy: After each green phase
```

---

## CONSENSUS MECHANISMS

| Decision Type | Algorithm | Threshold |
|--------------|-----------|-----------|
| Code review approval | Weighted Voting | >0.7 weighted |
| Quality gate passage | Byzantine Fault Tolerant | 2/3 majority |
| Pattern storage | CRDT | Conflict-free merge |
| Architecture decisions | Raft | Leader-based |

---

## LEARNING CONFIGURATION

### SONA (Self-Optimizing Neural Architecture)
```yaml
mode: balanced
latency_target: 18ms
quality_target: 0.75
memory_budget: 50MB
```

### ReasoningBank Confidence Tiers
| Tier | Confidence | Usage |
|------|------------|-------|
| Platinum | >=0.95 | Auto-apply patterns |
| Gold | >=0.85 | Suggest with high priority |
| Silver | >=0.75 | Suggest as option |
| Bronze | >=0.70 | Store for learning |

### Q-Learning Coverage
```yaml
state_dimensions: 12
learning_rate: 0.01
discount_factor: 0.99
exploration_rate: 0.1
```

---

## PERFORMANCE TARGETS

| Metric | Target |
|--------|--------|
| Vector search (HNSW) | <3ms |
| Flash Attention speedup | >=2.49x |
| Token reduction | 75% |
| Coordination latency | <100ms |
| Startup time | <500ms |

---

## DELIVERABLES CHECKLIST

At completion, ensure:

- [ ] All code implemented following TDD
- [ ] ADR documented for significant decisions
- [ ] Unit tests with >=85% coverage
- [ ] Integration tests for cross-module interactions
- [ ] E2E tests for critical user flows
- [ ] Security scan passed (0 critical/high)
- [ ] Accessibility audit passed (WCAG AA)
- [ ] Chaos testing completed
- [ ] Patterns captured in ReasoningBank
- [ ] Code reviewed and approved
- [ ] All quality gates passed
- [ ] Committed with descriptive messages
- [ ] Pushed to feature branch

---

## CLAUDE FLOW SWARM ORCHESTRATION

**CRITICAL: Claude Code MUST use Claude Flow to orchestrate the swarm.**

Claude Flow can be used in two ways:
1. **MCP Tools** (preferred) - If `mcp__claude-flow__*` tools are available
2. **CLI Commands** (fallback) - If MCP is not configured, use `npx claude-flow@alpha` commands

---

### Option A: MCP Tools (When Available)

Use these MCP tools in ONE parallel batch:

```
mcp__claude-flow__swarm_init {
  topology: "hierarchical-mesh",
  maxAgents: 13,
  strategy: "parallel"
}

mcp__claude-flow__agent_spawn { type: "coordinator", name: "unified-coordinator" }
mcp__claude-flow__agent_spawn { type: "architect", name: "system-architect" }
mcp__claude-flow__agent_spawn { type: "coder", name: "primary-developer" }
mcp__claude-flow__agent_spawn { type: "coder", name: "secondary-developer" }
mcp__claude-flow__agent_spawn { type: "reviewer", name: "code-reviewer" }
mcp__claude-flow__agent_spawn { type: "tester", name: "test-strategist" }
mcp__claude-flow__agent_spawn { type: "tester", name: "unit-test-generator" }
mcp__claude-flow__agent_spawn { type: "tester", name: "e2e-test-generator" }
mcp__claude-flow__agent_spawn { type: "analyst", name: "coverage-analyzer" }
mcp__claude-flow__agent_spawn { type: "security", name: "security-scanner" }
mcp__claude-flow__agent_spawn { type: "researcher", name: "tech-researcher" }
mcp__claude-flow__agent_spawn { type: "coordinator", name: "quality-coordinator" }
```

Then orchestrate and monitor:
```
mcp__claude-flow__task_orchestrate { task: "[PROJECT]", strategy: "parallel" }
mcp__claude-flow__memory_usage { action: "store", key: "project/init", value: {...} }
mcp__claude-flow__swarm_status { verbose: true }
```

---

### Option B: CLI Commands (Fallback When MCP Not Available)

**If `mcp__claude-flow__*` tools are NOT available, use CLI commands instead:**

#### Step 1: Initialize Swarm
```bash
npx claude-flow@alpha swarm init --topology hierarchical-mesh --max-agents 13 --strategy parallel
```

#### Step 2: Spawn Agents (run in parallel via Bash)
```bash
npx claude-flow@alpha agent spawn --type coordinator --name unified-coordinator &
npx claude-flow@alpha agent spawn --type architect --name system-architect &
npx claude-flow@alpha agent spawn --type coder --name primary-developer &
npx claude-flow@alpha agent spawn --type coder --name secondary-developer &
npx claude-flow@alpha agent spawn --type reviewer --name code-reviewer &
npx claude-flow@alpha agent spawn --type tester --name test-strategist &
npx claude-flow@alpha agent spawn --type tester --name unit-test-generator &
npx claude-flow@alpha agent spawn --type tester --name e2e-test-generator &
npx claude-flow@alpha agent spawn --type analyst --name coverage-analyzer &
npx claude-flow@alpha agent spawn --type security --name security-scanner &
npx claude-flow@alpha agent spawn --type researcher --name tech-researcher &
npx claude-flow@alpha agent spawn --type coordinator --name quality-coordinator &
wait
```

#### Step 3: Orchestrate Tasks
```bash
npx claude-flow@alpha task orchestrate --task "[PROJECT_DESCRIPTION]" --strategy parallel
```

#### Step 4: Store Memory
```bash
npx claude-flow@alpha memory store --key "project/phase/decisions" --value '{"decision": "value"}'
```

#### Step 5: Monitor Progress
```bash
npx claude-flow@alpha swarm status --verbose
npx claude-flow@alpha agent list
npx claude-flow@alpha agent metrics
```

---

### Agent Coordination Protocol (Required for ALL Agents)

Each spawned Task agent MUST run these CLI hooks for coordination:

**Before starting work:**
```bash
npx claude-flow@alpha hooks pre-task --description "[task description]" --auto-spawn-agents false
```

**After each file operation:**
```bash
npx claude-flow@alpha hooks post-edit --file "[filepath]" --memory-key "agent/[step]"
```

**To share decisions with other agents:**
```bash
npx claude-flow@alpha hooks notification --message "[what was decided/done]" --telemetry true
```

**After completing work:**
```bash
npx claude-flow@alpha hooks post-task --task-id "[task]" --analyze-performance true
```

---

### Detection Logic

Claude Code should check for MCP availability at the start:

```
IF mcp__claude-flow__swarm_init is available:
    USE MCP Tools (Option A)
ELSE:
    USE CLI Commands (Option B)
```

Both approaches provide the same swarm coordination - MCP is just more integrated.

---

## INVOCATION

Execute this skill by:

1. Copying this entire prompt
2. Filling in the PROJECT CONTEXT section
3. Filling in the FEATURE/TASK REQUEST section
4. Submitting to Claude Code with claude-flow initialized

**Claude Code will automatically:**
1. Call `mcp__claude-flow__swarm_init` with hierarchical-mesh topology
2. Spawn agents using `mcp__claude-flow__agent_spawn` in parallel
3. Orchestrate tasks with `mcp__claude-flow__task_orchestrate`
4. Store patterns with `mcp__claude-flow__memory_usage`
5. Monitor with `mcp__claude-flow__swarm_status`

The swarm will:
1. Decompose your task across domains
2. Execute in parallel where possible
3. Enforce quality gates at each phase
4. Learn patterns for future acceleration
5. Deliver tested, secure, accessible code
```

---

## QUICK REFERENCE CARD

### Minimal Invocation (Copy & Customize)

```markdown
Build with Quality skill (v1.1.0).

Project: [NAME] | Stack: [TECH] | Task: [DESCRIPTION]

Methodology: DDD + ADR + TDD
Quality: 85% coverage, security scan, WCAG AA

Execute and deliver tested code.
```

### Rapid Prototype (Reduced Gates)

```markdown
Build with Quality skill - PROTOTYPE MODE.

Project: [NAME] | Stack: [TECH] | Task: [DESCRIPTION]

Quality gates (relaxed):
- Coverage: 60%
- Security: Critical only
- Accessibility: Skip
- Chaos: Skip

Focus on working implementation, tests for core paths only.
```

### Production Critical (Maximum Gates)

```markdown
Build with Quality skill - PRODUCTION MODE.

Project: [NAME] | Stack: [TECH] | Task: [DESCRIPTION]

Quality gates (strict):
- Coverage: 95% overall, 100% critical paths
- Security: 0 any severity
- Accessibility: WCAG AAA
- Chaos: 90% all categories
- Mutation testing: 80% mutation score

Full quality validation required before delivery.
```

---

## CUSTOMIZATION OPTIONS

### For Different Project Types

**Web Application:**
```yaml
emphasis:
  - e2e-test-generator (Playwright)
  - accessibility audits (WCAG)
  - browser-agent (visual validation)
security_focus: XSS, CSRF, injection
```

**API/Backend:**
```yaml
emphasis:
  - integration-test-generator
  - contract-validator
  - chaos-engineer
security_focus: authentication, authorization, rate limiting
```

**Library/Package:**
```yaml
emphasis:
  - unit-test-generator
  - mutation-tester
  - api-documentation
security_focus: dependency vulnerabilities
```

**CLI Tool:**
```yaml
emphasis:
  - integration-test-generator
  - edge-case coverage
  - error handling validation
security_focus: command injection, path traversal
```

### Adjusting Quality Thresholds

For **rapid prototyping** (reduce gates):
```yaml
coverage: 60%
security: critical only
accessibility: skip
chaos: skip
```

For **production critical** (increase gates):
```yaml
coverage: 95% overall, 100% critical
security: 0 any severity
accessibility: WCAG AAA
chaos: 90% all categories
```

---

## DEGRADED MODE (Tools Not Installed)

If the prerequisite tools are not installed, the skill operates in degraded mode:

### Capability Matrix by Installation State

| Capability | Full (Both Tools) | Claude Flow Only | Agentic QE Only | Neither (Single Agent) |
|------------|-------------------|------------------|-----------------|------------------------|
| **Swarm orchestration** | Y 100 agents | Y 60 agents | N | N |
| **Development agents** | Y architect, coder, reviewer | Y | N | N Manual |
| **AI test generation** | Y All types | N Basic | Y | N Manual |
| **Coverage analysis** | Y HNSW O(log n) | N | Y | N `npm test --coverage` |
| **Mutation testing** | Y | N | Y | N Not available |
| **Defect prediction** | Y F1 > 0.8 | N | Y | N Not available |
| **Chaos engineering** | Y | N | Y | N Not available |
| **Security scanning** | Y SAST + DAST | Y SAST | N | N Manual |
| **SONA learning** | Y Full | Y Partial | Y Partial | N None |
| **ReasoningBank** | Y Full | Y Partial | Y Partial | N None |
| **Quality gates** | Y Automated | Y Partial | Y Partial | N Manual |

### Fallback Behavior

**Without Claude Flow V3:**
- No swarm coordination (single-threaded execution)
- No architect/coder/reviewer agent separation
- No browser-agent visual validation
- Security scanning limited to manual SAST

**Without Agentic QE:**
- No AI-powered test generation
- No mutation testing (critical for test quality)
- No defect prediction model
- No chaos/resilience testing
- Coverage analysis via basic `npm test -- --coverage`
- No flaky test detection

**Without Both (Current Default):**
- Claude (single agent) follows TDD methodology manually
- Tests written by Claude without specialized generators
- Coverage checked via CLI tools
- No pattern learning or persistence
- Quality gates checked manually via build/test commands
- ~40% slower than full swarm execution

### Recommended Minimum

For meaningful skill benefits, install at least **one** tool:

```bash
# Option A: Development focus (faster coding, parallel work)
npx claude-flow@alpha init

# Option B: Quality focus (better tests, mutation, prediction)
npm install -g agentic-qe && aqe init --auto && claude mcp add aqe -- aqe-mcp

# Option C: Full capability (recommended)
# Install both as per PREREQUISITES section
```

---

## REFERENCES

- [Claude Flow V3](https://github.com/ruvnet/claude-flow/tree/main/v3) - Multi-agent coordination system (60+ agents)
- [Agentic QE](https://github.com/proffesor-for-testing/agentic-qe) - Quality engineering platform (51 agents)
- [Build with Quality Skill](https://github.com/mondweep/vibe-cast/tree/claude/claude-code-v3-skill-KucJF/claude-code-v3-qe-skill) - Combined skill implementation

---

*Template Version: 1.1.0*
*Last Updated: 2026-02-01*
*Compatible with: claude-flow@alpha, agentic-qe@latest*
