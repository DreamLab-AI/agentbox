#!/usr/bin/env node
// Anatomy coverage: which parts of the system does no chapter mention?
// Discovers anchors from the target repository (source directories, HTTP routes, compose
// services, design records) and greps the chapter sources for each. Content-agnostic:
// every discovery root is an argument; omit the ones the target does not have.
//
//   node anatomy-coverage.mjs --repo R --chapters DIR \
//     [--dirs a,b,c]          directories whose immediate children are anchors (paths)
//     [--routes f1,f2]        files scanned for .get('/x') / .post('/x') style registrations
//     [--compose f1,f2]       compose files whose service names are anchors
//     [--records DIR]         a directory whose file stems (e.g. ADR-021-…) are anchors
//     [--report-only]         exit 0 even when anchors are uncovered
// Zero dependencies. Node 18+.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => a.startsWith('--') ? [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? true : all[i + 1]] : []).filter(Boolean));
if (!args.repo || !args.chapters) { console.error('usage: --repo R --chapters DIR [--dirs ..] [--routes ..] [--compose ..] [--records DIR] [--report-only]'); process.exit(2); }
const list = v => (typeof v === 'string' ? v.split(',').filter(Boolean) : []);
const anchors = [];
for (const d of list(args.dirs)) {
  const abs = join(args.repo, d);
  for (const child of readdirSync(abs)) {
    if (child.startsWith('.') || child === 'node_modules' || child === 'coverage') continue;
    const p = join(abs, child);
    if (!statSync(p).isDirectory()) continue; // files at this level are not anatomy; routes and records have their own discovery
    anchors.push({ kind: 'dir', name: relative(args.repo, p) + '/', test: t => t.includes(relative(args.repo, p)) });
  }
}
for (const f of list(args.routes)) {
  const text = readFileSync(join(args.repo, f), 'utf8');
  for (const m of text.matchAll(/\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g)) {
    const route = m[2];
    anchors.push({ kind: 'route', name: `${m[1].toUpperCase()} ${route}`, test: t => t.includes(route) });
  }
}
for (const f of list(args.compose)) {
  const lines = readFileSync(join(args.repo, f), 'utf8').split('\n');
  let inServices = false;
  for (const line of lines) {
    if (/^services:\s*$/.test(line)) { inServices = true; continue; }
    if (/^[A-Za-z]/.test(line)) inServices = false;
    const m = inServices && line.match(/^  ([A-Za-z0-9_-]+):\s*$/);
    if (m) anchors.push({ kind: 'service', name: m[1], test: t => new RegExp(`\\b${m[1].replace(/[-]/g, '[-]')}\\b`).test(t) });
  }
}
if (typeof args.records === 'string') {
  for (const f of readdirSync(join(args.repo, args.records))) {
    const id = basename(f, '.md').match(/^[A-Z]+-\d+/)?.[0];
    if (id) anchors.push({ kind: 'record', name: id, test: t => t.includes(id) });
  }
}
const chapters = readdirSync(args.chapters).filter(f => /\.(md|html)$/.test(f)).map(f => ({ f, text: readFileSync(join(args.chapters, f), 'utf8') }));
const corpus = chapters.map(c => c.text).join('\n');
const seen = new Map();
const uncovered = [];
for (const a of anchors) {
  if (seen.has(a.kind + a.name)) continue; seen.set(a.kind + a.name, true);
  const where = chapters.filter(c => a.test(c.text)).map(c => c.f.replace(/\.(md|html)$/, ''));
  if (where.length) console.log(`covered   ${a.kind.padEnd(8)} ${a.name}  ←  ${where.join(', ')}`);
  else { uncovered.push(a); }
}
for (const a of uncovered) console.log(`UNCOVERED ${a.kind.padEnd(8)} ${a.name}`);
const total = seen.size;
console.log(`\n${total - uncovered.length}/${total} anchors mentioned by at least one chapter (${chapters.length} chapters, ${corpus.split(/\s+/).length} words).`);
process.exit(uncovered.length && !args['report-only'] ? 1 : 0);
