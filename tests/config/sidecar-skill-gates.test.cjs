'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadCandidates } = require('../../config/hooks/lib/skill-route.cjs');
const skills = path.resolve(__dirname, '../../skills');

function candidates(t, flags) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-skill-gates-'));
  t.after(() => fs.rmSync(scratch, { recursive: true }));
  const manifest = path.join(scratch, 'agentbox.toml');
  fs.writeFileSync(manifest, `[skills.spatial_and_3d]\n${flags}\n`);
  return loadCandidates(skills, { manifest });
}

test('sidecar-only QGIS remains routable without offering disabled local slicing', t => {
  const offered = candidates(t, 'qgis = true\nqgis_local = false\ncad = true\ncad_print = false');
  assert.ok(offered.qgis);
  assert.equal(offered['cad-print'], undefined);
});

test('local QGIS packages cannot enable the proxy skill, and an enabled slicer is routable', t => {
  const offered = candidates(t, 'qgis = false\nqgis_local = true\ncad = true\ncad_print = true');
  assert.equal(offered.qgis, undefined);
  assert.ok(offered['cad-print']);
});
