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
  const liveSet = new Set(live.map(([ns, k]) => `${ns}\u0000${k}`));
  const stepSet = new Set(steps);
  return {
    queries,
    writes: () => queries.filter((q) => /INSERT INTO memory_entries/.test(q.sql)),
    deps: {
      pool: {
        query: async (sql, params) => {
          queries.push({ sql, params });
          if (/FROM memory_entries/.test(sql) && /unnest\(/.test(sql)) {
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
      getEmbedding: async () => new Array(384).fill(0.1),
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

function withGate(on, fn) {
  return async () => {
    const before = process.env.RUVECTOR_EVIDENCE_REFS;
    if (on) process.env.RUVECTOR_EVIDENCE_REFS = '1'; else delete process.env.RUVECTOR_EVIDENCE_REFS;
    try { await fn(); } finally {
      if (before === undefined) delete process.env.RUVECTOR_EVIDENCE_REFS; else process.env.RUVECTOR_EVIDENCE_REFS = before;
    }
  };
}

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
    assert.match(m.writes()[0].sql, /metadata = EXCLUDED\.metadata/, 'a rewrite must replace the previous evidence');
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

  await test('gate on: a write without evidence still replaces metadata, clearing stale refs', withGate(true, async () => {
    const m = mockDeps();
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memStore('k', 'v2', 'ns');
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.evidence_refs, undefined);
    assert.match(m.writes()[0].sql, /metadata = EXCLUDED\.metadata/);
    const meta = JSON.parse(m.writes()[0].params[m.writes()[0].params.length - 1]);
    assert.strictEqual(meta.evidence, undefined);
    assert.strictEqual(meta.evidence_state, undefined);
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

  await test('gate off: a write without evidence is unchanged (no extra fields, one query)', withGate(false, async () => {
    // The typed-metadata gate adds its own field; isolate this gate from it.
    const typedBefore = process.env.RUVECTOR_TYPED_METADATA;
    delete process.env.RUVECTOR_TYPED_METADATA;
    try {
    const m = mockDeps();
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memStore('k', 'v', 'ns');
    assert.deepStrictEqual(Object.keys(r).sort(), ['action', 'embedded', 'key', 'namespace', 'storage', 'stored', 'success']);
    assert.strictEqual(m.queries.length, 1);
    assert.match(m.queries[0].sql, /'\{\}'/);
    } finally { if (typedBefore !== undefined) process.env.RUVECTOR_TYPED_METADATA = typedBefore; }
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

  await test('gate off: delete is the single historic statement', withGate(false, async () => {
    const m = mockDeps();
    const t = createMemoryTools({ backend: 'external-pg', deps: m.deps });
    const r = await t.memDelete('k', 'ns');
    assert.strictEqual(r.deleted, 1);
    assert.strictEqual(r.withdrawn, undefined);
    assert.strictEqual(m.queries.length, 1);
    assert.match(m.queries[0].sql, /^DELETE FROM memory_entries WHERE id = \$1$/);
  }));

  console.log(`\n${passed} passed${process.exitCode ? ' (with failures)' : ''}`);
})();
