'use strict';

/*
 * diagram-convention.cjs — the corpus repair convention and panel-ID aliases,
 * shared by scripts/diagram-index-gen.cjs (VisionFlow) and the diagrams-as-code
 * skill's copy of the generator. The two copies of THIS file are byte-identical;
 * only the thin hooks in each generator differ.
 *
 * Vocabulary
 *   panel     an H2 whose first token is `<topic-id>.<n>` (for example `VF-06.8`).
 *   frozen    a panel whose first non-blank line under its heading is the banner
 *               > **Superseded** by <PANEL-ID> at <short-sha>.
 *             optionally carrying the revision its citations were read at:
 *               > **Superseded** by <PANEL-ID> at <short-sha> (frozen at <short-sha>).
 *             `at` is the successor's revision; `frozen at` is the frozen panel's
 *             own. The generator checks the panel's citations at `frozen at`.
 *   alias     topic frontmatter `aliases:` maps an OLD panel ID to the NEW one,
 *             so a topic can be split without breaking old references.
 *
 * Rules enforced here (see docs/diagrams/README.md § Repair convention)
 *   RESOLVED ratchet (a) a panel containing the word RESOLVED fails unless it is
 *                        listed in `resolved-ratchet.json`, which may only shrink:
 *                        an entry that no longer exists, or is no longer needed,
 *                        fails too.
 *   banner target    (b) a Superseded banner must name an existing panel ID or a
 *                        resolvable alias; a malformed or misplaced banner fails.
 *   frozen purity    (c) a frozen panel may not carry a RESOLVED marker.
 *   aliases              fail when the target is missing, the source is also a live
 *                        panel, the alias chains or loops, or two topics alias the
 *                        same old ID.
 *   size cap             WARN (never fail) above 600 lines or 15 panels per topic.
 *
 * No I/O except loadBaseline / writeBaseline; everything else is a pure function.
 */

const fs = require('fs');
const path = require('path');

const PANEL_ID_SRC = '[A-Z]{2,4}-\\d{2,3}\\.\\d+';
const PANEL_ID_RE = new RegExp(`^${PANEL_ID_SRC}$`);
const BANNER_RE = new RegExp(`^> \\*\\*Superseded\\*\\* by (${PANEL_ID_SRC}) at ([0-9a-f]{7,12})(?: \\(frozen at ([0-9a-f]{7,12})\\))?\\.$`);
// A line that is trying to be a banner: quoted or bold "Superseded", in any spelling.
const BANNER_LIKE_RE = /^\s*(?:>\s*)?\*{0,2}Superseded\*{0,2}\b(?=.*\bby\b)|^\s*>\s*\*{0,2}Superseded\b/i;
const RESOLVED_RE = /\bRESOLVED\b/;
const BASELINE_FILE = 'resolved-ratchet.json';
const MAX_TOPIC_LINES = 600;
const MAX_TOPIC_PANELS = 15;

/** Same formula the generators use for heading anchors: "VF-06.8 Title" -> "vf-068-title". */
function slug(id, title) {
  return `${id} ${title}`.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });
const posix = (p) => String(p).split(path.sep).join('/');

// ------------------------------------------------------------------ frontmatter

/**
 * Called by a frontmatter parser for an INDENTED `OLD: NEW` line that follows an
 * `aliases:` key. Turns `fm.aliases` into an object and records the pair. Returns
 * false when the line is not a pair, so the caller can report it as unparseable.
 */
function addAliasLine(fm, raw) {
  const m = raw.match(/^\s+([^\s:]+)\s*:\s*([^\s#]+)\s*(?:#.*)?$/);
  if (!m) return false;
  if (!fm.aliases || Array.isArray(fm.aliases) || typeof fm.aliases !== 'object') fm.aliases = {};
  fm.aliases[m[1].replace(/^['"]|['"]$/g, '')] = m[2].replace(/^['"]|['"]$/g, '');
  return true;
}

/**
 * Normalise whatever a parser produced for `aliases` into a plain object:
 * absent / empty -> {}, inline `{OLD: NEW, ...}` -> parsed, anything else -> error.
 */
function normaliseAliases(raw, rel, errors) {
  if (raw == null) return {};
  if (Array.isArray(raw)) {
    if (raw.length === 0) return {};
    errors.push(`${rel}: aliases must be a map of OLD panel ID to NEW panel ID (aliases:\\n  AB-02.17: AB-44.3), not a list`);
    return {};
  }
  if (typeof raw === 'object') return raw;
  const s = String(raw).replace(/\s+#.*$/, '').trim();
  if (s === '' || s.startsWith('#')) return {};
  if (s.startsWith('{') && s.endsWith('}')) {
    const out = {};
    for (const pair of s.slice(1, -1).split(',')) {
      if (!pair.trim()) continue;
      const m = pair.match(/^\s*['"]?([^\s:'"]+)['"]?\s*:\s*['"]?([^\s'"]+)['"]?\s*$/);
      if (!m) { errors.push(`${rel}: unparseable alias '${pair.trim()}' (want OLD: NEW)`); continue; }
      out[m[1]] = m[2];
    }
    return out;
  }
  errors.push(`${rel}: aliases must be a map of OLD panel ID to NEW panel ID, got '${s}'`);
  return {};
}

// ------------------------------------------------------------------ panels

/**
 * Walk a topic body and return its panels and every H2 heading.
 *
 * @param {string} body      text after the frontmatter
 * @param {string} topicId   e.g. `VF-06`
 * @param {number} lineBase  file line number of body line 0
 * @returns {{panels: object[], headings: object[], problems: string[]}}
 *   each panel: { id, title, line, text, banner: {target, sha} | null }
 *   problems are banner SYNTAX errors, already prefixed with `<id>:<line>`.
 */
function extractPanels(body, topicId, lineBase) {
  const lines = body.split('\n');
  const idRe = new RegExp(`^${String(topicId).replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\.\\d+$`);
  const panels = [], headings = [], problems = [];
  let inFence = false, cur = null;
  const close = (end) => { if (cur) { cur.text = lines.slice(cur.start, end).join('\n'); cur.lines = lines.slice(cur.start, end); panels.push(cur); cur = null; } };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (inFence) { if (ln.startsWith('```')) inFence = false; continue; }
    if (ln.startsWith('```')) { inFence = true; continue; }
    const h = ln.match(/^##\s+(\S+)\s*(.*)$/);
    if (!h) continue;
    close(i);
    headings.push({ id: h[1], title: h[2].trim() });
    if (topicId && idRe.test(h[1])) cur = { id: h[1], title: h[2].trim(), line: lineBase + i, start: i, banner: null };
  }
  close(lines.length);

  for (const p of panels) {
    let first = 1;
    while (first < p.lines.length && !p.lines[first].trim()) first++;
    const firstLine = first < p.lines.length ? p.lines[first] : '';
    const m = firstLine.match(BANNER_RE);
    let fence = false;
    if (m) p.banner = { target: m[1], sha: m[2], frozenAt: m[3] || null };
    for (let i = 1; i < p.lines.length; i++) {
      const ln = p.lines[i];
      if (fence) { if (ln.startsWith('```')) fence = false; continue; }
      if (ln.startsWith('```')) { fence = true; continue; }
      if (i === first && m) continue;
      if (BANNER_LIKE_RE.test(ln)) {
        const at = `${p.id}:${p.line + i}`;
        problems.push(i === first
          ? `${at} — malformed Superseded banner; it must read exactly "> **Superseded** by <PANEL-ID> at <short-sha>." or "> **Superseded** by <PANEL-ID> at <short-sha> (frozen at <short-sha>)." (shas are 7 to 12 lowercase hex)`
          : `${at} — a Superseded line must sit directly under the panel heading, as its first non-blank line`);
      }
    }
  }
  return { panels, headings, problems };
}

// ------------------------------------------------------------------ baseline

/** Read the ratchet baseline. Absent file == empty baseline. */
function loadBaseline(root, errors) {
  const file = path.join(root, BASELINE_FILE);
  if (!fs.existsSync(file)) return { exists: false, file, panels: new Set() };
  let j;
  try { j = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { errors.push(`${BASELINE_FILE}: not valid JSON (${e.message})`); return { exists: true, file, panels: new Set() }; }
  const list = j && Array.isArray(j.panels) ? j.panels : null;
  if (!list) { errors.push(`${BASELINE_FILE}: must be {"panels": ["XX-NN.n", ...]}`); return { exists: true, file, panels: new Set() }; }
  const panels = new Set();
  for (const id of list) {
    if (typeof id !== 'string' || !PANEL_ID_RE.test(id)) errors.push(`${BASELINE_FILE}: '${id}' is not a panel ID`);
    else if (panels.has(id)) errors.push(`${BASELINE_FILE}: duplicate entry ${id}`);
    else panels.add(id);
  }
  return { exists: true, file, panels };
}

/**
 * Write the baseline WITHOUT ever growing it. No file yet: create it from every
 * non-frozen panel that carries RESOLVED today (the one-off bootstrap). File
 * present: keep only the entries still live, not frozen, and still carrying
 * RESOLVED. A panel that newly carries RESOLVED is never added; it fails the gate.
 * @returns {{wrote: boolean, before: number, after: number}}
 */
function writeBaseline(root, topics) {
  const marked = new Set();
  for (const t of topics) for (const p of t.panels) if (!p.banner && RESOLVED_RE.test(p.text)) marked.add(p.id);
  const errors = [];
  const cur = loadBaseline(root, errors);
  const keep = cur.exists ? [...cur.panels].filter((id) => marked.has(id)) : [...marked];
  if (cur.exists && keep.length === cur.panels.size && !errors.length) return { wrote: false, before: cur.panels.size, after: keep.length };
  const doc = {
    $comment: 'Ratchet baseline for the RESOLVED rule (docs/diagrams/README.md, Repair convention). Panels listed here predate the successor-only convention and may still carry an in-place RESOLVED marker. The list may only shrink: do not add to it; write a successor panel instead. Prune with: node scripts/diagram-index-gen.cjs docs/diagrams --check --no-source-paths --update-resolved-baseline',
    panels: keep.sort(natural),
  };
  fs.writeFileSync(cur.file, JSON.stringify(doc, null, 2) + '\n');
  return { wrote: true, before: cur.exists ? cur.panels.size : 0, after: keep.length };
}

// ------------------------------------------------------------------ the check

/**
 * Run every rule over the whole tree.
 *
 * @param {object} o
 * @param {object[]} o.topics     every topic in the tree (even under --only):
 *                                { rel, fm: {id, aliases}, panels, headings, lineCount, body }
 * @param {Set<string>} [o.selected] rels in scope for per-topic findings (default: all)
 * @param {boolean} [o.partial]   true under --only: global staleness checks are skipped
 * @param {{panels:Set<string>}} o.baseline
 * @param {{where:string,text:string,kind:string}[]} [o.extraTexts] register / ledger text
 * @returns {{errors:string[], warnings:string[], data:object}}
 */
function check(o) {
  const topics = o.topics;
  const selected = o.selected || new Set(topics.map((t) => t.rel));
  const inScope = (t) => selected.has(t.rel);
  const errors = [], warnings = [];
  const err = (t, msg) => { if (!t || inScope(t)) errors.push(`${t ? t.rel + ': ' : ''}${msg}`); };

  // -- panel registry
  const live = new Map();
  for (const t of topics) for (const p of t.panels) live.set(p.id, { topic: t, panel: p });
  const topicIds = new Set(topics.map((t) => t.fm.id).filter(Boolean));
  const topicByRel = new Map(topics.map((t) => [posix(t.rel), t]));

  // -- aliases
  const aliasOwner = new Map();   // old id -> { topic, to }
  const aliasRows = [];
  for (const t of topics) {
    for (const [from, to] of Object.entries(t.fm.aliases || {})) {
      const bad = [from, to].filter((x) => !PANEL_ID_RE.test(x));
      if (bad.length) { err(t, `alias '${from}: ${to}' — '${bad.join("', '")}' is not a panel ID (XX-NN.n)`); continue; }
      if (aliasOwner.has(from)) { errors.push(`${t.rel}: alias source ${from} is also aliased by ${aliasOwner.get(from).topic.rel}; two topics may not alias the same old ID`); continue; }
      aliasOwner.set(from, { topic: t, to });
    }
  }
  const aliasTo = (id) => (aliasOwner.has(id) ? aliasOwner.get(id).to : null);
  for (const [from, { topic: t, to }] of aliasOwner) {
    let problem = null;
    if (from === to) problem = `alias ${from}: ${to} loops onto itself`;
    else {
      const seen = new Set([from]);
      let at = to, loops = false;
      while (aliasTo(at)) { if (seen.has(at)) { loops = true; break; } seen.add(at); at = aliasTo(at); }
      if (loops || at === from) problem = `alias ${from}: ${to} loops (${[...seen, at].join(' -> ')}); an alias must point straight at a live panel`;
      else if (aliasTo(to)) problem = `alias ${from}: ${to} chains (${to} is itself aliased to ${aliasTo(to)}); point ${from} straight at ${at}`;
    }
    if (!problem && live.has(from)) problem = `alias source ${from} is also a live panel ID (${live.get(from).topic.rel}); an old ID must no longer exist as a panel`;
    if (!problem && !live.has(to)) problem = `alias ${from}: ${to} — target panel ${to} does not exist`;
    if (problem) err(t, problem);
    else aliasRows.push({ from, to, topic: t.fm.id, rel: posix(t.rel) });
  }
  aliasRows.sort((a, b) => natural(a.from, b.from));
  const validAlias = new Map(aliasRows.map((r) => [r.from, r.to]));

  /** id -> { id: live panel id, via: old id | null } or null */
  const resolve = (id) => {
    if (live.has(id)) return { id, via: null };
    if (validAlias.has(id)) return { id: validAlias.get(id), via: id };
    return null;
  };
  const panelLink = (id) => {
    const r = resolve(id);
    if (!r) return null;
    const { topic, panel } = live.get(r.id);
    return `${posix(topic.rel)}#${slug(panel.id, panel.title)}`;
  };

  // -- banners, frozen panels, RESOLVED
  const frozen = [];
  const marked = [];
  const stale = [];
  const base = o.baseline.panels;
  for (const t of topics) {
    if (!inScope(t)) continue;
    for (const p of t.panels) {
      const hasResolved = RESOLVED_RE.test(p.text);
      if (p.banner) {
        const r = resolve(p.banner.target);
        if (!r) err(t, `${p.id}:${p.line} — Superseded banner names ${p.banner.target}, which is neither a panel nor a resolvable alias`);
        else if (r.id === p.id) err(t, `${p.id}:${p.line} — a panel cannot be superseded by itself`);
        else frozen.push({ panel: p.id, topic: t.fm.id, rel: posix(t.rel), successor: r.id, declared: p.banner.target, via: r.via, sha: p.banner.sha, frozenAt: p.banner.frozenAt, title: p.title });
        if (hasResolved) err(t, `${p.id}:${p.line} — a frozen panel may not carry a RESOLVED marker; the successor ${p.banner.target} records the change`);
        continue;
      }
      if (hasResolved) {
        marked.push(p.id);
        if (!base.has(p.id)) err(t, `${p.id}:${p.line} — RESOLVED marker in a panel that is not in ${BASELINE_FILE}; in-place retrofits are banned. Freeze this panel with "> **Superseded** by <PANEL-ID> at <short-sha>." and write the current behaviour in a successor panel`);
      }
    }
  }
  const frozenById = new Map(frozen.map((f) => [f.panel, f]));
  for (const f of frozen) {           // a supersession cycle never reaches a current panel
    const seen = new Set([f.panel]);
    for (let at = f.successor; frozenById.has(at); at = frozenById.get(at).successor) {
      if (seen.has(at)) { const t = topics.find((x) => posix(x.rel) === f.rel); err(t, `${f.panel} — supersession cycle (${[...seen, at].join(' -> ')})`); break; }
      seen.add(at);
    }
  }
  // current panel an old one finally lands on
  for (const f of frozen) { let at = f.successor; const seen = new Set(); while (frozenById.has(at) && !seen.has(at)) { seen.add(at); at = frozenById.get(at).successor; } f.current = at; }
  frozen.sort((a, b) => natural(a.panel, b.panel));

  if (!o.partial) {
    const markedSet = new Set(marked);
    const frozenSet = new Set(frozen.map((f) => f.panel));
    for (const id of [...base].sort(natural)) {
      let why = null;
      if (!live.has(id)) why = validAlias.has(id) ? `${id} no longer exists; it was renumbered to ${validAlias.get(id)} by an alias (replace the entry, never add one)` : `${id} no longer exists`;
      else if (frozenSet.has(id)) why = `${id} is frozen and no longer needs it`;
      else if (!markedSet.has(id)) why = `${id} no longer carries a RESOLVED marker`;
      if (why) { stale.push(id); errors.push(`${BASELINE_FILE}: stale entry — ${why}. The baseline may only shrink: remove it (or run --update-resolved-baseline)`); }
    }
  }

  // -- size cap (a warning, never an error)
  const size = [];
  for (const t of topics) {
    if (!inScope(t)) continue;
    const reasons = [];
    if (t.lineCount > MAX_TOPIC_LINES) reasons.push(`${t.lineCount} lines (cap ${MAX_TOPIC_LINES})`);
    if (t.panels.length > MAX_TOPIC_PANELS) reasons.push(`${t.panels.length} panels (cap ${MAX_TOPIC_PANELS})`);
    if (reasons.length) {
      size.push({ topic: t.fm.id, file: posix(t.rel), lines: t.lineCount, panels: t.panels.length, reasons });
      warnings.push(`${t.rel}: size — ${reasons.join(', ')}; split the topic and declare the moved panels under aliases:`);
    }
  }

  // -- cross-references: prose, diagrams, panel links, register and ledger
  const prefixes = new Set(topicIds);
  for (const from of aliasOwner.keys()) prefixes.add(from.split('.')[0]);
  const refs = { checked: 0, viaAlias: [], unresolved: [] };
  const tokenRe = new RegExp(`\\b(${PANEL_ID_SRC})\\b`, 'g');
  const seeRe = new RegExp(`\\bsee\\s+(?:also\\s+)?(${PANEL_ID_SRC})`, 'gi');
  const linkRe = /\]\(([^)\s#]*\.md)#([^)\s]+)\)/g;
  const scan = (where, text, dirPosix, structured, topic) => {
    const see = new Set();
    if (structured) for (const m of text.matchAll(seeRe)) see.add(`${m.index + m[0].length - m[1].length}`);
    for (const m of text.matchAll(tokenRe)) {
      if (!prefixes.has(m[1].split('.')[0])) continue;
      refs.checked++;
      const r = resolve(m[1]);
      if (r && r.via) refs.viaAlias.push({ where, ref: m[1], to: r.id });
      else if (!r) {
        const structuredRef = see.has(String(m.index));
        refs.unresolved.push({ where, ref: m[1], structured: structuredRef });
        if (structuredRef && topic) errors.push(`${where} — "see ${m[1]}" names no panel and no alias`);
        else warnings.push(`${where} — ${m[1]} is mentioned but is neither a panel nor an alias`);
      }
    }
    for (const m of text.matchAll(linkRe)) {
      const target = path.posix.normalize(path.posix.join(dirPosix, m[1]));
      const t = topicByRel.get(target);
      if (!t || !/^[a-z]{2,4}-\d{3,}(?:-|$)/.test(m[2])) continue;
      refs.checked++;
      if (t.headings.some((h) => slug(h.id, h.title) === m[2])) continue;
      const old = [...validAlias.keys()].find((from) => m[2] === slug(from, '') || m[2].startsWith(slug(from, '') + '-'));
      if (old) { refs.viaAlias.push({ where, ref: `${m[1]}#${m[2]}`, to: validAlias.get(old), via: old }); continue; }
      refs.unresolved.push({ where, ref: `${m[1]}#${m[2]}`, structured: true });
      if (topic) errors.push(`${where} — link ${m[1]}#${m[2]} matches no panel heading and no alias`);
      else warnings.push(`${where} — link ${m[1]}#${m[2]} matches no panel heading and no alias`);
    }
  };
  for (const t of topics) if (inScope(t)) scan(t.rel, t.body, path.posix.dirname(posix(t.rel)), true, t);
  if (!o.partial) for (const x of o.extraTexts || []) scan(x.where, x.text, '.', false, null);

  const data = {
    aliases: aliasRows,
    frozen,
    resolved: { baseline: [...base].sort(natural), marked: [...marked].sort(natural), stale },
    size: { maxLines: MAX_TOPIC_LINES, maxPanels: MAX_TOPIC_PANELS, warnings: size },
    references: refs,
    panels: live.size,
  };
  return { errors, warnings, data, resolve, panelLink, frozenById };
}

// ------------------------------------------------------------------ indexes

/**
 * Markdown for the generated indexes: the alias table and the current-state view
 * of frozen panels. Empty arrays when the corpus has neither, so an index of a
 * corpus that does not use the convention is byte-identical to before.
 * @param {object} result  the value returned by check()
 * @param {string} prefix  link prefix from the index file to the topic files ('' or '../')
 */
function indexLines(result, prefix, heading) {
  const { aliases, frozen } = result.data;
  const out = [];
  const link = (id) => { const l = result.panelLink(id); return l ? `[${id}](${prefix}${l})` : id; };
  if (frozen.length) {
    out.push('', `${heading} Superseded panels (frozen)`, '', 'Frozen panels keep their heading and body as a record. The successor describes the current behaviour.', '', '| Frozen panel | Current successor | Declared successor | At | Frozen at |', '|--------------|-------------------|--------------------|----|-----------|');
    for (const f of frozen) out.push(`| ${link(f.panel)} | ${link(f.current)} | ${f.declared === f.current ? '' : '`' + f.declared + '`'} | \`${f.sha}\` | ${f.frozenAt ? '`' + f.frozenAt + '`' : ''} |`);
  }
  if (aliases.length) {
    out.push('', `${heading} Panel aliases`, '', 'An old panel ID followed to the panel that now holds it.', '', '| Old ID | Now | Declared in |', '|--------|-----|-------------|');
    for (const a of aliases) out.push(`| \`${a.from}\` | ${link(a.to)} | ${a.topic} |`);
  }
  return out;
}

/** Suffix for a Diagrams-table cell: marks a frozen panel and links its successor. */
function frozenMark(result, panelId, prefix) {
  const f = result.frozenById.get(panelId);
  if (!f) return '';
  const l = result.panelLink(f.current);
  return ` — superseded by ${l ? `[${f.current}](${prefix}${l})` : f.current}`;
}

module.exports = {
  PANEL_ID_RE, BANNER_RE, RESOLVED_RE, BASELINE_FILE, MAX_TOPIC_LINES, MAX_TOPIC_PANELS,
  slug, addAliasLine, normaliseAliases, extractPanels, loadBaseline, writeBaseline, check, indexLines, frozenMark,
};
