'use strict';
/**
 * memory-hybrid.test.js — reciprocal rank fusion (RUVECTOR_HYBRID_FUSION=rrf)
 * and its wiring into memHybridSearch. Standalone `node` runner, no DB: the
 * pool is a recording fake. The default (unset) path must be untouched.
 */
const assert = require('assert');
const { createHybridTools, fuseRrf, RRF_K } = require('./memory-hybrid');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.stack || e.message}`); process.exitCode = 1; }
}
const ids = (xs) => xs.map((x) => x.id);

function mk(fakeRows, env) {
  const queries = [];
  const saved = process.env.RUVECTOR_HYBRID_FUSION;
  if (env === undefined) delete process.env.RUVECTOR_HYBRID_FUSION; else process.env.RUVECTOR_HYBRID_FUSION = env;
  const tools = createHybridTools({
    pool: { query: async (sql, params) => { queries.push({ sql, params }); return { rows: fakeRows(sql, params) }; } },
    getPgOk: () => true,
    getEmbedding: async () => new Array(384).fill(0.1),
    xinfEnsure: async () => true,
    vecToSql: (a) => '[' + a.join(',') + ']',
    parseVal: (v) => v,
    log: () => {},
    memSearch: async () => ({ success: true, results: [], degraded_from: undefined }),
  });
  return { tools, queries, restore: () => { if (saved === undefined) delete process.env.RUVECTOR_HYBRID_FUSION; else process.env.RUVECTOR_HYBRID_FUSION = saved; } };
}

(async () => {
  await test('fuseRrf: score is sum of 1/(60+rank) and a doc in both lists beats single-list docs', () => {
    const out = fuseRrf([[{ id: 'a' }, { id: 'b' }, { id: 'c' }], [{ id: 'c' }, { id: 'd' }]]);
    assert.deepStrictEqual(ids(out), ['c', 'a', 'b', 'd']);
    const c = out[0];
    assert.ok(Math.abs(c.rrf.score - (1 / (RRF_K + 3) + 1 / (RRF_K + 1))) < 1e-12);
    assert.deepStrictEqual(c.rrf.ranks, [3, 1]);
    assert.deepStrictEqual(out[3].rrf.ranks, [null, 2]); // b and d tie on score and best rank: id order
  });

  await test('fuseRrf: raw scores are ignored; only rank matters', () => {
    const a = fuseRrf([[{ id: 'x', score: 0.001 }, { id: 'y', score: 99 }], [{ id: 'y', score: 5 }, { id: 'x', score: 4 }]]);
    const b = fuseRrf([[{ id: 'x', score: 99 }, { id: 'y', score: 0.001 }], [{ id: 'y', score: 1 }, { id: 'x', score: 2 }]]);
    assert.deepStrictEqual(ids(a), ids(b));
    assert.strictEqual(a[0].rrf.score, b[0].rrf.score);
  });

  await test('fuseRrf: dedupes by id, within and across lists, first-seen object wins', () => {
    const out = fuseRrf([[{ id: 1, t: 'first' }, { id: 1, t: 'dup' }, { id: 2 }], [{ id: '1', t: 'other' }]]);
    assert.deepStrictEqual(ids(out), [1, 2]);
    assert.strictEqual(out[0].t, 'first');
    assert.deepStrictEqual(out[0].rrf.ranks, [1, 1]);
    assert.deepStrictEqual(out[1].rrf.ranks, [2, null], 'a within-list duplicate does not consume a rank');
  });

  await test('fuseRrf: ties break on best rank then id; limit and k honoured; empty safe', () => {
    const out = fuseRrf([[{ id: 'b' }], [{ id: 'a' }]]);
    assert.deepStrictEqual(ids(out), ['a', 'b']);
    assert.strictEqual(fuseRrf([[{ id: 'a' }, { id: 'b' }]], { limit: 1 }).length, 1);
    assert.ok(Math.abs(fuseRrf([[{ id: 'a' }]], { k: 10 })[0].rrf.score - 1 / 11) < 1e-12);
    assert.deepStrictEqual(fuseRrf([]), []);
    assert.deepStrictEqual(fuseRrf([[], []]), []);
    assert.deepStrictEqual(fuseRrf([[{}, null]]), []);
  });

  await test('default (env unset): scoped path uses the score blend, not rrf', async () => {
    const m = mk(() => [{ key: 'k', value: {}, namespace: 'n', source_type: 's', metadata: {}, vec_sim: 0.9, importance: 0.5, recency: 1, kw: 0.1, score: 0.7 }]);
    try {
      const r = await m.tools.memHybridSearch('q', 'n', 5);
      assert.strictEqual(r.method, 'hybrid-fusion');
      assert.ok(/ruvector_hybrid_score/.test(m.queries[0].sql));
      assert.strictEqual(r.results[0].score, 0.7);
    } finally { m.restore(); }
  });

  await test('unrecognised value behaves as default', async () => {
    const m = mk(() => [], 'bogus');
    try { assert.strictEqual((await m.tools.memHybridSearch('q', 'n', 5)).method, 'hybrid-fusion'); } finally { m.restore(); }
  });

  await test('rrf scoped: fuses the vec and fts lists, dedupes by row id, exposes ranks', async () => {
    const row = (lst, rnk, id) => ({ lst, rnk, id, key: 'k' + id, value: {}, namespace: 'n', source_type: 's', metadata: {}, vec_sim: 0.5, importance: 0.5, recency: 1, kw: lst === 'fts' ? 0.2 : 0 });
    const m = mk(() => [row('vec', 1, 'A'), row('vec', 2, 'B'), row('vec', 3, 'C'), row('fts', 1, 'C'), row('fts', 2, 'A')], 'rrf');
    try {
      const r = await m.tools.memHybridSearch('q', 'n', 3);
      assert.strictEqual(r.method, 'hybrid-rrf');
      assert.ok(!/ruvector_hybrid_score/.test(m.queries[0].sql));
      assert.deepStrictEqual(r.results.map((x) => x.key), ['kA', 'kC', 'kB']);
      assert.ok(Math.abs(r.results[0].score - (1 / 61 + 1 / 62)) < 1e-12);
      assert.deepStrictEqual(r.results[1].components.rrf.ranks, [3, 1]);
      assert.strictEqual(r.count, 3);
    } finally { m.restore(); }
  });

  await test('rrf honours the HYBRID GUARD: unscoped (namespace "*") is unchanged and has no FTS', async () => {
    const m = mk(() => [{ key: 'k', value: {}, namespace: 'n', source_type: 's', metadata: {}, vec_sim: 0.9, importance: 0.5, recency: 1, kw: 0, score: 0.8 }], 'rrf');
    try {
      const r = await m.tools.memHybridSearch('q', '*', 5);
      assert.strictEqual(r.method, 'hybrid-fusion-vectoronly');
      assert.ok(!/websearch_to_tsquery/.test(m.queries[0].sql));
    } finally { m.restore(); }
  });

  await test('rrf fails open: a query error degrades to memSearch', async () => {
    const saved = process.env.RUVECTOR_HYBRID_FUSION; process.env.RUVECTOR_HYBRID_FUSION = 'rrf';
    try {
      const t = createHybridTools({
        pool: { query: async () => { throw new Error('boom'); } }, getPgOk: () => true,
        getEmbedding: async () => [0.1], xinfEnsure: async () => true, vecToSql: () => '[0]', parseVal: (v) => v, log: () => {},
        memSearch: async () => ({ success: true, results: [{ key: 'fb' }] }),
      });
      const r = await t.memHybridSearch('q', 'n', 5);
      assert.strictEqual(r.degraded_from, 'hybrid_search');
      assert.strictEqual(r.results[0].key, 'fb');
    } finally { if (saved === undefined) delete process.env.RUVECTOR_HYBRID_FUSION; else process.env.RUVECTOR_HYBRID_FUSION = saved; }
  });

  console.log(`\n${passed} assertions passed`);
})();
