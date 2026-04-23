#!/usr/bin/env bun
// ruvector-catalog — Technology recommender for the RuVector monorepo
// https://github.com/ruvnet/ruvector

import { CatalogRepository } from './catalog/repository.js';
import { CatalogStore } from './catalog/store.js';
import { DiscoveryService } from './discovery/search.js';
import { ProposalService } from './proposals/generator.js';
import { FreshnessService } from './freshness/detector.js';
import { CatalogUpdater } from './freshness/updater.js';
import { SubmoduleService } from './submodule/manager.js';
import { WorkflowGenerator } from './ci/workflows.js';
import { CatalogVerifier } from './ci/verifier.js';
import { IntentClassifier } from './discovery/intent.js';

const args = process.argv.slice(2);
const command = args[0];

const repo = new CatalogRepository();
const store = new CatalogStore();
const discovery = new DiscoveryService(repo);
discovery.buildIndex();

const proposals = new ProposalService(repo);
const intentClassifier = new IntentClassifier();

function printHelp() {
  console.log(`
ruvector-catalog v3.0.0 — Technology recommender for RuVector

Commands:
  search <query>               Search with intent classification + sparse TF-IDF
  list [--status <s>]          List technologies with optional filter
  rvbp <problem>               Generate a RuVector Booster Proposal
  scope <query>                Check if a query is in scope
  build                        Build/rebuild the persistent catalog store
  verify                       Check catalog freshness
  verify-completeness          Check catalog coverage vs ruvector repo
  verify-doc <file>            Verify technology claims in a document
  generate-workflows           Generate GitHub Actions CI/CD workflows
  stats                        Show catalog statistics
  submodule                    Check/update ruvector submodule
  install-hooks                Install git hooks for auto-rebuild
  help                         Show this help

Options:
  --limit <n>                  Max results (default: 5)
  --status <s>                 Filter: production, experimental, research
  --target <t>                 Filter: native, wasm, nodejs, edge
  --output <dir>               Output directory for generated files
  --strict                     Exit with error on incompleteness

Examples:
  ruvector-catalog search "prevent model drift"
  ruvector-catalog search "healthcare patient matching"
  ruvector-catalog rvbp "make my search 10x faster"
  ruvector-catalog scope "how do I build a website"
  ruvector-catalog build
  ruvector-catalog verify-completeness --strict
`);
}

function parseFlag(flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
}

function hasFlag(flag: string): boolean {
  return args.includes(flag);
}

switch (command) {
  case 'search': {
    const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
    if (!query) { console.error('Usage: ruvector-catalog search <query>'); process.exit(1); }
    const limit = parseInt(parseFlag('--limit') ?? '5');
    const result = discovery.search(query, limit);

    // V3: Show intent classification
    console.log(`\nIntent: ${result.intent.intent} (${(result.intent.confidence * 100).toFixed(0)}% confidence)`);
    console.log(`Audience: ${result.intent.audienceLevel}`);
    if (result.intent.matchedVertical) {
      console.log(`Vertical: ${result.intent.matchedVertical}`);
    }

    if (result.intent.intent === 'out-of-scope') {
      console.log(`\nThis query appears to be outside RuVector's scope.`);
      console.log('RuVector covers: vector search, HNSW, ML pipelines, Rust HPC primitives.');
      break;
    }

    console.log(`\nFound ${result.matches.length} matches (${result.latencyMs.toFixed(1)}ms):\n`);
    for (const m of result.matches) {
      console.log(`  ${m.score.toFixed(2)}  ${m.technology.name} (${m.technology.crate})`);
      console.log(`       ${m.capability.description}`);
      if (m.technology.useWhen) console.log(`       Use when: ${m.technology.useWhen}`);
      if (m.technology.plainDescription && result.intent.audienceLevel !== 'technical') {
        console.log(`       Plain: ${m.technology.plainDescription}`);
      }
      if (m.technology.latency) console.log(`       Latency: ${m.technology.latency}`);
      console.log(`       Status: ${m.technology.status} | Targets: ${m.technology.deploymentTargets.join(', ')}`);
      if (m.technology.useCases.length > 0) {
        console.log(`       Use cases: ${m.technology.useCases.join(', ')}`);
      }
      console.log('');
    }
    break;
  }

  case 'list': {
    const status = parseFlag('--status');
    const target = parseFlag('--target');
    const techs = repo.listTechnologies({
      status: status as any,
      deploymentTarget: target as any,
    });
    console.log(`\n${techs.length} technologies${status ? ` (${status})` : ''}${target ? ` (${target})` : ''}:\n`);
    for (const t of techs) {
      const cap = repo.getCapability(t.capabilityId);
      console.log(`  ${t.name.padEnd(30)} ${t.crate.padEnd(35)} ${t.status.padEnd(14)} ${cap?.id ?? ''}`);
    }
    break;
  }

  case 'rvbp': {
    const problem = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
    if (!problem) { console.error('Usage: ruvector-catalog rvbp <problem statement>'); process.exit(1); }
    const outputDir = parseFlag('--output');
    const result = discovery.search(problem, 5);
    const proposal = proposals.generate(problem, result, 'unknown', result.intent);
    if (outputDir) {
      const path = proposals.write(proposal, outputDir, result.intent);
      console.log(`RVBP written to: ${path}`);
    } else {
      console.log(proposals.render(proposal, result.intent));
    }
    break;
  }

  case 'scope': {
    const query = args.slice(1).filter(a => !a.startsWith('--')).join(' ');
    if (!query) { console.error('Usage: ruvector-catalog scope <query>'); process.exit(1); }
    const outOfScope = repo.getOutOfScope();
    const scopeResult = intentClassifier.checkScope(query.toLowerCase(), outOfScope);
    console.log(`\nScope check: ${scopeResult.verdict}`);
    console.log(`Confidence: ${(scopeResult.confidence * 100).toFixed(0)}%`);
    if (scopeResult.outOfScopeCategory) {
      console.log(`Category: ${scopeResult.outOfScopeCategory}`);
    }
    if (scopeResult.suggestions.length > 0) {
      console.log(`Suggestions:`);
      for (const s of scopeResult.suggestions) {
        console.log(`  - ${s}`);
      }
    }
    break;
  }

  case 'build': {
    console.log('Building catalog store...');
    const updater = new CatalogUpdater(process.cwd());
    const result = updater.rebuild();
    console.log(`\nBuild ${result.success ? 'succeeded' : 'failed'} (${result.durationMs}ms)`);
    console.log(`  Technologies: ${repo.technologyCount}`);
    if (result.added.length > 0) console.log(`  Added: ${result.added.join(', ')}`);
    if (result.removed.length > 0) console.log(`  Removed: ${result.removed.join(', ')}`);
    const s = new CatalogStore(process.cwd());
    if (s.exists) console.log(`  Store size: ${(s.fileSizeBytes() / 1024).toFixed(1)} KB`);
    break;
  }

  case 'verify': {
    const freshness = new FreshnessService(repo);
    const result = freshness.checkStaleness();
    console.log(`\nFreshness: ${result.isStale ? 'STALE' : 'CURRENT'}`);
    console.log(`Message: ${result.message}`);
    console.log(`Catalog commit: ${result.catalogCommit.slice(0, 8)}`);
    if (result.submoduleCommit) console.log(`Submodule commit: ${result.submoduleCommit.slice(0, 8)}`);
    if (result.daysBehind !== null) console.log(`Days behind: ${result.daysBehind}`);
    console.log(`Search index: ${discovery.isIndexBuilt ? 'BUILT' : 'NOT BUILT'}`);
    break;
  }

  case 'verify-completeness': {
    const verifier = new CatalogVerifier(repo);
    const result = verifier.verifyCompleteness();
    console.log(result.report);
    if (hasFlag('--strict') && !result.complete) {
      console.error(`\nERROR: Catalog is incomplete (${(result.score * 100).toFixed(1)}% coverage)`);
      process.exit(1);
    }
    break;
  }

  case 'verify-doc': {
    const file = args[1];
    if (!file) { console.error('Usage: ruvector-catalog verify-doc <file>'); process.exit(1); }
    const verifier = new CatalogVerifier(repo);
    const result = verifier.verifyDocument(file);
    console.log(`\nDocument: ${result.filePath}`);
    console.log(`Valid: ${result.valid}`);
    console.log(`Tech references: ${result.claims.length}`);
    for (const c of result.claims) {
      console.log(`  ${c.found ? 'OK' : 'MISSING'} \`${c.crateName}\`${c.technologyName ? ` (${c.technologyName})` : ''}`);
    }
    if (result.warnings.length > 0) {
      console.log(`\nWarnings:`);
      for (const w of result.warnings) console.log(`  ${w}`);
    }
    if (result.errors.length > 0) {
      console.log(`\nErrors:`);
      for (const e of result.errors) console.log(`  ${e}`);
    }
    break;
  }

  case 'generate-workflows': {
    const generator = new WorkflowGenerator();
    const files = generator.generate();
    console.log(`Generated ${files.length} workflow files:`);
    for (const f of files) console.log(`  ${f}`);
    break;
  }

  case 'stats': {
    const v = repo.getVersion();
    const sections = repo.getProblemSections();
    const verticals = repo.listVerticals();
    console.log(`
RuVector Catalog v3.0.0
  RuVector version:  ${v.ruvectorVersion} (${v.ruvectorCommitShort})
  Capabilities:      ${repo.capabilityCount}
  Technologies:      ${repo.technologyCount}
  Algorithms:        ${repo.algorithmCount}
  Examples:          ${repo.exampleCount}
  Problem sections:  ${sections.length}
  Verticals:         ${verticals.length} (${verticals.map(v => v.vertical).join(', ')})
  Out-of-scope:      ${repo.getOutOfScope().length} categories
  Rust lines:        ${v.scope.rustLines.toLocaleString()}
  Source files:      ${v.scope.sourceFiles.toLocaleString()}
  Crates:            ${v.scope.crates}
  ADRs:              ${v.scope.adrs}
  npm packages:      ${v.scope.npmPackages}
  Search index:      ${discovery.isIndexBuilt ? 'built' : 'not built'}
  Vocabulary:        ${discovery.isIndexBuilt ? 'sparse TF-IDF (full vocabulary)' : 'n/a'}
  Store:             ${store.exists ? `${(store.fileSizeBytes() / 1024).toFixed(1)} KB` : 'not built'}
`);
    break;
  }

  case 'submodule': {
    const submodule = new SubmoduleService();
    const state = submodule.detectState();
    console.log(`\nSubmodule status: ${state.status}`);
    if (state.localCommit) console.log(`Local commit: ${state.localCommit.slice(0, 8)}`);
    if (state.remoteCommit) console.log(`Remote commit: ${state.remoteCommit.slice(0, 8)}`);
    console.log(`Shallow: ${state.isShallow}`);
    break;
  }

  case 'install-hooks': {
    const { execSync } = require('child_process');
    try {
      execSync('bash ruvector-catalog-v3/scripts/install-hooks.sh', { stdio: 'inherit' });
    } catch {
      console.error('Failed to install hooks. Run manually: bash ruvector-catalog-v3/scripts/install-hooks.sh');
    }
    break;
  }

  case 'help':
  case '--help':
  case '-h':
  case undefined:
    printHelp();
    break;

  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
