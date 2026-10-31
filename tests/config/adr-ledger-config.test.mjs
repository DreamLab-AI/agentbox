#!/usr/bin/env node
// adr-ledger-config.test.mjs — the checker is the estate's ONE ADR gate, consumed
// pinned by other repositories, so its per-ledger configuration is contract:
//   <dir>/.ledger.json  { repo: string | string[], exclude: string[], regenerate: string }
//   --exclude NAME | --exclude=NAME
// These cases pin: no config means exactly the historical behaviour (repo enum
// {visionclaw, agentbox}, README unchanged); a config widens the enum and the
// exclusions; a malformed config is a usage error (exit 2), never a silent default.
//
// Runs the ACTUAL scripts/adr-index-gen.js against temporary directories.
// Run: node tests/config/adr-ledger-config.test.mjs

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
    id, title, date: '2026-10-31', decision_status: 'proposed',
    implementation_status: 'none', activation_status: 'inactive',
    supersedes: '[]', superseded_by: '[]', verified_commit: '""',
    owner: 'fixture', review_trigger: 'fixture only', repo: 'agentbox',
    ...extra,
  };
  const body = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n');
  return `---\n${body}\n---\n\n# ${id} — ${title}\n`;
}

function scratch(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-ledger-cfg-'));
  try { return fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function gen(args) {
  const r = spawnSync(process.execPath, [GEN, ...args], { encoding: 'utf8' });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}
const put = (dir, name, text) => fs.writeFileSync(path.join(dir, name), text);

console.log('ADR ledger config (.ledger.json, --exclude)');

console.log('\n[no config: historical behaviour]');
scratch((dir) => {
  put(dir, 'ADR-9001-a.md', record('ADR-9001', 'A'));
  put(dir, 'ADR-9002-b.md', record('ADR-9002', 'B', { repo: 'ontomark' }));
  const r = gen([dir, '--check']);
  check('a repo outside {visionclaw, agentbox} fails', r.status === 1 && /'repo' = 'ontomark'/.test(r.stderr), `${r.status} ${r.stderr.trim()}`);
  fs.rmSync(path.join(dir, 'ADR-9002-b.md'));
  gen([dir]);
  check('default index carries the default regeneration command',
    fs.readFileSync(path.join(dir, 'README.md'), 'utf8').includes(`\`node scripts/adr-index-gen.js ${dir}\``));
});

console.log('\n[repo as a string]');
scratch((dir) => {
  put(dir, '.ledger.json', JSON.stringify({ repo: 'ontomark' }));
  put(dir, 'ADR-9001-a.md', record('ADR-9001', 'A', { repo: 'ontomark' }));
  check('the configured repo passes', gen([dir, '--check']).status === 0);
  put(dir, 'ADR-9002-b.md', record('ADR-9002', 'B', { repo: 'agentbox' }));
  const r = gen([dir, '--check']);
  check('the default repos are no longer accepted once configured', r.status === 1 && /'repo' = 'agentbox'/.test(r.stderr), `${r.status} ${r.stderr.trim()}`);
});

console.log('\n[repo as an array]');
scratch((dir) => {
  put(dir, '.ledger.json', JSON.stringify({ repo: ['narrativegoldmine', 'DreamLab-AI/knowledgeGraph'] }));
  put(dir, 'ADR-9001-a.md', record('ADR-9001', 'A', { repo: 'narrativegoldmine' }));
  put(dir, 'ADR-9002-b.md', record('ADR-9002', 'B', { repo: 'DreamLab-AI/knowledgeGraph' }));
  check('every listed alias passes', gen([dir, '--check']).status === 0);
  put(dir, 'ADR-9003-c.md', record('ADR-9003', 'C', { repo: 'other' }));
  check('an unlisted value still fails', gen([dir, '--check']).status === 1);
});

console.log('\n[exclude: config and flag]');
scratch((dir) => {
  put(dir, '.ledger.json', JSON.stringify({ repo: 'x', exclude: ['ESTATE-ADRS.md'] }));
  put(dir, 'ADR-9001-a.md', record('ADR-9001', 'A', { repo: 'x' }));
  put(dir, 'ESTATE-ADRS.md', '# Estate pointers\n');
  check('config exclusion passes', gen([dir, '--check']).status === 0);
  put(dir, 'NOTES.md', '# Loose notes\n');
  const bad = gen([dir, '--check']);
  check('a non-excluded file without frontmatter still fails', bad.status === 1 && /NOTES\.md: no YAML frontmatter/.test(bad.stderr), bad.stderr.trim());
  check('--exclude NAME before <dir> is not mistaken for the directory', gen(['--exclude', 'NOTES.md', dir, '--check']).status === 0);
  check('--exclude=NAME form works', gen([dir, '--exclude=NOTES.md', '--check']).status === 0);
  const sub = path.join(dir, 'sub');
  fs.mkdirSync(sub);
  put(sub, 'draft.md', '# draft\n');
  check('--exclude takes a path relative to <dir>', gen([dir, '--exclude', 'NOTES.md', '--exclude', 'sub/draft.md', '--check']).status === 0);
  check('a bare --exclude with no value is a usage error', gen([dir, '--exclude']).status === 2);
});

console.log('\n[index excluded from the generated table, and --check-index]');
scratch((dir) => {
  put(dir, '.ledger.json', JSON.stringify({ repo: 'x', exclude: ['ESTATE-ADRS.md'], regenerate: 'bash scripts/adr-ledger.sh write' }));
  put(dir, 'ADR-9001-a.md', record('ADR-9001', 'A', { repo: 'x' }));
  put(dir, 'ESTATE-ADRS.md', '# Estate pointers\n');
  check('generation succeeds', gen([dir]).status === 0);
  const md = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
  check('the excluded file is not in the index', !/ESTATE-ADRS/.test(md));
  check('the configured regeneration command is printed', md.includes('`bash scripts/adr-ledger.sh write`'));
  check('--check-index passes on the generated index', gen([dir, '--check-index']).status === 0);
  put(dir, 'ADR-9002-b.md', record('ADR-9002', 'B', { repo: 'x' }));
  const stale = gen([dir, '--check-index']);
  check('a stale index fails and names the configured command', stale.status === 1 && /regenerate with: bash scripts\/adr-ledger\.sh write/.test(stale.stderr), stale.stderr.trim());
});

console.log('\n[malformed config is a usage error]');
for (const [label, text] of [
  ['invalid JSON', '{ repo: '],
  ['not an object', '["ontomark"]'],
  ['repo of the wrong type', '{"repo": 7}'],
  ['empty repo list', '{"repo": []}'],
  ['exclude of the wrong type', '{"exclude": "ESTATE-ADRS.md"}'],
  ['unknown key', '{"repos": "x"}'],
]) {
  scratch((dir) => {
    put(dir, '.ledger.json', text);
    put(dir, 'ADR-9001-a.md', record('ADR-9001', 'A'));
    const r = gen([dir, '--check']);
    check(`${label} exits 2`, r.status === 2 && /\.ledger\.json/.test(r.stderr), `${r.status} ${r.stderr.trim()}`);
  });
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) { for (const f of failures) console.error(`  - ${f}`); process.exit(1); }
