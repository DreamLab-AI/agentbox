#!/usr/bin/env node
// Render a repository's static documentation tree as a browsable site in the explainer's
// house style, so the docs a codebase already carries can be read beside the packs written
// about it.
//
// The tree this expects is the one a well-kept repository tends to have: a Diátaxis split
// (tutorials, how-to, reference, explanation) plus a diagrams-as-code corpus, where each
// topic is a markdown file with YAML front matter and fenced mermaid blocks, and a mirror
// directory holds each block already rendered to SVG.
//
// Two decisions worth stating, because they are what makes the output readable rather than
// merely converted:
//
//   A fenced mermaid block is replaced by its rendered SVG, and the source is kept below it
//   in a closed block. The reader sees the diagram; the engineer can still read the code
//   that drew it. Matching is by the section heading: a heading beginning "CP-01.4" claims
//   the diagram named CP-01.4, which is how the corpus is already organised, so nothing has
//   to be guessed from block order.
//
//   A link to a source file is not a link. The source is not published here, so a path like
//   control-plane/src/index.ts becomes marked-up text rather than a dead anchor. A reader
//   clicking a link that cannot work learns less than one reading a path they can search for.
//
//   A block the corpus never drew is still a diagram. render-diagrams.mjs renders those into a
//   content-addressed cache, and --diagram-cache points here at it, so the prose documents get
//   pictures too rather than a wall of graph definitions.
//
//   docs-stack.mjs --src <docs dir> --out <dir> [--repo <git root>] [--title <product>]
//                  [--diagram-cache <dir>]
import { marked } from 'marked';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname, relative, basename, extname } from 'node:path';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const args = (() => { const a = {}; const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) { if (!v[i].startsWith('--')) continue;
    const k = v[i].slice(2), n = v[i + 1]; a[k] = n === undefined || n.startsWith('--') ? true : (i++, n); }
  return a; })();
const SRC = args.src, OUT = args.out, PRODUCT = args.title ?? 'This repository';
if (!SRC || !OUT) { console.error('need --src and --out'); process.exit(2); }

// The cache of diagrams this repository never rendered, keyed by the hash of their source.
const CACHE = args['diagram-cache'];
const cached = new Map();
if (CACHE && existsSync(join(CACHE, 'index.json'))) {
  const idx = JSON.parse(readFileSync(join(CACHE, 'index.json'), 'utf8'));
  for (const [hash, rec] of Object.entries(idx.rendered ?? {})) cached.set(hash, rec.svg);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = join(dir, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
};

// ---------------------------------------------------------------- front matter
// A deliberately small YAML reader: scalars, block lists, and inline [a, b] lists. The
// corpus uses nothing else, and a real YAML dependency would have to be audited to earn a
// place in a tool that runs over client material.
function frontMatter(text) {
  if (!text.startsWith('---\n')) return [{}, text];
  const end = text.indexOf('\n---', 4);
  if (end < 0) return [{}, text];
  const meta = {}; let key = null;
  for (const line of text.slice(4, end).split('\n')) {
    if (/^\s*#/.test(line) || !line.trim()) continue;
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && key) { (meta[key] = Array.isArray(meta[key]) ? meta[key] : []).push(item[1].trim()); continue; }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    key = kv[1];
    const raw = kv[2].trim();
    if (!raw) { meta[key] = []; continue; }
    meta[key] = raw.startsWith('[')
      ? raw.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean)
      : raw.replace(/^["']|["']$/g, '');
  }
  return [meta, text.slice(text.indexOf('\n', end + 1) + 1)];
}

// ---------------------------------------------------------------- the page shell
const NAV = [
  ['index.html', 'Contents'],
  ['explanation/index.html', 'Explanation'],
  ['how-to/index.html', 'How to'],
  ['reference/index.html', 'Reference'],
  ['tutorials/index.html', 'Tutorials'],
  ['diagrams/index.html', 'Diagrams'],
];
function shell(title, body, depth, sub = '') {
  const up = '../'.repeat(depth);
  const nav = NAV.map(([href, label]) => `<a href="${up}${href}">${label}</a>`).join('');
  return '<!doctype html><html lang="en"><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>${esc(title)} · ${esc(PRODUCT)} documentation</title>`
    + `<link rel="stylesheet" href="${up}assets/docs.css"><body>`
    + '<a class="skip" href="#main">Skip to content</a>'
    + `<header>${esc(PRODUCT.toUpperCase())} <span>Documentation stack</span></header>`
    + `<div class="layout"><nav aria-label="Sections">${nav}${sub}</nav>`
    + `<main id="main">${body}</main></div></body></html>`;
}

// ---------------------------------------------------------------- markdown → html
// One renderer instance per page, because the mermaid substitution needs to know which
// topic it is in and which heading it last passed.
function renderMarkdown(body, ctx) {
  // marked 11 hands a renderer already-rendered strings rather than tokens, so each override
  // takes the text and the raw source. `raw` is what the mermaid lookup needs: the heading's
  // own text, before inline markup turned it into HTML.
  let heading = null;
  const r = new marked.Renderer();
  const base = new marked.Renderer();

  r.heading = (text, level, raw) => {
    const id = String(raw).match(/^([A-Z]{2,4}-\d+(?:\.\d+)?)/);
    if (id) heading = id[1];
    const anchor = String(raw).toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return `<h${level} id="${anchor}">${text}</h${level}>\n`;
  };

  r.code = (code, infostring, escaped) => {
    if ((infostring || '').trim().split(/\s+/)[0] !== 'mermaid') return base.code.call(r, code, infostring, escaped);
    ctx.mermaid++;
    const source = '<details class="as-code"><summary>This diagram as code</summary>'
      + `<pre><code>${esc(code)}</code></pre></details>`;
    const label = heading ?? `Diagram ${ctx.mermaid}`;

    // The corpus first: a topic's own rendered art is the authoritative drawing of it.
    const corpus = heading && ctx.diagrams.get(heading);
    if (corpus) {
      ctx.used.add(corpus);
      return `<figure class="diagram"><img src="${esc(ctx.assetPrefix + corpus)}" alt="${esc(label)}: `
        + 'diagram from the repository\u2019s diagrams-as-code corpus" loading="lazy">'
        + `<figcaption>${esc(label)}</figcaption>${source}</figure>`;
    }

    // Then a diagram rendered for this stack, because the repository never drew it.
    const hash = createHash('sha256').update(code).digest('hex').slice(0, 24);
    const fromCache = cached.get(hash);
    if (fromCache) {
      ctx.generated.add(fromCache);
      return `<figure class="diagram"><img src="${esc(ctx.assetPrefix + 'diagrams/generated/' + fromCache)}" `
        + `alt="${esc(label)}: diagram drawn from the mermaid source shown below" loading="lazy">`
        + `<figcaption>${esc(label)} <span class="drawn-here">drawn for this stack</span></figcaption>${source}</figure>`;
    }

    // And otherwise the source alone, with the reason stated rather than left as a silence.
    ctx.unrendered.push(label);
    return '<figure class="diagram"><p class="notice">This diagram is shown as source only: its '
      + 'mermaid does not parse, so nothing can draw it. That is a fault in the repository, not in '
      + `this page.</p>${source}</figure>`;
  };

  r.link = (href, title, text) => {
    const h = href ?? '';
    if (/^(https?:|mailto:|#)/i.test(h)) return base.link.call(r, href, title, text);
    const target = ctx.resolveLink(h);
    if (!target) return `<span class="unlinked" title="not published in this stack">${text}</span>`;
    return `<a href="${esc(target)}"${title ? ` title="${esc(title)}"` : ''}>${text}</a>`;
  };

  // An image already in the tree (a screenshot under docs/assets, say) travels with the stack.
  r.image = (href, title, text) => {
    const target = ctx.resolveAsset(href ?? '');
    if (!target) return `<span class="unlinked">${esc(text || href || '')}</span>`;
    return `<img src="${esc(target)}" alt="${esc(text ?? '')}" loading="lazy">`;
  };

  return marked.parse(body, { renderer: r, mangle: false, headerIds: false, gfm: true });
}

// ---------------------------------------------------------------- gather
const files = walk(SRC);
const mdFiles = files.filter((f) => f.endsWith('.md'));
const assets = files.filter((f) => ['.svg', '.png', '.jpg', '.jpeg', '.webp'].includes(extname(f).toLowerCase()));
const rel = (f) => relative(SRC, f).split('\\').join('/');
const pageFor = (f) => rel(f).replace(/\.md$/, '.html');
const known = new Set(mdFiles.map(rel));
const knownAssets = new Set(assets.map(rel));

// Diagram lookup per topic: rendered/<area>/<topic>/<ID>.svg
const diagramsFor = (mdPath) => {
  const r = rel(mdPath);
  const m = r.match(/^diagrams\/([^/]+)\/(.+)\.md$/);
  const map = new Map();
  if (!m || m[1] === 'rendered') return map;
  const dir = join(SRC, 'diagrams', 'rendered', m[1], m[2]);
  if (!existsSync(dir)) return map;
  for (const name of readdirSync(dir)) {
    if (name.endsWith('.svg')) map.set(basename(name, '.svg'), `diagrams/rendered/${m[1]}/${m[2]}/${name}`);
  }
  return map;
};

// ---------------------------------------------------------------- render pages
mkdirSync(OUT, { recursive: true });
const pages = [];
let mermaidTotal = 0, unrenderedTotal = [];
const usedDiagrams = new Set();
const generatedDiagrams = new Set();

for (const f of mdFiles) {
  const r = rel(f);
  if (r.startsWith('diagrams/rendered/')) continue;   // the mirror holds no prose
  const [meta, body] = frontMatter(readFileSync(f, 'utf8'));
  const depth = r.split('/').length - 1;
  const up = '../'.repeat(depth);
  const ctx = {
    mermaid: 0, unrendered: [], used: usedDiagrams, generated: generatedDiagrams, assetPrefix: up,
    diagrams: diagramsFor(f),
    resolveLink(href) {
      const [pathPart, hash = ''] = href.split('#');
      if (!pathPart) return href;
      const abs = new URL(pathPart, 'file:///' + dirname(r) + '/').pathname.slice(1);
      const fromRoot = pathPart.replace(/^\.?\//, '').replace(/^docs\//, '');
      for (const cand of [abs, fromRoot]) {
        if (known.has(cand)) return up + cand.replace(/\.md$/, '.html') + (hash ? '#' + hash : '');
        if (known.has(cand + '/README.md')) return up + cand + '/README.html' + (hash ? '#' + hash : '');
      }
      return null;   // a source path or something outside the docs tree
    },
    resolveAsset(href) {
      const abs = new URL(href.split('#')[0], 'file:///' + dirname(r) + '/').pathname.slice(1);
      const fromRoot = href.replace(/^\.?\//, '').replace(/^docs\//, '');
      for (const cand of [abs, fromRoot]) if (knownAssets.has(cand)) return up + cand;
      return null;
    },
  };
  const html = renderMarkdown(body, ctx);
  mermaidTotal += ctx.mermaid;
  unrenderedTotal = unrenderedTotal.concat(ctx.unrendered.map((u) => `${r}: ${u}`));

  const title = meta.title || (body.match(/^#\s+(.+)$/m) ?? [])[1] || basename(r, '.md');
  const facts = [
    meta.id && ['Identifier', esc(meta.id)],
    meta.area && ['Area', esc(meta.area)],
    Array.isArray(meta.adrs) && meta.adrs.length && ['Decisions', meta.adrs.map(esc).join(', ')],
    // A topic often names a dozen or more files. Listing them open pushes the writing itself
    // below the fold, so the count is the claim and the list is one click away.
    Array.isArray(meta.sources) && meta.sources.length
      && ['Sources read', `<details class="paths"><summary>${meta.sources.length} file`
        + `${meta.sources.length === 1 ? '' : 's'}</summary>`
        + `<p>${meta.sources.map((s) => `<code>${esc(s)}</code>`).join(' ')}</p></details>`],
    meta.verified_commit && ['Verified at', `<code>${esc(String(meta.verified_commit).slice(0, 12))}</code>`],
  ].filter(Boolean);
  const header = `<p class="eyebrow">${esc(dirname(r) === '.' ? 'Documentation' : dirname(r))}</p>`
    + `<h1>${esc(title)}</h1>`
    + (facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` : '');

  const outPath = join(OUT, pageFor(f));
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, shell(title, header + html, depth) + '\n');
  pages.push({ path: pageFor(f), title, section: r.split('/')[0].replace(/\.md$/, 'root'), rel: r, meta, diagrams: ctx.mermaid });
}

// ---------------------------------------------------------------- assets travel
let copied = 0;
for (const a of assets) {
  const r = rel(a);
  if (r.startsWith('diagrams/rendered/') && !usedDiagrams.has(r)) continue;  // unreferenced mirror art
  const dest = join(OUT, r);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(a, dest);
  copied++;
}

// Diagrams drawn for this stack travel with it, kept apart from the repository's own art so a
// reader can always tell which is which.
let generatedCopied = 0;
if (CACHE && generatedDiagrams.size) {
  const dest = join(OUT, 'diagrams', 'generated');
  mkdirSync(dest, { recursive: true });
  for (const name of generatedDiagrams) { copyFileSync(join(CACHE, name), join(dest, name)); generatedCopied++; }
}

// ---------------------------------------------------------------- section indexes
const SECTION_BLURB = {
  tutorials: 'Learning by doing: start here if you have never run the system.',
  'how-to': 'Recipes for a task you already know you need to perform.',
  reference: 'The exact shape of things: APIs, configuration, schemas, decision records.',
  explanation: 'Why the system is built the way it is.',
  diagrams: 'The codebase drawn as code, one topic at a time, each diagram generated from a '
    + 'mermaid source held in the repository and verified against a named commit.',
};
const bySection = new Map();
for (const p of pages) {
  const top = p.rel.includes('/') ? p.rel.split('/')[0] : '.';
  (bySection.get(top) ?? bySection.set(top, []).get(top)).push(p);
}

const table = (rows) => `<table><thead><tr><th>Page</th><th>About</th></tr></thead><tbody>${rows}</tbody></table>`;
const summarise = (p) => {
  if (p.meta.id) return `${p.meta.id}${p.diagrams ? ` · ${p.diagrams} diagram${p.diagrams === 1 ? '' : 's'}` : ''}`;
  return esc(p.rel);
};

for (const [section, items] of bySection) {
  if (section === '.') continue;
  items.sort((a, b) => a.rel.localeCompare(b.rel));
  if (section === 'diagrams') continue;   // handled below, it has a level of its own
  const rows = items.map((p) => `<tr><td><a href="${esc(relative(section, p.path) || basename(p.path))}">${esc(p.title)}</a></td>`
    + `<td>${summarise(p)}</td></tr>`).join('');
  const body = `<p class="eyebrow">Documentation</p><h1>${esc(section)}</h1>`
    + `<p class="lead">${esc(SECTION_BLURB[section] ?? '')}</p>`
    + `<p>${items.length} page${items.length === 1 ? '' : 's'}.</p>` + table(rows);
  mkdirSync(join(OUT, section), { recursive: true });
  writeFileSync(join(OUT, section, 'index.html'), shell(section, body, 1) + '\n');
}

// Diagrams get an area level, because 57 topics in one list is not a contents page.
const diagramPages = (bySection.get('diagrams') ?? []).filter((p) => p.rel.split('/').length === 3);
const diagramRoot = (bySection.get('diagrams') ?? []).filter((p) => p.rel.split('/').length === 2);
const areas = new Map();
for (const p of diagramPages) {
  const area = p.rel.split('/')[1];
  (areas.get(area) ?? areas.set(area, []).get(area)).push(p);
}
for (const [area, items] of areas) {
  items.sort((a, b) => a.rel.localeCompare(b.rel));
  const rows = items.map((p) => `<tr><td><a href="${esc(basename(p.path))}">${esc(p.title)}</a></td><td>${summarise(p)}</td></tr>`).join('');
  const n = items.reduce((s, p) => s + p.diagrams, 0);
  const body = `<p class="eyebrow">Diagrams</p><h1>${esc(area)}</h1>`
    + `<p>${items.length} topics, ${n} diagrams.</p>` + table(rows);
  mkdirSync(join(OUT, 'diagrams', area), { recursive: true });
  writeFileSync(join(OUT, 'diagrams', area, 'index.html'), shell(area, body, 2) + '\n');
}
{
  const rows = [...areas.entries()].sort().map(([area, items]) =>
    `<tr><td><a href="${esc(area)}/index.html">${esc(area)}</a></td>`
    + `<td>${items.length} topics, ${items.reduce((s, p) => s + p.diagrams, 0)} diagrams</td></tr>`).join('');
  const extra = diagramRoot.map((p) => `<li><a href="${esc(basename(p.path))}">${esc(p.title)}</a></li>`).join('');
  const body = '<p class="eyebrow">Documentation</p><h1>Diagrams</h1>'
    + `<p class="lead">${esc(SECTION_BLURB.diagrams)}</p>`
    + `<table><thead><tr><th>Area</th><th>Extent</th></tr></thead><tbody>${rows}</tbody></table>`
    + (extra ? `<h2>Across the whole corpus</h2><ul>${extra}</ul>` : '');
  writeFileSync(join(OUT, 'diagrams', 'index.html'), shell('Diagrams', body, 1) + '\n');
}

// ---------------------------------------------------------------- the stack landing
let revision = 'unknown';
try { revision = execSync('git rev-parse HEAD', { cwd: args.repo ?? SRC }).toString().trim(); } catch {}
const words = mdFiles.reduce((s, f) => s + readFileSync(f, 'utf8').split(/\s+/).length, 0);
const counts = [...bySection.entries()].filter(([s]) => s !== '.').sort()
  .map(([s, items]) => `<tr><td><a href="${esc(s)}/index.html">${esc(s)}</a></td><td>${items.length}</td>`
    + `<td>${esc(SECTION_BLURB[s] ?? '')}</td></tr>`).join('');
const rootPages = (bySection.get('.') ?? []).map((p) => `<li><a href="${esc(p.path)}">${esc(p.title)}</a></li>`).join('');
const landing = '<p class="eyebrow">The documentation the repository already carries</p>'
  + `<h1>${esc(PRODUCT)}, as documented in its own tree</h1>`
  + '<p class="lead">This is not written for the packs. It is the working documentation of the '
  + 'codebase, rendered here so it can be read in a browser: the same files an engineer with a '
  + 'checkout would open, in the same order, with every diagram shown as drawn and its source '
  + 'kept underneath.</p>'
  + `<table><thead><tr><th>Section</th><th>Pages</th><th>What it is for</th></tr></thead><tbody>${counts}</tbody></table>`
  + (rootPages ? `<h2>At the root</h2><ul>${rootPages}</ul>` : '')
  + '<h2>Extent</h2>'
  + `<table><tbody><tr><td>Pages rendered</td><td>${pages.length}</td></tr>`
  + `<tr><td>Words</td><td>${words.toLocaleString('en-GB')}</td></tr>`
  + `<tr><td>Diagrams shown</td><td>${usedDiagrams.size + generatedDiagrams.size} of ${mermaidTotal}</td></tr>`
  + `<tr><td>Drawn by the repository</td><td>${usedDiagrams.size}, held beside their topics</td></tr>`
  + `<tr><td>Drawn for this stack</td><td>${generatedDiagrams.size}, from mermaid the repository never rendered</td></tr>`
  + `<tr><td>Repository revision</td><td><code>${esc(revision.slice(0, 12))}</code></td></tr></tbody></table>`
  + '<h2>Reading a diagram topic</h2><p>A topic states the files it was checked against and the '
  + 'commit at which that was true. Where it cites a path, the path is shown as text rather than '
  + 'a link: the source itself is not published here, so a link would only fail.</p>';
writeFileSync(join(OUT, 'index.html'), shell('Contents', landing, 0) + '\n');

// ---------------------------------------------------------------- stylesheet
mkdirSync(join(OUT, 'assets'), { recursive: true });
writeFileSync(join(OUT, 'assets', 'docs.css'), readFileSync(new URL('../assets/docs.css', import.meta.url), 'utf8'));

console.log(`${pages.length} pages, ${usedDiagrams.size} corpus diagrams + ${generatedCopied} drawn here `
  + `= ${usedDiagrams.size + generatedCopied} of ${mermaidTotal} blocks; ${copied} assets copied`);
if (unrenderedTotal.length) {
  console.log(`${unrenderedTotal.length} mermaid block(s) had no rendered SVG and show as source only:`);
  for (const u of unrenderedTotal.slice(0, 12)) console.log('  ' + u);
}
