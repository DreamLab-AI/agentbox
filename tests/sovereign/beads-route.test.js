'use strict';

/**
 * ADR-043 D4.3 / PRD-021 F3-3 — the /v1/beads REST surface over the beads
 * adapter slot. This exercises the ROUTE's responsibilities — verb dispatch,
 * typed-error → HTTP mapping, and the self-gating 503 — against a fake adapter
 * that mirrors local-sqlite semantics. The local-sqlite adapter itself is
 * covered at the adapter level by tests/contract/beads.contract.spec.js; a fake
 * here keeps the route test free of the native better-sqlite3 build.
 */

const Fastify = require('../../management-api/node_modules/fastify');
const beadsRoutes = require('../../management-api/routes/beads');
const uris = require('../../management-api/lib/uris');
const { NotFound, AlreadyClaimed } = require('../../management-api/adapters/errors');

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const ACTOR = 'a'.repeat(64);

function makeFakeBeads() {
  const store = new Map();
  return {
    _implName: 'local-sqlite',
    enabled: true,
    async createEpic(opts) {
      if (!opts.title) throw new Error('title is required');
      const id = uris.mint({ kind: 'bead', pubkey: opts.actor || ACTOR, payload: { title: opts.title, type: 'epic', n: store.size } });
      const row = { id, title: opts.title, type: 'epic', parent_id: null, status: 'open', actor: opts.actor || null };
      store.set(id, row);
      return row;
    },
    async createChild(opts) {
      if (!opts.title) throw new Error('title is required');
      if (!store.has(opts.parent_id)) throw new NotFound('epic', opts.parent_id);
      const id = uris.mint({ kind: 'bead', pubkey: opts.actor || ACTOR, payload: { title: opts.title, type: 'child', parent: opts.parent_id, n: store.size } });
      const row = { id, title: opts.title, type: 'child', parent_id: opts.parent_id, status: 'open', actor: opts.actor || null };
      store.set(id, row);
      return row;
    },
    async claim(id, actor) {
      const r = store.get(id);
      if (!r) throw new NotFound('bead', id);
      if (r.actor && r.actor !== actor) throw new AlreadyClaimed(id, r.actor);
      r.actor = actor; r.status = 'claimed';
      return r;
    },
    async close(id, outcome) {
      const r = store.get(id);
      if (!r) throw new NotFound('bead', id);
      r.status = 'closed'; r.outcome = outcome;
      return r;
    },
    async getReady(filter = {}) {
      return [...store.values()].filter((r) => r.status === 'open' && !r.actor && (!filter.parent_id || r.parent_id === filter.parent_id));
    },
    async show(id) {
      const r = store.get(id);
      if (!r) throw new NotFound('bead', id);
      return r;
    },
  };
}

function buildApp(adapter) {
  // Mirror server.js: canonical bead URNs (~105 chars) exceed find-my-way's
  // 100-char default param ceiling, so raise it here as the real server does.
  const app = Fastify({ maxParamLength: 512 });
  app.decorate('adapters', { beads: adapter });
  app.register(beadsRoutes, { logger });
  return app;
}

describe('/v1/beads — route over a local-sqlite-shaped adapter', () => {
  let app;
  beforeAll(async () => { app = buildApp(makeFakeBeads()); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it('creates an epic, then a child, then claims and closes it', async () => {
    const epic = (await app.inject({ method: 'POST', url: '/v1/beads/epics', payload: { title: 'session:test', actor: ACTOR, tags: ['aoe-session'] } })).json();
    expect(epic.id).toMatch(/^urn:agentbox:bead:/);
    expect(epic.type).toBe('epic');

    const childRes = await app.inject({ method: 'POST', url: `/v1/beads/${encodeURIComponent(epic.id)}/children`, payload: { title: 'turn 1', actor: ACTOR } });
    expect(childRes.statusCode).toBe(201);
    const child = childRes.json();
    expect(child.parent_id).toBe(epic.id);

    const claimRes = await app.inject({ method: 'POST', url: `/v1/beads/${encodeURIComponent(child.id)}/claim`, payload: { actor: ACTOR } });
    expect(claimRes.statusCode).toBe(200);
    expect(claimRes.json().status).toBe('claimed');

    const closeRes = await app.inject({ method: 'POST', url: `/v1/beads/${encodeURIComponent(child.id)}/close`, payload: { outcome: 'done' } });
    expect(closeRes.statusCode).toBe(200);
    expect(closeRes.json().status).toBe('closed');
  });

  it('lists ready beads', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/beads' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().beads)).toBe(true);
  });

  it('404s an unknown bead', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/beads/urn:agentbox:bead:x:nope' });
    expect(res.statusCode).toBe(404);
  });

  it('409s a claim by a different actor', async () => {
    const epic = (await app.inject({ method: 'POST', url: '/v1/beads/epics', payload: { title: 'contended', actor: ACTOR } })).json();
    await app.inject({ method: 'POST', url: `/v1/beads/${encodeURIComponent(epic.id)}/claim`, payload: { actor: ACTOR } });
    const res = await app.inject({ method: 'POST', url: `/v1/beads/${encodeURIComponent(epic.id)}/claim`, payload: { actor: 'b'.repeat(64) } });
    expect(res.statusCode).toBe(409);
  });
});

describe('/v1/beads — off slot self-gates 503', () => {
  let app;
  beforeAll(async () => { app = buildApp({ _implName: 'off', enabled: false }); await app.ready(); });
  afterAll(async () => { await app.close(); });

  it('returns 503 for list', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/beads' });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toBe('beads disabled');
  });

  it('returns 503 for create', async () => {
    const res = await app.inject({ method: 'POST', url: '/v1/beads/epics', payload: { title: 'x' } });
    expect(res.statusCode).toBe(503);
  });
});
