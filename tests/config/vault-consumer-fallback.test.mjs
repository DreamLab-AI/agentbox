#!/usr/bin/env node
// ============================================================================
// vault-consumer-fallback.test.mjs — ADR-2028 acceptance test (JS consumers)
// ----------------------------------------------------------------------------
// The companion to tests/config/vault-path-precedence.test.sh: that one proves
// the resolver derives paths from [vault] alone; this one proves the consumers
// ignore the retired ONTOLOGY_PAGES_DIR / AGENTBOX_VAULT_LEGACY_PATHS pair
// independently, so a stale variable arriving from anywhere (an operator shell,
// a supervisord environment= line, an older runtime-env.sh) cannot resurrect a
// corpus the rest of the system reports as disabled, or redirect an enabled one.
//
// Consumers covered:
//   mcp/servers/lib/ontology-local.js        (library — empty index when disabled)
//   mcp/servers/lib/ontology-index-build.js  (script  — leaves outputs untouched)
//   scripts/ontology-condense-scheduler.mjs  (loop    — benign skip)
// scripts/ontology-condense-refresh.sh is covered by the bash test above.
//
// Every case runs in a child process with an explicit environment, against a
// throwaway fixture corpus. Nothing real is read or written.
//
// Usage:  node tests/config/vault-consumer-fallback.test.mjs
// Exit:   0 = every case passed, 1 = at least one failed.
// ============================================================================
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const LOCAL_LIB = join(REPO, 'mcp/servers/lib/ontology-local.js');
const INDEX_BUILD = join(REPO, 'mcp/servers/lib/ontology-index-build.js');
const SCHEDULER = join(REPO, 'scripts/ontology-condense-scheduler.mjs');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`PASS  ${m}`); };
const bad = (m, detail) => { fail += 1; console.log(`FAIL  ${m}`); if (detail) console.log(`        ${String(detail).replace(/\n/g, '\n        ')}`); };

// ── fixture corpus: one page carrying a real Class block ────────────────────
const TMP = mkdtempSync(join(tmpdir(), 'vault-consumer-'));
const LEGACY_PAGES = join(TMP, 'legacy-pages');
const VAULT_PAGES = join(TMP, 'vault', 'pages');
mkdirSync(LEGACY_PAGES, { recursive: true });
mkdirSync(VAULT_PAGES, { recursive: true });

const page = (iri, label) => [
  '# ' + label,
  '',
  '```json-ld',
  JSON.stringify({ '@type': 'Class', '@id': iri, label, definition: `${label} is a fixture class used only by this test.`, domain: 'fixture' }, null, 2),
  '```',
  '',
].join('\n');

writeFileSync(join(LEGACY_PAGES, 'StaleFixture.md'), page('vc:StaleFixture', 'StaleFixture'));
writeFileSync(join(VAULT_PAGES, 'VaultFixture.md'), page('vc:VaultFixture', 'VaultFixture'));

const BASE_ENV = { PATH: process.env.PATH, HOME: TMP };

function runNode(script, args, env) {
  return spawnSync(process.execPath, [script, ...args], {
    env: { ...BASE_ENV, ...env },
    encoding: 'utf8',
  });
}

// ── consumer 1: ontology-local.js ───────────────────────────────────────────
// Probed in a child so the module-load-time resolution sees the right env.
const LOCAL_PROBE = join(TMP, 'local-probe.cjs');
writeFileSync(LOCAL_PROBE, `
const m = require(${JSON.stringify(LOCAL_LIB)});
const o = m.createLocalOntology();
process.stdout.write(JSON.stringify({
  defaultCorpus: m.DEFAULT_CORPUS,
  corpusDir: o.corpusDir,
  classes: o.classList({ limit: 50 }).total,
}) + '\\n');
`);

function probeLocal(env) {
  const r = runNode(LOCAL_PROBE, [], env);
  let json = {};
  try { json = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { /* left empty */ }
  return { ...r, json };
}

console.log('── mcp/servers/lib/ontology-local.js ──');

let r = probeLocal({ AGENTBOX_VAULT_ENABLED: '0', AGENTBOX_ONTOLOGY_LOCAL_PATH: LEGACY_PAGES });
if (r.json.corpusDir === '' && r.json.classes === 0 && /REFUSING corpus path/.test(r.stderr)) {
  ok('vault disabled + explicit override → corpus refused, 0 classes, clear line');
} else {
  bad('ontology-local must refuse the override when the vault is disabled', `corpusDir=${r.json.corpusDir} classes=${r.json.classes}\n${r.stderr}`);
}

r = probeLocal({ AGENTBOX_VAULT_ENABLED: '0', ONTOLOGY_PAGES_DIR: LEGACY_PAGES, AGENTBOX_VAULT_LEGACY_PATHS: '1' });
if (r.json.corpusDir === '' && r.json.classes === 0) {
  ok('vault disabled + retired ONTOLOGY_PAGES_DIR + LEGACY_PATHS=1 → ignored, 0 classes');
} else {
  bad('ontology-local must ignore the retired legacy pair', `corpusDir=${r.json.corpusDir} classes=${r.json.classes}\n${r.stderr}`);
}

r = probeLocal({ AGENTBOX_VAULT_ENABLED: '1', VAULT_PAGES, ONTOLOGY_PAGES_DIR: LEGACY_PAGES });
if (r.json.corpusDir === VAULT_PAGES && r.json.classes === 1 && !/REFUSING/.test(r.stderr)) {
  ok('vault enabled → VAULT_PAGES indexed; a stray ONTOLOGY_PAGES_DIR is ignored');
} else {
  bad('ontology-local must be unchanged when the vault is enabled', `corpusDir=${r.json.corpusDir} classes=${r.json.classes}\n${r.stderr}`);
}

r = probeLocal({ AGENTBOX_VAULT_ENABLED: '1', VAULT_PAGES, AGENTBOX_ONTOLOGY_LOCAL_PATH: LEGACY_PAGES });
if (r.json.corpusDir === LEGACY_PAGES) {
  ok('vault enabled + explicit AGENTBOX_ONTOLOGY_LOCAL_PATH → explicit override still wins (unchanged)');
} else {
  bad('explicit override must still win while the vault is enabled', `corpusDir=${r.json.corpusDir}`);
}

// ── consumer 2: ontology-index-build.js ─────────────────────────────────────
console.log('\n── mcp/servers/lib/ontology-index-build.js ──');

const outFile = () => join(TMP, `index-${Math.random().toString(36).slice(2)}.json`);

r = runNode(INDEX_BUILD, [], { AGENTBOX_VAULT_ENABLED: '0', ONTOLOGY_PAGES_DIR: LEGACY_PAGES, AGENTBOX_VAULT_LEGACY_PATHS: '1', ONTOLOGY_PUSH_CACHE: join(TMP, 'cache-retired.json') });
if (r.status === 0 && /no corpus path/.test(r.stderr) && /"wrote": false/.test(r.stdout)) {
  ok('vault disabled + retired ONTOLOGY_PAGES_DIR/LEGACY_PATHS → ignored: no corpus path, wrote:false (outputs untouched)');
} else {
  bad('index-build must ignore the retired legacy pair', `status=${r.status}\n${r.stderr}\n${r.stdout}`);
}

r = runNode(INDEX_BUILD, [], { AGENTBOX_VAULT_ENABLED: '1', VAULT_PAGES, ONTOLOGY_PAGES_DIR: LEGACY_PAGES, ONTOLOGY_PUSH_CACHE: join(TMP, 'cache-stray.json') });
if (r.status === 0 && /"classes": 1/.test(r.stdout) && r.stdout.includes(VAULT_PAGES)) {
  ok('vault enabled + stray ONTOLOGY_PAGES_DIR → VAULT_PAGES indexed, the stray variable ignored');
} else {
  bad('index-build must index VAULT_PAGES, not ONTOLOGY_PAGES_DIR', `status=${r.status}\n${r.stderr}\n${r.stdout}`);
}

r = runNode(INDEX_BUILD, [VAULT_PAGES, outFile()], { AGENTBOX_VAULT_ENABLED: '1', VAULT_PAGES, ONTOLOGY_PUSH_CACHE: join(TMP, 'cache-enabled.json') });
if (r.status === 0 && /"classes": 1/.test(r.stdout) && /"wrote": true/.test(r.stdout)) {
  ok('vault enabled → indexes VAULT_PAGES, behaviour unchanged');
} else {
  bad('index-build must be unchanged when the vault is enabled', `status=${r.status}\n${r.stderr}\n${r.stdout}`);
}

r = runNode(INDEX_BUILD, [LEGACY_PAGES, outFile()], { AGENTBOX_VAULT_ENABLED: '0', ONTOLOGY_PUSH_CACHE: join(TMP, 'cache-argv.json') });
if (r.status === 0 && /WARNING: AGENTBOX_VAULT_ENABLED=0/.test(r.stderr)) {
  ok('vault disabled + EXPLICIT argv pagesDir → honoured with a warning (typed, not silent)');
} else {
  bad('index-build must honour a typed argv path with a warning', `status=${r.status}\n${r.stderr}`);
}

// ── consumer 3: ontology-condense-scheduler.mjs ─────────────────────────────
console.log('\n── scripts/ontology-condense-scheduler.mjs ──');

const SCHED_GATES = { ONTOLOGY_CONDENSE_ENABLED: 'true', ONTOLOGY_CONDENSE_SCHEDULE: 'true' };

r = runNode(SCHEDULER, ['--once'], { ...SCHED_GATES, AGENTBOX_VAULT_ENABLED: '0', ONTOLOGY_PAGES_DIR: LEGACY_PAGES, AGENTBOX_VAULT_LEGACY_PATHS: '1' });
if (r.status === 0 && /vault-disabled/.test(r.stderr + r.stdout) && !/REFUSING/.test(r.stderr + r.stdout)) {
  ok('--once: vault disabled + retired ONTOLOGY_PAGES_DIR/LEGACY_PATHS → ignored, benign skip, exit 0');
} else {
  bad('scheduler --once must ignore the retired legacy pair', `status=${r.status}\n${r.stderr}\n${r.stdout}`);
}

r = runNode(SCHEDULER, ['--dry-run'], { ...SCHED_GATES, AGENTBOX_VAULT_ENABLED: '0' });
if (r.status === 0 && /vault-disabled/.test(r.stdout + r.stderr)) {
  ok('--dry-run: vault disabled + no path at all → benign skip, exit 0');
} else {
  bad('scheduler must stay a benign no-op with no path at all', `status=${r.status}\n${r.stderr}\n${r.stdout}`);
}

r = runNode(SCHEDULER, ['--dry-run'], { ...SCHED_GATES, AGENTBOX_VAULT_ENABLED: '1', VAULT_PAGES, ONTOLOGY_CONDENSED_OUT: join(TMP, 'condensed-enabled.json') });
if (r.status === 0 && !/REFUSING/.test(r.stderr + r.stdout)) {
  ok('--dry-run: vault enabled → staleness decision as before, behaviour unchanged');
} else {
  bad('scheduler must be unchanged when the vault is enabled', `status=${r.status}\n${r.stderr}\n${r.stdout}`);
}

rmSync(TMP, { recursive: true, force: true });

console.log('\n==================================================');
console.log(`vault-consumer-fallback: ${pass} passed, ${fail} failed`);
console.log('==================================================');
process.exit(fail === 0 ? 0 : 1);
