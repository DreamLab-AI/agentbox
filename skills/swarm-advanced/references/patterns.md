# Swarm Advanced — Detailed Pattern Examples

Reference material extracted from SKILL.md. Each section shows full agent configuration and workflow phases for a topology type.

---

## Pattern 1: Research Swarm (Mesh Topology)

### Agent Configuration
```javascript
mcp__claude-flow__swarm_init({
  "topology": "mesh",
  "maxAgents": 6,
  "strategy": "adaptive"
})

const researchAgents = [
  { type: "researcher", name: "Web Researcher",      capabilities: ["web-search", "content-extraction", "source-validation"] },
  { type: "researcher", name: "Academic Researcher", capabilities: ["paper-analysis", "citation-tracking", "literature-review"] },
  { type: "analyst",    name: "Data Analyst",        capabilities: ["data-processing", "statistical-analysis", "visualization"] },
  { type: "analyst",    name: "Pattern Analyzer",    capabilities: ["trend-detection", "correlation-analysis", "outlier-detection"] },
  { type: "documenter", name: "Report Writer",       capabilities: ["synthesis", "technical-writing", "formatting"] }
]

researchAgents.forEach(agent => {
  mcp__claude-flow__agent_spawn({ type: agent.type, name: agent.name, capabilities: agent.capabilities })
})
```

### Phase 1: Information Gathering
```javascript
mcp__claude-flow__parallel_execute({
  "tasks": [
    { "id": "web-search",      "command": "search recent publications and articles" },
    { "id": "academic-search", "command": "search academic databases and papers" },
    { "id": "data-collection", "command": "gather relevant datasets and statistics" },
    { "id": "expert-search",   "command": "identify domain experts and thought leaders" }
  ]
})

mcp__claude-flow__memory_usage({
  "action": "store",
  "key": "research-findings-" + Date.now(),
  "value": JSON.stringify(findings),
  "namespace": "research",
  "ttl": 604800
})
```

### Phase 2: Analysis and Validation
```javascript
// NOTE: mcp__claude-flow__pattern_recognize is not currently available — use claude-flow CLI instead
// npx claude-flow analyze --pattern trend,correlation,outlier

// NOTE: mcp__claude-flow__cognitive_analyze is not currently available — use claude-flow CLI instead
// NOTE: mcp__claude-flow__quality_assess is not currently available — use claude-flow CLI instead

mcp__claude-flow__neural_patterns({
  "action": "analyze",
  "operation": "fact-checking",
  "metadata": { "sources": sourcesArray }
})
```

### Phase 3: Knowledge Management
```javascript
mcp__claude-flow__memory_search({ "pattern": "topic X", "namespace": "research", "limit": 20 })

mcp__claude-flow__neural_patterns({
  "action": "learn",
  "operation": "knowledge-graph",
  "metadata": { "topic": "X", "connections": relatedTopics, "depth": 3 }
})

mcp__claude-flow__memory_usage({
  "action": "store",
  "key": "knowledge-graph-X",
  "value": JSON.stringify(knowledgeGraph),
  "namespace": "research/graphs",
  "ttl": 2592000
})
```

### Phase 4: Report Generation
```javascript
mcp__claude-flow__task_orchestrate({
  "task": "generate comprehensive research report",
  "strategy": "sequential",
  "priority": "high",
  "dependencies": ["gather", "analyze", "validate", "synthesize"]
})

mcp__claude-flow__swarm_status({ "swarmId": "research-swarm" })

mcp__claude-flow__workflow_execute({
  "workflowId": "research-report-generation",
  "params": {
    "findings": findings,
    "format": "comprehensive",
    "sections": ["executive-summary", "methodology", "findings", "analysis", "conclusions", "references"]
  }
})
```

### CLI Fallback
```bash
npx claude-flow swarm "research AI trends in 2025" \
  --strategy research --mode distributed --max-agents 6 --parallel --output research-report.md
```

---

## Pattern 2: Development Swarm (Hierarchical Topology)

### Agent Configuration
```javascript
mcp__claude-flow__swarm_init({ "topology": "hierarchical", "maxAgents": 8, "strategy": "balanced" })

const devTeam = [
  { type: "architect",  name: "System Architect",    role: "coordinator" },
  { type: "coder",      name: "Backend Developer",   capabilities: ["node", "api", "database"] },
  { type: "coder",      name: "Frontend Developer",  capabilities: ["react", "ui", "ux"] },
  { type: "coder",      name: "Database Engineer",   capabilities: ["sql", "nosql", "optimization"] },
  { type: "tester",     name: "QA Engineer",         capabilities: ["unit", "integration", "e2e"] },
  { type: "reviewer",   name: "Code Reviewer",       capabilities: ["security", "performance", "best-practices"] },
  { type: "documenter", name: "Technical Writer",    capabilities: ["api-docs", "guides", "tutorials"] },
  { type: "monitor",    name: "DevOps Engineer",     capabilities: ["ci-cd", "deployment", "monitoring"] }
]

devTeam.forEach(member => {
  mcp__claude-flow__agent_spawn({ type: member.type, name: member.name, capabilities: member.capabilities, swarmId: "dev-swarm" })
})
```

### Phase 1: Architecture and Design
```javascript
mcp__claude-flow__task_orchestrate({
  "task": "design system architecture for REST API",
  "strategy": "sequential",
  "priority": "critical",
  "assignTo": "System Architect"
})

mcp__claude-flow__memory_usage({
  "action": "store",
  "key": "architecture-decisions",
  "value": JSON.stringify(architectureDoc),
  "namespace": "development/design"
})
```

### Phase 2: Parallel Implementation
```javascript
mcp__claude-flow__parallel_execute({
  "tasks": [
    { "id": "backend-api",       "command": "implement REST API endpoints",          "assignTo": "Backend Developer" },
    { "id": "frontend-ui",       "command": "build user interface components",        "assignTo": "Frontend Developer" },
    { "id": "database-schema",   "command": "design and implement database schema",   "assignTo": "Database Engineer" },
    { "id": "api-documentation", "command": "create API documentation",               "assignTo": "Technical Writer" }
  ]
})

// NOTE: mcp__claude-flow__swarm_monitor is not currently available — use swarm_status instead
mcp__claude-flow__swarm_status({ "swarmId": "dev-swarm" })
```

### Phase 3: Testing and Validation
```javascript
// NOTE: mcp__claude-flow__batch_process is not currently available — use parallel_execute instead
mcp__claude-flow__parallel_execute({
  "tasks": [
    { "id": "unit-tests",        "command": "run unit tests" },
    { "id": "integration-tests", "command": "run integration tests" },
    { "id": "e2e-tests",         "command": "run end-to-end tests" },
    { "id": "perf-tests",        "command": "run performance tests" }
  ]
})

// NOTE: mcp__claude-flow__quality_assess is not currently available — use claude-flow CLI instead
// npx claude-flow quality assess --criteria coverage,complexity,maintainability,security
```

### Phase 4: Review and Deployment
```javascript
mcp__claude-flow__workflow_execute({
  "workflowId": "code-review-process",
  "params": { "reviewers": ["Code Reviewer"], "criteria": ["security", "performance", "best-practices"] }
})

// NOTE: mcp__claude-flow__pipeline_create is not currently available — use github-workflow-automation skill instead
```

### CLI Fallback
```bash
npx claude-flow swarm "build REST API with authentication" \
  --strategy development --mode hierarchical --monitor --output sqlite
```

---

## Pattern 3: Testing Swarm (Star Topology)

### Agent Configuration
```javascript
mcp__claude-flow__swarm_init({ "topology": "star", "maxAgents": 7, "strategy": "parallel" })

const testingTeam = [
  { type: "tester",    name: "Unit Test Coordinator", capabilities: ["unit-testing", "mocking", "coverage", "tdd"] },
  { type: "tester",    name: "Integration Tester",    capabilities: ["integration", "api-testing", "contract-testing"] },
  { type: "tester",    name: "E2E Tester",            capabilities: ["e2e", "ui-testing", "user-flows", "selenium"] },
  { type: "tester",    name: "Performance Tester",    capabilities: ["load-testing", "stress-testing", "benchmarking"] },
  { type: "monitor",   name: "Security Tester",       capabilities: ["security-testing", "penetration-testing", "vulnerability-scanning"] },
  { type: "analyst",   name: "Test Analyst",          capabilities: ["coverage-analysis", "test-optimization", "reporting"] },
  { type: "documenter",name: "Test Documenter",       capabilities: ["test-documentation", "test-plans", "reports"] }
]

testingTeam.forEach(tester => {
  mcp__claude-flow__agent_spawn({ type: tester.type, name: tester.name, capabilities: tester.capabilities, swarmId: "testing-swarm" })
})
```

### Phase 1: Test Planning
```javascript
// NOTE: mcp__claude-flow__quality_assess is not currently available — use claude-flow CLI instead
// npx claude-flow quality assess --criteria line-coverage,branch-coverage,function-coverage

// NOTE: mcp__claude-flow__pattern_recognize is not currently available — use claude-flow CLI instead

mcp__claude-flow__memory_usage({
  "action": "store",
  "key": "test-plan-" + Date.now(),
  "value": JSON.stringify(testPlan),
  "namespace": "testing/plans"
})
```

### Phase 2: Parallel Test Execution
```javascript
mcp__claude-flow__parallel_execute({
  "tasks": [
    { "id": "unit-tests",        "command": "npm run test:unit",        "assignTo": "Unit Test Coordinator" },
    { "id": "integration-tests", "command": "npm run test:integration", "assignTo": "Integration Tester" },
    { "id": "e2e-tests",         "command": "npm run test:e2e",         "assignTo": "E2E Tester" },
    { "id": "performance-tests", "command": "npm run test:performance", "assignTo": "Performance Tester" },
    { "id": "security-tests",    "command": "npm run test:security",    "assignTo": "Security Tester" }
  ]
})
```

### Phase 3: Performance and Security
```javascript
mcp__claude-flow__bottleneck_analyze({
  "component": "application",
  "metrics": ["response-time", "throughput", "memory", "cpu"]
})

mcp__claude-flow__performance_report({ "format": "detailed", "timeframe": "current-run" })

// NOTE: mcp__claude-flow__security_scan is not currently available — use claude-flow CLI instead
// npx claude-flow security scan --target application --depth comprehensive

// NOTE: mcp__claude-flow__error_analysis is not currently available — use claude-flow CLI instead
// NOTE: mcp__claude-flow__trend_analysis is not currently available — use claude-flow CLI instead
// NOTE: mcp__claude-flow__task_results is not currently available — use swarm_status instead
mcp__claude-flow__swarm_status({ "swarmId": "testing-swarm" })
```

### CLI Fallback
```bash
npx claude-flow swarm "test application comprehensively" \
  --strategy testing --mode star --parallel --timeout 600
```

---

## Pattern 4: Analysis Swarm (Mesh Topology)

### Agent Configuration
```javascript
mcp__claude-flow__swarm_init({ "topology": "mesh", "maxAgents": 5, "strategy": "adaptive" })

const analysisTeam = [
  { type: "analyst",    name: "Code Analyzer",        capabilities: ["static-analysis", "complexity-analysis", "dead-code-detection"] },
  { type: "analyst",    name: "Security Analyzer",    capabilities: ["security-scan", "vulnerability-detection", "dependency-audit"] },
  { type: "analyst",    name: "Performance Analyzer", capabilities: ["profiling", "bottleneck-detection", "optimization"] },
  { type: "analyst",    name: "Architecture Analyzer",capabilities: ["dependency-analysis", "coupling-detection", "modularity-assessment"] },
  { type: "documenter", name: "Analysis Reporter",    capabilities: ["reporting", "visualization", "recommendations"] }
]

analysisTeam.forEach(analyst => {
  mcp__claude-flow__agent_spawn({ type: analyst.type, name: analyst.name, capabilities: analyst.capabilities })
})
```

### Workflow
```javascript
mcp__claude-flow__parallel_execute({
  "tasks": [
    { "id": "analyze-code",         "command": "analyze codebase structure and quality" },
    { "id": "analyze-security",     "command": "scan for security vulnerabilities" },
    { "id": "analyze-performance",  "command": "identify performance bottlenecks" },
    { "id": "analyze-architecture", "command": "assess architectural patterns" }
  ]
})

mcp__claude-flow__bottleneck_analyze({ "component": "application", "metrics": ["response-time", "memory", "cpu"] })
mcp__claude-flow__performance_report({ "format": "detailed", "timeframe": "current" })

// NOTE: mcp__claude-flow__cost_analysis is not currently available — use claude-flow CLI instead
// npx claude-flow metrics cost --timeframe 30d
```

---

## Advanced Techniques

### Error Handling and Fault Tolerance

```javascript
// NOTE: mcp__claude-flow__daa_fault_tolerance is not currently available — use claude-flow CLI instead
// npx claude-flow agent fault-tolerance --agent all --strategy auto-recovery

try {
  await mcp__claude-flow__task_orchestrate({ "task": "complex operation", "strategy": "parallel", "priority": "high" })
} catch (error) {
  const status = await mcp__claude-flow__swarm_status({})

  // NOTE: mcp__claude-flow__error_analysis is not currently available — use claude-flow CLI instead
  // npx claude-flow analyze error --log "${error.message}"

  if (status.healthy) {
    await mcp__claude-flow__task_orchestrate({ "task": "retry failed operation", "strategy": "sequential" })
  }
}
```

### Memory and State Management

```javascript
// NOTE: mcp__claude-flow__memory_persist is not currently available — use memory_usage with long TTL instead
mcp__claude-flow__memory_usage({ "action": "store", "key": "session-state", "namespace": "swarm-session-001", "value": JSON.stringify(state), "ttl": 2592000 })

// NOTE: mcp__claude-flow__memory_namespace is not currently available — use namespace param in memory_usage instead
// NOTE: mcp__claude-flow__state_snapshot is not currently available — use memory_usage for checkpoints instead
// NOTE: mcp__claude-flow__context_restore is not currently available — use memory_retrieve instead
// NOTE: mcp__claude-flow__memory_backup is not currently available — use claude-flow CLI instead
// npx claude-flow memory export --path /workspaces/backups/swarm-memory.json
```

### Neural Pattern Learning

```javascript
// NOTE: mcp__claude-flow__neural_train is not currently available — use neural_patterns instead
mcp__claude-flow__neural_patterns({ "action": "learn", "operation": "coordination", "metadata": { "source": "successful-workflow" } })

// NOTE: mcp__claude-flow__learning_adapt is not currently available — use neural_patterns instead
mcp__claude-flow__neural_patterns({ "action": "learn", "operation": "workflow-optimization", "metadata": { "workflow": "research-to-report", "success": true } })

// NOTE: mcp__claude-flow__pattern_recognize is not currently available — use claude-flow CLI instead
// npx claude-flow analyze --pattern bottleneck,optimization-opportunity
```

### Workflow Automation

```javascript
mcp__claude-flow__workflow_create({
  "name": "full-stack-development",
  "steps": [
    { "phase": "design",     "agents": ["architect"] },
    { "phase": "implement",  "agents": ["backend-dev", "frontend-dev"], "parallel": true },
    { "phase": "test",       "agents": ["tester", "security-tester"], "parallel": true },
    { "phase": "review",     "agents": ["reviewer"] },
    { "phase": "deploy",     "agents": ["devops"] }
  ],
  "triggers": ["on-commit", "scheduled-daily"]
})

// NOTE: mcp__claude-flow__automation_setup is not currently available — use github-workflow-automation skill instead
// NOTE: mcp__claude-flow__trigger_setup is not currently available — use github-workflow-automation skill instead
```

### Performance Optimisation

```javascript
// NOTE: mcp__claude-flow__topology_optimize is not currently available — use claude-flow CLI instead
// npx claude-flow swarm optimize --swarm-id current-swarm

mcp__claude-flow__load_balance({ "swarmId": "development-swarm", "tasks": taskQueue })
mcp__claude-flow__coordination_sync({ "swarmId": "development-swarm" })

// NOTE: mcp__claude-flow__swarm_scale is not currently available — use claude-flow CLI instead
// npx claude-flow swarm scale --swarm-id development-swarm --size 12
```

### Monitoring and Metrics

```javascript
mcp__claude-flow__swarm_status({ "swarmId": "active-swarm" })

// NOTE: mcp__claude-flow__swarm_monitor is not currently available — use swarm_status on a polling interval instead
// NOTE: mcp__claude-flow__metrics_collect is not currently available — use performance_report instead
mcp__claude-flow__performance_report({ "format": "detailed", "timeframe": "current" })

// NOTE: mcp__claude-flow__health_check is not currently available — use swarm_status instead
// NOTE: mcp__claude-flow__usage_stats is not currently available — use performance_report instead
// NOTE: mcp__claude-flow__trend_analysis is not currently available — use claude-flow CLI instead
// npx claude-flow metrics trend --metric agent-performance --period 7d
```
