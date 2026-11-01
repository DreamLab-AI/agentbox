'use strict';

/**
 * The routing-label recorder (ADR-2110) has one write path: the Management API.
 * lib/routing-label-store.js runs the DDL and the parameterised INSERT through
 * the memory adapter's pool (a recording fake here); the recorder holds no
 * database client, no conninfo and no credential but the operator API key.
 */

const fs = require('fs');
const path = require('path');
const {
  persistRoutingLabels, routingLabelPool, RoutingLabelInputError, DDL, MIGRATIONS,
} = require('../../management-api/lib/routing-label-store');

const ROOT = path.resolve(__dirname, '../..');
const row = (id) => ({
  id, session_hash: 'abc', turn_ts: '2026-11-01T00:00:00Z', embed_model: 'bge', embedding: [0.1, 0.2],
  loaded: ['s'], load_via: ['Skill'], label: 's', router_pick: 's', router_model: 'm', router_cascade: null,
  router_margin: 0.5, prompt_chars: 40, bm25_pick: null, bm25_score: null,
});

function fakePool({ failOn } = {}) {
  const calls = [];
  const client = {
    async query(sql, params) {
      calls.push({ sql: String(sql).trim().split(/\s+/).slice(0, 3).join(' '), params });
      if (failOn && String(sql).includes(failOn)) throw new Error('boom');
      return { rows: [], rowCount: 0 };
    },
    release() { calls.push({ sql: 'RELEASE' }); },
  };
  return { calls, async connect() { return client; } };
}

describe('routing-label store', () => {
  test('creates the table, migrates, inserts each row with its parameters, in one transaction', async () => {
    const pool = fakePool();
    const out = await persistRoutingLabels(pool, [row('a'), row('b')]);
    expect(out).toEqual({ rows: 2 });
    const sql = pool.calls.map((c) => c.sql);
    expect(sql[0]).toBe('BEGIN');
    expect(sql[1]).toBe('CREATE TABLE IF');
    expect(sql.filter((s) => s === 'ALTER TABLE routing_labels')).toHaveLength(MIGRATIONS.length);
    const inserts = pool.calls.filter((c) => c.sql.startsWith('INSERT INTO'));
    expect(inserts).toHaveLength(2);
    expect(inserts[0].params).toHaveLength(15);
    expect(inserts[0].params[0]).toBe('a');
    expect(sql.slice(-2)).toEqual(['COMMIT', 'RELEASE']);
    expect(DDL).toMatch(/embedding\s+real\[\] NOT NULL/);
  });

  test('a database error rolls back, releases the client and surfaces the error', async () => {
    const pool = fakePool({ failOn: 'INSERT INTO' });
    await expect(persistRoutingLabels(pool, [row('a')])).rejects.toThrow('boom');
    const sql = pool.calls.map((c) => c.sql);
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
    expect(sql[sql.length - 1]).toBe('RELEASE');
  });

  test('malformed posts are refused before any query', async () => {
    const pool = fakePool();
    await expect(persistRoutingLabels(pool, [])).rejects.toBeInstanceOf(RoutingLabelInputError);
    await expect(persistRoutingLabels(pool, [{ id: 'x', embedding: ['no'] }])).rejects.toBeInstanceOf(RoutingLabelInputError);
    expect(pool.calls).toHaveLength(0);
  });

  test('the pool is the external-pg memory adapter pool, else none', () => {
    expect(routingLabelPool({ memory: { _implName: 'external-pg', _pool: 'p' } })).toBe('p');
    expect(routingLabelPool({ memory: { _implName: 'local-sqlite', _pool: 'p' } })).toBeNull();
    expect(routingLabelPool({})).toBeNull();
  });
});

describe('the recorder has no database path of its own', () => {
  const src = fs.readFileSync(path.join(ROOT, 'config/hooks/routing-label-recorder.cjs'), 'utf8');
  test.each([
    ['pg module', /require\(['"]pg['"]\)|Pg\.Client|loadPg|PG_SEARCH_PATHS/],
    ['conninfo / password', /CONNINFO|RUVECTOR_PG|password/i],
    ['SQL', /INSERT INTO|CREATE TABLE|SELECT /],
  ])('%s', (_n, re) => { expect(src).not.toMatch(re); });

  test('it posts to the route and reads only the operator key', () => {
    expect(src).toContain('/v1/agent-events/routing-label');
    expect(src).toContain('MANAGEMENT_API_KEY');
  });

  test('the route is operator-only: a task token cannot reach it', () => {
    const auth = fs.readFileSync(path.join(ROOT, 'management-api/middleware/auth.js'), 'utf8');
    const set = auth.slice(auth.indexOf('const TASK_TOKEN_ROUTES'), auth.indexOf(']);', auth.indexOf('const TASK_TOKEN_ROUTES')));
    expect(set).not.toContain('routing-label');
    const routes = fs.readFileSync(path.join(ROOT, 'management-api/routes/agent-events.js'), 'utf8');
    expect(routes).toContain("'/v1/agent-events/routing-label'");
  });
});
