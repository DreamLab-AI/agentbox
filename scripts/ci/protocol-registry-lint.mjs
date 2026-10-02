#!/usr/bin/env node
// scripts/ci/protocol-registry-lint.mjs
//
// Lint for the Nostr kind tables in docs/PROTOCOL-registry.md (ADR-2105 allocation
// rule; ADR-2098 amended 2026-10-02). The registry is the one place a kind number
// is spoken for, so it must be readable as data, not only as prose:
//
//   1. every table whose first column is `Kind` and whose rows are kind numbers
//      (the URN kind table is not one) has an `Owner` column, and every
//      row names its owner: `agentbox` or `external (<owner>)`;
//   2. no kind number sits in two rows (ranges such as `23510`-`23514` expand);
//   3. every kind in the agentbox band 38000-38499 is agentbox-owned and lies in
//      a row of the band table (`Range | State | Record`) that is not free, and no
//      external kind lands in that band.
//
// Usage:
//   node scripts/ci/protocol-registry-lint.mjs [path]   # default docs/PROTOCOL-registry.md
// Exit 0 when every rule holds; 1 with each violation named.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BAND = [38000, 38499];

/** Split a markdown table row into trimmed cells (an escaped `\|` stays in its cell). */
function cells(line) {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map((c) => c.trim());
}

/** Every pipe table in the document: { header: [..], rows: [{ cells, line }] }. */
export function tables(markdown) {
  const lines = markdown.split('\n');
  const out = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\s*\|/.test(lines[i]) || !/^\s*\|\s*:?-{3,}/.test(lines[i + 1])) continue;
    const header = cells(lines[i]).map((h) => h.replace(/[`*]/g, '').trim().toLowerCase());
    const rows = [];
    let j = i + 2;
    for (; j < lines.length && /^\s*\|/.test(lines[j]); j++) rows.push({ cells: cells(lines[j]), line: j + 1 });
    out.push({ header, rows, line: i + 1 });
    i = j - 1;
  }
  return out;
}

/** `38420` → [38420, 38420]; `23510`-`23514` → [23510, 23514]; anything else → null. */
export function kindRange(cell) {
  const m = /^`(\d+)`(?:\s*-\s*`(\d+)`)?$/.exec(cell.replace(/\*/g, '').trim());
  if (!m) return null;
  const lo = Number(m[1]); const hi = m[2] ? Number(m[2]) : lo;
  return hi >= lo ? [lo, hi] : null;
}

/** `**external (sidestr)**` → { owner: 'external', who: 'sidestr' }; `agentbox (ADR-2085)` → { owner: 'agentbox' }. */
export function ownerOf(cell) {
  const c = cell.replace(/\*/g, '').trim();
  if (/^agentbox\b/.test(c)) return { owner: 'agentbox' };
  const m = /^external \(([^)]+)\)/.exec(c);
  return m ? { owner: 'external', who: m[1].trim() } : null;
}

export function lint(markdown) {
  const errors = [];
  const all = tables(markdown);
  // A Nostr kind table is a `Kind` table whose rows are numbers; the URN kind
  // table (`chain`, `asset`) shares the header word and is not one.
  const kindTables = all.filter((t) => t.header[0] === 'kind' && t.rows.some((r) => /^\**`\d/.test(r.cells[0])));
  const bandTables = all.filter((t) => t.header[0] === 'range' && t.header[1] === 'state');
  if (kindTables.length === 0) errors.push('no table with a `Kind` first column');

  // Band rows: [lo, hi, free?]
  const bands = [];
  for (const t of bandTables) {
    for (const r of t.rows) {
      const range = kindRange(r.cells[0]);
      if (!range) { errors.push(`line ${r.line}: band row has no \`N\` or \`N\`-\`M\` range: ${r.cells[0]}`); continue; }
      bands.push({ lo: range[0], hi: range[1], free: /^\**free\b/i.test(r.cells[1] || ''), line: r.line });
    }
  }

  const seen = new Map(); // kind number -> line
  const rows = [];
  for (const t of kindTables) {
    const ownerCol = t.header.indexOf('owner');
    if (ownerCol < 0) { errors.push(`line ${t.line}: kind table has no Owner column`); continue; }
    for (const r of t.rows) {
      const range = kindRange(r.cells[0]);
      if (!range) { errors.push(`line ${r.line}: kind cell is not \`N\` or \`N\`-\`M\`: ${r.cells[0]}`); continue; }
      const owner = ownerOf(r.cells[ownerCol] || '');
      if (!owner) { errors.push(`line ${r.line}: kind ${r.cells[0]} cites no owner (agentbox or external (<owner>)): "${r.cells[ownerCol] || ''}"`); }
      for (let k = range[0]; k <= range[1]; k++) {
        if (seen.has(k)) errors.push(`line ${r.line}: kind ${k} collides with the row at line ${seen.get(k)}`);
        else seen.set(k, r.line);
      }
      rows.push({ range, owner, line: r.line });
    }
  }

  for (const { range, owner, line } of rows) {
    const inBand = range[1] >= BAND[0] && range[0] <= BAND[1];
    if (!inBand || !owner) continue;
    if (owner.owner !== 'agentbox') {
      errors.push(`line ${line}: external kind ${range.join('-')} sits in the agentbox band ${BAND.join('-')}`);
      continue;
    }
    for (let k = range[0]; k <= range[1]; k++) {
      const band = bands.find((b) => k >= b.lo && k <= b.hi);
      if (!band) { errors.push(`line ${line}: agentbox kind ${k} lies in no band row`); break; }
      if (band.free) { errors.push(`line ${line}: agentbox kind ${k} is in a band row marked free (line ${band.line})`); break; }
    }
  }
  return { errors, kinds: seen };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const file = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'docs', 'PROTOCOL-registry.md');
  const { errors, kinds } = lint(readFileSync(file, 'utf8'));
  if (errors.length) {
    process.stderr.write(`protocol-registry-lint: ${errors.length} violation(s) in ${file}\n${errors.map((e) => `  ${e}`).join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write(`protocol-registry-lint: ${kinds.size} kind numbers, every row owned, no collisions, band rule holds\n`);
}
