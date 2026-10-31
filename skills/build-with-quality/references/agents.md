# Agents Catalog

The role roster for build-with-quality. These 34 names are **ruflo / agentic-qe
role labels**. Record them with `mcp__claude-flow__agent_spawn { agentType: "..." }` or
`claude-flow agent spawn --type ...` so observers see the topology. They are **not**
Claude Code `subagent_type`s. Since ADR-2092 the harness registers a curated set
(`agents/registered-agents.txt`), and a spawn with an unregistered name fails. The
work itself runs through the map below.

## Who runs each role in Claude Code

| Role labels | `subagent_type` | Model (ADR-2134) |
|---|---|---|
| architect, security-architect, test-strategist | `system-architect` | Opus |
| coder, deployer, security-implementer, tdd-green-phase, tdd-refactor-phase | the lead session, or `rust-engineer` for Rust | Sonnet |
| unit/integration/e2e-test-generator, tdd-red-phase, tdd-stabilizer, flaky-test-hunter, mutation-tester, coverage-analyzer | `test-engineer` | Sonnet |
| reviewer | `code-reviewer` (Rust: with [rust/review.md](./rust/review.md)) | Opus |
| security-tester, sast-scanner, compliance-auditor | `security-reviewer`, plus `scripts/deepsec-gate.sh` | Opus |
| chaos-engineer, resilience-validator, defect-predictor | `performance-engineer` or `test-engineer`, by what is measured | Sonnet |
| memory-indexer, trajectory-tracker, reasoning-bank-manager, cross-project-transfer | `memory-curator` | Sonnet |
| browser-agent, dast-scanner | the `browser` skill (browser-gpu MCP) | — |
| expectation-author | the lead session, with the human | — |
| evidence-producer | the lead session or `test-engineer` | Sonnet |
| evidence-auditor | **Codex** (`codex exec -m gpt-6-astra`), never a Claude tier | cross-vendor |
| search fan-out (no role label) | `Explore` | Haiku |
| sona-optimizer, q-learning-optimizer | none: SONA is off; learning is RuVector's trajectory→pattern loop | — |

## 34 role labels

Recounted directly from the "Agent Domains" catalogue below (2026-09-09).

| Domain | Count | Examples |
|--------|-------|----------|
| Development (Claude Code V3) | 7 | architect, coder, reviewer, deployer, expectation-author, tdd-stabilizer |
| Quality (Agentic QE) | 12 | test-strategist, coverage-analyzer, defect-predictor, chaos-engineer, evidence-producer, evidence-auditor |
| Security (mixed) | 6 | security-architect, sast-scanner, dast-scanner, compliance-auditor |
| Learning (shared) | 6 | sona-optimizer, memory-indexer, reasoning-bank-manager |
| TDD subagents | 3 | tdd-red-phase, tdd-green-phase, tdd-refactor-phase |

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
