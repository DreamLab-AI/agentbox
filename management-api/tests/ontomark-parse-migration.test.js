'use strict';
// ontomark step 1 (ontomark/parse): EXP-10 rows AB-01, AB-04, AB-06
//
// Run: node --test management-api/tests/ontomark-parse-migration.test.js
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

test('AB-06: podcast-ingest depends on the ontomark-parse crate', () => {
  const deps = cargoSection('services/podcast-ingest/Cargo.toml', 'dependencies');
  assert.match(deps, /^ontomark-parse\s*=/m,
    'AB-06: services/podcast-ingest/Cargo.toml [dependencies] must name `ontomark-parse`');
});

test('AB-06: frontmatter scalar quoting and the working-page writer are ontomark-parse, not local code', () => {
  const scalar = read('services/podcast-ingest/src/common/yaml_scalar.rs');
  assert.ok(!/Regex::new/.test(scalar),
    'AB-06: services/podcast-ingest/src/common/yaml_scalar.rs:33 still carries its own quoting rules (Regex::new)');
  assert.ok(!/fn re_(bool_like|number_like|date_like|special_chars)/.test(scalar),
    'AB-06: yaml_scalar.rs still defines re_bool_like/re_number_like/re_date_like/re_special_chars');
  assert.match(read('services/podcast-ingest/src/promote/working_page.rs'), /ontomark_parse/,
    'AB-06: services/podcast-ingest/src/promote/working_page.rs:56 write_working_page must write frontmatter through ontomark_parse');
});

test('AB-01: management-api reads pages through the ontomark CLI, with no frontmatter regex of its own', () => {
  const apply = code('management-api/lib/ontology-apply.js');
  assert.ok(!apply.includes('---\\r?\\n([\\s\\S]*?)\\r?\\n---'),
    'AB-01: management-api/lib/ontology-apply.js:320 still parses frontmatter with a regex');
  assert.match(apply, /ontomark/,
    'AB-01: management-api/lib/ontology-apply.js must call the `ontomark` CLI (retrieve --json) to read a page');
});

test('AB-04: kg-proposal-extractor holds no is-subclass-of extraction of its own', () => {
  const ext = code('management-api/lib/kg-proposal-extractor.js');
  for (const sym of ['value.is_subclass_of', "value['is-a']", 'value.parents']) {
    assert.ok(!ext.includes(sym),
      `AB-04: management-api/lib/kg-proposal-extractor.js:156-181 still reads ${sym}; take relations from the ontomark CLI JSON`);
  }
});

test('step 1 (brief): ontology-local.js no longer hand-rolls the JSON-LD class-block parse', () => {
  const local = code('mcp/servers/lib/ontology-local.js');
  for (const sym of ['JSONLD_RE', 'function classBlock']) {
    assert.ok(!local.includes(sym),
      `AB-05 (parse half): mcp/servers/lib/ontology-local.js still has ${sym} (:104-327 interim parser)`);
  }
});
