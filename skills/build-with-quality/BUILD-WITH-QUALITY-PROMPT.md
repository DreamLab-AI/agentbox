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
| "EDD 7-step loop" (v1.2.0) | `methodologies.edd.loop` |
| "Evidence Coverage gate" (v1.2.0) | `quality_gates.evidence_coverage` |
| "anti-fox separation" (v1.2.0) | `methodologies.edd.anti_fox` |
| "114+ agents" | `swarm.domains[*].agents` |
| "SONA balanced mode" | `learning.sona.mode: balanced` |
| "WCAG AA" | `quality_gates.accessibility.level: AA` |

---

## THE PROMPT

Copy everything below the line and paste it when starting a new project:

---

```markdown
# Build with Quality - Claude Flow V3 Swarm Architecture

## SKILL ACTIVATION

I am invoking the **Build with Quality** skill (v1.2.0) which combines:
- **Claude Flow V3**: 62+ development agents (incl. expectation-author, tdd-stabilizer)
- **Agentic QE**: 53 quality engineering agents (incl. evidence-producer, evidence-auditor)
- **Shared Coordination**: 3 coordination agents
- **Total**: 114+ specialized agents

**v1.2.0 adds Expectation-Driven Development (EDD)** as the design-time
conversation layer that wraps the existing DDD/ADR/TDD stack. See
EDD-PROTOCOL.md. Key contract: every shipped feature has an EXP-NNN
artifact, every expectation has executed evidence with receipts, the
auditor agent is on a different model family from the producer, and
`regression_critical` expectations are stabilized as automated tests
before merge.

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

## EXPECTATIONS (EDD — v1.2.0)

Author 2-6 expectations BEFORE the coder agent runs. Each expectation
captures one behaviour you'd explain in a single breath, with edge cases
and explicit counter-examples. The expectation-author agent will help.

```yaml
# Save each as .claude/expectations/EXP-NNN.md
- id: EXP-001
  priority: critical          # critical | high | medium | low
  regression_critical: true   # if true, MUST be stabilized as test before merge
  evidence_category: executable  # executable | partially-verifiable | not-executable
  expectation: |
    [Single-sentence behavioural claim, then 2-6 specific sentences:
     numbers, ordering, error modes, what should NOT happen]
  in_scope: [edge case 1, edge case 2]
  out_of_scope: [adjacent concern in another EXP]
  counter_examples: [behaviour that would falsify this expectation]
```

**Specificity rule:** "Handles large uploads efficiently" is not an
expectation. "A 500MB upload completes within 30s and never holds the full
file in memory; a 5GB upload uses streaming and peaks under 256MB RSS" is.

**Workshop pattern** (recommended for shared business logic): two humans
draft expectations together, then one reviews the other's. Silent
contradictions between expectations are worse than no spec.

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

### Phase 1.5: Expectation Authoring (NEW v1.2.0 — EDD step 1)
```
Agents: expectation-author, unified-coordinator
Human: required (signs off expectations as `accepted`)
Tasks:
1. Draft EXP-NNN artifacts in .claude/expectations/ (one per behaviour)
2. Apply specificity rule (numbers, ordering, error modes)
3. List counter-examples ("must NOT happen")
4. Tag each with priority + regression_critical + evidence_category
5. Workshop pattern for shared business logic (2nd human reviews)
GATE: human signs off expectations BEFORE coder agent starts implementation
```

### Phase 2: Implementation (TDD Cycle, informed by expectations)
```
Agents: coder, unit-test-generator, reviewer, coverage-analyzer
Inputs: EXP-NNN artifacts + SPEC + ADR
Cycle:
1. RED: Generate failing test first
2. GREEN: Implement minimum code to pass
3. REFACTOR: Clean up while maintaining green
4. COMMIT: After each green phase
Repeat until feature complete
```

### Phase 2.5: Evidence Production & Audit (NEW v1.2.0 — EDD steps 3-4)
```
Agents: evidence-producer (model A), evidence-auditor (model family ≠ A)
Human: required (adversarial review in EDD step 5)
Tasks:
1. evidence-producer executes scenarios per EXP-NNN with tool use
2. Captures execution receipts: command + raw output + timestamp + git_sha
3. Writes .claude/evidence/EXP-NNN.evidence.md
4. evidence-auditor (DIFFERENT MODEL FAMILY) verifies independently
   - Mandate: find a counter-example, not confirm
   - MUST run ≥1 adversarial probe the producer didn't run
5. Human reviews adversarially: "what input would break this?"
6. Loop back to Phase 2 if gaps; iterate (EDD step 6)
GATE: narrative evidence ("I tested it and it works") is auto-rejected
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
7. Evidence Coverage gate: every feature has expectation, every expectation
   has executed evidence, auditor distinct, zero stale evidence
```

### Phase 3.5: Stabilization (NEW v1.2.0 — EDD step 7)
```
Agents: tdd-stabilizer
Tasks:
1. For every regression_critical expectation, generate an automated test
2. Test ID linked to EXP-NNN via stabilized_by frontmatter field
3. Expectation status: proven -> stable
GATE: cannot ship a regression_critical EXP without a stabilizing test
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

### Gate 6: Evidence Coverage (NEW v1.2.0 — EDD)
| Check | Threshold | Required |
|-------|-----------|----------|
| Every shipped feature has ≥1 EXP-NNN | 100% | Y |
| Every EXP has executed evidence | 100% | Y |
| Evidence has receipts (cmd + raw output + SHA + timestamp) | 100% | Y |
| evidence-auditor agent ≠ evidence-producer agent | 100% | Y |
| evidence-auditor model family ≠ producer model family | 100% | Y |
| Auditor ran ≥1 adversarial counter-example probe | 100% | Y |
| `regression_critical` EXP has `stabilized_by` test reference | 100% | Y |
| Stale evidence (>30 days OR post-SHA-drift) | 0 entries | Y |

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

### Expectation-Driven Development (EDD) — NEW v1.2.0
```yaml
artifacts:
  expectations: .claude/expectations/EXP-NNN.md  # one behaviour per file
  evidence: .claude/evidence/EXP-NNN.evidence.md  # execution receipts

loop:
  1_formulate: human + expectation-author
  2_implement: coder (input: EXP + SPEC + ADR)
  3_produce: evidence-producer (executes scenarios, captures receipts)
  4_audit: evidence-auditor (DIFFERENT model family, adversarial probe)
  5_challenge: human (focus: subjective qualities, scope gaps)
  6_iterate: loop back to step 2 if gaps
  7_stabilize: tdd-stabilizer (regression_critical -> automated test)

evidence_categories:
  executable: gold standard (functions, APIs, scripts)
  partially_verifiable: plans/dry-runs (infra, schemas)
  not_executable: requires human spot-check (UI, third-party)

anti_fox:
  producer_role: evidence-producer
  auditor_role: evidence-auditor (different agent, different model family)
  narrative_evidence: auto-rejected
  auditor_mandate: find counter-example, do not confirm

stabilization:
  required_when: regression_critical == true
  cannot_ship_without: stabilized_by test reference

versioning:
  staleness: 30 days OR git SHA drift
  stale_blocks_gate: true
```

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

- [ ] EXP-NNN expectations authored, signed off by human (NEW v1.2.0)
- [ ] All code implemented following TDD, against the expectations
- [ ] Evidence files in .claude/evidence/ with receipts (NEW v1.2.0)
- [ ] Auditor verdicts recorded by a different agent than producer (NEW v1.2.0)
- [ ] Every regression_critical EXP has stabilized_by test reference (NEW v1.2.0)
- [ ] ADR documented for significant decisions
- [ ] Unit tests with >=85% coverage
- [ ] Integration tests for cross-module interactions
- [ ] E2E tests for critical user flows
- [ ] Security scan passed (0 critical/high)
- [ ] Accessibility audit passed (WCAG AA)
- [ ] Chaos testing completed
- [ ] Evidence Coverage gate passed (NEW v1.2.0)
- [ ] Patterns AND high-quality expectations captured in ReasoningBank
- [ ] Code reviewed and approved
- [ ] All 6 quality gates passed
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
  maxAgents: 17,
  strategy: "parallel"
}

mcp__claude-flow__agent_spawn { type: "coordinator", name: "unified-coordinator" }
mcp__claude-flow__agent_spawn { type: "architect", name: "system-architect" }
mcp__claude-flow__agent_spawn { type: "researcher", name: "expectation-author", model: "sonnet" }     // NEW v1.2.0
mcp__claude-flow__agent_spawn { type: "coder", name: "primary-developer", model: "sonnet" }
mcp__claude-flow__agent_spawn { type: "coder", name: "secondary-developer", model: "sonnet" }
mcp__claude-flow__agent_spawn { type: "reviewer", name: "code-reviewer" }
mcp__claude-flow__agent_spawn { type: "tester", name: "test-strategist" }
mcp__claude-flow__agent_spawn { type: "tester", name: "unit-test-generator" }
mcp__claude-flow__agent_spawn { type: "tester", name: "e2e-test-generator" }
mcp__claude-flow__agent_spawn { type: "tester", name: "tdd-stabilizer" }                              // NEW v1.2.0
mcp__claude-flow__agent_spawn { type: "tester", name: "evidence-producer", model: "sonnet" }          // NEW v1.2.0 — PRODUCER
mcp__claude-flow__agent_spawn { type: "analyst", name: "evidence-auditor", model: "opus" }            // NEW v1.2.0 — AUDITOR (different model family)
mcp__claude-flow__agent_spawn { type: "analyst", name: "coverage-analyzer" }
mcp__claude-flow__agent_spawn { type: "security", name: "security-scanner" }
mcp__claude-flow__agent_spawn { type: "researcher", name: "tech-researcher" }
mcp__claude-flow__agent_spawn { type: "coordinator", name: "quality-coordinator" }
```

**Anti-fox rule:** `evidence-producer` and `evidence-auditor` MUST be on
different model families. The example above pairs Sonnet producer with
Opus auditor; Sonnet+Haiku or Opus+Haiku also work. Same-family pairs
inherit the same blind spots and break the audit.

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
npx claude-flow@alpha swarm init --topology hierarchical-mesh --max-agents 17 --strategy parallel
```

#### Step 2: Spawn Agents (run in parallel via Bash)
```bash
npx claude-flow@alpha agent spawn --type coordinator --name unified-coordinator &
npx claude-flow@alpha agent spawn --type architect --name system-architect &
npx claude-flow@alpha agent spawn --type researcher --name expectation-author --model sonnet &       # NEW v1.2.0
npx claude-flow@alpha agent spawn --type coder --name primary-developer --model sonnet &
npx claude-flow@alpha agent spawn --type coder --name secondary-developer --model sonnet &
npx claude-flow@alpha agent spawn --type reviewer --name code-reviewer &
npx claude-flow@alpha agent spawn --type tester --name test-strategist &
npx claude-flow@alpha agent spawn --type tester --name unit-test-generator &
npx claude-flow@alpha agent spawn --type tester --name e2e-test-generator &
npx claude-flow@alpha agent spawn --type tester --name tdd-stabilizer &                              # NEW v1.2.0
npx claude-flow@alpha agent spawn --type tester --name evidence-producer --model sonnet &            # NEW v1.2.0 — PRODUCER
npx claude-flow@alpha agent spawn --type analyst --name evidence-auditor --model opus &              # NEW v1.2.0 — AUDITOR (different model family)
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
Build with Quality skill (v1.2.0).

Project: [NAME] | Stack: [TECH] | Task: [DESCRIPTION]

Methodology: EDD + DDD + ADR + TDD
Quality: 85% coverage, security scan, WCAG AA, evidence coverage

Expectations: I will author 2-6 EXP-NNN before coder runs.
Anti-fox: producer (sonnet) + auditor (opus) on different model families.
Stabilization: regression_critical EXPs MUST have stabilized_by tests.

Execute and deliver tested code with proven evidence.
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

*Template Version: 1.2.0*
*Last Updated: 2026-05-03*
*Compatible with: claude-flow@alpha, agentic-qe@latest*
*New in v1.2.0: Expectation-Driven Development loop, evidence-producer / evidence-auditor agents, Evidence Coverage gate. See EDD-PROTOCOL.md.*
