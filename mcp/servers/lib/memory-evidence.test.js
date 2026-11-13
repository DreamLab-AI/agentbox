'use strict';
/**
 * memory-evidence.test.js — ADR-2201 clauses 1 and 7. Standalone (`node`), like
 * memory-tools.test.js: evidence references on memory_store are validated,
 * resolved at write time, rejected whole when one does not resolve, returned by
 * memory_retrieve, and marked withdrawn when the cited source is deleted.
 */

const assert = require('assert');
const { createMemoryTools } = require('./memory-tools');
const { normaliseEvidence, MAX_EVIDENCE_REFS } = require('./memory-evidence');

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
}

// A scripted pool: `live` is the set of resolvable memory refs ("ns\u0000key"),
// `steps` the resolvable trajectory step ids.
function mockDeps({ live = [], steps = [], stepsTable = true, retrieveRow = null } = {}) {
  const queries = [];
  const events = [];
  const liveSet = new Set(live.map(([ns, k]) => `${ns}\u0000${k}`));
  const stepSet = new Set(steps);
  return {
    queries, events,
    writes: () => queries.filter((q) => /INSERT INTO memory_entries/.test(q.sql)),
    deps: {
      pool: {
        query: async (sql, params) => {
          queries.push({ sql, params });
          if (/to_regclass/.test(sql)) return { rows: [{ t: stepsTable ? 'trajectory_steps' : null }] };
          if (/^\s*UPDATE memory_entries m/.test(sql)) return { rows: [], rowCount: 3 };
          if (/FROM memory_entries/.test(sql) && /unnest\(/.test(sql)) {
            events.push('resolve');
            const rows = [];
            params[0].forEach((ns, i) => { if (liveSet.has(`${ns}\u0000${params[1][i]}`)) rows.push({ namespace: ns, key: params[1][i] }); });
            return { rows };
          }
          if (/FROM trajectory_steps/.test(sql) && /ANY\(/.test(sql)) {
            if (!stepsTable) throw new Error('relation "trajectory_steps" does not exist');
            return { rows: params[0].filter((id) => stepSet.has(id)).map((id) => ({ id })) };
          }
          if (/WITH del AS/.test(sql)) return { rows: [{ deleted: 1, withdrawn: 2 }] };
          if (/^\s*DELETE FROM memory_entries/.test(sql)) return { rows: [], rowCount: 1 };
          if (/SELECT key, value, source_type/.test(sql)) return { rows: retrieveRow ? [retrieveRow] : [] };
          return { rows: [], rowCount: 0 };
        },
      },
      getPgOk: () => true,
      getEmbedding: async () => { events.push('embed'); return new Array(384).fill(0.1); },
      xinfEnsure: async () => true,
      vecToSql: (arr) => '[' + arr.join(',') + ']',
      entryId: (ns, key) => `agentbox:${ns}:${key}`,
      parseVal: (v) => v,
      notifyMemoryFlash: () => {},
      notifyMemoryFlashBatch: () => {},
      log: () => {},
      writeSourceType: 'agentbox',
    },
  };
}

// Both gates are set explicitly so the ambient environment cannot leak in.
function withGate(on, fn, { typed = false } = {}) {
  return async () => {
    const before = { e: process.env.RUVECTOR_EVIDENCE_REFS, t: process.env.RUVECTOR_TYPED_METADATA };
    if (on) process.env.RUVECTOR_EVIDENCE_REFS = '1'; else delete process.env.RUVECTOR_EVIDENCE_REFS;
    if (typed) process.env.RUVECTOR_TYPED_METADATA = '1'; else delete process.env.RUVECTOR_TYPED_METADATA;
    try { await fn(); } finally {
      if (before.e === undefined) delete process.env.RUVECTOR_EVIDENCE_REFS; else process.env.RUVECTOR_EVIDENCE_REFS = before.e;
      if (before.t === undefined) delete process.env.RUVECTOR_TYPED_METADATA; else process.env.RUVECTOR_TYPED_METADATA = before.t;
    }
  };
}
// COALESCE: a row whose metadata is SQL NULL must not swallow the new evidence (NULL || x is NULL).
const STRIP = /metadata = \(COALESCE\(memory_entries\.metadata, '\{\}'::jsonb\) - 'evidence' - 'evidence_state'\) \|\| EXCLUDED\.metadata/;

const MEM = { kind: 'memory', namespace: 'project-state', key: 'note-2026-10-01' };
const STEP = { kind: 'step', id: 'traj-1:step-3' };

(async () => {
  // ── pure normalisation ────────────────────────────────────────────────────
  await test('normaliseEvidence accepts memory and step refs and normalises event_time', () => {
    const r = normaliseEvidence([{ ...MEM, event_time: '2026-10-01' }, STEP], { namespace: 'ns', key: 'k' });
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.evidence[0], { ...MEM, event_time: '2026-10-01T00:00:00.000Z' });
    assert.deepStrictEqual(r.evidence[1], STEP);
  });

  await test('normaliseEvidence treats absent or empty input as no evidence', () => {
    assert.deepStrictEqual(normaliseEvidence(undefined, {}), { ok: true, evidence: [] });
    assert.deepStrictEqual(normaliseEvidence([], {}), { ok: true, evidence: [] });
  });

  await test('normaliseEvidence rejects unknown kinds, missing fields, bad times and non-arrays', () => {
    for (const bad of [
      'not-an-array',
      [{ kind: 'url', href: 'https://example.org' }],
      [{ kind: 'memory', namespace: 'ns' }],
      [{ kind: 'step' }],
      [{ ...MEM, event_time: 'last tuesday' }],
      [null],
    ]) {
      const r = normaliseEvidence(bad, { namespace: 'x', key: 'y' });
      assert.strictEqual(r.ok, false, JSON.stringify(bad));
      assert.ok(r.error);
    }
  });

  await test('normaliseEvidence rejects a self-citation and an over-long list, and dedupes', () => {
    assert.strictEqual(normaliseEvidence([MEM], { namespace: MEM.namespace, key: MEM.key }).ok, false);
    const many = Array.from({ length: MAX_EVIDENCE_REFS + 1 }, (_, i) => ({ kind: 'step', id: `s${i}` }));
    assert.strictEqual(normaliseEvidence(many, {}).ok, false);
    assert.strictEqual(normaliseEvidence([MEM, { ...MEM }], { namespace: 'a', key: 'b' }).evidence.length, 1);
  });

  await test('a withdrawn marker cannot be supplied by a writer', () => {
    assert.strictEqual(normaliseEvidence([{ kind: 'withdrawn', withdrawn_at: '2026-01-01' }], {}).ok, false);
  });

  // ── store, gate on ────────────────────────────────────────────────────────
  await test('gate on: resolvable refs are stored in metadata with evidence_state complete', withGate(true, async () => {
    const m = mockDeps({ live: [[MEM.namespace, MEM.key]], steps: [STEP.id] });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memStore('topic-x', 'summary', 'project-state', { evidence: [MEM, STEP] });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.evidence_refs, 2);
    assert.strictEqual(m.writes().length, 1);
    const meta = JSON.parse(m.writes()[0].params.find((p) => typeof p === 'string' && p.includes('"evidence"')));
    assert.deepStrictEqual(meta.evidence, [MEM, STEP]);
    assert.strictEqual(meta.evidence_state, 'complete');
    assert.match(m.writes()[0].sql, STRIP, 'a rewrite replaces the previous evidence and keeps every other metadata key');
    assert.deepStrictEqual(Object.keys(meta).sort(), ['evidence', 'evidence_state'], 'typed metadata off: nothing else is written');
  }));

  await test('typed metadata on: evidence rides in the replaced metadata object', withGate(true, async () => {
    const m = mockDeps({ live: [[MEM.namespace, MEM.key]] });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    await t.memStore('topic-x', 'summary', 'project-state', { evidence: [MEM], importance: 0.9 });
    assert.match(m.writes()[0].sql, /metadata = EXCLUDED\.metadata/);
    assert.ok(!STRIP.test(m.writes()[0].sql));
    const meta = JSON.parse(m.writes()[0].params[m.writes()[0].params.length - 1]);
    assert.deepStrictEqual(meta.evidence, [MEM]);
    assert.strictEqual(meta.importance, 0.9);
  }, { typed: true }));

  await test('references are resolved after the embedding, immediately before the write', withGate(true, async () => {
    const m = mockDeps({ live: [[MEM.namespace, MEM.key]] });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    await t.memStore('topic-x', 'summary', 'project-state', { evidence: [MEM] });
    assert.deepStrictEqual(m.events, ['embed', 'resolve'], 'a slow embedding call must not sit between the existence check and the write');
    const iResolve = m.queries.findIndex((q) => /unnest\(/.test(q.sql));
    assert.ok(/INSERT INTO memory_entries/.test(m.queries[iResolve + 1].sql));
  }));

  await test('gate on: one unresolved ref rejects the whole write and nothing is written', withGate(true, async () => {
    const m = mockDeps({ live: [[MEM.namespace, MEM.key]], steps: [] });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memStore('topic-x', 'summary', 'project-state', { evidence: [MEM, STEP] });
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.stored, false);
    assert.strictEqual(r.reason, 'evidence-unresolved');
    assert.deepStrictEqual(r.unresolved, [STEP]);
    assert.strictEqual(r.storage, 'none');
    assert.strictEqual(m.writes().length, 0, 'a rejected write must leave the previous row untouched');
  }));

  await test('gate on: malformed evidence rejects the write before any query', withGate(true, async () => {
    const m = mockDeps();
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memStore('k', 'v', 'ns', { evidence: [{ kind: 'memory' }] });
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.reason, 'evidence-invalid');
    assert.strictEqual(m.queries.length, 0);
  }));

  await test('gate on: a missing trajectory_steps table fails closed as unresolved', withGate(true, async () => {
    const m = mockDeps({ stepsTable: false });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memStore('k', 'v', 'ns', { evidence: [STEP] });
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.reason, 'evidence-unresolved');
    assert.strictEqual(m.writes().length, 0);
  }));

  await test('gate on, typed off: a rewrite without evidence clears stale refs and keeps other metadata (expires_at, tags)', withGate(true, async () => {
    const m = mockDeps();
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memStore('k', 'v2', 'ns');
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.evidence_refs, undefined);
    assert.match(m.writes()[0].sql, STRIP);
    assert.strictEqual(m.writes()[0].params[m.writes()[0].params.length - 1], '{}', 'no typed metadata is invented or dropped');
  }));

  // ── store, gate off ───────────────────────────────────────────────────────
  await test('gate off: evidence is not validated or stored, and the caller is told', withGate(false, async () => {
    const m = mockDeps();
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memStore('k', 'v', 'ns', { evidence: [STEP] });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.evidence_ignored, true);
    assert.strictEqual(m.queries.filter((q) => /trajectory_steps/.test(q.sql)).length, 0);
    assert.ok(!m.writes()[0].params.some((p) => typeof p === 'string' && p.includes('"evidence"')));
  }));

  await test('gate off: a rewrite still strips stale evidence; the response is unchanged and it is one query', withGate(false, async () => {
    const m = mockDeps();
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memStore('k', 'v', 'ns');
    assert.deepStrictEqual(Object.keys(r).sort(), ['action', 'embedded', 'key', 'namespace', 'storage', 'stored', 'success']);
    assert.strictEqual(m.queries.length, 1);
    assert.match(m.queries[0].sql, STRIP, 'evidence written while the gate was on must not stay attached to a new value');
    assert.strictEqual(m.queries[0].params[m.queries[0].params.length - 1], '{}');
  }));

  // ── retrieve ──────────────────────────────────────────────────────────────
  await test('memRetrieve returns evidence and its state when the row carries them', async () => {
    const m = mockDeps({ retrieveRow: { key: 'k', value: 'v', source_type: 'agentbox', evidence: [MEM], evidence_state: 'complete' } });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memRetrieve('k', 'ns');
    assert.deepStrictEqual(r.evidence, [MEM]);
    assert.strictEqual(r.evidence_state, 'complete');
  });

  await test('memRetrieve output is unchanged for a row without evidence', async () => {
    const m = mockDeps({ retrieveRow: { key: 'k', value: 'v', source_type: 'agentbox', evidence: null, evidence_state: null } });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memRetrieve('k', 'ns');
    assert.deepStrictEqual(Object.keys(r).sort(), ['action', 'found', 'key', 'namespace', 'source_type', 'storage', 'success', 'value']);
  });

  // ── withdrawal on delete (clause 7) ───────────────────────────────────────
  await test('gate on: delete withdraws the ref from citing entries in the same statement', withGate(true, async () => {
    const m = mockDeps();
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memDelete(MEM.key, MEM.namespace);
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.deleted, 1);
    assert.strictEqual(r.withdrawn, 2);
    const stmts = m.queries.filter((q) => /memory_entries/.test(q.sql));
    assert.strictEqual(stmts.length, 1, 'delete and withdrawal are one atomic statement');
    const q = stmts[0];
    assert.match(q.sql, /DELETE FROM memory_entries/);
    assert.match(q.sql, /'kind', 'withdrawn'/);
    assert.match(q.sql, /evidence_state/);
    const probe = JSON.parse(q.params.find((p) => typeof p === 'string' && p.startsWith('{"evidence"')));
    assert.deepStrictEqual(probe, { evidence: [{ kind: 'memory', namespace: MEM.namespace, key: MEM.key }] });
    assert.ok(!/'key',\s*\$/.test(q.sql), 'the withdrawn marker must not keep the deleted key');
  }));

  await test('gate off: delete still withdraws references written while the gate was on', withGate(false, async () => {
    const m = mockDeps();
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memDelete('k', 'ns');
    assert.strictEqual(r.deleted, 1);
    assert.strictEqual(r.withdrawn, 2);
    assert.strictEqual(m.queries.length, 1);
    assert.match(m.queries[0].sql, /'kind', 'withdrawn'/);
  }));

  // ── reconcile on sweep ────────────────────────────────────────────────────
  await test('the sweep reconciles references whatever it deleted, with either gate state', withGate(false, async () => {
    const m = mockDeps();
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memSweepEpisodic(null);
    assert.strictEqual(r.evidence_withdrawn_from, 3);
    const rec = m.queries.find((q) => /^\s*UPDATE memory_entries m/.test(q.sql));
    assert.ok(rec, 'reconcile ran');
    assert.match(rec.sql, /trajectory_steps/);
    assert.match(rec.sql, /m\.metadata->'evidence'/, 'the new array is computed from the row being updated, not from a snapshot');
    assert.match(rec.sql, /m\.updated_at < /, 'a row rewritten during the statement is skipped: its new sources may be invisible to this snapshot');
  }));

  await test('reconcile without a trajectory_steps table leaves step references alone and does not fail', withGate(true, async () => {
    const m = mockDeps({ stepsTable: false });
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memSweepEpisodic(null);
    assert.strictEqual(r.evidence_reconcile_error, undefined);
    const rec = m.queries.find((q) => /^\s*UPDATE memory_entries m/.test(q.sql));
    assert.ok(rec && !/trajectory_steps/.test(rec.sql));
  }));

  console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
})();
