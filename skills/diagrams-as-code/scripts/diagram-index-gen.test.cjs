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

test('--render renders with the vendored Pele, writes a flattened SVG and never calls mmdc', () => {
  const r = run('--check', '--render');
  assert.ok(!/mmdc/.test(r.out), r.out);
  assert.match(r.out, /rendered 1\/1 diagrams via Pele/, r.out);
  const svg = fs.readFileSync(path.join(corpus, 'rendered', 'alpha', '01-topic', 'AA-01.1.svg'), 'utf8');
  assert.match(svg, /^<svg\b/);
  assert.ok(!svg.includes('var(--'), 'every Pele CSS variable is flattened');
});

test('--render reports a Pele parse error with the topic, diagram and md line', () => {
  const bad = path.join(repo, 'bad', 'diagrams');
  write('bad/diagrams/alpha/01-topic.md', TOPIC(sha).replace('flowchart LR', 'sequenceDiagram\n  A->>B: one; two\nflowchart LR'));
  const r = runAt(bad, '--check', '--render');
  assert.notEqual(r.code, 0, r.out);
  assert.match(r.out, /alpha\/01-topic\.md:AA-01\.1 \(md line \d+\) - pele syntax at mermaid line/);
});

// ---------------------------------------------------------------------------
// Repair convention (successor-only), the RESOLVED ratchet, panel-ID aliases,
// frozen-panel citation revisions and the size cap. Each rule is driven through
// the CLI against a throwaway corpus, passing and failing. The block scope keeps
// these helpers apart from the citation fixture above.
// ---------------------------------------------------------------------------
{
  const SHA = 'abc1234';
let base;
let n = 0;

before(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'alpha-diagram-convention-')); });
after(() => { fs.rmSync(base, { recursive: true, force: true }); });

const DIAGRAM = '```mermaid\nflowchart TB\n    A["Source"] --> B["Evidence"]\n```\n';

/** A panel: heading, optional lines straight under it, then a diagram. */
function panel(id, { title = 'Panel', under = [], body = '' } = {}) {
  return `## ${id} ${title}\n${under.map((l) => l + '\n').join('')}${DIAGRAM}${body ? body + '\n' : ''}`;
}
/** A topic file. `aliases` is a string of raw frontmatter lines, `panels` an array of panel texts. */
function topic(id, panels, { aliases = '', extra = '' } = {}) {
  return `---\nid: ${id}\ntitle: Test ${id}\narea: alpha\ngoverning: []\nadrs: []\nsources: []\nverified_commit: ${SHA}\n${aliases}---\n${extra}## For developers\nHow it works.\n\n## For the business\nWhat it means.\n\n${panels.join('')}`;
}
/** Build a corpus under a fresh root; files maps `alpha/01-x.md` to text. Returns the diagrams dir. */
function corpus(files, baseline) {
  const root = path.join(base, `c${++n}`, 'docs/diagrams');
  for (const [rel, text] of Object.entries(files)) {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
  if (baseline) fs.writeFileSync(path.join(root, 'resolved-ratchet.json'), JSON.stringify({ panels: baseline }));
  return root;
}
function run(root, ...flags) {
  const r = spawnSync(process.execPath, [GEN, root, '--check', '--no-source-paths', ...flags], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr };
}
function report(root, ...flags) {
  const file = path.join(root, '..', 'report.json');
  const r = run(root, '--report', file, ...flags);
  return { ...r, json: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null };
}
const ok = (r, msg) => assert.equal(r.status, 0, `${msg || 'expected a pass'}\n${r.out}`);
const bad = (r, re, msg) => { assert.equal(r.status, 1, `${msg || 'expected a failure'}\n${r.out}`); assert.match(r.out, re); };

// ------------------------------------------------------------------ baseline behaviour

test('a corpus with no RESOLVED marker and no baseline file passes', () => {
  ok(run(corpus({ 'alpha/01-a.md': topic('AA-01', [panel('AA-01.1')]) })));
});

test('(a) RESOLVED in an unlisted panel fails, naming the panel', () => {
  const r = run(corpus({ 'alpha/01-a.md': topic('AA-01', [panel('AA-01.1'), panel('AA-01.2', { body: 'RESOLVED at abc1234: fixed.' })]) }));
  bad(r, /AA-01\.2:\d+ — RESOLVED marker/);
  assert.doesNotMatch(r.out, /AA-01\.1:\d+ — RESOLVED/);
});

test('(a) every form found in the corpus counts: in a node label, a Note, a heading', () => {
  const label = '```mermaid\nflowchart TB\n    A["RESOLVED at forum 6064622: now sends the header"]\n```\n';
  const note = '```mermaid\nsequenceDiagram\n    Note over A,B: RESOLVED ADR-2053: try_send result\n```\n';
  const files = { 'alpha/01-a.md': topic('AA-01', [`## AA-01.1 Label\n${label}`, `## AA-01.2 Note\n${note}`, panel('AA-01.3', { title: 'RESOLVED ADR-2045 - removed' }), panel('AA-01.4', { body: '**Debt:** RESOLVED at x abc1234' })]) };
  const r = run(corpus(files));
  bad(r, /AA-01\.1:/);
  for (const id of ['AA-01.2', 'AA-01.3', 'AA-01.4']) assert.match(r.out, new RegExp(`${id.replace('.', '\\.')}:\\d+ — RESOLVED marker`));
});

test('lowercase "resolved" and RESOLVED outside a panel are not markers', () => {
  const files = { 'alpha/01-a.md': topic('AA-01', [panel('AA-01.1', { body: 'The name is resolved at boot; resolved N times.' })], { extra: '## Audit notes\nRESOLVED in an audit paragraph, not a panel.\n' }) };
  ok(run(corpus(files)));
});

test('(a) a listed panel passes', () => {
  const root = corpus({ 'alpha/01-a.md': topic('AA-01', [panel('AA-01.1', { body: 'RESOLVED at abc1234' })]) }, ['AA-01.1']);
  ok(run(root));
});

test('ratchet growth: a new RESOLVED panel fails even when the baseline exists and passes today', () => {
  const root = corpus({ 'alpha/01-a.md': topic('AA-01', [panel('AA-01.1', { body: 'RESOLVED at abc1234' }), panel('AA-01.2')]) }, ['AA-01.1']);
  ok(run(root));
  fs.appendFileSync(path.join(root, 'alpha/01-a.md'), panel('AA-01.3', { body: 'RESOLVED at abc1234' }));
  bad(run(root), /AA-01\.3:\d+ — RESOLVED marker/);
});

test('ratchet staleness: an entry for a panel that no longer exists fails', () => {
  const root = corpus({ 'alpha/01-a.md': topic('AA-01', [panel('AA-01.1')]) }, ['AA-01.9']);
  bad(run(root), /resolved-ratchet\.json: stale entry — AA-01\.9 no longer exists/);
});

test('ratchet staleness: an entry whose panel no longer carries RESOLVED fails', () => {
  const root = corpus({ 'alpha/01-a.md': topic('AA-01', [panel('AA-01.1', { body: 'RESOLVED at abc1234' })]) }, ['AA-01.1']);
  ok(run(root));
  fs.writeFileSync(path.join(root, 'alpha/01-a.md'), topic('AA-01', [panel('AA-01.1')]));
  bad(run(root), /stale entry — AA-01\.1 no longer carries a RESOLVED marker/);
});

test('ratchet staleness: an entry for a renumbered panel says where it went', () => {
  const files = {
    'alpha/01-a.md': topic('AA-01', [panel('AA-01.1')]),
    'alpha/02-b.md': topic('AA-02', [panel('AA-02.1', { body: 'RESOLVED at abc1234' })], { aliases: 'aliases:\n  AA-01.5: AA-02.1\n' }),
  };
  bad(run(corpus(files, ['AA-01.5'])), /stale entry — AA-01\.5 no longer exists; it was renumbered to AA-02\.1/);
});

test('a malformed baseline is an error, not an empty one', () => {
  const root = corpus({ 'alpha/01-a.md': topic('AA-01', [panel('AA-01.1')]) });
  fs.writeFileSync(path.join(root, 'resolved-ratchet.json'), '{"panels": ["nope", "AA-01.1", "AA-01.1"]}');
  const r = run(root);
  bad(r, /'nope' is not a panel ID/);
  assert.match(r.out, /duplicate entry AA-01\.1/);
});

test('--update-resolved-baseline creates the file once, then only ever prunes', () => {
  const root = corpus({ 'alpha/01-a.md': topic('AA-01', [panel('AA-01.1', { body: 'RESOLVED at abc1234' }), panel('AA-01.2', { body: 'RESOLVED at abc1234' })]) });
  ok(run(root, '--update-resolved-baseline'));
  const read = () => JSON.parse(fs.readFileSync(path.join(root, 'resolved-ratchet.json'), 'utf8')).panels;
  assert.deepEqual(read(), ['AA-01.1', 'AA-01.2']);
  // a panel that newly carries RESOLVED is never added; the gate still fails on it
  fs.appendFileSync(path.join(root, 'alpha/01-a.md'), panel('AA-01.3', { body: 'RESOLVED at abc1234' }));
  bad(run(root, '--update-resolved-baseline'), /AA-01\.3:\d+ — RESOLVED marker/);
  assert.deepEqual(read(), ['AA-01.1', 'AA-01.2']);
  // clearing a marker lets the update prune it
  fs.writeFileSync(path.join(root, 'alpha/01-a.md'), topic('AA-01', [panel('AA-01.1', { body: 'RESOLVED at abc1234' }), panel('AA-01.2')]));
  ok(run(root, '--update-resolved-baseline'));
  assert.deepEqual(read(), ['AA-01.1']);
});

// ------------------------------------------------------------------ banners

const banner = (to, sha = SHA) => `> **Superseded** by ${to} at ${sha}.`;

test('(b) a banner naming an existing panel passes and the panel is reported frozen', () => {
  const root = corpus({ 'alpha/01-a.md': topic('AA-01', [panel('AA-01.1', { under: ['', banner('AA-01.2')] }), panel('AA-01.2')]) });
  const r = report(root);
  ok(r);
  assert.deepEqual(r.json.convention.frozen.map((f) => [f.panel, f.successor, f.sha]), [['AA-01.1', 'AA-01.2', SHA]]);
});

test('(b) a banner naming no panel and no alias fails', () => {
  bad(run(corpus({ 'alpha/01-a.md': topic('AA-01', [panel('AA-01.1', { under: [banner('AA-01.7')] })]) })), /AA-01\.1:\d+ — Superseded banner names AA-01\.7, which is neither a panel nor a resolvable alias/);
});

test('(b) a banner naming an aliased old ID resolves through the alias', () => {
  const files = {
    'alpha/01-a.md': topic('AA-01', [panel('AA-01.1', { under: [banner('AA-01.5')] })]),
    'alpha/02-b.md': topic('AA-02', [panel('AA-02.1')], { aliases: 'aliases:\n  AA-01.5: AA-02.1\n' }),
  };
  const r = report(corpus(files));
  ok(r);
  const [f] = r.json.convention.frozen;
  assert.deepEqual([f.declared, f.via, f.successor, f.current], ['AA-01.5', 'AA-01.5', 'AA-02.1', 'AA-02.1']);
});

test('(b) a malformed banner fails: no bold, wrong sha, missing full stop, uppercase sha', () => {
  for (const line of ['> Superseded by AA-01.2 at abc1234.', `> **Superseded** by AA-01.2 at ${SHA}`, '> **Superseded** by AA-01.2 at xyz', '> **Superseded** by AA-01.2 at ABC1234.', '> **Superseded** by AA-01.2 at abc12.']) {
    const root = corpus({ 'alpha/01-a.md': topic('AA-01', [panel('AA-01.1', { under: [line] }), panel('AA-01.2')]) });
    bad(run(root), /malformed Superseded banner/, line);
  }
});

test('(b) a banner that is not directly under the heading fails', () => {
  const root = corpus({ 'alpha/01-a.md': topic('AA-01', [panel('AA-01.1', { body: banner('AA-01.2') }), panel('AA-01.2')]) });
  bad(run(root), /a Superseded line must sit directly under the panel heading/);
  const second = corpus({ 'alpha/01-a.md': topic('AA-01', [panel('AA-01.1', { under: ['Some prose first.', banner('AA-01.2')] }), panel('AA-01.2')]) });
  bad(run(second), /must sit directly under the panel heading/);
});

test('a panel cannot supersede itself, and a supersession cycle fails', () => {
  bad(run(corpus({ 'alpha/01-a.md': topic('AA-01', [panel('AA-01.1', { under: [banner('AA-01.1')] })]) })), /cannot be superseded by itself/);
  const cyc = corpus({ 'alpha/01-a.md': topic('AA-01', [panel('AA-01.1', { under: [banner('AA-01.2')] }), panel('AA-01.2', { under: [banner('AA-01.1')] })]) });
  bad(run(cyc), /supersession cycle/);
});

test('(c) a frozen panel carrying RESOLVED fails, baselined or not; clearing it then leaves a stale entry', () => {
  const frozenResolved = topic('AA-01', [panel('AA-01.1', { under: [banner('AA-01.2')], body: 'RESOLVED at abc1234' }), panel('AA-01.2')]);
  bad(run(corpus({ 'alpha/01-a.md': frozenResolved })), /AA-01\.1:\d+ — a frozen panel may not carry a RESOLVED marker/);
  const baselined = corpus({ 'alpha/01-a.md': frozenResolved }, ['AA-01.1']);
  bad(run(baselined), /a frozen panel may not carry a RESOLVED marker/);
  // the marker removed: the panel is clean but the baseline entry is now unneeded
  fs.writeFileSync(path.join(baselined, 'alpha/01-a.md'), topic('AA-01', [panel('AA-01.1', { under: [banner('AA-01.2')] }), panel('AA-01.2')]));
  bad(run(baselined), /stale entry — AA-01\.1 is frozen and no longer needs it/);
  fs.writeFileSync(path.join(baselined, 'resolved-ratchet.json'), '{"panels": []}');
  ok(run(baselined));
});

// ------------------------------------------------------------------ aliases

const withAlias = (aliases, extraFiles = {}) => corpus({
  'alpha/01-a.md': topic('AA-01', [panel('AA-01.1')]),
  'alpha/02-b.md': topic('AA-02', [panel('AA-02.1'), panel('AA-02.2')], { aliases }),
  ...extraFiles,
});

test('aliases: block and inline forms both parse and are reported', () => {
  const block = report(withAlias('aliases:\n  AA-01.9: AA-02.1   # moved in the split\n  AA-01.8: AA-02.2\n'));
  ok(block);
  assert.deepEqual(block.json.convention.aliases.map((a) => [a.from, a.to, a.topic]), [['AA-01.8', 'AA-02.2', 'AA-02'], ['AA-01.9', 'AA-02.1', 'AA-02']]);
  const inline = report(withAlias('aliases: {AA-01.9: AA-02.1, AA-01.8: AA-02.2}\n'));
  ok(inline);
  assert.equal(inline.json.convention.aliases.length, 2);
});

test('aliases: an empty map and an absent key are fine', () => {
  ok(run(withAlias('aliases:\n')));
  ok(run(withAlias('')));
});

test('aliases: a target that does not exist fails', () => {
  bad(run(withAlias('aliases:\n  AA-01.9: AA-02.7\n')), /alias AA-01\.9: AA-02\.7 — target panel AA-02\.7 does not exist/);
});

test('aliases: a source that is also a live panel fails', () => {
  bad(run(withAlias('aliases:\n  AA-01.1: AA-02.1\n')), /alias source AA-01\.1 is also a live panel ID/);
});

test('aliases: a chain fails and names the straight target', () => {
  bad(run(withAlias('aliases:\n  AA-01.9: AA-01.8\n  AA-01.8: AA-02.1\n')), /alias AA-01\.9: AA-01\.8 chains \(AA-01\.8 is itself aliased to AA-02\.1\); point AA-01\.9 straight at AA-02\.1/);
});

test('aliases: loops fail, including a self loop', () => {
  bad(run(withAlias('aliases:\n  AA-01.9: AA-01.8\n  AA-01.8: AA-01.9\n')), /loops \(/);
  bad(run(withAlias('aliases:\n  AA-01.9: AA-01.9\n')), /loops onto itself/);
});

test('aliases: two topics aliasing the same old ID fails', () => {
  const files = {
    'alpha/01-a.md': topic('AA-01', [panel('AA-01.1')]),
    'alpha/02-b.md': topic('AA-02', [panel('AA-02.1')], { aliases: 'aliases:\n  AA-01.9: AA-02.1\n' }),
    'alpha/03-c.md': topic('AA-03', [panel('AA-03.1')], { aliases: 'aliases:\n  AA-01.9: AA-03.1\n' }),
  };
  bad(run(corpus(files)), /alias source AA-01\.9 is also aliased by alpha\/0[23]-[bc]\.md; two topics may not alias the same old ID/);
});

test('aliases: a value that is not a panel ID, or a list, fails', () => {
  bad(run(withAlias('aliases:\n  AA-01.9: AA-02\n')), /'AA-02' is not a panel ID/);
  bad(run(withAlias('aliases:\n  - AA-01.9\n')), /aliases must be a map/);
});

test('aliases resolve a `see` reference, a bare mention and a panel link, and the report lists them', () => {
  const files = {
    'alpha/01-a.md': topic('AA-01', [panel('AA-01.1', { body: 'See AA-01.9 and also AA-01.8, linked [here](02-b.md#aa-019-old-name).' })]),
    'alpha/02-b.md': topic('AA-02', [panel('AA-02.1')], { aliases: 'aliases:\n  AA-01.9: AA-02.1\n  AA-01.8: AA-02.1\n' }),
  };
  const r = report(corpus(files));
  ok(r);
  const via = r.json.convention.references.viaAlias.map((x) => x.ref).sort();
  assert.deepEqual(via, ['02-b.md#aa-019-old-name', 'AA-01.8', 'AA-01.9'].sort());
  assert.equal(r.json.convention.references.unresolved.length, 0);
});

test('an unresolved `see` reference and an unresolved panel link fail; a bare unresolved mention only warns', () => {
  const files = (body) => ({
    'alpha/01-a.md': topic('AA-01', [panel('AA-01.1', { body })]),
    'alpha/02-b.md': topic('AA-02', [panel('AA-02.1')]),
  });
  bad(run(corpus(files('see AA-02.9'))), /"see AA-02\.9" names no panel and no alias/);
  bad(run(corpus(files('[x](02-b.md#aa-029-gone)'))), /link 02-b\.md#aa-029-gone matches no panel heading and no alias/);
  const mention = report(corpus(files('AA-02.9 was retired.')));
  ok(mention);
  assert.ok(mention.json.warnings.some((w) => /AA-02\.9 is mentioned but is neither a panel nor an alias/.test(w)));
  ok(run(corpus(files('[x](02-b.md#aa-021-panel) and see AA-02.1'))));
});

test('register and review-ledger references follow aliases; unresolved ones only warn', () => {
  const root = withAlias('aliases:\n  AA-01.9: AA-02.1\n');
  fs.writeFileSync(path.join(root, 'REGISTER-test.md'), '- [AA-01.9 old](alpha/02-b.md#aa-019-old) tension, see AA-01.9\n- AA-02.8 mentioned\n');
  fs.writeFileSync(path.join(root, 'review-ledger.jsonl'), JSON.stringify({ kind: 'triage', skipped: 'AA-01.9 reviewed, AA-02.7 too' }) + '\n');
  const r = report(root);
  ok(r);
  const via = r.json.convention.references.viaAlias.map((x) => `${x.where}:${x.ref}`);
  assert.ok(via.includes('REGISTER-test.md:AA-01.9') && via.includes('review-ledger.jsonl:AA-01.9'), via.join(','));
  assert.ok(r.json.convention.references.unresolved.some((x) => x.where === 'review-ledger.jsonl' && x.ref === 'AA-02.7'));
  assert.ok(r.json.warnings.some((w) => /review-ledger\.jsonl — AA-02\.7/.test(w)));
});

// ------------------------------------------------------------------ indexes

test('the generated indexes mark frozen panels with their successor and list the aliases', () => {
  const files = {
    'alpha/01-a.md': topic('AA-01', [panel('AA-01.1', { title: 'Old', under: [banner('AA-01.5')] })]),
    'alpha/02-b.md': topic('AA-02', [panel('AA-02.1', { title: 'New' })], { aliases: 'aliases:\n  AA-01.5: AA-02.1\n' }),
  };
  const root = corpus(files);
  const r = spawnSync(process.execPath, [GEN, root, '--no-source-paths'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const cov = fs.readFileSync(path.join(root, 'COVERAGE.md'), 'utf8');
  assert.match(cov, /\| \[AA-01\.1 Old\]\(alpha\/01-a\.md#aa-011-old\) — superseded by \[AA-02\.1\]\(alpha\/02-b\.md#aa-021-new\) \|/);
  assert.match(cov, /## Superseded panels \(frozen\)/);
  assert.match(cov, /\| \[AA-01\.1\]\(alpha\/01-a\.md#aa-011-old\) \| \[AA-02\.1\]\(alpha\/02-b\.md#aa-021-new\) \| `AA-01\.5` \| `abc1234` \|/);
  assert.match(cov, /## Panel aliases/);
  assert.match(cov, /\| `AA-01\.5` \| \[AA-02\.1\]\(alpha\/02-b\.md#aa-021-new\) \| AA-02 \|/);
  const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
  assert.match(readme, /### Superseded panels \(frozen\)/);
  assert.match(readme, /### Panel aliases/);
  assert.match(readme, /\| `AA-01\.5` \| \[AA-02\.1\]\(alpha\/02-b\.md#aa-021-new\) \| AA-02 \|/);
});

test('a corpus with neither frozen panels nor aliases gets index sections of neither kind', () => {
  const root = corpus({ 'alpha/01-a.md': topic('AA-01', [panel('AA-01.1')]) });
  assert.equal(spawnSync(process.execPath, [GEN, root, '--no-source-paths'], { encoding: 'utf8' }).status, 0);
  const cov = fs.readFileSync(path.join(root, 'COVERAGE.md'), 'utf8');
  assert.doesNotMatch(cov, /Superseded panels|Panel aliases|superseded by/);
});

// ------------------------------------------------------------------ size cap

test('size cap: more than 15 panels warns in the console and the JSON report, and does not fail', () => {
  const panels = Array.from({ length: 16 }, (_, i) => panel(`AA-01.${i + 1}`));
  const r = report(corpus({ 'alpha/01-a.md': topic('AA-01', panels) }));
  ok(r);
  assert.match(r.out, /! alpha\/01-a\.md: size — 16 panels \(cap 15\)/);
  assert.equal(r.json.totals.sizeWarnings, 1);
  assert.deepEqual(r.json.convention.size.warnings.map((w) => [w.topic, w.panels, w.reasons.length]), [['AA-01', 16, 1]]);
  assert.ok(r.json.warnings.some((w) => /size — 16 panels/.test(w)));
});

test('size cap: more than 600 lines warns; both reasons are reported together', () => {
  const pad = Array.from({ length: 610 }, () => '').join('\n');
  const r = report(corpus({ 'alpha/01-a.md': topic('AA-01', [panel('AA-01.1')], { extra: pad + '\n' }) }));
  ok(r);
  assert.match(r.out, /size — 6\d\d lines \(cap 600\)/);
  const both = report(corpus({ 'alpha/01-a.md': topic('AA-01', Array.from({ length: 16 }, (_, i) => panel(`AA-01.${i + 1}`)), { extra: pad + '\n' }) }));
  ok(both);
  assert.equal(both.json.convention.size.warnings[0].reasons.length, 2);
});

test('size cap: exactly 15 panels and exactly 600 lines are within the cap', () => {
  const panels = Array.from({ length: 15 }, (_, i) => panel(`AA-01.${i + 1}`));
  let text = topic('AA-01', panels);
  const have = text.split('\n').length - 1;
  text = topic('AA-01', panels, { extra: '\n'.repeat(600 - have) });
  assert.equal(text.split('\n').length - 1, 600);
  const r = report(corpus({ 'alpha/01-a.md': text }));
  ok(r);
  assert.equal(r.json.totals.sizeWarnings, 0);
  assert.doesNotMatch(r.out, /size —/);
});

// ------------------------------------------------------------------ frozen revision

test('the extended banner "(frozen at <sha>)" parses; the plain form parses; both are reported', () => {
  const files = { 'alpha/01-a.md': topic('AA-01', [panel('AA-01.1', { under: [`> **Superseded** by AA-01.2 at 3f66d51 (frozen at 59b1aca).`] }), panel('AA-01.2', { under: [banner('AA-01.3', '3f66d51')] }), panel('AA-01.3')]) };
  const r = report(corpus(files));
  ok(r);
  assert.deepEqual(r.json.convention.frozen.map((f) => [f.panel, f.sha, f.frozenAt]), [['AA-01.1', '3f66d51', '59b1aca'], ['AA-01.2', '3f66d51', null]]);
  for (const bad1 of ['(frozen at xyz)', '(frozen 59b1aca)', '(frozen at 59b1aca) extra']) {
    bad(run(corpus({ 'alpha/01-a.md': topic('AA-01', [panel('AA-01.1', { under: [`> **Superseded** by AA-01.2 at 3f66d51 ${bad1}.`] }), panel('AA-01.2')]) })), /malformed Superseded banner/, bad1);
  }
});

test('a frozen panel\'s citations are read at its own "frozen at" revision, not the topic\'s verified_commit', () => {
  const repo = path.join(base, 'cite-repo');
  const git = (...a) => { const r = spawnSync('git', ['-C', repo, '-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...a], { encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
  fs.mkdirSync(path.join(repo, 'docs/diagrams/alpha'), { recursive: true });
  git('init', '-q');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\nthree\n');
  git('add', 'a.txt'); git('commit', '-qm', 'old');
  const old = git('rev-parse', '--short=9', 'HEAD');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');          // the file shrank: line 3 no longer exists
  git('add', 'a.txt'); git('commit', '-qm', 'new');
  const cur = git('rev-parse', '--short=9', 'HEAD');
  const label = '```mermaid\nflowchart TB\n    A["a.txt:3"] --> B["a.txt:1"]\n```\n';
  const topicText = (under) => `---\nid: AA-01\ntitle: T\narea: alpha\ngoverning: []\nadrs: []\nsources: [a.txt]\nverified_commit: ${cur}\n---\n## For developers\nx\n\n## For the business\ny\n\n## AA-01.1 Old\n${under}${label}## AA-01.2 New\n\`\`\`mermaid\nflowchart TB\n    A["a.txt:1"]\n\`\`\`\n`;
  const dir = path.join(repo, 'docs/diagrams');
  const file = path.join(dir, 'alpha/01-a.md');
  const cite = () => spawnSync(process.execPath, [GEN, dir, '--check', '--cite-check'], { encoding: 'utf8' });
  fs.writeFileSync(file, topicText(''));
  assert.match(cite().stdout + cite().stderr, /a\.txt:3 past EOF/, 'unfrozen: read at the topic revision, line 3 is gone');
  fs.writeFileSync(file, topicText(`> **Superseded** by AA-01.2 at ${cur}.\n`));
  assert.match(cite().stdout + cite().stderr, /a\.txt:3 past EOF/, 'frozen without "frozen at": still the topic revision');
  fs.writeFileSync(file, topicText(`> **Superseded** by AA-01.2 at ${cur} (frozen at ${old}).\n`));
  const r = cite();
  assert.doesNotMatch(r.stdout + r.stderr, /past EOF/, 'frozen at the old revision: line 3 exists there');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // the other diagram in the topic is still judged at the topic revision
  fs.writeFileSync(file, topicText(`> **Superseded** by AA-01.2 at ${cur} (frozen at ${old}).\n`).replace('A["a.txt:1"]\n```\n', 'A["a.txt:3"]\n```\n'));
  { const c = cite(); assert.match(c.stdout + c.stderr, /AA-01\.2 [-—] a\.txt:3 past EOF/); }
});

// ------------------------------------------------------------------ --only and the real corpus

test('--only still resolves banner and alias targets outside the filter, and skips ratchet staleness', () => {
  const files = {
    'alpha/01-a.md': topic('AA-01', [panel('AA-01.1', { under: [banner('AA-02.1')] })]),
    'alpha/02-b.md': topic('AA-02', [panel('AA-02.1')]),
  };
  const root = corpus(files, ['AA-02.9']);
  ok(run(root, '--only', '01-a'));          // AA-02.1 lives outside the filter; AA-02.9 is stale but whole-tree only
  bad(run(root), /stale entry — AA-02\.9/);
  const gone = corpus({ 'alpha/01-a.md': topic('AA-01', [panel('AA-01.1', { under: [banner('AA-02.4')] })]), 'alpha/02-b.md': topic('AA-02', [panel('AA-02.1')]) });
  bad(run(gone, '--only', '01-a'), /AA-02\.4, which is neither a panel nor a resolvable alias/);
  assert.equal(run(root, '--only', '01-a', '--update-resolved-baseline').status, 2);
});
}
