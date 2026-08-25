#!/usr/bin/env node
'use strict';

/**
 * check-manifest-catalogue.js — Invariant (ADR-039): every gate path declared
 * in the system-manifest CATALOGUE must resolve against the repo's
 * agentbox.toml to a boolean or a mode string. An unresolvable path means the
 * catalogue entry can never report a real state — /v1/system silently shows
 * 'available' for a feature that is actually on (the 'data_science.jupyter'
 * bug this check was born from).
 *
 * Also warns (does not fail) on agentbox.toml boolean gates that have no
 * catalogue entry, so new-gate drift is visible in CI logs before it
 * accumulates.
 */

const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
process.env.AGENTBOX_MANIFEST_PATH = path.join(ROOT, 'agentbox.toml');

const { loadManifest } = require(path.join(ROOT, 'management-api', 'adapters', 'manifest-loader'));
const { CATALOGUE, resolveGate } = require(path.join(ROOT, 'management-api', 'lib', 'system-manifest'));

const manifest = loadManifest();

// ── 1. FAIL: catalogue gate paths that do not resolve ─────────────────────────
const broken = [];
for (const entry of CATALOGUE) {
  const gates = Array.isArray(entry.gates) ? entry.gates : entry.gate ? [entry.gate] : [];
  for (const g of gates) {
    const v = resolveGate(manifest, g);
    if (v === undefined) broken.push(`${entry.id}: gate '${g}' resolves to undefined`);
    else if (typeof v !== 'boolean' && typeof v !== 'string') {
      broken.push(`${entry.id}: gate '${g}' resolves to ${typeof v} (want boolean or mode string)`);
    }
  }
}

// ── 2. WARN: toml boolean gates with no catalogue entry ───────────────────────
const catalogued = new Set(
  CATALOGUE.flatMap((e) => (Array.isArray(e.gates) ? e.gates : e.gate ? [e.gate] : []))
);
const uncatalogued = [];
(function walk(obj, prefix) {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'boolean') {
      // Both spellings count as covered: the leaf path and the section path
      // (a section gate 'foo' resolves via foo.enabled).
      const sectionForm = k === 'enabled' ? prefix : null;
      if (!catalogued.has(p) && !(sectionForm && catalogued.has(sectionForm))) uncatalogued.push(p);
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      walk(v, p);
    }
  }
})(manifest, '');

if (uncatalogued.length) {
  console.warn(`WARN (check-manifest-catalogue): ${uncatalogued.length} toml boolean key(s) with no catalogue entry`);
  console.warn('  (not all booleans are feature gates — review, and catalogue real gates per ADR-039):');
  for (const p of uncatalogued) console.warn(`    ${p}`);
}

if (broken.length) {
  console.error('FAIL (check-manifest-catalogue): catalogue gate path(s) do not resolve against agentbox.toml:');
  for (const b of broken) console.error(`  ${b}`);
  console.error('  Fix the gate path in management-api/lib/system-manifest.js (or the toml key).');
  process.exit(1);
}

console.log(`PASS (check-manifest-catalogue): all ${catalogued.size} catalogue gate paths resolve against agentbox.toml`);
