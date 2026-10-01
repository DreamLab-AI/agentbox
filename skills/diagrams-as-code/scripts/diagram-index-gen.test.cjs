'use strict';
/**
 * WHAT THIS IS
 *   The behavioural suite for the diagrams-as-code generator (`diagram-index-gen.cjs`).
 *   It builds a throwaway git repository holding a one-topic corpus, commits the cited
 *   source, then changes the working tree so the declared revision and the disk
 *   disagree, and runs the generator as a CLI against it. Run with `node --test`.
 * WHY IT IS THIS WAY
 *   The generator is a script with top-level side effects, so it is tested the way the
 *   corpus leads use it: as a process, reading its console output. A citation checker is
 *   only worth its "0 warnings" if it reads the revision the topic declares and covers
 *   every place a citation can sit — the prose and the register markers as well as the
 *   diagrams — so each rule has a case that fails when the rule is missing.
 * WHAT IT MEANS FOR THE CLIENT
 *   The diagram set that explains your system cites the exact code lines it describes.
 *   This suite proves the checker catches a citation that points at the wrong file, a
 *   blank or missing line, or a file that did not exist at the revision the diagrams
 *   claim to describe, so "verified" on a diagram means someone's tool checked it.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const GEN = path.join(__dirname, 'diagram-index-gen.cjs');
let repo;
let corpus;
let sha;

function git(...args) {
  return execFileSync('git', ['-C', repo, '-c', 'user.email=t@example.invalid', '-c', 'user.name=t', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function write(rel, text) {
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
}
function runAt(dir, ...flags) {
  const r = spawnSync(process.execPath, [GEN, dir, ...flags], { encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}
function run(...flags) { return runAt(corpus, ...flags); }
/** The warning lines, one per diagnostic, without the leading marker. */
function warnings(out) {
  return out.split('\n').filter((l) => l.startsWith('  ! ')).map((l) => l.slice(4));
}
/** 1-based line number in the topic file of the first line containing `needle`. */
function lineOf(needle) {
  const lines = fs.readFileSync(path.join(corpus, 'alpha', '01-topic.md'), 'utf8').split('\n');
  const i = lines.findIndex((l) => l.includes(needle));
  assert.ok(i >= 0, `fixture lacks ${needle}`);
  return i + 1;
}

const TOPIC = (commit) => `---
id: AA-01
title: The fixture topic
area: alpha
governing: [docs/gov.md]
adrs: []
sources:
  - src/a.ts
  - src/b.ts
  - src/new.ts
  - docs/rec.md
  - .lintrc
verified_commit: ${commit}
---

## For developers

Good prose citation \`src/a.ts:2\` (CLEAN-PROSE).
Not in sources: \`src/other.ts:1\` (NOT-IN-SOURCES).
Past the end: \`src/a.ts:99\` (PAST-EOF).
Blank at the revision but not on disk: \`src/a.ts:3\` (BLANK-AT-SHA).
Backwards range \`src/a.ts:5-4\` (BACKWARDS).
A qualified bare citation \`src/a.ts:1\` and then \`:9\` (BARE-QUALIFIED-EOF).

A bare citation with nothing before it in its paragraph: \`:2\` (BARE-UNQUALIFIED).

The file \`src/a.ts\` named without a line
qualifies a later \`:97\` in its paragraph (BARE-AFTER-PATH).

\`src/a.ts:1\` grants the path \`tenant/lib/data.ts\`, while \`:2\` resolves (DATA-PATH).

A range split over two code spans: \`src/b.ts:1\`-\`9\` (TICK-RANGE-EOF).
Written backwards: \`src/b.ts:3\`-\`1\` (TICK-RANGE-BACK).
A range ending on its closing brace: \`src/b.ts:1\`-\`3\` (TICK-RANGE-BRACE).
The worded form: \`src/b.ts:1\` to \`src/b.ts:3\` (TO-RANGE-BRACE).
Worded and backwards: \`src/b.ts:4\` to \`src/b.ts:2\` (TO-RANGE-BACK).

A worded range wraps a line: \`src/b.ts:1\` to
\`src/b.ts:3\` ends on its brace (WRAP-RANGE-BRACE), and \`src/b.ts:4\`
to \`src/b.ts:2\` wraps backwards (WRAP-RANGE-BACK).
A wrapped range from a blank line, \`src/b.ts:5\` to
\`src/b.ts:5\`, reports the start once (WRAP-RANGE-ONCE).

In \`src/b.ts\` a bare split range \`:1\`-\`7\` (BARE-RANGE-EOF)
and one ending on the brace \`:1\`-\`:3\` (BARE-RANGE-BRACE).

| row | cite |
|---|---|
| one | \`src/b.ts:1\` |
| two | \`:9\` (TABLE-ROW-BARE) |

- \`src/b.ts:1\` is the first item
- the second item cites \`:8\` (LIST-ITEM-BARE)

1. \`src/b.ts:1\` is the first step
2. the second step cites \`:6\` (NUMBERED-ITEM-BARE)

- \`src/b.ts:1\` begins an item
  that continues with \`:2\` (LIST-CONTINUATION)

A root dotfile is a path: \`.lintrc:9\` (DOTFILE-EOF).
After \`src/b.ts:1\`, \`.lintrc:1\`-\`2\` owns the bare \`:1\`-\`8\` that follows (DOTFILE-BARE).

The lead-in names \`src/b.ts\` for the list below:
- the item cites \`:2\` (LIST-LEAD-IN)

## For the business

A file that is not at the revision: \`src/new.ts:40\` (MISSING-AT-SHA).

## AA-01.1 The diagram

\`\`\`mermaid
flowchart LR
  A["src/a.ts:1"] --> B["src/new.ts:1"]
  B --> C["src/a.ts:4-2"]
  C --> D[".lintrc:7"]
\`\`\`

**Why it is this way.** The paragraph under the diagram cites \`src/a.ts:3\` too (UNDER-DIAGRAM).

**Tension:** a register marker citing \`src/a.ts:98\` (MARKER-EOF).

**Debt:** a debt item.

**Drift:** a record only on disk: \`docs/rec.md:1\` (DOCS-FALLBACK) and \`docs/rec.md:50\` (DOCS-EOF).

**Open:** an open question.

**Invariant:** an invariant.
`;

before(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-gen-'));
  corpus = path.join(repo, 'docs', 'diagrams');
  git('init', '-q');
  // At the revision: line 3 is blank, the file has five lines plus the final newline.
  write('src/a.ts', 'export const one = 1;\nexport const two = 2;\n\nexport const four = 4;\nexport const five = 5;\n');
  write('src/b.ts', 'export function f() {\n  return 1;\n}\nexport const g = 2;\n');
  write('docs/gov.md', '# governing\n');
  write('.lintrc', 'one\ntwo\nthree\n');
  git('add', '.');
  git('commit', '-q', '-m', 'fixture');
  sha = git('rev-parse', 'HEAD');
  // After the revision: line 3 gains text and a sixth line appears, so a checker that
  // reads the working tree instead of the revision passes cases it should flag.
  write('src/a.ts', 'export const one = 1;\nexport const two = 2;\nexport const three = 3;\nexport const four = 4;\nexport const five = 5;\nexport const six = 6;\n');
  write('src/new.ts', 'export const added = true;\n');
  write('docs/rec.md', '# a record\n');
  write('docs/diagrams/alpha/01-topic.md', TOPIC(sha));
  // A second corpus stamped at a commit this clone does not hold (a shallow CI checkout).
  write('alt/diagrams/alpha/01-topic.md', TOPIC('1234567'));
});
after(() => { fs.rmSync(repo, { recursive: true, force: true }); });

test('a prose citation to a file outside sources: is flagged, with its file line', () => {
  const w = warnings(run('--check', '--cite-check').out);
  const hit = w.find((x) => x.includes('src/other.ts:1'));
  assert.ok(hit, w.join('\n'));
  assert.match(hit, /not in this topic's sources/);
  assert.match(hit, new RegExp(`\\(line ${lineOf('NOT-IN-SOURCES')}\\)`));
});

test('a prose citation past EOF at verified_commit is flagged', () => {
  const w = warnings(run('--check', '--cite-check').out);
  assert.ok(w.some((x) => /src\/a\.ts:99 past EOF/.test(x)), w.join('\n'));
});

test('a prose citation is read at verified_commit, not the working tree', () => {
  const w = warnings(run('--check', '--cite-check').out);
  const blank = w.filter((x) => /src\/a\.ts:3 is blank/.test(x));
  // once in the narrative, once in the paragraph under the diagram
  assert.equal(blank.length, 2, w.join('\n'));
  assert.ok(blank.some((x) => x.includes(`(line ${lineOf('UNDER-DIAGRAM')})`)), w.join('\n'));
  assert.ok(blank.some((x) => x.startsWith('alpha/01-topic.md:AA-01.1')), 'the under-diagram warning names its diagram');
});

test('a register-marker citation is checked', () => {
  const w = warnings(run('--check', '--cite-check').out);
  assert.ok(w.some((x) => /src\/a\.ts:98 past EOF/.test(x) && x.includes(`(line ${lineOf('MARKER-EOF')})`)), w.join('\n'));
});

test('a backwards range is flagged in prose and in a diagram', () => {
  const w = warnings(run('--check', '--cite-check').out);
  assert.ok(w.some((x) => /src\/a\.ts:5-4 is a backwards range/.test(x)), w.join('\n'));
  assert.ok(w.some((x) => /src\/a\.ts:4-2 is a backwards range/.test(x) && x.startsWith('alpha/01-topic.md:AA-01.1 -')), w.join('\n'));
});

test('a bare `:N` resolves to the last path in its paragraph, and is flagged without one', () => {
  const w = warnings(run('--check', '--cite-check').out);
  assert.ok(w.some((x) => /src\/a\.ts:9 past EOF/.test(x)), w.join('\n'));
  const lone = w.find((x) => x.includes(`(line ${lineOf('BARE-UNQUALIFIED')})`));
  assert.ok(lone, w.join('\n'));
  assert.match(lone, /bare citation has no path before it/);
});

test('a path named without a line qualifies a bare `:N` later in its paragraph', () => {
  const w = warnings(run('--check', '--cite-check').out);
  const at = `(line ${lineOf('BARE-AFTER-PATH')})`;
  assert.ok(w.some((x) => x.includes(at) && /src\/a\.ts:97 past EOF/.test(x)), w.join('\n'));
  assert.ok(!w.some((x) => x.includes(at) && /bare citation/.test(x)), w.join('\n'));
});

test('a path mentioned as data (not a source) does not capture a later bare `:N`', () => {
  const w = warnings(run('--check', '--cite-check').out);
  assert.ok(!w.some((x) => x.includes(`(line ${lineOf('DATA-PATH')})`)), w.join('\n'));
});

test('a source file absent at verified_commit is a warning and is not line-checked', () => {
  const w = warnings(run('--check', '--cite-check').out);
  const missing = w.filter((x) => x.includes('src/new.ts') && /not present at verified_commit/.test(x));
  assert.equal(missing.length, 1, `one warning per topic and path:\n${w.join('\n')}`);
  assert.ok(!w.some((x) => /src\/new\.ts:40 past EOF/.test(x)), 'no silent fallback to the working tree for system code');
});

test('a docs/ record absent at verified_commit warns, then falls back to the working tree', () => {
  const w = warnings(run('--check', '--cite-check').out);
  assert.ok(w.some((x) => x.includes('docs/rec.md') && /not present at verified_commit.*working tree/.test(x)), w.join('\n'));
  assert.ok(w.some((x) => /docs\/rec\.md:50 past EOF/.test(x)), w.join('\n'));
  assert.ok(!w.some((x) => /docs\/rec\.md:1 /.test(x)), 'line 1 exists in the working tree');
});

test('a correct citation raises nothing', () => {
  const w = warnings(run('--check', '--cite-check').out);
  assert.ok(!w.some((x) => x.includes('src/a.ts:2 ')), w.join('\n'));
  assert.ok(!w.some((x) => x.includes(`(line ${lineOf('CLEAN-PROSE')})`)), w.join('\n'));
});

test('--strict-citations fails the run on a prose-only warning', () => {
  const r = run('--check', '--strict-citations');
  assert.equal(r.code, 1);
  assert.match(r.out, /citation: alpha\/01-topic\.md.*src\/other\.ts:1/);
});

test('register ids use distinct prefixes per kind (Debt and Drift no longer collide)', () => {
  const r = run();
  assert.equal(r.code, 0, r.out);
  const reg = fs.readFileSync(path.join(corpus, 'REGISTER.md'), 'utf8');
  for (const id of ['T-01', 'DB-01', 'DR-01', 'O-01', 'I-01']) assert.match(reg, new RegExp(`^\\| ${id} \\|`, 'm'), id);
  assert.doesNotMatch(reg, /^\| D-\d+ \|/m);
});

/** The warnings raised on the topic-file line tagged `tag`. */
function at(w, tag) { const l = `(line ${lineOf(tag)})`; return w.filter((x) => x.includes(l)); }

test('a range split over two code spans is one range: its end is EOF- and backwards-checked', () => {
  const w = warnings(run('--check', '--cite-check').out);
  assert.ok(at(w, 'TICK-RANGE-EOF').some((x) => /src\/b\.ts:9 past EOF/.test(x)), w.join('\n'));
  assert.ok(at(w, 'TICK-RANGE-BACK').some((x) => /src\/b\.ts:3-1 is a backwards range/.test(x)), w.join('\n'));
  assert.ok(at(w, 'BARE-RANGE-EOF').some((x) => /src\/b\.ts:7 past EOF/.test(x)), w.join('\n'));
});

test('a worded range `P:a` to `P:b` is one range: backwards is flagged, the end is not a point', () => {
  const w = warnings(run('--check', '--cite-check').out);
  assert.ok(at(w, 'TO-RANGE-BACK').some((x) => /src\/b\.ts:4-2 is a backwards range/.test(x)), w.join('\n'));
});

test('a range that ends on its closing brace is not flagged as punctuation', () => {
  const w = warnings(run('--check', '--cite-check').out);
  for (const tag of ['TO-RANGE-BRACE', 'TICK-RANGE-BRACE', 'BARE-RANGE-BRACE']) assert.deepEqual(at(w, tag), [], tag);
});

test('a bare `:N` does not inherit a path across table rows or list items', () => {
  const w = warnings(run('--check', '--cite-check').out);
  for (const tag of ['TABLE-ROW-BARE', 'LIST-ITEM-BARE', 'NUMBERED-ITEM-BARE']) {
    const hit = at(w, tag);
    assert.equal(hit.length, 1, `${tag}:\n${w.join('\n')}`);
    assert.match(hit[0], /bare citation has no path before it/, tag);
  }
});

test('a list item keeps its own path on a continuation line, and a lead-in path covers its list', () => {
  const w = warnings(run('--check', '--cite-check').out);
  assert.deepEqual(at(w, 'LIST-CONTINUATION'), []);
  assert.deepEqual(at(w, 'LIST-LEAD-IN'), []);
});

test('a verified_commit the clone does not hold is one distinct warning per topic, not one per file', () => {
  const w = warnings(runAt(path.join(repo, 'alt', 'diagrams'), '--check', '--cite-check').out);
  const miss = w.filter((x) => /verified_commit 1234567 is not in this clone/.test(x));
  assert.equal(miss.length, 1, w.join('\n'));
  assert.ok(!w.some((x) => /is not present at verified_commit/.test(x)), w.join('\n'));
  assert.ok(!w.some((x) => /past EOF|is blank|punctuation/.test(x)), 'nothing is line-checked without the commit');
});

test('a root dotfile (`.gitignore`, `.dockerignore`) is a citation in prose and in a diagram', () => {
  const w = warnings(run('--check', '--cite-check').out);
  assert.ok(at(w, 'DOTFILE-EOF').some((x) => /\.lintrc:9 past EOF/.test(x)), w.join('\n'));
  const bare = at(w, 'DOTFILE-BARE');
  assert.ok(bare.some((x) => /\.lintrc:8 past EOF/.test(x)), w.join('\n'));
  assert.ok(!bare.some((x) => /src\/b\.ts:8/.test(x)), 'the bare range resolves to the dotfile, not the path before it');
  assert.ok(w.some((x) => x.startsWith('alpha/01-topic.md:AA-01.1 -') && /\.lintrc:7 past EOF/.test(x)), w.join('\n'));
});

test('a worded range that wraps a line is one range', () => {
  const w = warnings(run('--check', '--cite-check').out);
  assert.deepEqual(at(w, 'WRAP-RANGE-BRACE').filter((x) => /src\/b\.ts:3 /.test(x)), [], w.join('\n'));
  assert.ok(at(w, 'WRAP-RANGE-BACK').some((x) => /src\/b\.ts:4-2 is a backwards range/.test(x)), w.join('\n'));
  assert.equal(w.filter((x) => /src\/b\.ts:5 is blank/.test(x)).length, 1, w.join('\n'));
});
