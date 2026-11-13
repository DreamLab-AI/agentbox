// tests/integration/memory-evidence-sql.check.cjs
//
// Real-engine check of the ADR-2201 SQL (evidence references, withdrawal on
// delete and sweep, read counters). The unit suites beside the modules use a
// scripted pool and so cannot tell whether the statements are valid SQL; this
// runs them on the live Postgres engine.
//
// Everything runs against TEMP tables that shadow memory_entries,
// trajectory_steps and memory_reads inside one transaction that is rolled
// back: the live tables are never read or written, and the check asserts the
// shadowing before it does anything else.
//
//   node tests/integration/memory-evidence-sql.check.cjs
//
// Needs the governed connection env (RUVECTOR_PG_HOST/..., RUVECTOR_PG_PASSWORD_FILE)
// and management-api/node_modules. Exits 1 on any failed assertion.
const path = require('path');
const assert = require('assert');
const wt = path.join(__dirname, '..', '..');
const root = path.join(wt, 'management-api');
// In a git worktree management-api/node_modules is absent; NODE_PATH may point
// at the primary checkout's copy.
const { Client } = require(require.resolve('pg', { paths: [root, ...(process.env.NODE_PATH || '').split(':').filter(Boolean)] }));
const cfg = require(path.join(root, 'lib/pg-config.js'));
process.env.RUVECTOR_EVIDENCE_REFS = '1'; process.env.RUVECTOR_READ_COUNTS = '1'; process.env.RUVECTOR_TYPED_METADATA = '1';
const { createMemoryTools } = require(path.join(wt, 'mcp/servers/lib/memory-tools.js'));
(async () => {
  const c = new Client(cfg.pgPoolConfig(process.env)); await c.connect();
  await c.query('BEGIN');
  try {
    await c.query(`CREATE TEMP TABLE memory_entries (id text primary key, namespace text, key text, value jsonb, source_type text, metadata jsonb default '{}', embedding text, created_at timestamp default now(), updated_at timestamp default now()) ON COMMIT DROP`);
    await c.query(`CREATE TEMP TABLE trajectory_steps (id text primary key) ON COMMIT DROP`);
    await c.query(`CREATE TEMP TABLE memory_reads (namespace text NOT NULL, key text NOT NULL, action text NOT NULL, n bigint NOT NULL DEFAULT 0, first_at timestamptz NOT NULL DEFAULT now(), last_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (namespace, key, action)) ON COMMIT DROP`);
    const shadow = await c.query(`select n.nspname from pg_class k join pg_namespace n on n.oid=k.relnamespace where k.oid='memory_entries'::regclass`);
    assert.match(shadow.rows[0].nspname, /^pg_temp/, 'the temp table must shadow the live one');
    await c.query(`INSERT INTO trajectory_steps VALUES ('t1:s1')`);
    // The store casts the vector to ruvector(384); the temp column is text, so strip the cast.
    const pool = { query: (sql, params) => c.query(sql.replace(/::ruvector\(384\)/g, ''), params) };
    const t = createMemoryTools({ backend: 'external-pg', deps: {
      pool, getPgOk: () => true, getEmbedding: async () => [0.1], xinfEnsure: async () => true,
      vecToSql: (a) => '[' + a.join(',') + ']', entryId: (ns, k) => `agentbox:${ns}:${k}`,
      parseVal: (v) => v, notifyMemoryFlash() {}, notifyMemoryFlashBatch() {}, log: (l, m) => console.log('   log', l, m), writeSourceType: 'agentbox' } });
    const A = { kind: 'memory', namespace: 'ns/a', key: 'note:1' }, B = { kind: 'memory', namespace: 'ns/a', key: 'note:2' }, ST = { kind: 'step', id: 't1:s1' };
    assert.strictEqual((await t.memStore('note:1', 'first note', 'ns/a')).success, true);
    assert.strictEqual((await t.memStore('note:2', 'second note', 'ns/a', { ttl_seconds: 3600 })).success, true);
    // positive: all three resolve
    let r = await t.memStore('topic', 'summary of notes', 'ns/a', { evidence: [A, { ...B, event_time: '2026-10-02' }, ST] });
    assert.strictEqual(r.success, true); assert.strictEqual(r.evidence_refs, 3);
    r = await t.memRetrieve('topic', 'ns/a');
    assert.strictEqual(r.evidence.length, 3); assert.strictEqual(r.evidence_state, 'complete');
    // negative: one missing ref rejects, and the stored row is untouched
    r = await t.memStore('topic', 'CHANGED', 'ns/a', { evidence: [A, { kind: 'memory', namespace: 'ns/a', key: 'nope' }] });
    assert.strictEqual(r.success, false); assert.strictEqual(r.reason, 'evidence-unresolved'); assert.strictEqual(r.unresolved.length, 1);
    assert.strictEqual((await t.memRetrieve('topic', 'ns/a')).value, 'summary of notes');
    r = await t.memStore('x', 'y', 'ns/a', { evidence: [{ kind: 'step', id: 'absent' }] });
    assert.strictEqual(r.reason, 'evidence-unresolved');
    // delete withdraws exactly the cited ref, keeps order, drops the key
    r = await t.memDelete('note:1', 'ns/a');
    assert.deepStrictEqual([r.deleted, r.withdrawn], [1, 1]);
    r = await t.memRetrieve('topic', 'ns/a');
    assert.strictEqual(r.evidence_state, 'partial');
    assert.strictEqual(r.evidence[0].kind, 'withdrawn'); assert.ok(r.evidence[0].withdrawn_at); assert.strictEqual(r.evidence[0].key, undefined); assert.strictEqual(r.evidence[0].namespace, undefined);
    assert.strictEqual(r.evidence[1].key, 'note:2'); assert.strictEqual(r.evidence[2].id, 't1:s1');
    assert.strictEqual(r.value, 'summary of notes', 'withdrawal must not alter the value');
    // control: deleting an uncited entry withdraws nothing
    await t.memStore('lonely', 'z', 'ns/a');
    r = await t.memDelete('lonely', 'ns/a'); assert.deepStrictEqual([r.deleted, r.withdrawn], [1, undefined]);
    // control: deleting an entry that does not exist withdraws nothing, even if something cites that key
    r = await t.memDelete('note:1', 'ns/a'); assert.deepStrictEqual([r.deleted, r.withdrawn], [0, undefined]);
    // review finding 4: with typed metadata off, a rewrite keeps a TTL written earlier and drops only evidence
    delete process.env.RUVECTOR_TYPED_METADATA;
    await t.memStore('ttl-row', 'v1', 'ns/a', { evidence: [B] });
    await c.query(`UPDATE memory_entries SET metadata = metadata || '{"expires_at":"2099-01-01T00:00:00.000Z","tags":["keep"]}' WHERE key = 'ttl-row'`);
    await t.memStore('ttl-row', 'v2', 'ns/a');
    let meta = (await c.query(`SELECT metadata FROM memory_entries WHERE key = 'ttl-row'`)).rows[0].metadata;
    assert.strictEqual(meta.expires_at, '2099-01-01T00:00:00.000Z'); assert.deepStrictEqual(meta.tags, ['keep']);
    assert.strictEqual(meta.evidence, undefined); assert.strictEqual(meta.evidence_state, undefined);
    // cross-vendor finding: a row whose metadata is SQL NULL still takes new evidence on a rewrite
    await t.memStore('null-meta', 'v1', 'ns/a');
    await c.query(`UPDATE memory_entries SET metadata = NULL WHERE key = 'null-meta'`);
    r = await t.memStore('null-meta', 'v2', 'ns/a', { evidence: [B] }); assert.strictEqual(r.evidence_refs, 1);
    r = await t.memRetrieve('null-meta', 'ns/a'); assert.strictEqual(r.evidence.length, 1);
    await t.memDelete('null-meta', 'ns/a');
        // review finding 6/7: with the evidence gate OFF, a delete still withdraws and a rewrite still strips
    await t.memStore('cites-b', 'v', 'ns/a', { evidence: [B] });
    delete process.env.RUVECTOR_EVIDENCE_REFS;
    await t.memStore('gateoff-src', 'x', 'ns/a');
    process.env.RUVECTOR_EVIDENCE_REFS = '1';
    await t.memStore('cites-src', 'v', 'ns/a', { evidence: [{ kind: 'memory', namespace: 'ns/a', key: 'gateoff-src' }] });
    delete process.env.RUVECTOR_EVIDENCE_REFS;
    r = await t.memDelete('gateoff-src', 'ns/a'); assert.deepStrictEqual([r.deleted, r.withdrawn], [1, 1]);
    r = await t.memRetrieve('cites-src', 'ns/a'); assert.strictEqual(r.evidence[0].kind, 'withdrawn');
    await t.memStore('cites-b', 'v2', 'ns/a');
    r = await t.memRetrieve('cites-b', 'ns/a'); assert.strictEqual(r.evidence, undefined, 'gate off: stale evidence is not left on a new value');
    process.env.RUVECTOR_EVIDENCE_REFS = '1'; process.env.RUVECTOR_TYPED_METADATA = '1';
    await t.memDelete('cites-src', 'ns/a'); await t.memDelete('ttl-row', 'ns/a'); await t.memDelete('cites-b', 'ns/a'); await t.memDelete('gateoff-src', 'ns/a');
    // sweep: expire note:2 and prune the step, then reconcile through the sweep
    await c.query(`UPDATE memory_entries SET metadata = metadata || '{"expires_at":"2020-01-01T00:00:00.000Z"}' WHERE key = 'note:2'`);
    await c.query(`DELETE FROM trajectory_steps`);
    // cross-vendor finding: a row rewritten moments ago is skipped by the reconcile (its new
    // sources may be invisible to the statement's snapshot); it is picked up once it has settled.
    const { reconcile } = require(path.join(wt, 'mcp/servers/lib/memory-evidence.js'));
    assert.strictEqual(await reconcile(pool), 0, 'a freshly written citing row is left alone');
    await c.query(`UPDATE memory_entries SET updated_at = updated_at - interval '10 minutes'`);
    r = await t.memSweepEpisodic('ns/a');
    assert.strictEqual(r.swept, 1); assert.strictEqual(r.evidence_withdrawn_from, 1, JSON.stringify(r));
    r = await t.memRetrieve('topic', 'ns/a');
    assert.deepStrictEqual(r.evidence.map((e) => e.kind), ['withdrawn', 'withdrawn', 'withdrawn']);
    // the reconcile statement for an install without trajectory_steps is valid SQL too
    const { reconcileSql } = require(path.join(wt, 'mcp/servers/lib/memory-evidence.js'));
    assert.strictEqual((await c.query(reconcileSql(false), [new Date().toISOString()])).rowCount, 0);
    // a rewrite without evidence clears the references
    await t.memStore('topic', 'rewritten', 'ns/a');
    r = await t.memRetrieve('topic', 'ns/a'); assert.strictEqual(r.evidence, undefined);
    // read counters
    await t.memReadsIdle();
    await t.memRecordReads([{ namespace: 'ns/a', key: 'topic' }, { namespace: 'ns/a', key: 'topic' }], 'search_hit');
    const reads = await c.query(`SELECT key, action, n FROM memory_reads ORDER BY key, action`);
    const got = Object.fromEntries(reads.rows.map((x) => [`${x.key}|${x.action}`, Number(x.n)]));
    assert.strictEqual(got['topic|retrieve'], 5, JSON.stringify(got)); assert.strictEqual(got['topic|search_hit'], 1);
    assert.strictEqual(got['note:1|retrieve'], undefined); assert.strictEqual(got['lonely|retrieve'], undefined);
    console.log('SQL CHECK PASS', JSON.stringify(got));
  } finally { await c.query('ROLLBACK'); await c.end(); }
})().catch((e) => { console.error('SQL CHECK FAIL:', e.message); process.exit(1); });
