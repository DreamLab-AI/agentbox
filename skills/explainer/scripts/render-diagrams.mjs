#!/usr/bin/env node
// Render the mermaid blocks a repository's docs tree holds but never rendered.
//
// A diagrams-as-code corpus usually keeps rendered art beside each topic. The prose documents
// around it — the explanations, the how-to pages, the decision records — often carry mermaid
// inline and have no rendered mirror, because nothing in the repository's own workflow needed
// one. A reader of a browsable stack does need one: a fenced graph definition is not a diagram.
//
// The cache is content-addressed, so re-running costs nothing and editing a diagram's source
// renders exactly that diagram again. Nothing is written into the source tree.
//
//   render-diagrams.mjs --src <docs dir> --cache <dir> [--jobs 4] [--limit N]
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

const args = (() => { const a = {}; const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) { if (!v[i].startsWith('--')) continue;
    const k = v[i].slice(2), n = v[i + 1]; a[k] = n === undefined || n.startsWith('--') ? true : (i++, n); }
  return a; })();
const SRC = args.src, CACHE = args.cache;
if (!SRC || !CACHE) { console.error('need --src and --cache'); process.exit(2); }
const JOBS = Number(args.jobs ?? 4);

const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};
const rel = (f) => relative(SRC, f).split('\\').join('/');

// The same lookup the stack renderer uses, so "already rendered" means the same thing in both.
const corpusFor = (r) => {
  const m = r.match(/^diagrams\/([^/]+)\/(.+)\.md$/);
  const set = new Set();
  if (!m || m[1] === 'rendered') return set;
  const dir = join(SRC, 'diagrams', 'rendered', m[1], m[2]);
  if (!existsSync(dir)) return set;
  for (const name of readdirSync(dir)) if (name.endsWith('.svg')) set.add(basename(name, '.svg'));
  return set;
};

// Collect every block that nothing has drawn yet.
const wanted = new Map();   // hash -> { source, where[] }
for (const f of walk(SRC).filter((f) => f.endsWith('.md'))) {
  const r = rel(f);
  if (r.startsWith('diagrams/rendered/')) continue;
  const corpus = corpusFor(r);
  const text = readFileSync(f, 'utf8');
  let heading = null, n = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^#{1,6}\s+([A-Z]{2,4}-\d+(?:\.\d+)?)/);
    if (h) heading = h[1];
    if (!/^```mermaid\s*$/.test(lines[i])) continue;
    const start = i + 1;
    let end = start;
    while (end < lines.length && !/^```\s*$/.test(lines[end])) end++;
    const source = lines.slice(start, end).join('\n');
    i = end;
    n++;
    if (heading && corpus.has(heading)) continue;          // the corpus already drew this one
    const hash = createHash('sha256').update(source).digest('hex').slice(0, 24);
    const rec = wanted.get(hash) ?? { source, where: [] };
    rec.where.push(`${r}#${n}`);
    wanted.set(hash, rec);
  }
}

mkdirSync(CACHE, { recursive: true });
const todo = [...wanted.entries()].filter(([h]) => {
  const p = join(CACHE, `${h}.svg`);
  return !(existsSync(p) && statSync(p).size > 200);
});
const limit = args.limit ? Number(args.limit) : todo.length;
console.log(`${wanted.size} block(s) have no rendered art; ${todo.length} not in the cache; rendering ${Math.min(limit, todo.length)}`);

// One mermaid-cli invocation launches a browser, so the work is parallelised modestly rather
// than sequentially. Failures are recorded, not fatal: a diagram whose source mermaid cannot
// parse is a fact about the repository, and the stack still shows its source.
const failures = [];
let done = 0;
const queue = todo.slice(0, limit);
async function worker() {
  for (;;) {
    const next = queue.shift();
    if (!next) return;
    const [hash, rec] = next;
    const mmd = join(CACHE, `${hash}.mmd`);
    writeFileSync(mmd, rec.source + '\n');
    try {
      await run('mmdc', ['-i', mmd, '-o', join(CACHE, `${hash}.svg`), '-b', 'transparent'],
               { timeout: 120000, cwd: CACHE });
      done++;
    } catch (e) {
      failures.push({ hash, where: rec.where, error: String(e.stderr || e.message).split('\n').slice(0, 3).join(' ') });
    }
    if ((done + failures.length) % 10 === 0) console.log(`  ${done + failures.length}/${Math.min(limit, todo.length)}`);
  }
}
await Promise.all(Array.from({ length: JOBS }, worker));

// The index the stack reads: hash to file, plus where each block came from, so a later reader
// can tell which page a cached diagram belongs to.
const index = {};
for (const [hash, rec] of wanted) {
  if (existsSync(join(CACHE, `${hash}.svg`))) index[hash] = { svg: `${hash}.svg`, where: rec.where };
}
writeFileSync(join(CACHE, 'index.json'), JSON.stringify({ rendered: index, failures }, null, 2) + '\n');
console.log(`${done} rendered, ${failures.length} failed, ${Object.keys(index).length} in the index`);
for (const f of failures.slice(0, 8)) console.log(`  FAILED ${f.where.join(', ')}: ${f.error}`);
