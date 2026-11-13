'use strict';
/**
 * memory-reads.test.js — ADR-2201 clause 9. Standalone (`node`). Reads are
 * counted in a side table, never by updating memory_entries (a non-HOT update
 * there inserts into the HNSW index), and the recorder can never fail or delay
 * the read it observes.
 */

const assert = require('assert');
const { createReadRecorder, READS_TABLE } = require('./memory-reads');
const { createMemoryTools } = require('./memory-tools');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
}

function mockPool(overrides = {}) {
  const queries = [];
  return {
    queries,
    pool: {
      query: async (sql, params) => {
        queries.push({ sql, params });
        if (overrides.fail && overrides.fail(sql)) throw new Error('boom');
        if (/SELECT key, value, source_type/.test(sql)) return { rows: [{ key: 'k', value: 'v', source_type: 'agentbox', evidence: null, evidence_state: null }] };
        return { rows: [], rowCount: 1 };
      },
    },
  };
}

function withGate(on, fn) {
  return async () => {
    const before = process.env.RUVECTOR_READ_COUNTS;
    if (on) process.env.RUVECTOR_READ_COUNTS = 'true'; else delete process.env.RUVECTOR_READ_COUNTS;
    try { await fn(); } finally {
      if (before === undefined) delete process.env.RUVECTOR_READ_COUNTS; else process.env.RUVECTOR_READ_COUNTS = before;
    }
  };
}

function toolDeps(pool) {
  return {
    pool, getPgOk: () => true, getEmbedding: async () => new Array(384).fill(0.1), xinfEnsure: async () => true,
    vecToSql: (a) => '[' + a.join(',') + ']', entryId: (ns, k) => `agentbox:${ns}:${k}`, parseVal: (v) => v,
    notifyMemoryFlash: () => {}, notifyMemoryFlashBatch: () => {}, log: () => {}, writeSourceType: 'agentbox',
  };
}

(async () => {
  await test('gate off: record issues no query at all', withGate(false, async () => {
    const m = mockPool();
    const rec = createReadRecorder({ pool: m.pool, log: () => {} });
    await rec.record([{ namespace: 'ns', key: 'k' }], 'retrieve');
    assert.strictEqual(m.queries.length, 0);
  }));

  await test('gate on: the table is created once, then reads are upserted', withGate(true, async () => {
    const m = mockPool();
    const rec = createReadRecorder({ pool: m.pool, log: () => {} });
    await rec.record([{ namespace: 'ns', key: 'k' }], 'retrieve');
    await rec.record([{ namespace: 'ns', key: 'k2' }], 'search_hit');
    const ddl = m.queries.filter((q) => /CREATE TABLE IF NOT EXISTS/.test(q.sql));
    assert.strictEqual(ddl.length, 1);
    assert.ok(ddl[0].sql.includes(READS_TABLE));
    const ups = m.queries.filter((q) => /INSERT INTO/.test(q.sql));
    assert.strictEqual(ups.length, 2);
    assert.match(ups[0].sql, /ON CONFLICT \(namespace, key, action\) DO UPDATE SET n = /);
    assert.deepStrictEqual(ups[0].params, [['ns'], ['k'], 'retrieve']);
  }));

  await test('gate on: reads never touch memory_entries', withGate(true, async () => {
    const m = mockPool();
    const rec = createReadRecorder({ pool: m.pool, log: () => {} });
    await rec.record([{ namespace: 'ns', key: 'k' }], 'retrieve');
    assert.ok(m.queries.every((q) => !/UPDATE\s+memory_entries|INSERT INTO\s+memory_entries/.test(q.sql)));
  }));

  await test('gate on: duplicates in one batch are collapsed (ON CONFLICT cannot hit a row twice)', withGate(true, async () => {
    const m = mockPool();
    const rec = createReadRecorder({ pool: m.pool, log: () => {} });
    await rec.record([{ namespace: 'a', key: 'k' }, { namespace: 'a', key: 'k' }, { namespace: 'b', key: 'k' }, { key: 'no-namespace' }], 'search_hit');
    const up = m.queries.find((q) => /INSERT INTO/.test(q.sql));
    assert.deepStrictEqual(up.params, [['a', 'b'], ['k', 'k'], 'search_hit']);
  }));

  await test('gate on: an unknown action is refused without a query', withGate(true, async () => {
    const m = mockPool();
    const rec = createReadRecorder({ pool: m.pool, log: () => {} });
    await rec.record([{ namespace: 'a', key: 'k' }], 'DROP TABLE');
    assert.strictEqual(m.queries.length, 0);
  }));

  await test('gate on: a failing store never throws to the reader (fail-open)', withGate(true, async () => {
    const logs = [];
    const m = mockPool({ fail: () => true });
    const rec = createReadRecorder({ pool: m.pool, log: (lvl, msg) => logs.push(msg) });
    await rec.record([{ namespace: 'a', key: 'k' }], 'retrieve');
    assert.ok(logs.length >= 1);
  }));

  await test('gate on: forget removes every counter for the entry', withGate(true, async () => {
    const m = mockPool();
    const rec = createReadRecorder({ pool: m.pool, log: () => {} });
    await rec.forget('ns', 'k');
    const del = m.queries.find((q) => /DELETE FROM/.test(q.sql));
    assert.ok(del.sql.includes(READS_TABLE));
    assert.deepStrictEqual(del.params, ['ns', 'k']);
  }));

  await test('gate on: pairs are written in sorted order (no cross-process deadlock on the upsert)', withGate(true, async () => {
    const m = mockPool();
    const rec = createReadRecorder({ pool: m.pool, log: () => {} });
    await rec.record([{ namespace: 'b', key: 'z' }, { namespace: 'a', key: 'y' }, { namespace: 'a', key: 'x' }], 'search_hit');
    const up = m.queries.find((q) => /INSERT INTO/.test(q.sql));
    assert.deepStrictEqual(up.params, [['a', 'a', 'b'], ['x', 'y', 'z'], 'search_hit']);
  }));

  await test('gate on: a role that cannot create the table backs off instead of retrying on every read', withGate(true, async () => {
    const logs = [];
    const m = mockPool({ fail: (sql) => /CREATE TABLE/.test(sql) });
    const rec = createReadRecorder({ pool: m.pool, log: (lvl, msg) => logs.push(msg) });
    for (let i = 0; i < 20; i++) await rec.record([{ namespace: 'a', key: `k${i}` }], 'retrieve');
    assert.strictEqual(m.queries.length, 1, 'one failed CREATE TABLE, then silence');
    assert.strictEqual(logs.length, 1);
  }));

  await test('gate on: a hung store cannot grow the queue without bound', withGate(true, async () => {
    const queries = [];
    const pool = { query: (sql) => { queries.push(sql); return new Promise(() => {}); } };   // never settles
    const rec = createReadRecorder({ pool, log: () => {} });
    for (let i = 0; i < 5000; i++) void rec.record([{ namespace: 'a', key: `k${i}` }], 'retrieve');
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(queries.length, 1, 'only the hung statement was issued');
    assert.ok(rec.stats().pending <= rec.stats().max_pending);
    assert.ok(rec.stats().dropped >= 5000 - rec.stats().max_pending);
  }));

  // ── integration with the memory tools ─────────────────────────────────────
  await test('memRetrieve of a found row records one retrieve; the response is unchanged', withGate(true, async () => {
    const m = mockPool();
    const t = createMemoryTools({ backend: 'external-pg', deps: toolDeps(m.pool) });
    const r = await t.memRetrieve('k', 'ns');
    await t.memReadsIdle();
    assert.deepStrictEqual(Object.keys(r).sort(), ['action', 'found', 'key', 'namespace', 'source_type', 'storage', 'success', 'value']);
    const up = m.queries.find((q) => /INSERT INTO/.test(q.sql) && q.sql.includes(READS_TABLE));
    assert.deepStrictEqual(up.params, [['ns'], ['k'], 'retrieve']);
  }));

  await test('memRetrieve still answers when the recorder fails', withGate(true, async () => {
    const m = mockPool({ fail: (sql) => sql.includes(READS_TABLE) });
    const t = createMemoryTools({ backend: 'external-pg', deps: toolDeps(m.pool) });
    const r = await t.memRetrieve('k', 'ns');
    await t.memReadsIdle();
    assert.strictEqual(r.found, true);
  }));

  await test('memDelete forgets the counters of the deleted entry', withGate(true, async () => {
    const m = mockPool();
    const t = createMemoryTools({ backend: 'external-pg', deps: toolDeps(m.pool) });
    await t.memDelete('k', 'ns');
    await t.memReadsIdle();
    assert.ok(m.queries.some((q) => /DELETE FROM/.test(q.sql) && q.sql.includes(READS_TABLE)));
  }));

  await test('gate off: memRetrieve issues exactly its one SELECT', withGate(false, async () => {
    const m = mockPool();
    const t = createMemoryTools({ backend: 'external-pg', deps: toolDeps(m.pool) });
    await t.memRetrieve('k', 'ns');
    await t.memReadsIdle();
    assert.strictEqual(m.queries.length, 1);
  }));

  console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
})();
