'use strict';

/**
 * No database credential and no recorder gate ever reaches a task, by either
 * route: the spawned env (utils/process-manager.js) or the hook command the
 * entrypoint registers in ~/.claude/settings.json (a task inherits HOME, so its
 * `claude` child runs that command). The recorder carries no direct database
 * client; the consultant emitter reaches the API with the task's token.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { EventEmitter } = require('events');

jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return { ...actual, spawn: jest.fn() };
});
const childProcess = require('child_process');
const realSpawn = jest.requireActual('child_process').spawn;

const ProcessManager = require('../../management-api/utils/process-manager');
const { TaskActionTokenStore } = require('../../management-api/lib/task-action-tokens');

const ROOT = path.resolve(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SECRET = 'sentinel-db-secret-7f3a';

function fakeChild() {
  const c = new EventEmitter();
  c.pid = 4242;
  c.stdout = { pipe() {} };
  c.stderr = { pipe() {} };
  c.unref = () => {};
  return c;
}

describe('1. the spawned task env carries no database or gate variable', () => {
  let tmp;
  let prevEnv;
  let spawned;
  beforeEach(() => {
    prevEnv = { ...process.env };
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tte-'));
    Object.assign(process.env, {
      WORKSPACE: tmp,
      PROCESS_MANAGER_LOGS_DIR: path.join(tmp, 'logs'),
      MANAGEMENT_API_KEY: 'operator-key-0123456789abcdef0123456789abcdef',
      ZAI_ENABLED: 'true',
      ZAI_CONTAINER_URL: 'http://zai.invalid',
      RUVECTOR_PG_CONNINFO: `host=ruvector-postgres user=ruvector password=${SECRET}`,
      RUVECTOR_PG_PASSWORD: SECRET,
      PGPASSWORD: SECRET,
      PGHOST: 'ruvector-postgres',
      DATABASE_URL: `postgresql://ruvector:${SECRET}@ruvector-postgres:5432/ruvector`,
      RUVECTOR_MEMORY_LEARNING_ENABLED: '1',
      RUVECTOR_RECORD_TRAJECTORIES: '1',
    });
    spawned = [];
    childProcess.spawn.mockReset();
    childProcess.spawn.mockImplementation((cmd, args, opts) => { const c = fakeChild(); spawned.push({ cmd, args, opts, c }); return c; });
  });
  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 25));
    process.env = prevEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test.each(['gemini', 'claude-flow'])('provider %s', (provider) => {
    const logger = { info() {}, warn() {}, error() {}, debug() {} };
    const pm = new ProcessManager(logger, { taskTokens: new TaskActionTokenStore() });
    pm.spawnTask('coder', 'do the thing', provider);
    const { env } = spawned[spawned.length - 1].opts;
    for (const k of Object.keys(env)) {
      expect(k).not.toMatch(/^PG/);
      expect(k).not.toMatch(/^RUVECTOR_/);
      expect(k).not.toMatch(/CONNINFO|DATABASE_URL|POSTGRES/i);
    }
    expect(JSON.stringify(env)).not.toContain(SECRET);
    expect(env.TASK_ACTION_TOKEN).toBeTruthy();
  });
});

describe('2. the hook command the entrypoint registers carries no database credential or gate', () => {
  // The registration is a node heredoc inside the entrypoint; run it for real.
  function heredoc() {
    const src = read('config/entrypoint-unified.sh');
    const start = src.indexOf("<<'TRAJJS'");
    const end = src.indexOf('\nTRAJJS', start);
    expect(start).toBeGreaterThan(-1);
    return src.slice(src.indexOf('\n', start) + 1, end);
  }

  test('the generated Stop/SubagentStop commands name the hook, pubkey and agent only', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tte-reg-'));
    const settings = path.join(dir, 'settings.json');
    const pk = 'ab'.repeat(32);
    const { spawnSync } = jest.requireActual('child_process');
    const r = spawnSync('node', ['-e', heredoc()], {
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        SETTINGS: settings,
        TRAJ_HOOK: '/opt/agentbox/config/hooks/trajectory-recorder.cjs',
        // Everything an old registration would have inlined.
        TRAJ_CONNINFO: `host=ruvector-postgres port=5432 dbname=ruvector user=ruvector password=${SECRET}`,
        RUVECTOR_PG_CONNINFO: `host=ruvector-postgres password=${SECRET}`,
        RUVECTOR_PG_PASSWORD: SECRET,
        TRAJ_PUBKEY: pk,
        TRAJ_AGENT: 'claude-code',
      },
    });
    expect(r.status).toBe(0);
    const s = JSON.parse(fs.readFileSync(settings, 'utf8'));
    for (const evt of ['Stop', 'SubagentStop']) {
      const cmds = s.hooks[evt].flatMap((g) => g.hooks.map((h) => h.command));
      expect(cmds).toHaveLength(1);
      const c = cmds[0];
      expect(c).toContain('trajectory-recorder.cjs');
      expect(c).toContain(`AGENTBOX_PUBKEY=${pk}`);
      expect(c).not.toContain(SECRET);
      expect(c).not.toMatch(/RUVECTOR_|CONNINFO|password|PGPASSWORD/i);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('the entrypoint no longer builds or defaults a recorder conninfo', () => {
    const src = read('config/entrypoint-unified.sh');
    // Only the trajectory-recorder registration block is pinned: other hooks
    // (and the ruvector-mcp projection) have their own, separate conninfo.
    const a = src.indexOf('register the learning-loop trajectory hook');
    const block = src.slice(a, src.indexOf('\n# ── ', a + 10));
    expect(a).toBeGreaterThan(-1);
    expect(block).toContain('TRAJ_HOOK=');
    expect(block).not.toMatch(/TRAJ_CONNINFO|CONNINFO|PG_PASSWORD|RUVECTOR_MEMORY_LEARNING_ENABLED|RUVECTOR_RECORD_TRAJECTORIES/);
  });
});

describe('3. the recorder has no direct database client left (grep-pin)', () => {
  const src = read('config/hooks/trajectory-recorder.cjs');
  test.each([
    ["require('pg')", /require\(['"]pg['"]\)/],
    ['loadPg / PG_SEARCH_PATHS', /loadPg|PG_SEARCH_PATHS/],
    ['pg Client construction', /Pg\.Client|new Client\(|new Pool\(/],
    ['RUVECTOR_PG_CONNINFO', /RUVECTOR_PG_CONNINFO/],
    ['a default database password', /password=ruvector|password: *parsed|'ruvector'/],
    ['the gate reader', /gateOn|RUVECTOR_MEMORY_LEARNING_ENABLED|RUVECTOR_RECORD_TRAJECTORIES/],
    ['raw SQL', /INSERT INTO|UPDATE trajectories|information_schema|ON CONFLICT/],
  ])('no %s', (_n, re) => {
    // Comments may still describe history; only executable text is pinned.
    const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    expect(code).not.toMatch(re);
  });

  test('the only trajectory SQL in hooks and the API lives in management-api/lib/trajectory-store.js', () => {
    const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap((e) => {
      const p = path.join(d, e.name);
      if (e.isDirectory()) return e.name === 'node_modules' ? [] : walk(p);
      return /\.(c|m)?js$/.test(e.name) ? [p] : [];
    });
    const hits = [...walk('config/hooks'), ...walk('management-api')]
      .filter((p) => /INSERT INTO trajector(ies|y_steps)/.test(read(p)));
    expect(hits).toEqual(['management-api/lib/trajectory-store.js']);
  });
});

describe('4. the consultant emitter, run with a spawned task env, sends with the token', () => {
  test('exact taskEnv from spawnTask → emitter child → Authorization: Bearer <token>', async () => {
    const hits = [];
    const srv = http.createServer((req, res) => {
      let b = '';
      req.on('data', (d) => { b += d; });
      req.on('end', () => { hits.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(b || '{}') }); res.end('{}'); });
    });
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tte-c-'));
    const prev = { ...process.env };
    Object.assign(process.env, {
      WORKSPACE: tmp, PROCESS_MANAGER_LOGS_DIR: path.join(tmp, 'logs'), ZAI_ENABLED: 'true',
      ZAI_CONTAINER_URL: 'http://zai.invalid', MANAGEMENT_API_KEY: 'operator-key-must-not-reach-the-task',
      MANAGEMENT_API_PORT: String(srv.address().port),
    });
    let taskEnv; let taskId;
    childProcess.spawn.mockReset();
    childProcess.spawn.mockImplementation((cmd, args, opts) => { taskEnv = opts.env; return fakeChild(); });
    const logger = { info() {}, warn() {}, error() {}, debug() {} };
    taskId = new ProcessManager(logger, { taskTokens: new TaskActionTokenStore() }).spawnTask('coder', 'x', 'claude-flow').taskId;
    process.env = prev;

    const script = `require(${JSON.stringify(path.join(ROOT, 'mcp/consultants/shared/consultant-base'))})._emitConsultEvent('codex', { consultation_urn: 'urn:x', model: 'm', ok: true }); setTimeout(() => process.exit(0), 1500);`;
    await new Promise((resolve) => {
      // The env handed to the child is exactly the task's, nothing else.
      const c = realSpawn(process.execPath, ['-e', script], { env: { ...taskEnv, PATH: process.env.PATH }, stdio: 'ignore' });
      c.on('close', resolve);
    });
    srv.close();
    fs.rmSync(tmp, { recursive: true, force: true });

    expect(taskEnv.MANAGEMENT_API_KEY).toBeUndefined();
    expect(hits).toHaveLength(1);
    expect(hits[0].url).toBe('/v1/agent-events/emit');
    expect(hits[0].auth).toBe(`Bearer ${taskEnv.TASK_ACTION_TOKEN}`);
    expect(hits[0].body.taskId).toBe(taskId);
  });
});
