#!/usr/bin/env node
// Build the inventory of a product's user-facing surface: every route a person can reach, the
// component behind it, and the words that component puts on the screen.
//
// Why this exists. A pack for the people who use a product has to be shaped by what the
// product lets them do, and the honest way to learn that is to read the interface code. But a
// front end is tens of thousands of lines, and a local model given "read the surfaces and
// derive the curriculum" will spend its whole budget reading and write nothing. Twice now that
// has cost a full session.
//
// So the reading is done here, mechanically and cheaply, and the model is handed the result:
// the route list, and under each route the headings, buttons, tabs, labels and placeholders
// that actually appear. That is the product's own vocabulary. A curriculum built from it uses
// the words the reader will see on screen, which is also what makes the later capture item
// able to find anything.
//
// This is deliberately a lexical tool, not a compiler. It will miss text assembled at runtime
// and include some text behind a flag. It is a map for a writer, not a specification: the
// chapter still has to be checked against the running product, which is what the capture and
// review items are for.
//
//   surface-inventory.mjs --repo <dir> [--out <file>] [--include <glob-ish>] [--max-strings 40]
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, basename, dirname, extname } from 'node:path';

const args = (() => { const a = {}; const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) { if (!v[i].startsWith('--')) continue;
    const k = v[i].slice(2), n = v[i + 1]; a[k] = n === undefined || n.startsWith('--') ? true : (i++, n); }
  return a; })();
const REPO = args.repo;
if (!REPO) { console.error('surface-inventory.mjs: --repo is required'); process.exit(2); }
const MAX = Number(args['max-strings'] ?? 40);

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '__pycache__', '.venv']);
const CODE = new Set(['.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte']);
const walk = (dir, out = []) => {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    e.isDirectory() ? walk(p, out) : (CODE.has(extname(e.name)) && out.push(p));
  }
  return out;
};

const files = walk(REPO);
if (!files.length) { console.error(`surface-inventory.mjs: no interface code found under ${REPO}`); process.exit(1); }
const rel = (f) => relative(REPO, f).split('\\').join('/');

// ---------------------------------------------------------------- routes
// Four conventions cover almost everything in practice. Anything else falls back to naming the
// file, which is still more use to a writer than nothing.
function routeOf(f) {
  const r = rel(f);
  let m;
  // Next.js app router: app/admin/campaigns/page.tsx -> /admin/campaigns
  if ((m = r.match(/(?:^|\/)app\/(.*)\/(page|layout)\.[jt]sx?$/))) {
    const path = '/' + m[1].split('/')
      .filter((s) => !(s.startsWith('(') && s.endsWith(')')))   // route groups are not in the URL
      .join('/');
    return { path: path === '/' ? '/' : path.replace(/\/+$/, ''), kind: m[2] === 'layout' ? 'layout' : 'page' };
  }
  if ((m = r.match(/(?:^|\/)app\/(.*)\/route\.[jt]s$/))) return { path: '/' + m[1], kind: 'endpoint' };
  // Next.js pages router: pages/admin/index.tsx -> /admin
  if ((m = r.match(/(?:^|\/)pages\/(.*)\.[jt]sx?$/)) && !r.includes('/pages/api/')) {
    const path = '/' + m[1].replace(/\/?index$/, '');
    return { path: path === '/' ? '/' : path, kind: 'page' };
  }
  if ((m = r.match(/(?:^|\/)pages\/api\/(.*)\.[jt]s$/))) return { path: '/api/' + m[1].replace(/\/?index$/, ''), kind: 'endpoint' };
  // SvelteKit
  if ((m = r.match(/(?:^|\/)routes\/(.*)\/\+page\.(svelte|[jt]s)$/))) return { path: '/' + m[1], kind: 'page' };
  return null;
}

// ---------------------------------------------------------------- the words on screen
// What a person reads: headings, button and link text, tab names, form labels, placeholders,
// and the accessible names that stand in for them. Interpolations are cut, because "Welcome
// back, {name}" is a template, and a reader searching for it will not find it.
const NOISE = /^(?:[\s{}()[\]<>/\\|&.,:;=+\-_*#'"`]|\d)*$/;
const CODEISH = /^(?:[a-z]+[A-Z]|[A-Z_]{3,}$|https?:|\/|\.|#[0-9a-f]{3,})/;
// A dotted identifier is an expression someone quoted, not words on a screen, and a trailing
// interpolation marker is what is left after one was cut out.
const EXPRESSION = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+$/;
function stringsIn(text) {
  const found = new Map();   // string -> how it appears
  const add = (s, how) => {
    let t = String(s).replace(/\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
    t = t.replace(/^["'`]|["'`]$/g, '').trim();
    if (t.length < 2 || t.length > 90) return;
    if (NOISE.test(t) || CODEISH.test(t) || EXPRESSION.test(t)) return;
    if (/[$]\s*$/.test(t) || /\s[$]/.test(t)) return;
    if (!/[a-z]/.test(t)) return;                       // all-caps constants are not screen text
    if (!found.has(t)) found.set(t, how);
  };

  // Heading and button elements, with their text content.
  for (const m of text.matchAll(/<(h[1-4]|button|summary|label|th)\b[^>]*>([^<{][^<]{0,88})</gi)) add(m[2], m[1].toLowerCase());
  // Accessible and visible names passed as props.
  for (const m of text.matchAll(/\b(?:label|title|placeholder|aria-label|heading|tabLabel|name|cta|buttonText|emptyState)\s*=\s*["'{`]([^"'`}]{2,88})["'`}]/g)) add(m[1], 'prop');
  // Object literals that carry screen text, as menu and tab definitions usually do.
  for (const m of text.matchAll(/\b(?:label|title|heading|name|description)\s*:\s*["'`]([^"'`]{2,88})["'`]/g)) add(m[1], 'item');
  // Toast and empty-state sentences: a quoted sentence with spaces and a lower-case word.
  for (const m of text.matchAll(/["'`]([A-Z][^"'`<>{}]{14,88}?[.!?])["'`]/g)) add(m[1], 'message');
  return found;
}

// Local imports, followed one level, because a route file is usually a shell around one
// component and the words live in the component.
function localImports(f, text) {
  const out = [];
  for (const m of text.matchAll(/from\s+["']([^"']+)["']/g)) {
    const spec = m[1];
    if (!spec.startsWith('.') && !spec.startsWith('@/') && !spec.startsWith('~/')) continue;
    const bare = spec.replace(/^@\//, '').replace(/^~\//, '');
    const bases = spec.startsWith('.')
      ? [join(dirname(f), spec)]
      : [join(REPO, bare), join(REPO, 'src', bare), join(REPO, 'app', bare)];
    for (const b of bases) {
      for (const cand of ['.tsx', '.jsx', '.ts', '.js', '.vue', '.svelte'].map((e) => b + e)
                         .concat(['index.tsx', 'index.ts', 'index.jsx'].map((i) => join(b, i)))) {
        if (existsSync(cand) && statSync(cand).isFile()) { out.push(cand); break; }
      }
    }
  }
  return [...new Set(out)];
}

// ---------------------------------------------------------------- assemble
const cache = new Map();
const readOnce = (f) => { if (!cache.has(f)) cache.set(f, readFileSync(f, 'utf8')); return cache.get(f); };

const pages = [], endpoints = [];
for (const f of files) {
  const route = routeOf(f);
  if (!route) continue;
  const text = readOnce(f);
  if (route.kind === 'endpoint') {
    const methods = [...text.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)/g)].map((m) => m[1]);
    endpoints.push({ path: route.path, file: rel(f), methods: methods.length ? methods : ['?'] });
    continue;
  }
  const words = new Map();
  const sources = [rel(f)];
  for (const [s, how] of stringsIn(text)) words.set(s, how);
  for (const dep of localImports(f, text)) {
    let depText; try { depText = readOnce(dep); } catch { continue; }
    if (depText.length > 400000) continue;
    sources.push(rel(dep));
    for (const [s, how] of stringsIn(depText)) if (!words.has(s)) words.set(s, how);
  }
  pages.push({ ...route, file: rel(f), sources, words: [...words.entries()] });
}

pages.sort((a, b) => a.path.localeCompare(b.path));
endpoints.sort((a, b) => a.path.localeCompare(b.path));

// ---------------------------------------------------------------- write it out
const esc = (s) => s.replace(/\|/g, '\\|');
const lines = [];
lines.push('# The product\'s user-facing surface', '');
lines.push('Generated by `surface-inventory.mjs` from the interface code. This is a lexical read of');
lines.push('the source, not a run of the product: it can miss text built at runtime and can include');
lines.push('text behind a flag. Use it to decide what the pack should teach and in what words. Check');
lines.push('anything you assert against the running product.', '');
lines.push(`Read from \`${rel(REPO) || REPO}\`: ${pages.length} reachable pages, ${endpoints.length} endpoints.`, '');

lines.push('## Pages a person can reach', '');
for (const p of pages) {
  if (p.kind === 'layout') continue;
  lines.push(`### \`${p.path}\``, '');
  lines.push(`Rendered by \`${p.file}\`${p.sources.length > 1 ? `, drawing on ${p.sources.length - 1} local component(s)` : ''}.`, '');
  const byHow = new Map();
  for (const [s, how] of p.words) (byHow.get(how) ?? byHow.set(how, []).get(how)).push(s);
  const order = ['h1', 'h2', 'h3', 'h4', 'button', 'label', 'th', 'summary', 'item', 'prop', 'message'];
  const naming = { h1: 'Headings', h2: 'Headings', h3: 'Sub-headings', h4: 'Sub-headings',
    button: 'Buttons', label: 'Field labels', th: 'Table columns', summary: 'Disclosures',
    item: 'Named items, tabs and menu entries', prop: 'Titles, placeholders and accessible names',
    message: 'Sentences the product shows' };
  const shown = new Set();
  let count = 0;
  for (const how of order) {
    const group = byHow.get(how);
    if (!group) continue;
    const fresh = group.filter((s) => !shown.has(s)).slice(0, MAX);
    if (!fresh.length) continue;
    for (const s of fresh) shown.add(s);
    count += fresh.length;
    lines.push(`- **${naming[how]}:** ${fresh.map((s) => `“${esc(s)}”`).join(' · ')}`);
  }
  if (!count) lines.push('- No screen text found in this route or its immediate components.');
  lines.push('');
}

const layouts = pages.filter((p) => p.kind === 'layout');
if (layouts.length) {
  lines.push('## Frames around those pages', '');
  lines.push('Navigation and chrome a person sees on every page beneath these paths.', '');
  for (const p of layouts) {
    const words = p.words.slice(0, MAX).map(([s]) => `“${esc(s)}”`).join(' · ');
    lines.push(`- \`${p.path}\` (\`${p.file}\`)${words ? ': ' + words : ''}`);
  }
  lines.push('');
}

lines.push('## Endpoints behind them', '');
lines.push('Not pages, and not chapters. Listed so a claim about what the product can do can be');
lines.push('checked against something that exists.', '');
lines.push('| Path | Methods | File |', '| --- | --- | --- |');
for (const e of endpoints) lines.push(`| \`${e.path}\` | ${e.methods.join(', ')} | \`${e.file}\` |`);
lines.push('');

const out = lines.join('\n');
if (args.out) { writeFileSync(args.out, out); console.log(`${pages.length} pages, ${endpoints.length} endpoints -> ${args.out}`); }
else process.stdout.write(out);
