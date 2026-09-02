'use strict';
// vault-frontmatter.js — the leading-property-block reader/writer for the
// authored corpus (project/docs/VAULT-corpus-format.md §V2/§V5, ADR-2028 D4).
//
// The vault is Obsidian markdown: every page opens with a YAML frontmatter
// block delimited by `---` lines. The pre-vault corpus opened with a Logseq
// property block (`key:: value` lines). This module is the one place that
// knows both shapes, so every writer in agentbox emits V2 frontmatter and
// converts a legacy leading block on write (Invariant 1: one format on write).
//
// Deliberately NOT a YAML library. The property block is a flat key→scalar or
// key→list map — the subset a hand-rolled emitter handles exactly, with no
// dependency, so this loads in any agentbox context (pure Node core modules,
// in fact no requires at all).
//
// Scope discipline (Invariant 6, bounded legacy tolerance): only the LEADING
// block is ever converted. Body-level `key:: value` lines are data, not
// metadata — 193 pages in the 2026-09-02 corpus carry them — and are preserved
// byte-for-byte.

// A Logseq property line: `key:: value` at the very start of a line. The key
// may carry a namespace colon (`owl:class::`), so the split is on the LAST
// `::` that is followed by a space or end-of-line.
const LOGSEQ_PROP_RE = /^([A-Za-z_][A-Za-z0-9_:.-]*)::[ \t]*(.*)$/;

// Keys whose Logseq spelling differs from the V2 frontmatter spelling.
const KEY_MAP = Object.freeze({
  'owl:class': 'owl-class',
  alias: 'aliases',
});

// Keys that are lists in V2 even when the legacy block held one comma-joined
// string (`alias:: A, B`). The reserved Obsidian keys keep Obsidian meaning.
const LIST_KEYS = Object.freeze(new Set(['aliases', 'tags', 'cssclasses']));

// Keys that are real YAML booleans in V2, never the string "true".
const BOOL_KEYS = Object.freeze(new Set(['public', 'public-access']));

// Outliner-only noise that does not survive into a vault page.
const DROP_KEYS = Object.freeze(new Set(['collapsed', 'id']));

function normaliseKey(key) {
  const k = String(key).trim();
  if (Object.prototype.hasOwnProperty.call(KEY_MAP, k)) return KEY_MAP[k];
  // Any surviving namespace colon would break the YAML mapping; V2 keys are
  // lower-kebab-case.
  return k.replace(/:/g, '-');
}

function coerceValue(key, rawValue) {
  const v = String(rawValue == null ? '' : rawValue).trim();
  if (BOOL_KEYS.has(key)) {
    if (/^(true|yes|1)$/i.test(v)) return true;
    if (/^(false|no|0)$/i.test(v)) return false;
    return v === '' ? true : v; // `public::` with no value meant public
  }
  if (LIST_KEYS.has(key)) {
    if (Array.isArray(rawValue)) return rawValue.slice();
    if (v === '') return [];
    // Logseq joined list values with commas; `[[Wikilink]]` items may not
    // contain a comma in this corpus, so a plain split is exact.
    return v.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return v;
}

/** True when a scalar must be quoted to survive a YAML round-trip. */
function needsQuoting(s) {
  if (s === '') return true;
  if (/^[|>&*!%@`]/.test(s)) return true;          // YAML indicators
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(s)) return true;
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return true; // numeric-looking
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return true;  // YAML would type this as a date
  if (/^\s|\s$/.test(s)) return true;
  if (/[:#[\]{},"']/.test(s)) return true;         // includes `[[Wikilink]]` (V2 rule)
  return false;
}

function emitScalar(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const s = String(value == null ? '' : value);
  if (!needsQuoting(s)) return s;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Parse a YAML frontmatter body (the text between the `---` fences) into a
 * flat map. Handles `key: scalar`, `key:` + block sequence, and `key: [a, b]`.
 * Anything more exotic is kept as its raw scalar string rather than guessed at
 * (Invariant 5's preserve-and-report posture, applied to reads).
 */
function parseYamlBlock(block) {
  const props = {};
  const lines = block.split('\n');
  let currentKey = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const seq = /^[ \t]*-[ \t]+(.*)$/.exec(line);
    if (seq && currentKey !== null) {
      if (!Array.isArray(props[currentKey])) props[currentKey] = [];
      props[currentKey].push(unquote(seq[1].trim()));
      continue;
    }
    const kv = /^([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*:[ \t]*(.*)$/.exec(line);
    if (!kv) { currentKey = null; continue; }
    const key = kv[1];
    const rest = kv[2].trim();
    currentKey = key;
    if (rest === '') { props[key] = []; continue; } // block sequence follows
    if (/^\[.*\]$/.test(rest)) {
      props[key] = rest.slice(1, -1).split(',').map((s) => unquote(s.trim())).filter((s) => s !== '');
      continue;
    }
    if (/^(true|false)$/i.test(rest)) { props[key] = /^true$/i.test(rest); continue; }
    props[key] = unquote(rest);
  }
  // A `key:` with nothing under it is an empty value, not an empty list.
  for (const [k, v] of Object.entries(props)) {
    if (Array.isArray(v) && v.length === 0 && !LIST_KEYS.has(k)) props[k] = '';
  }
  return props;
}

function unquote(s) {
  const t = String(s);
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    const inner = t.slice(1, -1);
    return t[0] === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner;
  }
  return t;
}

/**
 * Split a page into its leading property block and its body.
 *
 * @param {string} text - the whole page
 * @returns {{kind:'frontmatter'|'logseq'|'none', props:object, body:string, raw:string}}
 *   `raw` is the exact leading text consumed (''. when kind === 'none'), so a
 *   caller can rewrite the head without touching a byte of the body.
 */
function parseLeadingBlock(text) {
  const src = String(text == null ? '' : text);

  // ── V2 frontmatter ────────────────────────────────────────────────────────
  // Must be the very first thing in the file (a leading BOM is tolerated).
  const fm = /^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(src);
  if (fm && fm.index === 0) {
    return {
      kind: 'frontmatter',
      props: parseYamlBlock(fm[1]),
      body: src.slice(fm[0].length),
      raw: fm[0],
    };
  }

  // ── Legacy Logseq leading property block ──────────────────────────────────
  // A contiguous run of `key:: value` lines starting at line 1. The run ends at
  // the first line that is not a property line; body-level properties further
  // down the page are never touched (Invariant 6).
  const lines = src.split('\n');
  const props = {};
  let consumed = 0;
  for (const line of lines) {
    const m = LOGSEQ_PROP_RE.exec(line.replace(/\r$/, ''));
    if (!m) break;
    const key = normaliseKey(m[1]);
    if (!DROP_KEYS.has(key)) {
      const existing = props[key];
      const value = coerceValue(key, m[2]);
      if (existing !== undefined && LIST_KEYS.has(key)) {
        props[key] = [].concat(existing, value);
      } else {
        props[key] = value;
      }
    }
    consumed += 1;
  }
  if (consumed > 0) {
    const raw = lines.slice(0, consumed).join('\n');
    let body = src.slice(raw.length);
    if (body.startsWith('\n')) body = body.slice(1);
    return { kind: 'logseq', props, body, raw: `${raw}\n` };
  }

  return { kind: 'none', props: {}, body: src, raw: '' };
}

/**
 * Render a property map as a V2 frontmatter block, `---`-delimited, with a
 * trailing newline. Key order is stable: the V2 table's well-known keys first
 * (so pages diff cleanly), then everything else in insertion order.
 *
 * @param {object} props
 * @returns {string}
 */
const KEY_ORDER = ['public', 'title', 'aliases', 'tags', 'owl-class', 'source-domain', 'elevatedFrom'];

function toFrontmatter(props) {
  const src = props && typeof props === 'object' ? props : {};
  const keys = Object.keys(src);
  const ordered = [
    ...KEY_ORDER.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !KEY_ORDER.includes(k)),
  ];

  const out = ['---'];
  for (const rawKey of ordered) {
    const key = normaliseKey(rawKey);
    const value = coerceValue(key, src[rawKey]);
    if (Array.isArray(value)) {
      if (value.length === 0) { out.push(`${key}: []`); continue; }
      out.push(`${key}:`);
      for (const item of value) out.push(`  - ${emitScalar(item)}`);
      continue;
    }
    out.push(`${key}: ${emitScalar(value)}`);
  }
  out.push('---', '');
  return out.join('\n');
}

/**
 * Guarantee a page carries V2 frontmatter, converting a legacy leading Logseq
 * property block if it finds one (§V5: "a writer that must touch a legacy page
 * converts the leading property block on write").
 *
 * Idempotent: a page that already has frontmatter is returned with its head
 * re-emitted canonically and its body untouched, so running this twice is a
 * no-op on the second pass.
 *
 * @param {string} text - the whole page
 * @param {object} [extraProps] - properties to merge in (these win)
 * @param {object} [opts]
 * @param {boolean} [opts.defaultPublic=true] - seed `public: true` when the
 *   page carries no gate at all. The KG gate is fail-closed on read (V4), so a
 *   page a writer authored deliberately declares itself public; pass false to
 *   author a private page.
 * @returns {{text:string, changed:boolean, converted:boolean, props:object}}
 */
function ensureFrontmatter(text, extraProps, opts) {
  const options = opts || {};
  const defaultPublic = options.defaultPublic !== false;
  const parsed = parseLeadingBlock(text);

  const props = Object.assign({}, parsed.props);
  for (const [k, v] of Object.entries(extraProps || {})) {
    props[normaliseKey(k)] = v;
  }
  if (!Object.prototype.hasOwnProperty.call(props, 'public')
      && !Object.prototype.hasOwnProperty.call(props, 'owl-class')
      && defaultPublic) {
    props.public = true;
  }

  const head = toFrontmatter(props);
  // Keep exactly one blank line between the block and the body, and never
  // introduce one on an empty page.
  const body = parsed.body.replace(/^\n+/, '');
  const next = body === '' ? head : `${head}\n${body}`;
  const original = String(text == null ? '' : text);

  return {
    text: next,
    changed: next !== original,
    converted: parsed.kind === 'logseq',
    props,
  };
}

module.exports = {
  parseLeadingBlock,
  toFrontmatter,
  ensureFrontmatter,
  // exported for tests and for readers that need the same key vocabulary
  KEY_MAP,
  LIST_KEYS,
  BOOL_KEYS,
};
