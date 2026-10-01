#!/usr/bin/env node
// Turn diagrams-as-code topics into fact sheets a drafting session copies from, instead of
// sending it to rediscover what the corpus already established. See references/diagram-corpus.md,
// "Refreshing a pack from the corpus".
//
//   corpus-sheet.mjs --repo DIR [--dir REL] --list
//   corpus-sheet.mjs --repo DIR [--dir REL] --topics CP-01,BL-03 [--half developer|business|both] [--out FILE]
//
// --list prints one row per topic (id, area, title, diagram sections, verified commit) for the
// planning step that maps chapters to topics.
// --topics prints a sheet per topic: the chosen half of the narrative, then each diagram section
// with its rendered file, its "What it shows" paragraph and every citation in it rewritten as a
// chapter link, src:path#La-Lb, with the sentence it supports.
//
// Why: a local model told to "grep -n and copy the line numbers" spends its budget searching and
// still guesses under pressure. The corpus has already resolved and machine-checked those spans at
// its declared commit, so the sheet hands them over. Each span is re-checked here against the
// working tree (path exists, range inside the file) and a failure is marked, never dropped.
//
// Exit codes: 0 on success, 1 when any emitted citation fails its check, 2 on bad arguments.
import { readFileSync, readdirSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const a = { _: [] };
for (let i = 2, v = process.argv; i < v.length; i++) {
  if (!v[i].startsWith('--')) { a._.push(v[i]); continue; }
  const k = v[i].slice(2), n = v[i + 1];
  a[k] = n === undefined || n.startsWith('--') ? true : (i++, n);
}
const fail = (m) => { console.error(`corpus-sheet: ${m}`); process.exit(2); };
if (!a.repo || !existsSync(a.repo)) fail('--repo DIR is required and must exist');
const repo = a.repo;
const root = join(repo, a.dir || 'docs/diagrams');
if (!existsSync(root)) fail(`no corpus at ${relative(process.cwd(), root) || root}`);
if (!a.list && !a.topics) fail('give --list or --topics ID[,ID]');
const half = a.half || 'both';
if (!['developer', 'business', 'both'].includes(half)) fail('--half is developer, business or both');

let head = '';
try { head = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch {}

function topicFiles() {
  const out = [];
  for (const area of readdirSync(root)) {
    const d = join(root, area);
    if (area === 'rendered' || !statSync(d).isDirectory()) continue;
    for (const f of readdirSync(d)) if (/^\d+.*\.md$/.test(f)) out.push(join(d, f));
  }
  return out.sort();
}

function parse(file) {
  const text = readFileSync(file, 'utf8');
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return null;
  const meta = Object.fromEntries([...m[1].matchAll(/^([a-z_]+):\s*(.*)$/gm)].map((x) => [x[1], x[2].trim()]));
  if (!meta.id) return null;
  const body = m[2];
  // Split on level-2 headings; a diagram section is headed by the topic id and a number.
  const parts = body.split(/^(?=## )/m);
  const halves = {}; const sections = [];
  const secRe = new RegExp(`^## (${meta.id.replace(/[-]/g, '\\-')}\\.\\d+)\\s+(.*)$`, 'm');
  for (const p of parts) {
    const h = p.match(/^## (.*)$/m)?.[1] || '';
    if (/^For developers/i.test(h)) halves.developer = p.replace(/^## .*\n/, '').trim();
    else if (/^For the business/i.test(h)) halves.business = p.replace(/^## .*\n/, '').trim();
    else {
      const s = p.match(secRe);
      if (s) sections.push({ id: s[1], title: s[2].trim(), text: p.replace(/^## .*\n/, '') });
    }
  }
  return { file, meta, halves, sections };
}

const lineCount = new Map();
function lines(path) {
  if (!lineCount.has(path)) {
    const f = join(repo, path);
    lineCount.set(path, existsSync(f) && statSync(f).isFile() ? readFileSync(f, 'utf8').split('\n').length : -1);
  }
  return lineCount.get(path);
}

let bad = 0;
// `p:a` to `p:b` (same file) or a lone `p:a`; the corpus writes spans this way.
const citeRe = /`([\w./@-]+\.[\w]+):(\d+)`(?:\s+to\s+`\1:(\d+)`)?/g;
function citations(text) {
  const flat = text.replace(/```[\s\S]*?```/g, '').replace(/\s*\n\s*/g, ' ');
  const sentences = flat.split(/(?<=[.;])\s+(?=[A-Z*(])/);
  const out = []; const seen = new Set();
  for (const s of sentences) {
    for (const c of s.matchAll(citeRe)) {
      const [, path, from, to = from] = c;
      const link = `src:${path}#L${from}-L${to}`;
      if (seen.has(link)) continue;
      seen.add(link);
      const n = lines(path);
      const ok = n > 0 && +from >= 1 && +to >= +from && +to <= n;
      if (!ok) bad++;
      const claim = s.replace(citeRe, '').replace(/\([^()]*?\)/g, (p) => (/[A-Za-z]{3}/.test(p.replace(/\b(see|pinned at|and|to)\b/g, '')) ? p : ''))
        .replace(/\s+/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
      out.push({ link, ok, why: n < 0 ? 'path missing' : `range outside ${n} lines`, claim: claim.length > 240 ? claim.slice(0, 237) + '…' : claim });
    }
  }
  return out;
}

const topics = topicFiles().map(parse).filter(Boolean);

if (a.list) {
  console.log(`| id | area | title | diagrams | verified |`);
  console.log(`|---|---|---|---|---|`);
  for (const t of topics) {
    const v = t.meta.verified_commit || '';
    const stale = head && v && !head.startsWith(v) && !v.startsWith(head) ? ' (not HEAD)' : '';
    console.log(`| ${t.meta.id} | ${t.meta.area || ''} | ${t.meta.title || ''} | ${t.sections.map((s) => s.id.split('.').pop()).join(' ')} | ${v.slice(0, 9)}${stale} |`);
  }
} else {
const want = String(a.topics).split(',').map((s) => s.trim()).filter(Boolean);
const out = [];
for (const id of want) {
  const t = topics.find((x) => x.meta.id === id);
  if (!t) { out.push(`## ${id}\n\nNo topic with this id. Run --list for the ids that exist.\n`); bad++; continue; }
  const v = t.meta.verified_commit || 'none declared';
  out.push(`## ${id} ${t.meta.title || ''}\n`);
  out.push(`Source: ${relative(repo, t.file)} · verified at ${v.slice(0, 12)}${head && !head.startsWith(v) ? ` · HEAD is ${head.slice(0, 12)}: re-open each span before relying on it` : ' · this is HEAD'}\n`);
  for (const h of half === 'both' ? ['business', 'developer'] : [half]) {
    if (t.halves[h]) out.push(`### For ${h === 'business' ? 'the business' : 'developers'}\n\n${t.halves[h]}\n`);
  }
  for (const s of t.sections) {
    out.push(`### ${s.id} ${s.title}\n`);
    const area = relative(root, t.file).split('/')[0];
    const stem = t.file.split('/').pop().replace(/\.md$/, '');
    const svg = join(root, 'rendered', area, stem, `${s.id}.svg`);
    out.push(existsSync(svg) ? `Rendered: ${relative(repo, svg)}\n` : `Rendered: none (the diagram is inline mermaid only)\n`);
    const shows = s.text.match(/\*\*What it shows\.\*\*\s*([\s\S]*?)(?:\n\n|$)/)?.[1];
    if (shows) out.push(`What it shows: ${shows.replace(/\s*\n\s*/g, ' ').trim()}\n`);
    const cs = citations(s.text);
    if (cs.length) {
      out.push(`Citations, copy as written:\n`);
      for (const c of cs) out.push(`- ${c.ok ? '' : `✗ ${c.why}: `}${c.link} — ${c.claim}`);
      out.push('');
    }
  }
}
const sheet = out.join('\n') + '\n';
if (a.out) writeFileSync(a.out, sheet); else process.stdout.write(sheet);
if (bad) console.error(`corpus-sheet: ${bad} citation(s) or topic(s) failed their check; they are marked ✗ in the sheet`);
// exitCode, not exit(): a sheet runs to megabytes, and exit() drops whatever a pipe has not drained.
process.exitCode = bad ? 1 : 0;
}
