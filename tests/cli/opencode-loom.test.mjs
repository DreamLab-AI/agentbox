import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as seeder from '../../scripts/aoe-seed-sessions.mjs';

const listing = { data: [{ id: 'qwen3.8-27b-heretic-q8_0', owned_by: 'llamacpp', meta: { n_ctx: 262144 } }], models: [{ model: 'qwen3.8-27b-heretic-q8_0', capabilities: ['completion', 'multimodal'] }] };
const selected = seeder.selectLoomModel(listing);

test('generic and legacy agent IDs use discovered wire model, passthrough, tools and advertised images', () => {
  const config = seeder.openCodeConfig({}, '/agent-home', {}, selected);
  const provider = config.provider['loom-agent'];
  assert.equal(provider.options.baseURL, 'http://loom:8080/v1');
  const model = provider.models.current;
  assert.equal(model.id, selected.id);
  assert.deepEqual(config.provider['loom-raw'].models['qwen3.8-27B'], model);
  assert.deepEqual(model.options.loom_options, { scaffold: false });
  assert.deepEqual(model.options.chat_template_kwargs, { enable_thinking: false });
  assert.equal(model.tool_call, true);
  assert.equal(model.attachment, true);
  assert.deepEqual(model.modalities, { input: ['text', 'image'], output: ['text'] });
  assert.deepEqual(config.skills.paths, ['/agent-home/.codex/skills']);
});

test('hot swapping models updates wire ID and removes Qwen-only options and unadvertised images', () => {
  const old = seeder.openCodeConfig({}, '/agent-home', {}, selected);
  const next = seeder.selectLoomModel({ data: [{ id: 'replacement-model' }] });
  const config = seeder.openCodeConfig({}, '/agent-home', old, next);
  const model = config.provider['loom-agent'].models.current;
  assert.equal(model.id, 'replacement-model');
  assert.equal(model.options.chat_template_kwargs, undefined);
  assert.equal(model.attachment, false);
  assert.deepEqual(model.modalities.input, ['text']);
  assert.equal(config.provider['loom-raw'].models['qwen3.8-27B'].id, 'replacement-model');
  assert.deepEqual(config.provider['loom-lan'], old.provider['loom-lan']);
});

test('endpoint overrides cannot silently restore retired raw port; ontology profile is unchanged', () => {
  const config = seeder.openCodeConfig({ LOOM_BASE_URL: 'http://hp:8084/', LOOM_RAW_BASE_URL: 'http://old:8085' }, '/agent-home', {}, selected);
  for (const id of ['loom-agent', 'loom-raw', 'loom-lan']) assert.equal(config.provider[id].options.baseURL, 'http://hp:8084/v1');
  assert.equal(config.provider['loom-lan'].models['qwen3.8-27B'].options?.loom_options, undefined);
});

test('config preserves unrelated providers, user settings and skill paths without mutating inputs', () => {
  const existing = { plugin: ['local-plugin'], permission: { edit: 'ask' }, skills: { paths: ['/extra'], urls: ['https://example.invalid/skills'] }, provider: { custom: { name: 'Custom' }, 'loom-agent': { options: { headers: { 'x-extra': 'keep' } }, models: { custom: { name: 'mine' } } } } };
  const before = structuredClone(existing);
  const config = seeder.openCodeConfig({}, '/agent-home', existing, selected);
  assert.deepEqual(config.provider.custom, existing.provider.custom);
  assert.deepEqual(config.provider['loom-agent'].models.custom, { name: 'mine' });
  assert.deepEqual(config.provider['loom-agent'].options.headers, { 'x-extra': 'keep' });
  assert.deepEqual(config.permission, existing.permission);
  assert.deepEqual(config.plugin, existing.plugin);
  assert.deepEqual(config.skills.paths, ['/extra', '/agent-home/.codex/skills']);
  assert.deepEqual(existing, before);
});

test('missing, unknown and ambiguous models fail closed; explicit advertised model disambiguates', () => {
  assert.throws(() => seeder.selectLoomModel({}), /no model IDs/);
  assert.throws(() => seeder.selectLoomModel({ data: [] }), /no model IDs/);
  assert.throws(() => seeder.selectLoomModel(listing, { LOOM_MODEL: 'unknown' }), /not advertised/);
  const multiple = { data: [{ id: 'a' }, { id: 'b', capabilities: ['vision'] }] };
  assert.throws(() => seeder.selectLoomModel(multiple), /multiple models/);
  assert.deepEqual(seeder.selectLoomModel(multiple, { LOOM_MODEL: 'b' }), { id: 'b', image: true, context: 8192 });
  assert.throws(() => seeder.openCodeConfig({}, '/agent-home'), /discovered Loom model/);
});

test('image capability is metadata-derived or explicitly overridden, never inferred from Qwen name', () => {
  const bare = { data: [{ id: 'qwen-next' }], models: [{ model: 'other', capabilities: ['multimodal'] }] };
  assert.equal(seeder.selectLoomModel(bare).image, false);
  assert.equal(seeder.selectLoomModel(bare, { LOOM_IMAGE_INPUT: 'true' }).image, true);
  assert.equal(seeder.selectLoomModel(listing, { LOOM_IMAGE_INPUT: 'false' }).image, false);
  assert.throws(() => seeder.selectLoomModel(bare, { LOOM_IMAGE_INPUT: 'yes' }), /true or false/);
  assert.equal(seeder.selectLoomModel({ data: [{ id: 'audio-model', capabilities: ['multimodal'] }] }).image, false);
});

test('refreshing the agent leaves an existing ontology provider configuration untouched', () => {
  const ontology = { npm: '@ai-sdk/openai-compatible', options: { baseURL: 'http://ontology:8084/v1' }, models: { knowledge: { name: 'Knowledge profile' } } };
  const config = seeder.openCodeConfig({}, '/agent-home', { provider: { 'loom-lan': ontology } }, selected);
  assert.deepEqual(config.provider['loom-lan'], ontology);
  assert.equal(config.provider['loom-agent'].models.current.id, selected.id);
});

test('async provisioning discovers facade with bounded timeout and preserves file on discovery failure', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-loom-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const configPath = path.join(home, '.config/opencode/opencode.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ permission: { edit: 'ask' } }));
  const env = { LOOM_BASE_URL: 'http://facade:8084', LOOM_RAW_BASE_URL: 'http://raw:8085' };
  const config = await seeder.provisionOpenCode({ env, home, fetchImpl: async (url, options) => {
    assert.equal(url, 'http://facade:8084/v1/models');
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => listing };
  } });
  assert.equal(config.provider['loom-agent'].models.current.id, selected.id);
  assert.equal(JSON.parse(fs.readFileSync(configPath)).permission.edit, 'ask');
  const before = fs.readFileSync(configPath, 'utf8');
  for (const fetchImpl of [
    async () => { throw new DOMException('timed out', 'TimeoutError'); },
    async () => ({ ok: false, status: 503 }),
    async () => ({ ok: true, json: async () => ({ data: [] }) }),
    async () => ({ ok: true, json: async () => { throw new Error('invalid JSON'); } }),
  ]) {
    await assert.rejects(seeder.provisionOpenCode({ env, home, fetchImpl }));
    assert.equal(fs.readFileSync(configPath, 'utf8'), before);
  }
});

test('--providers-only refreshes model identity without materialising AoE config or reconciling sessions', async t => {
  const { createServer } = await import('node:http');
  const { spawn } = await import('node:child_process');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'opencode-providers-only-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const requests = [];
  const server = createServer((req, res) => {
    requests.push(req.url);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(listing));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const env = { ...process.env, XDG_CONFIG_HOME: home, LOOM_BASE_URL: `http://127.0.0.1:${server.address().port}` };
  for (const key of ['LOOM_MODEL', 'GEMMA_MODEL', 'LOOM_IMAGE_INPUT']) delete env[key];
  const child = spawn(process.execPath, ['scripts/aoe-seed-sessions.mjs', '--providers-only'], { env });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  assert.equal(code, 0, output);
  assert.deepEqual(requests, ['/v1/models']);
  const config = JSON.parse(fs.readFileSync(path.join(home, 'opencode/opencode.json')));
  assert.equal(config.provider['loom-agent'].models.current.id, selected.id);
  assert.equal(fs.existsSync(path.join(home, 'agent-of-empires')), false);
  assert.doesNotMatch(output, /reconciling|session reconciliation|orphan reaper/);
});


test('a smaller replacement model never inherits the previous model context budget', () => {
  const old = seeder.openCodeConfig({}, '/agent-home', {}, selected);
  assert.deepEqual(old.provider['loom-agent'].models.current.limit, { context: 131072, output: 16384 });
  const smaller = seeder.selectLoomModel({ data: [{ id: 'small-model', meta: { n_ctx: 4096 } }] });
  const config = seeder.openCodeConfig({}, '/agent-home', old, smaller);
  assert.deepEqual(config.provider['loom-agent'].models.current.limit, { context: 4096, output: 1024 });
  assert.deepEqual(config.provider['loom-raw'].models['qwen3.8-27B'].limit, { context: 4096, output: 1024 });
  assert.deepEqual(config.provider['loom-lan'], old.provider['loom-lan']);
});

test('context metadata is bounded, strictly numeric and conservative when absent or malformed', () => {
  for (const value of [undefined, null, -1, 0, 1, 3, 1.5, '32768', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const model = seeder.selectLoomModel({ data: [{ id: 'unknown-window', meta: { n_ctx: value } }] });
    const config = seeder.openCodeConfig({}, '/agent-home', {}, model);
    assert.deepEqual(config.provider['loom-agent'].models.current.limit, { context: 8192, output: 2048 }, String(value));
  }
  for (const row of [{ context_window: 16384 }, { context_length: 16384 }, { max_model_len: 16384 }, { limit: { context: 16384 } }]) {
    assert.equal(seeder.selectLoomModel({ data: [{ id: 'explicit-window', ...row }] }).context, 16384);
  }
  const minimum = seeder.selectLoomModel({ data: [{ id: 'tiny', meta: { n_ctx: 4 } }] });
  assert.deepEqual(seeder.openCodeConfig({}, '/agent-home', {}, minimum).provider['loom-agent'].models.current.limit, { context: 4, output: 1 });
});


test('stale GEMMA_MODEL never constrains agent discovery after a server hot swap', () => {
  const env = { GEMMA_MODEL: 'gemma-4-31B-it-qat', GEMMA_BASE_URL: 'http://facade:8084' };
  const discovered = seeder.selectLoomModel(listing, env);
  assert.equal(discovered.id, selected.id);
  const config = seeder.openCodeConfig(env, '/agent-home', {}, discovered);
  assert.equal(config.provider['loom-agent'].models.current.id, selected.id);
  assert.equal(config.provider['loom-raw'].models['qwen3.8-27B'].id, selected.id);
  // The older ontology profile deliberately keeps its existing env semantics.
  assert.ok(config.provider['loom-lan'].models['gemma-4-31B-it-qat']);
  assert.throws(() => seeder.selectLoomModel(listing, { ...env, LOOM_MODEL: 'unknown' }), /not advertised/);
});
