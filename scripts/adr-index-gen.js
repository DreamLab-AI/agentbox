#!/usr/bin/env node
'use strict';

/*
 * adr-index-gen.js — walk an ADR docs tree, parse YAML frontmatter, validate,
 * and (re)generate a README.md index table from the frontmatter.
 *
 * Usage:  node scripts/adr-index-gen.js <dir> [--check] [--check-index] [--exclude NAME]...
 *
 *   <dir>          directory to walk recursively for *.md ADR files
 *   --check        validate only; do not write README.md (still exits 1 on error)
 *   --check-index  additionally compare the generated table against the README
 *                  on disk and FAIL when they differ (implies --check)
 *   --exclude NAME skip a file that is not a decision record (e.g. a hand-kept
 *                  pointer index). NAME is a path relative to <dir> or a bare
 *                  file name. Repeatable; `--exclude=NAME` also works. Adds to
 *                  the `exclude` list of the ledger config.
 *
 * Ledger config (optional): <dir>/.ledger.json
 *
 *   { "repo": "ontomark",                  // string, or an array of accepted values
 *     "exclude": ["ESTATE-ADRS.md"],       // files to skip, as for --exclude
 *     "regenerate": "bash scripts/adr-ledger.sh write" }
 *                                          // command printed in the index and in
 *                                          // stale-index failures (default:
 *                                          // `node scripts/adr-index-gen.js <dir>`)
 *
 *   Without the file the behaviour is the historical one: `repo` must be
 *   `visionclaw` or `agentbox`, nothing extra is excluded, and the generated
 *   index is byte-for-byte what it was before the config existed. A config file
 *   that is not valid JSON, or has a field of the wrong type, is a usage error
 *   (exit 2) rather than a silent fallback to the defaults.
 *
 * Exit codes:
 *   0  all validations passed (README written unless --check/--check-index)
 *   1  one or more validation errors, or (with --check-index) a stale index
 *   2  usage / IO / ledger-config error
 *
 * ADR-2001. `--check` validates RECORDS; on its own it says nothing about the
 * README. That is a real gap, not a nicety: a fixture with a deliberately stale
 * index passes `--check` today, so the ledger's own navigation surface can drift
 * from the records it indexes without any gate noticing. `--check-index` closes
 * it by regenerating the table in memory and comparing byte-for-byte with the
 * file, reporting the first differing line and the exact regeneration command.
 * It is a separate flag rather than folded into `--check` so that wiring it into
 * CI is a deliberate decision taken when the pack is settled — turning an
 * existing green step red as a side effect would be a worse outcome than the
 * drift it detects.
 *
 * The generated README.md is a build artefact — never hand-edit it.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REQUIRED_FIELDS = [
  'id', 'title', 'date', 'decision_status', 'implementation_status',
  'activation_status', 'supersedes', 'superseded_by', 'verified_commit',
  'owner', 'review_trigger', 'repo',
];

const DEFAULT_REPOS = ['visionclaw', 'agentbox'];
const CONFIG_NAME = '.ledger.json';

const ENUMS = {
  decision_status: ['proposed', 'accepted', 'rejected', 'superseded'],
  implementation_status: ['none', 'partial', 'complete'],
  activation_status: ['inactive', 'staged', 'live'],
  repo: DEFAULT_REPOS,
};

// Files that are templates/skeletons: validated for structure but excluded
// from the reciprocity graph and the emitted index (id === 'ADR-NNNN').
const TEMPLATE_ID = 'ADR-NNNN';

function fail(msg) { console.error(`error: ${msg}`); }
function warn(msg) { console.warn(`warning: ${msg}`); }

// --- minimal YAML frontmatter parser (flat scalars + inline [a, b] lists) ---
function parseFrontmatter(text, file) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const body = m[1];
  const out = {};
  for (const rawLine of body.split(/\r?\n/)) {
    // strip trailing comments (only when not inside quotes — simple heuristic)
    let line = rawLine;
    if (!/["']/.test(line)) line = line.replace(/\s+#.*$/, '');
    line = line.replace(/\s+$/, '');
    if (line.trim() === '') continue;
    const km = /^([A-Za-z_][\w-]*):\s?(.*)$/.exec(line);
    if (!km) continue;
    const key = km[1];
    let val = km[2].trim();
    if (val === '') { out[key] = ''; continue; }
    if (val.startsWith('[') && val.endsWith(']')) {
      const inner = val.slice(1, -1).trim();
      out[key] = inner === '' ? [] : inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      continue;
    }
    val = val.replace(/^["']|["']$/g, '');
    out[key] = val;
  }
  return out;
}

function walk(dir, acc, root = dir, exclude = new Set()) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    const rel = path.relative(root, p).split(path.sep).join('/');
    if (exclude.has(rel) || exclude.has(ent.name)) continue;
    if (ent.isDirectory()) walk(p, acc, root, exclude);
    else if (
      ent.isFile() &&
      ent.name.endsWith('.md') &&
      ent.name !== 'README.md' &&
      ent.name !== 'PREAMBLE.md'
    )
      acc.push(p);
  }
  return acc;
}

// Read <dir>/.ledger.json. Returns { repos, exclude, regenerate } or throws an
// Error whose message is a usage-level complaint (the caller exits 2).
function loadLedgerConfig(dir) {
  const cfg = { repos: DEFAULT_REPOS.slice(), exclude: [], regenerate: null };
  const file = path.join(dir, CONFIG_NAME);
  if (!fs.existsSync(file)) return cfg;
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { throw new Error(`${file}: not valid JSON (${e.message})`); }
  if (j === null || typeof j !== 'object' || Array.isArray(j)) {
    throw new Error(`${file}: must be a JSON object`);
  }
  const strList = (v, name) => {
    const a = typeof v === 'string' ? [v] : v;
    if (!Array.isArray(a) || a.length === 0 || a.some(x => typeof x !== 'string' || x.trim() === '')) {
      throw new Error(`${file}: '${name}' must be a non-empty string or array of non-empty strings`);
    }
    return a.map(x => x.trim());
  };
  if ('repo' in j) cfg.repos = strList(j.repo, 'repo');
  if ('exclude' in j) {
    if (!Array.isArray(j.exclude) || j.exclude.some(x => typeof x !== 'string' || x.trim() === '')) {
      throw new Error(`${file}: 'exclude' must be an array of non-empty strings`);
    }
    cfg.exclude = j.exclude.map(x => x.trim());
  }
  if ('regenerate' in j) {
    if (typeof j.regenerate !== 'string' || j.regenerate.trim() === '') {
      throw new Error(`${file}: 'regenerate' must be a non-empty string`);
    }
    cfg.regenerate = j.regenerate.trim();
  }
  for (const k of Object.keys(j)) {
    if (!['repo', 'exclude', 'regenerate'].includes(k)) {
      throw new Error(`${file}: unknown key '${k}' (known: repo, exclude, regenerate)`);
    }
  }
  return cfg;
}

function main() {
  const args = process.argv.slice(2);
  const USAGE = 'usage: adr-index-gen.js <dir> [--check] [--check-index] [--exclude NAME]...';
  const checkIndex = args.includes('--check-index');
  const check = args.includes('--check') || checkIndex;
  // Positional <dir> is the first token that is neither a flag nor the value of
  // --exclude (otherwise `--exclude X <dir>` would mistake X for the directory).
  let dir = null;
  const cliExclude = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--exclude') {
      if (i + 1 >= args.length) { fail(`--exclude needs a value; ${USAGE}`); process.exit(2); }
      cliExclude.push(args[++i]);
    } else if (a.startsWith('--exclude=')) {
      cliExclude.push(a.slice('--exclude='.length));
    } else if (!a.startsWith('--') && dir === null) {
      dir = a;
    }
  }
  if (!dir) { fail(USAGE); process.exit(2); }
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    fail(`not a directory: ${dir}`); process.exit(2);
  }
  let cfg;
  try { cfg = loadLedgerConfig(dir); }
  catch (e) { fail(e.message); process.exit(2); }
  if (cliExclude.some(x => x.trim() === '')) { fail(`--exclude needs a non-empty value; ${USAGE}`); process.exit(2); }
  ENUMS.repo = cfg.repos;
  const regenerateCmd = cfg.regenerate || `node scripts/adr-index-gen.js ${dir}`;
  const exclude = new Set([...cfg.exclude, ...cliExclude.map(x => x.trim())].map(x => x.replace(/^\.\//, '')));

  const files = walk(dir, [], dir, exclude);
  const records = [];
  let errors = 0;

  for (const file of files) {
    const rel = path.relative(dir, file);
    const text = fs.readFileSync(file, 'utf8');
    const fm = parseFrontmatter(text, file);
    if (!fm) { fail(`${rel}: no YAML frontmatter block`); errors++; continue; }

    for (const field of REQUIRED_FIELDS) {
      if (!(field in fm)) { fail(`${rel}: missing required field '${field}'`); errors++; }
    }
    // The template skeleton (id ADR-NNNN) must carry every key but is exempt
    // from value-level checks (empty scalars, enum membership) — it is a form.
    const isTemplate = fm.id === TEMPLATE_ID;
    if (!isTemplate) {
      // required scalars must be non-empty (list fields may legitimately be
      // empty). A proposed/rejected record has verified nothing yet — an empty
      // verified_commit is its honest state, so it is exempt for those statuses
      // (it carries no verified_paths, so the staleness gate stays inert too).
      const unbuilt = fm.decision_status === 'proposed' || fm.decision_status === 'rejected';
      for (const field of REQUIRED_FIELDS) {
        if (field === 'supersedes' || field === 'superseded_by') continue;
        if (field === 'verified_commit' && unbuilt) continue;
        if (field in fm && String(fm[field]).trim() === '') {
          fail(`${rel}: required field '${field}' is empty`); errors++;
        }
      }
      for (const [field, allowed] of Object.entries(ENUMS)) {
        if (field in fm && fm[field] !== '' && !allowed.includes(fm[field])) {
          fail(`${rel}: '${field}' = '${fm[field]}' not in {${allowed.join(', ')}}`); errors++;
        }
      }
    }
    for (const lf of ['supersedes', 'superseded_by']) {
      if (lf in fm && !Array.isArray(fm[lf])) {
        fail(`${rel}: '${lf}' must be a list, e.g. [] or [ADR-0042]`); errors++;
      }
    }
    // Optional staleness contract: a list of repo-relative paths this record's
    // verification inspected. Presence arms the verified_commit staleness gate.
    if ('verified_paths' in fm && !Array.isArray(fm.verified_paths)) {
      fail(`${rel}: 'verified_paths' must be a list of repo-relative paths`); errors++;
    }
    records.push({ file, rel, fm });
  }

  // --- supersedes reciprocity (skip templates) ---
  const real = records.filter(r => r.fm.id && r.fm.id !== TEMPLATE_ID);
  const byId = new Map();
  for (const r of real) {
    if (byId.has(r.fm.id)) { fail(`duplicate id '${r.fm.id}' (${r.rel} and ${byId.get(r.fm.id).rel})`); errors++; }
    else byId.set(r.fm.id, r);
  }
  // In-tree reciprocity violations are hard ERRORS (the graph is the point of
  // the typed fields — an asymmetric edge silently lies to the index). Targets
  // absent from this tree stay warnings: they may be legacy-archive or
  // cross-repo references the per-tree run cannot resolve.
  for (const r of real) {
    for (const target of (r.fm.supersedes || [])) {
      const t = byId.get(target);
      if (!t) { warn(`${r.rel}: supersedes '${target}' which is not present in this tree`); continue; }
      if (!(t.fm.superseded_by || []).includes(r.fm.id)) {
        fail(`reciprocity: ${r.fm.id} supersedes ${target}, but ${target}.superseded_by does not list ${r.fm.id}`);
        errors++;
      }
    }
    for (const src of (r.fm.superseded_by || [])) {
      const s = byId.get(src);
      if (!s) { warn(`${r.rel}: superseded_by '${src}' which is not present in this tree`); continue; }
      if (!(s.fm.supersedes || []).includes(r.fm.id)) {
        fail(`reciprocity: ${r.fm.id} superseded_by ${src}, but ${src}.supersedes does not list ${r.fm.id}`);
        errors++;
      }
    }
  }

  // --- mechanical staleness: verified_paths vs verified_commit ---
  // Opt-in per record: when a record declares `verified_paths: [a, b]`, its
  // verified_commit must (a) exist, (b) be an ancestor of HEAD, and (c) none of
  // the named paths may have changed since it — otherwise the verification
  // claim is STALE and the run fails. Records without verified_paths only get
  // a soft nudge toward full 40-char SHAs.
  let repoRoot = null;
  try {
    repoRoot = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    warn('git unavailable or not a repository — staleness checks skipped');
  }
  if (repoRoot) {
    for (const r of real) {
      const commit = String(r.fm.verified_commit || '').trim();
      const paths = r.fm.verified_paths;
      if (!commit) continue;
      if (!/^[0-9a-f]{40}$/.test(commit) && Array.isArray(paths) && paths.length) {
        warn(`${r.rel}: verified_commit '${commit}' is abbreviated — use the full 40-char SHA for staleness checking`);
      }
      if (!Array.isArray(paths) || paths.length === 0) continue;
      const git = (...a) => execFileSync('git', ['-C', repoRoot, ...a],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      try { git('rev-parse', '--verify', `${commit}^{commit}`); }
      catch { fail(`${r.rel}: verified_commit '${commit}' does not exist in ${repoRoot}`); errors++; continue; }
      try { git('merge-base', '--is-ancestor', commit, 'HEAD'); }
      catch { fail(`${r.rel}: verified_commit '${commit}' is not an ancestor of HEAD`); errors++; continue; }
      let changed = '';
      try { changed = git('diff', '--name-only', `${commit}..HEAD`, '--', ...paths); }
      catch (e) { fail(`${r.rel}: git diff failed for verified_paths: ${e.message}`); errors++; continue; }
      if (changed !== '') {
        fail(`${r.rel}: STALE — governed paths changed since verified_commit ${commit}: ${changed.split('\n').join(', ')} (re-verify and bump verified_commit)`);
        errors++;
      }
    }
  }

  if (errors > 0) {
    fail(`${errors} validation error(s); README not generated`);
    process.exit(1);
  }

  // --- emit README.md ---
  const rows = real.slice().sort((a, b) => a.fm.id.localeCompare(b.fm.id, undefined, { numeric: true }));
  const esc = s => String(s == null ? '' : s).replace(/\|/g, '\\|');
  const listCell = v => (Array.isArray(v) && v.length ? v.join(', ') : '—');

  let md = '<!-- GENERATED BY scripts/adr-index-gen.js — DO NOT EDIT BY HAND (edit PREAMBLE.md for the prose) -->\n\n';
  md += '# Architecture Decision Records\n\n';
  // Optional hand-written preamble: if PREAMBLE.md exists beside the records it
  // is inlined verbatim above the table. This is where the "how to work against
  // this pack" routing prose lives, surviving regeneration.
  const preamblePath = path.join(dir, 'PREAMBLE.md');
  if (fs.existsSync(preamblePath)) {
    md += fs.readFileSync(preamblePath, 'utf8').trim() + '\n\n';
  }
  md += `_${rows.length} record(s). Regenerate with_ \`${regenerateCmd}\`.\n\n`;
  md += '| ID | Title | Domain | Date | Decision | Impl | Activation | Supersedes | Superseded by | Owner | Repo |\n';
  md += '|----|-------|--------|------|----------|------|------------|------------|---------------|-------|------|\n';
  for (const r of rows) {
    const f = r.fm;
    const link = `[${esc(f.id)}](${encodeURI(r.rel)})`;
    // `domain` (optional) names the governing living doc this record amends;
    // `lineage` (optional, free text) cites the legacy archive records it
    // distils — kept distinct from `supersedes`, whose reciprocity is validated
    // strictly within this ledger.
    md += `| ${link} | ${esc(f.title)} | ${esc(f.domain || '—')} | ${esc(f.date)} | ${esc(f.decision_status)} | ${esc(f.implementation_status)} | ${esc(f.activation_status)} | ${esc(listCell(f.supersedes))} | ${esc(listCell(f.superseded_by))} | ${esc(f.owner)} | ${esc(f.repo)} |\n`;
  }

  const outPath = path.join(dir, 'README.md');

  if (checkIndex) {
    // ADR-2001: compare the generated index with the file that is supposed to be
    // it. Reported as a first-difference line pair rather than a whole diff, so
    // the failure names what drifted instead of dumping the table.
    let current = null;
    try { current = fs.readFileSync(outPath, 'utf8'); }
    catch { fail(`${path.relative(process.cwd(), outPath)} does not exist — the index has never been generated`); process.exit(1); }
    if (current === md) {
      console.log(`ok: ${rows.length} ADR(s) valid and ${path.relative(process.cwd(), outPath)} is in sync`);
      process.exit(0);
    }
    const cur = current.split('\n');
    const gen = md.split('\n');
    const at = (() => {
      for (let i = 0; i < Math.max(cur.length, gen.length); i++) if (cur[i] !== gen[i]) return i;
      return -1;
    })();
    fail(`${path.relative(process.cwd(), outPath)} is STALE: it does not match the index generated from the ${rows.length} record(s) on disk`);
    console.error(`  first difference at line ${at + 1}`);
    console.error(`    on disk:   ${JSON.stringify(cur[at] ?? '<end of file>')}`);
    console.error(`    generated: ${JSON.stringify(gen[at] ?? '<end of file>')}`);
    console.error(`  regenerate with: ${regenerateCmd}`);
    process.exit(1);
  }

  if (check) {
    console.log(`ok: ${rows.length} ADR(s) valid (--check, README neither written nor compared — use --check-index to compare)`);
  } else {
    fs.writeFileSync(outPath, md);
    console.log(`ok: ${rows.length} ADR(s) valid; wrote ${path.relative(process.cwd(), outPath)}`);
  }
  process.exit(0);
}

main();
