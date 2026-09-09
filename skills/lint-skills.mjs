#!/usr/bin/env node
// Skills estate freshness + progressive-disclosure lint (ADR-2021).
//
// Invoked through the stable CI entry point `skills/lint-skills.sh`.
// Exit 0 = clean, non-zero = violations.
//
// Checks
//   1. STALE          banned stale strings (retired hosts, dead SDKs, wrong embeddings)
//   2. ABSPATH        absolute `~/.claude/skills` paths (skills bake at /opt/agentbox/skills)
//   3. RETIRED-PATH   the retired literal `/workspace/` prefix
//   4. FRONTMATTER    a real YAML frontmatter block carrying non-empty `name` + `description`
//   5. BUDGET         entry-context budget: SKILL.md <= MAX_ENTRY_LINES, or genuine
//                     progressive disclosure (a `references/` dir holding >=1 readable file)
//   6. RESOURCE       every relative `references/`, `scripts/`, `assets/` path cited by
//                     SKILL.md resolves to something that exists
//   7. NAME           frontmatter `name` is lowercase-hyphen and equals the directory name
//                     (agentskills.io; ruflo validator) — audit 2026-09-09 found 7 Title-Case names
//   8. DESCLEN        `description` <= 1024 chars (agentskills.io cap; it is the always-loaded
//                     trigger contract); < 40 chars is a warning
//   9. REGISTERED     every entry in registered-skills.txt / codex-registered-skills.txt names a
//                     baked skill that is not a deprecated redirect
//  10. DIRECTORY      every skill directory is named in SKILL-DIRECTORY.md and in
//                     skill-router/references/section-map.json (the router's single source)
//  11. ROUTING        skill-router/references/routing-table.md is current (gen-routing-table --check)
//  12. DEPRECATED     a redirect stub (description starts "DEPRECATED") carries `deprecated: true`
//                     and a `replacement:` that exists
//  Warnings (printed, never fail): unknown frontmatter keys outside the documented vocabulary
//  (KEYS), and stale model ids presented as current in SKILL.md (MODEL).
//
// Suppression (documented, unchanged in spirit from the 2026-08-21 lint):
//   * a line carrying the `lint-ok` marker is waved through by every check;
//   * for STALE only, the historical prose-context words (DEAD, retired, legacy,
//     deprecated, "is not", "never target") also wave a line through.
//   A suppression is NOT semantic validation: suppressed hits are counted and listed
//   separately in the summary so the estate can see what it is choosing to ignore.

import { readFileSync, readdirSync, statSync, existsSync, accessSync, constants } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILLS_DIR = dirname(fileURLToPath(import.meta.url));

/** Entry-context budget: the deliberate cap on SKILL.md length, in lines.
 *  Carried over unchanged from the line-grep lint (`-gt 250`). */
const MAX_ENTRY_LINES = 250;

/** Marker that waves a single line through any check. */
const SUPPRESS_MARKER = 'lint-ok';

/** Directories that carry vendored or third-party markdown and are not linted. */
// ADR-2056: `toprank` was formerly listed here, which excluded a real skill from ALL
// SIX lint checks (not just the narrow absolute-path exemption it also carries in
// ABSPATH_SKIP_DIRS below) and made this gate report 125 skills while
// scripts/skill-count-check.js reported 126. Verified it passes every check, so the
// blanket skip was unnecessary. Only genuinely non-skill directories belong here.
const SKIP_DIRS = new Set(['node_modules', '.git']);

const BANNED =
  /MiniLM|google\.generativeai|gemini-2\.0-flash-exp|openai-user|gemini-user|192\.168\.2\.48|agent-browser|@claude-flow\/browser/;
const STALE_CONTEXT_SUPPRESS = /DEAD|dead|retired|legacy|is not|never target|lint-ok|deprecated/;
const ABSPATH = /(~|\/home\/devuser)\/\.claude\/skills\//;
const ABSPATH_OK = /\/opt\/agentbox\/skills|lint-ok/;
// ADR-2021 / audit 2026-09-09: `skill-builder` was skipped because it taught `~/.claude/skills`
// placement; it now teaches the master-copy model and carries no absolute paths, so it is linted.
const ABSPATH_SKIP_DIRS = new Set(['architecture-studio', 'toprank']);

/** Frontmatter `name` rule (agentskills.io §name; ruflo SKILL.md validator). */
const NAME_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const NAME_MAX = 64;
/** `description` bounds: agentskills.io cap, and a floor that catches vague one-liners. */
const DESC_MAX = 1024;
const DESC_MIN = 40;
/** Registration manifests reconciled at boot (Claude → ~/.claude/skills, Codex → ~/.codex/skills). */
const MANIFESTS = ['registered-skills.txt', 'codex-registered-skills.txt'];
/** Documented frontmatter vocabulary: agentskills.io core, Claude Code extras, estate conventions. */
const KNOWN_KEYS = new Set([
  // agentskills.io
  'name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools',
  // Claude Code (code.claude.com/docs/en/skills)
  'when_to_use', 'argument-hint', 'arguments', 'user-invocable', 'disable-model-invocation', 'model',
  'effort', 'context', 'agent', 'background', 'hooks', 'paths', 'shell', 'disallowed-tools',
  // estate conventions in live use (see skill-builder/SKILL.md)
  'version', 'author', 'authors', 'tags', 'triggers', 'related_skills', 'depends_on_mcps', 'optional_mcps',
  'env_vars', 'dependencies', 'mcp_server', 'protocol', 'entry_point', 'port', 'manifest_gate', 'gate',
  'deprecated', 'replacement', 'replaces', 'status', 'category', 'cron', 'tools', 'tools_required',
  'requires', 'prerequisites', 'memory', 'section', 'skill', 'args', 'upstream', 'upstream_version',
  'provenance', 'progressive_disclosure', 'priority', 'layer', 'depends_on', 'capabilities',
  'authority_class', 'title', 'repo', 'workflows',
]);
/** Model ids that are stale as a CURRENT claim (estate lineup: Fable 5.1 / Opus 5 / Sonnet 5 /
 *  Haiku 4.5 / GPT-6 Astra). Historical context words suppress, as for STALE. */
const STALE_MODEL = /\b(opus[ -]?4(\.[0-9])?|sonnet[ -]?4(\.[0-9])?|claude-3|gpt-?4o?|gpt-?5(\.[0-9])?|o3-mini|o4-mini)\b/i;
const STALE_MODEL_SUPPRESS = /DEAD|dead|retired|legacy|deprecated|historical|not current|was |formerly|lint-ok|20(24|25|26)-[01][0-9]/;
const RETIRED_PATH = /(^|[^a-zA-Z0-9_./~-])\/workspace\//;

/** Resource roots a SKILL.md may cite relatively. */
const RESOURCE_ROOTS = ['references', 'scripts', 'assets'];

const findings = [];
const suppressions = [];
const warnings = [];
function warn(code, file, line, message) {
  warnings.push({ code, file, line, message });
}

function fail(code, file, line, message) {
  findings.push({ code, file, line, message });
}
function suppressed(code, file, line, message) {
  suppressions.push({ code, file, line, message });
}

// ---------------------------------------------------------------------------
// Filesystem helpers
// ---------------------------------------------------------------------------

/** Every `*.md` under `skills/`, excluding vendored trees. */
function markdownFiles(dir = SKILLS_DIR, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      markdownFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

// Top-level skill directories holding a SKILL.md (the `<skill>/SKILL.md` glob).
function skillEntries() {
  const out = [];
  for (const entry of readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    const skillMd = join(SKILLS_DIR, entry.name, 'SKILL.md');
    if (existsSync(skillMd)) out.push({ name: entry.name, dir: join(SKILLS_DIR, entry.name), skillMd });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** True when `dir` holds at least one readable regular file (recursively). */
function hasReadableFile(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isFile()) {
      try {
        accessSync(full, constants.R_OK);
        if (statSync(full).size >= 0) return true;
      } catch {
        /* unreadable — keep looking */
      }
    } else if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      if (hasReadableFile(full)) return true;
    }
  }
  return false;
}

const rel = (p) => relative(SKILLS_DIR, p) || p;

// ---------------------------------------------------------------------------
// Frontmatter parser
// ---------------------------------------------------------------------------

/**
 * Parses a real YAML frontmatter block: `---` on line 1, a closing `---` (or
 * `...`) line, and top-level mapping entries in between. Understands quoted
 * scalars, block scalars (`|`, `>` and their chomping variants), comments,
 * and nested mappings/sequences (recorded as non-scalar).
 *
 * @returns {{ok: boolean, error?: string, keys?: Map<string,{kind:string,value:string,line:number}>}}
 */
export function parseFrontmatter(text) {
  const lines = text.split('\n');
  if (lines.length === 0) return { ok: false, error: 'file is empty' };

  const first = lines[0].replace(/^\uFEFF/, '').trimEnd();
  if (first !== '---') return { ok: false, error: 'missing opening --- on line 1' };

  let close = -1;
  for (let i = 1; i < lines.length; i++) {
    const t = lines[i].trimEnd();
    if (t === '---' || t === '...') {
      close = i;
      break;
    }
  }
  if (close === -1) return { ok: false, error: 'frontmatter block is never closed by a --- line' };

  const block = lines.slice(1, close);
  if (block.every((l) => l.trim() === '')) return { ok: false, error: 'frontmatter block is empty' };

  const keys = new Map();
  const keyRe =
    /^(?:(["'])(?<qk>(?:(?!\1).)*)\1|(?<pk>[^\s:#][^:]*?))[ \t]*:(?:[ \t]+(?<val>.*?))?[ \t]*$/;

  let i = 0;
  let sawTopLevelSequence = false;
  while (i < block.length) {
    const raw = block[i];
    if (raw.trim() === '' || /^[ \t]*#/.test(raw)) {
      i++;
      continue;
    }
    const indent = raw.length - raw.trimStart().length;
    if (indent > 0) {
      i++; // nested content — already attributed to the key above it
      continue;
    }
    if (/^-(\s|$)/.test(raw)) {
      sawTopLevelSequence = true;
      i++;
      continue;
    }
    const m = keyRe.exec(raw);
    if (!m) {
      i++; // not a mapping entry (stray document text) — ignored
      continue;
    }
    const key = (m.groups.qk !== undefined ? m.groups.qk : m.groups.pk).trim();
    const lineNo = i + 2; // +1 for the opening ---, +1 for 1-based numbering
    let rawVal = m.groups.val === undefined ? '' : m.groups.val;

    // Block scalar: value lives in the following more-indented lines.
    if (/^[|>][+-]?[0-9]*$/.test(rawVal.trim())) {
      let j = i + 1;
      const parts = [];
      while (j < block.length) {
        const next = block[j];
        if (next.trim() === '') {
          parts.push('');
          j++;
          continue;
        }
        const nIndent = next.length - next.trimStart().length;
        if (nIndent === 0) break;
        parts.push(next.trim());
        j++;
      }
      const value = parts.join(' ').trim();
      keys.set(key, { kind: value ? 'scalar' : 'empty', value, line: lineNo });
      i = j;
      continue;
    }

    // Inline scalar: strip an unquoted trailing comment, then unquote.
    let value = rawVal;
    const q = value[0];
    if (q === '"' || q === "'") {
      const end = value.indexOf(q, 1);
      value = end === -1 ? value.slice(1) : value.slice(1, end);
    } else {
      value = value.replace(/(^|[ \t])#.*$/, '$1').trim();
    }
    value = value.trim();

    if (value === '') {
      // Empty inline value — is a nested mapping/sequence following?
      let j = i + 1;
      let nested = false;
      while (j < block.length) {
        const next = block[j];
        if (next.trim() === '' || /^[ \t]*#/.test(next)) {
          j++;
          continue;
        }
        const nIndent = next.length - next.trimStart().length;
        if (nIndent === 0) break;
        nested = true;
        j++;
      }
      keys.set(key, { kind: nested ? 'nested' : 'empty', value: '', line: lineNo });
      i = j;
      continue;
    }

    keys.set(key, { kind: 'scalar', value, line: lineNo });
    i++;
  }

  if (keys.size === 0) {
    return {
      ok: false,
      error: sawTopLevelSequence
        ? 'frontmatter block is a sequence, not a mapping'
        : 'frontmatter block contains no top-level mapping keys',
    };
  }
  return { ok: true, keys };
}

// ---------------------------------------------------------------------------
// Resource reference extraction
// ---------------------------------------------------------------------------

/** Normalises a cited path; returns null when it is not a local resource path. */
function normaliseResource(raw) {
  if (!raw) return null;
  let p = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return null; // http:, mailto:, urn: …
  if (p.startsWith('#') || p.startsWith('<')) return null;
  if (/[*?{}$<>|]/.test(p)) return null; // globs / template placeholders
  if (p.includes('...')) return null; // elided example path, not a real target
  p = p.split('#')[0].split('?')[0].trim();
  if (p.startsWith('./')) p = p.slice(2);
  p = p.replace(/\/+$/, '');
  if (!p) return null;
  const head = p.split('/')[0];
  if (!RESOURCE_ROOTS.includes(head)) return null;
  // A bare `references/`, `scripts/` or `assets/` names the convention (or an
  // output directory in the caller's tree), not a specific skill resource.
  if (p === head) return null;
  return p;
}

/** Every `references|scripts|assets` path cited by one SKILL.md, with line numbers. */
export function citedResources(text) {
  const out = [];
  const push = (line, path) => {
    const p = normaliseResource(path);
    if (p && !out.some((o) => o.line === line && o.path === p)) out.push({ line, path: p });
  };
  const lines = text.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    // Fenced blocks hold worked-example output and shell transcripts, not the
    // skill's own resource manifest — the three cited forms are prose forms.
    if (inFence) continue;
    const n = i + 1;
    // markdown links: [text](path "title")
    for (const m of line.matchAll(/\[[^\]\n]*\]\(([^)\s]+)(?:\s+["'][^)]*["'])?\)/g)) push(n, m[1]);
    // inline backtick paths
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      if (!/\s/.test(m[1])) push(n, m[1]);
    }
    // bare path alone on its line
    const bare = /^\s*([A-Za-z0-9_][A-Za-z0-9_./+-]*)\s*$/.exec(line);
    if (bare) push(n, bare[1]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

function checkTextPatterns() {
  for (const file of markdownFiles()) {
    const r = rel(file);
    if (r.includes('lint-skills')) continue;
    const segments = r.split(sep);
    const topDir = segments.length > 1 ? segments[0] : '';
    let lines;
    try {
      lines = readFileSync(file, 'utf8').split('\n');
    } catch {
      continue;
    }
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const n = i + 1;
      const hit = `${r}:${n}:${line.trim()}`;

      if (BANNED.test(line)) {
        if (STALE_CONTEXT_SUPPRESS.test(line)) suppressed('STALE', r, n, hit);
        else fail('STALE', r, n, hit);
      }
      if (ABSPATH.test(line) && !ABSPATH_SKIP_DIRS.has(topDir)) {
        if (ABSPATH_OK.test(line)) suppressed('ABSPATH', r, n, hit);
        else fail('ABSPATH', r, n, hit);
      }
      if (RETIRED_PATH.test(line) && !line.includes('/home/devuser/workspace') && !line.includes('$WORKSPACE')) {
        if (line.includes(SUPPRESS_MARKER)) suppressed('RETIRED-PATH', r, n, hit);
        else fail('RETIRED-PATH', r, n, hit);
      }
    }
  }
}

function checkSkill(skill) {
  const text = readFileSync(skill.skillMd, 'utf8');
  const lines = text.split('\n');
  const r = rel(skill.skillMd);

  // --- 4. FRONTMATTER -------------------------------------------------------
  const fm = parseFrontmatter(text);
  if (!fm.ok) {
    fail('FRONTMATTER', r, 1, `${r}: ${fm.error}`);
  } else {
    for (const key of ['name', 'description']) {
      const entry = fm.keys.get(key);
      if (!entry) {
        fail('FRONTMATTER', r, 1, `${r}: no top-level \`${key}\` inside the frontmatter block`);
      } else if (entry.kind !== 'scalar' || entry.value === '') {
        fail(
          'FRONTMATTER',
          r,
          entry.line,
          `${r}:${entry.line}: \`${key}\` must be a non-empty scalar (got ${entry.kind})`,
        );
      }
    }
  }

  // --- 7/8/12. NAME, DESCLEN, DEPRECATED, KEYS, MODEL -----------------------
  if (fm.ok) {
    const nameE = fm.keys.get('name');
    if (nameE && nameE.kind === 'scalar') {
      if (!NAME_RE.test(nameE.value) || nameE.value.length > NAME_MAX) {
        fail('NAME', r, nameE.line, `${r}:${nameE.line}: name \`${nameE.value}\` must match ${NAME_RE} and be <= ${NAME_MAX} chars`);
      } else if (nameE.value !== skill.name) {
        fail('NAME', r, nameE.line, `${r}:${nameE.line}: name \`${nameE.value}\` must equal the directory name \`${skill.name}\``);
      }
    }
    const descE = fm.keys.get('description');
    if (descE && descE.kind === 'scalar') {
      const len = descE.value.length;
      if (len > DESC_MAX) fail('DESCLEN', r, descE.line, `${r}:${descE.line}: description is ${len} chars (max ${DESC_MAX})`);
      else if (len < DESC_MIN) warn('DESCLEN', r, descE.line, `${r}:${descE.line}: description is ${len} chars (< ${DESC_MIN}; say what + when)`);
      if (/^\s*DEPRECATED\b/i.test(descE.value)) {
        const dep = fm.keys.get('deprecated');
        const rep = fm.keys.get('replacement');
        if (!dep || !/^(true|yes)$/i.test(dep.value)) fail('DEPRECATED', r, descE.line, `${skill.name}: redirect stub must carry \`deprecated: true\``);
        if (!rep || rep.kind !== 'scalar' || !rep.value) fail('DEPRECATED', r, descE.line, `${skill.name}: redirect stub must carry \`replacement: <skill>\``);
        else if (!existsSync(join(SKILLS_DIR, rep.value, 'SKILL.md'))) fail('DEPRECATED', r, rep.line, `${skill.name}: replacement \`${rep.value}\` is not a skill directory`);
      }
    }
    for (const [k, e] of fm.keys) {
      if (!KNOWN_KEYS.has(k)) warn('KEYS', r, e.line, `${r}:${e.line}: frontmatter key \`${k}\` is outside the documented vocabulary (see skill-builder)`);
    }
    // MODEL: only the entry file, only lines that read as current claims.
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (STALE_MODEL.test(line) && !STALE_MODEL_SUPPRESS.test(line)) {
        warn('MODEL', r, i + 1, `${r}:${i + 1}: stale model id presented as current: ${line.trim().slice(0, 120)}`);
      }
    }
  }

  // --- 5. BUDGET ------------------------------------------------------------
  // `wc -l` semantics: count newline-terminated lines.
  const lineCount = text.endsWith('\n') ? lines.length - 1 : lines.length;
  if (lineCount > MAX_ENTRY_LINES) {
    const refsDir = join(skill.dir, 'references');
    const hasDir = existsSync(refsDir) && statSync(refsDir).isDirectory();
    if (!hasDir) {
      fail(
        'BUDGET',
        r,
        1,
        `${skill.name} (${lineCount} lines > MAX_ENTRY_LINES ${MAX_ENTRY_LINES}, no references/)`,
      );
    } else if (!hasReadableFile(refsDir)) {
      fail(
        'BUDGET',
        r,
        1,
        `${skill.name} (${lineCount} lines > MAX_ENTRY_LINES ${MAX_ENTRY_LINES}, references/ holds no readable file — progressive disclosure not satisfied)`,
      );
    }
  }

  // --- 6. RESOURCE ----------------------------------------------------------
  for (const { line, path } of citedResources(text)) {
    const src = lines[line - 1] || '';
    const target = resolve(skill.dir, path);
    if (existsSync(target)) continue;
    if (src.includes(SUPPRESS_MARKER)) {
      suppressed('RESOURCE', r, line, `${skill.name}:${line}: missing ${path}`);
      continue;
    }
    fail('RESOURCE', r, line, `${skill.name}:${line}: referenced resource does not exist: ${path}`);
  }
}

function readManifest(name) {
  const p = join(SKILLS_DIR, name);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8')
    .split('\n')
    .map((l, i) => ({ line: i + 1, name: l.replace(/#.*/, '').trim() }))
    .filter((e) => e.name);
}

function isDeprecated(skill) {
  const fm = parseFrontmatter(readFileSync(skill.skillMd, 'utf8'));
  if (!fm.ok) return false;
  const d = fm.keys.get('deprecated');
  return !!d && /^(true|yes)$/i.test(d.value);
}

function checkEstate(entries) {
  const byName = new Map(entries.map((s) => [s.name, s]));

  // --- 9. REGISTERED --------------------------------------------------------
  for (const m of MANIFESTS) {
    const list = readManifest(m);
    if (!list) continue;
    for (const e of list) {
      const s = byName.get(e.name);
      if (!s) fail('REGISTERED', m, e.line, `${m}:${e.line}: \`${e.name}\` has no skills/${e.name}/SKILL.md`);
      else if (isDeprecated(s)) fail('REGISTERED', m, e.line, `${m}:${e.line}: \`${e.name}\` is a deprecated redirect stub — register its replacement instead`);
    }
  }

  // --- 10. DIRECTORY --------------------------------------------------------
  const dirPath = join(SKILLS_DIR, 'SKILL-DIRECTORY.md');
  const dirText = existsSync(dirPath) ? readFileSync(dirPath, 'utf8') : '';
  const mapPath = join(SKILLS_DIR, 'skill-router', 'references', 'section-map.json');
  // The section map is required in the real estate; a bare fixture tree (tests/config/
  // skill-lint.test.sh) has neither it nor SKILL-DIRECTORY.md, so both checks are
  // conditional on the file existing — absence is a warning, corruption a failure.
  let sectionMap = null;
  if (existsSync(mapPath)) {
    try {
      sectionMap = JSON.parse(readFileSync(mapPath, 'utf8')).skills || {};
    } catch {
      fail('DIRECTORY', rel(mapPath), 1, `${rel(mapPath)}: unparseable (the router's single source of sections)`);
    }
  } else {
    warn('DIRECTORY', rel(mapPath), 1, `${rel(mapPath)} is absent — section coverage not checked`);
  }
  if (!dirText) warn('DIRECTORY', 'SKILL-DIRECTORY.md', 1, 'SKILL-DIRECTORY.md is absent — directory coverage not checked');
  for (const s of entries) {
    if (dirText && !dirText.includes('`' + s.name + '`')) {
      fail('DIRECTORY', 'SKILL-DIRECTORY.md', 1, `SKILL-DIRECTORY.md never names \`${s.name}\` — add a category row (or a deprecated-table row)`);
    }
    if (sectionMap && !(s.name in sectionMap)) {
      fail('DIRECTORY', rel(mapPath), 1, `${rel(mapPath)}: no section for \`${s.name}\``);
    }
  }
  if (sectionMap) {
    for (const n of Object.keys(sectionMap)) {
      if (!byName.has(n)) fail('DIRECTORY', rel(mapPath), 1, `${rel(mapPath)}: \`${n}\` is mapped but has no skill directory`);
    }
  }

  // --- 11. ROUTING ----------------------------------------------------------
  const gen = join(SKILLS_DIR, 'gen-routing-table.mjs');
  if (existsSync(gen)) {
    const r = spawnSync(process.execPath, [gen, '--check'], { encoding: 'utf8' });
    if (r.status !== 0) {
      fail('ROUTING', 'skill-router/references/routing-table.md', 1,
        `routing-table.md is stale or ungeneratable: ${(r.stderr || r.stdout || '').trim().split('\n')[0]} — run: node skills/gen-routing-table.mjs`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  checkTextPatterns();
  const entries = skillEntries();
  for (const skill of entries) checkSkill(skill);
  checkEstate(entries);

  for (const f of findings) console.log(`${f.code}  ${f.message}`);

  if (warnings.length) {
    console.log(`\n-- warnings (${warnings.length}) — advisory, do not fail the gate --`);
    for (const w of warnings) console.log(`WARN ${w.code}  ${w.message}`);
  }

  if (suppressions.length) {
    console.log(`\n-- suppressed (${suppressions.length}) — waved through by marker/context, NOT validated --`);
    for (const s of suppressions) console.log(`SUPPRESSED ${s.code}  ${s.message}`);
  }

  if (findings.length === 0) {
    console.log(
      `\nOK — skills estate clean (${skillEntries().length} skills, MAX_ENTRY_LINES=${MAX_ENTRY_LINES}, ${suppressions.length} suppressed, ${warnings.length} warnings)`,
    );
    return 0;
  }
  const byCode = findings.reduce((acc, f) => ((acc[f.code] = (acc[f.code] || 0) + 1), acc), {});
  console.log(
    `\nFAIL — ${findings.length} violation(s): ${Object.entries(byCode)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')}; ${suppressions.length} suppressed`,
  );
  return 1;
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main());
