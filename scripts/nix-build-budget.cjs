#!/usr/bin/env node
'use strict';
const os = require('node:os');

function nixBuildBudget(availableCpus = os.availableParallelism()) {
  const budget = Math.max(1, Math.floor(availableCpus * 0.6));
  const cores = Math.min(4, budget);
  return { maxJobs: Math.max(1, Math.floor(budget / cores)), cores };
}

function nixBuildConfig(existing = process.env.NIX_CONFIG || '') {
  const { maxJobs, cores } = nixBuildBudget();
  return `${existing ? `${existing.trimEnd()}\n` : ''}max-jobs = ${maxJobs}\ncores = ${cores}`;
}

if (require.main === module) {
  if (process.argv.length !== 3 || process.argv[2] !== '--nix-config') {
    console.error('Usage: nix-build-budget.cjs --nix-config');
    process.exitCode = 2;
  } else {
    process.stdout.write(`${nixBuildConfig()}\n`);
  }
}

module.exports = { nixBuildBudget, nixBuildConfig };
