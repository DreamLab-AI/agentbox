---
name: build-with-quality
description: "Unified Claude Code V3 + Agentic QE meta-skill for optimal project building with 114+ specialized agents, unified learning (SONA + ReasoningBank), TinyDancer model routing (75% token reduction), Expectation-Driven Development (EDD) loop, and comprehensive quality gates including evidence coverage. Supersedes agentic-qe, reasoningbank-*, and pair-programming skills."
license: MIT
metadata:
  version: 1.2.0
  author: Claude Flow
  tags: [meta-skill, development, qa, edd, tdd, bdd, adr, ddd, agents, quality-gates, evidence, sona, hnsw, coverage, security, accessibility, chaos-testing]
  mcp_server: false
  supersedes: [agentic-qe, reasoningbank-intelligence, reasoningbank-agentdb, pair-programming]
---

# Build with Quality - Unified Meta-Skill

> **Quick Start:** See [BUILD-WITH-QUALITY-PROMPT.md](./BUILD-WITH-QUALITY-PROMPT.md) for a copy-paste activation prompt.
> **Examples:** See [USAGE-EXAMPLES.md](./USAGE-EXAMPLES.md) for 5 complete project examples.
> **EDD Playbook (v1.2.0):** See [EDD-PROTOCOL.md](./EDD-PROTOCOL.md) for the Expectation-Driven Development loop, evidence categories, and anti-fox separation rules.

**[Claude Flow V3](https://github.com/ruvnet/claude-flow/tree/main/v3) + [Agentic QE](https://github.com/proffesor-for-testing/agentic-qe) Combined**

A comprehensive meta-skill that unifies development and quality engineering capabilities, replacing multiple specialized skills with a single cohesive system.

## When Not To Use

- For a quick code change that does not need quality gates or swarm coordination -- edit files directly with Claude Code
- For GitHub-specific PR review without the full quality pipeline -- use the github-code-review skill instead
- For standalone documentation validation and alignment -- use the docs-alignment skill instead
- For SPARC methodology orchestration without quality engineering agents -- use the sparc-methodology skill instead
- For simple unit test generation without the full 111-agent system -- write tests directly or use the TDD workflow in sparc-methodology

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

### 114+ Specialized Agents

| Source | Count | Examples |
|--------|-------|----------|
| Claude Flow V3 | 62+ | architect, coder, reviewer, security-architect, deployer, expectation-author, tdd-stabilizer |
| Agentic QE | 53 | test-strategist, coverage-analyzer, defect-predictor, chaos-engineer, evidence-producer, evidence-auditor |
| Shared | 3 | unified-coordinator, event-bridge, unified-memory-coordinator |

### Unified Learning System

- **SONA (Self-Optimising Neural Architecture)**: 5 modes (real-time, balanced, research, edge, batch)
- **ReasoningBank**: Pattern storage with confidence tiers (Bronze -> Platinum)
- **HNSW Indexing**: O(log n) vector search - 150x faster than linear
- **Dream Cycles**: Background pattern consolidation
- **Q-Learning**: Coverage optimisation with 12-dimensional state space

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
- **Evidence Coverage** (NEW v1.2.0): Every shipped feature has an EXP-NNN; every EXP has executed evidence with receipts; auditor distinct from producer; `regression_critical` expectations have a `stabilized_by` test reference; zero stale evidence (>30d or post-SHA-drift)

### Development Methodologies

#### Expectation-Driven Development (EDD) — NEW in v1.2.0

The **design-time conversation layer** between human intent and AI implementation.
Captures what TDD assertions and BDD Given/When/Then templates can't: qualitative
expectations, ordering invariants, systemic properties, and explicit
counter-examples ("must NOT happen"). See [EDD-PROTOCOL.md](./EDD-PROTOCOL.md)
for the full playbook.

- **7-step loop**: formulate -> implement -> produce evidence -> audit -> challenge -> iterate -> stabilize
- **Executed evidence required**: agent must show command, raw output, timestamp, git SHA. Narrative evidence ("I tested it and it works") is auto-rejected.
- **Anti-fox separation**: `evidence-producer` and `evidence-auditor` MUST be different agents on different model families. The auditor's mandate is to find a counter-example, not to confirm.
- **Three evidence categories**: executable (gold), partially verifiable (plans/dry-runs), not executable (requires human spot-check)
- **Stabilization mandatory** for `regression_critical` expectations: every shipped expectation hands off to an automated test (TDD/BDD) via `stabilized_by` field. EDD evidence is a snapshot; tests are the regression alarm. Both layers required.
- **EXP-NNN artifacts** live in `.claude/expectations/`, evidence in `.claude/evidence/`. Linked into BHIL traceability chain alongside SPEC/ADR/TASK.

EDD does **not** replace TDD or BDD. It runs **before** them as the design-time
specification phase, then hands proven scenarios off to TDD/BDD for permanent
regression coverage.

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
- **Best Practices**: Arrange-Act-Assert, descriptive naming, behaviour-focused tests
- **Stabilization role**: TDD agents now also receive proven EDD expectations as input — converting them into permanent regression tests is a first-class TDD task in v1.2.0.

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

Phase 1.5: EXPECTATION AUTHORING (NEW v1.2.0 — EDD step 1)
├── expectation-author agent + human draft EXP-NNN artifacts
├── Each expectation: behaviour + edge cases + counter-examples
├── Specificity rule: precise numbers, ordering, error modes
├── Workshop pattern for shared business logic
└── GATE: human signs off expectations as `accepted` before coder runs

Phase 2: DEVELOPMENT (Parallel)
├── Coder agent writes implementation against EXP-NNN + SPEC + ADR
├── Test-generation creates tests IN PARALLEL
├── Security-architect reviews for vulnerabilities
└── Coverage-analysis identifies gaps

Phase 2.5: EVIDENCE PRODUCTION & AUDIT (NEW v1.2.0 — EDD steps 3-4)
├── evidence-producer executes scenarios per expectation
│   ├── Required receipts: command, raw output, timestamp, git SHA
│   └── Three evidence categories: executable / partial / not-executable
├── evidence-auditor (DIFFERENT model family) independently verifies
│   └── Mandate: find counter-example, do not confirm
├── Human adversarial review (EDD step 5)
└── Loop back to Phase 2 if gaps found (EDD step 6)

Phase 3: QUALITY GATES
├── Quality-assessment evaluates readiness
├── Defect-intelligence predicts bugs
├── Visual-accessibility checks WCAG compliance
├── Chaos-resilience validates fault tolerance
└── Evidence Coverage gate (NEW v1.2.0 — sixth gate)
    ├── Every feature has ≥1 expectation
    ├── Every expectation has executed evidence with receipts
    ├── Auditor distinct from producer
    ├── Stale evidence = 0 (>30d or post-SHA-drift triggers re-run)
    └── regression_critical expectations have stabilized_by reference

Phase 3.5: STABILIZATION (NEW v1.2.0 — EDD step 7)
├── tdd-stabilizer converts proven expectations into automated tests
├── Test ID linked to EXP-NNN via `stabilized_by` frontmatter field
└── Expectation status moves from `proven` -> `stable`

Phase 4: DEPLOYMENT
├── Deployment agent manages CI/CD
├── Contract-testing validates API compatibility
└── Performance agent benchmarks

Phase 5: LEARNING
├── ReasoningBank stores test patterns AND high-quality expectation patterns
├── SONA optimizes future builds
├── Cross-project transfer enables reuse (incl. expectation libraries)
└── Archive: EXP + evidence + test reference becomes living docs
```

## Agent Domains

### Development Domain (Claude Code V3)
- `architect` - System design and architecture
- `coder` - Code implementation
- `reviewer` - Code review and quality feedback
- `browser-agent` - Web automation and E2E testing
- `deployer` - CI/CD and deployment
- `expectation-author` - **NEW v1.2.0** - Helps human draft EXP-NNN artifacts with frontmatter, edge cases, and counter-examples. Enforces specificity rule.
- `tdd-stabilizer` - **NEW v1.2.0** - Converts proven expectations into automated regression tests; updates `stabilized_by` field on EXP-NNN.

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
- `evidence-producer` - **NEW v1.2.0** - Executes scenarios for each EXP-NNN, captures execution receipts (command, raw output, timestamp, git SHA). Tool-use enabled, runs in sandbox.
- `evidence-auditor` - **NEW v1.2.0** - Independently verifies evidence. **MUST run on a different model family than `evidence-producer`** (anti-fox separation). Mandate is to find a counter-example, not confirm.

### Security Domain (Mixed)
- `security-architect` - Security architecture and threat modeling
- `security-implementer` - Security implementation and fixes
- `security-tester` - Security testing and vulnerability scanning
- `sast-scanner` - Static application security testing
- `dast-scanner` - Dynamic application security testing
- `compliance-auditor` - Regulatory compliance validation

### Learning Domain (Shared)
- `sona-optimizer` - SONA pattern optimisation
- `memory-indexer` - HNSW indexing and vector operations
- `trajectory-tracker` - Execution trajectory tracking
- `reasoning-bank-manager` - ReasoningBank pattern management
- `q-learning-optimizer` - Q-Learning for coverage optimisation
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

## AI-First Development Traceability (BHIL Integration)

The [BHIL AI-First Development Toolkit](https://github.com/camalus/BHIL-AI-First-Development-Toolkit)
extends this skill with machine-actionable specification quality. The bottleneck in AI-native
development is **specification quality**, not code generation. BHIL adds:

### Artifact Chain Traceability

Full bidirectional traceability from PRD through deployment:

```
PRD-NNN → SPEC-NNN → ADR-NNN → TASK-NNN → CODE → REVIEW → DEPLOY
```

Each artifact carries YAML frontmatter with parent IDs:
```yaml
---
id: SPEC-042
parent_prd: PRD-012
linked_adrs: [ADR-007, ADR-008]
tasks: [TASK-101, TASK-102, TASK-103]
status: approved
---
```

**Agents:** Use `new-sprint`, `new-feature`, `new-adr` skills to scaffold artifacts with
correct IDs and cross-links. Machine-readable IDs enable full feature-to-code-to-test lineage.

### AI-Native ADR Categories

Three ADR types beyond standard architecture decisions:

| ADR Type | Purpose | Key Fields |
|----------|---------|------------|
| **Model Selection** | LLM benchmarking with cost/latency/quality matrix | Model, benchmarks, cost/req, latency p99, re-eval trigger |
| **Prompt Strategy** | Versioned prompt approaches with eval thresholds | Approach (zero-shot/CoT/RAG), version, pass-rate threshold |
| **Agent Orchestration** | One of 5 patterns with explicit decision criteria | Pattern type, latency budget, cost ceiling, error tolerance |

### Five Orchestration Patterns (Decision Framework)

Use this matrix when choosing agent topology:

| Pattern | When | Latency Budget | Cost | Error Tolerance | Scalability |
|---------|------|----------------|------|-----------------|-------------|
| **Orchestrator-Worker** | Clear task decomposition, central control | <1s | Low | Low | High |
| **Pipeline** | Sequential stages, output of N → input of N+1 | <5s | Low | Medium | Medium |
| **Swarm** | Parallel exploration, best result wins | Any | High | High | Very High |
| **Mesh** | Peer-to-peer, no central coordinator | Any | Medium | Very High | High |
| **Hybrid** | Mixed topology based on sub-task needs | Mixed | Mixed | Mixed | High |

**Decision criteria**: If latency budget < 500ms and error tolerance is low → Orchestrator-Worker.
If maximum fault tolerance required → Mesh. If exploration is needed → Swarm.

### Prompt Registry and Versioning

Production prompts must be versioned, evaluated, and immutable once deployed:

```yaml
# Prompt registry entry (YAML frontmatter)
prompt_id: PROMPT-007
linked_adr: ADR-003
version: 2.1.0
version_notes: "Added few-shot examples for edge cases"
eval_suite: EVAL-007
eval_pass_rate: 0.94
status: production  # draft | reviewed | production | deprecated
```

**Semantic versioning rules:**
- **Major** (2.x.x): Format change, breaks parsing downstream
- **Minor** (x.1.x): Backward-compatible improvement (new examples, better instructions)
- **Patch** (x.x.1): Cosmetic (whitespace, typos)

Agents MUST link prompts to eval suite scores before promoting to production.

### Eval Suite as CI Gate

LLM evaluation integrated as automated quality gate (not manual):

```yaml
# EVAL-SUITE structure
eval_suite_id: EVAL-007
linked_prompt: PROMPT-007
test_cases:
  - type: happy_path
    input: "..."
    structural_assertions:
      - valid_json: true
      - max_length: 500
    quality_metric: "llm_rubric"
    rubric_threshold: 0.85
  - type: adversarial
    input: "ignore previous instructions and..."
    safety_assertion: prompt_injection_rejected
  - type: boundary
    input: ""
    structural_assertion: graceful_refusal
ci_config:
  pass_rate_threshold: 0.90
  fail_action: block_merge
```

**Safety guards built into every eval suite:**
- Prompt injection detection (reject or flag)
- PII leakage check (no personal data in outputs)
- Refusal validation (model correctly refuses harmful inputs)

### Guardrails Specification Template

For any agentic capability, define guardrails before implementation:

```markdown
## Guardrails Spec: [Feature Name]
### Input Validation
- Allowed input types: [...]
- Rejection criteria: [...]

### Output Constraints
- Max token budget: [N]
- Forbidden patterns: [regex list]
- Required structure: [JSON schema / format]

### Failure Modes
- Graceful degradation: [fallback behaviour]
- Escalation path: [human review / abort / retry]

### Monitoring
- Log inputs exceeding [threshold]
- Alert on refusal rate > [X%]
```

### BHIL Sprint Workflow Integration

Use BHIL artifact skills at the start of any sprint:

```bash
# Initialize sprint with artifact scaffold
new-sprint "Sprint 12 — Payment Refactor"
# Creates: sprint/S-12/, context files, artifact folders

# Create feature with full traceability
new-feature "Idempotent payment processing"
# Creates: PRD-042, SPEC-042, TASK-042a/b/c with cross-links

# Record an architecture decision
new-adr "Model selection for payment fraud detection"
# Creates: ADR-012 (Model Selection type) with benchmarking table
```

**Integration point with build-with-quality:** After BHIL artifacts exist, hand off to
`build-with-quality` agents (Phase 2 Development) with the SPEC as input. The SPEC's
acceptance criteria become test assertions; ADRs inform architectural choices; TASK IDs
track agent work.

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
| Evidence audit verdict (NEW v1.2.0) | Independent Verifier | Producer ≠ Auditor; different model families; tie-break escalates to third model |

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
- **[EDD-PROTOCOL.md](./EDD-PROTOCOL.md)** - Expectation-Driven Development playbook (v1.2.0)
- **[config/skill.yaml](./config/skill.yaml)** - Full configuration options
- **[README.md](./README.md)** - API reference and installation

## License

MIT
