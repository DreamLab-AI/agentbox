// Page -> chunk rules for the visionGraph corpus in RuVector `knowledge/pages`.
//
// These rules REPRODUCE the key scheme of the rows already in the namespace
// (reverse-engineered from 20,119 live rows; see docs/reference/corpus-memory-ingest.md
// "Key scheme"). Changing any rule here changes keys and therefore leaves stale
// duplicates behind on an in-place upsert: do not "improve" them.
//
//   key        = <page-slug>::<section-slug>[::p<N>]
//   page-slug  = slug(filename stem), with "___" read as a "/" namespace separator
//   section    = text before the first level-2/3 heading is "Section 0"
//                (slug "section-0"); every `##`/`###` heading starts a section.
//                Level 1 and 4+ headings do NOT split. Headings inside fenced
//                code do not split (CommonMark fences).
//   split      = a section longer than SECTION_MAX chars (measured before the trim, so a
//                few sections of 2035..2048 trimmed chars split too) becomes parts p0..pN:
//                paragraphs (split on a blank line) are packed while the part
//                stays within SECTION_MAX; each later part is prefixed with the
//                last OVERLAP chars of the previous part. A single paragraph is
//                never cut, so a part can exceed SECTION_MAX. A split section that packs
//                into ONE part is still keyed ::p0 (495 such groups live).
//   value      = { title: "<page> > <section>[ (part N)]", content, content_hash }
//                content_hash = md5(content)[0..12]
//
// Pure functions: no I/O, no network.

import { createHash } from 'node:crypto';
import { wellFormed } from './ruvector-bulk.mjs';

/** A section longer than this (chars, after trim) is split into parts. */
export const SECTION_MAX = 2048;
/** Characters of the previous part repeated at the head of the next one. */
export const OVERLAP = 128;
/** Wikilinks kept per page in metadata. */
export const MAX_WIKILINKS = 20;

/**
 * Slug used for both page and section keys. Lower-cases, drops everything but
 * [a-z0-9], whitespace, "-", "/" and ":", drops "_", then turns each whitespace
 * char into "-" (no collapsing, no trimming: "A & B" is "a--b", a leading emoji
 * leaves a leading "-", a trailing ":" is kept so a split part is "x:::p0").
 */
export function slugify(s, { page = false } = {}) {
  let t = String(s).toLowerCase();
  if (page) t = t.replace(/___/g, '/');
  t = t.replace(/[^a-z0-9\s/:_-]/g, '').replace(/_/g, '');
  return t.replace(/\s/g, '-');
}

/** Page slug from a vault-relative file name. */
export function pageSlug(fileName) {
  return slugify(fileName.replace(/\.md$/i, ''), { page: true });
}

/** md5(content)[0..12], the `content_hash` stored in every row value. */
export const contentHash = (content) => createHash('md5').update(content).digest('hex').slice(0, 12);

/** Split `---` YAML frontmatter from the body. Frontmatter text is returned raw. */
export function splitFrontmatter(text) {
  const t = text.replace(/^﻿/, '');
  if (!/^---[ \t]*\r?\n/.test(t)) return { fm: '', body: t };
  const m = t.slice(4).match(/(^|\r?\n)---[ \t]*(\r?\n|$)/);
  if (!m) return { fm: '', body: t };
  const end = 4 + m.index;
  return { fm: t.slice(4, end), body: t.slice(end + m[0].length) };
}

/**
 * Minimal frontmatter reader: top-level scalars and block lists of scalars.
 * Nested maps (e.g. `generated:`) are skipped. Enough for the metadata we copy.
 */
export function parseFrontmatter(fm) {
  const out = {};
  const lines = fm.split(/\r?\n/);
  const unq = (v) => v.trim().replace(/^(['"])(.*)\1$/, '$2');
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z0-9_.:-]+):(?:\s+(.*))?$/);
    if (!m) continue;
    const [, k, v] = m;
    if (v !== undefined && v.trim() !== '') {
      const inline = v.trim().match(/^\[(.*)\]$/);
      out[k] = inline ? inline[1].split(',').map(unq).filter(Boolean) : unq(v);
      continue;
    }
    const list = [];
    let j = i + 1;
    while (j < lines.length && /^\s*-\s+/.test(lines[j])) { list.push(unq(lines[j].replace(/^\s*-\s+/, ''))); j++; }
    if (list.length) { out[k] = list; i = j - 1; }
  }
  return out;
}

/** Unique `[[targets]]` in first-seen order (alias and #anchor stripped), capped. */
export function wikilinksOf(text, max = MAX_WIKILINKS) {
  const seen = new Set();
  for (const m of text.matchAll(/\[\[([^\]\n]+?)\]\]/g)) {
    const t = m[1].split('|')[0].split('#')[0].trim();
    if (t) seen.add(t);
    if (seen.size >= max) break;
  }
  return [...seen];
}

/**
 * Sections of a body: [{ section, content, rawLength }] in order. Index 0 is always the
 * pre-heading text (possibly empty) so chunk_index == position here.
 */
export function splitSections(body) {
  const sections = [{ section: 'Section 0', lines: [] }];
  let fence = null; // { ch, len }
  for (const line of body.split(/\r?\n/)) {
    const f = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (f) {
      if (!fence) fence = { ch: f[1][0], len: f[1].length };
      else if (f[1][0] === fence.ch && f[1].length >= fence.len && f[2].trim() === '') fence = null;
    }
    const h = !fence && !f ? line.match(/^(#{2,3})\s+(.*?)\s*$/) : null;
    if (h && h[2]) sections.push({ section: h[2], lines: [line] });
    else sections[sections.length - 1].lines.push(line);
  }
  return sections.map((s) => {
    const raw = s.lines.join('\n');
    return { section: s.section, content: raw.trim(), rawLength: raw.length };
  });
}

/**
 * Pack paragraphs into parts of at most `max` chars (a lone paragraph is never
 * cut). Later parts start with the last `overlap` chars of the previous part.
 */
export function splitParts(text, max = SECTION_MAX, overlap = OVERLAP) {
  if (text.length <= max) return [text];
  const out = [];
  let cur = '';
  for (const p of text.split('\n\n')) {
    if (cur === '') { cur = p; continue; }
    if (cur.length + 2 + p.length > max) {
      out.push(cur);
      cur = cur.slice(-overlap) + '\n\n' + p;
    } else cur += '\n\n' + p;
  }
  if (cur) out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * Chunk one page.
 * @param {{ fileName: string, text: string, vault?: string }} page fileName is the vault-relative name incl. ".md"
 * @returns {{ pageSlug: string, title: string, chunks: object[], collisions: string[] }}
 *  chunks: [{ key, section, chunkIndex, subIndex?, title, content, contentHash, meta }]
 *  Colliding keys (two sections with the same heading slug, same form) are
 *  resolved last-wins, exactly as the original upsert did; the lost keys are
 *  listed in `collisions`.
 */
export function chunkPage({ fileName, text, vault = 'knowledge' }) {
  const stem = fileName.replace(/\.md$/i, '');
  const { fm: fmRaw, body: rawBody } = splitFrontmatter(text);
  const fm = parseFrontmatter(fmRaw);
  const body = wellFormed(rawBody);
  const slug = pageSlug(fileName);
  const title = typeof fm.title === 'string' && fm.title ? fm.title : stem;
  const prefix = typeof fm['legacy-term-id'] === 'string' ? fm['legacy-term-id'].match(/^([A-Za-z]+)-/) : null;
  const pageMeta = {
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    title,
    ...(fm.domain ? { domain: Array.isArray(fm.domain) ? fm.domain.join(', ') : fm.domain } : {}),
    ...(fm.status ? { status: fm.status } : {}),
    ...(fm['legacy-term-id'] ? { term_id: fm['legacy-term-id'] } : {}),
    ...(fm['owl-class'] || fm.owl_class ? { owl_class: fm['owl-class'] || fm.owl_class } : {}),
    wikilinks: wikilinksOf(body),
    source_file: fileName,
    ...(fm['last-updated'] ? { last_updated: String(fm['last-updated']) } : {}),
    ...(prefix ? { source_domain: prefix[1].toLowerCase() } : fm.domain ? { source_domain: String(fm.domain) } : {}),
    vault,
  };
  const byKey = new Map();
  const collisions = [];
  splitSections(body).forEach((sec, chunkIndex) => {
    if (!sec.content) return;
    const base = `${slug}::${sec.section === 'Section 0' && chunkIndex === 0 ? 'section-0' : slugify(sec.section)}`;
    const parts = splitParts(sec.content);
    const split = parts.length > 1 || sec.rawLength > SECTION_MAX;
    parts.forEach((content, i) => {
      const key = split ? `${base}::p${i}` : base;
      const chunk = {
        key, section: sec.section, chunkIndex, ...(split ? { subIndex: i } : {}),
        title: `${title} > ${sec.section === 'Section 0' && chunkIndex === 0 ? 'Section 0' : sec.section}${split ? ` (part ${i + 1})` : ''}`,
        content, contentHash: contentHash(content),
        meta: { ...pageMeta, section: sec.section, chunk_index: chunkIndex, ...(split ? { sub_index: i } : {}) },
      };
      if (byKey.has(key)) collisions.push(key);
      byKey.set(key, chunk);
    });
  });
  return { pageSlug: slug, title, chunks: [...byKey.values()], collisions };
}
