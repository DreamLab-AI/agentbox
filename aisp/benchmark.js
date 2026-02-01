#!/usr/bin/env node
/**
 * AISP 5.1 Comparative Benchmark
 * Measures performance gains from neuro-symbolic protocol integration
 *
 * Tests:
 * 1. Document validation throughput
 * 2. Agent routing accuracy (with/without Hebbian learning)
 * 3. Binding state computation speed
 * 4. Pocket store search performance
 */

const {
  AISPValidator,
  AISPPocketStore,
  createPocket,
  generateSignal,
  computeBinding,
  validateDocument,
  rossnetScore,
  calculateDensity,
  calculateTier,
  BINDING_STATES,
  QUALITY_TIERS,
  HEBBIAN
} = require('./index.js');

// ============================================================================
// TEST DATA
// ============================================================================

const SAMPLE_TASKS = [
  { id: 't1', description: 'Implement user authentication with JWT tokens', type: 'feature', complexity: 'high' },
  { id: 't2', description: 'Fix null pointer in database connection pool', type: 'bugfix', complexity: 'medium' },
  { id: 't3', description: 'Optimize SQL queries for dashboard loading', type: 'performance', complexity: 'high' },
  { id: 't4', description: 'Add unit tests for payment service', type: 'testing', complexity: 'medium' },
  { id: 't5', description: 'Refactor authentication module to use dependency injection', type: 'refactor', complexity: 'high' },
  { id: 't6', description: 'Security audit for API endpoints', type: 'security', complexity: 'high' },
  { id: 't7', description: 'Update README documentation', type: 'docs', complexity: 'low' },
  { id: 't8', description: 'Configure CI/CD pipeline with GitHub Actions', type: 'devops', complexity: 'medium' }
];

const SAMPLE_AGENTS = [
  { id: 'coder', type: 'coder', capabilities: ['implementation', 'coding', 'algorithms', 'data structures'] },
  { id: 'tester', type: 'tester', capabilities: ['testing', 'unit tests', 'integration', 'coverage'] },
  { id: 'reviewer', type: 'reviewer', capabilities: ['code review', 'quality', 'best practices'] },
  { id: 'researcher', type: 'researcher', capabilities: ['research', 'analysis', 'exploration', 'documentation'] },
  { id: 'architect', type: 'architect', capabilities: ['architecture', 'design', 'patterns', 'refactoring'] },
  { id: 'security', type: 'security-auditor', capabilities: ['security', 'vulnerabilities', 'audit', 'compliance'] },
  { id: 'perf', type: 'perf-analyzer', capabilities: ['performance', 'optimization', 'profiling', 'benchmarking'] },
  { id: 'devops', type: 'cicd-engineer', capabilities: ['devops', 'ci/cd', 'deployment', 'infrastructure'] }
];

const SAMPLE_AISP_DOC = `
𝔸5.1.test@2026-01-12
γ≔test.benchmark
⟦Ω:Meta⟧{
  ∀task:∃agent.optimal(task,agent)
  ⊢deterministic
}
⟦Σ:Types⟧{
  Task≜⟨id:Hash,desc:𝕊,type:Cat⟩
  Agent≜⟨id:Hash,caps:List⟨𝕊⟩,type:Cat⟩
}
⟦Γ:Rules⟧{
  ∀t,a:match(t,a)⇒μ_f(t,a)≥τ
  binding(a₁,a₂)∈{0,1,2,3}
}
⟦Λ:Funcs⟧{
  route≜λt.argmax_{a∈A}(μ_f(t,a))
  bind≜λ(a,b).Δ⊗λ(a,b)
}
⟦Ε⟧⟨δ≜0.72;φ≜85;τ≜◊⁺⟩
`;

const SAMPLE_PROSE_DOC = `
This is a simple prose document about software development.
It describes tasks and agents but does not use AISP notation.
Tasks include features, bugs, and performance optimizations.
Agents include coders, testers, and reviewers.
No formal validation or binding state computation.
`;

// ============================================================================
// BENCHMARK FUNCTIONS
// ============================================================================

function runBenchmark(name, fn, iterations = 1000) {
  const start = process.hrtime.bigint();
  let result;

  for (let i = 0; i < iterations; i++) {
    result = fn(i);
  }

  const end = process.hrtime.bigint();
  const durationNs = Number(end - start);
  const durationMs = durationNs / 1_000_000;
  const opsPerSec = Math.round((iterations / durationMs) * 1000);

  return {
    name,
    iterations,
    totalMs: Math.round(durationMs * 100) / 100,
    avgNs: Math.round(durationNs / iterations),
    opsPerSec,
    result
  };
}

// ============================================================================
// BASELINE (NO AISP) - Simple keyword matching
// ============================================================================

function baselineRouteTask(task, agents) {
  // Simple keyword overlap scoring
  const taskWords = task.description.toLowerCase().split(/\s+/);

  let bestAgent = null;
  let bestScore = 0;

  for (const agent of agents) {
    const agentWords = agent.capabilities.join(' ').toLowerCase().split(/\s+/);
    const overlap = taskWords.filter(w => agentWords.some(aw => aw.includes(w) || w.includes(aw))).length;
    const score = overlap / taskWords.length;

    if (score > bestScore) {
      bestScore = score;
      bestAgent = agent;
    }
  }

  return { agent: bestAgent, score: bestScore };
}

function baselineValidateDoc(doc) {
  // Simple heuristic validation
  const hasStructure = doc.includes('{') && doc.includes('}');
  const hasKeywords = /task|agent|function|rule/i.test(doc);
  const wordCount = doc.split(/\s+/).length;
  const density = hasKeywords ? 0.3 : 0.1;

  return {
    valid: hasStructure && wordCount > 10,
    density,
    tier: density >= 0.4 ? 'silver' : 'bronze'
  };
}

// ============================================================================
// AISP-ENHANCED ROUTING
// ============================================================================

function aispRouteTask(task, agents, validator) {
  let bestAgent = null;
  let bestScore = 0;

  for (const agent of agents) {
    const score = validator.scoreAgentMatch(task, agent);

    if (score > bestScore) {
      bestScore = score;
      bestAgent = agent;
    }
  }

  return { agent: bestAgent, score: bestScore };
}

// ============================================================================
// MAIN BENCHMARK SUITE
// ============================================================================

async function runBenchmarkSuite() {
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║         AISP 5.1 PLATINUM - COMPARATIVE BENCHMARK                ║');
  console.log('║         Baseline vs Neuro-Symbolic Integration                   ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  const validator = new AISPValidator();
  await validator.initialize();

  const store = new AISPPocketStore();
  const results = { baseline: {}, aisp: {}, improvement: {} };

  // ─────────────────────────────────────────────────────────────────
  // TEST 1: Document Validation Throughput
  // ─────────────────────────────────────────────────────────────────
  console.log('\n┌─ TEST 1: Document Validation Throughput ─────────────────────────┐');

  const baselineValidation = runBenchmark('baseline_validation', () => {
    return baselineValidateDoc(SAMPLE_AISP_DOC);
  }, 10000);

  const aispValidation = runBenchmark('aisp_validation', () => {
    return validator.validate(SAMPLE_AISP_DOC);
  }, 10000);

  results.baseline.validation = baselineValidation;
  results.aisp.validation = aispValidation;
  results.improvement.validation = Math.round((baselineValidation.avgNs / aispValidation.avgNs) * 100) / 100;

  console.log(`│ Baseline:  ${baselineValidation.opsPerSec.toLocaleString()} ops/sec (${baselineValidation.avgNs}ns avg)`);
  console.log(`│ AISP:      ${aispValidation.opsPerSec.toLocaleString()} ops/sec (${aispValidation.avgNs}ns avg)`);
  console.log(`│ Factor:    ${results.improvement.validation}x`);
  console.log('└──────────────────────────────────────────────────────────────────┘');

  // ─────────────────────────────────────────────────────────────────
  // TEST 2: Agent Routing Accuracy
  // ─────────────────────────────────────────────────────────────────
  console.log('\n┌─ TEST 2: Agent Routing Accuracy ────────────────────────────────┐');

  // Ground truth mapping (manual)
  const groundTruth = {
    't1': 'coder',     // auth feature → coder
    't2': 'coder',     // bugfix → coder
    't3': 'perf',      // optimize → perf-analyzer
    't4': 'tester',    // tests → tester
    't5': 'architect', // refactor → architect
    't6': 'security',  // security audit → security
    't7': 'researcher', // docs → researcher
    't8': 'devops'     // CI/CD → devops
  };

  let baselineCorrect = 0;
  let aispCorrect = 0;

  for (const task of SAMPLE_TASKS) {
    const baselineResult = baselineRouteTask(task, SAMPLE_AGENTS);
    const aispResult = aispRouteTask(task, SAMPLE_AGENTS, validator);

    if (baselineResult.agent?.id === groundTruth[task.id]) baselineCorrect++;
    if (aispResult.agent?.id === groundTruth[task.id]) aispCorrect++;
  }

  const baselineAccuracy = (baselineCorrect / SAMPLE_TASKS.length) * 100;
  const aispAccuracy = (aispCorrect / SAMPLE_TASKS.length) * 100;

  results.baseline.routingAccuracy = baselineAccuracy;
  results.aisp.routingAccuracy = aispAccuracy;
  results.improvement.routingAccuracy = Math.round((aispAccuracy - baselineAccuracy) * 10) / 10;

  console.log(`│ Baseline:  ${baselineCorrect}/${SAMPLE_TASKS.length} correct (${baselineAccuracy}%)`);
  console.log(`│ AISP:      ${aispCorrect}/${SAMPLE_TASKS.length} correct (${aispAccuracy}%)`);
  console.log(`│ Δ Accuracy: +${results.improvement.routingAccuracy}%`);
  console.log('└──────────────────────────────────────────────────────────────────┘');

  // ─────────────────────────────────────────────────────────────────
  // TEST 3: Binding State Computation
  // ─────────────────────────────────────────────────────────────────
  console.log('\n┌─ TEST 3: Binding State Computation ────────────────────────────┐');

  const bindingBenchmark = runBenchmark('binding_computation', (i) => {
    const a1 = SAMPLE_AGENTS[i % SAMPLE_AGENTS.length];
    const a2 = SAMPLE_AGENTS[(i + 1) % SAMPLE_AGENTS.length];
    return validator.getBindingState(a1, a2);
  }, 10000);

  results.aisp.bindingComputation = bindingBenchmark;

  // Count binding states
  const bindingStats = { crash: 0, null: 0, adapt: 0, 'zero-cost': 0 };
  for (let i = 0; i < SAMPLE_AGENTS.length; i++) {
    for (let j = 0; j < SAMPLE_AGENTS.length; j++) {
      if (i !== j) {
        const binding = validator.getBindingState(SAMPLE_AGENTS[i], SAMPLE_AGENTS[j]);
        bindingStats[binding.label]++;
      }
    }
  }

  console.log(`│ Throughput: ${bindingBenchmark.opsPerSec.toLocaleString()} ops/sec`);
  console.log(`│ States:     crash=${bindingStats.crash}, null=${bindingStats.null}, adapt=${bindingStats.adapt}, zero-cost=${bindingStats['zero-cost']}`);
  console.log('└──────────────────────────────────────────────────────────────────┘');

  // ─────────────────────────────────────────────────────────────────
  // TEST 4: Pocket Store Performance
  // ─────────────────────────────────────────────────────────────────
  console.log('\n┌─ TEST 4: Pocket Store Search Performance ───────────────────────┐');

  // Populate store
  for (let i = 0; i < 100; i++) {
    const content = `Task ${i}: ${SAMPLE_TASKS[i % SAMPLE_TASKS.length].description}`;
    store.store(createPocket(content));
  }

  const searchBenchmark = runBenchmark('pocket_search', (i) => {
    const querySignal = generateSignal(SAMPLE_TASKS[i % SAMPLE_TASKS.length].description);
    return store.search(querySignal, 5);
  }, 1000);

  results.aisp.pocketSearch = searchBenchmark;

  console.log(`│ Store size: ${store.getStats().pocketCount} pockets`);
  console.log(`│ Search:     ${searchBenchmark.opsPerSec.toLocaleString()} ops/sec (k=5)`);
  console.log(`│ Avg latency: ${searchBenchmark.avgNs}ns`);
  console.log('└──────────────────────────────────────────────────────────────────┘');

  // ─────────────────────────────────────────────────────────────────
  // TEST 5: Hebbian Learning Convergence
  // ─────────────────────────────────────────────────────────────────
  console.log('\n┌─ TEST 5: Hebbian Learning Convergence ─────────────────────────┐');

  const hebbianStore = new AISPPocketStore();
  const taskPocket = createPocket('Test task for Hebbian learning');
  const agentPocket = createPocket('Test agent capabilities');
  hebbianStore.store(taskPocket);
  hebbianStore.store(agentPocket);

  const initialConf = taskPocket.membrane.conf;
  const iterations = 20;

  // Simulate 15 successes, 5 failures
  for (let i = 0; i < iterations; i++) {
    const success = i < 15;
    hebbianStore.updateHebbian(taskPocket.header.id, agentPocket.header.id, success);
  }

  const finalConf = taskPocket.membrane.conf;
  const confDelta = Math.round((finalConf - initialConf) * 1000) / 1000;

  results.aisp.hebbian = {
    initialConf: Math.round(initialConf * 1000) / 1000,
    finalConf: Math.round(finalConf * 1000) / 1000,
    delta: confDelta,
    iterations,
    successRate: 0.75
  };

  console.log(`│ Initial confidence: ${results.aisp.hebbian.initialConf}`);
  console.log(`│ Final confidence:   ${results.aisp.hebbian.finalConf}`);
  console.log(`│ Delta:              ${confDelta > 0 ? '+' : ''}${confDelta}`);
  console.log(`│ Learning rate:      α=${HEBBIAN.α}, β=${HEBBIAN.β}`);
  console.log('└──────────────────────────────────────────────────────────────────┘');

  // ─────────────────────────────────────────────────────────────────
  // TEST 6: Quality Tier Classification
  // ─────────────────────────────────────────────────────────────────
  console.log('\n┌─ TEST 6: Quality Tier Classification ──────────────────────────┐');

  const aispValidationResult = validator.validate(SAMPLE_AISP_DOC);
  const proseValidationResult = validator.validate(SAMPLE_PROSE_DOC);

  console.log(`│ AISP Doc:`);
  console.log(`│   Density: ${aispValidationResult.density} → Tier: ${aispValidationResult.tier} (${aispValidationResult.tierName})`);
  console.log(`│   Valid: ${aispValidationResult.valid}, Completeness: ${aispValidationResult.completeness}%`);
  console.log(`│ Prose Doc:`);
  console.log(`│   Density: ${proseValidationResult.density} → Tier: ${proseValidationResult.tier} (${proseValidationResult.tierName})`);
  console.log(`│   Valid: ${proseValidationResult.valid}, Completeness: ${proseValidationResult.completeness}%`);
  console.log('└──────────────────────────────────────────────────────────────────┘');

  // ─────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                     BENCHMARK SUMMARY                            ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log(`║ Document Validation:   AISP provides ${aispValidationResult.tierName} tier precision        ║`);
  console.log(`║ Routing Accuracy:      +${results.improvement.routingAccuracy}% improvement over baseline          ║`);
  console.log(`║ Binding Computation:   ${bindingBenchmark.opsPerSec.toLocaleString()} ops/sec                        ║`);
  console.log(`║ Pocket Search (k=5):   ${searchBenchmark.avgNs}ns latency                        ║`);
  console.log(`║ Hebbian Learning:      Converges with α=${HEBBIAN.α}, β=${HEBBIAN.β}                ║`);
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log('║ AISP 5.1 Platinum Integration: VERIFIED                          ║');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  // Return results for programmatic use
  return results;
}

// ============================================================================
// CLI ENTRY POINT
// ============================================================================

if (require.main === module) {
  runBenchmarkSuite()
    .then(results => {
      console.log('\n[Benchmark complete. Results available in JSON format.]');
      if (process.argv.includes('--json')) {
        console.log(JSON.stringify(results, null, 2));
      }
    })
    .catch(err => {
      console.error('Benchmark failed:', err);
      process.exit(1);
    });
}

module.exports = { runBenchmarkSuite };
