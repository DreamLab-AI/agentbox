import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const toml = require('@iarna/toml');
const root = new URL('../../', import.meta.url).pathname;
const manifest = toml.parse(fs.readFileSync(`${root}agentbox.toml`, 'utf8'));
const { CATALOGUE, stateOf } = require('../../management-api/lib/system-manifest.js');

test('each requested consumer is enabled and catalogue prerequisites resolve', () => {
  for (const [key, value] of Object.entries(manifest.system_one.consumers)) {
    assert.equal(value, true, key);
    const entry = CATALOGUE.find(e => e.gate === `system_one.consumers.${key}`);
    assert.ok(entry, key);
    // Resolve real prerequisites, not capability IDs masquerading as TOML paths.
    assert.deepEqual(entry.requires, ['system_one.enabled']);
  }
  assert.equal(manifest.features.jev_checkpoints.claim_check, true);
  assert.equal(manifest.dream_machine.jev_triage, true);
});

test('pre-supervisor projection reaches a child without changing public vendor locality', t => {
  const binary = `${root}services/agentbox-manifest/target/debug/agentbox-manifest`;
  if (!fs.existsSync(binary)) { t.skip('build agentbox-manifest first'); return; }
  const script = fs.readFileSync(`${root}config/entrypoint-unified.sh`, 'utf8');
  const start = script.indexOf('# Project the typed-decision environment BEFORE supervisord starts.');
  const end = script.indexOf('# Custody W1', start);
  assert.ok(start > 0 && end > start && end < script.indexOf('exec supervisord'));
  const block = script.slice(start, end);
  const child = spawnSync('bash', ['-c', block + `\nnode -e 'console.log(JSON.stringify({memory:process.env.AGENTBOX_JEV_MEMORY_RERANK,private:process.env.AGENTBOX_SYSTEM_ONE_LOCAL_ENDPOINT,local:process.env.AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL,website:process.env.DREAMLAB_JEV,vault:process.env.VISIONCLAW_JEV_PATCH_RANK}))'`], {
    cwd:root, encoding:'utf8', env:{...process.env, AGENTBOX_CONFIG:`${root}agentbox.toml`, PATH:`${root}services/agentbox-manifest/target/debug:${process.env.PATH}`}
  });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout.trim()), { memory:'1', private:'http://systemone:8097/v1/systemone', local:'0', website:'1', vault:'1' });
});
