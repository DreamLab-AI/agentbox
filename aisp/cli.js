#!/usr/bin/env node
/**
 * AISP 5.1 Platinum CLI
 * Command-line interface for AISP validation and operations
 */

const fs = require('fs');
const path = require('path');
const {
  AISPValidator,
  AISPPocketStore,
  validateDocument,
  calculateDensity,
  calculateTier,
  computeBinding,
  QUALITY_TIERS,
  BINDING_STATES
} = require('./index.js');

const VERSION = '5.1.0';

// ============================================================================
// CLI COMMANDS
// ============================================================================

async function cmdValidate(filePath) {
  if (!filePath) {
    console.error('Usage: aisp-validate validate <file>');
    process.exit(1);
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const result = validateDocument(content);

  console.log('\n┌─ AISP Document Validation ──────────────────────────────────────┐');
  console.log(`│ File: ${path.basename(filePath)}`);
  console.log(`│ Valid: ${result.valid ? '✓ YES' : '✗ NO'}`);
  console.log(`│ Density (δ): ${result.density}`);
  console.log(`│ Tier: ${result.tier} (${result.tierName})`);
  console.log(`│ Completeness (φ): ${result.completeness}%`);
  console.log(`│ Ambiguity: ${Math.round(result.ambiguity * 100)}% (target: <2%)`);
  console.log(`│ Proof: ${result.proof}`);
  console.log('└──────────────────────────────────────────────────────────────────┘');

  return result;
}

async function cmdInit() {
  const validator = new AISPValidator();
  await validator.initialize();

  console.log('\n┌─ AISP 5.1 Initialization ───────────────────────────────────────┐');
  const stats = validator.getStats();
  console.log(`│ Initialized: ${stats.initialized}`);
  console.log(`│ Glossary: Σ_512 (${stats.glossarySize} symbols loaded)`);
  console.log(`│ Signal Dims: V_H=${stats.config.signalDims.V_H}, V_L=${stats.config.signalDims.V_L}, V_S=${stats.config.signalDims.V_S}`);
  console.log(`│ Hebbian: α=${stats.config.hebbian.α}, β=${stats.config.hebbian.β}, τ_v=${stats.config.hebbian.τ_v}`);
  console.log(`│ Quality Tiers: ${stats.config.qualityTiers.join(', ')}`);
  console.log('└──────────────────────────────────────────────────────────────────┘');

  return stats;
}

async function cmdStats() {
  const validator = new AISPValidator();
  await validator.initialize();

  const stats = validator.getStats();
  console.log(JSON.stringify(stats, null, 2));
  return stats;
}

async function cmdBinding(typeA, typeB) {
  const agentA = { type: typeA, post: [], logic: null, socket: { protocol: 'tcp' } };
  const agentB = { type: typeB, pre: [], logic: null, socket: { protocol: 'tcp' } };

  const binding = computeBinding(agentA, agentB);
  const labels = ['crash', 'null', 'adapt', 'zero-cost'];

  console.log(`\nBinding(${typeA}, ${typeB}) = ${binding} (${labels[binding]})`);
  console.log(`Can bind: ${binding >= BINDING_STATES.ADAPT ? 'YES' : 'NO'}`);
  console.log(`Optimal: ${binding === BINDING_STATES.ZERO_COST ? 'YES' : 'NO'}`);

  return { state: binding, label: labels[binding] };
}

async function cmdBenchmark() {
  const { runBenchmarkSuite } = require('./benchmark.js');
  return await runBenchmarkSuite();
}

async function cmdHelp() {
  console.log(`
AISP 5.1 Platinum CLI v${VERSION}
The Assembly Language for AI Cognition

Usage: aisp <command> [options]

Commands:
  init              Initialize AISP validator and show configuration
  validate <file>   Validate an AISP document
  stats             Show current AISP statistics (JSON)
  binding <A> <B>   Compute binding state between two agent types
  benchmark         Run comparative performance benchmark
  help              Show this help message

Examples:
  aisp validate ./aisp.md
  aisp binding coder tester
  aisp benchmark

Quality Tiers:
  ◊⁺⁺ Platinum  δ ≥ 0.75
  ◊⁺  Gold      δ ≥ 0.60
  ◊   Silver    δ ≥ 0.40
  ◊⁻  Bronze    δ ≥ 0.20
  ⊘   Reject    δ < 0.20

Binding States:
  0 = crash     Logic conflict
  1 = null      Socket mismatch
  2 = adapt     Type mismatch (adaptable)
  3 = zero-cost Post(A) ⊆ Pre(B) satisfied

Specification: https://gist.github.com/bar181/b02944bd27e91c7116c41647b396c4b8
`);
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case 'init':
        await cmdInit();
        break;
      case 'validate':
        await cmdValidate(args[1]);
        break;
      case 'stats':
        await cmdStats();
        break;
      case 'binding':
        await cmdBinding(args[1] || 'coder', args[2] || 'tester');
        break;
      case 'benchmark':
        await cmdBenchmark();
        break;
      case 'help':
      case '--help':
      case '-h':
      case undefined:
        await cmdHelp();
        break;
      default:
        console.error(`Unknown command: ${command}`);
        await cmdHelp();
        process.exit(1);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

main();
