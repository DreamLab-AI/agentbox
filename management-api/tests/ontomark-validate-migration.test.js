'use strict';
// ontomark step 7 (ontomark/validate): EXP-10 row AB-05
//
// Run: node --test management-api/tests/ontomark-validate-migration.test.js
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

test('AB-05: the interim local validator and index builder use the ontomark CLI', () => {
  for (const f of ['mcp/servers/lib/ontology-local.js', 'mcp/servers/lib/ontology-index-build.js']) {
    assert.match(code(f), /ontomark/, `AB-05: ${f} must read and validate through the \`ontomark\` CLI (find, validate), not its own parse`);
  }
});

test('AB-05: the JSON-LD class index and dangling-link check are gone', () => {
  const build = code('mcp/servers/lib/ontology-index-build.js');
  assert.ok(!build.includes('extractJsonLdBlocks'),
    'AB-05: mcp/servers/lib/ontology-index-build.js:49-56,126-127 still parses ```json-ld blocks (extractJsonLdBlocks)');
  const local = code('mcp/servers/lib/ontology-local.js');
  for (const sym of ['danglingRelationTargets', 'function validate()']) {
    assert.ok(!local.includes(sym), `AB-05: mcp/servers/lib/ontology-local.js:320-330 still has ${sym}`);
  }
});

test('AB-05: package.json test:vault no longer globs a directory that does not exist', () => {
  const pkg = JSON.parse(read('package.json'));
  const script = (pkg.scripts || {})['test:vault'];
  if (script === undefined) return; // deleted: fine
  const m = /(\S+)\/\*\.test\.js/.exec(script);
  assert.ok(m && exists(m[1]),
    `AB-05: package.json:10 test:vault globs ${m ? m[1] : script}, which does not exist (delete the script or point it at real tests)`);
});
