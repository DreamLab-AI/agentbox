'use strict';
// ontomark step 9 (ontomark/write): EXP-10 row AB-03
//
// Run: node --test management-api/tests/ontomark-write-migration.test.js
//
// Red until the consumer is on ontomark AND the legacy code named by the
// DEPRECATION rows is gone. Reads files and manifests only; never imports
// ontomark, so it runs (and fails by assertion) on a tree that has none.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return ''; }
};
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
/** Source with comment-only lines removed, so prose naming a legacy symbol does not count. */
const code = (rel) => read(rel).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*|#)/.test(l)).join('\n');
/** Text of one `[section]` of a Cargo.toml. */
const cargoSection = (rel, name) => {
  let inside = false;
  const out = [];
  for (const line of read(rel).split('\n')) {
    const t = line.trim();
    if (t.startsWith('[')) { inside = t === `[${name}]`; continue; }
    if (inside) out.push(line);
  }
  return out.join('\n');
};

test('AB-03: the elevation stage writes pages through `ontomark create`', () => {
  const stage = code('management-api/lib/elevation-stage.js');
  assert.match(stage, /ontomark/, 'AB-03: management-api/lib/elevation-stage.js must call the `ontomark` CLI');
  assert.match(stage, /['"]create['"]/, "AB-03: elevation-stage.js must stage a page with `ontomark create` (guarded write)");
});

test('AB-03: the hand-built page writer and relation resolution are gone', () => {
  const stage = code('management-api/lib/elevation-stage.js');
  for (const [sym, where] of [
    ['function renderStagedPage', ':136-174 page writer'],
    ["const lines = ['---'", ':136-174 frontmatter assembled line by line'],
    ['function resolveRelationTargets', ':80-94 relation resolution'],
    ['function wikilink', ':75 wikilink rendering for the writer'],
  ]) {
    assert.ok(!stage.includes(sym), `AB-03: management-api/lib/elevation-stage.js${where} still present (${sym})`);
  }
});

test('AB-03: elevation-stage tests no longer assert on rendered markdown from a local writer', () => {
  assert.ok(!read('management-api/tests/elevation-stage.test.js').includes('renderStagedPage'),
    'AB-03: management-api/tests/elevation-stage.test.js still imports renderStagedPage');
});
