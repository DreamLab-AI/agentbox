---
skill: agentic-qe
version: 2.8.2
description: Agentic QE Fleet - AI-powered quality engineering with 20 specialized agents, 46 QE skills, 100 MCP tools, Multi-Model Router (70-81% cost savings), and self-learning test automation
author: Multi-Agent Docker Team
tags: [testing, qa, qe, tdd, test-automation, coverage, security, accessibility, playwright, jest, cypress, goap, ruvector]
mcp_server: true
---

# Agentic QE Fleet Skill v2.8.2

AI-powered quality engineering platform with 20 specialized agents, 46 QE skills, and 100 MCP tools. Features GOAP task orchestration, Multi-Model Router, and RuVector self-learning.

## Quick Start

```bash
# Initialize fleet (creates .agentic-qe/)
aqe init -y

# Spawn test generator agent
aqe agent spawn test-generator -t "Generate tests for auth module"

# Check fleet status
aqe status

# List active agents
aqe agent list

# Start MCP server
aqe-mcp
```

## What's New in v2.8.2

- **100 MCP Tools** with lazy loading (87% context reduction)
- **GOAP Planning** - Goal-oriented action planning for test orchestration
- **Multi-Model Router v1.0.5** - 70-81% cost savings
- **RuVector Integration** - 330x faster pattern search
- **Native TypeScript Hooks** - Direct integration with Claude Code
- **Streaming Progress** - Real-time test execution updates

## Architecture

### Agent Fleet (20 Specialized Agents)

| Agent | Domain | Capabilities |
|-------|--------|--------------|
| `test-generator` | Test Creation | Generate tests with 95%+ coverage |
| `coverage-analyzer` | Coverage | Gap analysis, O(log n) sublinear |
| `security-scanner` | Security | SAST/DAST, OWASP Top 10, CVE |
| `performance-analyzer` | Performance | Load testing, bottleneck detection |
| `accessibility-scanner` | A11y | WCAG 2.2 compliance |
| `api-contract-validator` | API | Contract testing, breaking changes |
| `visual-regression` | Visual | Screenshot comparison |
| `chaos-engineer` | Resilience | Latency/failure injection |
| `flaky-detector` | Stability | ML-powered detection (90%+ accuracy) |
| `quality-gate` | Quality | Metric validation, GOAP evaluation |

### TDD Subagents (11)

RED/GREEN/REFACTOR workflow specialists for London and Chicago School TDD.

### Skills Library (46)

Complete coverage of modern QE practices:
- **Core**: TDD, BDD, exploratory testing, risk-based testing
- **Modern**: Shift-left/right, chaos engineering, accessibility
- **Specialized**: Database, API contract, visual regression
- **Advanced**: Six thinking hats, compliance, CI/CD orchestration

## MCP Tools (100 Total)

### Fleet Management
```
mcp__agentic_qe__fleet_init
mcp__agentic_qe__fleet_status (qe_fleet_coordinate, qe_fleet_agent_status)
mcp__agentic_qe__agent_spawn
mcp__agentic_qe__task_orchestrate
mcp__agentic_qe__task_status
```

### Test Generation & Execution
```
mcp__agentic_qe__test_generate_enhanced
mcp__agentic_qe__test_execute
mcp__agentic_qe__test_execute_parallel
mcp__agentic_qe__test_execute_stream
mcp__agentic_qe__test_execute_filtered
mcp__agentic_qe__test_optimize_sublinear
mcp__agentic_qe__test_report_comprehensive
mcp__agentic_qe__qe_testgen_generate_unit
mcp__agentic_qe__qe_testgen_generate_integration
mcp__agentic_qe__qe_testgen_optimize_suite
mcp__agentic_qe__qe_testgen_analyze_quality
```

### Coverage Analysis
```
mcp__agentic_qe__test_coverage_detailed
mcp__agentic_qe__coverage_analyze_sublinear (O(log n))
mcp__agentic_qe__coverage_gaps_detect
mcp__agentic_qe__coverage_analyze_stream
mcp__agentic_qe__coverage_analyze_with_risk_scoring
mcp__agentic_qe__coverage_detect_gaps_ml
mcp__agentic_qe__coverage_recommend_tests
mcp__agentic_qe__coverage_calculate_trends
```

### Security
```
mcp__agentic_qe__qe_security_scan_comprehensive
mcp__agentic_qe__qe_security_detect_vulnerabilities
mcp__agentic_qe__qe_security_validate_compliance
mcp__agentic_qe__security_generate_report
```

### Performance
```
mcp__agentic_qe__performance_analyze_bottlenecks
mcp__agentic_qe__performance_generate_report
mcp__agentic_qe__performance_run_benchmark
mcp__agentic_qe__performance_monitor_realtime
mcp__agentic_qe__performance_test_filtered
```

### Visual & Accessibility
```
mcp__agentic_qe__visual_compare_screenshots
mcp__agentic_qe__visual_validate_accessibility
mcp__agentic_qe__visual_detect_regression
mcp__agentic_qe__a11y_scan_comprehensive
```

### API & Contract
```
mcp__agentic_qe__qe_api_contract_validate
mcp__agentic_qe__qe_api_contract_breaking_changes
mcp__agentic_qe__qe_api_contract_versioning
mcp__agentic_qe__api_breaking_changes
```

### Flaky Detection
```
mcp__agentic_qe__flaky_detect_statistical
mcp__agentic_qe__flaky_analyze_patterns
mcp__agentic_qe__flaky_stabilize_auto
```

### Quality Gates
```
mcp__agentic_qe__qe_qualitygate_evaluate
mcp__agentic_qe__qe_qualitygate_evaluate_goap
mcp__agentic_qe__qe_qualitygate_assess_risk
mcp__agentic_qe__qe_qualitygate_validate_metrics
mcp__agentic_qe__qe_qualitygate_generate_report
```

### Regression & Requirements
```
mcp__agentic_qe__qe_regression_analyze_risk
mcp__agentic_qe__qe_regression_select_tests
mcp__agentic_qe__qe_requirements_validate
mcp__agentic_qe__qe_requirements_generate_bdd
```

### Code Quality
```
mcp__agentic_qe__qe_code_quality_complexity
mcp__agentic_qe__qe_code_quality_metrics
```

### Test Data
```
mcp__agentic_qe__qe_test_data_generate
mcp__agentic_qe__qe_test_data_mask
mcp__agentic_qe__qe_test_data_analyze_schema
```

### Chaos Engineering
```
mcp__agentic_qe__chaos_inject_latency
mcp__agentic_qe__chaos_inject_failure
mcp__agentic_qe__chaos_resilience_test
```

### Integration Testing
```
mcp__agentic_qe__integration_dependency_check
mcp__agentic_qe__integration_test_orchestrate
```

### Production Monitoring
```
mcp__agentic_qe__production_incident_replay
mcp__agentic_qe__production_rum_analyze
mcp__agentic_qe__deployment_readiness_check
```

### Mutation Testing
```
mcp__agentic_qe__mutation_test_execute
mcp__agentic_qe__predict_defects_ai
```

### Memory & Coordination
```
mcp__agentic_qe__memory_store
mcp__agentic_qe__memory_retrieve
mcp__agentic_qe__memory_query
mcp__agentic_qe__memory_share
mcp__agentic_qe__memory_backup
mcp__agentic_qe__blackboard_post
mcp__agentic_qe__blackboard_read
mcp__agentic_qe__consensus_propose
mcp__agentic_qe__consensus_vote
mcp__agentic_qe__artifact_manifest
```

### Workflows
```
mcp__agentic_qe__workflow_create
mcp__agentic_qe__workflow_execute
mcp__agentic_qe__workflow_checkpoint
mcp__agentic_qe__workflow_resume
```

### Events
```
mcp__agentic_qe__event_emit
mcp__agentic_qe__event_subscribe
```

### Learning & RuVector
```
mcp__agentic_qe__learning_store_experience
mcp__agentic_qe__learning_store_qvalue
mcp__agentic_qe__learning_store_pattern
mcp__agentic_qe__learning_query
mcp__agentic_qe__ruvector_health
mcp__agentic_qe__ruvector_metrics
mcp__agentic_qe__ruvector_force_learn
mcp__agentic_qe__ruvector_store_pattern
mcp__agentic_qe__ruvector_search (330x faster)
mcp__agentic_qe__ruvector_cost_savings
```

## CLI Commands

### Fleet Management
```bash
aqe init [options]              # Initialize fleet
aqe start [-d]                  # Start fleet (daemon mode)
aqe status                      # Fleet status
```

### Agent Operations
```bash
aqe agent spawn <type> [-t task] [-p project] [--priority high]
aqe agent list                  # List all agents
```

### Learning & Patterns
```bash
aqe learn status                # Learning metrics
aqe learn enable --all          # Enable RL learning
aqe patterns list               # View stored patterns
aqe transfer status             # Cross-agent transfer
aqe dream status                # Dream engine patterns
```

### Quality & Routing
```bash
aqe routing status              # Multi-model router stats
aqe ruvector metrics            # Self-learning metrics
aqe constitution evaluate       # Quality constitution check
aqe providers list              # LLM provider health
```

### Workflows & Memory
```bash
aqe workflow list               # List workflows
aqe workflow execute <id>       # Execute workflow
aqe memory status               # Memory state
aqe memory backup               # Backup memory
```

### Advanced
```bash
aqe kg search <query>           # Knowledge graph search
aqe telemetry query             # Query telemetry
aqe quantization status         # Vector quantization stats
aqe debug                       # Debug troubleshooting
```

## Integration with Claude-Flow v3

```bash
# Route QE task via claude-flow hooks
claude-flow hooks route --task "Generate tests for payment module"

# Spawn QE agent in swarm
claude-flow agent spawn --type tester --name qe-agent

# Use GOAP planning for test orchestration
aqe agent spawn quality-gate -t "Evaluate deployment readiness" --priority critical
```

## Framework Support

| Framework | Test Gen | Execution | Coverage | Streaming |
|-----------|----------|-----------|----------|-----------|
| Jest | Yes | Yes | Yes | Yes |
| Mocha | Yes | Yes | Yes | Yes |
| Cypress | Yes | Yes | Yes | Yes |
| Playwright | Yes | Yes | Yes | Yes |
| Vitest | Yes | Yes | Yes | Yes |
| Jasmine | Yes | Yes | Yes | Limited |

## Self-Learning Pipeline

The system learns from test executions:

1. **Q-Learning** - Optimal action-value functions from execution history
2. **Pattern Bank** - 85%+ accuracy across 6 frameworks
3. **Flaky Detection** - 90%+ accuracy with root cause analysis
4. **Experience Replay** - 10,000+ past executions in AgentDB
5. **RuVector** - 330x faster pattern search with GNN + LoRA + EWC++

```bash
# Enable learning
aqe learn enable --all

# Check learning status
aqe learn status

# View patterns
aqe patterns list --min-confidence 0.8

# Force learning cycle
aqe ruvector force-learn
```

## Multi-Model Router (70-81% Cost Savings)

Intelligent routing across models:

| Model | Task Complexity | Cost | Use Case |
|-------|-----------------|------|----------|
| Claude Haiku | Simple | $ | Assertions, basic tests |
| GPT-3.5 | Basic | $ | Unit tests |
| Claude Sonnet | Complex | $$ | Integration tests |
| GPT-4 | Architecture | $$$ | E2E, complex logic |

```bash
# Check router status
aqe routing status

# View cost savings
aqe ruvector cost-savings
```

## Environment Variables

```bash
AQE_COVERAGE_THRESHOLD=95       # Default coverage target
AQE_ENABLE_LEARNING=true        # Enable RL learning
AQE_PARALLEL_WORKERS=10         # Parallel test workers
AQE_MODEL_ROUTER=auto           # Model routing strategy
AQE_RUVECTOR_ENABLED=true       # Enable RuVector (330x faster)
AGENTDB_PATH=./.agentic-qe/memory.db
```

## Memory Namespaces

Agents coordinate through shared memory:
- `aqe/test-plan/*` - Test planning
- `aqe/coverage/*` - Coverage data
- `aqe/quality/*` - Quality metrics
- `aqe/patterns/*` - Learned patterns
- `aqe/blackboard/*` - Agent coordination

## Dependencies

- agentic-qe>=2.8.2
- Node.js>=18.0.0
- Optional: RuVector Docker for 330x faster search
