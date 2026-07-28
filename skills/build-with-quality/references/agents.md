# Agents Catalog

The full agent roster and per-domain breakdown for build-with-quality. Spawn these
via `mcp__claude-flow__agent_spawn { type: "..." }`, the Claude Code `Task` tool
(`subagent_type`), or `npx claude-flow@alpha agent spawn --type ...`.

## 114+ Specialized Agents

| Source | Count | Examples |
|--------|-------|----------|
| Claude Flow V3 | 62+ | architect, coder, reviewer, security-architect, deployer, expectation-author, tdd-stabilizer |
| Agentic QE | 53 | test-strategist, coverage-analyzer, defect-predictor, chaos-engineer, evidence-producer, evidence-auditor |
| Shared | 3 | unified-coordinator, event-bridge, unified-memory-coordinator |

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
