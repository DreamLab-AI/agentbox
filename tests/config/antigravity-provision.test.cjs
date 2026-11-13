'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { provision } = require('../../scripts/provision-antigravity.cjs');

test('boot provisioning accepts Nix boolean env and legacy numeric gates', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../config/entrypoint-unified.sh'), 'utf8');
  const gate = source.split('\n').find(line => line.startsWith('if ') && line.includes('ENABLE_ANTIGRAVITY_CLI'));
  assert.ok(gate, 'real entrypoint gate must exist');
  // Execute the actual shell condition, without provisioning real homes or keys.
  for (const [value, enabled] of [['true', true], ['1', true], ['false', false], ['0', false], ['', false]]) {
    const result = spawnSync('bash', ['-c', `function agentbox-manifest() { :; }\n${gate}\nexit 0\nelse\nexit 1\nfi`], {
      env: { PATH: process.env.PATH, ENABLE_ANTIGRAVITY_CLI: value }, encoding: 'utf8',
    });
    assert.equal(result.status, enabled ? 0 : 1, `gate=${JSON.stringify(value)}: ${result.stderr}`);
  }
});

test('API provider is projected idempotently without storing the key or losing settings', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-projection-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = path.join(home, '.gemini/antigravity-cli/settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ colorScheme: 'dark' }));
  assert.equal(provision(home, 'api_key', { GEMINI_API_KEY: 'fake-test-secret' }), true);
  const settings = JSON.parse(fs.readFileSync(file));
  assert.equal(settings.colorScheme, 'dark');
  assert.equal(settings.modelProvider, 'gemini');
  assert.equal(settings.customModelsConfig.customModels['gemini-4-hydrogen'].modelName,
    'gemini-api://models/gemini-4-hydrogen');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(provision(home, 'api_key', { GEMINI_API_KEY: 'fake-test-secret' }), false);
  assert.equal(fs.readFileSync(file, 'utf8').includes('fake-test-secret'), false);
});

test('OAuth is untouched, missing keys and malformed settings fail without overwrite', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-projection-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  assert.equal(provision(home, 'oauth', {}), false);
  assert.throws(() => provision(home, 'api_key', {}), /GEMINI_API_KEY/);
  const file = path.join(home, '.gemini/antigravity-cli/settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'broken');
  assert.throws(() => provision(home, 'api_key', { GEMINI_API_KEY: 'fake' }));
  assert.equal(fs.readFileSync(file, 'utf8'), 'broken');
});
