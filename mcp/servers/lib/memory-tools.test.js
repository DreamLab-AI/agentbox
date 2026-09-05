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

  // ── ADR-2014 closeout (2026-09-05): the searchable-write guarantee ────────
  // The pre-closeout contract ASSERTED the degraded write (embedded:false,
  // stored:true) that the estate review reproduced. The ADR forbids it: the
  // store now either fails closed, or enters an explicit durable repair state.

  await test('ADR-2014 memStore FAILS CLOSED when xinference is unavailable (no row written)', async () => {
    const m = mockPgDeps({ xinfEnsure: async () => false });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memStore('k1', 'hi', 'ns1');
    assert.strictEqual(r.success, false, 'a write that cannot be embedded is not a success');
    assert.strictEqual(r.stored, false);
    assert.strictEqual(r.embedded, false);
    assert.strictEqual(r.reason, 'embedding-unavailable');
    assert.strictEqual(r.storage, 'none');
    assert.match(r.error, /fail-closed/);
    assert.strictEqual(m.queries.length, 0, 'NOTHING may be written when the embedding fails');
    assert.strictEqual(m.flashes.length, 0);
  });

  await test('ADR-2014 memStore FAILS CLOSED when the embedding transport throws', async () => {
    const m = mockPgDeps({ getEmbedding: async () => { throw new Error('xinference 503'); } });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memStore('k1', 'hi', 'ns1');
    assert.strictEqual(r.success, false);
    assert.match(r.error, /xinference 503/);
    assert.strictEqual(m.queries.length, 0);
  });

  await test('ADR-2014 REPLACEMENT never retains the previous value vector (no COALESCE)', async () => {
    const m = mockPgDeps();
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    await t.memStore('k1', 'v2', 'ns1');
    const sql = m.queries[0].sql;
    assert.ok(!/COALESCE\(EXCLUDED\.embedding/.test(sql),
      'the conflict clause must not fall back to the stored vector');
    assert.match(sql, /ON CONFLICT \(id\) DO UPDATE SET value = EXCLUDED\.value(?:, metadata = EXCLUDED\.metadata)?, embedding = EXCLUDED\.embedding/);
  });

  await test('ADR-2014 repair mode writes an EXPLICIT pending row (marker + warning), vector NULL', async () => {
    process.env.RUVECTOR_EMBED_REPAIR = 'true';
    process.env.RUVECTOR_TYPED_METADATA = '1';
    try {
      const m = mockPgDeps({ xinfEnsure: async () => false });
      const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
      const r = await t.memStore('k1', 'hello', 'ns1');
      assert.strictEqual(r.success, true);
      assert.strictEqual(r.stored, true);
      assert.strictEqual(r.embedded, false);
      assert.strictEqual(r.repair_pending, true, 'the caller is told the row is not searchable');
      assert.strictEqual(r.searchable, false);
      assert.strictEqual(r.metadata.embedding_state, 'pending');
      assert.ok(r.metadata.embedding_pending_since, 'pending rows are timestamped for repair');
      assert.strictEqual(r.metadata.value_digest.length, 12, 'the value is bound to a digest');
      // The vector column is written as a literal NULL, so a replacement drops
      // any previously stored vector rather than keeping a stale one.
      assert.match(m.queries[0].sql, /'\{\}'|\$6::jsonb|NULL\)/);
      assert.ok(!/ruvector\(384\)/.test(m.queries[0].sql), 'no vector parameter is bound');
    } finally {
      delete process.env.RUVECTOR_EMBED_REPAIR;
      delete process.env.RUVECTOR_TYPED_METADATA;
    }
  });

  await test('ADR-2014 repair mode carries the pending marker even with typed metadata OFF', async () => {
    process.env.RUVECTOR_EMBED_REPAIR = '1';
    try {
      const m = mockPgDeps({ xinfEnsure: async () => false });
      const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
      const r = await t.memStore('k1', 'hello', 'ns1');
      assert.strictEqual(r.stored, true);
      assert.strictEqual(r.repair_pending, true);
      // metadata is NOT echoed when the typed gate is off, but it IS persisted:
      const meta = JSON.parse(m.queries[0].params[m.queries[0].params.length - 1]);
      assert.strictEqual(meta.embedding_state, 'pending');
    } finally { delete process.env.RUVECTOR_EMBED_REPAIR; }
  });

  await test('ADR-2014 embedded write records the value/vector binding under typed metadata', async () => {
    process.env.RUVECTOR_TYPED_METADATA = '1';
    try {
      const m = mockPgDeps();
      const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
      const r = await t.memStore('k1', 'a searchable value', 'ns1');
      assert.strictEqual(r.embedded, true);
      assert.strictEqual(r.metadata.embedding_state, 'embedded');
      assert.strictEqual(r.metadata.embed_prefix_chars, 2000);
      assert.strictEqual(r.metadata.embed_digest.length, 12);
      assert.ok(r.metadata.embed_model, 'the model that produced the vector is recorded');
    } finally { delete process.env.RUVECTOR_TYPED_METADATA; }
  });

  await test('ADR-2014 memRepairEmbeddings dry_run reports the pending census without writing', async () => {
    const m = mockPgDeps({ queryResult: (sql) => (/count\(\*\)/.test(sql) ? { rows: [{ n: 7 }] } : { rows: [] }) });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memRepairEmbeddings({ dry_run: true });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.pending, 7);
    assert.strictEqual(r.repaired, 0);
    assert.ok(m.queries.every((q) => /count\(\*\)/.test(q.sql)), 'dry run only counts');
  });

  await test('ADR-2014 memRepairEmbeddings repairs a pending row and reports recovery', async () => {
    let pending = 1;
    const m = mockPgDeps({
      queryResult: (sql) => {
        if (/count\(\*\)/.test(sql)) return { rows: [{ n: pending }] };
        if (/^\s*SELECT id, namespace, key, value/.test(sql)) {
          return { rows: [{ id: 'agentbox:ns1:k1', namespace: 'ns1', key: 'k1', value: 'stored text' }] };
        }
        if (/^\s*UPDATE memory_entries/.test(sql)) { pending = 0; return { rowCount: 1, rows: [] }; }
        return { rows: [] };
      },
    });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memRepairEmbeddings({ namespace: 'ns1', limit: 10 });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.repaired, 1);
    assert.strictEqual(r.pending_before, 1);
    assert.strictEqual(r.pending, 0, 'the row is searchable again');
    const upd = m.queries.find((q) => /UPDATE memory_entries/.test(q.sql));
    assert.match(upd.sql, /WHERE id = \$1 AND embedding IS NULL/, 'repair is idempotent');
    assert.match(upd.sql, /'embedding_state', 'embedded'/);
  });

  await test('ADR-2014 memRepairEmbeddings surfaces a failed repair rather than claiming success', async () => {
    const m = mockPgDeps({
      getEmbedding: async () => { throw new Error('embed down'); },
      queryResult: (sql) => {
        if (/count\(\*\)/.test(sql)) return { rows: [{ n: 1 }] };
        if (/^\s*SELECT id, namespace, key, value/.test(sql)) return { rows: [{ id: 'i', namespace: 'n', key: 'k', value: 'v' }] };
        return { rows: [] };
      },
    });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memRepairEmbeddings({});
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.repaired, 0);
    assert.strictEqual(r.failed, 1);
    assert.match(r.failures[0].error, /embed down/);
  });

  await test('ADR-2014 memRepairEmbeddings refuses to run when the embedder is unavailable', async () => {
    const m = mockPgDeps({ xinfEnsure: async () => false, queryResult: () => ({ rows: [{ n: 3 }] }) });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memRepairEmbeddings({});
    assert.strictEqual(r.success, false);
    assert.match(r.error, /xinference unavailable/);
    assert.strictEqual(r.pending, 3);
  });

  // ── ADR-2014 TTL: visibility for BOTH types, deletion by the sweep ─────────
  await test('ADR-2014 TTL — every read path denies expired rows', async () => {
    const m = mockPgDeps();
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    await t.memRetrieve('k', 'ns');
    await t.memList('ns', 10);
    await t.memSearch('q', 'ns', 5);
    const seen = m.queries.map((q) => q.sql);
    for (const sql of seen) {
      assert.match(sql, /expires_at/, `read path must filter expired rows: ${sql.slice(0, 80)}`);
    }
  });

  await test('ADR-2014 TTL — the ILIKE degraded fallback also denies expired rows', async () => {
    const m = mockPgDeps({ xinfEnsure: async () => false });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memSearch('q', 'ns', 5);
    assert.strictEqual(r.method, 'ilike-fallback');
    assert.match(m.queries[0].sql, /expires_at/);
  });

  await test('ADR-2014 TTL — the sweep deletes expired SEMANTIC rows too, not only episodic', async () => {
    const m = mockPgDeps({ queryResult: () => ({ rowCount: 4, rows: [] }) });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memSweepEpisodic(null);
    assert.strictEqual(r.swept, 4);
    assert.deepStrictEqual(r.types.sort(), ['episodic', 'semantic']);
    const sql = m.queries[0].sql;
    assert.ok(!/= 'episodic'/.test(sql), 'the sweep is no longer episodic-only');
    assert.match(sql, /expires_at/);
  });

  await test('ADR-2014 TTL — an explicit types filter narrows the sweep and rejects unknown types', async () => {
    const m = mockPgDeps({ queryResult: () => ({ rowCount: 2, rows: [] }) });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const ok = await t.memSweepEpisodic(null, { types: ['episodic'] });
    assert.strictEqual(ok.success, true);
    assert.deepStrictEqual(ok.types, ['episodic']);
    assert.match(m.queries[0].sql, /memory_type/);
    const bad = await t.memSweepEpisodic(null, { types: ['episodic', 'wat'] });
    assert.strictEqual(bad.success, false);
    assert.match(bad.error, /unknown memory_type/);
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
