'use strict';
/**
 * WHAT THIS IS
 *   Proves that no path agentbox uses to launch Claude Code against Z.AI hands the
 *   caller's Claude Code steering to the child. A stub `claude` first on PATH dumps the
 *   environment it was started with; each launch path runs under a caller environment
 *   carrying CLAUDE_EFFORT, CLAUDE_CONFIG_DIR, the direct-Anthropic key and an unrelated
 *   secret, and the dump is checked. Run with `node --test tests/security/zai-launch-env.test.cjs`.
 *
 *   Paths covered: the `zai` CLI (config/zai-wrapper.sh), the consultant and the
 *   ontology monitor (both build their env with mcp/consultants/shared/zai-env.js and
 *   run through spawn-cli, then the `zai` CLI), the AoE harness wrapper
 *   (config/harness-wrappers/zai.sh) and the claude-zai sidecar (claude-zai/wrapper).
 *
 * WHY IT IS THIS WAY
 *   Under a plain `env HOME=… claude`, CLAUDE_EFFORT=medium silently lowered GLM's effort
 *   and CLAUDE_CONFIG_DIR pulled in the caller's output style and plugins. Worse, an
 *   inherited ANTHROPIC_API_KEY would be sent to the Z.AI base URL. Only a test that
 *   runs the real wrapper end to end catches an inherited variable.
 *
 * WHAT IT MEANS FOR THE CLIENT
 *   A Z.AI call runs at the effort and with the configuration it was asked for, and the
 *   direct-Anthropic key never travels to a third-party endpoint.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '..', '..');
const ZAI_CLI = path.join(REPO, 'config', 'zai-wrapper.sh');
const HARNESS = path.join(REPO, 'config', 'harness-wrappers', 'zai.sh');
const { spawnCli } = require(path.join(REPO, 'mcp', 'consultants', 'shared', 'spawn-cli.js'));
const { zaiChildEnv } = require(path.join(REPO, 'mcp', 'consultants', 'shared', 'zai-env.js'));
const { claudeChildEnv } = require(path.join(REPO, 'claude-zai', 'wrapper', 'child-env.js'));

const TOKEN = 'INVENTED_ZAI_FIXTURE_NOT_A_SECRET';
const DIRECT = 'INVENTED_DIRECT_ANTHROPIC_FIXTURE';

// What a polluted caller looks like: a coordinator session at medium effort, with its own
// config dir, the direct-Anthropic key and a management secret in scope.
const POLLUTION = {
  CLAUDE_EFFORT: 'medium',
  CLAUDE_CONFIG_DIR: '/caller/.claude',
  CLAUDE_CODE_ENTRYPOINT: 'cli',
  CLAUDECODE: '1',
  MAX_THINKING_TOKENS: '1024',
  ANTHROPIC_API_KEY: DIRECT,
  ANTHROPIC_MODEL: 'claude-caller-model',
  MANAGEMENT_API_KEY: 'INVENTED_MGMT_FIXTURE',
};
const STEERING = ['CLAUDE_EFFORT', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDECODE', 'MAX_THINKING_TOKENS', 'ANTHROPIC_MODEL'];
const MUST_NOT_REACH = [...STEERING, 'MANAGEMENT_API_KEY'];

// Callers are built from scratch, never from process.env, so a live key in the test
// runner's own environment can neither reach a child nor mask a fixture.
const caller = (s, extra = {}) => ({ PATH: s.PATH, ...POLLUTION, ...extra });

function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zai-env-'));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  const dump = path.join(dir, 'child.env');
  // The stub is the only `claude` on PATH: it records its environment, NUL-separated.
  fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\nenv -0 > '${dump}'\necho STUB_RAN\n`, { mode: 0o755 });
  // The consultant's AGENTBOX_ZAI_BIN resolves to the `zai` CLI in the image.
  fs.symlinkSync(ZAI_CLI, path.join(bin, 'zai'));
  const read = () => Object.fromEntries(fs.readFileSync(dump, 'utf8').split('\0').filter(Boolean)
    .map((kv) => [kv.slice(0, kv.indexOf('=')), kv.slice(kv.indexOf('=') + 1)]));
  return { dir, bin, read, PATH: `${bin}:${process.env.PATH}` };
}

function assertClean(env, { configDir, keys = MUST_NOT_REACH } = {}) {
  for (const k of keys) assert.equal(env[k], undefined, `${k} leaked into the Z.AI child`);
  assert.notEqual(env.ANTHROPIC_API_KEY, DIRECT, 'the direct-Anthropic key leaked toward Z.AI');
  if (configDir === undefined) assert.equal(env.CLAUDE_CONFIG_DIR, undefined, 'the caller CLAUDE_CONFIG_DIR leaked');
  else assert.equal(env.CLAUDE_CONFIG_DIR, configDir);
  assert.match(env.ANTHROPIC_BASE_URL, /^https:\/\/api\.z\.ai\//);
}

test('zai CLI: starts claude from a clean env carrying only the Z.AI redirect', () => {
  const s = sandbox();
  const r = spawnSync('bash', [ZAI_CLI, '-p', 'hi'], {
    encoding: 'utf8',
    env: caller(s, { HOME: path.join(s.dir, 'zhome'), ZAI_API_KEY: TOKEN, LANG: 'C.UTF-8' }),
  });
  assert.equal(r.status, 0, r.stderr);
  const env = s.read();
  assertClean(env);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, TOKEN);
  assert.equal(env.ANTHROPIC_API_KEY, '');
  assert.equal(env.HOME, path.join(s.dir, 'zhome'), 'the caller chooses HOME, and so the config the child reads');
  assert.equal(env.LANG, 'C.UTF-8', 'locale is not steering and is kept');
  const allowed = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TERM', 'COLORTERM', 'TERM_PROGRAM', 'LANG',
    'LC_ALL', 'LC_CTYPE', 'TZ', 'TMPDIR', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NIX_SSL_CERT_FILE', 'CURL_CA_BUNDLE',
    'REQUESTS_CA_BUNDLE', 'NODE_EXTRA_CA_CERTS', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy',
    'https_proxy', 'no_proxy', 'AGENTBOX_AGENT_ID', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY',
    'CLAUDE_EFFORT', 'MAX_THINKING_TOKENS', 'PWD', 'SHLVL', '_', 'OLDPWD']);
  const extra = Object.keys(env).filter((k) => !allowed.has(k));
  assert.deepEqual(extra, [], `unexpected variables reached the child: ${extra.join(', ')}`);
});

test('zai CLI: effort and thinking budget are set only through the explicit ZAI_* levers', () => {
  const s = sandbox();
  const r = spawnSync('bash', [ZAI_CLI, '-p', 'hi'], {
    encoding: 'utf8',
    env: caller(s, { ZAI_API_KEY: TOKEN, ZAI_EFFORT: 'max', ZAI_MAX_THINKING_TOKENS: '31999' }),
  });
  assert.equal(r.status, 0, r.stderr);
  const env = s.read();
  assert.equal(env.CLAUDE_EFFORT, 'max');
  assert.equal(env.MAX_THINKING_TOKENS, '31999');
});

test('zai CLI: refuses to start without a Z.AI key rather than fall back to another credential', () => {
  const s = sandbox();
  const r = spawnSync('bash', [ZAI_CLI, '-p', 'hi'], { encoding: 'utf8', env: caller(s) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ZAI_API_KEY/);
  assert.doesNotMatch(r.stdout, /STUB_RAN/);
});

test('consultant / ontology monitor: zaiChildEnv through spawn-cli and the zai CLI reaches claude clean', async () => {
  const s = sandbox();
  // spawn-cli takes PATH (and TLS/proxy plumbing) from its own process, the consultant.
  const saved = { ...process.env };
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, caller(s, { ZAI_ANTHROPIC_API_KEY: TOKEN }));
  try {
    const childEnv = zaiChildEnv(process.env, { home: path.join(s.dir, 'zhome'), agentId: 'consultant-zai', maxThinkingTokens: 10000 });
    for (const [k, v] of Object.entries(POLLUTION)) assert.notEqual(childEnv[k], v, `zaiChildEnv copied the caller's ${k}`);
    const r = await spawnCli({ cmd: 'zai', args: ['-p', 'hi'], env: childEnv, timeout_ms: 20_000 });
    assert.equal(r.code, 0, r.stderr);
    const env = s.read();
    // MAX_THINKING_TOKENS is the consultant's own lever: checked by value below, not absence.
    assertClean(env, { keys: MUST_NOT_REACH.filter((k) => k !== 'MAX_THINKING_TOKENS') });
    assert.equal(env.ANTHROPIC_AUTH_TOKEN, TOKEN);
    assert.equal(env.MAX_THINKING_TOKENS, '10000', 'the consultant effort lever survives the wrapper, the caller 1024 does not');
    assert.equal(env.AGENTBOX_AGENT_ID, 'consultant-zai');
    assert.equal(env.HOME, path.join(s.dir, 'zhome'));
  } finally {
    for (const k of Object.keys(process.env)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('consultant / ontology monitor: both build their child env with zaiChildEnv', () => {
  for (const rel of ['mcp/consultants/zai/server.js', 'config/hooks/ontology-monitor.cjs']) {
    const src = fs.readFileSync(path.join(REPO, rel), 'utf8');
    assert.match(src, /zaiChildEnv\(/, `${rel} must build its env with zaiChildEnv`);
    assert.doesNotMatch(src, /inherit_env:\s*true/, `${rel} must not inherit the caller env`);
  }
});

test('AoE harness wrapper: ZAI_EFFORT is the only way to set the session effort', () => {
  const s = sandbox();
  const ws = path.join(s.dir, 'ws');
  const claudeDir = path.join(ws, 'profiles', 'zai', '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, 'settings.local.json'),
    JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://api.z.ai/api/paas/v4', ANTHROPIC_AUTH_TOKEN: TOKEN } }));
  const r = spawnSync('bash', [HARNESS], { encoding: 'utf8', env: caller(s, { WORKSPACE: ws, ZAI_EFFORT: 'high' }) });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(s.read().CLAUDE_EFFORT, 'high');
});

test('AoE harness wrapper: pins its own config dir and strips the caller Claude Code steering', () => {
  const s = sandbox();
  const ws = path.join(s.dir, 'ws');
  const claudeDir = path.join(ws, 'profiles', 'zai', '.claude');
  fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(path.join(claudeDir, 'settings.local.json'),
    JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'https://api.z.ai/api/paas/v4', ANTHROPIC_AUTH_TOKEN: TOKEN } }));
  const r = spawnSync('bash', [HARNESS], {
    encoding: 'utf8',
    env: caller(s, { WORKSPACE: ws, RUVECTOR_PG_CONNINFO: 'host=ruvector-postgres', CLAUDE_FLOW_HOOKS_ENABLED: 'true' }),
  });
  assert.equal(r.status, 0, r.stderr);
  const env = s.read();
  // Steering only: an interactive agent session keeps the estate variables AoE gives it.
  assertClean(env, { configDir: claudeDir, keys: STEERING });
  assert.equal(env.ANTHROPIC_API_KEY, '');
  assert.equal(env.HOME, path.join(ws, 'profiles', 'zai'));
  // An interactive session still needs the estate services its MCP servers and hooks dial.
  assert.equal(env.RUVECTOR_PG_CONNINFO, 'host=ruvector-postgres');
  assert.equal(env.CLAUDE_FLOW_HOOKS_ENABLED, 'true');
});

test('claude-zai sidecar: the child env is built from an allowlist, not a copy of process.env', () => {
  const env = claudeChildEnv({ ...POLLUTION, PATH: '/usr/bin', HOME: '/home/claude', ZAI_WRAPPER_TOKEN: 'INVENTED_BEARER', LANG: 'C.UTF-8' },
    { configDir: '/home/claude/.claude', apiKey: TOKEN, baseUrl: 'https://api.z.ai/api/paas/v4' });
  assertClean(env, { configDir: '/home/claude/.claude' });
  assert.equal(env.ZAI_WRAPPER_TOKEN, undefined, 'the sidecar bearer secret must not reach a Bash-capable child');
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, TOKEN);
  assert.equal(env.ANTHROPIC_API_KEY, '');
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HOME, '/home/claude');
  assert.equal(env.LANG, 'C.UTF-8');
  const src = fs.readFileSync(path.join(REPO, 'claude-zai', 'wrapper', 'server.js'), 'utf8');
  assert.doesNotMatch(src, /\.\.\.process\.env/, 'server.js must not spread process.env into the claude child');
  assert.match(src, /claudeChildEnv\(/);
});

test('the zai CLI is executable, since the image links /bin/zai straight to it', () => {
  // A 0644 wrapper made every consultant and ontology-monitor call fail with spawn EACCES.
  assert.ok(fs.statSync(ZAI_CLI).mode & 0o111, 'config/zai-wrapper.sh must be committed with mode 755');
});
