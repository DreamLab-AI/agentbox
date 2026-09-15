#!/usr/bin/env node
// Build a repository's diagrams-as-code corpus into a standalone, navigable pack.
//
// `docs-stack.mjs` renders a corpus as one section of the documentation stack, which is the
// right shape when the corpus is a part of a larger tree. A corpus of fifty-odd topics and
// four hundred diagrams is not a section: it is the drawn account of the whole system, and
// it deserves its own front door, its own rail, and its own statement of what has been
// verified and what has not. That is what this builds, in one invocation, from the corpus
// and the corpus's own generator.
//
// Three decisions worth stating, because they are what makes the output trustworthy rather
// than merely pretty:
//
//   The verification is shown, not implied. Every topic page says the revision it was
//   verified at and how that stands against HEAD; every diagram says how many of its
//   citations resolve and lists, neutrally, the ones that do not. A corpus is a catalogue at
//   a declared revision, and a pack that hid that would be claiming more than the corpus does.
//
//   The corpus's own generator is the authority on citations. This script prefers its
//   `--report <path>` JSON where the generator supports it, and parses the generator's
//   printed warnings where it does not, so the pack says what the checker said rather than
//   re-deriving a second opinion.
//
//   Everything is relative and local. The pack ships as a sealed directory whose entry point
//   is index.html and whose files are served by relative path, so no absolute path, no
//   remote font and no remote script may appear anywhere in it.
//
// Usage:
//   diagrams-pack.mjs --repo <root> [--dir docs/diagrams] --out <dir> --title <product>
//                     [--generator <path>] [--no-render] [--report <json>] [--no-register]
//
// --no-render skips asking the corpus generator to redraw its own art, which is right when
// the corpus already ships rendered SVGs. The handful of diagrams that live on the index
// pages themselves, and that no corpus ever rendered, are still drawn where mmdc is present:
// a fenced graph definition is not a diagram to a reader.
//
// Exit codes: 0 built and verified; 1 a verification failed; 2 bad invocation.
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname, relative, resolve, basename, sep } from 'node:path';
import { execFileSync, execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { render, renderInline, slug, escapeHtml, frontMatter } from './lib/markdown.mjs';

const runAsync = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- arguments
const args = (() => {
  const a = {}; const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    if (!v[i].startsWith('--')) continue;
    const k = v[i].slice(2), n = v[i + 1];
    a[k] = n === undefined || n.startsWith('--') ? true : (i++, n);
  }
  return a;
})();
const die = (msg, code = 2) => { console.error(`diagrams-pack: ${msg}`); process.exit(code); };

if (!args.repo || !args.out) die('need --repo <root> and --out <dir>');
const REPO = resolve(String(args.repo));
const OUT = resolve(String(args.out));
const PRODUCT = args.title === true || !args.title ? basename(REPO) : String(args.title);
const WANT_RENDER = args['no-render'] !== true;
const SHIP_REGISTER = args['no-register'] !== true;
if (!existsSync(REPO)) die(`--repo not found: ${REPO}`);

// ---------------------------------------------------------------- the corpus
// The same candidates diagram-corpus.mjs tries, so "the corpus" means one thing across the
// skill and a run that found one with the detector finds the same one here.
const CANDIDATES = ['docs/diagrams', 'docs/diagram', 'docs/architecture/diagrams', 'docs/design/diagrams', 'diagrams'];
const CORPUS = args.dir && args.dir !== true
  ? join(REPO, String(args.dir))
  : CANDIDATES.map((c) => join(REPO, c)).find((p) => existsSync(p) && statSync(p).isDirectory());
if (!CORPUS || !existsSync(CORPUS)) {
  die(`no diagrams-as-code corpus found under ${REPO} (tried ${(args.dir && args.dir !== true ? [args.dir] : CANDIDATES).join(', ')})`);
}
const corpusRel = relative(REPO, CORPUS).split(sep).join('/');

const git = (a) => {
  try { return execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return null; }
};
const HEAD = git(['rev-parse', 'HEAD']);
const TODAY = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- the generator
// The corpus's own generator first: it is the one that knows this corpus's rules. Then an
// explicit --generator. Then the diagrams-as-code skill's copy, which is the same tool
// packaged for a repository that has not got one.
const generatorPath = (() => {
  if (args.generator && args.generator !== true) {
    const p = resolve(String(args.generator));
    return existsSync(p) ? p : die(`--generator not found: ${p}`);
  }
  const own = join(CORPUS, 'tools', 'diagram-index-gen.cjs');
  if (existsSync(own)) return own;
  const sibling = resolve(HERE, '..', '..', 'diagrams-as-code', 'scripts', 'diagram-index-gen.cjs');
  return existsSync(sibling) ? sibling : null;
})();

// Whether this generator understands --report. The flag is new, and a generator that does
// not know it exits 2 on an unknown flag rather than ignoring it, so it is probed by reading
// the source rather than by running it and hoping.
const generatorSupportsReport = generatorPath
  ? /['"]--report['"]/.test(readFileSync(generatorPath, 'utf8'))
  : false;

mkdirSync(OUT, { recursive: true });
const reportPath = args.report && args.report !== true
  ? resolve(String(args.report))
  : join(OUT, '.diagram-report.json');

let generatorOutput = '';
let generatorStatus = 'not run';
let report = null;

if (args.report && args.report !== true && existsSync(reportPath) && !generatorPath) {
  // A report handed in without a generator: trust it.
  try { report = JSON.parse(readFileSync(reportPath, 'utf8')); generatorStatus = 'report supplied'; } catch { report = null; }
}

if (generatorPath) {
  const flags = [CORPUS, '--check', '--cite-check', '--worktree-citations'];
  if (WANT_RENDER) flags.push('--render');
  if (generatorSupportsReport) flags.push('--report', reportPath);
  process.stderr.write(`running ${relative(REPO, generatorPath) || generatorPath} ${flags.slice(1).join(' ')}\n`);
  // Both streams, because a checker prints its findings to whichever it prefers and the
  // pack has to publish them either way.
  const run = spawnSync('node', [generatorPath, ...flags], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  generatorOutput = String(run.stdout ?? '') + String(run.stderr ?? '');
  generatorStatus = run.status === 0 ? 'clean' : `exit ${run.status ?? '?'}`;
  if (generatorSupportsReport && existsSync(reportPath)) {
    try { report = JSON.parse(readFileSync(reportPath, 'utf8')); } catch { report = null; }
  }
}

// Citation warnings, from the report where there is one and from the generator's own printed
// lines where there is not. Both shapes end up in one map keyed by diagram id, plus a
// topic-level bucket for the warnings the generator does not attribute to a diagram.
const warningsByDiagram = new Map();
const warningsByTopicFile = new Map();
const push = (map, key, value) => { (map.get(key) ?? map.set(key, []).get(key)).push(value); };

if (report?.topics) {
  for (const t of report.topics) {
    for (const w of t.citations?.warnings ?? []) {
      if (w.diagram) push(warningsByDiagram, w.diagram, `${w.citation ? w.citation + ' — ' : ''}${w.message}`);
      else push(warningsByTopicFile, t.file, w.message);
    }
  }
} else if (generatorOutput) {
  for (const line of generatorOutput.split('\n')) {
    const m = line.match(/^\s*!\s+(\S+?)(?::([A-Z]{2,4}-\d+(?:\.\d+)?))?\s+-\s+(.*)$/);
    if (!m) continue;
    if (m[2]) push(warningsByDiagram, m[2], m[3].trim());
    else push(warningsByTopicFile, m[1], m[3].trim());
  }
}
const citeCheckRan = /cite-check:/.test(generatorOutput) || Boolean(report?.totals);

// ---------------------------------------------------------------- read the corpus
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
};
const corpusFiles = walk(CORPUS);
const cRel = (p) => relative(CORPUS, p).split(sep).join('/');

const ROOT_DOCS = { register: 'REGISTER.md', timeline: 'DECISIONS-TIMELINE.md', readme: 'README.md', coverage: 'COVERAGE.md' };
const HAS_REGISTER = existsSync(join(CORPUS, ROOT_DOCS.register));
const HAS_TIMELINE = existsSync(join(CORPUS, ROOT_DOCS.timeline));
const topicFiles = corpusFiles.filter((f) => f.endsWith('.md')
  && cRel(f).includes('/')
  && !cRel(f).startsWith('rendered/')
  && !cRel(f).startsWith('tools/'));

// A topic file's body divides into the two narratives and one section per diagram. The
// diagram sections are found by their heading, `## <id>.<n> <title>`, which is the contract
// the corpus's own checker enforces, so nothing has to be guessed from block order.
const CITATION = /[\w./-]+\.[A-Za-z]{1,6}:\d+(?:-\d+)?/g;

// A heading needs more than one anchor. GitHub's slug keeps an underscore, so `USE_DB` gives
// `...what-use_db-unset...`; the corpus's own generator drops it, and the register it wrote
// links to `...what-usedb-unset...`. Neither is wrong, and a pack that picked one would break
// every register link that happened to name an identifier with an underscore in it. So each
// heading carries its GitHub id and, where they differ, an empty alias the register can reach.
const altSlug = (text) => slug(text).replace(/_/g, '');
const anchors = (heading) => {
  const id = slug(heading);
  const alt = altSlug(heading);
  return { id, alias: alt === id ? null : alt };
};
const aliasTag = (a) => (a.alias ? `<span class="anchor-alias" id="${escapeHtml(a.alias)}"></span>` : '');

function parseTopic(file) {
  const [meta, body] = frontMatter(readFileSync(file, 'utf8'));
  if (!meta.id) return null;
  const lines = body.split('\n');
  const sections = [];
  let current = { heading: null, level: 0, lines: [] };
  for (const line of lines) {
    const h = line.match(/^(#{2,3})\s+(.*?)\s*$/);
    if (h && h[1].length === 2) { sections.push(current); current = { heading: h[2], level: 2, lines: [] }; continue; }
    current.lines.push(line);
  }
  sections.push(current);

  const narratives = [];
  const diagrams = [];
  const idPattern = new RegExp(`^(${meta.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.\\d+)\\s*(.*)$`);
  for (const s of sections) {
    if (!s.heading) continue;
    const m = s.heading.match(idPattern);
    if (m) {
      const text = s.lines.join('\n');
      const blocks = [...text.matchAll(/```mermaid\s*\n([\s\S]*?)\n```/g)].map((b) => b[1]);
      const prose = text.replace(/```mermaid\s*\n[\s\S]*?\n```/g, '').trim();
      const kind = (blocks[0] ?? '').trim().split('\n')[0].trim().split(/\s+/)[0] || 'diagram';
      const citations = new Set();
      for (const b of blocks) for (const c of b.match(CITATION) ?? []) citations.add(c);
      diagrams.push({ id: m[1], title: m[2].trim(), heading: s.heading, anchor: anchors(s.heading), kind, source: blocks.join('\n\n'), prose, citations: [...citations] });
      continue;
    }
    narratives.push({ heading: s.heading, anchor: anchors(s.heading), body: s.lines.join('\n').trim() });
  }
  return {
    id: meta.id,
    title: meta.title ?? meta.id,
    area: meta.area ?? cRel(file).split('/')[0],
    file: cRel(file),
    dir: dirname(cRel(file)),
    governing: [].concat(meta.governing ?? []),
    adrs: [].concat(meta.adrs ?? []),
    sources: [].concat(meta.sources ?? []),
    verified_commit: meta.verified_commit ?? meta.commit ?? null,
    worktree: meta.worktree ?? null,
    narratives,
    diagrams,
  };
}

const topics = topicFiles.map(parseTopic).filter(Boolean)
  .sort((a, b) => a.file.localeCompare(b.file, 'en'));
if (!topics.length) die(`the corpus at ${corpusRel} holds no topic files with front matter`, 1);

// Rendered art: rendered/<area>/<topic dir>/<DIAGRAM-ID>.svg
const svgFor = (topic, diagramId) => {
  const dirName = basename(topic.file, '.md');
  const p = join(CORPUS, 'rendered', topic.area, dirName, `${diagramId}.svg`);
  return existsSync(p) ? p : null;
};

// Freshness: for each declared revision, which of the topic's own sources moved since. The
// same computation diagram-corpus.mjs does, so the two never disagree about what is stale.
const repoName = basename(REPO);
const bareSha = (v) => {
  if (!v) return null;
  const keyed = [...String(v).matchAll(/([\w.-]+)\s*[@:]\s*([0-9a-f]{7,40})/g)];
  if (keyed.length) return (keyed.find(([, k]) => k === repoName) ?? keyed[0])[2];
  return (String(v).match(/\b[0-9a-f]{7,40}\b/) ?? [null])[0];
};
const changedCache = new Map();
const changedSince = (sha) => {
  if (!sha) return null;
  if (!changedCache.has(sha)) {
    const out = git(['diff', '--name-only', `${sha}..HEAD`]);
    changedCache.set(sha, out === null ? null : new Set(out.split('\n').filter(Boolean)));
  }
  return changedCache.get(sha);
};
for (const t of topics) {
  const bare = bareSha(t.verified_commit);
  t.sha = bare;
  const changed = changedSince(bare);
  t.movedSources = changed === null ? null : t.sources.filter((s) => changed.has(s));
  t.atHead = Boolean(bare && HEAD && HEAD.startsWith(bare));
}

const areas = new Map();
for (const t of topics) (areas.get(t.area) ?? areas.set(t.area, []).get(t.area)).push(t);

// ---------------------------------------------------------------- the page shell

const up = (depth) => '../'.repeat(depth);
const href = (target, depth) => up(depth) + target;

function rail(depth, active = {}) {
  const parts = [`<a class="rail-top${active.page === 'index' ? ' current' : ''}" href="${href('index.html', depth)}">The corpus</a>`];
  for (const [area, items] of [...areas.entries()].sort()) {
    const open = active.area === area ? ' open' : '';
    parts.push(`<details class="rail-area"${open}><summary><a href="${href(`areas/${area}/index.html`, depth)}">${escapeHtml(area)}</a>`
      + `<span class="count">${items.length}</span></summary><ul>`
      + items.map((t) => `<li${active.topic === t.id ? ' class="current"' : ''}>`
        + `<a href="${href(`topics/${t.id}.html`, depth)}"><b>${escapeHtml(t.id)}</b> ${escapeHtml(t.title)}</a></li>`).join('')
      + '</ul></details>');
  }
  // Only doors the corpus actually has: a rail entry for a page that was never written is a
  // broken link, and the build would rightly refuse it.
  if (SHIP_REGISTER && HAS_REGISTER) parts.push(`<a class="rail-top${active.page === 'register' ? ' current' : ''}" href="${href('register.html', depth)}">Register</a>`);
  if (HAS_TIMELINE) parts.push(`<a class="rail-top${active.page === 'timeline' ? ' current' : ''}" href="${href('timeline.html', depth)}">Decisions over time</a>`);
  return parts.join('');
}

const REVISION_LINE = () => {
  const revs = [...new Set(topics.map((t) => t.sha).filter(Boolean))];
  if (!revs.length) return 'no revision declared';
  if (revs.length === 1) return `verified at ${revs[0].slice(0, 7)}`;
  return `verified across ${revs.length} revisions`;
};

function shell(title, body, depth, active = {}) {
  return '<!doctype html><html lang="en"><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>${escapeHtml(title)} · ${escapeHtml(PRODUCT)} diagrams</title>`
    + `<link rel="stylesheet" href="${href('assets/docs.css', depth)}"><body>`
    + '<a class="skip" href="#main">Skip to content</a>'
    + `<header>${escapeHtml(PRODUCT.toUpperCase())} <span>The system, drawn</span></header>`
    + `<div class="layout"><nav aria-label="The corpus">${rail(depth, active)}</nav>`
    + `<main id="main">${body}`
    + `<footer class="pack-foot"><p>${escapeHtml(PRODUCT)}’s diagrams-as-code corpus, `
    + `${escapeHtml(REVISION_LINE())}${HEAD ? `, against HEAD <code>${escapeHtml(HEAD.slice(0, 7))}</code>` : ''}. `
    + `Built ${TODAY}.</p></footer>`
    + '</main></div>'
    + '<script>document.addEventListener("click",function(e){var i=e.target.closest(".diagram img");'
    + 'if(!i)return;e.preventDefault();i.closest("figure").classList.toggle("full");});'
    // With nineteen topics in an area, the rail's current entry is often below its own fold.
    + 'var n=document.querySelector("nav"),c=n&&n.querySelector("li.current");'
    + 'if(c)n.scrollTop=Math.max(0,c.offsetTop-n.clientHeight/2);</script>'
    + '</body></html>';
}

// ---------------------------------------------------------------- link resolution
// A link inside the corpus becomes a link inside the pack; a link out of it becomes text.
// Nothing in a sealed pack may point at a file the pack does not hold.
const topicByFile = new Map(topics.map((t) => [t.file, t]));

function resolver(baseDir, depth) {
  return (raw) => {
    const h = String(raw);
    if (/^(https?:|mailto:)/i.test(h)) return h;
    if (h.startsWith('#')) return h;
    const [pathPart, hash = ''] = h.split('#');
    if (!pathPart) return h;
    const abs = new URL(pathPart, `file:///${baseDir ? baseDir + '/' : ''}`).pathname.slice(1);
    const frag = hash ? '#' + hash : '';
    const t = topicByFile.get(abs);
    if (t) return href(`topics/${t.id}.html`, depth) + frag;
    if (abs === ROOT_DOCS.register) return SHIP_REGISTER ? href('register.html', depth) + frag : null;
    if (abs === ROOT_DOCS.timeline) return href('timeline.html', depth) + frag;
    if (abs === ROOT_DOCS.readme) return href('index.html', depth) + frag;
    return null;   // a source path, a record, or anything else the pack does not publish
  };
}

// ---------------------------------------------------------------- diagrams drawn here
// The index pages (the timeline especially) carry mermaid the corpus never rendered, because
// nothing in its own workflow needed a picture there. A reader does need one. These are
// rendered into the pack's own asset directory and labelled as drawn here, so the corpus's
// art and this build's art are never confused.
const generatedDir = join(OUT, 'assets', 'generated');
const generatedSvg = new Map();      // hash -> filename
const unrenderable = [];
async function renderExtras(blocks) {
  if (!blocks.length) return;
  mkdirSync(generatedDir, { recursive: true });
  let mmdcMissing = false;
  for (const [hash, source] of blocks) {
    const svg = join(generatedDir, `${hash}.svg`);
    if (existsSync(svg) && statSync(svg).size > 200) { generatedSvg.set(hash, `${hash}.svg`); continue; }
    const mmd = join(generatedDir, `${hash}.mmd`);
    writeFileSync(mmd, source + '\n');
    try {
      await runAsync('mmdc', ['-i', mmd, '-o', svg, '-b', 'transparent'], { timeout: 120000, cwd: generatedDir });
      generatedSvg.set(hash, `${hash}.svg`);
    } catch (e) {
      if (/ENOENT/.test(String(e.message))) mmdcMissing = true;
      unrenderable.push(hash);
    } finally {
      try { rmSync(mmd, { force: true }); } catch {}
    }
  }
  if (mmdcMissing) process.stderr.write('mermaid CLI (mmdc) not found: index-page diagrams ship as source only\n');
}

// ---------------------------------------------------------------- svg handling
// An SVG from mermaid declares width="100%" and no height, so inside an <img> it collapses to
// the default 150px box and a page of lazily-loaded diagrams jumps under the reader as each
// one arrives. The proportions were never wrong; the space was unknown. So the root gets
// explicit dimensions from its own viewBox on the way past.
function withIntrinsicSize(svg) {
  const end = svg.indexOf('>');
  if (end < 0) return svg;
  let root = svg.slice(0, end);
  const vb = root.match(/viewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/i);
  if (!vb) return svg;
  root = root.replace(/\swidth\s*=\s*["'][^"']*["']/i, '').replace(/\sheight\s*=\s*["'][^"']*["']/i, '');
  root = root.replace(/max-width:\s*[^;"']*;?/i, '');
  root = root.replace(/^<svg/i, `<svg width="${vb[1]}" height="${vb[2]}"`);
  return root + svg.slice(end);
}

// ---------------------------------------------------------------- topic pages
const missingArt = [];
const copiedSvgs = [];
let diagramCount = 0, citationCount = 0, warningCount = 0;

// A forty-participant sequence diagram is three times the reading measure, and its labels are
// its content. Two ways to show it: scroll it sideways at a readable size, or fit it to the
// measure and let the reader open it. Fitting wins here, because the fitted view still carries
// the shape — how many participants, how many branches, where the long stretch is — and one
// labelled click gets the labels. The drawn width is still read, to say how much was given up.
function drawnWidth(path) {
  try {
    const head = readFileSync(path, 'utf8').slice(0, 1200);
    const vb = head.match(/viewBox\s*=\s*["']\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/i);
    return vb ? Math.round(Number(vb[1])) : null;
  } catch { return null; }
}

const factRow = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many ?? one + 's'}`;

function revisionNote(t) {
  if (!t.sha) return 'no revision declared';
  const short = escapeHtml(t.sha.slice(0, 7));
  if (t.atHead) return `<code>${short}</code>, which is HEAD`;
  if (t.movedSources === null) return `<code>${short}</code>, a revision this checkout cannot resolve`;
  if (!t.movedSources.length) return `<code>${short}</code>; none of its sources has changed since`;
  return `<code>${short}</code>; ${plural(t.movedSources.length, 'of its sources has', 'of its sources have')} changed since`;
}

function citationVerdict(d) {
  const warns = warningsByDiagram.get(d.id) ?? [];
  const n = d.citations.length;
  if (!n) return '<p class="verdict none">This diagram cites no source lines.</p>';
  if (!citeCheckRan) return `<p class="verdict none">${plural(n, 'citation')}; the citation checker was not run for this build.</p>`;
  if (!warns.length) return `<p class="verdict ok">${plural(n, 'citation')} resolve at the declared revision, with no warnings.</p>`;
  warningCount += warns.length;
  return `<p class="verdict warn">${plural(n, 'citation')}, ${plural(warns.length, 'with a warning', 'with warnings')} from the corpus’s own checker:</p>`
    + `<ul class="verdict-list">${warns.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>`;
}

mkdirSync(join(OUT, 'topics'), { recursive: true });

for (const [area, items] of areas) items.sort((a, b) => a.file.localeCompare(b.file, 'en'));

for (const t of topics) {
  const depth = 1;
  const resolveLink = resolver(t.dir, depth);
  const md = (text) => render(text, { resolveLink, resolveImage: () => null, headingShift: 1, headingAlias: altSlug });

  const facts = [
    factRow('Identifier', `<code>${escapeHtml(t.id)}</code>`),
    factRow('Area', `<a href="${href(`areas/${t.area}/index.html`, depth)}">${escapeHtml(t.area)}</a>`),
    factRow('Verified at', revisionNote(t)),
    t.worktree ? factRow('Read from the working tree on', escapeHtml(String(t.worktree))) : '',
    t.governing.length ? factRow('Governed by', t.governing.map((g) => `<code>${escapeHtml(g)}</code>`).join(' ')) : '',
    t.adrs.length ? factRow('Decisions', t.adrs.map((a) => `<code>${escapeHtml(a)}</code>`).join(' ')) : '',
    t.sources.length ? factRow('Sources read',
      `<details class="paths"><summary>${plural(t.sources.length, 'file')}</summary><p>`
      + t.sources.map((s) => `<code>${escapeHtml(s)}</code>`).join(' ') + '</p></details>') : '',
  ].filter(Boolean).join('');

  const narrativeHtml = t.narratives.map((n) => `<section class="narrative">${aliasTag(n.anchor)}`
    + `<h2 id="${escapeHtml(n.anchor.id)}">${renderInline(n.heading)}</h2>${md(n.body)}</section>`).join('');

  const diagramHtml = t.diagrams.map((d) => {
    diagramCount++;
    citationCount += d.citations.length;
    const art = svgFor(t, d.id);
    const rel = art ? `assets/diagrams/${t.area}/${basename(t.file, '.md')}/${d.id}.svg` : null;
    if (!art) missingArt.push(`${t.id} ${d.id}`);
    else if (!copiedSvgs.some((c) => c.rel === rel)) copiedSvgs.push({ src: art, rel });
    const w = art ? drawnWidth(art) : null;
    const wide = w && w > 1400;
    const figure = art
      ? `<figure class="diagram"><img src="${href(rel, depth)}" alt="${escapeHtml(d.id)}: ${escapeHtml(d.title)}" loading="lazy">`
        + `<figcaption><code>${escapeHtml(d.id)}</code> · ${escapeHtml(d.kind)}`
        + (wide ? ` · drawn ${w}px wide and fitted to the page` : '')
        + ' · <b>click the diagram to read it at full size</b></figcaption></figure>'
      : '<p class="notice">This diagram has no rendered art in the corpus, so only its source is '
        + 'shown. That is a gap in the corpus rather than in this page.</p>';
    return `<section class="diagram-topic">${aliasTag(d.anchor)}`
      + `<h2 id="${escapeHtml(d.anchor.id)}">${renderInline(d.heading)}</h2>`
      + figure
      + `<details class="as-code"><summary>This diagram as code</summary><pre><code>${escapeHtml(d.source)}</code></pre></details>`
      + (d.prose ? md(d.prose) : '')
      + citationVerdict(d)
      + '</section>';
  }).join('');

  const siblings = areas.get(t.area);
  const at = siblings.indexOf(t);
  const prev = siblings[at - 1], next = siblings[at + 1];
  const nav = `<nav class="prevnext" aria-label="Within ${escapeHtml(t.area)}">`
    + (prev ? `<a class="prev" href="${href(`topics/${prev.id}.html`, depth)}"><span>Previous</span>${escapeHtml(prev.title)}</a>` : '<span></span>')
    + (next ? `<a class="next" href="${href(`topics/${next.id}.html`, depth)}"><span>Next</span>${escapeHtml(next.title)}</a>` : '<span></span>')
    + '</nav>';

  const body = `<p class="eyebrow"><a href="${href(`areas/${t.area}/index.html`, depth)}">${escapeHtml(t.area)}</a></p>`
    + `<h1>${escapeHtml(t.title)}</h1>`
    + `<p class="lead">${plural(t.diagrams.length, 'diagram')}, drawn from ${plural(t.sources.length, 'source file')}.</p>`
    + `<dl class="facts">${facts}</dl>`
    + narrativeHtml + diagramHtml + nav;
  writeFileSync(join(OUT, 'topics', `${t.id}.html`), shell(t.title, body, depth, { area: t.area, topic: t.id }) + '\n');
}

// ---------------------------------------------------------------- area pages
for (const [area, items] of [...areas.entries()].sort()) {
  const depth = 2;
  const dgs = items.reduce((s, t) => s + t.diagrams.length, 0);
  const rows = items.map((t) => `<tr><td><a href="${href(`topics/${t.id}.html`, depth)}"><b>${escapeHtml(t.id)}</b> ${escapeHtml(t.title)}</a></td>`
    + `<td>${t.diagrams.length}</td><td>${revisionNote(t)}</td></tr>`).join('');
  const body = `<p class="eyebrow"><a href="${href('index.html', depth)}">The corpus</a></p>`
    + `<h1>${escapeHtml(area)}</h1>`
    + `<p class="lead">${plural(items.length, 'topic')}, ${plural(dgs, 'diagram')}.</p>`
    + '<table><thead><tr><th>Topic</th><th>Diagrams</th><th>Verified at</th></tr></thead>'
    + `<tbody>${rows}</tbody></table>`;
  mkdirSync(join(OUT, 'areas', area), { recursive: true });
  writeFileSync(join(OUT, 'areas', area, 'index.html'), shell(area, body, depth, { area }) + '\n');
}

// ---------------------------------------------------------------- register and timeline
const extraBlocks = new Map();
function collectFences(text) {
  for (const m of text.matchAll(/```mermaid\s*\n([\s\S]*?)\n```/g)) {
    extraBlocks.set(createHash('sha256').update(m[1]).digest('hex').slice(0, 24), m[1]);
  }
}
const registerSrc = existsSync(join(CORPUS, ROOT_DOCS.register)) ? readFileSync(join(CORPUS, ROOT_DOCS.register), 'utf8') : null;
const timelineSrc = existsSync(join(CORPUS, ROOT_DOCS.timeline)) ? readFileSync(join(CORPUS, ROOT_DOCS.timeline), 'utf8') : null;
if (SHIP_REGISTER && registerSrc) collectFences(registerSrc);
if (timelineSrc) collectFences(timelineSrc);
await renderExtras([...extraBlocks.entries()]);

function rootDocPage(name, src, title, lead, active) {
  const depth = 0;
  const [, body] = frontMatter(src);
  const onFence = (lang, code) => {
    if (lang !== 'mermaid') return `<pre><code>${escapeHtml(code)}</code></pre>`;
    const hash = createHash('sha256').update(code).digest('hex').slice(0, 24);
    const file = generatedSvg.get(hash);
    const source = `<details class="as-code"><summary>This diagram as code</summary><pre><code>${escapeHtml(code)}</code></pre></details>`;
    if (!file) {
      return '<figure class="diagram"><p class="notice">This diagram is shown as source only: the '
        + 'corpus holds no rendered copy of it and nothing here could draw it.</p>' + source + '</figure>';
    }
    return `<figure class="diagram"><img src="assets/generated/${escapeHtml(file)}" alt="${escapeHtml(title)} diagram" loading="lazy">`
      + '<figcaption>drawn for this pack from the source below · click the diagram for full size</figcaption>'
      + `</figure>${source}`;
  };
  // The document's own opening title is dropped: this page already carries one, and two
  // headings saying the same thing read as a fault rather than as emphasis.
  const trimmed = body.replace(/^\s*#\s+.*$/m, '');
  const html = render(trimmed, { resolveLink: resolver('', depth), resolveImage: () => null, onFence, headingShift: 1, headingAlias: altSlug });
  const page = `<p class="eyebrow"><a href="index.html">The corpus</a></p><h1>${escapeHtml(title)}</h1>`
    + `<p class="lead">${lead}</p><div class="doc">` + html + '</div>';
  writeFileSync(join(OUT, name), shell(title, page, depth, { page: active }) + '\n');
}

if (SHIP_REGISTER && registerSrc) {
  rootDocPage('register.html', registerSrc, 'The register',
    'Every tension, debt item, drift between record and code, open question and stated invariant '
    + 'the corpus found, each one linked to the diagram it was found in. It catalogues; it proposes nothing.',
    'register');
}
if (timelineSrc) {
  rootDocPage('timeline.html', timelineSrc, 'Decisions over time',
    'The same material in time order: which decision each mechanism came from, and which '
    + 'decisions were later amended, deferred or reversed.', 'timeline');
}

// ---------------------------------------------------------------- the front door
{
  const depth = 0;
  const totalDiagrams = topics.reduce((s, t) => s + t.diagrams.length, 0);
  const totalCitations = topics.reduce((s, t) => s + t.diagrams.reduce((n, d) => n + d.citations.length, 0), 0);
  const revisions = [...new Set(topics.map((t) => t.sha).filter(Boolean))];
  const staleTopics = topics.filter((t) => (t.movedSources ?? []).length > 0);
  const warned = new Set([...warningsByDiagram.keys()]);
  const warnedDiagrams = topics.reduce((s, t) => s + t.diagrams.filter((d) => warned.has(d.id)).length, 0);
  const totalWarnings = [...warningsByDiagram.values()].reduce((s, v) => s + v.length, 0)
    + [...warningsByTopicFile.values()].reduce((s, v) => s + v.length, 0);

  const cards = [...areas.entries()].sort().map(([area, items]) => {
    const dgs = items.reduce((s, t) => s + t.diagrams.length, 0);
    return `<a class="area-card" href="areas/${escapeHtml(area)}/index.html"><h3>${escapeHtml(area)}</h3>`
      + `<p>${plural(items.length, 'topic')} · ${plural(dgs, 'diagram')}</p>`
      + `<p class="card-topics">${items.slice(0, 4).map((t) => escapeHtml(t.title)).join(' · ')}`
      + `${items.length > 4 ? ' · …' : ''}</p><span class="state">Open →</span></a>`;
  }).join('');

  const verification = [
    ['Topics', String(topics.length)],
    ['Diagrams', String(totalDiagrams)],
    ['Source citations inside diagrams', String(totalCitations)],
    ['Declared revisions', revisions.length ? revisions.map((r) => `<code>${escapeHtml(r.slice(0, 7))}</code>`).join(' ') : 'none'],
    ['HEAD of this checkout', HEAD ? `<code>${escapeHtml(HEAD.slice(0, 7))}</code>` : 'not a git checkout'],
    ['Topics whose own sources moved since their declared revision', String(staleTopics.length)],
    ['Citation check', citeCheckRan
      ? `run by the corpus’s own generator; ${totalWarnings === 0 ? 'no warnings' : `${plural(totalWarnings, 'warning')} across ${plural(warnedDiagrams, 'diagram')}`}`
      : 'not run for this build'],
  ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');

  const doors = [
    SHIP_REGISTER && registerSrc ? `<a class="area-card" href="register.html"><h3>The register</h3>`
      + '<p>What the corpus found that is not settled: tensions, debt, drift, open questions, invariants.</p>'
      + '<span class="state">Open →</span></a>' : '',
    timelineSrc ? '<a class="area-card" href="timeline.html"><h3>Decisions over time</h3>'
      + '<p>The same material in time order, including the decisions that were later reversed.</p>'
      + '<span class="state">Open →</span></a>' : '',
  ].filter(Boolean).join('');

  const stale = staleTopics.length
    ? `<p>${plural(staleTopics.length, 'topic')} cite${staleTopics.length === 1 ? 's' : ''} a source that has changed since `
      + 'the revision it was verified at. Those topics are not wrong; they are unverified at today’s code, and each '
      + 'topic page says so. The rest stand as checked.</p>'
    : '<p>No topic cites a source that has moved since the revision it was verified at.</p>';

  const body = '<p class="eyebrow">Diagrams as code</p>'
    + `<h1>${escapeHtml(PRODUCT)}, drawn</h1>`
    + `<p class="lead">${plural(totalDiagrams, 'machine-checked diagram')} of the whole system across `
    + `${plural(topics.length, 'topic')} and ${plural(areas.size, 'area')}. Every diagram is generated from a `
    + 'source held in the repository, cites the code it was drawn from, and sits inside two narratives: one for '
    + 'the engineer who inherits the code, one for the business that owns the product.</p>'
    + '<h2>What has been checked, and what that means</h2>'
    + '<p>A corpus is a catalogue at a declared revision, not a live view of the code. Each topic names the '
    + 'commit it was verified against and the files it was read from, and the corpus’s own checker resolves '
    + 'every <code>path:line</code> citation inside every diagram against those files. This pack was built by '
    + 'running that checker and publishing what it said.</p>'
    + `<table class="extent"><tbody>${verification}</tbody></table>`
    + stale
    + '<h2>The areas</h2>'
    + `<div class="cards">${cards}</div>`
    + (doors ? `<h2>Two further doors</h2><div class="cards">${doors}</div>` : '')
    + '<h2>Reading a topic</h2>'
    + '<p>A topic opens with the facts it rests on, then the two narratives, then its diagrams in order. Each '
    + 'diagram shows the drawing, keeps the mermaid that produced it one click below, and ends with how its '
    + 'citations resolved. Click any diagram to see it at full size. Where a topic cites a file this pack does '
    + 'not publish, the path is shown as text rather than as a link that could only fail.</p>';
  writeFileSync(join(OUT, 'index.html'), shell('The corpus', body, depth, { page: 'index' }) + '\n');
}

// ---------------------------------------------------------------- assets
mkdirSync(join(OUT, 'assets'), { recursive: true });
const baseCss = readFileSync(new URL('../assets/docs.css', import.meta.url), 'utf8');
writeFileSync(join(OUT, 'assets', 'docs.css'), baseCss + '\n' + PACK_CSS());

for (const { src, rel } of copiedSvgs) {
  const dest = join(OUT, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, withIntrinsicSize(readFileSync(src, 'utf8')));
}
for (const [hash, file] of generatedSvg) {
  const p = join(generatedDir, file);
  if (existsSync(p)) writeFileSync(p, withIntrinsicSize(readFileSync(p, 'utf8')));
}
if (!args.report || args.report === true) { try { rmSync(reportPath, { force: true }); } catch {} }

// ---------------------------------------------------------------- verification
// A pack that is wrong in a way the reader can see is worse than no pack. Three things are
// checked before this script will claim success: art for every diagram, every internal link
// resolving to a file the pack holds, and no placeholder left in the prose.
const failures = [];
if (WANT_RENDER && missingArt.length) {
  failures.push(`${plural(missingArt.length, 'diagram')} have no rendered SVG in the corpus: ${missingArt.slice(0, 8).join(', ')}`
    + `${missingArt.length > 8 ? ' …' : ''}. Re-run the generator with --render, or build with --no-render.`);
}

const pages = walk(OUT).filter((f) => f.endsWith('.html'));
const anchorsOf = new Map();
for (const p of pages) {
  const text = readFileSync(p, 'utf8');
  anchorsOf.set(p, new Set([...text.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
}
const broken = [], missingAnchors = [];
for (const p of pages) {
  const text = readFileSync(p, 'utf8');
  for (const m of text.matchAll(/\shref="([^"]+)"/g)) {
    const raw = m[1];
    if (/^(https?:|mailto:)/i.test(raw)) continue;
    const [pathPart, hash = ''] = raw.split('#');
    const target = pathPart ? resolve(dirname(p), pathPart) : p;
    if (!existsSync(target)) { broken.push(`${relative(OUT, p)} → ${raw}`); continue; }
    if (hash && anchorsOf.has(target) && !anchorsOf.get(target).has(hash)) missingAnchors.push(`${relative(OUT, p)} → ${raw}`);
  }
  for (const m of text.matchAll(/\ssrc="([^"]+)"/g)) {
    if (/^(https?:|data:)/i.test(m[1])) continue;
    if (!existsSync(resolve(dirname(p), m[1]))) broken.push(`${relative(OUT, p)} → ${m[1]}`);
  }
}
if (broken.length) failures.push(`${plural(broken.length, 'internal link')} point at a file the pack does not hold: ${[...new Set(broken)].slice(0, 6).join(', ')}`);

// Placeholders this build could have left behind. Corpus prose is the target's own writing
// and is not policed here; what is policed is an unfilled template in the pack's own shell.
const PLACEHOLDER = /(\{\{[^}]*\}\}|\bLorem ipsum\b|\bTK TK\b|\bFIXME\b|<!--\s*TODO)/i;
const placeholders = [];
for (const p of pages) {
  const shellOnly = readFileSync(p, 'utf8').replace(/<main id="main">[\s\S]*<\/main>/, '');
  if (PLACEHOLDER.test(shellOnly)) placeholders.push(relative(OUT, p));
  const visible = readFileSync(p, 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, ' ');
  if (/\{\{[^}]*\}\}|\bLorem ipsum\b/i.test(visible)) placeholders.push(relative(OUT, p));
}
if (placeholders.length) failures.push(`placeholder text remains in ${[...new Set(placeholders)].slice(0, 6).join(', ')}`);

if (missingAnchors.length) {
  process.stderr.write(`${plural(missingAnchors.length, 'link')} inside the pack name an anchor the target page does not carry `
    + `(a corpus cross-reference that no longer matches a heading): ${[...new Set(missingAnchors)].slice(0, 6).join(', ')}\n`);
}
if (unrenderable.length) {
  process.stderr.write(`${plural(unrenderable.length, 'index-page diagram')} could not be drawn and ship as source only\n`);
}
if (generatorStatus !== 'clean' && generatorStatus !== 'not run') {
  process.stderr.write(`the corpus generator exited non-zero (${generatorStatus}); its findings are published in the pack\n`);
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`);
  process.exit(1);
}

const totalWarnings = [...warningsByDiagram.values()].reduce((s, v) => s + v.length, 0)
  + [...warningsByTopicFile.values()].reduce((s, v) => s + v.length, 0);
console.log(`Built diagrams pack: ${topics.length} topics, ${diagramCount} diagrams, ${citationCount} citations checked, `
  + `${totalWarnings} warnings; revision ${HEAD ? HEAD.slice(0, 7) : 'unknown'}.`);

// ---------------------------------------------------------------- pack stylesheet
// Added to the house CSS rather than replacing it: the type, palette and reading measure are
// the packs', and only the pieces this shape needs are new.
function PACK_CSS() {
  return `
/* --- the diagrams pack ------------------------------------------------------ */
.layout{grid-template-columns:270px minmax(0,1fr)}
nav{font-size:14px}
nav a{border-bottom:0;padding:7px 10px}
.rail-top{font-weight:750;border-bottom:1px solid var(--line) !important;padding:10px !important}
.rail-top.current{color:var(--accent)}
.rail-area{border-bottom:1px solid var(--line)}
.rail-area>summary{cursor:pointer;padding:9px 10px;font-weight:700;display:flex;gap:8px;align-items:baseline}
.rail-area>summary::marker{color:var(--muted)}
.rail-area>summary a{display:inline;padding:0}
.rail-area .count{margin-left:auto;color:var(--muted);font-weight:400}
.rail-area ul{list-style:none;margin:0 0 8px;padding:0 0 0 6px}
.rail-area li{margin:0;padding:0;border-left:2px solid var(--line)}
.rail-area li.current{border-left-color:var(--accent);background:var(--surface)}
.rail-area li.current>a{color:var(--accent)}
.rail-area li a{font-size:13.5px;line-height:1.4}
.rail-area li b{font-family:ui-monospace,monospace;font-size:12px;color:var(--muted);margin-right:4px}

.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px;margin:26px 0 10px}
.area-card{display:block;padding:20px;background:var(--surface);border:1px solid var(--line);text-decoration:none}
.area-card:hover{border-color:var(--accent)}
.area-card h3{margin:0 0 8px;font-size:19px}
.area-card p{margin:0 0 6px;font-size:14.5px;color:var(--muted);max-width:none}
.area-card .card-topics{font-size:13px;line-height:1.5}
.area-card .state{font-size:13px;font-weight:700;color:var(--accent)}
.extent td:first-child{width:56%}

section.diagram-topic{margin-top:52px;padding-top:6px;border-top:1px solid var(--line)}
section.diagram-topic>h2{margin-top:18px}
section.narrative>h2{margin-top:40px}
/* No height cap: a tall diagram capped to the viewport is scaled down until its labels stop
   being readable, and the labels are the content. Tall means long here, and wide means the
   figure scrolls. */
figure.diagram{overflow-x:auto}
figure.diagram img{cursor:zoom-in;padding:14px;width:auto;max-width:100%;height:auto}
figure.diagram.full img{cursor:zoom-out;max-width:none;min-width:0}

/* A generated document read as a page: its own title is dropped, and its first two columns
   are identifiers, which must not wrap to four lines to make room for a note that can wrap. */
.table-wrap{overflow-x:auto;margin:22px 0}
.table-wrap>table{margin:0}
.doc table td:first-child{white-space:nowrap;width:1%;color:var(--muted);font-family:ui-monospace,monospace;font-size:13px}
.doc table td:nth-child(2){min-width:11ch;max-width:22ch}
.doc table th:first-child,.doc table th:nth-child(2){white-space:nowrap}
.anchor-alias{display:block;height:0;overflow:hidden}

.verdict{font-size:14.5px;padding:10px 14px;border-left:4px solid var(--line);background:var(--surface);margin:20px 0 0}
.verdict.ok{border-left-color:var(--accent)}
.verdict.warn{border-left-color:var(--caution);margin-bottom:0}
.verdict.none{color:var(--muted)}
.verdict-list{font-size:13.5px;color:var(--muted);background:var(--surface);margin:0;padding:10px 14px 12px 34px;border-left:4px solid var(--caution)}
.verdict-list li{margin-bottom:5px}

.prevnext{display:flex;justify-content:space-between;gap:20px;margin:56px 0 0;padding-top:20px;border-top:1px solid var(--line)}
.prevnext a{max-width:46%;font-weight:650;text-decoration:none}
.prevnext .next{text-align:right;margin-left:auto}
.prevnext span{display:block;font-size:13px;font-weight:400;color:var(--muted)}
.pack-foot{margin-top:70px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:14px}
@media(max-width:920px){.layout{display:block}nav{display:block;max-height:none}}
`;
}
