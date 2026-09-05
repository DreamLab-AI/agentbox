'use strict';

/**
 * ADR-2072 (closes VisionClaw ADR-2085) — the /v1/briefs briefing workflow
 * surface. This exercises the ROUTE's responsibilities: the exact wire contract
 * VisionClaw's `ManagementApiClient` speaks, durable brief records round-tripped
 * through the pods adapter slot, ADR-013 minted identifiers, the ADR-2041
 * action-plane gate on the execute step, and the pods self-gating 503.
 *
 * Fakes stand in for the pods/beads adapters (mirroring local-solid-rs and
 * local-sqlite semantics) so the route test needs neither a live JSS nor the
 * native better-sqlite3 build — the adapters themselves are covered at the
 * adapter level by tests/contract/{pods,beads}.contract.spec.js.
 *
 * The action plane is stubbed at the `lib/action-plane` module boundary: this
 * suite asserts the route's CONTRACT with that seam (fail-closed on !ready,
 * 403 on denied, taskId propagation on allow), not the pipeline internals,
 * which are ADR-059's own tests.
 *
 * Contract nuance under test (ADR-2085 §Acceptance test): response ENVELOPES
 * are camelCase (`briefId`, `roleTasks`, `debriefPath`) but the `RoleTask`
 * elements inside `roleTasks` are snake_case (`task_id`, `bead_id`,
 * `response_path`), because the Rust `RoleTask` struct carries no
 * `#[serde(rename_all)]` while its enclosing response struct does. Fastify
 * strips response properties absent from the schema, so getting this wrong
 * silently empties the field on the client — hence the explicit assertions.
 */

const Fastify = require('../../management-api/node_modules/fastify');
const { NotFound } = require('../../management-api/adapters/errors');

// The action plane is replaced wholesale: the route must be provably gated by
// it without this suite depending on a live events adapter or a real spawn.
jest.mock('../../management-api/lib/action-plane', () => ({
  dispatchTaskSpawn: jest.fn(),
}));
const { dispatchTaskSpawn } = require('../../management-api/lib/action-plane');

const briefingRoutes = require('../../management-api/routes/briefing');

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const PUBKEY = 'b'.repeat(64);

const USER_CONTEXT = {
  user_id: 'user-1',
  pubkey: PUBKEY,
  display_name: 'Test Operator',
  session_id: 'session-1',
  is_power_user: true,
};

/** A pods adapter with local-solid-rs-shaped write/read semantics. */
function makeFakePods(implName = 'local-solid-rs') {
  const store = new Map();
  return {
    _implName: implName,
    store,
    async write(uri, body, contentType) {
      store.set(uri, { body, contentType });
      return { uri, status: 201, created_at: new Date().toISOString() };
    },
    async read(uri) {
      const r = store.get(uri);
      if (!r) throw new NotFound('pod resource', uri);
      return { uri, body: r.body, contentType: r.contentType };
    },
    async patch() { throw new Error('not used'); },
    async del() { throw new Error('not used'); },
    async list() { throw new Error('not used'); },
  };
}

/** A beads adapter with local-sqlite-shaped createEpic/createChild/close. */
function makeFakeBeads() {
  const rows = new Map();
  let n = 0;
  return {
    _implName: 'local-sqlite',
    rows,
    async createEpic(opts) {
      const id = `urn:agentbox:bead:${PUBKEY}:sha256-12-epic${n++}`;
      rows.set(id, { id, title: opts.title, type: 'epic', status: 'open' });
      return rows.get(id);
    },
    async createChild(opts) {
      if (!rows.has(opts.parent_id)) throw new NotFound('epic', opts.parent_id);
      const id = `urn:agentbox:bead:${PUBKEY}:sha256-12-chld${n++}`;
      rows.set(id, { id, title: opts.title, type: 'child', parent_id: opts.parent_id, status: 'open' });
      return rows.get(id);
    },
    async close(id, outcome) {
      const r = rows.get(id);
      if (!r) throw new NotFound('bead', id);
      r.status = 'closed';
      r.outcome = outcome;
      return r;
    },
  };
}

/** An adapter slot resolved "off" — every call raises, `_implName` says so. */
function makeOffSlot(slot) {
  const raise = async () => {
    const e = new Error(`${slot} adapter is disabled`);
    e.name = 'AdapterDisabled';
    throw e;
  };
  return { _implName: 'off', write: raise, read: raise, createEpic: raise, createChild: raise, close: raise };
}

function buildApp({ pods, beads, processManager } = {}) {
  // Mirror server.js: brief URNs exceed find-my-way's 100-char default param
  // ceiling, so raise it here exactly as the real server does (server.js:91).
  const app = Fastify({ maxParamLength: 512, logger: false });
  app.decorate('adapters', { pods: pods || makeFakePods(), beads: beads || makeFakeBeads() });
  app.register(briefingRoutes, { logger, processManager: processManager || {} });
  return app;
}

/** The pipeline allowed the spawn and the executor returned a task. */
function allowSpawn(taskIdPrefix = 'task') {
  let i = 0;
  dispatchTaskSpawn.mockImplementation(async () => ({
    ready: true,
    decision: 'allow',
    output: { taskId: `${taskIdPrefix}-${i++}`, taskDir: '/tmp/t', logFile: '/tmp/t.log' },
    journalEventId: 'evt-1',
  }));
}

beforeEach(() => {
  dispatchTaskSpawn.mockReset();
});

describe('/v1/briefs — the full brief → execute → debrief cycle', () => {
  let app;
  let pods;
  let beads;

  beforeEach(async () => {
    pods = makeFakePods();
    beads = makeFakeBeads();
    app = buildApp({ pods, beads });
    await app.ready();
  });
  afterEach(async () => { if (app) await app.close(); });

  it('round-trips one brief id through all three endpoints', async () => {
    allowSpawn();

    // ── 1. create ──────────────────────────────────────────────────────────
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/briefs',
      payload: {
        content: 'Assess the interaction plane rebuild risk.',
        roles: ['architect', 'reviewer'],
        user_context: USER_CONTEXT,
        version: '2',
        brief_type: 'assessment',
        slug: 'rebuild-risk',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const brief = createRes.json();

    // camelCase envelope, exactly the fields BriefResponse deserialises.
    expect(Object.keys(brief).sort()).toEqual(['beadId', 'briefId', 'briefPath']);
    expect(brief.briefId).toMatch(/^urn:agentbox:thing:[0-9a-f]{64}:brief-\d{4}-\d{2}-\d{2}-rebuild-risk-[0-9a-f]{8}$/);
    expect(brief.briefPath).toMatch(/^\/briefs\/\d{4}-\d{2}-\d{2}\/rebuild-risk-[0-9a-f]{8}\/brief\.md$/);
    expect(brief.beadId).toMatch(/^urn:agentbox:bead:/);

    // The brief document really landed in the pod, with its content intact.
    const doc = pods.store.get(brief.briefPath);
    expect(doc.contentType).toBe('text/markdown');
    expect(doc.body).toContain('Assess the interaction plane rebuild risk.');
    expect(doc.body).toContain(`brief_id: ${brief.briefId}`);
    expect(doc.body).toContain('brief_type: assessment');

    // ── 2. execute ─────────────────────────────────────────────────────────
    const execRes = await app.inject({
      method: 'POST',
      url: `/v1/briefs/${encodeURIComponent(brief.briefId)}/execute`,
      payload: {
        brief_path: brief.briefPath,
        roles: ['architect', 'reviewer'],
        user_context: USER_CONTEXT,
        epic_bead_id: brief.beadId,
      },
    });
    expect(execRes.statusCode).toBe(202);
    const exec = execRes.json();

    expect(exec.briefId).toBe(brief.briefId);
    expect(exec.roleTasks).toHaveLength(2);

    // RoleTask fields are snake_case (no rename_all on the Rust struct) —
    // if the response schema camelCased them, fastify would strip these.
    const [architect, reviewer] = exec.roleTasks;
    expect(Object.keys(architect).sort()).toEqual(['bead_id', 'response_path', 'role', 'task_id']);
    expect(architect.role).toBe('architect');
    expect(architect.task_id).toBe('task-0');
    expect(architect.bead_id).toMatch(/^urn:agentbox:bead:/);
    expect(architect.response_path).toBe(`${brief.briefPath.replace(/brief\.md$/, '')}responses/architect.md`);
    expect(reviewer.task_id).toBe('task-1');

    // One action-plane dispatch per role — the spawn never bypasses the seam.
    expect(dispatchTaskSpawn).toHaveBeenCalledTimes(2);
    expect(dispatchTaskSpawn.mock.calls[0][0]).toMatchObject({ agent: 'architect', provider: 'claude-flow' });
    expect(dispatchTaskSpawn.mock.calls[0][0].task).toContain(brief.briefPath);
    expect(dispatchTaskSpawn.mock.calls[0][0].task).toContain(architect.response_path);

    // ── 3. debrief ─────────────────────────────────────────────────────────
    const debriefRes = await app.inject({
      method: 'POST',
      url: `/v1/briefs/${encodeURIComponent(brief.briefId)}/debrief`,
      payload: {
        role_responses: [
          { role: 'architect', responsePath: architect.response_path, taskId: architect.task_id, status: 'completed' },
          { role: 'reviewer', responsePath: reviewer.response_path, taskId: reviewer.task_id, status: 'pending' },
        ],
        user_context: USER_CONTEXT,
      },
    });
    expect(debriefRes.statusCode).toBe(201);
    const debrief = debriefRes.json();
    expect(Object.keys(debrief)).toEqual(['debriefPath']);
    expect(debrief.debriefPath).toBe(brief.briefPath.replace(/brief\.md$/, 'debrief.md'));

    // The debrief is honest about the role that had not finished.
    const debriefDoc = pods.store.get(debrief.debriefPath);
    expect(debriefDoc.body).toContain('roles_completed: 1');
    expect(debriefDoc.body).toContain('| architect | completed |');
    expect(debriefDoc.body).toContain('had not completed when this debrief was consolidated: reviewer');

    // The epic was closed, and closed as partial because a role was pending.
    expect(beads.rows.get(brief.beadId).status).toBe('closed');
    expect(beads.rows.get(brief.beadId).outcome).toBe('debriefed-partial');
  });

  it('survives a management-api restart between the three calls (record is durable, not in-memory)', async () => {
    allowSpawn();
    const brief = (await app.inject({
      method: 'POST',
      url: '/v1/briefs',
      payload: { content: 'durable', roles: ['coder'], user_context: USER_CONTEXT },
    })).json();

    // Rebuild the app around the SAME pod store — a fresh process, no shared
    // route-module state. execute must still resolve the brief.
    await app.close();
    app = buildApp({ pods, beads });
    await app.ready();

    const execRes = await app.inject({
      method: 'POST',
      url: `/v1/briefs/${encodeURIComponent(brief.briefId)}/execute`,
      payload: { brief_path: brief.briefPath, roles: ['coder'], user_context: USER_CONTEXT },
    });
    expect(execRes.statusCode).toBe(202);
    expect(execRes.json().roleTasks[0].role).toBe('coder');
  });

  it('mints an unscoped brief URN when no usable pubkey is supplied (no fabricated scope)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/briefs',
      payload: {
        content: 'anonymous brief',
        roles: ['coder'],
        user_context: { user_id: 'u', pubkey: 'not-a-pubkey', display_name: 'x', session_id: 's', is_power_user: false },
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().briefId).toMatch(/^urn:agentbox:thing:brief-/);
  });

  it('404s execute and debrief for an unknown brief id', async () => {
    const unknown = encodeURIComponent('urn:agentbox:thing:brief-2026-01-01-nope-deadbeef');
    const execRes = await app.inject({
      method: 'POST',
      url: `/v1/briefs/${unknown}/execute`,
      payload: { brief_path: '/briefs/x/brief.md', roles: ['coder'], user_context: USER_CONTEXT },
    });
    expect(execRes.statusCode).toBe(404);

    const debriefRes = await app.inject({
      method: 'POST',
      url: `/v1/briefs/${unknown}/debrief`,
      payload: { role_responses: [], user_context: USER_CONTEXT },
    });
    expect(debriefRes.statusCode).toBe(404);
    expect(dispatchTaskSpawn).not.toHaveBeenCalled();
  });

  it('400s a create missing required fields', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/briefs', payload: { roles: ['coder'] } });
    expect(res.statusCode).toBe(400);
  });
});

describe('/v1/briefs — action-plane gating on the execute step (ADR-2041)', () => {
  let app;
  let pods;

  async function createBrief() {
    return (await app.inject({
      method: 'POST',
      url: '/v1/briefs',
      payload: { content: 'gated', roles: ['coder'], user_context: USER_CONTEXT },
    })).json();
  }

  beforeEach(async () => {
    pods = makeFakePods();
    app = buildApp({ pods });
    await app.ready();
  });
  afterEach(async () => { if (app) await app.close(); });

  it('fails CLOSED with 503 when the action plane has no live events adapter', async () => {
    allowSpawn();
    const brief = await createBrief();

    dispatchTaskSpawn.mockResolvedValue({ ready: false, reason: 'events adapter is not live (impl=off)' });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/briefs/${encodeURIComponent(brief.briefId)}/execute`,
      payload: { brief_path: brief.briefPath, roles: ['coder'], user_context: USER_CONTEXT },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().details).toMatch(/events adapter is not live/);
  });

  it('403s when the pipeline denies the role spawn', async () => {
    allowSpawn();
    const brief = await createBrief();

    dispatchTaskSpawn.mockResolvedValue({ ready: true, decision: 'denied', denyReason: 'policy: no spawns' });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/briefs/${encodeURIComponent(brief.briefId)}/execute`,
      payload: { brief_path: brief.briefPath, roles: ['coder'], user_context: USER_CONTEXT },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().reason).toBe('policy: no spawns');
  });
});

describe('/v1/briefs — degraded slots', () => {
  it('self-gates 503 on every endpoint when the pods slot is "off"', async () => {
    const app = buildApp({ pods: makeOffSlot('pods') });
    await app.ready();

    for (const [url, payload] of [
      ['/v1/briefs', { content: 'x', roles: ['coder'], user_context: USER_CONTEXT }],
      ['/v1/briefs/urn:agentbox:thing:brief-a/execute', { brief_path: '/p', roles: ['coder'], user_context: USER_CONTEXT }],
      ['/v1/briefs/urn:agentbox:thing:brief-a/debrief', { role_responses: [], user_context: USER_CONTEXT }],
    ]) {
      const res = await app.inject({ method: 'POST', url, payload });
      expect(res.statusCode).toBe(503);
      expect(res.json().error).toBe('briefing disabled');
    }
    await app.close();
  });

  it('degrades beadId to null when the beads slot is "off" — the brief still lands', async () => {
    const pods = makeFakePods();
    const app = buildApp({ pods, beads: makeOffSlot('beads') });
    await app.ready();

    const res = await app.inject({
      method: 'POST',
      url: '/v1/briefs',
      payload: { content: 'no ledger', roles: ['coder'], user_context: USER_CONTEXT },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().beadId).toBeNull();
    expect(pods.store.has(res.json().briefPath)).toBe(true);
    await app.close();
  });

  it('keeps spawning role agents when a child bead cannot be opened', async () => {
    allowSpawn();
    const beads = makeFakeBeads();
    const app = buildApp({ beads });
    await app.ready();

    const brief = (await app.inject({
      method: 'POST',
      url: '/v1/briefs',
      payload: { content: 'ledger wobble', roles: ['coder'], user_context: USER_CONTEXT },
    })).json();

    beads.createChild = async () => { throw new Error('ledger unavailable'); };
    const res = await app.inject({
      method: 'POST',
      url: `/v1/briefs/${encodeURIComponent(brief.briefId)}/execute`,
      payload: { brief_path: brief.briefPath, roles: ['coder'], user_context: USER_CONTEXT, epic_bead_id: brief.beadId },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().roleTasks[0].bead_id).toBeNull();
    expect(res.json().roleTasks[0].task_id).toBe('task-0');
    await app.close();
  });
});
