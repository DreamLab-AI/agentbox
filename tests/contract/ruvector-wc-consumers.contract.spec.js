'use strict';

/**
 * Contract test suite — PRD-020 / ADR-040 v2 W-C retrieval-path consumers
 * (implementer-A slice): attention re-rank (D3), SONA apply + health (D4),
 * param-tuning reserved scaffold (D5).
 *
 * The single scoring engine is `memSearch` in memory-tools.js. These tests drive
 * `createExternalPgBackend(deps)` directly with a query-recording stub pool (no
 * DB writes, no live sidecar), exactly as the sibling ruvector-gates contract
 * spec does, and assert:
 *
 *   A. GATES OFF ⇒ Phase-0 byte-identity. With none of RUVECTOR_ATTENTION_RERANK
 *      / RUVECTOR_SONA_APPLY_ENABLED / RUVECTOR_PARAM_TUNING_ENABLED set, memSearch
 *      issues the single baseline cosine SQL, returns the exact Phase-0 object
 *      shape (no `_attention`, no debug field), and never calls attention_score
 *      or ruvector_sona_apply. Every query on the path is a read-only SELECT (I03).
 *   B. ATTENTION ON ⇒ the overfetch/blend/re-sort/truncate path activates
 *      (LIMIT $2 * 4, attention_score(...)), the returned item shape stays
 *      byte-identical with `score` = the cosine value, the blend reorders by the
 *      rescaled attention term, and `_attention` carries the A/B result-delta.
 *   C. ATTENTION ON + induced error ⇒ fail-open to the baseline cosine floor
 *      (no `_attention`, baseline order, one WARN log). Baseline is the guarantee.
 *   D. SONA APPLY ON ⇒ ruvector_sona_apply transforms the query BEFORE scoring;
 *      passthrough (unchanged return) is a no-op; a non-384 return is rejected
 *      (dim guard); an induced error fails open to the raw query. The transform
 *      is fed to BOTH baseline and attention SQL via the shared $1.
 *   E. PARAM_TUNING ON ⇒ RESERVED no-op: results byte-identical to the gate-off
 *      baseline; no auto_tune/enable_learning/record_feedback query is ever issued.
 *   F. sona_health ⇒ read-only shape + cold/warming state + advisories, and
 *      fail-open to { available:false }; issues only SELECT.
 *
 * See ADR-040 §D3/§D4/§D5, the WF2 map §1–§3, R-C1/R-C2/R-C9; DDD-018 §5 (I14).
 */

const { createExternalPgBackend } = require('../../mcp/servers/lib/memory-tools');

// The three W-C retrieval-consumer gates this file exercises. Cleared before
// every test so an unset gate reads OFF (PRD-020 metric 1 / DDD-016 R14).
const WC_GATES = [
  'RUVECTOR_ATTENTION_RERANK',
  'RUVECTOR_SONA_APPLY_ENABLED',
  'RUVECTOR_PARAM_TUNING_ENABLED',
];

// ── stub-pool backend factory ───────────────────────────────────────────────
// `handler(sql, params, nth)` decides each query's result (or throws to induce a
// failure). Every issued query is recorded for read-only + ordering assertions.
function makeBackend(handler, opts = {}) {
  const queries = [];
  const logs = [];
  const embedding = opts.embedding || new Array(384).fill(0.01);
  const deps = {
    pool: { query: async (sql, params) => { queries.push({ sql, params }); return handler(sql, params, queries.length); } },
    getPgOk: () => (opts.pgOk === undefined ? true : opts.pgOk),
    getEmbedding: async () => embedding,
    xinfEnsure: async () => (opts.xinf === undefined ? true : opts.xinf),
    vecToSql: (v) => '[' + v.join(',') + ']',
    entryId: (ns, key) => `agentbox:${ns}:${key}`,
    parseVal: (v) => { if (typeof v === 'string') { try { return JSON.parse(v); } catch { return v; } } return v; },
    notifyMemoryFlash: () => {},
    notifyMemoryFlashBatch: () => {},
    log: (lvl, msg) => logs.push({ lvl, msg }),
    writeSourceType: 'agentbox',
  };
  return { backend: createExternalPgBackend(deps), queries, logs, embedding };
}

const isAttention = (sql) => /attention_score\s*\(/.test(sql);
const isSonaApply = (sql) => /ruvector_sona_apply/.test(sql);
const isSonaStats = (sql) => /ruvector_sona_stats/.test(sql);
const isBaseline  = (sql) => /1\.0 - \(embedding <=>/.test(sql) && !isAttention(sql);
const isWrite     = (sql) => /\b(INSERT|UPDATE|DELETE)\b/i.test(sql);

const BASELINE_ROWS = [
  { key: 'k1', value: 'v1', namespace: 'default', source_type: 'agentbox', score: 0.90 },
  { key: 'k2', value: 'v2', namespace: 'default', source_type: 'agentbox', score: 0.50 },
];

beforeEach(() => { for (const g of WC_GATES) delete process.env[g]; });
afterAll(() => { for (const g of WC_GATES) delete process.env[g]; });

// ===========================================================================
// A. Gates off ⇒ Phase-0 byte-identity
// ===========================================================================
describe('W-C consumers :: gates OFF are byte-identical to Phase 0', () => {
  const handler = (sql) => {
    if (isBaseline(sql)) return { rows: BASELINE_ROWS };
    throw new Error(`unexpected query on gate-off path: ${sql.slice(0, 60)}`);
  };

  it('memSearch issues the single baseline cosine SQL and the exact Phase-0 shape', async () => {
    const { backend, queries } = makeBackend(handler);
    const res = await backend.memSearch('hello', 'default', 10, null);

    expect(Object.keys(res).sort()).toEqual(
      ['action', 'count', 'method', 'namespace', 'query', 'results', 'storage', 'success'].sort(),
    );
    expect(res._attention).toBeUndefined();
    expect(res.method).toBe('hnsw-xinference');
    expect(res.storage).toBe('ruvector-postgres');
    expect(res.results).toEqual([
      { key: 'k1', value: 'v1', namespace: 'default', source_type: 'agentbox', score: 0.90 },
      { key: 'k2', value: 'v2', namespace: 'default', source_type: 'agentbox', score: 0.50 },
    ]);

    // exactly one query, the baseline; never attention/sona
    expect(queries).toHaveLength(1);
    expect(isBaseline(queries[0].sql)).toBe(true);
    expect(queries.some((q) => isAttention(q.sql))).toBe(false);
    expect(queries.some((q) => isSonaApply(q.sql))).toBe(false);
  });

  it('the whole search path is read-only (no INSERT/UPDATE/DELETE — I03)', async () => {
    const { backend, queries } = makeBackend(handler);
    await backend.memSearch('hello', 'default', 10, null);
    expect(queries.every((q) => !isWrite(q.sql))).toBe(true);
  });
});

// ===========================================================================
// B. attention_rerank ON ⇒ overfetch/blend/re-sort path activates
// ===========================================================================
describe('W-C consumers :: attention_rerank ON activates the overfetch/blend path', () => {
  // Synthetic candidate set where cosine order and blended order DIFFER, so the
  // blend is proven to reorder (physically att = cos/√dim is monotone with cos —
  // R-C1 — so a real corpus reorders nothing; the stub decouples the two axes).
  const ATT_ROWS = [
    { key: 'A', value: 'va', namespace: 'default', source_type: 'agentbox', cos: 0.90, att: 0.001 },
    { key: 'B', value: 'vb', namespace: 'default', source_type: 'agentbox', cos: 0.50, att: 0.900 },
  ];
  const handler = (sql) => {
    if (isAttention(sql)) return { rows: ATT_ROWS };
    if (isBaseline(sql)) return { rows: BASELINE_ROWS };
    throw new Error(`unexpected: ${sql.slice(0, 60)}`);
  };

  it('issues an attention_score CTE with LIMIT $2 * 4 (filtered branch keeps MATERIALIZED)', async () => {
    process.env.RUVECTOR_ATTENTION_RERANK = '1';
    const { backend, queries } = makeBackend(handler);
    await backend.memSearch('q', 'default', 10, null);
    const attQ = queries.find((q) => isAttention(q.sql));
    expect(attQ).toBeDefined();
    expect(attQ.sql).toMatch(/LIMIT \$2 \* 4/);
    expect(attQ.sql).toMatch(/WITH ns AS MATERIALIZED/); // namespace filter → btree pre-filter preserved
    // no baseline query needed when attention succeeds
    expect(queries.filter((q) => isBaseline(q.sql))).toHaveLength(0);
  });

  it('unfiltered branch (namespace "*") uses the fast HNSW cand CTE, no MATERIALIZED', async () => {
    process.env.RUVECTOR_ATTENTION_RERANK = '1';
    const { backend, queries } = makeBackend(handler);
    await backend.memSearch('q', '*', 10, null);
    const attQ = queries.find((q) => isAttention(q.sql));
    expect(attQ.sql).toMatch(/LIMIT \$2 \* 4/);
    expect(attQ.sql).not.toMatch(/MATERIALIZED/);
  });

  it('blend reorders by the rescaled attention term; item shape stays byte-identical with score = cosine', async () => {
    process.env.RUVECTOR_ATTENTION_RERANK = '1';
    const { backend } = makeBackend(handler);
    const res = await backend.memSearch('q', 'default', 10, null);

    // B (high att) now ranks first; A second. score is the COSINE value, not the blend.
    expect(res.results.map((r) => r.key)).toEqual(['B', 'A']);
    expect(res.results[0]).toEqual({ key: 'B', value: 'vb', namespace: 'default', source_type: 'agentbox', score: 0.50 });
    expect(res.results[1]).toEqual({ key: 'A', value: 'va', namespace: 'default', source_type: 'agentbox', score: 0.90 });
    // no internal blend fields leak into the public item
    for (const r of res.results) expect(Object.keys(r).sort()).toEqual(['key', 'namespace', 'score', 'source_type', 'value']);
  });

  it('emits the result-delta in _attention for harness A/B attribution', async () => {
    process.env.RUVECTOR_ATTENTION_RERANK = '1';
    const { backend } = makeBackend(handler);
    const res = await backend.memSearch('q', 'default', 10, null);
    expect(res._attention).toBeDefined();
    expect(res._attention.alpha).toBe(0.5);
    expect(res._attention.overfetch).toBe(4);
    expect(res._attention.candidates).toBe(2);
    expect(res._attention.baseline_top).toEqual(['A', 'B']); // pure cosine order
    expect(res._attention.reranked_top).toEqual(['B', 'A']); // blended order
    expect(res._attention.reordered).toBe(2);
    expect(res._attention.entered_top_k).toEqual([]);
    expect(typeof res._attention.note).toBe('string');
  });

  it('a pure-cosine candidate set is an identity re-rank (reordered 0) — the R-C1 null result', async () => {
    process.env.RUVECTOR_ATTENTION_RERANK = '1';
    // att strictly = cos/√384 → monotone with cos → order unchanged.
    const mono = [
      { key: 'A', value: 'va', namespace: 'default', source_type: 'agentbox', cos: 0.90, att: 0.90 / Math.sqrt(384) },
      { key: 'B', value: 'vb', namespace: 'default', source_type: 'agentbox', cos: 0.50, att: 0.50 / Math.sqrt(384) },
      { key: 'C', value: 'vc', namespace: 'default', source_type: 'agentbox', cos: 0.30, att: 0.30 / Math.sqrt(384) },
    ];
    const { backend } = makeBackend((sql) => (isAttention(sql) ? { rows: mono } : { rows: BASELINE_ROWS }));
    const res = await backend.memSearch('q', 'default', 10, null);
    // Assert on the pre-compression ordering channel: `results` is passed through
    // the same headroom `_compressResults` step as the baseline path (which may
    // drop rows on 3+ sets), so `_attention.reranked_top` is the authoritative
    // order record for A/B attribution.
    expect(res._attention.reranked_top).toEqual(['A', 'B', 'C']); // cosine order preserved
    expect(res._attention.baseline_top).toEqual(['A', 'B', 'C']);
    expect(res._attention.reordered).toBe(0);
  });
});

// ===========================================================================
// C. attention_rerank ON + induced error ⇒ fail-open to baseline cosine floor
// ===========================================================================
describe('W-C consumers :: attention_rerank fails open to the baseline cosine floor', () => {
  it('an attention error falls through to the baseline order with no _attention', async () => {
    process.env.RUVECTOR_ATTENTION_RERANK = '1';
    const { backend, queries, logs } = makeBackend((sql) => {
      if (isAttention(sql)) throw new Error('function attention_score does not exist');
      if (isBaseline(sql)) return { rows: BASELINE_ROWS };
      throw new Error(`unexpected: ${sql.slice(0, 60)}`);
    });
    const res = await backend.memSearch('q', 'default', 10, null);

    expect(res._attention).toBeUndefined();
    expect(res.method).toBe('hnsw-xinference');
    expect(res.results.map((r) => r.key)).toEqual(['k1', 'k2']); // baseline order intact
    // both attempted: the failed attention query, then the baseline floor
    expect(queries.some((q) => isAttention(q.sql))).toBe(true);
    expect(queries.some((q) => isBaseline(q.sql))).toBe(true);
    expect(logs.some((l) => l.lvl === 'WARN' && /attention_rerank failed/.test(l.msg))).toBe(true);
  });
});

// ===========================================================================
// D. sona_apply ON ⇒ pre-scoring query transform, fail-safe passthrough
// ===========================================================================
describe('W-C consumers :: sona_apply ON transforms the query before scoring (fail-safe)', () => {
  const rawVec = () => '[' + new Array(384).fill(0.01).join(',') + ']';

  it('applies ruvector_sona_apply BEFORE the search, feeding its output as $1', async () => {
    process.env.RUVECTOR_SONA_APPLY_ENABLED = '1';
    const transformed = new Array(384).fill(0.5);
    const { backend, queries } = makeBackend((sql) => {
      if (isSonaApply(sql)) return { rows: [{ v: transformed }] };
      if (isBaseline(sql)) return { rows: BASELINE_ROWS };
      throw new Error(`unexpected: ${sql.slice(0, 60)}`);
    });
    await backend.memSearch('q', 'default', 10, null);

    // sona_apply runs first (query 1), scoped to 'agentbox_memory' with the raw embedding
    expect(isSonaApply(queries[0].sql)).toBe(true);
    expect(queries[0].params[0]).toBe('agentbox_memory');
    expect(queries[0].params[1]).toEqual(new Array(384).fill(0.01));
    // the baseline search then uses the TRANSFORMED vector as $1
    const baseQ = queries.find((q) => isBaseline(q.sql));
    expect(baseQ.params[0]).toBe('[' + new Array(384).fill(0.5).join(',') + ']');
  });

  it('an unchanged (passthrough) return is a no-op — raw query vector unchanged', async () => {
    process.env.RUVECTOR_SONA_APPLY_ENABLED = '1';
    const passthrough = new Array(384).fill(0.01); // extension returns input unchanged when unlearned
    const { backend, queries } = makeBackend((sql) => {
      if (isSonaApply(sql)) return { rows: [{ v: passthrough }] };
      if (isBaseline(sql)) return { rows: BASELINE_ROWS };
      throw new Error(`unexpected: ${sql.slice(0, 60)}`);
    });
    await backend.memSearch('q', 'default', 10, null);
    const baseQ = queries.find((q) => isBaseline(q.sql));
    expect(baseQ.params[0]).toBe(rawVec()); // identical to the untransformed query
  });

  it('a non-384 return is rejected by the dim guard; the raw query is used', async () => {
    process.env.RUVECTOR_SONA_APPLY_ENABLED = '1';
    const { backend, queries } = makeBackend((sql) => {
      if (isSonaApply(sql)) return { rows: [{ v: new Array(256).fill(0.5) }] }; // wrong dim
      if (isBaseline(sql)) return { rows: BASELINE_ROWS };
      throw new Error(`unexpected: ${sql.slice(0, 60)}`);
    });
    await backend.memSearch('q', 'default', 10, null);
    const baseQ = queries.find((q) => isBaseline(q.sql));
    expect(baseQ.params[0]).toBe(rawVec());
  });

  it('a sona_apply error fails open to the raw query and the search still runs', async () => {
    process.env.RUVECTOR_SONA_APPLY_ENABLED = '1';
    const { backend, queries, logs } = makeBackend((sql) => {
      if (isSonaApply(sql)) throw new Error('sona engine cold');
      if (isBaseline(sql)) return { rows: BASELINE_ROWS };
      throw new Error(`unexpected: ${sql.slice(0, 60)}`);
    });
    const res = await backend.memSearch('q', 'default', 10, null);
    expect(res.success).toBe(true);
    const baseQ = queries.find((q) => isBaseline(q.sql));
    expect(baseQ.params[0]).toBe(rawVec());
    expect(logs.some((l) => l.lvl === 'WARN' && /sona_apply failed/.test(l.msg))).toBe(true);
  });

  it('combined with attention: sona transforms first, then the attention CTE uses the transformed $1', async () => {
    process.env.RUVECTOR_SONA_APPLY_ENABLED = '1';
    process.env.RUVECTOR_ATTENTION_RERANK = '1';
    const transformed = new Array(384).fill(0.7);
    const { backend, queries } = makeBackend((sql) => {
      if (isSonaApply(sql)) return { rows: [{ v: transformed }] };
      if (isAttention(sql)) return { rows: [
        { key: 'A', value: 'va', namespace: 'default', source_type: 'agentbox', cos: 0.4, att: 0.4 / Math.sqrt(384) },
      ] };
      if (isBaseline(sql)) return { rows: BASELINE_ROWS };
      throw new Error(`unexpected: ${sql.slice(0, 60)}`);
    });
    const res = await backend.memSearch('q', 'default', 10, null);
    expect(isSonaApply(queries[0].sql)).toBe(true);
    const attQ = queries.find((q) => isAttention(q.sql));
    expect(attQ.params[0]).toBe('[' + new Array(384).fill(0.7).join(',') + ']');
    expect(res._attention).toBeDefined();
  });
});

// ===========================================================================
// E. param_tuning ON ⇒ RESERVED no-op (byte-identical to baseline)
// ===========================================================================
describe('W-C consumers :: param_tuning ON is a reserved no-op', () => {
  const handler = (sql) => {
    if (isBaseline(sql)) return { rows: BASELINE_ROWS };
    throw new Error(`unexpected: ${sql.slice(0, 60)}`);
  };

  it('results are byte-identical to the gate-off baseline and no tuner query is issued', async () => {
    process.env.RUVECTOR_PARAM_TUNING_ENABLED = '1';
    const { backend, queries, logs } = makeBackend(handler);
    const res = await backend.memSearch('hello', 'default', 10, null);

    expect(res._attention).toBeUndefined();
    expect(res.results).toEqual([
      { key: 'k1', value: 'v1', namespace: 'default', source_type: 'agentbox', score: 0.90 },
      { key: 'k2', value: 'v2', namespace: 'default', source_type: 'agentbox', score: 0.50 },
    ]);
    expect(queries).toHaveLength(1);
    expect(isBaseline(queries[0].sql)).toBe(true);
    // the reserved auto-tuner surface is NEVER called
    expect(queries.some((q) => /ruvector_auto_tune|ruvector_enable_learning|ruvector_record_feedback/.test(q.sql))).toBe(false);
    // the reserved gate is observably declared (one-shot INFO on first flip)
    expect(logs.some((l) => l.lvl === 'INFO' && /RESERVED/.test(l.msg))).toBe(true);
  });
});

// ===========================================================================
// F. sona_health ⇒ read-only diagnostics shape + fail-open
// ===========================================================================
describe('W-C consumers :: sona_health is read-only diagnostics, fail-open', () => {
  const COLD = { table: 'agentbox_memory', ewc_tasks: 0, hidden_dim: 256, embedding_dim: 256, patterns_stored: 0, buffer_success_rate: 1.0, trajectories_dropped: 0, trajectories_buffered: 0 };

  it('surfaces the scope, cold state, dim mismatch and advisories; issues only SELECT', async () => {
    const { backend, queries } = makeBackend((sql) => {
      if (isSonaStats(sql)) return { rows: [{ stats: COLD, ewc: COLD }] };
      throw new Error(`unexpected: ${sql.slice(0, 60)}`);
    });
    const res = await backend.memSonaHealth();

    expect(res.success).toBe(true);
    expect(res.available).toBe(true);
    expect(res.scope).toBe('agentbox_memory');
    expect(res.state).toBe('cold');
    expect(res.embedding_dim).toBe(256);
    expect(res.corpus_embedding_dim).toBe(384);
    expect(res.trajectories_buffered).toBe(0);
    expect(res.patterns_stored).toBe(0);
    expect(res.advisories).toEqual({ engine_not_accumulating: true, embedding_dim_mismatch: true, apply_safe_to_enable: false });

    // read-only: only a SELECT over the sona_* functions, never a write
    expect(queries).toHaveLength(1);
    expect(/^\s*SELECT/i.test(queries[0].sql)).toBe(true);
    expect(queries.every((q) => !isWrite(q.sql))).toBe(true);
  });

  it('reports state "warming" once the engine accumulates', async () => {
    const warming = { ...COLD, trajectories_buffered: 5, patterns_stored: 2 };
    const { backend } = makeBackend((sql) => (isSonaStats(sql) ? { rows: [{ stats: warming, ewc: warming }] } : { rows: [] }));
    const res = await backend.memSonaHealth();
    expect(res.state).toBe('warming');
    expect(res.advisories.engine_not_accumulating).toBe(false);
  });

  it('fails open to { available:false } on any error', async () => {
    const { backend } = makeBackend((sql) => { if (isSonaStats(sql)) throw new Error('boom'); return { rows: [] }; });
    const res = await backend.memSonaHealth();
    expect(res.success).toBe(false);
    expect(res.available).toBe(false);
    expect(res.error).toMatch(/boom/);
  });

  it('reports unavailable when pg is down (never throws)', async () => {
    const { backend } = makeBackend(() => ({ rows: [] }), { pgOk: false });
    const res = await backend.memSonaHealth();
    expect(res.available).toBe(false);
  });
});
