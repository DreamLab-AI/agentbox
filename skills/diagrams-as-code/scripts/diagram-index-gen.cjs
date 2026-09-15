#!/usr/bin/env node
'use strict';

/*
 * diagram-index-gen.cjs — the diagrams-as-code checker, index generator and
 * reporter. Walk a corpus tree (conventionally `docs/diagrams`), parse each
 * topic file's YAML frontmatter, validate every fenced ```mermaid block and the
 * narrative sections around it, resolve every `path:line` citation against the
 * revision the topic declares, render through `mmdc`, and (re)generate the
 * machine-readable indexes.
 *
 * Zero dependencies. Node >= 18. Optional: `mmdc` (Mermaid CLI) for --render,
 * `git` for citation resolution at a declared revision.
 *
 * Usage:  node diagram-index-gen.cjs <corpus-dir> [flags]
 *
 *   --check              validate only; do not write README.md / COVERAGE.md /
 *                        REGISTER.md (still exits 1 on error).
 *   --cite-check         resolve every `path:line` citation inside a diagram
 *                        against that topic's own `sources:` list and assert the
 *                        line exists and is not blank / punctuation. Reads the
 *                        file at the topic's declared `verified_commit`
 *                        (`git show`), or the working tree when the topic
 *                        declares `worktree:`. Warns, never fails, unless
 *                        --strict-citations.
 *   --strict-citations   fail on any citation diagnostic.
 *   --worktree-citations read working-tree bytes for every topic, ignoring shas.
 *   --no-source-paths    skip the `sources:`/`governing:` existence checks (a
 *                        hosted CI checkout has no sibling repositories);
 *                        --cite-check is meaningless with it and --strict-
 *                        citations is refused with it.
 *   --render             render every mermaid block through `mmdc` into
 *                        <corpus>/rendered/<topic>/<id>.svg; any parse error
 *                        fails the run, and any render wider than 4500px fails
 *                        as illegible.
 *   --jobs N             render concurrency (default 6).
 *   --only S             restrict to topic files whose relative path contains S.
 *   --report <path>      write a JSON report of the whole corpus (topics,
 *                        diagrams, citation results, register counts, totals).
 *                        Works with or without --cite-check / --render; the
 *                        fields those populate are empty when they did not run.
 *
 * Exit codes: 0 ok, 1 validation/render error, 2 usage / IO error.
 *
 * ---------------------------------------------------------------------------
 * Topic-file contract (one file = one topic, many diagrams, two narratives)
 * ---------------------------------------------------------------------------
 *
 *   ---
 *   id: CP-03                          # <AREA-PREFIX>-<NN>, unique tree-wide
 *   title: The SCR executor
 *   area: control-plane                # = directory name; prefix must match
 *   governing: [docs/explanation/engineering-lane.md]   # repo-relative, exists
 *   adrs: [ADR-014, ADR-023]           # design records this topic evidences
 *   sources: [control-plane/src/scr/executor.ts, ...]   # repo-relative, exists
 *   verified_commit: 8cbdb7ae6346e9d7981acac249a47f7341b35bc7
 *   # or, for a corpus spanning repositories:
 *   # verified_commit: {campaignbuilder: c3028b0, co-created: 4f1a9de}
 *   worktree: 2026-09-07               # OPTIONAL: sources were read from a
 *                                      # dirty working tree on this date
 *   ---
 *   ## For developers          (required narrative section, any length)
 *   ## For the business        (required narrative section, any length)
 *   ## CP-03.1 <diagram title>
 *   ```mermaid
 *   ...
 *   ```
 *   **Why it is this way.** ...      (optional labelled paragraphs after)
 *   **Tension:** ...   (register markers: Tension|Debt|Drift|Open|Invariant)
 *
 * Register markers are collected from BOTH labelled prose paragraphs
 * (`**Tension:** text`) and mermaid Notes / node labels (`TENSION: text`,
 * `DEBT:`, `DRIFT:`, `OPEN:`, `INVARIANT:`) into REGISTER.md, each with a
 * backlink to the topic and diagram it lives in.
 *
 * Every mermaid block must sit under an H2 whose first token is `<topic-id>.<n>`;
 * that token is the diagram id and must be unique across the tree.
 * README.md's generated block, COVERAGE.md and REGISTER.md are build artefacts.
 *
 * ---------------------------------------------------------------------------
 * Zero-config derivation, and the optional config file
 * ---------------------------------------------------------------------------
 *
 * With no config file the tool derives everything it needs:
 *   * areas        = the corpus's immediate subdirectories holding topic files
 *   * id prefixes  = the prefix the topics in each area actually declare (all
 *                    topics in one area must agree)
 *   * repo root    = <corpus>/../..  (override with `repoRoot`)
 *   * repo keys    = for a `../`-relative source, the basename of the git
 *                    toplevel that owns it; otherwise the repo root's basename.
 *                    These are the keys a `{repo: sha}` map addresses.
 *
 * `<corpus>/diagrams.config.json` pins any of it, and supplies the one thing
 * that cannot be derived — which source trees the coverage report measures:
 *
 *   {
 *     "repoRoot": "../..",                            // from the corpus dir
 *     "defaultRepoKey": "campaignbuilder",
 *     "areas": { "business": "BL", "estate": "ES" },  // also fixes the order
 *     "skipDirs": ["legacy"],
 *     "coverageRoots": ["control-plane/src", "foreman/src"],
 *     "adrDir": "docs/reference/adr",
 *     "genCommand": "node docs/diagrams/tools/diagram-index-gen.cjs docs/diagrams"
 *   }
 */

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const DEFAULT_SKIP_DIRS = ['rendered', 'tools', 'scripts', 'hero', 'archive', 'src', 'assets', 'node_modules'];
const SKIP_FILES = new Set(['README.md', 'COVERAGE.md', 'REGISTER.md', 'DECISIONS-TIMELINE.md', 'CONTRIBUTING.md']);
const MAX_WIDTH = 4500; // px — wider renders are illegible at any zoom
const REQUIRED = ['id', 'title', 'area', 'governing', 'adrs', 'sources', 'verified_commit'];
const NARRATIVE_H2 = ['For developers', 'For the business'];
const REGISTER_KINDS = ['Tension', 'Debt', 'Drift', 'Open', 'Invariant'];
// Extensions that count as a source file for the "uncovered sources" report.
const COVERAGE_EXT = /\.(ts|tsx|mjs|cjs|js|jsx|rs|py|go|sh|yaml|yml|toml|json|Caddyfile)$|(^|\/)(Dockerfile[^/]*|Caddyfile|Makefile)$/;
const COVERAGE_SKIP = /(^|\/)(node_modules|dist|target|build|coverage|\.claude-flow|\.agentic-qe|\.secrets|media|__pycache__)(\/|$)|\.test\.|\.spec\.|\.d\.ts$|pending-insights|\.gitkeep|package-lock|pnpm-lock|Cargo\.lock|\.vscodeignore|\.dockerignore|\.gitignore|\.env\.example|\.svg$|\.css$/;

function usage(msg) {
  if (msg) console.error(msg);
  console.error('Usage: node diagram-index-gen.cjs <corpus-dir> [--check] [--render] [--cite-check] [--strict-citations] [--worktree-citations] [--no-source-paths] [--jobs N] [--only S] [--report PATH]');
  process.exit(2);
}

const argv = process.argv.slice(2);
if (argv.length < 1) usage();
const root = path.resolve(argv[0]);
const flags = {
  check: false, render: false, cite: false, jobs: 6, only: null,
  strictCitations: false, worktreeCitations: false, noSourcePaths: false, report: null,
};
for (let i = 1; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--check') flags.check = true;
  else if (a === '--render') flags.render = true;
  else if (a === '--cite-check') flags.cite = true;
  else if (a === '--strict-citations') { flags.cite = true; flags.strictCitations = true; }
  else if (a === '--worktree-citations') { flags.cite = true; flags.worktreeCitations = true; }
  else if (a === '--no-source-paths') flags.noSourcePaths = true;
  else if (a === '--jobs') flags.jobs = parseInt(argv[++i], 10) || 6;
  else if (a === '--only') flags.only = argv[++i];
  else if (a === '--report') flags.report = argv[++i];
  else usage(`unknown flag ${a}`);
}
if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) usage(`not a directory: ${root}`);
if (flags.strictCitations && flags.noSourcePaths) usage('--strict-citations requires source paths; do not combine with --no-source-paths');
if (flags.report !== null && !String(flags.report).trim()) usage('--report needs a path');

// ---------------------------------------------------------------- config
const CONFIG_PATH = path.join(root, 'diagrams.config.json');
let cfg = {};
if (fs.existsSync(CONFIG_PATH)) {
  try { cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch (e) { usage(`${CONFIG_PATH}: ${e.message}`); }
}
const repoRoot = path.resolve(root, cfg.repoRoot || path.join('..', '..'));
const DEFAULT_REPO_KEY = (cfg.defaultRepoKey || path.basename(repoRoot)).toLowerCase();
const SKIP_DIRS = new Set([...DEFAULT_SKIP_DIRS, ...(cfg.skipDirs || [])]);
const COVERAGE_ROOTS = cfg.coverageRoots || [];
// area directory -> id prefix. Derived from the topics themselves unless pinned.
const AREAS = new Map(Object.entries(cfg.areas || {}));
const AREAS_PINNED = AREAS.size > 0;
const GEN_COMMAND = cfg.genCommand
  || `node ${path.relative(repoRoot, __filename) || __filename} ${path.relative(repoRoot, root) || root}`;

// ---------------------------------------------------------------- walk
function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name) || ent.name.startsWith('.')) continue;
      walk(path.join(dir, ent.name), out);
    } else if (ent.isFile() && ent.name.endsWith('.md')) {
      if (dir === root) continue; // topic files live in area subdirs only
      if (SKIP_FILES.has(ent.name)) continue;
      out.push(path.join(dir, ent.name));
    }
  }
  return out;
}

/* Derive the area -> id-prefix map from the tree when the config does not pin
 * it: every topic file's directory is an area, and the prefix is the one its
 * own topics declare. A disagreement inside one area is an error. */
function deriveAreas(files, errors) {
  if (AREAS_PINNED) return;
  const seen = new Map(); // area dir -> Map(prefix -> first topic seen with it)
  for (const f of files) {
    const rel = path.relative(root, f);
    const dir = rel.split(path.sep)[0];
    const head = fs.readFileSync(f, 'utf8').slice(0, 4096);
    const m = head.match(/^id:\s*["']?([A-Za-z]{2,4})-\d/m);
    if (!m) continue; // a missing or malformed id is reported by parseTopic
    if (!seen.has(dir)) seen.set(dir, new Map());
    if (!seen.get(dir).has(m[1])) seen.get(dir).set(m[1], rel);
  }
  for (const [dir, prefixes] of [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (prefixes.size > 1) {
      errors.push(`area '${dir}': its topics declare ${prefixes.size} different id prefixes (${[...prefixes.keys()].join(', ')}); one area, one prefix — or pin "areas" in diagrams.config.json`);
    }
    AREAS.set(dir, [...prefixes.keys()][0]);
  }
}

// ---------------------------------------------------------------- yaml (minimal)
function parseScalar(s) {
  s = s.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}
function parseInline(s) {
  s = s.trim();
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map(parseScalar).filter(Boolean);
  }
  return parseScalar(s);
}
function parseFrontmatter(text, file, errors) {
  if (!text.startsWith('---\n')) { errors.push(`${file}: missing frontmatter`); return null; }
  const end = text.indexOf('\n---', 4);
  if (end < 0) { errors.push(`${file}: unterminated frontmatter`); return null; }
  const block = text.slice(4, end).split('\n');
  const fm = {};
  let key = null;
  for (const raw of block) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const m = raw.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (m) {
      key = m[1];
      const v = m[2].replace(/\s+#.*$/, '').trim();
      fm[key] = v === '' ? [] : parseInline(v);
    } else if (/^\s*-\s+/.test(raw) && key) {
      if (!Array.isArray(fm[key])) fm[key] = [];
      fm[key].push(parseScalar(raw.replace(/^\s*-\s+/, '').replace(/\s+#.*$/, '')));
    } else {
      errors.push(`${file}: unparseable frontmatter line: ${raw}`);
    }
  }
  return { fm, body: text.slice(end + 4) };
}

// ---------------------------------------------------------------- parse topic files
const REG_NEAR_MISS_RE = new RegExp(`^\\s*(?:>\\s*)?\\*\\*(?:${REGISTER_KINDS.join('|')})\\b`);
// The text may start on the label's own line or on the next one (a label at the end of
// a wrapped line is common); the paragraph collector below gathers the rest either way.
const REG_PROSE_RE = new RegExp(`^\\s*(?:>\\s*)?\\*\\*(${REGISTER_KINDS.join('|')})(?:\\s*\\(([^)]*)\\))?:\\*\\*\\s*(.*)$`);
// A marker inside a diagram runs to the end of its label (a quote or a closing
// bracket); `<br/>` line breaks are part of the text and are flattened to spaces.
const REG_MERMAID_RE = new RegExp(`\\b(${REGISTER_KINDS.map((k) => k.toUpperCase()).join('|')}):\\s*((?:<br\\s*/?>|[^"\\]<])+)`, 'g');

function parseTopic(file, errors) {
  const rel = path.relative(root, file);
  const text = fs.readFileSync(file, 'utf8');
  const parsed = parseFrontmatter(text, rel, errors);
  if (!parsed) return null;
  const { fm, body } = parsed;
  for (const k of REQUIRED) if (!(k in fm)) errors.push(`${rel}: missing frontmatter field '${k}'`);
  for (const k of ['governing', 'adrs', 'sources']) if (k in fm && !Array.isArray(fm[k])) fm[k] = [fm[k]];
  if (fm.area && !AREAS.has(fm.area)) errors.push(`${rel}: area '${fm.area}' not in ${[...AREAS.keys()].join('|')}`);
  const areaDir = rel.split(path.sep)[0];
  if (fm.area && areaDir !== fm.area) errors.push(`${rel}: area '${fm.area}' does not match directory '${areaDir}'`);
  if (fm.id && !/^[A-Z]{2,4}-\d{2,3}$/.test(fm.id)) errors.push(`${rel}: id '${fm.id}' must match /^[A-Z]{2,4}-\\d{2,3}$/`);
  if (fm.id && fm.area && AREAS.has(fm.area) && !String(fm.id).startsWith(AREAS.get(fm.area) + '-')) errors.push(`${rel}: id '${fm.id}' must carry the '${AREAS.get(fm.area)}-' prefix for area '${fm.area}'`);
  {
    const v = fm.verified_commit;
    const SHA = /^[0-9a-f]{7,40}$/;
    let ok = false;
    if (typeof v === 'string' && v.trim().startsWith('{')) {
      const pairs = v.trim().slice(1, -1).split(',').map((x) => x.split(':').map((y) => y.trim()));
      ok = pairs.length > 0 && pairs.every(([k, sha]) => k && SHA.test(sha || ''));
    } else ok = SHA.test(String(v || ''));
    if (!ok) errors.push(`${rel}: verified_commit '${v}' is not a git sha (7-40 hex) or a {repo: sha} map`);
  }
  if ('worktree' in fm && !/^\d{4}-\d{2}-\d{2}$/.test(String(fm.worktree))) errors.push(`${rel}: worktree '${fm.worktree}' must be a YYYY-MM-DD date`);
  if (!flags.noSourcePaths) {
    for (const s of fm.sources || []) {
      const p = s.split(':')[0];
      if (!fs.existsSync(path.join(repoRoot, p))) errors.push(`${rel}: source path does not exist: ${p}`);
    }
    for (const g of fm.governing || []) {
      const p = g.split('#')[0];
      if (!fs.existsSync(path.join(repoRoot, p))) errors.push(`${rel}: governing doc does not exist: ${p}`);
    }
  }

  // headings + mermaid blocks + narrative + register markers
  const lines = body.split('\n');
  const diagrams = [];
  const register = [];
  const h2s = [];
  let currentH2 = null;
  let inFence = false, fenceLang = null, fenceStart = 0, buf = [];
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (!inFence) {
      const f = ln.match(/^```(\w*)/);
      if (f) { inFence = true; fenceLang = f[1]; fenceStart = i; buf = []; continue; }
      const h = ln.match(/^##\s+(\S+)\s*(.*)$/);
      if (h) { currentH2 = { id: h[1], title: h[2].trim(), line: i, full: `${h[1]} ${h[2]}`.trim() }; h2s.push(currentH2.full); continue; }
      const rm = ln.match(REG_PROSE_RE);
      // A bold label that starts with a marker word but does not match the contract
      // (`**Tension (scope)** — …`, `**Debt, resolved 2026-09-15:**`) renders normally and
      // silently vanishes from the register. Refuse it: a marker nobody can find is a
      // marker nobody will resolve (nine such were found by hand on 2026-09-15).
      if (!rm && REG_NEAR_MISS_RE.test(ln)) errors.push(`${rel}:${i + 1}: looks like a register marker but does not parse — write \`**Kind:**\` or \`**Kind (scope):**\` (a resolution goes in the text, after an em dash)`);
      if (rm) {
        // A marker paragraph may wrap over several lines; it ends at a blank line, a
        // heading, a fence, a list item, a table row, or the next labelled paragraph.
        let mtext = rm[3].trim();
        let j = i + 1;
        while (j < lines.length) {
          const nx = lines[j].replace(/^\s*>\s?/, '');
          if (!nx.trim() || /^#{1,6}\s/.test(nx) || /^```/.test(nx) || /^\s*[-*]\s/.test(nx) || /^\s*\*\*[A-Z][A-Za-z ]*(\([^)]*\))?[.:]\*\*/.test(nx) || /^\s*\|/.test(nx)) break;
          mtext += ' ' + nx.trim();
          j++;
        }
        register.push({ kind: rm[1], scope: rm[2] || '', text: mtext, diagram: currentH2 && /\.\d+$/.test(currentH2.id) ? currentH2 : null, line: i + 1 });
        i = j - 1;
      }
    } else {
      if (ln.startsWith('```')) {
        inFence = false;
        if (fenceLang === 'mermaid') {
          if (!currentH2) errors.push(`${rel}: mermaid block at line ${fenceStart + 1} has no H2 heading`);
          else {
            const expect = new RegExp(`^${(fm.id || '').replace('-', '\\-')}\\.\\d+$`);
            if (!expect.test(currentH2.id)) errors.push(`${rel}: H2 id '${currentH2.id}' must be '${fm.id}.<n>'`);
            const src = buf.join('\n');
            for (const m of src.matchAll(/rect\s+rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
              const lum = 0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3];
              if (lum < 140) errors.push(`${rel}:${currentH2.id} - dark rect fill rgb(${m[1]},${m[2]},${m[3]}) makes message text unreadable; use a pastel (luminance >= 140)`);
            }
            if (/^\s*(mindmap|pie|quadrantChart|journey)\b/m.test(src)) errors.push(`${rel}:${currentH2.id} - forbidden diagram kind (no information density)`);
            // stateDiagram `note ... end note` blocks span lines; join each block so a
            // marker that wraps is collected whole.
            const joined = src.replace(/(note\s+(?:left|right)\s+of\s+\w+\s*\n)([\s\S]*?)(\n\s*end note)/g, (m0, a, nbody, c) => a + nbody.split('\n').map((l) => l.trim()).join(' ') + c);
            for (const mm of joined.matchAll(REG_MERMAID_RE)) register.push({ kind: mm[1][0] + mm[1].slice(1).toLowerCase(), scope: '', text: mm[2].replace(/<br\s*\/?>/g, ' ').trim(), diagram: currentH2, line: fenceStart + 1, inDiagram: true });
            diagrams.push({ id: currentH2.id, title: currentH2.title, src, line: fenceStart + 1, kind: (buf[0] || '').trim().split(/\s/)[0] });
          }
        }
        continue;
      }
      buf.push(ln);
    }
  }
  if (inFence) errors.push(`${rel}: unterminated code fence`);
  if (diagrams.length === 0) errors.push(`${rel}: no mermaid diagrams`);
  for (const need of NARRATIVE_H2) if (!h2s.some((h) => h.toLowerCase() === need.toLowerCase())) errors.push(`${rel}: missing narrative section '## ${need}'`);
  return { file, rel, fm, diagrams, register, citeChecked: 0, citeWarnings: [] };
}

// ---------------------------------------------------------------- citation check
const CITE_RE = /([A-Za-z0-9_./-]*[A-Za-z0-9_-]\.[A-Za-z0-9]{1,12}|(?:^|[\s"(\[<>/])(?:Dockerfile(?:\.[A-Za-z0-9_-]+)?|Caddyfile)):(\d+)(?:\s*-\s*(\d+))?/g;

/* Which repository owns a cited path, and under which key a {repo: sha} map
 * addresses it. A `../`-relative path is resolved and attributed to the git
 * toplevel that contains it; everything else belongs to the corpus's own repo. */
const topLevelCache = new Map();
function gitToplevel(abs) {
  if (topLevelCache.has(abs)) return topLevelCache.get(abs);
  let dir = abs;
  let found = null;
  for (;;) {
    if (fs.existsSync(path.join(dir, '.git'))) { found = dir; break; }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  topLevelCache.set(abs, found);
  return found;
}
function repoOf(p) {
  const clean = p.replace(/^\.\//, '');
  if (!clean.startsWith('../')) return { key: DEFAULT_REPO_KEY, rel: clean, abs: repoRoot };
  const abs = path.resolve(repoRoot, clean);
  const top = gitToplevel(path.dirname(abs)) || path.dirname(abs);
  return { key: path.basename(top).toLowerCase(), rel: path.relative(top, abs), abs: top };
}
function shaFor(t, repoKey) {
  const v = t.fm.verified_commit;
  if (!v) return null;
  if (typeof v === 'string' && v.trim().startsWith('{')) {
    for (const pair of v.trim().slice(1, -1).split(',')) {
      const [k, sha] = pair.split(':').map((x) => x.trim());
      if (k && sha && k.toLowerCase() === repoKey) return sha;
    }
    return null;
  }
  return repoKey === DEFAULT_REPO_KEY && /^[0-9a-f]{7,40}$/.test(String(v)) ? String(v) : null;
}
const revCache = new Map();
function revisionLines(t, p) {
  const r = repoOf(p);
  const useWT = flags.worktreeCitations || ('worktree' in t.fm);
  const sha = !useWT && r ? shaFor(t, r.key) : null;
  const key = `${sha || 'WT'}:${p}`;
  if (revCache.has(key)) return revCache.get(key);
  let lines = null;
  if (sha) {
    try {
      const out = execFileSync('git', ['-C', r.abs, 'show', `${sha}:${r.rel}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
      lines = out.split('\n');
    } catch { lines = null; }
  }
  if (!lines) { try { lines = fs.readFileSync(path.join(repoRoot, p), 'utf8').split('\n'); } catch { lines = null; } }
  revCache.set(key, lines);
  return lines;
}

/* Citation diagnostics are structured — {topic, diagram, citation, message} —
 * so the console line and the JSON report render from one shape. */
function citeText(w) {
  return `${w.topic}${w.diagram ? ':' + w.diagram : ''} - ${w.citation ? w.citation + ' ' : ''}${w.message}`;
}

function citeCheck(topics) {
  const warnings = [];
  const BARE_RE = /(^|[^A-Za-z0-9_./:-]):(\d+)(?:\s*-\s*(\d+))?(?![\d.])/g;
  for (const t of topics) {
    const linesOf = (p) => revisionLines(t, p);
    const emit = (d, citation, message) => {
      t.citeWarnings.push({ diagram: d ? d.id : null, citation, message });
      warnings.push({ topic: t.rel, diagram: d ? d.id : null, citation, message });
    };
    for (const d of t.diagrams) {
      const check = (cited, a, b) => {
        cited = cited.trim().replace(/^[\s"(\[<>/]/, '');
        if (/^\d+(\.\d+)+$/.test(cited)) return; // host:port
        t.citeChecked++;
        const srcPaths = (t.fm.sources || []).map((s) => s.split(':')[0]);
        const exact = srcPaths.filter((sp) => sp === cited || sp === './' + cited);
        const hits = exact.length ? exact : srcPaths.filter((sp) => sp.endsWith('/' + cited));
        if (hits.length === 0) { emit(d, `${cited}:${a}`, "cites a file that is not in this topic's sources: (unresolvable, never checked)"); return; }
        if (hits.length > 1) { emit(d, `${cited}:${a}`, `is ambiguous: matches ${hits.length} sources: entries`); return; }
        const src = hits[0];
        const lines = linesOf(src);
        if (!lines) { emit(d, src, 'could not be read'); return; }
        for (const n of [a, b].filter(Boolean).map(Number)) {
          if (n > lines.length) emit(d, `${src}:${n}`, `past EOF (file has ${lines.length} lines)`);
        }
        const n = Number(a);
        if (n <= lines.length) {
          const txt = (lines[n - 1] || '').trim();
          if (!txt) emit(d, `${src}:${n}`, 'is blank');
          else if (/^[)\]}>;,]+$/.test(txt)) emit(d, `${src}:${n}`, `is punctuation only ('${txt}')`);
        }
      };
      const text = d.src.replace(/\\n/g, '\n');
      const partFile = new Map();
      for (const pm of text.matchAll(/^[ \t]*(?:participant|actor)\s+(\w+)(?:\s+as\s+(.+))?$/gm)) {
        const c = new RegExp(CITE_RE.source).exec(pm[2] || '');
        partFile.set(pm[1], c ? c[1] : null);
      }
      const lineContext = (line) => {
        const msg = /^[ \t]*(\w+)\s*(?:-->>|->>|-->|->|--x|-x|--\)|-\))\s*[+-]?\s*(\w+)\s*:/.exec(line);
        const note = /^[ \t]*Note\s+(?:over|left of|right of)\s+(\w+)(?:\s*,\s*(\w+))?\s*:/.exec(line);
        const ids = msg ? [msg[1], msg[2]] : note ? [note[1], note[2]].filter(Boolean) : [];
        if (!ids.length) return null;
        for (const id of ids) if (partFile.get(id)) return partFile.get(id);
        return ids.some((id) => partFile.has(id)) ? 'UNBOUND' : null;
      };
      let lastPath = null;
      for (const rawLine of text.split('\n')) {
        const line = rawLine.replace(/:(\d+)((?:,\s*\d+)+)/g, (m0, a, rest) => ':' + a + rest.replace(/,\s*(\d+)/g, ' :$1'));
        const paths = [];
        const stripped = line.replace(CITE_RE, (m0, cited, a, b, off) => {
          paths.push({ cited, off });
          lastPath = cited;
          check(cited, a, b);
          return ' '.repeat(m0.length);
        });
        for (const bm of stripped.matchAll(BARE_RE)) {
          const off = bm.index + bm[1].length;
          const before = paths.filter((p) => p.off < off);
          const lc = before.length ? null : lineContext(line);
          if (lc === 'UNBOUND') { emit(d, `:${bm[2]}`, 'bare citation on a message whose participant is declared without a path'); continue; }
          const ctx = before.length ? before[before.length - 1].cited : (lc || lastPath);
          if (!ctx) { emit(d, `:${bm[2]}`, "bare citation has no path anywhere before it (qualify it, or write 'port NNNN')"); continue; }
          check(ctx, bm[2], bm[3]);
        }
      }
    }
  }
  return warnings;
}

// A participant labelled with a function name should cite a line inside that
// function's body. TypeScript-aware: `function name`, `const name =`, `name(` methods.
const PART_RE = /^[ \t]*(?:participant|actor)\s+\w+\s+as\s+(.+)$/gm;
const FN_RE = /\b([a-zA-Z_][a-zA-Z0-9_]{3,})\b/g;
function symbolCheck(topics) {
  const warnings = [];
  for (const t of topics) {
    const linesOf = (p) => revisionLines(t, p);
    for (const m of t.diagrams.map((d) => d.src).join('\n').matchAll(PART_RE)) {
      const label = m[1];
      const c = new RegExp(CITE_RE.source).exec(label);
      if (!c) continue;
      const [, citedRaw, a, b] = c, cited = citedRaw.trim(), ln = +a, end = b ? +b : ln;
      const hits = (t.fm.sources || []).filter((s) => { const sp = s.split(':')[0]; return sp === cited || sp.endsWith('/' + cited); });
      if (hits.length !== 1) continue;
      const src = hits[0].split(':')[0], lines = linesOf(src);
      if (!lines || ln > lines.length) continue;
      const near = lines.slice(Math.max(0, ln - 4), ln + 3).join('\n');
      const names = [...new Set([...label.slice(0, c.index).replace(/<br\s*\/?>/g, ' ').matchAll(FN_RE)].map((x) => x[1]))].filter((n) => !/^(participant|actor|the|and|for|with|from|into|over)$/i.test(n));
      if (names.length > 1 || /^\s*,\s*\d+/.test(label.slice(c.index + c[0].length))) continue;
      for (const name of names) {
        if (near.includes(name)) continue;
        const def = new RegExp(`^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s+${name}\\b|^\\s*(?:export\\s+)?(?:const|let)\\s+${name}\\s*[=:(]|^\\s*(?:public|private|protected|static|async|\\s)*${name}\\s*\\(`);
        const at = lines.reduce((acc, txt, i) => (def.test(txt) ? acc.concat(i + 1) : acc), []);
        if (at.length !== 1) continue;
        let depth = 0, endOfBody = at[0], seen = false;
        for (let i = at[0] - 1; i < lines.length; i++) {
          for (const ch of lines[i]) { if (ch === '{') { depth++; seen = true; } else if (ch === '}') depth--; }
          if (seen && depth <= 0) { endOfBody = i + 1; break; }
        }
        if ((ln < at[0] - 3 && end < at[0]) || ln > endOfBody) {
          const w = { topic: t.rel, diagram: null, citation: `${src}:${ln}`, message: `is labelled '${name}' but that symbol spans :${at[0]}-${endOfBody}` };
          t.citeWarnings.push({ diagram: null, citation: w.citation, message: w.message });
          warnings.push(w);
        }
      }
    }
  }
  return warnings;
}

// ---------------------------------------------------------------- render
function renderedDir(t) { return path.join(root, 'rendered', t.rel.replace(/\.md$/, '')); }
function renderOne(topic, d, outDir) {
  return new Promise((resolve) => {
    const mmd = path.join(outDir, `${d.id}.mmd`);
    const svg = path.join(outDir, `${d.id}.svg`);
    fs.writeFileSync(mmd, d.src + '\n');
    const child = spawn('mmdc', ['-i', mmd, '-o', svg, '-q'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (c) => { err += c.toString(); });
    child.stdout.on('data', (c) => { err += c.toString(); });
    child.on('error', (e) => resolve(`${topic.rel}:${d.id} - cannot spawn mmdc (${e.message}); install the Mermaid CLI or skip --render`));
    child.on('close', (code) => {
      if (code === 0) {
        try {
          const svgText = fs.readFileSync(svg, 'utf8');
          const vb = svgText.match(/viewBox="[\d.\-]+ [\d.\-]+ ([\d.]+) ([\d.]+)"/);
          const w = vb ? Math.round(+vb[1]) : 0;
          if (w > MAX_WIDTH) return resolve(`${topic.rel}:${d.id} (md line ${d.line}) - rendered ${w}px wide (max ${MAX_WIDTH}); wrap long Notes with <br/> or split the diagram`);
        } catch (e) { /* ignore census failure */ }
        return resolve(null);
      }
      const m = err.match(/Parse error on line (\d+):[\s\S]*?\n([\s\S]*?)(?:\n\s+at |$)/);
      const detail = m ? `mermaid line ${m[1]}: ${m[2].split('\n').slice(0, 3).join(' | ')}` : err.split('\n').filter((l) => l.trim() && !/^\s+at /.test(l)).slice(0, 3).join(' | ');
      resolve(`${topic.rel}:${d.id} (md line ${d.line}) - ${detail}`);
    });
  });
}
async function renderAll(topics) {
  const jobs = [];
  for (const t of topics) {
    const outDir = renderedDir(t);
    fs.mkdirSync(outDir, { recursive: true });
    for (const d of t.diagrams) jobs.push(() => renderOne(t, d, outDir));
  }
  const errors = [];
  let next = 0;
  async function worker() {
    while (next < jobs.length) {
      const j = jobs[next++];
      const e = await j();
      if (e) errors.push(e);
    }
  }
  await Promise.all(Array.from({ length: Math.min(flags.jobs, jobs.length) }, worker));
  return { errors, count: jobs.length };
}

// ---------------------------------------------------------------- coverage of source tree
function listCoverageSources() {
  const out = [];
  const walkSrc = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, ent.name);
      const rel = path.relative(repoRoot, p);
      if (COVERAGE_SKIP.test(rel + (ent.isDirectory() ? '/' : ''))) continue;
      if (ent.isDirectory()) walkSrc(p);
      else if (COVERAGE_EXT.test(rel)) out.push(rel);
    }
  };
  for (const r of COVERAGE_ROOTS) walkSrc(path.join(repoRoot, r));
  return out.sort();
}

// ---------------------------------------------------------------- indexes
function slug(id, title) {
  return `${id} ${title}`.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}
/* Hops from the corpus root (where README.md and COVERAGE.md are written) back
 * to the repo root, so generated links resolve wherever the corpus sits. */
const UP = path.relative(root, repoRoot).split(path.sep).join('/') || '.';
function writeIndexes(topics) {
  const byArea = Object.fromEntries([...AREAS.keys()].map((a) => [a, []]));
  for (const t of topics) byArea[t.fm.area].push(t);
  for (const k of Object.keys(byArea)) byArea[k].sort((a, b) => a.fm.id.localeCompare(b.fm.id, undefined, { numeric: true }));
  const total = topics.reduce((n, t) => n + t.diagrams.length, 0);

  // README table (regenerated block between markers)
  const readme = path.join(root, 'README.md');
  let text = fs.existsSync(readme) ? fs.readFileSync(readme, 'utf8') : '';
  const START = '<!-- BEGIN GENERATED DIAGRAM INDEX -->', END = '<!-- END GENERATED DIAGRAM INDEX -->';
  const rows = [];
  for (const area of AREAS.keys()) {
    if (!byArea[area] || byArea[area].length === 0) continue;
    rows.push(`\n### ${area}\n`);
    rows.push('| ID | Topic | Diagrams | Kinds | Governing | ADRs |');
    rows.push('|----|-------|----------|-------|-----------|------|');
    for (const t of byArea[area]) {
      const kinds = [...new Set(t.diagrams.map((d) => d.kind))].join(', ');
      const gov = t.fm.governing.map((g) => `[${path.basename(g.split('#')[0])}](${UP}/${g})`).join(', ');
      rows.push(`| ${t.fm.id} | [${t.fm.title}](${t.rel}) | ${t.diagrams.length} | ${kinds} | ${gov} | ${t.fm.adrs.join(', ')} |`);
    }
  }
  const gen = `${START}\n_${topics.length} topic files, ${total} diagrams. Regenerate with_ \`${GEN_COMMAND}\`.\n${rows.join('\n')}\n${END}`;
  if (text.includes(START) && text.includes(END)) {
    text = text.slice(0, text.indexOf(START)) + gen + text.slice(text.indexOf(END) + END.length);
  } else {
    text = text.trimEnd() + '\n\n## Diagram index\n\n' + gen + '\n';
  }
  fs.writeFileSync(readme, text);

  // COVERAGE.md
  const adrIdx = new Map(), govIdx = new Map(), srcIdx = new Map();
  for (const t of topics) {
    for (const a of t.fm.adrs) { if (!adrIdx.has(a)) adrIdx.set(a, []); adrIdx.get(a).push(t); }
    for (const g of t.fm.governing) { const k = g.split('#')[0]; if (!govIdx.has(k)) govIdx.set(k, []); govIdx.get(k).push(t); }
    for (const s of t.fm.sources) { const k = s.split(':')[0]; if (!srcIdx.has(k)) srcIdx.set(k, []); srcIdx.get(k).push(t); }
  }
  const sortKeys = (m) => [...m.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const out = [];
  out.push(`<!-- GENERATED BY ${path.basename(__filename)} - DO NOT EDIT BY HAND -->`);
  out.push('# Diagram coverage index\n');
  const vcs = new Set();
  const dirty = [];
  for (const t of topics) {
    const v = t.fm.verified_commit;
    if (typeof v === 'string' && v.trim().startsWith('{')) {
      for (const pair of v.trim().slice(1, -1).split(',')) { const [k, sha] = pair.split(':').map((x) => x.trim()); if (k && sha) vcs.add(`${k}@${sha}`); }
    } else vcs.add(String(v));
    if ('worktree' in t.fm) dirty.push(`${t.fm.id} (${t.fm.worktree})`);
  }
  out.push(`${topics.length} topic files · ${total} diagrams · declared source revisions: ${[...vcs].sort().join(', ')}\n`);
  if (dirty.length) out.push(`Topics whose sources were read from a dirty working tree (\`worktree:\` set), so the stamp means "sha plus the uncommitted change set of that date": ${dirty.join(', ')}\n`);
  out.push('Revision labels are author declarations. This index checks structure and references, not semantic accuracy. Run `--cite-check` for line-level citation resolution and `--render` for Mermaid grammar.\n');
  out.push('## Diagrams\n');
  out.push('| Diagram | Kind | Topic file |');
  out.push('|---------|------|------------|');
  for (const area of AREAS.keys()) for (const t of byArea[area] || []) for (const d of t.diagrams) out.push(`| [${d.id} ${d.title}](${t.rel}#${slug(d.id, d.title)}) | ${d.kind} | ${t.fm.id} |`);
  out.push('\n## By ADR\n');
  out.push('| ADR | Topic files |');
  out.push('|-----|-------------|');
  for (const k of sortKeys(adrIdx)) out.push(`| ${k} | ${adrIdx.get(k).map((t) => `[${t.fm.id}](${t.rel})`).join(', ')} |`);
  // ADRs on disk that no topic evidences (only when the config names the directory)
  if (cfg.adrDir && fs.existsSync(path.join(repoRoot, cfg.adrDir))) {
    const onDisk = fs.readdirSync(path.join(repoRoot, cfg.adrDir)).filter((f) => /^ADR-\d+/.test(f)).map((f) => f.match(/^(ADR-\d+)/)[1]);
    const missing = onDisk.filter((a) => !adrIdx.has(a));
    out.push(`\nADRs on disk with no evidencing topic: ${missing.length ? missing.join(', ') : 'none'}\n`);
  }
  out.push('\n## By governing document\n');
  out.push('| Governing doc | Topic files |');
  out.push('|---------------|-------------|');
  for (const k of sortKeys(govIdx)) out.push(`| [${k}](${UP}/${k}) | ${govIdx.get(k).map((t) => `[${t.fm.id}](${t.rel})`).join(', ')} |`);
  out.push('\n## By source path\n');
  out.push('| Source | Topic files |');
  out.push('|--------|-------------|');
  for (const k of sortKeys(srcIdx)) out.push(`| \`${k}\` | ${srcIdx.get(k).map((t) => `[${t.fm.id}](${t.rel})`).join(', ')} |`);
  // uncovered sources — only measurable when the config names the source trees
  if (COVERAGE_ROOTS.length) {
    const all = listCoverageSources();
    const covered = new Set([...srcIdx.keys()]);
    const uncovered = all.filter((p) => !covered.has(p));
    out.push('\n## Uncovered sources\n');
    out.push(`${all.length - uncovered.length}/${all.length} non-test source files under ${COVERAGE_ROOTS.map((r) => `\`${r}\``).join(', ')} are cited by at least one topic. Files no topic cites:\n`);
    for (const p of uncovered) out.push(`- \`${p}\``);
    if (!uncovered.length) out.push('- none');
  }
  fs.writeFileSync(path.join(root, 'COVERAGE.md'), out.join('\n') + '\n');

  // REGISTER.md - tensions, debt, drift, open questions, invariants
  const reg = [];
  reg.push(`<!-- GENERATED BY ${path.basename(__filename)} - DO NOT EDIT BY HAND -->`);
  reg.push('# Register: tensions, debt, drift, open questions, invariants\n');
  reg.push('Collected from every topic file\'s labelled paragraphs (`**Tension:**`, `**Debt:**`, `**Drift:**`, `**Open:**`, `**Invariant:**`) and from `TENSION:` / `DEBT:` / `DRIFT:` / `OPEN:` / `INVARIANT:` prefixes inside diagram notes. Each row links back to the topic and diagram it was found in. This is the catalogue of the state of play; it proposes nothing. Remediation and roadmap work starts from here.\n');
  const counts = Object.fromEntries(REGISTER_KINDS.map((k) => [k, 0]));
  for (const t of topics) for (const r of t.register) counts[r.kind] = (counts[r.kind] || 0) + 1;
  reg.push(REGISTER_KINDS.map((k) => `${k}: ${counts[k]}`).join(' · ') + '\n');
  for (const kind of REGISTER_KINDS) {
    const kindRows = [];
    for (const area of AREAS.keys()) for (const t of byArea[area] || []) for (const r of t.register) if (r.kind === kind) kindRows.push({ t, r });
    if (!kindRows.length) continue;
    reg.push(`## ${kind}${kind === 'Open' ? ' questions' : kind === 'Invariant' ? 's' : kind === 'Debt' ? '' : 's'}\n`);
    reg.push('| # | Where | Note |');
    reg.push('|---|-------|------|');
    kindRows.forEach(({ t, r }, i) => {
      const anchor = r.diagram ? `${t.rel}#${slug(r.diagram.id, r.diagram.title)}` : t.rel;
      const where = r.diagram ? `[${r.diagram.id}](${anchor})` : `[${t.fm.id}](${anchor})`;
      const scope = r.scope ? ` _(${r.scope})_` : '';
      // Marker prose is written inside a topic file and hoisted here, one directory up:
      // a sibling-relative link (`[FM-05.6](05-operations-….md#…)`) or a bare anchor
      // (`[above](#fm-031-…)`) is right in the topic and wrong here unless re-rooted.
      const dir = path.posix.dirname(t.rel);
      const hoisted = r.text.replace(/\]\(([^)\s]+)\)/g, (m0, href) => {
        if (/^(?:[a-z]+:|\/)/i.test(href)) return m0;                  // absolute or URL: leave
        if (href.startsWith('#')) return `](${t.rel}${href})`;            // same-topic anchor
        if (href.startsWith('../')) return `](${path.posix.normalize(path.posix.join(dir, href))})`;
        if (!href.includes('/')) return `](${dir === '.' ? '' : dir + '/'}${href})`; // sibling in the same area
        return m0;                                                        // already corpus-relative
      });
      reg.push(`| ${kind[0]}-${String(i + 1).padStart(2, '0')} | ${where}${scope} | ${hoisted.replace(/\|/g, '\\|')} |`);
    });
    reg.push('');
  }
  fs.writeFileSync(path.join(root, 'REGISTER.md'), reg.join('\n') + '\n');
}

// ---------------------------------------------------------------- JSON report
function headSha() {
  try {
    return execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { return null; }
}
function verifiedCommitValue(v) {
  if (typeof v === 'string' && v.trim().startsWith('{')) {
    const map = {};
    for (const pair of v.trim().slice(1, -1).split(',')) {
      const [k, sha] = pair.split(':').map((x) => x.trim());
      if (k && sha) map[k] = sha;
    }
    return map;
  }
  return v == null ? null : String(v);
}
function writeReport(topics, outPath) {
  const zero = () => Object.fromEntries(REGISTER_KINDS.map((k) => [k.toLowerCase(), 0]));
  const totals = { topics: topics.length, diagrams: 0, citationsChecked: 0, citationWarnings: 0, register: zero() };
  const rows = topics.map((t) => {
    const register = zero();
    for (const r of t.register) register[r.kind.toLowerCase()] = (register[r.kind.toLowerCase()] || 0) + 1;
    for (const k of Object.keys(register)) totals.register[k] += register[k];
    totals.diagrams += t.diagrams.length;
    totals.citationsChecked += t.citeChecked;
    totals.citationWarnings += t.citeWarnings.length;
    const rdir = renderedDir(t);
    return {
      id: t.fm.id || null,
      file: t.rel.split(path.sep).join('/'),
      area: t.fm.area || null,
      title: t.fm.title || null,
      verified_commit: verifiedCommitValue(t.fm.verified_commit),
      worktree: 'worktree' in t.fm ? String(t.fm.worktree) : null,
      sources: (t.fm.sources || []).slice(),
      governing: (t.fm.governing || []).slice(),
      adrs: (t.fm.adrs || []).slice(),
      diagrams: t.diagrams.map((d) => {
        const svg = path.join(rdir, `${d.id}.svg`);
        return {
          id: d.id,
          title: d.title,
          kind: d.kind,
          svg: fs.existsSync(svg) ? path.relative(root, svg).split(path.sep).join('/') : null,
        };
      }),
      citations: { checked: t.citeChecked, warnings: t.citeWarnings.slice() },
      register,
    };
  });
  const report = { generatedAt: new Date().toISOString(), root, head: headSha(), topics: rows, totals };
  const abs = path.resolve(outPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(report, null, 2) + '\n');
  return report;
}

// ---------------------------------------------------------------- main
(async () => {
  const errors = [];
  const allFiles = walk(root, []);
  deriveAreas(allFiles, errors);
  let files = allFiles;
  if (flags.only) files = files.filter((f) => path.relative(root, f).includes(flags.only));
  const topics = files.map((f) => parseTopic(f, errors)).filter(Boolean);
  const seenTopic = new Map(), seenDiag = new Map();
  for (const t of topics) {
    if (seenTopic.has(t.fm.id)) errors.push(`${t.rel}: duplicate topic id ${t.fm.id} (also ${seenTopic.get(t.fm.id)})`);
    seenTopic.set(t.fm.id, t.rel);
    for (const d of t.diagrams) {
      if (seenDiag.has(d.id)) errors.push(`${t.rel}: duplicate diagram id ${d.id} (also ${seenDiag.get(d.id)})`);
      seenDiag.set(d.id, t.rel);
    }
  }
  const total = topics.reduce((n, t) => n + t.diagrams.length, 0);
  const regTotal = topics.reduce((n, t) => n + t.register.length, 0);
  console.log(`parsed ${topics.length} topic files, ${total} mermaid diagrams, ${regTotal} register markers`);
  if (flags.cite && flags.noSourcePaths) console.warn('note: --cite-check cannot resolve anything under --no-source-paths; skipped');
  if (flags.cite && !flags.noSourcePaths) {
    const w = citeCheck(topics).concat(symbolCheck(topics));
    console.log(`cite-check: ${w.length} warning(s)`);
    for (const x of w) console.warn(`  ! ${citeText(x)}`);
    if (flags.strictCitations) errors.push(...w.map((x) => `citation: ${citeText(x)}`));
  }
  if (flags.render) {
    const { errors: rerr, count } = await renderAll(topics);
    console.log(`rendered ${count - rerr.length}/${count} diagrams via mmdc`);
    errors.push(...rerr);
  }
  if (flags.report) {
    const r = writeReport(topics, flags.report);
    console.log(`wrote report ${path.resolve(flags.report)} (${r.totals.topics} topics, ${r.totals.diagrams} diagrams, ${r.totals.citationWarnings} citation warning(s))`);
  }
  if (errors.length) {
    console.error(`\n${errors.length} error(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  if (!flags.check && !flags.only) {
    writeIndexes(topics);
    console.log('wrote README.md index block + COVERAGE.md + REGISTER.md');
  }
})().catch((e) => { console.error(e); process.exit(2); });
