'use strict';

/**
 * Per-task action token: a Management API task posts its own actions with a
 * short-lived opaque credential, never with MANAGEMENT_API_KEY. Everything runs
 * through the REAL gate (middleware/auth.js, hooked at preValidation exactly as
 * server.js does) and the route's DEFAULT nip98 policy (ADR-2044).
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

jest.mock('child_process', () => ({ spawn: jest.fn() }));
const { spawn } = require('child_process');

const Fastify = require('../../management-api/node_modules/fastify');
const { createAuthMiddleware, registerRawBody } = require('../../management-api/middleware/auth');
const agentEventsRoutes = require('../../management-api/routes/agent-events');
const ProcessManager = require('../../management-api/utils/process-manager');
const { TaskActionTokenStore } = require('../../management-api/lib/task-action-tokens');
const { agentEventPublisher } = require('../../management-api/utils/agent-event-publisher');

const API_KEY = 'operator-key-0123456789abcdef0123456789abcdef';
const TASK_A = 'urn:agentbox:activity:aaaaaaaaaaaa';
const TASK_B = 'urn:agentbox:activity:bbbbbbbbbbbb';
const body = (extra = {}) => ({ source_agent_id: 'coder', target_node_id: 't', action_type: 'query', ...extra });
const bearer = (t) => ({ authorization: `Bearer ${t}` });

let clock;
let store;
let app;
let logged;
let prevPolicy;

function recordingLogger() {
  const mk = (lvl) => (...a) => logged.push([lvl, ...a]);
  return { info: mk('info'), debug: mk('debug'), error: mk('error'), warn: mk('warn') };
}

beforeAll(async () => {
  prevPolicy = process.env.AGENTBOX_AGENT_EVENT_AUTH;
  delete process.env.AGENTBOX_AGENT_EVENT_AUTH; // route default = nip98
  clock = { t: 1_000_000 };
  store = new TaskActionTokenStore({ now: () => clock.t, ttlMs: 60_000 });
  logged = [];
  app = Fastify();
  registerRawBody(app);
  const gate = createAuthMiddleware(API_KEY, { authMode: 'hybrid', taskTokens: store });
  app.addHook('preValidation', async (req, reply) => { await gate(req, reply); });
  app.get('/v1/tasks', async () => ({ ok: true })); // a non-action endpoint
  app.post('/v1/memory', async () => ({ ok: true }));
  await app.register(agentEventsRoutes, { logger: recordingLogger(), metrics: null });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  if (prevPolicy !== undefined) process.env.AGENTBOX_AGENT_EVENT_AUTH = prevPolicy;
});

const emit = (token, payload) => app.inject({ method: 'POST', url: '/v1/agent-events/emit', headers: token ? bearer(token) : {}, payload });

describe('1. the token posts its own task actions', () => {
  test('emit stamps the token task; batch likewise', async () => {
    const token = store.mint(TASK_A);
    const seen = [];
    const off = agentEventPublisher.subscribe((e) => seen.push(e));
    const r1 = await emit(token, body());
    const r2 = await app.inject({ method: 'POST', url: '/v1/agent-events/batch', headers: bearer(token),
      payload: { events: [body(), body({ taskId: TASK_A })] } });
    off();
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(seen).toHaveLength(3);
    for (const e of seen) expect(e.metadata.taskId).toBe(TASK_A);
  });
});

describe('2. other tasks and asserted identities are rejected', () => {
  test('foreign taskId (top-level or metadata) is 403; so is a source_urn', async () => {
    const token = store.mint(TASK_A);
    expect((await emit(token, body({ taskId: TASK_B }))).statusCode).toBe(403);
    expect((await emit(token, body({ metadata: { taskId: TASK_B } }))).statusCode).toBe(403);
    expect((await emit(token, body({ source_urn: 'did:nostr:' + 'a'.repeat(64) }))).statusCode).toBe(403);
  });
  test('one foreign event rejects the whole batch, nothing emitted', async () => {
    const token = store.mint(TASK_A);
    const seen = [];
    const off = agentEventPublisher.subscribe((e) => seen.push(e));
    const r = await app.inject({ method: 'POST', url: '/v1/agent-events/batch', headers: bearer(token),
      payload: { events: [body(), body({ taskId: TASK_B })] } });
    off();
    expect(r.statusCode).toBe(403);
    expect(seen).toHaveLength(0);
  });
});

describe('3. the token is rejected on any non-action endpoint', () => {
  test.each([
    ['GET', '/v1/tasks'],
    ['POST', '/v1/memory'],
    ['GET', '/v1/agent-events'],
    ['GET', '/v1/agent-events/status'],
    ['POST', '/v1/agent-events/hook'],
    ['GET', '/v1/nope'],
  ])('%s %s', async (method, url) => {
    const token = store.mint(TASK_A);
    const r = await app.inject({ method, url, headers: bearer(token), payload: method === 'POST' ? {} : undefined });
    expect([401, 403]).toContain(r.statusCode);
  });
  test('a query string does not widen scope', async () => {
    const token = store.mint(TASK_A);
    const r = await app.inject({ method: 'GET', url: '/v1/tasks?x=/v1/agent-events/emit', headers: bearer(token) });
    expect(r.statusCode).toBe(403);
  });
});

describe('4. revoked / expired / unknown / missing tokens fail closed', () => {
  test('revoked on task exit', async () => {
    const token = store.mint(TASK_A);
    expect((await emit(token, body())).statusCode).toBe(200);
    store.revokeTask(TASK_A);
    expect((await emit(token, body())).statusCode).toBe(401);
  });
  test('expired after TTL', async () => {
    const token = store.mint(TASK_A);
    clock.t += 59_999;
    expect((await emit(token, body())).statusCode).toBe(200);
    clock.t += 2;
    expect((await emit(token, body())).statusCode).toBe(401);
  });
  test('unknown and missing', async () => {
    expect((await emit('x'.repeat(43), body())).statusCode).toBe(401);
    expect((await emit(null, body())).statusCode).toBe(401);
  });
});

describe('5/6. process manager: env and logs', () => {
  let tmp;
  let pm;
  let pmLogs;
  let pmStore;
  let prevEnv;
  const spawned = [];
  function fakeChild() {
    const c = new EventEmitter();
    c.pid = 4242;
    c.stdout = { pipe() {} };
    c.stderr = { pipe() {} };
    c.unref = () => {};
    return c;
  }
  beforeEach(() => {
    prevEnv = { ...process.env };
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tat-'));
    process.env.WORKSPACE = tmp;
    process.env.PROCESS_MANAGER_LOGS_DIR = path.join(tmp, 'logs');
    process.env.MANAGEMENT_API_KEY = API_KEY;
    process.env.ZAI_ENABLED = 'true';
    process.env.ZAI_CONTAINER_URL = 'http://zai.invalid';
    pmLogs = [];
    const mk = (lvl) => (...a) => pmLogs.push([lvl, ...a]);
    pmStore = new TaskActionTokenStore();
    pm = new ProcessManager({ info: mk('i'), warn: mk('w'), error: mk('e'), debug: mk('d') }, { taskTokens: pmStore });
    spawn.mockReset();
    spawn.mockImplementation((cmd, args, opts) => { const c = fakeChild(); spawned.push({ cmd, args, opts, c }); return c; });
  });
  afterEach(async () => {
    await new Promise((r) => setTimeout(r, 25)); // let the async log-stream opens settle
    process.env = prevEnv;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test.each(['gemini', 'claude-flow'])('child env (%s) carries the token and never the API key', (provider) => {
    const info = pm.spawnTask('coder', 'do the thing', provider);
    const { opts } = spawned[spawned.length - 1];
    expect(opts.env.TASK_ID).toBe(info.taskId);
    expect(typeof opts.env.TASK_ACTION_TOKEN).toBe('string');
    expect(Buffer.from(opts.env.TASK_ACTION_TOKEN, 'base64url').length).toBeGreaterThanOrEqual(32);
    expect(opts.env).not.toHaveProperty('MANAGEMENT_API_KEY');
    expect(JSON.stringify(opts)).not.toContain(API_KEY);
    expect(pmStore.verify(opts.env.TASK_ACTION_TOKEN)).toEqual({ taskId: info.taskId });
  });

  test('exit, error and stopTask each revoke', () => {
    const tokenOf = () => spawned[spawned.length - 1].opts.env.TASK_ACTION_TOKEN;
    pm.spawnTask('a', 'x', 'gemini');
    spawned[spawned.length - 1].c.emit('exit', 0, null);
    expect(pmStore.verify(tokenOf())).toBeNull();

    pm.spawnTask('a', 'x', 'gemini');
    spawned[spawned.length - 1].c.emit('error', new Error('ENOENT'));
    expect(pmStore.verify(tokenOf())).toBeNull();

    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    jest.useFakeTimers();
    const info = pm.spawnTask('a', 'x', 'gemini');
    expect(pmStore.verify(tokenOf())).not.toBeNull();
    pm.stopTask(info.taskId);
    expect(pmStore.verify(tokenOf())).toBeNull();
    jest.useRealTimers();
    kill.mockRestore();
  });

  test('a spawn that throws leaves no live token', () => {
    spawn.mockImplementation(() => { throw new Error('boom'); });
    expect(() => pm.spawnTask('a', 'x', 'gemini')).toThrow('boom');
    expect(pmStore.size).toBe(0);
  });

  test('the token never appears in any logger call or response body', async () => {
    const info = pm.spawnTask('coder', 'do the thing', 'gemini');
    const token = spawned[spawned.length - 1].opts.env.TASK_ACTION_TOKEN;
    spawned[spawned.length - 1].c.emit('exit', 1, null);
    // And through the HTTP gate: same token via the shared store, hit good and bad routes.
    const t2 = store.mint(TASK_A);
    const responses = [
      await emit(t2, body()),
      await app.inject({ method: 'GET', url: '/v1/tasks', headers: bearer(t2) }),
      await emit(t2 + 'x', body()),
    ];
    const haystack = JSON.stringify([pmLogs, logged, responses.map((r) => r.body)]);
    expect(haystack).not.toContain(token);
    expect(haystack).not.toContain(t2);
    expect(info.taskId).toBeTruthy();
  });
});
