// Every boolean switch in [sovereign_mesh] must have a CATALOGUE entry in
// management-api/lib/system-manifest.js, or GET /v1/system cannot report it
// (TODO-unified S-7a: [sovereign_mesh].junkiejarvis had none).
//
//   node --test tests/config/sovereign-mesh-catalogue.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { CATALOGUE, buildSystemView, resolveGate } = require('../../management-api/lib/system-manifest');

const root = path.resolve(__dirname, '../..');

/** Boolean keys directly under [sovereign_mesh] (line-based, like the entrypoint's own reader). */
function meshSwitches() {
  const keys = [];
  let on = false;
  for (const line of fs.readFileSync(path.join(root, 'agentbox.toml'), 'utf8').split('\n')) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*(#.*)?$/);
    if (header) { on = header[1].trim() === 'sovereign_mesh'; continue; }
    const kv = on && line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(true|false)\b/);
    if (kv) keys.push(kv[1]);
  }
  return keys;
}

test('the junkiejarvis switch is claimed by a catalogue entry', () => {
  assert.ok(meshSwitches().includes('junkiejarvis'), 'parser should see the junkiejarvis switch');
  const claimed = CATALOGUE.flatMap((e) => [e.gate, ...(e.gates || [])]).filter(Boolean);
  assert.ok(claimed.includes('sovereign_mesh.junkiejarvis'), 'junkiejarvis must be catalogued');
});

test('junkiejarvis entry resolves its state from the manifest', () => {
  const entry = CATALOGUE.find((e) => e.id === 'junkiejarvis');
  assert.ok(entry, 'junkiejarvis entry present');
  assert.equal(entry.gate, 'sovereign_mesh.junkiejarvis');
  assert.ok(['live', 'boot', 'rebuild'].includes(entry.apply_class));
  assert.equal(resolveGate({ sovereign_mesh: { junkiejarvis: false } }, entry.gate), false);
  assert.equal(resolveGate({ sovereign_mesh: { junkiejarvis: true } }, entry.gate), true);
  assert.equal(typeof buildSystemView, 'function');
});

test('catalogue ids stay unique', () => {
  const ids = CATALOGUE.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
});
