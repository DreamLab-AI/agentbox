'use strict';

/**
 * Trajectory persistence goes through the Management API (ADR-2164 amendment).
 *
 * Inside a task the trajectory recorder has TASK_ACTION_TOKEN and TASK_ID and
 * nothing else: no Postgres conninfo, no gate variables. It posts the rows it
 * used to INSERT itself to POST /v1/agent-events/trajectory and the API writes
 * them through the memory adapter's pool. Everything here runs the REAL gate
 * (middleware/auth.js), the REAL route and the REAL recorder as a child process;
 * only the Postgres pool is a recording fake.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');

const Fastify = require('../../management-api/node_modules/fastify');
const { createAuthMiddleware, registerRawBody } = require('../../management-api/middleware/auth');
const agentEventsRoutes = require('../../management-api/routes/agent-events');
const { TaskActionTokenStore } = require('../../management-api/lib/task-action-tokens');

const RECORDER = path.resolve(__dirname, '../../config/hooks/trajectory-recorder.cjs');
const API_KEY = 'operator-key-0123456789abcdef0123456789abcdef';
const TASK = 'urn:agentbox:activity:aaaaaaaaaaaa';
const sha12 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 12);
const squash = (s) => String(s).replace(/\s+/g, ' ').trim();

/** A pg pool double that records every statement and its parameters. */
function fakePool({ hasDuration = true, failOn } = {}) {
  const calls = [];
  const owners = new Map(); // trajectories.id -> metadata (first writer wins, as ON CONFLICT DO NOTHING)
  const run = async (sql, params) => {
    const text = squash(sql);
    calls.push({ sql: text, params });
    if (failOn && failOn.test(text)) throw new Error('db down');
    if (/information_schema/.test(text)) return { rowCount: hasDuration ? 1 : 0, rows: [] };
    if (/^INSERT INTO trajectories /.test(text) && !owners.has(params[0])) owners.set(params[0], JSON.parse(params[3]));
    // B1 ownership read: the task that created the row.
    if (/^SELECT .*FROM trajectories .*FOR UPDATE/.test(text)) {
      const md = owners.get(params[0]);
      return { rowCount: md ? 1 : 0, rows: md ? [{ task_id: md.task_id === undefined ? null : md.task_id }] : [] };
    }
    return { rowCount: 1, rows: [] };
  };
  const client = { query: run, release() {} };
  return {
    calls,
    connect: async () => client,
    query: run,
    writes: () => calls.filter((c) => /^(INSERT|UPDATE)/.test(c.sql)),
  };
}

let store;
let apps = [];

async function buildApp(pool, { withAdapter = true } = {}) {
  const app = Fastify();
  registerRawBody(app);
  const gate = createAuthMiddleware(API_KEY, { authMode: 'hybrid', taskTokens: store });
  app.addHook('preValidation', async (req, reply) => { await gate(req, reply); });
  if (withAdapter) app.decorate('adapters', { memory: { _implName: 'external-pg', _pool: pool } });
  else app.decorate('adapters', { memory: { _implName: 'off' } });
  const logger = { info() {}, debug() {}, error() {}, warn() {} };
  await app.register(agentEventsRoutes, { logger, metrics: null });
  await app.ready();
  apps.push(app);
  return app;
}

beforeEach(() => { store = new TaskActionTokenStore(); });
afterEach(async () => { await Promise.all(apps.map((a) => a.close())); apps = []; });

const TRAJ_ID = 'agentbox:trajectory:abc123abc123';
function payload(over = {}) {
  return {
    trajectory: {
      id: TRAJ_ID,
      task: 'claude-code-session:sess-1',
      agent: 'claude-code',
      metadata: { type: 'trajectory', session: 'sess-1', handoff_id: TRAJ_ID },
    },
    steps: [{
      id: `${TRAJ_ID}:step-82f0e228ad39`,
      action: 'git status [args:1 flags:0]',
      result: { outcome: 'success', signal: 'transcript-is_error', command: 'git status', token_count: 150 },
      quality: 1,
      step_order: 0,
      duration_ms: 1000,
    }],
    rollup: {
      success: true, step_count: 1, mean_quality: 1, outcome: 'success',
      handoff_id: TRAJ_ID, handoff_count: 0, ctc_emit_queued: 1, ctc_emit_carried_in: 0,
    },
    ...over,
  };
}
const post = (app, token, body) => app.inject({
  method: 'POST', url: '/v1/agent-events/trajectory',
  headers: token ? { authorization: `Bearer ${token}` } : {}, payload: body,
});

describe('1. the API persists a posted trajectory in the same row shape the recorder wrote', () => {
  test('a task token posts; trajectories, trajectory_steps and the rollup get the old SQL and parameters', async () => {
    const pool = fakePool();
    const app = await buildApp(pool);
    const r = await post(app, store.mint(TASK), payload());
    expect(r.statusCode).toBe(200);
    expect(r.json().success).toBe(true);

    const [traj, step, roll] = pool.writes();
    expect(traj.sql).toBe(squash(`INSERT INTO trajectories (id, task, agent, status, started_at, metadata)
      VALUES ($1, $2, $3, 'recording', CURRENT_TIMESTAMP, $4::jsonb) ON CONFLICT (id) DO NOTHING`));
    expect(traj.params).toEqual([TRAJ_ID, 'claude-code-session:sess-1', 'claude-code',
      // a token post is stamped with its owner (B1); the operator's is not.
      JSON.stringify({ type: 'trajectory', session: 'sess-1', handoff_id: TRAJ_ID, task_id: TASK })]);

    expect(step.sql).toBe(squash(`INSERT INTO trajectory_steps (id, trajectory_id, action, result, quality, step_order, duration_ms)
      VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`));
    expect(step.params).toEqual([`${TRAJ_ID}:step-82f0e228ad39`, TRAJ_ID, 'git status [args:1 flags:0]',
      JSON.stringify({ outcome: 'success', signal: 'transcript-is_error', command: 'git status', token_count: 150 }), 1, 0, 1000]);

    expect(roll.sql).toMatch(/^UPDATE trajectories SET ended_at = CURRENT_TIMESTAMP, status = 'complete', success = \$2, metadata = COALESCE\(metadata, '\{\}'::jsonb\) \|\| jsonb_build_object\(/);
    expect(roll.sql).toContain("'ctc_emit_carried_in', $9::int) WHERE id = $1");
    expect(roll.params).toEqual([TRAJ_ID, true, 1, 1, 'success', TRAJ_ID, 0, 1, 0]);
  });

  test('without a duration_ms column the duration rides in the result JSON (six-parameter insert)', async () => {
    const pool = fakePool({ hasDuration: false });
    const app = await buildApp(pool);
    expect((await post(app, store.mint(TASK), payload())).statusCode).toBe(200);
    const step = pool.writes()[1];
    expect(step.sql).toBe(squash(`INSERT INTO trajectory_steps (id, trajectory_id, action, result, quality, step_order)
      VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`));
    expect(step.params).toHaveLength(6);
    expect(JSON.parse(step.params[3]).duration_ms).toBe(1000);
  });

  test('the operator key posts too (operator sessions use the same single path)', async () => {
    const pool = fakePool();
    const app = await buildApp(pool);
    expect((await post(app, API_KEY, payload())).statusCode).toBe(200);
    expect(pool.writes()).toHaveLength(3);
  });
});

describe('2. the route fails closed', () => {
  test('no credential, an unknown token and a revoked token are 401 and write nothing', async () => {
    const pool = fakePool();
    const app = await buildApp(pool);
    const revoked = store.mint(TASK);
    store.revokeTask(TASK);
    expect((await post(app, null, payload())).statusCode).toBe(401);
    expect((await post(app, 'not-a-token', payload())).statusCode).toBe(401);
    expect((await post(app, revoked, payload())).statusCode).toBe(401);
    expect(pool.calls).toHaveLength(0);
  });

  test('a step whose id is not under the trajectory id is 400 and nothing is written', async () => {
    const pool = fakePool();
    const app = await buildApp(pool);
    const bad = payload();
    bad.steps[0].id = 'agentbox:trajectory:someone-else:step-1';
    expect((await post(app, store.mint(TASK), bad)).statusCode).toBe(400);
    expect(pool.writes()).toHaveLength(0);
  });

  test('a malformed body is 400', async () => {
    const app = await buildApp(fakePool());
    expect((await post(app, store.mint(TASK), { trajectory: {} })).statusCode).toBe(400);
  });

  test('no external-pg memory adapter is 503, a database error is 500 and rolls back', async () => {
    const off = await buildApp(null, { withAdapter: false });
    expect((await post(off, store.mint(TASK), payload())).statusCode).toBe(503);

    const pool = fakePool({ failOn: /^INSERT INTO trajectory_steps/ });
    const app = await buildApp(pool);
    expect((await post(app, store.mint(TASK), payload())).statusCode).toBe(500);
    expect(pool.calls.map((c) => c.sql)).toContain('ROLLBACK');
    expect(pool.calls.map((c) => c.sql)).not.toContain('COMMIT');
  });
});

// ── the recorder itself, as a child process with a task's environment ──────
const transcriptLines = [
  JSON.stringify({ timestamp: '2026-11-01T10:00:00Z', message: { usage: { input_tokens: 100, output_tokens: 50 }, content: [{ type: 'tool_use', name: 'Bash', id: 'tu-1', input: { command: 'git status' } }] } }),
  JSON.stringify({ timestamp: '2026-11-01T10:00:01Z', toolUseResult: { stderr: '' }, message: { content: [{ type: 'tool_result', tool_use_id: 'tu-1', is_error: false }] } }),
];

function runRecorder({ env, session }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traj-ingest-'));
  const tpath = path.join(dir, 'transcript.jsonl');
  fs.writeFileSync(tpath, transcriptLines.join('\n') + '\n');
  return new Promise((resolve) => {
    const child = spawn('node', [RECORDER, 'Stop'], {
      // Exactly what a task has: nothing about Postgres, no gate variables.
      env: { PATH: process.env.PATH, TMPDIR: dir, ...env },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      const sp = path.join(dir, `agentbox-traj-${sha12(session)}.json`);
      const stash = fs.existsSync(sp) ? JSON.parse(fs.readFileSync(sp, 'utf8')) : null;
      fs.rmSync(dir, { recursive: true, force: true });
      resolve({ code, stderr, stash });
    });
    child.stdin.end(JSON.stringify({ session_id: session, transcript_path: tpath }));
  });
}

async function listen(app) {
  await app.listen({ port: 0, host: '127.0.0.1' });
  return app.server.address().port;
}

describe('3. the recorder in a task persists through the token (no database client, no gates)', () => {
  test('a task env of token + task id + port alone yields the old rows and advances the watermark', async () => {
    const pool = fakePool();
    const app = await buildApp(pool);
    const token = store.mint(TASK);
    const port = await listen(app);
    const session = 'sess-task-ingest';

    const r = await runRecorder({
      session,
      env: { TASK_ACTION_TOKEN: token, TASK_ID: TASK, MANAGEMENT_API_PORT: String(port), AGENTBOX_CTC_EMIT: '0' },
    });
    expect(r.code).toBe(0);

    const id = `agentbox:trajectory:${sha12(session)}`;
    const [traj, step, roll] = pool.writes();
    expect(traj.params[0]).toBe(id);
    expect(traj.params[1]).toBe('claude-code-session:sess-task-in');
    expect(JSON.parse(traj.params[3])).toEqual({ type: 'trajectory', session, handoff_id: id, task_id: TASK });
    expect(step.params[0]).toBe(`${id}:step-${sha12('tu-1')}`);
    expect(step.params[1]).toBe(id);
    expect(step.params[2]).toBe('git status [args:1 flags:0]');
    expect(JSON.parse(step.params[3])).toEqual({
      outcome: 'success', signal: 'transcript-is_error', command: 'git status', token_count: 150,
    });
    expect(step.params.slice(4, 6)).toEqual([1, 0]);
    expect(step.params[6]).toBe(1000);
    expect(roll.params.slice(0, 5)).toEqual([id, true, 1, 1, 'success']);
    expect(r.stash.processedLines).toBeGreaterThan(0);
    expect(r.stash.stepOrder).toBe(1);
  });

  test.each([401, 500])('an API answer of %i leaves the watermark at zero (the lines are retried)', async (status) => {
    const srv = require('http').createServer((req, res) => { req.resume(); req.on('end', () => { res.statusCode = status; res.end('{}'); }); });
    await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
    const session = `sess-api-${status}`;
    const r = await runRecorder({
      session,
      env: { TASK_ACTION_TOKEN: 'tok', TASK_ID: TASK, MANAGEMENT_API_PORT: String(srv.address().port), AGENTBOX_CTC_EMIT: '0' },
    });
    srv.close();
    expect(r.code).toBe(0); // fail-open
    expect(r.stderr).toMatch(/NOT advancing the watermark/);
    expect(Number((r.stash && r.stash.processedLines) || 0)).toBe(0);
  });

  test('with no credential at all it does not advance and does not throw', async () => {
    const r = await runRecorder({ session: 'sess-no-cred', env: { MANAGEMENT_API_PORT: '1', AGENTBOX_CTC_EMIT: '0' } });
    expect(r.code).toBe(0);
    expect(Number((r.stash && r.stash.processedLines) || 0)).toBe(0);
  });
});
