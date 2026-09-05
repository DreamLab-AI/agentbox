#!/usr/bin/env node
// adr-index-check.test.mjs — ADR-2001 acceptance for the ledger index gate.
//
// The estate review reproduced the gap directly: `--check` validates RECORDS and
// never looks at README.md, so "an isolated fixture with an intentionally stale
// index passes". These cases build exactly that fixture and assert the new
// `--check-index` mode catches it while `--check` still does not — the two flags
// answer different questions, and the test pins which is which.
//
// Everything runs against the ACTUAL scripts/adr-index-gen.js in a temporary
// directory. The repository's own docs/adr is only READ, never regenerated.
//
// Run: node tests/config/adr-index-check.test.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const GEN = path.join(REPO, 'scripts/adr-index-gen.js');

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failures.push(`${name}${detail ? `: ${detail}` : ''}`); console.log(`  FAIL ${name}${detail ? `: ${detail}` : ''}`); }
}

/** A minimal record that satisfies every required field and enum. */
function record(id, title, extra = {}) {
  const fm = {
    id, title, date: '2026-09-05', decision_status: 'accepted',
    implementation_status: 'complete', activation_status: 'live',
    supersedes: '[]', superseded_by: '[]',
    verified_commit: '0000000000000000000000000000000000000000',
    owner: 'fixture', review_trigger: 'fixture only', repo: 'agentbox',
    ...extra,
  };
  const body = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n');
  return `---\n${body}\n---\n\n# ${id} — ${title}\n\n## Decision\nFixture.\n`;
}

function scratch(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr2001-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function gen(dir, ...flags) {
  const r = spawnSync(process.execPath, [GEN, dir, ...flags], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

console.log('ADR-2001 — ledger index staleness gate');

// --- an in-sync index -------------------------------------------------------
console.log('\n[in sync]');
scratch((dir) => {
  fs.writeFileSync(path.join(dir, 'ADR-9001-first.md'), record('ADR-9001', 'First'));
  const written = gen(dir);
  check('generation succeeds', written.status === 0, written.stderr.trim());
  const r = gen(dir, '--check-index');
  check('--check-index passes on a freshly generated index', r.status === 0, `${r.status} ${r.stderr.trim()}`);
  check('the pass names the file it compared', /is in sync/.test(r.stdout), r.stdout.trim());
});

// --- the reproduced gap -----------------------------------------------------
console.log('\n[intentionally stale index — the reproduced case]');
scratch((dir) => {
  fs.writeFileSync(path.join(dir, 'ADR-9001-first.md'), record('ADR-9001', 'First'));
  gen(dir);                                        // index now lists one record
  fs.writeFileSync(path.join(dir, 'ADR-9002-second.md'), record('ADR-9002', 'Second'));
  // The index is NOT regenerated — this is exactly the fixture the review used.

  const recordsOnly = gen(dir, '--check');
  check('--check still passes: it validates records, not the index', recordsOnly.status === 0,
    `${recordsOnly.status} ${recordsOnly.stderr.trim()}`);
  check('--check says plainly that it did not compare the index',
    /neither written nor compared/.test(recordsOnly.stdout), recordsOnly.stdout.trim());

  const indexed = gen(dir, '--check-index');
  check('--check-index FAILS on the stale index', indexed.status === 1, `${indexed.status} ${indexed.stdout.trim()}`);
  check('the failure says the index is stale', /is STALE/.test(indexed.stderr), indexed.stderr.trim());
  check('the failure names the first differing line', /first difference at line \d+/.test(indexed.stderr), indexed.stderr.trim());
  check('the failure gives the regeneration command', /regenerate with: node scripts\/adr-index-gen\.js/.test(indexed.stderr), indexed.stderr.trim());
});

// --- a hand-edited index ----------------------------------------------------
console.log('\n[hand-edited index]');
scratch((dir) => {
  fs.writeFileSync(path.join(dir, 'ADR-9001-first.md'), record('ADR-9001', 'First'));
  gen(dir);
  const readme = path.join(dir, 'README.md');
  fs.writeFileSync(readme, fs.readFileSync(readme, 'utf8').replace('First', 'Something Else'));
  const r = gen(dir, '--check-index');
  check('a hand-edited row is caught', r.status === 1, `${r.status}`);
});

// --- a record removed but left in the index ---------------------------------
console.log('\n[record removed]');
scratch((dir) => {
  fs.writeFileSync(path.join(dir, 'ADR-9001-first.md'), record('ADR-9001', 'First'));
  fs.writeFileSync(path.join(dir, 'ADR-9002-second.md'), record('ADR-9002', 'Second'));
  gen(dir);
  fs.rmSync(path.join(dir, 'ADR-9002-second.md'));
  const r = gen(dir, '--check-index');
  check('a deleted record leaves the index stale and is caught', r.status === 1, `${r.status}`);
});

// --- no index at all --------------------------------------------------------
console.log('\n[index absent]');
scratch((dir) => {
  fs.writeFileSync(path.join(dir, 'ADR-9001-first.md'), record('ADR-9001', 'First'));
  const r = gen(dir, '--check-index');
  check('a missing index fails rather than passing vacuously', r.status === 1, `${r.status}`);
  check('the failure says it has never been generated', /never been generated/.test(r.stderr), r.stderr.trim());
});

// --- record validation still runs first -------------------------------------
console.log('\n[record validation precedence]');
scratch((dir) => {
  fs.writeFileSync(path.join(dir, 'ADR-9001-first.md'), record('ADR-9001', 'First'));
  gen(dir);
  fs.writeFileSync(path.join(dir, 'ADR-9002-bad.md'), record('ADR-9002', 'Bad', { implementation_status: 'nearly' }));
  const r = gen(dir, '--check-index');
  check('--check-index implies --check: an invalid record fails first', r.status === 1, `${r.status}`);
  check('the reported error is the record, not the index',
    /implementation_status/.test(r.stderr) && !/is STALE/.test(r.stderr), r.stderr.trim());
});

// --- the repository's own ledger --------------------------------------------
// Reported, never repaired: regenerating docs/adr/README.md is deliberately out
// of scope for this pass, because records are being added concurrently and a
// regeneration here would clobber rows their owners have not yet written.
console.log('\n[repository ledger — reported, not repaired]');
{
  const records = gen(path.join(REPO, 'docs/adr'), '--check');
  check('the repository records validate', records.status === 0, records.stderr.trim());
  const indexed = gen(path.join(REPO, 'docs/adr'), '--check-index');
  console.log(`  NOTE docs/adr/README.md in-sync: ${indexed.status === 0 ? 'yes' : 'NO — ' + (indexed.stderr.split('\n')[0] || '').trim()}`);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
