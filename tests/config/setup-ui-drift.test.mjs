// Drift guard for the setup wizard: the schema, the UI metadata and the seed
// manifest must describe the same set of sections and keys.
//   node --test tests/config/setup-ui-drift.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const root = path.join(import.meta.dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const schema = JSON.parse(read('schema/agentbox.toml.schema.json'));
const ui = JSON.parse(read('schema/agentbox.toml.ui.json'));
const TOML = require('@iarna/toml');
const seed = TOML.parse(read('setup/agentbox.default.toml'));

const sections = Object.keys(schema.properties);

test('every schema section has a label, a known group and a description', () => {
  const groups = new Set(ui.groups.map((g) => g.id));
  const bad = [];
  for (const k of sections) {
    const s = ui.sections[k];
    if (!s?.label) bad.push(`${k}: no label`);
    if (!s || !groups.has(s.group)) bad.push(`${k}: no/unknown group`);
    if (!schema.properties[k].description?.trim()) bad.push(`${k}: no description`);
  }
  assert.deepEqual(bad, []);
});

test('ui.json has no sections the schema lacks, and no empty group', () => {
  assert.deepEqual(Object.keys(ui.sections).filter((k) => !schema.properties[k]), []);
  const used = new Set(Object.values(ui.sections).map((s) => s.group));
  assert.deepEqual(ui.groups.map((g) => g.id).filter((g) => !used.has(g)), []);
  for (const g of ui.groups) assert.ok(g.label && g.blurb, `group ${g.id} needs label and blurb`);
});

test('every schema leaf key has a description', () => {
  const missing = [];
  const walk = (n, p) => {
    const props = n.properties && Object.keys(n.properties);
    if (props?.length) props.forEach((k) => walk(n.properties[k], [...p, k]));
    else if (!n.description?.trim()) missing.push(p.join('.'));
  };
  walk(schema, []);
  assert.deepEqual(missing, []);
});

test('every key in agentbox.default.toml exists in the schema', () => {
  const unknown = [];
  const walk = (val, node, p) => {
    if (val === null || typeof val !== 'object') return;
    if (Array.isArray(val)) { val.forEach((v) => walk(v, node.items ?? {}, p)); return; }
    for (const [k, v] of Object.entries(val)) {
      const child = node.properties?.[k];
      if (child) walk(v, child, [...p, k]);
      else if (node.additionalProperties && typeof node.additionalProperties === 'object') walk(v, node.additionalProperties, [...p, k]);
      else if (node.patternProperties || node.additionalProperties === true) { /* free-form map */ }
      else unknown.push([...p, k].join('.'));
    }
  };
  walk(seed, schema, []);
  assert.deepEqual(unknown, []);
});

test('the seed carries every non-deprecated schema section', () => {
  const missing = sections.filter((k) => !(k in seed) && !/DEPRECATED/.test(schema.properties[k].description));
  assert.deepEqual(missing, []);
});

test('agentbox.toml.apply.json is current with the system-manifest catalogue', () => {
  execFileSync('node', ['scripts/gen-setup-apply.cjs', '--check'], { cwd: root, stdio: 'pipe' });
});

test('every apply-class gate names a real schema path', () => {
  const apply = JSON.parse(read('schema/agentbox.toml.apply.json'));
  const bad = Object.keys(apply.gates).filter((g) => {
    let n = schema;
    for (const k of g.split('.')) {
      if (n.additionalProperties === true && !n.properties?.[k]) return false; // free-form table
      n = n.properties?.[k] ?? (n.additionalProperties && typeof n.additionalProperties === 'object' ? n.additionalProperties : null);
      if (!n) return true;
    }
    return false;
  });
  assert.deepEqual(bad, []);
});

test('the seed manifest passes the manifest validator', () => {
  try {
    execFileSync('node', ['scripts/agentbox-config-validate.js', 'setup/agentbox.default.toml'], { cwd: root, stdio: 'pipe' });
  } catch (e) {
    if (e.status === 2) return; // npm deps not installed; the wrapper bootstraps them
    throw new Error(String(e.stdout) + String(e.stderr));
  }
});
