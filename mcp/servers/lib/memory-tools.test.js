'use strict';
/**
 * memory-tools.test.js — shape coverage for the shared memory-tool factory.
 *
 * The repo jest config is rooted at tests/config only, so this file is written
 * to be runnable standalone with plain `node` (no jest required). It asserts
 * the external-pg response shapes (the load-bearing, ADR-015 path) and the
 * delegating backend pass-through, both against mocked backends.
 */

const assert = require('assert');
const { createMemoryTools } = require('./memory-tools');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
}

// ── external-pg mock deps ────────────────────────────────────────────────────
function mockPgDeps(overrides = {}) {
  const queries = [];
  const flashes = [];
  return {
    queries, flashes,
    deps: {
      pool: {
        query: async (sql, params) => {
          queries.push({ sql, params });
          if (overrides.queryResult) return overrides.queryResult(sql, params);
          return { rows: [] };
        },
        options: { host: 'mock', port: 5432, database: 'ruvector' },
      },
      getPgOk: () => (overrides.pgOk !== undefined ? overrides.pgOk : true),
      getEmbedding: overrides.getEmbedding || (async () => new Array(384).fill(0.1)),
      xinfEnsure: overrides.xinfEnsure || (async () => true),
      vecToSql: (arr) => '[' + arr.join(',') + ']',
      entryId: (ns, key) => `agentbox:${ns}:${key}`,
      parseVal: (v) => { if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } } return v; },
      notifyMemoryFlash: (e) => flashes.push(e),
      notifyMemoryFlashBatch: (es) => es.forEach(e => flashes.push(e)),
      log: () => {},
      writeSourceType: 'agentbox',
    },
  };
}

(async () => {
  // ── external-pg: store ──────────────────────────────────────────────────
  await test('external-pg memStore returns load-bearing store shape (embedded=true)', async () => {
    const m = mockPgDeps();
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memStore('k1', 'hello world', 'ns1');
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.action, 'store');
    assert.strictEqual(r.key, 'k1');
    assert.strictEqual(r.namespace, 'ns1');
    assert.strictEqual(r.stored, true);
    assert.strictEqual(r.embedded, true, 'embedding present → embedded true');
    assert.strictEqual(r.storage, 'ruvector-postgres');
    assert.strictEqual(m.flashes.length, 1);
    assert.strictEqual(m.flashes[0].action, 'store');
  });

  await test('external-pg memStore embedded=false when xinference unavailable', async () => {
    const m = mockPgDeps({ xinfEnsure: async () => false });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memStore('k1', 'hi', 'ns1');
    assert.strictEqual(r.embedded, false);
    assert.strictEqual(r.storage, 'ruvector-postgres');
  });

  await test('external-pg memStore fails closed without pg', async () => {
    const m = mockPgDeps({ pgOk: false });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memStore('k', 'v', 'ns');
    assert.deepStrictEqual(r, { success: false, error: 'pg unavailable', storage: 'none' });
  });

  // ── external-pg: retrieve ───────────────────────────────────────────────
  await test('external-pg memRetrieve hit shape', async () => {
    const m = mockPgDeps({ queryResult: () => ({ rows: [{ key: 'k1', value: '{"a":1}', source_type: 'agentbox' }] }) });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memRetrieve('k1', 'ns1');
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.action, 'retrieve');
    assert.strictEqual(r.found, true);
    assert.deepStrictEqual(r.value, { a: 1 });
    assert.strictEqual(r.source_type, 'agentbox');
    assert.strictEqual(r.storage, 'ruvector-postgres');
  });

  await test('external-pg memRetrieve miss shape', async () => {
    const m = mockPgDeps({ queryResult: () => ({ rows: [] }) });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memRetrieve('nope', 'ns1');
    assert.deepStrictEqual(r, { success: true, action: 'retrieve', key: 'nope', namespace: 'ns1', value: null, found: false });
  });

  // ── external-pg: list ───────────────────────────────────────────────────
  await test('external-pg memList shape', async () => {
    const m = mockPgDeps({ queryResult: () => ({ rows: [{ key: 'a', value: 'x', source_type: 'agentbox' }] }) });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memList('ns1', 10);
    assert.strictEqual(r.action, 'list');
    assert.strictEqual(r.count, 1);
    assert.deepStrictEqual(r.entries[0], { key: 'a', value: 'x', source_type: 'agentbox' });
    assert.strictEqual(r.storage, 'ruvector-postgres');
  });

  // ── external-pg: search (hnsw + ilike fallback) ─────────────────────────
  await test('external-pg memSearch hnsw method shape', async () => {
    const m = mockPgDeps({ queryResult: () => ({ rows: [{ key: 'a', value: 'x', namespace: 'ns1', source_type: 'agentbox', score: '0.9' }] }) });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memSearch('query', 'ns1', 5);
    assert.strictEqual(r.action, 'search');
    assert.strictEqual(r.method, 'hnsw-xinference');
    assert.strictEqual(r.storage, 'ruvector-postgres');
    assert.strictEqual(r.results[0].score, 0.9);
    assert.strictEqual(r.count, 1);
  });

  await test('external-pg memSearch ILIKE degraded fallback shape', async () => {
    const m = mockPgDeps({ xinfEnsure: async () => false, queryResult: () => ({ rows: [{ key: 'a', value: 'x', namespace: 'ns1', source_type: 'agentbox', score: 0.5 }] }) });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memSearch('query', 'ns1', 5);
    assert.strictEqual(r.method, 'ilike-fallback');
    assert.strictEqual(r.degraded, true);
    assert.ok(r.warning.includes('Semantic search unavailable'));
    assert.strictEqual(r.results[0].score, 0.5);
  });

  // ── delegating backend pass-through ─────────────────────────────────────
  await test('delegating backend forwards to memoryStore with correct options', async () => {
    const calls = [];
    const memoryStore = {
      store: async (k, v, o) => { calls.push(['store', k, v, o]); return { size: 5, id: 'id1' }; },
      retrieve: async (k, o) => { calls.push(['retrieve', k, o]); return 'val'; },
      list: async (o) => { calls.push(['list', o]); return [{ key: 'a', value: 'b' }]; },
      search: async (q, o) => { calls.push(['search', q, o]); return [{ key: 'a', value: 'b' }]; },
    };
    const t = createMemoryTools({ backend: 'in-memory', deps: { memoryStore } });

    const sr = await t.memStore('k', 'v', 'ns', { ttl: 9, metadata: { x: 1 } });
    assert.deepStrictEqual(sr, { size: 5, id: 'id1' });
    assert.deepStrictEqual(calls[0], ['store', 'k', 'v', { namespace: 'ns', ttl: 9, metadata: { x: 1 } }]);

    assert.strictEqual(await t.memRetrieve('k', 'ns'), 'val');
    assert.deepStrictEqual(calls[1], ['retrieve', 'k', { namespace: 'ns' }]);

    await t.memList('ns', 100);
    assert.deepStrictEqual(calls[2], ['list', { namespace: 'ns', limit: 100 }]);

    await t.memSearch('q', 'ns', 50);
    assert.deepStrictEqual(calls[3], ['search', 'q', { namespace: 'ns', limit: 50 }]);
  });

  await test('factory rejects unknown backend', async () => {
    assert.throws(() => createMemoryTools({ backend: 'bogus', deps: {} }), /unknown backend/);
  });

  console.log(`\n${passed} assertions passed`);
})();
