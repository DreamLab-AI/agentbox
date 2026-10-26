#!/usr/bin/env node
'use strict';
const os = require('node:os');

function nixBuildBudget(availableCpus = os.availableParallelism()) {
  const budget = Math.max(1, Math.floor(availableCpus * 0.6));
  // Large single derivations (Chromium, QtWebEngine) cannot use spare slots
  // allocated to other jobs. Give each up to 21 cores while still keeping the
  // total number of build slots within the 60% machine-wide budget.
  let best = { maxJobs: 1, cores: Math.min(21, budget) };
  for (let cores = 8; cores <= Math.min(21, budget); cores++) {
    const maxJobs = Math.floor(budget / cores);
    const slots = maxJobs * cores;
    const bestSlots = best.maxJobs * best.cores;
    if (slots > bestSlots || (slots === bestSlots && cores > best.cores)) {
      best = { maxJobs, cores };
    }
  }
  return best;
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
