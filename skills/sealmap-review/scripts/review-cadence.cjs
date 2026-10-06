#!/usr/bin/env node
'use strict';
/**
 * WHAT THIS IS
 *   The scheduled, cost-controlled review of diagrams-as-code corpora. Four subcommands run
 *   against every corpus repo (a directory with docs/diagrams/<area>/NN-*.md topic files):
 *
 *     triage         GLM reads each topic whose sources changed and says whether it is now wrong;
 *                    writes docs/review/<date>-triage.md, the list of topics to re-author.
 *     review-glm     the critical and premortem lenses with GLM as reviewer, one pack per shard;
 *                    a shard whose pack is byte-identical to its last GLM review is skipped.
 *     audit-gemini   the external Gemini review, one shard at a time, only for shards that pass a
 *                    four-part gate (interval, changed topics or a high-severity GLM finding, and
 *                    the monthly budget); the most-changed shards go first, within budget.
 *     status         the resolved repo list, what the ledger says, month-to-date Gemini spend.
 *
 *     node review-cadence.cjs <subcommand> [--manifest <agentbox.toml>] [--repo <dir>]...
 *          [--workspace <dir>] [--dry-run] [--now <ISO time>]
 *
 *   Zero dependencies, Node >= 18.
 *
 * WHICH REPOS
 *   [diagram_review].repos empty (the default) means auto-discover: scan $WORKSPACE (default
 *   /home/devuser/workspace) to depth 3 for directories holding docs/diagrams/<area>/NN-*.md,
 *   skipping .tmp, node_modules, target and dot-directories, de-duplicated by realpath. The
 *   manifest is public and the corpora are in private repositories, so no path belongs in it. An
 *   optional gitignored config/diagram-review.local (one path per line, `#` comments, a leading
 *   `!` excludes a path) adds to the list.
 *
 * WHY IT IS THIS WAY
 *   Gemini with high thinking on a whole corpus is the expensive step, so it is the rare one.
 *   GLM is cheap and runs often, and its job is to decide when the expensive step is worth it.
 *   An estate corpus cites files in many repositories, so change is detected per source
 *   repository: every cited path is resolved by realpath (a workspace symlink and the real path
 *   are one file), attributed to the innermost git toplevel that owns it (a nested submodule is
 *   its own repo, not a gitlink bump in its parent), and compared with that repository's own
 *   history. The ledger keeps a map of last-seen commits per repository, never one sha. Packs are
 *   built per area (large areas split by a token budget) because a whole estate does not fit a
 *   model, and the pack-hash skip, the change thresholds and the budget all apply per shard.
 *   Every run, refusals included, appends one line to docs/diagrams/review-ledger.jsonl, so
 *   spend, intervals and "what did we already review" are read from one append-only file. A
 *   failed model call never blocks the cadence: triage treats an unanswered topic as "yes,
 *   re-author", and a failed Gemini call is recorded at its estimated cost, because a timed-out
 *   generateContent may already have been billed. A cited path whose repository is missing, or
 *   whose link dangles, is a logged skip, not a crash.
 *   Nothing here edits a topic or commits anything. Findings are unverified hypotheses for
 *   build-with-quality. The keys are read from the environment and never printed or stored.
 *
 * WHAT IT MEANS FOR THE CLIENT
 *   The diagrams stay honest without anyone remembering to ask. A cheap model watches every
 *   code change that touches a documented topic, in whichever repository it lands. A nightly
 *   GLM review catches what the authors cannot see, and the expensive outside audit runs
 *   only on the areas that changed, when there is a reason and money left under a cap the
 *   operator set.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ER = require('./external-review.cjs');
const MF = require('./merge-findings.cjs');

// ── Pricing (USD per million tokens). Gemini 3.8 Flash list price as of 2026-10-06, taken from
//    the operator's brief; check ai.google.dev/pricing before trusting the budget to the cent.
//    Output includes thinking tokens. GLM is billed under the Z.AI plan, not per token, so it
//    costs 0 here and never counts against the Gemini cap.
const GEMINI_USD_PER_M = { input: 0.75, cached: 0.075, output: 3.75 };
const GLM_USD_PER_M = { input: 0, output: 0 };
// A lens reply plus its thinking. Used only for the pre-flight estimate; the ledger records
// the usage the API reports.
const GEMINI_ASSUMED_OUTPUT_TOKENS_PER_LENS = ER.MAX_OUTPUT_TOKENS;
const GEMINI_LENSES = 2;

const LEDGER_REL = path.join('docs', 'diagrams', 'review-ledger.jsonl');
const CORPUS_REL = path.join('docs', 'diagrams');
const REVIEW_REL = path.join('docs', 'review');
const GLM_DEFAULT_MODEL = 'glm-5.3';
// GLM has a smaller window than Gemini, so one shard is at most this many tokens. The same
// shards feed the Gemini audit, so "the last GLM review of this shard" is well defined.
const DEFAULT_SHARD_TOKENS = 150000;
const GLM_MAX_OUTPUT_TOKENS = 32000;
const GLM_TRIAGE_MAX_OUTPUT_TOKENS = 1500;
const MAX_DIFF_BYTES = 40000;
const MAX_TOPIC_BYTES = 60000;
const MAX_TRIAGE_TOPICS = 60;
const DEFAULT_WORKSPACE = '/home/devuser/workspace';
const DISCOVERY_DEPTH = 3;
const DISCOVERY_SKIP = new Set(['.tmp', 'node_modules', 'target']);
const LOCAL_FILE = process.env.DIAGRAM_REVIEW_LOCAL_FILE || ( __dirname.startsWith('/opt/agentbox/')
  ? path.join(process.env.WORKSPACE || DEFAULT_WORKSPACE, 'project', 'agentbox', 'config', 'diagram-review.local')
  : path.join(__dirname, '..', '..', '..', 'config', 'diagram-review.local'));
const DEFAULTS = {
  enabled: false, repos: [], glm_triage_cron: '17 5 * * *', glm_review_cron: '47 2 * * *',
  gemini_min_interval_days: 7, gemini_min_changed_topics: 3, gemini_monthly_usd: 10, weekly_window: true,
};
const DAY_MS = 86400000;
const TOKENS_PER_BYTE = 1 / 3.3;

// ── Manifest ────────────────────────────────────────────────────────────────────────────────

/** Strip a trailing `# comment` that is not inside a string. */
function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '\\' && q === '"') i++; else if (c === q) q = null; }
    else if (c === '"' || c === "'") q = c;
    else if (c === '#') return line.slice(0, i);
  }
  return line;
}

function parseScalar(raw) {
  const t = raw.trim();
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^[+-]?\d+$/.test(t)) return Number(t);
  if (/^[+-]?\d*\.\d+$/.test(t)) return Number(t);
  if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
    try { return JSON.parse(t); } catch { return t.slice(1, -1); }
  }
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) return t.slice(1, -1);
  return t;
}

function parseArray(raw) {
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '');
  const items = [];
  let cur = '', q = null;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (q) { cur += c; if (c === '\\' && q === '"') cur += inner[++i] ?? ''; else if (c === q) q = null; }
    else if (c === '"' || c === "'") { q = c; cur += c; }
    else if (c === ',') { if (cur.trim()) items.push(parseScalar(cur)); cur = ''; }
    else cur += c;
  }
  if (cur.trim()) items.push(parseScalar(cur));
  return items;
}

/** Read one `[section]` table out of a TOML document: strings, booleans, numbers and (possibly
 *  multi-line) arrays of them. That is all [diagram_review] and [consultants.zai] use; the rest
 *  of the manifest is read by `agentbox-manifest`. */
function readSection(text, name) {
  const out = {};
  let inSection = false;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = stripComment(lines[i]).trim();
    if (!line) continue;
    const head = line.match(/^\[([^\[\]]+)\]$/);
    if (head) { inSection = head[1].trim() === name; continue; }
    if (!inSection) continue;
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value.startsWith('[')) {
      while (!value.includes(']') && i + 1 < lines.length) value += ' ' + stripComment(lines[++i]).trim();
      out[kv[1]] = parseArray(value);
    } else out[kv[1]] = parseScalar(value);
  }
  return out;
}

function loadConfig(manifestPath) {
  let text = '';
  try { text = fs.readFileSync(manifestPath, 'utf8'); } catch { /* fail-open: defaults, disabled */ }
  const cfg = { ...DEFAULTS, ...readSection(text, 'diagram_review') };
  cfg.repos = (Array.isArray(cfg.repos) ? cfg.repos : []).filter((r) => typeof r === 'string' && r);
  for (const k of ['gemini_min_interval_days', 'gemini_min_changed_topics', 'gemini_monthly_usd']) {
    if (typeof cfg[k] !== 'number' || !(cfg[k] >= 0)) cfg[k] = DEFAULTS[k];
  }
  cfg.glm_model = process.env.DIAGRAM_REVIEW_GLM_MODEL || readSection(text, 'consultants.zai').model || GLM_DEFAULT_MODEL;
  return cfg;
}

// ── Repo discovery ──────────────────────────────────────────────────────────────────────────

const real = (p) => { try { return fs.realpathSync(p); } catch { return null; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

/** True when `dir` holds docs/diagrams/<area>/NN-*.md: a topic file one area below the corpus root. */
function hasCorpus(dir) {
  const corpus = path.join(dir, CORPUS_REL);
  let areas;
  try { areas = fs.readdirSync(corpus, { withFileTypes: true }); } catch { return false; }
  for (const a of areas) {
    if (a.name.startsWith('.') || !(a.isDirectory() || (a.isSymbolicLink() && isDir(path.join(corpus, a.name))))) continue;
    let files;
    try { files = fs.readdirSync(path.join(corpus, a.name)); } catch { continue; }
    if (files.some((f) => /^\d+-.+\.md$/.test(f))) return true;
  }
  return false;
}

/** Corpus repos under `workspace` to `maxDepth` levels, by realpath. A symlinked directory is
 *  followed once: the link and its target are one repository. */
function discoverRepos(workspace, { maxDepth = DISCOVERY_DEPTH } = {}) {
  const found = new Set();
  const seen = new Set();
  (function walk(dir, depth) {
    const rp = real(dir);
    if (!rp || seen.has(rp)) return;
    seen.add(rp);
    if (hasCorpus(rp)) found.add(rp);
    if (depth >= maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (e.name.startsWith('.') || DISCOVERY_SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory() || (e.isSymbolicLink() && isDir(full))) walk(full, depth + 1);
    }
  })(workspace, 0);
  return [...found].sort();
}

/** Lines of the gitignored local file: `{ add: [...], exclude: [...] }`. */
function readLocalFile(file) {
  const add = [], exclude = [];
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch { return { add, exclude }; }
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    if (line.startsWith('!')) exclude.push(path.resolve(line.slice(1).trim())); else add.push(path.resolve(line));
  }
  return { add, exclude };
}

/** The repos to review: the manifest list when it has entries, otherwise the discovered set;
 *  then the local file's additions and exclusions. Existing directories only, one entry per
 *  realpath. */
function resolveRepos(cfg, { workspace = process.env.WORKSPACE || DEFAULT_WORKSPACE, localFile = LOCAL_FILE } = {}) {
  const fromManifest = cfg.repos.length > 0;
  const base = fromManifest ? cfg.repos.map((r) => path.resolve(r)) : discoverRepos(workspace);
  const local = readLocalFile(localFile);
  const excluded = new Set(local.exclude.map((p) => real(p) ?? p));
  const out = new Map();
  for (const p of [...base, ...local.add]) {
    const rp = real(p);
    if (rp && isDir(rp) && !excluded.has(rp)) out.set(rp, true);
  }
  return {
    repos: [...out.keys()].sort(), source: fromManifest ? 'manifest' : `discovered under ${workspace}`,
    added: local.add.length, excluded: local.exclude.length,
  };
}

// ── Ledger ──────────────────────────────────────────────────────────────────────────────────

function ledgerPath(repo) { return path.join(repo, LEDGER_REL); }

function readLedger(repo) {
  let text = '';
  try { text = fs.readFileSync(ledgerPath(repo), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn line is skipped, never fatal */ }
  }
  return out;
}

/** Append one run to the ledger. Append-only: the file is never rewritten. */
function appendLedger(repo, entry) {
  const full = {
    ts: new Date().toISOString(), kind: null, reviewer: null, shard: null, commit: null, commits: null,
    pack_sha256: null, tokens: null, est_usd: 0, findings: null, high_severity: 0, changed_topics: null, skipped: null,
    ...entry,
  };
  fs.mkdirSync(path.dirname(ledgerPath(repo)), { recursive: true });
  fs.appendFileSync(ledgerPath(repo), `${JSON.stringify(full)}\n`);
  return full;
}

const isRun = (e, kind, reviewer, shard) => e.kind === kind && e.reviewer === reviewer && !e.skipped && !e.error
  && (shard === undefined || (e.shard ?? null) === shard);
const lastOf = (ledger, kind, reviewer, shard) => [...ledger].reverse().find((e) => isRun(e, kind, reviewer, shard)) ?? null;

/** True when the latest ledger line for this kind, reviewer and shard is already a skip of the
 *  same kind (`reason` up to its first colon), so a nightly tick does not repeat itself. */
function repeatsLastSkip(ledger, kind, reviewer, shard, reason) {
  const last = [...ledger].reverse().find((e) => e.kind === kind && e.reviewer === reviewer && (e.shard ?? null) === (shard ?? null));
  const key = (r) => String(r).split(':')[0];
  return Boolean(last && last.skipped && !last.error && key(last.skipped) === key(reason));
}

/** Gemini spend recorded in the UTC month of `now`, across the given ledgers. Failed calls count
 *  at their estimate, because a timed-out generation may have been billed. */
function monthToDateUsd(ledgers, now) {
  const month = new Date(now).toISOString().slice(0, 7);
  let total = 0;
  for (const ledger of ledgers) {
    // A reservation survives termination, lost replies and output-processing errors.
    // A settlement replaces it, rather than counting the same call twice.
    const settled = new Set(ledger.filter((e) => e.reservation_at).map((e) => `${e.reservation_at}:${e.shard}:${e.pack_sha256}`));
    for (const e of ledger) {
      if (e.kind === 'audit-reservation' && settled.has(`${e.ts}:${e.shard}:${e.pack_sha256}`)) continue;
      if (e.reviewer === 'gemini' && typeof e.est_usd === 'number' && String(e.ts).slice(0, 7) === month) total += e.est_usd;
    }
  }
  return Math.round(total * 1e6) / 1e6;
}

// ── Git, source resolution and change detection ─────────────────────────────────────────────

function git(dir, args, { maxBuffer = 256 * 1024 * 1024 } = {}) {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer });
}

function headCommit(dir) {
  try { return git(dir, ['rev-parse', 'HEAD']).trim(); } catch { return null; }
}

function commitExists(dir, sha) {
  if (!sha) return false;
  try { git(dir, ['cat-file', '-e', `${sha}^{commit}`]); return true; } catch { return false; }
}

/** Repo-relative files changed between `since` and HEAD in the repository at `top`. */
function changedFiles(top, since) {
  return new Set(git(top, ['diff', '--name-only', '-z', since, 'HEAD']).split('\0').filter(Boolean));
}

const posix = (p) => p.split(path.sep).join('/');

/**
 * Resolves cited paths to `{ top, rel }`: the realpath of the file, owned by the innermost git
 * toplevel of its directory. Two spellings of one file (a workspace symlink and the real path)
 * come out identical, and a file in a nested submodule is attributed to the submodule, not to
 * the outer repository where it shows only as a gitlink. Toplevels are cached per directory,
 * because an estate corpus cites thousands of files in a few hundred directories.
 *
 * A path that cannot be attributed returns `{ skip: reason }`: a dangling link, or a path whose
 * repository is not there. A cited file that has been deleted is still attributed, through its
 * nearest existing directory, so its removal registers as a change.
 */
function createResolver() {
  const tops = new Map();
  const toplevel = (dir) => {
    if (tops.has(dir)) return tops.get(dir);
    let top = null;
    try { top = real(git(dir, ['rev-parse', '--show-toplevel']).trim()); } catch { /* not in a repository */ }
    tops.set(dir, top);
    return top;
  };
  const lexists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
  const resolve = (from, src) => {
    const abs = path.resolve(from, src);
    let file = real(abs);
    if (!file) {
      // Walk up to the nearest existing ancestor; a link that exists but leads nowhere dangles.
      let cur = abs;
      const tail = [];
      while (!fs.existsSync(cur)) {
        if (lexists(cur)) return { skip: 'dangling link', src };
        const parent = path.dirname(cur);
        if (parent === cur) return { skip: 'unresolvable path', src };
        tail.unshift(path.basename(cur));
        cur = parent;
      }
      file = path.join(real(cur), ...tail);
    }
    let dir = path.dirname(file);
    while (!isDir(dir)) { const parent = path.dirname(dir); if (parent === dir) break; dir = parent; }
    const top = toplevel(dir);
    if (!top) return { skip: 'no git repository (sibling repo missing?)', src };
    return { top, rel: posix(path.relative(top, file)) };
  };
  return { resolve, toplevel };
}

/** Frontmatter `sources:` as the paths written, in order. Reads the inline `[a, b]` and the
 *  block `- a` forms. */
function parseSources(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return [];
  const fm = m[1].split('\n');
  const at = fm.findIndex((l) => /^sources\s*:/.test(l));
  if (at < 0) return [];
  const rest = fm[at].replace(/^sources\s*:/, '').trim();
  let items;
  if (rest.startsWith('[')) items = parseArray(stripComment(rest));
  else {
    items = [];
    for (let i = at + 1; i < fm.length && /^\s+-\s+/.test(fm[i]); i++) items.push(parseScalar(stripComment(fm[i].replace(/^\s+-\s+/, ''))));
  }
  return items.filter((s) => typeof s === 'string' && s);
}

/** Every topic with its attributed sources: `[{ rel, area, srcs: [{top, rel}], skips: [...] }]`.
 *  Sources resolve from the corpus repo root, so `../sibling/x` is the sibling repository's x. */
function loadTopics(repo, resolver = createResolver()) {
  const corpus = path.join(repo, CORPUS_REL);
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(corpus, 'diagrams.config.json'), 'utf8')); } catch { /* optional */ }
  return ER.listTopics(corpus, { skipDirs: cfg.skipDirs }).map((rel) => {
    const srcs = new Map();
    const skips = [];
    for (const s of parseSources(fs.readFileSync(path.join(corpus, rel), 'utf8'))) {
      const r = resolver.resolve(repo, s);
      if (r.skip) skips.push(r); else srcs.set(`${r.top}\0${r.rel}`, r);
    }
    return { rel, area: rel.split('/')[0], srcs: [...srcs.values()], skips };
  });
}

/** Topics with at least one source in the changed set of its own repository. `changed` maps a
 *  toplevel to the Set of files changed there; a repository with no entry has no known baseline
 *  and contributes nothing. */
function triageCandidates(topics, changed) {
  return topics
    .map((t) => ({ ...t, changedSources: t.srcs.filter((s) => changed.get(s.top)?.has(s.rel)) }))
    .filter((t) => t.changedSources.length > 0);
}

/** For every repository in `tops`, the files changed since `since[top]`. A repository with no
 *  recorded commit, or one whose commit is gone, is a baseline: it is returned in `baseline`
 *  and nothing is flagged on its account this run. */
function changedByRepo(tops, since) {
  const changed = new Map();
  const baseline = [];
  for (const top of tops) {
    const c = since?.[top];
    if (c && commitExists(top, c)) changed.set(top, changedFiles(top, c)); else baseline.push(top);
  }
  return { changed, baseline };
}

/** The current HEAD of each repository in `tops`, as the ledger's `commits` map. */
function headsOf(tops) {
  const out = {};
  for (const t of tops) { const h = headCommit(t); if (h) out[t] = h; }
  return out;
}

const reposOf = (topics) => [...new Set(topics.flatMap((t) => t.srcs.map((s) => s.top)))].sort();

function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

// ── Shards ──────────────────────────────────────────────────────────────────────────────────

function shardBudget(env = process.env) {
  const n = Number(env.DIAGRAM_REVIEW_SHARD_TOKENS);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_SHARD_TOKENS;
}

/**
 * Packs per area. An area larger than `budgetTokens` is split into consecutive chunks (`area`,
 * `area#2`, ...) in path order; a topic larger than the budget gets a chunk of its own. The
 * pack is exactly what external-review.cjs builds, so hashes are comparable with its manifest.
 * @returns {{name: string, area: string, files: string[], pack: string, sha: string, tokens: number}[]}
 */
function buildShards(repo, budgetTokens = shardBudget()) {
  const corpus = path.join(repo, CORPUS_REL);
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(corpus, 'diagrams.config.json'), 'utf8')); } catch { /* optional */ }
  const byArea = new Map();
  for (const f of ER.listTopics(corpus, { skipDirs: cfg.skipDirs })) {
    const area = f.split('/')[0];
    if (!byArea.has(area)) byArea.set(area, []);
    byArea.get(area).push(f);
  }
  const shards = [];
  for (const [area, files] of [...byArea].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const chunks = [];
    let cur = [], tokens = 0;
    for (const f of files) {
      const t = fs.statSync(path.join(corpus, f)).size * TOKENS_PER_BYTE;
      if (cur.length && tokens + t > budgetTokens) { chunks.push(cur); cur = []; tokens = 0; }
      cur.push(f); tokens += t;
    }
    if (cur.length) chunks.push(cur);
    chunks.forEach((fs_, i) => {
      const pack = ER.buildPack(corpus, fs_);
      shards.push({ name: i === 0 ? area : `${area}#${i + 1}`, area, files: fs_, pack, sha: sha256(pack), tokens: Math.round(pack.length * TOKENS_PER_BYTE) });
    });
  }
  return shards;
}

// ── Decisions ───────────────────────────────────────────────────────────────────────────────

/** A finding is high severity when the reviewer said so, or, with no severity field, when it
 *  was reported with high confidence and the authors had not marked it themselves. */
function isHighSeverity(f) {
  if (f.severity) return /^\W*high\b/i.test(f.severity);
  return /^\W*high\b/i.test(f.confidence ?? '') && /^\W*no\b/i.test(f.marked_by_authors ?? '');
}

/**
 * The Gemini gate, applied to one shard. Every condition must hold; the first that fails is the
 * logged reason.
 *   - at least `gemini_min_interval_days` since the shard's last audit
 *   - at least `gemini_min_changed_topics` topics changed since it, OR the shard's last GLM
 *     review recorded a high-severity finding
 *   - month-to-date spend plus this run's estimate within `gemini_monthly_usd`
 * @returns {{run: boolean, reason: string}}
 */
function decideGemini({ cfg, lastAudit, changedTopics, glmHighSeverity, mtdUsd, estUsd, now }) {
  if (lastAudit) {
    const days = (new Date(now) - new Date(lastAudit.ts)) / DAY_MS;
    if (days < cfg.gemini_min_interval_days) {
      return { run: false, reason: `interval: ${days.toFixed(1)} d since the last audit, need ${cfg.gemini_min_interval_days}` };
    }
  }
  if (changedTopics < cfg.gemini_min_changed_topics && !(glmHighSeverity > 0)) {
    return { run: false, reason: `no cause: ${changedTopics} topics changed (need ${cfg.gemini_min_changed_topics}) and no high-severity GLM finding` };
  }
  if (mtdUsd + estUsd > cfg.gemini_monthly_usd) {
    return { run: false, reason: `budget: $${mtdUsd.toFixed(2)} spent this month + $${estUsd.toFixed(2)} estimated exceeds $${cfg.gemini_monthly_usd}` };
  }
  const cause = glmHighSeverity > 0 ? `${glmHighSeverity} high-severity GLM finding(s)` : `${changedTopics} changed topics`;
  return { run: true, reason: `gate open: ${cause}, $${(mtdUsd + estUsd).toFixed(2)} of $${cfg.gemini_monthly_usd} after this run` };
}

/** Reserve uncached input for every lens and the enforced maximum output, including thinking.
 * Cache hits are an optimisation, never a prerequisite for staying within the cap. */
function estimateGeminiUsd(packTokens, lenses = GEMINI_LENSES) {
  const m = 1e6;
  return (lenses * packTokens * GEMINI_USD_PER_M.input
    + lenses * GEMINI_ASSUMED_OUTPUT_TOKENS_PER_LENS * GEMINI_USD_PER_M.output) / m;
}

/** What Gemini actually billed, from external-review's per-lens usage. */
function actualGeminiUsd(lenses) {
  if (!Array.isArray(lenses) || lenses.length !== GEMINI_LENSES) throw new Error('incomplete Gemini usage; reservation retained');
  let usd = 0;
  for (const l of lenses ?? []) {
    if (![l.prompt_tokens, l.output_tokens, l.thinking_tokens ?? 0, l.cached_tokens ?? 0].every((n) => Number.isSafeInteger(n) && n >= 0)
      || !(l.prompt_tokens > 0) || (l.cached_tokens ?? 0) > l.prompt_tokens) {
      throw new Error('invalid Gemini usage; reservation retained');
    }
    const cached = l.cached_tokens ?? 0;
    usd += (((l.prompt_tokens ?? 0) - cached) * GEMINI_USD_PER_M.input + cached * GEMINI_USD_PER_M.cached
      + ((l.thinking_tokens ?? 0) + (l.output_tokens ?? 0)) * GEMINI_USD_PER_M.output) / 1e6;
  }
  return Math.round(usd * 1e6) / 1e6;
}

/** True when the shard's latest GLM review pack equals `sha` (nothing to re-review). */
function packUnchanged(ledger, shard, sha) {
  const last = lastOf(ledger, 'review', 'glm', shard);
  return Boolean(last && last.pack_sha256 === sha);
}

/** Topics of a shard changed since the shard's last audit: all of them when it has never been
 *  audited, and none on account of a repository with no recorded baseline. */
function shardChangedTopics(shardTopics, lastAudit) {
  if (!lastAudit) return shardTopics.length;
  const { changed } = changedByRepo(reposOf(shardTopics), lastAudit.commits ?? {});
  return triageCandidates(shardTopics, changed).length;
}

// ── GLM transport ───────────────────────────────────────────────────────────────────────────

/** Z.AI settings by the shared clean-env conventions (mcp/consultants/shared/zai-env.js): the key
 *  is ZAI_ANTHROPIC_API_KEY, then ZAI_API_KEY, and nothing else in the caller's environment is
 *  used. Falls back to the same rule inline when the shared module is not beside this skill. */
function zaiSettings(env = process.env) {
  const candidates = [
    path.join(__dirname, '..', '..', '..', 'mcp', 'consultants', 'shared', 'zai-env.js'),
    '/opt/agentbox/mcp/consultants/shared/zai-env.js',
  ];
  for (const c of candidates) {
    try {
      const { zaiChildEnv } = require(c);
      const e = zaiChildEnv(env);
      return { url: e.ZAI_URL, key: e.ZAI_API_KEY };
    } catch { /* try the next */ }
  }
  return { url: env.ZAI_URL || 'https://api.z.ai/api/paas/v4', key: env.ZAI_ANTHROPIC_API_KEY || env.ZAI_API_KEY || '' };
}

/** One Anthropic Messages call to Z.AI. The key goes in a header only; an error shows the
 *  server's reason and never the request. Returns { text, input_tokens, output_tokens }. */
async function glm({ model, system, user, maxTokens, thinkingBudget, timeoutMs, env = process.env, post = ER.postJson }) {
  const { url, key } = zaiSettings(env);
  if (!key) throw new Error('set ZAI_ANTHROPIC_API_KEY (or ZAI_API_KEY) in the environment');
  const body = { model, max_tokens: maxTokens, messages: [{ role: 'user', content: user }] };
  if (system) body.system = system;
  if (thinkingBudget > 0) body.thinking = { type: 'enabled', budget_tokens: thinkingBudget };
  const res = await post(`${url.replace(/\/+$/, '')}/v1/messages`, {
    authorization: `Bearer ${key}`, 'anthropic-version': '2023-06-01',
  }, body, timeoutMs ?? ER.timeoutFromEnv(env));
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`glm ${res.status}: ${JSON.stringify(res.json.error ?? res.json).slice(0, 300)}`);
  }
  const text = (res.json.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (!text) throw new Error(`glm: empty reply (stop_reason ${res.json.stop_reason ?? 'none'})`);
  return { text, input_tokens: res.json.usage?.input_tokens ?? 0, output_tokens: res.json.usage?.output_tokens ?? 0 };
}

const TRIAGE_SYSTEM = 'You check whether a documentation topic still tells the truth about the code it cites. '
  + 'Answer on the first line with exactly "VERDICT: YES" (the topic is now wrong or incomplete and must be re-authored) '
  + 'or "VERDICT: NO" (the topic is still accurate). If you are not sure, answer YES. '
  + 'On the second line give "REASON:" and one sentence naming the claim the change affects.';

/** Read a triage reply. Anything but an unambiguous NO is a YES. */
function parseVerdict(text) {
  const m = text.match(/VERDICT:\s*(YES|NO)\b/i);
  return !(m && m[1].toUpperCase() === 'NO');
}

function clip(s, max) {
  return Buffer.byteLength(s) <= max ? s : `${Buffer.from(s).subarray(0, max).toString('utf8')}\n[... truncated at ${max} bytes]`;
}

/** The topic text and the combined diff of its changed sources, each repository diffed from its
 *  own recorded commit. */
function triagePrompt(repo, topic, since) {
  const text = clip(fs.readFileSync(path.join(repo, CORPUS_REL, topic.rel), 'utf8'), MAX_TOPIC_BYTES);
  const byTop = new Map();
  for (const s of topic.changedSources) { if (!byTop.has(s.top)) byTop.set(s.top, []); byTop.get(s.top).push(s.rel); }
  let diff = '';
  for (const [top, files] of byTop) {
    let d;
    try { d = git(top, ['diff', '--unified=2', since[top], 'HEAD', '--', ...files]); } catch { d = '(diff unavailable)'; }
    diff += `--- repository ${path.basename(top)} since ${since[top].slice(0, 12)}\n${d}\n`;
  }
  const names = topic.changedSources.map((s) => `${path.basename(s.top)}/${s.rel}`).join(', ');
  return `Topic file ${topic.rel}:\n\n${text}\n\n=== Changes to the sources it cites ===\nChanged files: ${names}\n\n${clip(diff, MAX_DIFF_BYTES)}\n\nIs this topic now wrong?`;
}

// ── Output files ────────────────────────────────────────────────────────────────────────────

function uniquePath(dir, stem, ext) {
  fs.mkdirSync(dir, { recursive: true });
  let n = 1, p = path.join(dir, `${stem}${ext}`);
  while (fs.existsSync(p)) p = path.join(dir, `${stem}-${++n}${ext}`);
  return p;
}

const utcDate = (now) => new Date(now).toISOString().slice(0, 10);
const rel = (repo, p) => path.relative(repo, p).split(path.sep).join('/');

function skipSummary(topics) {
  const skips = topics.flatMap((t) => t.skips);
  const reasons = {};
  for (const s of skips) reasons[s.skip] = (reasons[s.skip] ?? 0) + 1;
  return { count: skips.length, reasons, examples: skips.slice(0, 5).map((s) => s.src) };
}

// ── Subcommands ─────────────────────────────────────────────────────────────────────────────

const REVIEW_EXTRA = '\n\nAdd one more line to every finding, after Confidence: "- Severity: high, medium or low", '
  + 'where high means it would cause a security, custody, data-loss or correctness incident in production.';

async function triage(repo, ctx) {
  const { now, cfg, dryRun } = ctx;
  const resolver = createResolver();
  const repoTop = resolver.toplevel(repo);
  if (!repoTop) return { skipped: 'not a git repository' };
  const topics = loadTopics(repo, resolver);
  const tops = [...new Set([repoTop, ...reposOf(topics)])].sort();
  const heads = headsOf(tops);
  const skips = skipSummary(topics);
  const ledger = readLedger(repo);
  const last = [...ledger].reverse().find((e) => e.kind === 'triage' && (e.commits || e.commit) && !e.error);
  const since = last ? (last.commits ?? { [repoTop]: last.commit }) : {};
  const { changed, baseline } = changedByRepo(tops, since);
  const stamp = new Date(now).toISOString();
  if (changed.size === 0) {
    if (!dryRun) appendLedger(repo, { ts: stamp, kind: 'triage', reviewer: 'glm', commit: heads[repoTop] ?? null, commits: heads, skipped: last ? 'baseline: no recorded commit is in its repository' : 'baseline: first triage run records every repository commit and spends nothing', unresolved: skips });
    return { skipped: 'baseline recorded', repos: tops.length };
  }
  let candidates;
  // Per-file flagging is the single path: every narrower rule measured (symbol, region, call-flow,
  // line-overlap) lost real changes; only per-file keeps recall 1.0 (references/evidence.md).
  candidates = triageCandidates(topics, changed);
  candidates.sort((a, b) => b.changedSources.length - a.changedSources.length || (a.rel < b.rel ? -1 : 1));
  if (candidates.length === 0) {
    if (!dryRun) appendLedger(repo, { ts: stamp, kind: 'triage', reviewer: 'glm', commit: heads[repoTop] ?? null, commits: heads, changed_topics: 0, skipped: 'no topic sources changed', unresolved: skips });
    return { skipped: 'no topic sources changed' };
  }
  if (dryRun) return { candidates: candidates.map((t) => t.rel), baseline: baseline.map((b) => path.basename(b)) };

  const results = [];
  let inTok = 0, outTok = 0;
  for (const [i, t] of candidates.entries()) {
    if (i >= MAX_TRIAGE_TOPICS) { results.push({ topic: t.rel, yes: true, reason: 'not checked: per-run cap reached, so it is listed' }); continue; }
    try {
      const r = await glm({ model: cfg.glm_model, system: TRIAGE_SYSTEM, user: triagePrompt(repo, t, since), maxTokens: GLM_TRIAGE_MAX_OUTPUT_TOKENS, env: ctx.env, post: ctx.post });
      inTok += r.input_tokens; outTok += r.output_tokens;
      results.push({ topic: t.rel, yes: parseVerdict(r.text), reason: (r.text.match(/REASON:\s*(.+)/i) || [])[1]?.trim() ?? '' });
    } catch (err) {
      results.push({ topic: t.rel, yes: true, reason: `GLM call failed (${err.message.slice(0, 120)}); unsure means yes` });
    }
  }
  const flagged = results.filter((r) => r.yes);
  const out = uniquePath(path.join(repo, REVIEW_REL), `${utcDate(now)}-triage`, '.md');
  const md = [
    `# Triage ${utcDate(now)}: ${flagged.length} of ${results.length} topics to re-author`, '',
    `Reviewer: GLM (${cfg.glm_model}). Change is detected per source repository (${[...changed.keys()].map((t) => path.basename(t)).join(', ')}) from the commits the last triage recorded`
    + `${baseline.length ? `; new this run, baselined only: ${baseline.map((t) => path.basename(t)).join(', ')}` : ''}. `
    + `${skips.count ? `${skips.count} cited paths could not be attributed (${Object.entries(skips.reasons).map(([k, v]) => `${v} ${k}`).join(', ')}). ` : ''}`
    + 'Topics are never edited here; re-author each with diagrams-as-code and re-stamp.', '',
    '## Re-author', '', ...(flagged.length ? flagged.map((r) => `- \`${r.topic}\`: ${r.reason || 'no reason given'}`) : ['(none)']), '',
    '## Still accurate', '', ...(results.filter((r) => !r.yes).map((r) => `- \`${r.topic}\`: ${r.reason}`)), '',
  ].join('\n');
  fs.writeFileSync(out, md);
  appendLedger(repo, {
    ts: stamp, kind: 'triage', reviewer: 'glm', commit: heads[repoTop] ?? null, commits: heads, tokens: { input: inTok, output: outTok },
    est_usd: (inTok * GLM_USD_PER_M.input + outTok * GLM_USD_PER_M.output) / 1e6, findings: rel(repo, out),
    changed_topics: results.length, flagged: flagged.length, unresolved: skips,
  });
  return { findings: rel(repo, out), flagged: flagged.length, checked: results.length };
}

async function reviewGlm(repo, ctx) {
  const { now, cfg, dryRun } = ctx;
  const ledger = readLedger(repo);
  const head = headCommit(repo);
  const stamp = new Date(now).toISOString();
  const shards = buildShards(repo, ctx.shardTokens ?? shardBudget(ctx.env));
  const todo = [], skipped = [];
  for (const s of shards) (packUnchanged(ledger, s.name, s.sha) ? skipped : todo).push(s);
  if (!dryRun) {
    const why = 'pack unchanged since the last GLM review of this shard';
    for (const s of skipped) {
      if (!repeatsLastSkip(ledger, 'review', 'glm', s.name, why)) appendLedger(repo, { ts: stamp, kind: 'review', reviewer: 'glm', shard: s.name, commit: head, pack_sha256: s.sha, skipped: why });
    }
  }
  if (dryRun) return { would_review: todo.map((s) => s.name), unchanged: skipped.map((s) => s.name) };
  if (todo.length === 0) return { skipped: 'pack unchanged', shards: shards.length };

  const lenses = ['critical', 'premortem'].map((name) => ({ name, text: ER.loadLens(name, 15) + REVIEW_EXTRA }));
  const findings = [], docs = [], failures = [];
  let inTok = 0, outTok = 0;
  const done = [];
  for (const shard of todo) {
    let sIn = 0, sOut = 0;
    const sFindings = [], sDocs = [];
    try {
      for (const lens of lenses) {
        const r = await glm({ model: cfg.glm_model, user: `${shard.pack}\n\n${lens.text}`, maxTokens: GLM_MAX_OUTPUT_TOKENS, thinkingBudget: 8000, env: ctx.env, post: ctx.post });
        sIn += r.input_tokens; sOut += r.output_tokens;
        sDocs.push(`## ${shard.name} / ${lens.name}\n\n${r.text.trim()}\n`);
        for (const f of ER.parseFindings(r.text, lens.name)) sFindings.push({ ...f, id: `${shard.name}:${f.id}`, shard: shard.name, high: isHighSeverity(f) });
      }
    } catch (err) {
      failures.push(`${shard.name}: ${err.message.slice(0, 160)}`);
      appendLedger(repo, { ts: stamp, kind: 'review', reviewer: 'glm', shard: shard.name, commit: head, pack_sha256: shard.sha, tokens: { input: sIn, output: sOut }, error: err.message.slice(0, 300), skipped: `error: ${err.message.slice(0, 160)}` });
      continue;
    }
    inTok += sIn; outTok += sOut;
    findings.push(...sFindings); docs.push(...sDocs);
    done.push({ shard, sIn, sOut, high: sFindings.filter((f) => f.high).length });
  }
  let out = null;
  if (done.length) {
    out = uniquePath(path.join(repo, REVIEW_REL), `${utcDate(now)}-glm`, '.md');
    const high = findings.filter((f) => f.high).length;
    fs.writeFileSync(out, [`# GLM review ${utcDate(now)} (${cfg.glm_model}): ${findings.length} findings, ${high} high severity, ${done.length} shard(s)`, '',
      `Revision ${head ? head.slice(0, 12) : 'unknown'}. Shards: ${done.map((d) => d.shard.name).join(', ')}. Unverified hypotheses: reproduce each with a failing test or check (build-with-quality) before acting.`, '', ...docs].join('\n'));
    fs.writeFileSync(out.replace(/\.md$/, '.json'), `${JSON.stringify(findings, null, 2)}\n`);
    for (const d of done) {
      appendLedger(repo, {
        ts: stamp, kind: 'review', reviewer: 'glm', shard: d.shard.name, commit: head, pack_sha256: d.shard.sha, tokens: { input: d.sIn, output: d.sOut },
        est_usd: (d.sIn * GLM_USD_PER_M.input + d.sOut * GLM_USD_PER_M.output) / 1e6, findings: rel(repo, out), high_severity: d.high,
      });
    }
  }
  if (failures.length) throw new Error(`${failures.length} shard(s) failed: ${failures.join('; ')}`);
  return { findings: rel(repo, out), count: findings.length, high: findings.filter((f) => f.high).length, shards: done.length, unchanged: skipped.length };
}

async function auditGemini(repo, ctx) {
  const { now, cfg, dryRun } = ctx;
  const ledger = readLedger(repo);
  const head = headCommit(repo);
  const stamp = new Date(now).toISOString();
  const resolver = createResolver();
  const topics = loadTopics(repo, resolver);
  const shards = buildShards(repo, ctx.shardTokens ?? shardBudget(ctx.env));
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
  const log = (shard, reason, extra = {}) => {
    if (!dryRun && !repeatsLastSkip(ledger, 'audit', 'gemini', shard?.name ?? null, reason)) appendLedger(repo, { ts: stamp, kind: 'audit', reviewer: 'gemini', shard: shard?.name ?? null, commit: head, pack_sha256: shard?.sha ?? null, skipped: reason, ...extra });
  };
  if (!key && !dryRun) { log(null, 'no GEMINI_API_KEY in the environment'); return { skipped: 'no GEMINI_API_KEY in the environment' }; }

  // The cheap checks first, per shard, so a refused shard never needs a network call.
  let mtd = ctx.mtd;
  const eligible = [], refused = [];
  for (const shard of shards) {
    const inShard = new Set(shard.files);
    const shardTopics = topics.filter((t) => inShard.has(t.rel));
    const lastAudit = lastOf(ledger, 'audit', 'gemini', shard.name);
    const lastGlm = lastOf(ledger, 'review', 'glm', shard.name);
    // A high-severity GLM finding escalates once: it counts only if it is newer than the last audit.
    const high = lastGlm && (!lastAudit || new Date(lastGlm.ts) > new Date(lastAudit.ts)) ? lastGlm.high_severity ?? 0 : 0;
    const changed = shardChangedTopics(shardTopics, lastAudit);
    const first = decideGemini({ cfg, lastAudit, changedTopics: changed, glmHighSeverity: high, mtdUsd: mtd, estUsd: 0, now });
    if (first.run) eligible.push({ shard, shardTopics, lastAudit, high, changed });
    else refused.push({ shard, reason: first.reason, changed });
  }
  for (const r of refused) log(r.shard, r.reason, { changed_topics: r.changed });
  // Most-changed shards first, so a tight budget is spent where the corpus has drifted most.
  eligible.sort((a, b) => b.changed - a.changed || (a.shard.name < b.shard.name ? -1 : 1));
  if (dryRun) {
    return { would_consider: eligible.map((e) => ({ shard: e.shard.name, changed: e.changed, high: e.high, est_usd: estimateGeminiUsd(e.shard.tokens) })), refused: refused.map((r) => ({ shard: r.shard.name, reason: r.reason })) };
  }

  const ran = [], findings = [], docs = [];
  const errors = [];
  for (const e of eligible) {
    const { shard } = e;
    let packTokens;
    try {
      packTokens = 0;
      for (const lens of ['critical', 'premortem']) {
        const counted = await ER.gemini('countTokens', ctx.model, key, { contents: [{ role: 'user', parts: [{ text: shard.pack }, { text: ER.loadLens(lens, 15) }] }] });
        if (!Number.isSafeInteger(counted.totalTokens) || counted.totalTokens <= 0) throw new Error('invalid token count');
        packTokens = Math.max(packTokens, counted.totalTokens);
      }
    } catch (err) { log(shard, `countTokens failed: ${err.message.slice(0, 160)}`, { changed_topics: e.changed }); continue; }
    const estUsd = estimateGeminiUsd(packTokens);
    const decision = decideGemini({ cfg, lastAudit: e.lastAudit, changedTopics: e.changed, glmHighSeverity: e.high, mtdUsd: mtd, estUsd, now });
    if (!decision.run) { log(shard, decision.reason, { tokens: { input: packTokens }, changed_topics: e.changed }); continue; }

    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'diagram-audit-'));
    appendLedger(repo, { ts: stamp, kind: 'audit-reservation', reviewer: 'gemini', shard: shard.name,
      pack_sha256: shard.sha, est_usd: estUsd, skipped: 'reserved before generation; charged until settled' });
    mtd += estUsd;
    try {
      await ctx.runExternal(path.join(repo, CORPUS_REL), outDir, shard.files);
    } catch (err) {
      // A failed generateContent may already have been billed: count the estimate.
      appendLedger(repo, { ts: stamp, reservation_at: stamp, kind: 'audit', reviewer: 'gemini', shard: shard.name, commit: head, pack_sha256: shard.sha, tokens: { input: packTokens }, est_usd: estUsd, error: err.message.slice(0, 300), skipped: `error: ${err.message.slice(0, 160)}` });
      errors.push(`${shard.name}: ${err.message.slice(0, 160)}`);
      continue;
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(outDir, 'manifest.json'), 'utf8'));
    const sFindings = JSON.parse(fs.readFileSync(path.join(outDir, 'findings.json'), 'utf8')).map((f) => ({ ...f, id: `${shard.name}:${f.id}`, shard: shard.name }));
    findings.push(...sFindings);
    for (const l of manifest.lenses ?? []) docs.push(`## ${shard.name} / ${l.name}\n\n${fs.readFileSync(path.join(outDir, `${l.name}.md`), 'utf8').trim()}\n`);
    const usd = actualGeminiUsd(manifest.lenses);
    mtd = Math.round((mtd - estUsd + usd) * 1e6) / 1e6;
    const sum = (k) => (manifest.lenses ?? []).reduce((a, l) => a + (l[k] ?? 0), 0);
    ran.push({ shard, usd, changed: e.changed, model: manifest.model,
      tokens: { input: sum('prompt_tokens'), cached: sum('cached_tokens'), output: sum('thinking_tokens') + sum('output_tokens') },
      commits: headsOf(reposOf(e.shardTopics)) });
  }
  let out = null;
  if (ran.length) {
    out = uniquePath(path.join(repo, REVIEW_REL), `${utcDate(now)}-gemini`, '.md');
    fs.writeFileSync(out, [`# Gemini audit ${utcDate(now)} (${ran[0].model}): ${findings.length} findings, ${ran.length} shard(s)`, '',
      `Revision ${head ? head.slice(0, 12) : 'unknown'}. Shards: ${ran.map((r) => r.shard.name).join(', ')}. Unverified hypotheses: reproduce each with a failing test or check (build-with-quality) before acting.`, '', ...docs].join('\n'));
    fs.writeFileSync(out.replace(/\.md$/, '.json'), `${JSON.stringify(findings, null, 2)}\n`);
    for (const r of ran) {
      appendLedger(repo, { ts: stamp, reservation_at: stamp, kind: 'audit', reviewer: 'gemini', shard: r.shard.name, commit: head, commits: r.commits, pack_sha256: r.shard.sha, tokens: r.tokens, est_usd: r.usd, findings: rel(repo, out), changed_topics: r.changed });
    }
  }
  if (errors.length) throw new Error(`${errors.length} shard(s) failed: ${errors.join('; ')}`);
  return ran.length
    ? { findings: rel(repo, out), count: findings.length, usd: ran.reduce((a, r) => a + r.usd, 0), shards: ran.map((r) => r.shard.name), refused: refused.length }
    : { skipped: 'no shard passed the gate', refused: refused.length };
}

/** Merge the newest GLM and Gemini findings files in docs/review and rank findings that both
 *  families raised independently first (merge-findings.cjs). Writes `<date>-merged.{md,json}`. */
function mergeReviews(repo, ctx) {
  const dir = path.join(repo, REVIEW_REL);
  const newest = (suffix) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(`-${suffix}.json`)).sort().pop() : null);
  const picked = ['glm', 'gemini'].map((k) => ({ family: k, file: newest(k) }));
  const missing = picked.filter((p) => !p.file).map((p) => p.family);
  if (missing.length) return { skipped: `need findings from two families; no ${missing.join(' or ')} findings file in ${REVIEW_REL}` };
  const groups = picked.map((p) => ({ family: p.family, findings: JSON.parse(fs.readFileSync(path.join(dir, p.file), 'utf8')) }));
  const merged = MF.mergeFindings(groups);
  const agreed = merged.filter((f) => f.agreement >= 2).length;
  if (ctx.dryRun) return { would_merge: picked.map((p) => p.file), findings: merged.length, agreed };
  const out = uniquePath(dir, `${utcDate(ctx.now)}-merged`, '.json');
  fs.writeFileSync(out, `${JSON.stringify(merged, null, 2)}\n`);
  fs.writeFileSync(out.replace(/\.json$/, '.md'), MF.renderMarkdown(merged));
  return { merged: rel(repo, out), findings: merged.length, agreed };
}

function runExternalChild(corpus, outDir, files) {
  const list = path.join(outDir, 'files.txt');
  fs.writeFileSync(list, `${files.join('\n')}\n`);
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'external-review.cjs'), corpus, '--out', outDir, '--files-from', list], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) { throw new Error(String(err.stderr || err.message).trim().split('\n').pop() || 'external-review failed'); }
}

/** The resolved repo list, per-repo ledger summaries, overlaps and month-to-date spend. */
function statusOf(repos, now, info = {}) {
  const lines = [];
  lines.push(`Repos (${info.source ?? 'given'}${info.added ? `, +${info.added} from the local file` : ''}${info.excluded ? `, ${info.excluded} excluded` : ''}): ${repos.length}`);
  for (const r of repos) lines.push(`  ${r}`);
  const ledgers = repos.map((r) => ({ repo: r, ledger: readLedger(r) }));
  const resolver = createResolver();
  for (const { repo, ledger } of ledgers) {
    lines.push(`${repo}: ${ledger.length} ledger lines`);
    for (const [kind, reviewer] of [['triage', 'glm'], ['review', 'glm'], ['audit', 'gemini']]) {
      const ran = lastOf(ledger, kind, reviewer);
      const last = [...ledger].reverse().find((e) => e.kind === kind && e.reviewer === reviewer);
      const skipNote = last && last.skipped && last !== ran ? `; latest skip: ${last.skipped}` : '';
      lines.push(`  ${kind}/${reviewer}: ${ran ? `last run ${ran.ts}${ran.shard ? ` (${ran.shard})` : ''}${ran.findings ? ` -> ${ran.findings}` : ''}${ran.high_severity ? ` (${ran.high_severity} high severity)` : ''}` : 'never run'}${skipNote}`);
    }
    try {
      const topics = loadTopics(repo, resolver);
      const cited = reposOf(topics).filter((t) => t !== resolver.toplevel(repo));
      if (cited.length) {
        const own = new Set(repos.map((r) => real(r)));
        lines.push(`  cites ${cited.length} other repo(s): ${cited.map((c) => path.basename(c) + (own.has(c) ? ' (has its own corpus, reviewed separately; overlapping areas are different topics)' : '')).join(', ')}`);
      }
      const sk = skipSummary(topics);
      if (sk.count) lines.push(`  ${sk.count} cited path(s) not attributable: ${Object.entries(sk.reasons).map(([k, v]) => `${v} ${k}`).join(', ')}`);
    } catch { /* status never fails on a bad corpus */ }
  }
  const mtd = monthToDateUsd(ledgers.map((l) => l.ledger), now);
  lines.push(`Gemini spend ${new Date(now).toISOString().slice(0, 7)}: $${mtd.toFixed(2)}`);
  return { text: lines.join('\n'), mtd };
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = { cmd: argv[0], repos: [], dryRun: false, manifest: process.env.AGENTBOX_CONFIG || '/etc/agentbox.toml', now: null, workspace: process.env.WORKSPACE || DEFAULT_WORKSPACE };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--manifest') opts.manifest = next();
    else if (a === '--repo') opts.repos.push(path.resolve(next()));
    else if (a === '--workspace') opts.workspace = next();
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--now') opts.now = next();
    else if (a === '--window') { /* accepted: the crontab passes it; the gate is the interval */ }
    else throw new Error(`unknown option ${a}`);
  }
  if (!['triage', 'review-glm', 'audit-gemini', 'merge', 'status'].includes(opts.cmd)) {
    throw new Error('usage: review-cadence.cjs <triage|review-glm|audit-gemini|merge|status> [--manifest f] [--repo dir]... [--workspace dir] [--dry-run] [--now ISO]');
  }
  if (opts.now && Number.isNaN(Date.parse(opts.now))) throw new Error('--now is an ISO time');
  return opts;
}

async function main(argv, deps = {}) {
  const opts = parseArgs(argv);
  const cfg = loadConfig(opts.manifest);
  const now = opts.now ? new Date(opts.now) : new Date();
  const info = opts.repos.length
    ? { repos: opts.repos, source: 'given on the command line' }
    : resolveRepos(cfg, { workspace: opts.workspace, localFile: deps.localFile ?? LOCAL_FILE });
  const repos = info.repos.filter((r) => {
    if (hasCorpus(r) || fs.existsSync(path.join(r, CORPUS_REL))) return true;
    console.log(`review-cadence: ${r} has no ${CORPUS_REL}; skipped`);
    return false;
  });
  if (opts.cmd === 'status') { console.log(statusOf(repos, now, info).text); return 0; }
  if (!cfg.enabled && opts.repos.length === 0) { console.log('review-cadence: [diagram_review].enabled is false; nothing to do'); return 0; }
  if (repos.length === 0) { console.log(`review-cadence: no repos with a ${CORPUS_REL} corpus (${info.source})`); return 0; }

  const ctx = {
    now, cfg, dryRun: opts.dryRun, env: process.env, post: deps.post, runExternal: deps.runExternal ?? runExternalChild,
    model: process.env.DIAGRAM_REVIEW_MODEL || 'gemini-3.8-flash',
  };
  const fn = { triage, 'review-glm': reviewGlm, 'audit-gemini': auditGemini, merge: mergeReviews }[opts.cmd];
  if (opts.cmd === 'audit-gemini' && ctx.model !== 'gemini-3.8-flash') {
    throw new Error('scheduled Gemini pricing is pinned to gemini-3.8-flash; review pricing before changing the model');
  }
  let failed = 0;
  for (const repo of repos) {
    // Spend is capped across every repo, so each audit sees what the earlier ones just booked.
    ctx.mtd = monthToDateUsd(repos.map(readLedger), now);
    try { console.log(`${opts.cmd} ${repo}: ${JSON.stringify(await fn(repo, ctx))}`); }
    catch (err) { failed++; console.error(`${opts.cmd} ${repo}: ${err.message}`); }
  }
  return failed ? 1 : 0;
}

module.exports = {
  readSection, loadConfig, discoverRepos, hasCorpus, readLocalFile, resolveRepos, createResolver, parseSources, loadTopics,
  triageCandidates, changedByRepo, headsOf, reposOf, buildShards, shardChangedTopics, readLedger, appendLedger, monthToDateUsd,
  ledgerPath, decideGemini, estimateGeminiUsd, actualGeminiUsd, packUnchanged, isHighSeverity, parseVerdict, zaiSettings, glm,
  triage, reviewGlm, auditGemini, mergeReviews, statusOf, main, parseArgs, DEFAULTS, GEMINI_USD_PER_M,
};

if (require.main === module) {
  // Serialize the whole multi-repo budget transaction. The kernel releases this lock
  // even after SIGKILL; no stale PID files or paid jobs racing on the same ledger.
  if (process.argv[2] === 'audit-gemini' && !process.env.DIAGRAM_REVIEW_BUDGET_LOCKED) {
    const { spawnSync } = require('node:child_process');
    const child = spawnSync('flock', ['-n', '-E', '75', path.join(os.tmpdir(), 'agentbox-diagram-review-budget.lock'),
      process.execPath, __filename, ...process.argv.slice(2)], {
      stdio: 'inherit', env: { ...process.env, DIAGRAM_REVIEW_BUDGET_LOCKED: '1' },
    });
    if (child.error) console.error(`review-cadence: cannot acquire budget lock: ${child.error.message}`);
    if (child.status === 75) console.error('review-cadence: another Gemini audit holds the budget lock; skipped');
    process.exit(child.status === 75 ? 0 : child.status ?? 1);
  }
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => {
    console.error(`review-cadence: ${err.message}`);
    process.exit(/needs a value|unknown option|usage:|is an ISO/.test(err.message) ? 2 : 1);
  });
}
