# Build with Quality Skill (v1.2.0)

**[Claude Flow V3](https://github.com/ruvnet/claude-flow/tree/main/v3) + [Agentic QE](https://github.com/proffesor-for-testing/agentic-qe) Combined Skill — now with Expectation-Driven Development**

A powerful skill that combines the development capabilities of [Claude Flow V3](https://github.com/ruvnet/claude-flow/tree/main/v3) with the quality engineering excellence of [Agentic QE](https://github.com/proffesor-for-testing/agentic-qe), enabling optimal project building with integrated quality assurance.

**v1.2.0 introduces Expectation-Driven Development (EDD)** — a design-time conversation layer that wraps DDD/ADR/TDD. Authors plain-text expectations before the coder runs; agents must produce executed evidence (not narration) that each expectation is fulfilled; an auditor agent on a different model family independently verifies; regression-critical expectations are stabilized as automated tests before merge. See [EDD-PROTOCOL.md](./EDD-PROTOCOL.md).

## Quick Links

| Document | Purpose |
|----------|---------|
| **[BUILD-WITH-QUALITY-PROMPT.md](./BUILD-WITH-QUALITY-PROMPT.md)** | Copy-paste activation prompt |
| **[USAGE-EXAMPLES.md](./USAGE-EXAMPLES.md)** | 5 complete project examples |
| **[EDD-PROTOCOL.md](./EDD-PROTOCOL.md)** | Expectation-Driven Development playbook (v1.2.0) |
| **[SKILL.md](./SKILL.md)** | Skill specification |
| **[config/skill.yaml](./config/skill.yaml)** | Full configuration |

## Features

### 114+ Specialized Agents

| Source | Count | Examples |
|--------|-------|----------|
| [Claude Flow V3](https://github.com/ruvnet/claude-flow/tree/main/v3) | 62+ | architect, coder, reviewer, security-architect, deployer, expectation-author, tdd-stabilizer |
| [Agentic QE](https://github.com/proffesor-for-testing/agentic-qe) | 53 | test-strategist, coverage-analyzer, defect-predictor, chaos-engineer, evidence-producer, evidence-auditor |
| Shared | 3 | unified-coordinator, event-bridge, unified-memory-coordinator |

### Unified Learning System

- **SONA (Self-Optimizing Neural Architecture)**: 5 modes (real-time, balanced, research, edge, batch)
- **ReasoningBank**: Pattern storage with confidence tiers (Bronze → Platinum)
- **HNSW Indexing**: O(log n) vector search - 150x faster than linear
- **Dream Cycles**: Background pattern consolidation
- **Q-Learning**: Coverage optimization with 12-dimensional state space

### Intelligent Model Routing (TinyDancer)

- **3-tier routing**: Haiku (0-20), Sonnet (20-70), Opus (70-100) complexity
- **Flash Attention**: 2.49x-7.47x speedup
- **75% token reduction** through intelligent routing
- **Multi-model voting** for low-confidence decisions

### Comprehensive Quality Gates

- **Coverage**: 85% minimum, 95% critical paths
- **Security**: SAST/DAST, compliance auditing
- **Accessibility**: WCAG AA/AAA compliance
- **Chaos Testing**: Network, resource, degradation validation
- **Contract Validation**: API schema and backward compatibility
- **Defect Prediction**: ML-powered with F1 > 0.8
- **Evidence Coverage** (NEW v1.2.0): every feature has an EXP-NNN, every EXP has executed evidence with receipts, auditor distinct from producer on a different model family, regression-critical EXPs have stabilized_by tests, zero stale evidence (>30d or post-SHA-drift)

### Development Methodologies

#### Expectation-Driven Development (EDD) — NEW v1.2.0
- **7-step loop**: formulate → implement → produce evidence → audit → human-challenge → iterate → stabilize
- **Executed evidence required**: command + raw output + timestamp + git SHA. Narrative evidence ("I tested it and it works") auto-rejected.
- **Anti-fox separation**: `evidence-producer` and `evidence-auditor` MUST be different agents on different model families. Auditor's mandate is to find a counter-example.
- **Three evidence categories**: executable / partially-verifiable / not-executable
- **Stabilization mandatory** for regression-critical expectations: every shipped EXP-NNN hands off to a TDD/BDD test via `stabilized_by` field
- **EXP-NNN artifacts** in `.claude/expectations/`, evidence in `.claude/evidence/`, linked into BHIL traceability chain (PRD → SPEC → ADR → **EXP** → TASK → CODE → TEST)

See [EDD-PROTOCOL.md](./EDD-PROTOCOL.md) for the full playbook.

#### Domain-Driven Design (DDD)
- **Strategic Design**: Bounded contexts, context mapping, ubiquitous language
- **Tactical Patterns**: Aggregates, entities, value objects, domain events, repositories
- **Guidelines**: Small aggregates, reference by ID, domain events for cross-aggregate communication

#### Architecture Decision Records (ADR)
- **Templates**: Standardized ADR format with context, decision, consequences
- **Categories**: Architecture, technology, patterns, operations decisions
- **Tracking**: Status management (proposed → accepted → deprecated → superseded)

#### Test-Driven Development (TDD)
- **Red-Green-Refactor**: Strict cycle enforcement with TDD-specific agents
- **Test Patterns**: Unit, integration, and contract test templates
- **Best Practices**: Arrange-Act-Assert, descriptive naming, behavior-focused tests

## Installation

```bash
npm install @claude-flow/build-with-quality-skill
```

## Quick Start (Copy-Paste Prompt)

The fastest way to use this skill is to copy the activation prompt:

```markdown
Build with Quality skill (v1.1.0).

Project: [NAME] | Stack: [TECH] | Task: [DESCRIPTION]

Methodology: DDD + ADR + TDD
Quality: 85% coverage, security scan, WCAG AA

Execute and deliver tested code.
```

See [BUILD-WITH-QUALITY-PROMPT.md](./BUILD-WITH-QUALITY-PROMPT.md) for the full prompt with all options.

## Quick Start (Programmatic)

```typescript
import { buildWithQuality } from '@claude-flow/build-with-quality-skill';

// Execute a build with quality workflow
const result = await buildWithQuality(
  '/path/to/project',
  'Build a REST API with user authentication'
);

console.log(result.success);
console.log(result.metrics.coverageAchieved);
console.log(result.qualityReport.overallScore);
```

## Advanced Usage

```typescript
import { BuildWithQualitySkill, createBuildWithQualitySkill } from '@claude-flow/build-with-quality-skill';

// Create skill with custom configuration
const skill = createBuildWithQualitySkill({
  topology: 'hierarchical-mesh',
  maxAgents: 50,
  learning: {
    sonaMode: 'research',
    reasoningBankEnabled: true,
    dreamCyclesEnabled: true,
  },
  qualityGates: {
    coverageMinimum: 90,
    accessibilityLevel: 'AAA',
    chaosValidation: true,
  },
});

// Initialize
await skill.initialize();

// Execute workflow
const result = await skill.execute({
  sessionId: 'my-session',
  projectPath: '/path/to/project',
  requirements: 'Build a scalable microservice',
  config: skill.getConfig(),
});

// Access components
const coordinator = skill.getCoordinator();
const memory = skill.getMemory();
const router = skill.getModelRouter();

// Get statistics
const stats = skill.getStats();
console.log(stats.routing.tokensSaved);

// Cleanup
await skill.shutdown();
```

## Workflow Phases

```
┌─────────────────────────────────────────────────────────────┐
│         BUILD WITH QUALITY WORKFLOW (v1.2.0 + EDD)          │
└─────────────────────────────────────────────────────────────┘

Phase 1: REQUIREMENTS & PLANNING
├── Architect agent analyzes requirements
├── Requirements-validation domain verifies specs
├── Code-intelligence builds knowledge graph
└── SONA retrieves similar project patterns

Phase 1.5: EXPECTATION AUTHORING (NEW v1.2.0 — EDD step 1)
├── expectation-author + human draft EXP-NNN
├── Each EXP: behaviour + edge cases + counter-examples
└── GATE: human signs off as `accepted` before coder runs

Phase 2: DEVELOPMENT (Parallel)
├── Coder writes implementation against EXP + SPEC + ADR
├── Test-generation creates tests IN PARALLEL
├── Security-architect reviews for vulnerabilities
└── Coverage-analysis identifies gaps

Phase 2.5: EVIDENCE PRODUCTION & AUDIT (NEW v1.2.0 — EDD steps 3-4)
├── evidence-producer (model A) executes scenarios with tool use
├── evidence-auditor (model family ≠ A) verifies + adversarial probe
├── Human adversarial review (EDD step 5)
└── Loop back to Phase 2 if gaps (EDD step 6)

Phase 3: QUALITY GATES (now 6 gates)
├── Quality-assessment evaluates readiness
├── Defect-intelligence predicts bugs
├── Visual-accessibility checks WCAG compliance
├── Chaos-resilience validates fault tolerance
└── Evidence Coverage gate (NEW v1.2.0)

Phase 3.5: STABILIZATION (NEW v1.2.0 — EDD step 7)
└── tdd-stabilizer converts regression_critical EXPs to automated tests

Phase 4: DEPLOYMENT
├── Deployment agent manages CI/CD
├── Contract-testing validates API compatibility
└── Performance agent benchmarks

Phase 5: LEARNING
├── ReasoningBank stores test patterns AND high-quality expectations
├── SONA optimizes future builds
├── Cross-project transfer enables reuse (incl. expectation libraries)
└── Archive: EXP + evidence + test reference becomes living docs
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    BUILD WITH QUALITY SKILL                  │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │              QUEEN COORDINATOR                       │   │
│  │         (Byzantine Fault-Tolerant Consensus)         │   │
│  └───────────────────────────┬─────────────────────────┘   │
│                              │                              │
│     ┌────────────────────────┼────────────────────────┐    │
│     │                        │                        │    │
│     ▼                        ▼                        ▼    │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐ │
│  │ CLAUDE FLOW │      │   UNIFIED   │      │ AGENTIC QE  │ │
│  │  V3 SWARM   │◄────►│   MEMORY    │◄────►│   SWARM     │ │
│  │ (60+ agents)│      │ SONA+HNSW   │      │ (51 agents) │ │
│  └─────────────┘      └─────────────┘      └─────────────┘ │
│         │                    │                    │        │
│         └────────────────────┼────────────────────┘        │
│                              │                              │
│  ┌───────────────────────────┴───────────────────────────┐ │
│  │                    EVENT BUS                           │ │
│  │        (Cross-Domain Bridge + Correlation)             │ │
│  └───────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Performance Targets

| Metric | Target | Achieved |
|--------|--------|----------|
| Vector Search | <3ms | ✓ (150x faster) |
| Flash Attention | 2.49x speedup | ✓ |
| Coordination Latency | <100ms | ✓ |
| Token Reduction | 75% | ✓ |
| Defect Prediction F1 | >0.8 | ✓ |

## Configuration

See [config/skill.yaml](./config/skill.yaml) for full configuration options.

## API Reference

### Core Types

- `SkillContext` - Input context for workflow execution
- `SkillResult` - Output result from workflow execution
- `SwarmConfig` - Swarm configuration options
- `QualityGateConfig` - Quality gate thresholds

### Main Classes

- `BuildWithQualitySkill` - Main skill class
- `QueenCoordinator` - Swarm coordination
- `UnifiedMemory` - SONA + ReasoningBank memory
- `TinyDancerRouter` - Intelligent model routing
- `QualityGate` - Quality validation
- `BuildWithQualityOrchestrator` - Workflow execution

### Factory Functions

- `createBuildWithQualitySkill(config?)` - Create skill instance
- `initializeBuildWithQualitySkill(config?)` - Create and initialize
- `buildWithQuality(path, requirements, config?)` - Quick execution

### Methodology Helpers

- `DDD_GUIDE` - Strategic and tactical DDD guidance
- `ADR_TEMPLATE` - Standard ADR markdown template
- `ADR_CATEGORIES` - Common ADR decision categories
- `TDD_GUIDE` - Red-Green-Refactor cycle guidance
- `TDD_PATTERNS` - Test structure templates
- `METHODOLOGY_WORKFLOW` - Integrated DDD+ADR+TDD workflow
- `createADR(number, title, context, decision, consequences)` - Create ADR
- `createTDDSession(feature, testFile, implFile)` - Start TDD session
- `EDD_GUIDE` - **NEW v1.2.0** - EDD methodology overview, loop, evidence categories, anti-fox rules
- `EDD_LOOP` - **NEW v1.2.0** - Seven-step loop with actor and description per step
- `EXPECTATION_TEMPLATE` - **NEW v1.2.0** - Markdown template for EXP-NNN files
- `EVIDENCE_TEMPLATE` - **NEW v1.2.0** - Markdown template for EXP-NNN.evidence.md files
- `createExpectation(number, expectation, options?)` - **NEW v1.2.0** - Construct an Expectation object with sensible defaults
- `assertAntiFoxSeparation(producerAgent, auditorAgent, producerFamily, auditorFamily)` - **NEW v1.2.0** - Throws if producer and auditor share identity or model family
- `canShipExpectation(exp)` - **NEW v1.2.0** - Returns true only when an expectation has passed its required steps (regression_critical requires `stable` status with `stabilized_by` set)
- `checkEvidenceCoverage(expectations, evidence)` - **NEW v1.2.0** - Run the Evidence Coverage gate, returns pass/fail with detailed failure list

## Using Methodologies

### DDD Example

```typescript
import { DDD_GUIDE, analyzeDomainForDDD } from '@claude-flow/build-with-quality-skill';

// Get DDD guidance
console.log(DDD_GUIDE.strategicDesign.steps);
console.log(DDD_GUIDE.tacticalDesign.patterns);

// Analyze domain
const analysis = analyzeDomainForDDD('Build an e-commerce platform');
```

### ADR Example

```typescript
import { createADR, ADR_TEMPLATE } from '@claude-flow/build-with-quality-skill';

const adr = createADR(
  1,
  'Use PostgreSQL for persistence',
  'We need a reliable database for order management',
  'Use PostgreSQL with TypeORM',
  {
    positive: ['ACID compliance', 'Rich querying'],
    negative: ['Operational complexity'],
    risks: ['Schema migrations need care'],
  }
);
```

### TDD Example

```typescript
import { TDD_GUIDE, createTDDSession } from '@claude-flow/build-with-quality-skill';

// Start TDD session
const session = createTDDSession(
  'User authentication',
  'tests/auth.test.ts',
  'src/auth.ts'
);

// Follow the cycle
console.log(TDD_GUIDE.redPhase.steps);   // Write failing test
console.log(TDD_GUIDE.greenPhase.steps); // Make it pass
console.log(TDD_GUIDE.refactorPhase.steps); // Clean up
```

## Integrated Workflow (DDD + ADR + TDD)

```
Phase 1: Discovery & Strategic Design
├── DDD: Identify bounded contexts
├── DDD: Define ubiquitous language
├── ADR: Document architecture decisions
└── ADR: Document context boundaries

Phase 2: Technical Design
├── DDD: Design aggregates per context
├── DDD: Define entities and value objects
├── ADR: Document database strategy
└── ADR: Document technology stack

Phase 3: Implementation (Per Feature)
├── TDD RED: Write failing test
├── TDD GREEN: Minimal implementation
├── TDD REFACTOR: Clean up code
├── DDD: Implement aggregate behaviors
└── ADR: Document significant decisions

Phase 4: Integration
├── DDD: Implement anti-corruption layers
├── DDD: Implement domain event handlers
└── TDD: Write integration tests
```

## Execution Modes

The skill supports two execution modes:

### Option A: MCP Tools (Preferred)
```javascript
mcp__claude-flow__swarm_init { topology: "hierarchical-mesh", maxAgents: 100 }
mcp__claude-flow__agent_spawn { type: "architect" }
mcp__claude-flow__agent_spawn { type: "coder" }
mcp__claude-flow__task_orchestrate { task: "[PROJECT]", strategy: "parallel" }
```

### Option B: CLI Commands (Fallback)
```bash
npx claude-flow@alpha swarm init --topology hierarchical-mesh
npx claude-flow@alpha agent spawn --type architect
npx claude-flow@alpha agent spawn --type coder
npx claude-flow@alpha task orchestrate --task "[PROJECT]"
```

## Consensus Mechanisms

| Decision Type | Algorithm | Threshold |
|--------------|-----------|-----------|
| Code review | Weighted Voting | >0.7 |
| Quality gates | Byzantine FT | 2/3 majority |
| Pattern storage | CRDT | Conflict-free |
| Architecture | Raft | Leader-based |

## Version History

- **v1.2.0** (2026-05-03): Expectation-Driven Development (EDD) loop; new agents (`expectation-author`, `evidence-producer`, `evidence-auditor`, `tdd-stabilizer`); Evidence Coverage quality gate (sixth gate); anti-fox separation enforcement; EXP-NNN artifact type linked into BHIL chain; `EDD_GUIDE`, `EXPECTATION_TEMPLATE`, `EVIDENCE_TEMPLATE`, `createExpectation`, `assertAntiFoxSeparation`, `checkEvidenceCoverage`, `canShipExpectation` helpers; EDD-PROTOCOL.md playbook
- **v1.1.0** (2026-02-01): Added copy-paste prompt, usage examples, dual execution modes, consensus mechanisms, degraded mode docs
- **v1.0.0** (2026-01-30): Initial release

## License

MIT
