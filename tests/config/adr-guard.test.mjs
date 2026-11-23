#!/usr/bin/env node
// adr-guard.test.mjs — ADR-2217 acceptance for the optional `guard:` field.
//
// A record may name the tests that enforce it: `guard: [path, path#name]`.
// Paths resolve against the git toplevel exactly as verified_paths do; `#name`
// must occur in that file. The checker never runs the tests. These cases pin:
// a valid guard passes, a missing file fails, a missing name fails, a malformed
// entry fails, an absent guard (and an empty list) passes, a path written
// relative to the ADR directory instead of the repository root fails, and with
// no git repository the existence checks are skipped with a warning.
//
// Runs the ACTUAL scripts/adr-index-gen.js against temporary git repositories
// with the ledger nested at docs/adr, as in every consumer.
// Run: node tests/config/adr-guard.test.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GEN = path.resolve(HERE, '../../scripts/adr-index-gen.js');

let passed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failures.push(`${name}${detail ? `: ${detail}` : ''}`); console.log(`  FAIL ${name}${detail ? `: ${detail}` : ''}`); }
}

function record(id, title, extra = {}) {
  const fm = {
    id, title, date: '2026-11-23', decision_status: 'proposed',
    implementation_status: 'none', activation_status: 'inactive',
    supersedes: '[]', superseded_by: '[]', verified_commit: '""',
    owner: 'fixture', review_trigger: 'fixture only', repo: 'agentbox',
    ...extra,
  };
  const body = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n');
  return `---\n${body}\n---\n\n# ${id} — ${title}\n`;
}

const GUARDED_TEST = [
  "describe('relay allowlist', () => {",
  "  it('rejects an unlisted pubkey', () => {});",
  '});',
  'class AllowlistGuardTest {}',
  '',
].join('\n');

// A repository root with docs/adr and one real test file at tests/allowlist.test.js.
function repo(fn, { git = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-guard-'));
  try {
    const adr = path.join(root, 'docs/adr');
    fs.mkdirSync(adr, { recursive: true });
    fs.mkdirSync(path.join(root, 'tests'));
    fs.writeFileSync(path.join(root, 'tests/allowlist.test.js'), GUARDED_TEST);
    if (git) {
      const r = spawnSync('git', ['init', '-q', root], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`git init failed: ${r.stderr}`);
    }
    return fn(root, adr);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
// Run from the repository root with a relative ledger dir, as consumers do.
function gen(root, ...flags) {
  // The ceiling stops git from finding an enclosing repository when TMPDIR sits
  // inside one, so the no-git cases really have no repository.
  const env = { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(root) };
  const r = spawnSync(process.execPath, [GEN, 'docs/adr', ...flags], { cwd: root, env, encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const put = (adr, name, text) => fs.writeFileSync(path.join(adr, name), text);

console.log('ADR-2217 — optional guard field');

console.log('\n[valid guard]');
repo((root, adr) => {
  put(adr, 'ADR-9001-a.md', record('ADR-9001', 'A', {
    guard: "[tests/allowlist.test.js, tests/allowlist.test.js#rejects an unlisted pubkey, tests/allowlist.test.js#AllowlistGuardTest]",
  }));
  const r = gen(root, '--check');
  check('a path, a describe/it name and a class name all resolve', r.status === 0, `${r.status} ${r.stderr.trim()}`);
  const w = gen(root);
  check('the index is generated', w.status === 0, w.stderr.trim());
  const readme = fs.readFileSync(path.join(adr, 'README.md'), 'utf8');
  check('the index table keeps its eleven columns (no guard column)',
    readme.includes('| ID | Title | Domain | Date | Decision | Impl | Activation | Supersedes | Superseded by | Owner | Repo |'), readme);
  check('the index does not mention the guard', !readme.includes('allowlist.test.js'), readme);
});

console.log('\n[absent guard, empty guard]');
repo((root, adr) => {
  put(adr, 'ADR-9001-a.md', record('ADR-9001', 'A'));
  put(adr, 'ADR-9002-b.md', record('ADR-9002', 'B', { guard: '[]' }));
  const r = gen(root, '--check');
  check('a record without guard and one with guard: [] both pass', r.status === 0, `${r.status} ${r.stderr.trim()}`);
  check('no guard warning is printed', !/guard/.test(r.stderr), r.stderr.trim());
});

console.log('\n[accepted/complete/live without a guard]');
repo((root, adr) => {
  put(adr, 'ADR-9001-a.md', record('ADR-9001', 'A', {
    decision_status: 'accepted', implementation_status: 'complete', activation_status: 'live',
    verified_commit: 'abc1234',
  }));
  const r = gen(root, '--check');
  check('no status requires a guard', r.status === 0, `${r.status} ${r.stderr.trim()}`);
});

console.log('\n[missing file]');
repo((root, adr) => {
  put(adr, 'ADR-9001-a.md', record('ADR-9001', 'A', { guard: '[tests/nope.test.js]' }));
  const r = gen(root, '--check');
  check('a guard naming a missing file fails', r.status === 1, `${r.status}`);
  check('the failure names the record and the file',
    /ADR-9001-a\.md: guard 'tests\/nope\.test\.js': tests\/nope\.test\.js does not exist/.test(r.stderr), r.stderr.trim());
});

console.log('\n[path relative to the ADR directory, not the repository root]');
repo((root, adr) => {
  put(adr, 'ADR-9001-a.md', record('ADR-9001', 'A', { guard: '[allowlist.test.js]' }));
  fs.copyFileSync(path.join(root, 'tests/allowlist.test.js'), path.join(adr, 'allowlist.test.js'));
  const r = gen(root, '--check');
  check('a file beside the record does not satisfy a root-relative guard', r.status === 1 && /does not exist/.test(r.stderr), `${r.status} ${r.stderr.trim()}`);
});

console.log('\n[a directory is not a file]');
repo((root, adr) => {
  put(adr, 'ADR-9001-a.md', record('ADR-9001', 'A', { guard: '[tests]' }));
  const r = gen(root, '--check');
  check('a guard naming a directory fails', r.status === 1 && /tests is not a file/.test(r.stderr), `${r.status} ${r.stderr.trim()}`);
});

console.log('\n[missing name]');
repo((root, adr) => {
  put(adr, 'ADR-9001-a.md', record('ADR-9001', 'A', { guard: '[tests/allowlist.test.js#acceptsEverything]' }));
  const r = gen(root, '--check');
  check('a #name absent from the file fails', r.status === 1, `${r.status}`);
  check('the failure names the identifier and the file',
    /'acceptsEverything' does not occur in tests\/allowlist\.test\.js/.test(r.stderr), r.stderr.trim());
});

console.log('\n[malformed entries]');
const MALFORMED = [
  ['a scalar, not a list', 'tests/allowlist.test.js', /'guard' must be a list/],
  ['an empty scalar', '', /'guard' must be a list/],
  ['an empty name', '[tests/allowlist.test.js#]', /empty name after '#'/],
  ['no path', '[#AllowlistGuardTest]', /no path before '#'/],
  ['two #', '[tests/allowlist.test.js#a#b]', /more than one '#'/],
  ['a glob', '[tests/*.test.js]', /glob character/],
  ['an absolute path', '[/etc/passwd]', /is absolute/],
  ['climbing out', '[../outside.test.js]', /climbs out/],
];
for (const [label, value, re] of MALFORMED) {
  repo((root, adr) => {
    put(adr, 'ADR-9001-a.md', record('ADR-9001', 'A', { guard: value }));
    const r = gen(root, '--check');
    check(`${label} fails`, r.status === 1 && re.test(r.stderr), `${r.status} ${r.stderr.trim()}`);
  });
}

console.log('\n[malformed is reported without git too]');
repo((root, adr) => {
  put(adr, 'ADR-9001-a.md', record('ADR-9001', 'A', { guard: '[tests/*.test.js]' }));
  const r = gen(root, '--check');
  check('shape is checked without a repository', r.status === 1 && /glob character/.test(r.stderr), `${r.status} ${r.stderr.trim()}`);
}, { git: false });

console.log('\n[no git repository]');
repo((root, adr) => {
  put(adr, 'ADR-9001-a.md', record('ADR-9001', 'A', { guard: '[tests/nope.test.js]' }));
  const r = gen(root, '--check');
  check('existence is skipped, as staleness is, and the run passes', r.status === 0, `${r.status} ${r.stderr.trim()}`);
  check('the skip is stated', /guard files not resolved: no git repository/.test(r.stderr), r.stderr.trim());
}, { git: false });

console.log('\n[template skeleton]');
repo((root, adr) => {
  put(adr, 'TEMPLATE.md', record('ADR-NNNN', 'Short imperative title', { guard: '' }));
  const r = gen(root, '--check');
  check('the template form is exempt', r.status === 0, `${r.status} ${r.stderr.trim()}`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.log(`  - ${f}`); process.exit(1); }
