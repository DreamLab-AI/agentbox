'use strict';

/**
 * REC-7 — outcome learning made real (PRD-019 / ADR-037 D3 / DDD-016).
 *
 * Locks the two things the gap-close closure owns on agentbox's OWN trajectory
 * loop (the out-of-repo claude-flow-CLI intelligence banner is excluded, D3):
 *
 *   1. THE STATISTICAL FLOOR — the Wilson score-interval LOWER bound and the
 *      20-sample-per-pattern minimum. A pattern under the floor never becomes an
 *      eligible aggregate; a single degenerate label cannot move the needle.
 *
 *   2. GATE BEHAVIOUR — the two consumers stay OFF until turned on, and the gate
 *      state is inspectable (summariseGates). feed_retrieval only re-ranks when
 *      its gate is on; feed_routing only surfaces aggregates when its gate is on.
 *
 * These are pure/injected checks — no live pg, no live corpus.
 */

const agg = require('../../mcp/servers/lib/aggregate-effectiveness');
const { createHybridTools } = require('../../mcp/servers/lib/memory-hybrid');

// ── 1. Wilson lower bound (the floor's estimator) ───────────────────────────────
describe('REC-7 — Wilson score-interval lower bound', () => {
  test('n=0 → 0 (no evidence, no credit)', () => {
    expect(agg.wilsonLower(0, 0)).toBe(0);
  });

  test('always in [0,1] and strictly below the raw success rate', () => {
    const lo = agg.wilsonLower(9, 10);
    expect(lo).toBeGreaterThan(0);
    expect(lo).toBeLessThan(0.9);   // below the 0.9 raw rate — the conservative bound
    expect(lo).toBeLessThanOrEqual(1);
  });

  test('more samples at the same proportion → a HIGHER (tighter) lower bound', () => {
    const few = agg.wilsonLower(8, 10);       // 80% over 10
    const many = agg.wilsonLower(80, 100);    // 80% over 100
    expect(many).toBeGreaterThan(few);
  });

  test('a lone degenerate label (1/1 = 100% raw) is heavily discounted', () => {
    const lone = agg.wilsonLower(1, 1);       // "perfect" on one sample
    expect(lone).toBeLessThan(0.5);           // the bound refuses to trust it
  });

  test('works on fractional (recency-weighted) successes / effective n', () => {
    const lo = agg.wilsonLower(7.5, 12.3);
    expect(lo).toBeGreaterThan(0);
    expect(lo).toBeLessThan(7.5 / 12.3);
  });
});

// ── 2. computeRows: wilson keyed on recency-weighted succ/total, sorted ─────────
describe('REC-7 — computeRows derives wilson from the weighted corpus', () => {
  test('wilson = wilsonLower(w_succ, w_total); rows sorted by wilson desc', () => {
    const rows = agg.computeRows([
      { pattern: 'npm test',   n: '5',  w_total: '5',  w_succ: '5',  mean_quality: '1.0', last_seen: null },
      { pattern: 'git commit', n: '30', w_total: '28', w_succ: '25', mean_quality: '0.9', last_seen: null },
    ]);
    const gc = rows.find((r) => r.pattern === 'git commit');
    expect(gc.wilson).toBeCloseTo(agg.wilsonLower(25, 28), 6);
    // Sorted by wilson desc: the higher-wilson pattern is first.
    expect(rows[0].wilson).toBeGreaterThanOrEqual(rows[1].wilson);
  });
});

// ── 3. summariseGates: floor gating + gate-state inspectability ──────────────────
describe('REC-7 — summariseGates (gate state inspectable; floor-bound)', () => {
  const rowsBelow = [{ pattern: 'a', n: 5, wilson: 0.9 }, { pattern: 'b', n: 12, wilson: 0.8 }];
  const rowsCleared = [{ pattern: 'a', n: 25, wilson: 0.7 }, { pattern: 'b', n: 12, wilson: 0.8 }];

  test('floor NOT cleared when no pattern reaches the 20-sample minimum', () => {
    const s = agg.summariseGates(rowsBelow, { minSamples: 20, feedRetrieval: false, feedRouting: false });
    expect(s.floor_cleared).toBe(false);
    expect(s.patterns_cleared_floor).toBe(0);
    expect(s.premature_consumer_enabled).toBe(false);
  });

  test('floor cleared when a pattern reaches the minimum; eligible listed', () => {
    const s = agg.summariseGates(rowsCleared, { minSamples: 20, feedRetrieval: false, feedRouting: false });
    expect(s.floor_cleared).toBe(true);
    expect(s.patterns_cleared_floor).toBe(1);
    expect(s.eligible_patterns.map((p) => p.pattern)).toEqual(['a']);
    expect(s.gates).toEqual({ feed_retrieval: false, feed_routing: false });
  });

  test('a consumer gate ON while the floor is NOT cleared is flagged premature', () => {
    const s = agg.summariseGates(rowsBelow, { minSamples: 20, feedRetrieval: true, feedRouting: false });
    expect(s.premature_consumer_enabled).toBe(true);
  });

  test('reads the live gate env when the override is omitted', () => {
    const prevR = process.env.RUVECTOR_FEED_RETRIEVAL;
    const prevG = process.env.RUVECTOR_FEED_ROUTING;
    try {
      delete process.env.RUVECTOR_FEED_RETRIEVAL;
      delete process.env.RUVECTOR_FEED_ROUTING;
      const off = agg.summariseGates(rowsCleared, { minSamples: 20 });
      expect(off.gates).toEqual({ feed_retrieval: false, feed_routing: false });
      process.env.RUVECTOR_FEED_RETRIEVAL = '1';
      const on = agg.summariseGates(rowsCleared, { minSamples: 20 });
      expect(on.gates.feed_retrieval).toBe(true);
    } finally {
      if (prevR === undefined) delete process.env.RUVECTOR_FEED_RETRIEVAL; else process.env.RUVECTOR_FEED_RETRIEVAL = prevR;
      if (prevG === undefined) delete process.env.RUVECTOR_FEED_ROUTING; else process.env.RUVECTOR_FEED_ROUTING = prevG;
    }
  });
});

// ── 4. consumer gate behaviour (injected pool; no live pg) ───────────────────────
describe('REC-7 — feed_retrieval re-rank is gated OFF by default', () => {
  const AGG_NS = 'memory-learning-aggregates';

  function makeDeps(poolCalls) {
    const pool = {
      async query(sql, params) {
        poolCalls.push({ sql, params });
        if (params && params[0] === AGG_NS) {
          // the aggregates read (only reached when feed_retrieval is ON)
          return { rows: [{ tags: ['action:git commit'], wilson: 0.8 }] };
        }
        // the base hybrid search
        return {
          rows: [
            { key: 'm1', value: '{}', namespace: 'ns', source_type: 'agentbox', metadata: { tags: ['action:git commit'] }, vec_sim: 0.5, importance: 0.5, recency: 0.5, kw: 0, score: 0.50 },
            { key: 'm2', value: '{}', namespace: 'ns', source_type: 'agentbox', metadata: { tags: ['action:other'] },      vec_sim: 0.4, importance: 0.5, recency: 0.5, kw: 0, score: 0.40 },
          ],
        };
      },
    };
    return {
      pool,
      getPgOk: () => true,
      getEmbedding: async () => new Array(384).fill(0),
      xinfEnsure: async () => true,
      vecToSql: (a) => '[' + a.join(',') + ']',
      parseVal: (v) => v,
      log: () => {},
      memSearch: async () => ({ success: false }),
    };
  }

  let prev;
  beforeEach(() => { prev = process.env.RUVECTOR_FEED_RETRIEVAL; });
  afterEach(() => { if (prev === undefined) delete process.env.RUVECTOR_FEED_RETRIEVAL; else process.env.RUVECTOR_FEED_RETRIEVAL = prev; });

  test('gate OFF: no aggregates read, no effectiveness bonus (ranking unchanged)', async () => {
    delete process.env.RUVECTOR_FEED_RETRIEVAL;
    const calls = [];
    const { memHybridSearch } = createHybridTools(makeDeps(calls));
    const out = await memHybridSearch('anything', 'ns', 10);
    expect(out.success).toBe(true);
    // The aggregates namespace was NEVER queried.
    expect(calls.some((c) => c.params && c.params[0] === AGG_NS)).toBe(false);
    // No row carries an effectiveness bonus.
    expect(out.results.every((r) => !(r.components && r.components.effectiveness_bonus))).toBe(true);
  });

  test('gate ON: aggregates read, matching row gets +0.1·wilson and re-sorts to top', async () => {
    process.env.RUVECTOR_FEED_RETRIEVAL = '1';
    const calls = [];
    const { memHybridSearch } = createHybridTools(makeDeps(calls));
    const out = await memHybridSearch('anything', 'ns', 10);
    expect(calls.some((c) => c.params && c.params[0] === AGG_NS)).toBe(true);
    const m1 = out.results.find((r) => r.key === 'm1');
    expect(m1.components.effectiveness_bonus).toBeCloseTo(0.08, 6); // 0.1 · 0.8
    expect(out.results[0].key).toBe('m1'); // bonus lifted it above m2
  });
});

describe('REC-7 — feed_routing governs the orient aggregates bucket', () => {
  function makeDeps(captured) {
    return {
      pool: { async query(sql, params) { captured.push({ sql, params }); return { rows: [] }; } },
      getPgOk: () => true,
      getEmbedding: async () => new Array(384).fill(0),
      xinfEnsure: async () => false, // no semantic vector → simpler no-op sem CTE
      vecToSql: (a) => '[' + a.join(',') + ']',
      parseVal: (v) => v,
      log: () => {},
      memSearch: async () => ({ success: false }),
    };
  }

  let prev;
  beforeEach(() => { prev = process.env.RUVECTOR_FEED_ROUTING; });
  afterEach(() => { if (prev === undefined) delete process.env.RUVECTOR_FEED_ROUTING; else process.env.RUVECTOR_FEED_ROUTING = prev; });

  test('gate OFF: aggregates omitted with an explicit note; no aggregate CTE in the query', async () => {
    delete process.env.RUVECTOR_FEED_ROUTING;
    const captured = [];
    const { memOrient } = createHybridTools(makeDeps(captured));
    const bundle = await memOrient('a task', 'sess');
    expect(bundle.aggregates).toEqual([]);
    expect(bundle.aggregates_note).toMatch(/feed_routing off/);
    // The aggregate CTE is a typed no-op (WHERE false), not a real namespace read.
    expect(captured[0].sql).toMatch(/agg AS \(SELECT NULL::text AS key, NULL::jsonb AS value WHERE false\)/);
  });

  test('gate ON: the orient query reads the aggregates namespace; no off-note', async () => {
    process.env.RUVECTOR_FEED_ROUTING = '1';
    const captured = [];
    const { memOrient } = createHybridTools(makeDeps(captured));
    const bundle = await memOrient('a task', 'sess');
    expect(bundle.aggregates_note).toBeUndefined();
    expect(captured[0].sql).toMatch(/memory-learning-aggregates/);
  });
});
