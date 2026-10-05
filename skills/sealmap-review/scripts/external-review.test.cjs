'use strict';
/**
 * WHAT THIS IS
 *   The offline suite for external-review.cjs: which files are packed, what register
 *   stripping removes and keeps, how lens prompts load, how findings are parsed out of a
 *   review, and that a dry run writes a pack without touching the network. Run with
 *   `node --test`.
 * WHY IT IS THIS WAY
 *   The model call itself is not testable offline and not deterministic; everything around
 *   it is. A pack that silently drops a topic, or a strip that leaves the authors' Tension
 *   paragraphs in, would make a "blind" review read the answers.
 * WHAT IT MEANS FOR THE CLIENT
 *   When the outside reviewer is said to have seen the whole map, or to have worked without
 *   the authors' own list of known problems, this suite is what makes that statement true.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const R = require('./external-review.cjs');

function corpus() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dac-review-'));
  const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
  put('README.md', '# root readme\n');
  put('REGISTER.md', '# register\n');
  put('control-plane/01-boot.md', [
    '# CP-01 Boot', '',
    'The server boots in order.', '',
    '**Tension (header vs code):** the header says X, the code does Y.', '',
    '**Invariant:** boot refuses an unknown slot.', '',
    '```mermaid', 'flowchart TB', '  A --> B', '  B --- N["TENSION: unkeyed chain"]', '  B --- M["INVARIANT: fail closed"]', '```', '',
  ].join('\n'));
  put('control-plane/README.md', '# area readme\n');
  put('enclosure/02-compose.md', '# EN-02 Compose\n\n**Debt:** two inventories by hand.\n\nKept prose.\n');
  put('rendered/control-plane/01-boot/x.md', 'should be skipped\n');
  put('legacy/09-old.md', 'skipped by config\n');
  return dir;
}

test('packs only area topic files, sorted, honouring default and configured skip dirs', () => {
  const dir = corpus();
  assert.deepEqual(R.listTopics(dir), ['control-plane/01-boot.md', 'enclosure/02-compose.md', 'legacy/09-old.md']);
  assert.deepEqual(R.listTopics(dir, { skipDirs: ['legacy'] }), ['control-plane/01-boot.md', 'enclosure/02-compose.md']);
  assert.deepEqual(R.listTopics(dir, { only: 'enclosure/', skipDirs: ['legacy'] }), ['enclosure/02-compose.md']);
});

test('strip removes Tension/Debt paragraphs and marker lines but keeps invariants and prose', () => {
  const dir = corpus();
  const full = R.buildPack(dir, ['control-plane/01-boot.md', 'enclosure/02-compose.md']);
  const blind = R.buildPack(dir, ['control-plane/01-boot.md', 'enclosure/02-compose.md'], { register: 'strip' });
  assert.match(full, /\*\*Tension \(header vs code\):\*\*/);
  assert.doesNotMatch(blind, /Tension|TENSION|Debt/);
  assert.match(blind, /\*\*Invariant:\*\* boot refuses/);
  assert.match(blind, /INVARIANT: fail closed/);
  assert.match(blind, /A --> B/);
  assert.match(blind, /Kept prose\./);
  assert.match(blind, /=== FILE: enclosure\/02-compose\.md ===/);
});

test('both shipped lenses load and substitute the finding count', () => {
  for (const lens of ['critical', 'premortem']) {
    const text = R.loadLens(lens, 7);
    assert.doesNotMatch(text, /\{\{COUNT\}\}/);
    assert.match(text, /\b7\b/);
    assert.match(text, /### F-01/);
  }
  assert.throws(() => R.loadLens('flattering', 5), /unknown lens 'flattering'/);
});

test('findings and root causes are parsed with their fields and marked unverified', () => {
  const review = [
    '### R-1 — Audit copy lost on restart',
    '- Topics: CP-03.2',
    '- Chain of events: queue in memory, restart, gap',
    '- Confidence: high',
    '',
    '### F-01 – Shared network bypasses header strip',
    '- Topics: EN-02.2, ES-03.1',
    '- Evidence: compose.pod.yaml:1066 puts every tenant on pod-net',
    '- Failure: tenant code calls a sibling on port 3000',
    '- Confidence: medium (inferred)',
    '- Marked by authors: no',
    '',
    '## Not judgeable from this material',
    '1. kernel hardening',
  ].join('\n');
  const f = R.parseFindings(review, 'premortem');
  assert.equal(f.length, 2);
  assert.deepEqual(f.map((x) => [x.id, x.kind]), [['premortem:R-1', 'root-cause'], ['premortem:F-01', 'finding']]);
  assert.equal(f[0].failure, 'queue in memory, restart, gap');
  assert.equal(f[1].marked_by_authors, 'no');
  assert.equal(f[1].topics, 'EN-02.2, ES-03.1');
  assert.ok(f.every((x) => x.status === 'unverified'));
  assert.ok(!f[1].evidence.includes('kernel'), 'trailing section must not leak into the last finding');
});

test('argument errors are usage errors', () => {
  assert.throws(() => R.parseArgs([]), /exactly one corpus/);
  assert.throws(() => R.parseArgs(['d', '--register', 'maybe']), /include or strip/);
  assert.throws(() => R.parseArgs(['d', '--count', '0']), /positive integer/);
  assert.throws(() => R.parseArgs(['d', '--frobnicate']), /unknown option/);
  assert.deepEqual(R.parseArgs(['d', '--lens', 'critical']).lens, ['critical']);
});

test('dry run writes the pack and manifest and needs no key', () => {
  const dir = corpus();
  fs.writeFileSync(path.join(dir, 'diagrams.config.json'), JSON.stringify({ skipDirs: ['legacy'] }));
  const out = path.join(dir, '.out');
  const env = { ...process.env };
  delete env.GEMINI_API_KEY; delete env.GOOGLE_GEMINI_API_KEY;
  const r = spawnSync(process.execPath, [path.join(__dirname, 'external-review.cjs'), dir, '--register', 'strip', '--out', out, '--dry-run'], { encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.equal(manifest.topics, 2);
  assert.equal(manifest.register, 'strip');
  assert.match(manifest.pack_sha256, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(fs.readFileSync(path.join(out, 'pack.txt'), 'utf8'), /Tension/);
});

test('a live run without a key fails with a clear message, after packing', () => {
  const dir = corpus();
  const env = { ...process.env };
  delete env.GEMINI_API_KEY; delete env.GOOGLE_GEMINI_API_KEY;
  const r = spawnSync(process.execPath, [path.join(__dirname, 'external-review.cjs'), dir, '--out', path.join(dir, '.o')], { encoding: 'utf8', env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /set GEMINI_API_KEY/);
});
