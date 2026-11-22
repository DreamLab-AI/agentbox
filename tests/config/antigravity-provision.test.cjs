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

test('OAuth clears only the API projection on the persistent volume, never the token', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-projection-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const dir = path.join(home, '.gemini/antigravity-cli');
  const file = path.join(dir, 'settings.json');
  const token = path.join(dir, 'antigravity-oauth-token');
  // A prior api_key boot, plus operator settings and a sign-in token.
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ colorScheme: 'dark' }));
  assert.equal(provision(home, 'api_key', { GEMINI_API_KEY: 'fake' }), true);
  const settings = JSON.parse(fs.readFileSync(file));
  settings.customModelsConfig.customModels.mine = { modelName: 'x', label: 'Mine' };
  fs.writeFileSync(file, JSON.stringify(settings));
  fs.writeFileSync(token, '{"token":"opaque"}', { mode: 0o600 });

  assert.equal(provision(home, 'oauth', {}), true);
  const cleared = JSON.parse(fs.readFileSync(file));
  assert.equal(cleared.colorScheme, 'dark');
  assert.equal('modelProvider' in cleared, false);
  assert.equal('gemini-4-hydrogen' in cleared.customModelsConfig.customModels, false);
  assert.deepEqual(cleared.customModelsConfig.customModels.mine, { modelName: 'x', label: 'Mine' });
  assert.equal(fs.readFileSync(token, 'utf8'), '{"token":"opaque"}');
  assert.equal(provision(home, 'oauth', {}), false, 'idempotent');

  // Only the projection is empty: the whole customModelsConfig goes.
  fs.writeFileSync(file, JSON.stringify({ modelProvider: 'gemini', customModelsConfig: { customModels: {
    'gemini-4-hydrogen': { modelName: 'gemini-api://models/gemini-4-hydrogen' } } } }));
  assert.equal(provision(home, 'oauth', {}), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), {});
});

test('OAuth keeps an operator-chosen provider and a non-projected Hydrogen entry', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-projection-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const file = path.join(home, '.gemini/antigravity-cli/settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const own = { modelProvider: 'vertex', customModelsConfig: { customModels: {
    'gemini-4-hydrogen': { modelName: 'something-else' } } } };
  fs.writeFileSync(file, JSON.stringify(own));
  assert.equal(provision(home, 'oauth', {}), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), own);
});

test('the entrypoint exports the auth mode before the MCP projector expands it', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../config/entrypoint-unified.sh'), 'utf8');
  const exported = source.indexOf('export AGENTBOX_ANTIGRAVITY_AUTH_MODE=');
  const projector = source.indexOf('if [ -f "$_MCP_PROJECTOR" ]');
  assert.ok(exported > 0 && projector > exported, 'export must precede the projector');
  const registry = JSON.parse(fs.readFileSync(path.join(__dirname, '../../skills/mcp.json'), 'utf8'));
  const servers = registry.mcpServers || registry.servers || registry;
  assert.equal(servers['consultant-antigravity'].env.AGENTBOX_ANTIGRAVITY_AUTH_MODE,
    '${AGENTBOX_ANTIGRAVITY_AUTH_MODE:-api_key}');
});

test('unknown modes, missing keys and malformed settings fail without overwrite', t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-projection-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  assert.equal(provision(home, 'oauth', {}), false, 'no settings file: nothing to clear');
  assert.equal(provision(home, 'web_login', {}), false);
  assert.throws(() => provision(home, 'api_key', {}), /GEMINI_API_KEY/);
  const file = path.join(home, '.gemini/antigravity-cli/settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'broken');
  assert.throws(() => provision(home, 'api_key', { GEMINI_API_KEY: 'fake' }));
  assert.throws(() => provision(home, 'oauth', {}));
  assert.equal(fs.readFileSync(file, 'utf8'), 'broken');
});
