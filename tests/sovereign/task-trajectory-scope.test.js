'use strict';

/**
 * A task token may only write trajectories its own task owns (ADR-2164, B1 of
 * the security review). The server never learns a task's session id, so
 * ownership is recorded when the trajectory is created: `metadata.task_id`.
 * A token write to a trajectory owned by another task, or by the operator
 * (no task_id), is 403 and nothing is written. Operator credentials behave as
 * before. Real gate, real route, real store; only the pool is a stateful fake
 * that keeps `trajectories` rows so ownership behaves like the real table.
 */

const Fastify = require('../../management-api/node_modules/fastify');
const { createAuthMiddleware, registerRawBody } = require('../../management-api/middleware/auth');
const agentEventsRoutes = require('../../management-api/routes/agent-events');
const { TaskActionTokenStore } = require('../../management-api/lib/task-action-tokens');

const API_KEY = 'operator-key-0123456789abcdef0123456789abcdef';
const TASK_A = 'urn:agentbox:activity:aaaaaaaaaaaa';
const TASK_B = 'urn:agentbox:activity:bbbbbbbbbbbb';
const squash = (s) => String(s).replace(/\s+/g, ' ').trim();

/** A pg pool double with a tiny `trajectories` table: id -> metadata (first writer wins). */
function statefulPool(seed = {}) {
  const rows = new Map(Object.entries(seed));
  const calls = [];
  const run = async (sql, params) => {
    const text = squash(sql);
    calls.push({ sql: text, params });
    if (/information_schema/.test(text)) return { rowCount: 1, rows: [] };
    if (/^INSERT INTO trajectories /.test(text)) {
      if (!rows.has(params[0])) rows.set(params[0], JSON.parse(params[3]));
      return { rowCount: 1, rows: [] };
    }
    if (/^SELECT .*FROM trajectories .*WHERE id = \$1/.test(text)) {
      const md = rows.get(params[0]);
      return md ? { rowCount: 1, rows: [{ task_id: md.task_id === undefined ? null : md.task_id }] } : { rowCount: 0, rows: [] };
    }
    return { rowCount: 1, rows: [] };
  };
  const client = { query: run, release() {} };
  return {
    rows,
    calls,
    connect: async () => client,
    query: run,
    writes: () => calls.filter((c) => /^(INSERT|UPDATE)/.test(c.sql)),
    stmts: () => calls.map((c) => c.sql.split(' ')[0]),
  };
}

let store;
let apps = [];
async function buildApp(pool) {
  const app = Fastify();
  registerRawBody(app);
  const gate = createAuthMiddleware(API_KEY, { authMode: 'hybrid', taskTokens: store });
  app.addHook('preValidation', async (req, reply) => { await gate(req, reply); });
  app.decorate('adapters', { memory: { _implName: 'external-pg', _pool: pool } });
  const logger = { info() {}, debug() {}, error() {}, warn() {} };
  await app.register(agentEventsRoutes, { logger, metrics: null });
  await app.ready();
  apps.push(app);
  return app;
}
beforeEach(() => { store = new TaskActionTokenStore(); });
afterEach(async () => { await Promise.all(apps.map((a) => a.close())); apps = []; });

function payload(id, over = {}) {
  return {
    trajectory: { id, task: 'claude-code-session:s', agent: 'claude-code', metadata: { type: 'trajectory' } },
    steps: [{ id: `${id}:step-aaaaaaaaaaaa`, action: 'ls', result: {}, quality: 1, step_order: 0, duration_ms: 1 }],
    rollup: { success: true, step_count: 1, mean_quality: 1, outcome: 'success', handoff_id: id,
      handoff_count: 0, ctc_emit_queued: 0, ctc_emit_carried_in: 0 },
    ...over,
  };
}
const post = (app, token, body) => app.inject({
  method: 'POST', url: '/v1/agent-events/trajectory',
  headers: { authorization: `Bearer ${token}` }, payload: body,
});

describe('B1. trajectory ownership', () => {
  test('a new trajectory created by a token is stamped with the token task id', async () => {
    const pool = statefulPool();
    const app = await buildApp(pool);
    expect((await post(app, store.mint(TASK_A), payload('agentbox:trajectory:t1'))).statusCode).toBe(200);
    expect(pool.rows.get('agentbox:trajectory:t1').task_id).toBe(TASK_A);
  });

  test('a token cannot forge the owner through the posted metadata', async () => {
    const pool = statefulPool();
    const app = await buildApp(pool);
    const body = payload('agentbox:trajectory:t2');
    body.trajectory.metadata = { type: 'trajectory', task_id: TASK_B };
    expect((await post(app, store.mint(TASK_A), body)).statusCode).toBe(200);
    expect(pool.rows.get('agentbox:trajectory:t2').task_id).toBe(TASK_A);
  });

  test('the owning task may post again, and may own several trajectories', async () => {
    const pool = statefulPool();
    const app = await buildApp(pool);
    const token = store.mint(TASK_A);
    expect((await post(app, token, payload('agentbox:trajectory:t3'))).statusCode).toBe(200);
    expect((await post(app, token, payload('agentbox:trajectory:t3'))).statusCode).toBe(200);
    expect((await post(app, token, payload('agentbox:trajectory:t4'))).statusCode).toBe(200);
  });

  test('a foreign task owns it: 403 and no step or rollup is written', async () => {
    const pool = statefulPool({ 'agentbox:trajectory:t5': { type: 'trajectory', task_id: TASK_B } });
    const app = await buildApp(pool);
    const r = await post(app, store.mint(TASK_A), payload('agentbox:trajectory:t5'));
    expect(r.statusCode).toBe(403);
    expect(r.json().success).toBe(false);
    expect(pool.writes().some((c) => /^UPDATE/.test(c.sql) || /trajectory_steps/.test(c.sql))).toBe(false);
    expect(pool.stmts()).toContain('ROLLBACK');
    expect(pool.stmts()).not.toContain('COMMIT');
    expect(pool.rows.get('agentbox:trajectory:t5').task_id).toBe(TASK_B);
  });

  test('an operator-owned trajectory (no task_id) is 403 to a token', async () => {
    const pool = statefulPool({ 'agentbox:trajectory:t6': { type: 'trajectory' } });
    const app = await buildApp(pool);
    const r = await post(app, store.mint(TASK_A), payload('agentbox:trajectory:t6'));
    expect(r.statusCode).toBe(403);
    expect(pool.writes().some((c) => /^UPDATE/.test(c.sql) || /trajectory_steps/.test(c.sql))).toBe(false);
  });

  test('operator credentials behave as before: any trajectory, no ownership statement, metadata untouched', async () => {
    const pool = statefulPool({ 'agentbox:trajectory:t7': { type: 'trajectory', task_id: TASK_B } });
    const app = await buildApp(pool);
    expect((await post(app, API_KEY, payload('agentbox:trajectory:t7'))).statusCode).toBe(200);
    expect((await post(app, API_KEY, payload('agentbox:trajectory:t8'))).statusCode).toBe(200);
    expect(pool.calls.some((c) => /FOR UPDATE/.test(c.sql))).toBe(false);
    expect(pool.rows.get('agentbox:trajectory:t8')).toEqual({ type: 'trajectory' });
  });
});
