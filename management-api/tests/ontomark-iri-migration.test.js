'use strict';
// ontomark step 2 (ontomark/iri): EXP-10 row AB-02 (and the slug half of AB-01)
//
// Run: node --test management-api/tests/ontomark-iri-migration.test.js
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

test('AB-02: IRIs are reported by the ontomark CLI, not minted by a namespace constant', () => {
  assert.match(code('management-api/lib/ontology-propose.js'), /ontomark/,
    'AB-02: management-api/lib/ontology-propose.js must take the class IRI from the ontomark CLI (slug / find JSON)');
  const mint = /IRI_NAMESPACE\s*\+|urn:ngm:class:\$\{|['"`]urn:ngm:class:['"`]\s*\+/;
  for (const f of [
    'management-api/lib/ontology-propose.js',
    'management-api/lib/elevation-stage.js',
    'skills/podcast-knowledge-ingest/submit-proposals.mjs',
  ]) {
    assert.ok(!mint.test(code(f)),
      `AB-02: ${f} still mints a urn:ngm:class: IRI (ontology-propose.js:64,173-177; submit-proposals.mjs:100; elevation-stage.js:136)`);
  }
});

test('AB-01/AB-02: slugify is not defined or exported by ontology-apply.js, nor imported by its siblings', () => {
  const apply = code('management-api/lib/ontology-apply.js');
  assert.ok(!/function slugify\b/.test(apply), 'AB-01: management-api/lib/ontology-apply.js:176 still defines slugify');
  assert.ok(!/^\s*slugify,?\s*$/m.test(apply), 'AB-01: ontology-apply.js still exports slugify');
  for (const f of ['management-api/lib/ontology-propose.js', 'management-api/lib/elevation-stage.js']) {
    assert.ok(!/\bslugify\b/.test(code(f)), `AB-01: ${f} still uses slugify (ontology-propose.js:173, elevation-stage.js:136)`);
  }
  assert.ok(!/function slugFromPage[\s\S]{0,200}toLowerCase/.test(code('skills/podcast-knowledge-ingest/submit-proposals.mjs')),
    'AB-02: submit-proposals.mjs still derives a slug locally');
});
