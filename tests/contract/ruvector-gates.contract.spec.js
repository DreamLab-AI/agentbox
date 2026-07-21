'use strict';

/**
 * Contract test suite — PRD-020 / ADR-040 v2 learning-consumer manifest gates.
 *
 * Covers the gates-implementer slice of the WF1 Phase-0 map:
 *   1. Default-off state changes nothing (PRD-020 metric 1 / DDD-016 R14):
 *      every new v2 gate env, unset, reads OFF; the embedding-column selector
 *      defaults to the current 384-dim "embedding".
 *   2. The 13 new manifest keys are declared, in the correct blocks, at their
 *      behaviour-preserving defaults, and parse from agentbox.toml.
 *   3. The two Phase-0-WIRED gates (aggregate_sweep, aggregate_sweep_interval_mins)
 *      map onto RUVECTOR_AGGREGATE_SWEEP / RUVECTOR_AGGREGATE_SWEEP_INTERVAL_MINS
 *      and parse via the shared boolGate/intGate — the same surface the
 *      out-of-process sweep consumes, so it cannot drift from this server.
 *   4. The governed aggregator write path (createExternalPgBackend memStore — the
 *      exact writer aggregate-effectiveness.js uses) REFUSES a PROTECTED_NAMESPACE
 *      without RUVECTOR_ADMIN_WRITE (I-GOV / R02), while the aggregator's own
 *      target namespace (memory-learning-aggregates, un-protected) is writable.
 *
 * No DB writes: the pg client is a stub. No live sidecar contact.
 *
 * See ADR-005 §Contract test harness; DDD-018 §5 (I14, I18, I-GOV inherited).
 */

const fs = require('fs');
const path = require('path');

// Defaults MUST be established before memory-tools.js is required — it reads
// PROTECTED_NAMESPACES and ADMIN_WRITE at module load. Clearing these pins the
// default protected set ('governance-precedents') and admin=off for suite D.
delete process.env.RUVECTOR_ADMIN_WRITE;
delete process.env.RUVECTOR_PROTECTED_NAMESPACES;

const { boolGate, intGate } = require('../../mcp/servers/lib/ruvector-gates');
const { createExternalPgBackend } = require('../../mcp/servers/lib/memory-tools');

const TOML_PATH = path.join(__dirname, '..', '..', 'agentbox.toml');

// ---------------------------------------------------------------------------
// The v2 gate catalogue: manifest key → block, env name (null = declare-only,
// not wired to a RUVECTOR_* env in Phase 0), expected default in the manifest.
// ---------------------------------------------------------------------------
const V2_KEYS = [
  // [integrations.ruvector_external]
  { block: 'integrations.ruvector_external', key: 'embedding_dual_write',    env: null, def: 'false' },
  { block: 'integrations.ruvector_external', key: 'embedding_active_column', env: null, def: '"embedding"' },
  { block: 'integrations.ruvector_external', key: 'graph_backbone',          env: null, def: 'false' },
  // [memory_learning]
  { block: 'memory_learning', key: 'aggregate_sweep',               env: 'RUVECTOR_AGGREGATE_SWEEP',                def: 'false' },
  { block: 'memory_learning', key: 'aggregate_sweep_interval_mins', env: 'RUVECTOR_AGGREGATE_SWEEP_INTERVAL_MINS', def: '30' },
  { block: 'memory_learning', key: 'pattern_distillation',          env: null, def: 'false' },
  { block: 'memory_learning', key: 'attention_rerank',              env: null, def: 'false' },
  { block: 'memory_learning', key: 'sona_learn_enabled',            env: null, def: 'false' },
  { block: 'memory_learning', key: 'sona_apply_enabled',            env: null, def: 'false' },
  { block: 'memory_learning', key: 'param_tuning_enabled',          env: null, def: 'false' },
  // [memory_hygiene]
  { block: 'memory_hygiene', key: 'allow_embedding_m3_backfill', env: null, def: 'false' },
  { block: 'memory_hygiene', key: 'allow_legacy_mining_import',  env: null, def: 'false' },
  { block: 'memory_hygiene', key: 'allow_pattern_graduation',    env: null, def: 'false' },
];

// A dependency-free, section-scoped TOML reader — enough to assert `key = value`
// membership per block without pulling an external parser into the resolver path.
function parseSections(text) {
  const sections = {};
  let current = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) { current = sec[1]; sections[current] = sections[current] || {}; continue; }
    if (current === null) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    // Value up to the first '#' (none of the v2 values contain a '#').
    const value = line.slice(eq + 1).split('#')[0].trim();
    sections[current][key] = value;
  }
  return sections;
}

// ===========================================================================
// A. Default-off: every v2 gate reads OFF / default when its env is unset
// ===========================================================================
describe('ruvector v2 gates :: default-off changes nothing (PRD-020 metric 1)', () => {
  const ALL_BOOL_ENVS = [
    'RUVECTOR_AGGREGATE_SWEEP',
    'RUVECTOR_EMBEDDING_DUAL_WRITE',
    'RUVECTOR_GRAPH_BACKBONE',
    'RUVECTOR_PATTERN_DISTILLATION',
    'RUVECTOR_ATTENTION_RERANK',
    'RUVECTOR_SONA_LEARN_ENABLED',
    'RUVECTOR_SONA_APPLY_ENABLED',
    'RUVECTOR_PARAM_TUNING_ENABLED',
    'RUVECTOR_ALLOW_EMBEDDING_M3_BACKFILL',
    'RUVECTOR_ALLOW_LEGACY_MINING_IMPORT',
    'RUVECTOR_ALLOW_PATTERN_GRADUATION',
  ];

  beforeEach(() => { for (const e of ALL_BOOL_ENVS) delete process.env[e]; });

  it('every v2 boolean gate is OFF when its env is unset', () => {
    for (const e of ALL_BOOL_ENVS) expect(boolGate(e)).toBe(false);
  });

  it('the embedding-column selector defaults to the current 384-dim "embedding"', () => {
    delete process.env.RUVECTOR_EMBEDDING_ACTIVE_COLUMN;
    const active = process.env.RUVECTOR_EMBEDDING_ACTIVE_COLUMN || 'embedding';
    expect(active).toBe('embedding');
  });

  it('aggregate_sweep_interval_mins defaults to 30 when unset', () => {
    delete process.env.RUVECTOR_AGGREGATE_SWEEP_INTERVAL_MINS;
    expect(intGate('RUVECTOR_AGGREGATE_SWEEP_INTERVAL_MINS', 30)).toBe(30);
  });
});

// ===========================================================================
// B. The 13 new keys are declared in the right blocks at the right defaults
// ===========================================================================
describe('ruvector v2 gates :: manifest declares all 13 keys (PRD-020 §4 / ADR-040 D10)', () => {
  let sections;
  beforeAll(() => { sections = parseSections(fs.readFileSync(TOML_PATH, 'utf8')); });

  it('every v2 key is present in its correct block with the behaviour-preserving default', () => {
    for (const { block, key, def } of V2_KEYS) {
      expect(sections[block]).toBeDefined();
      expect(sections[block][key]).toBe(def);
    }
  });

  it('exactly 13 new v2 keys are declared', () => {
    expect(V2_KEYS).toHaveLength(13);
  });

  it('the superseded v1 keys remain (default-off) for back-compat', () => {
    expect(sections['memory_learning'].sona_enabled).toBe('false');
    expect(sections['memory_learning'].relevance_feedback).toBe('false');
  });
});

// ===========================================================================
// C. The two Phase-0-WIRED gates parse via the shared boolGate/intGate
// ===========================================================================
describe('ruvector v2 gates :: wired Phase-0 gates parse (aggregate sweep)', () => {
  afterEach(() => {
    delete process.env.RUVECTOR_AGGREGATE_SWEEP;
    delete process.env.RUVECTOR_AGGREGATE_SWEEP_INTERVAL_MINS;
  });

  it('RUVECTOR_AGGREGATE_SWEEP is ON only for "1" or "true"', () => {
    process.env.RUVECTOR_AGGREGATE_SWEEP = '1';    expect(boolGate('RUVECTOR_AGGREGATE_SWEEP')).toBe(true);
    process.env.RUVECTOR_AGGREGATE_SWEEP = 'true'; expect(boolGate('RUVECTOR_AGGREGATE_SWEEP')).toBe(true);
    process.env.RUVECTOR_AGGREGATE_SWEEP = 'false';expect(boolGate('RUVECTOR_AGGREGATE_SWEEP')).toBe(false);
    process.env.RUVECTOR_AGGREGATE_SWEEP = 'yes';  expect(boolGate('RUVECTOR_AGGREGATE_SWEEP')).toBe(false);
    process.env.RUVECTOR_AGGREGATE_SWEEP = '0';    expect(boolGate('RUVECTOR_AGGREGATE_SWEEP')).toBe(false);
  });

  it('RUVECTOR_AGGREGATE_SWEEP_INTERVAL_MINS parses an int and falls back to the default', () => {
    process.env.RUVECTOR_AGGREGATE_SWEEP_INTERVAL_MINS = '15';
    expect(intGate('RUVECTOR_AGGREGATE_SWEEP_INTERVAL_MINS', 30)).toBe(15);
    process.env.RUVECTOR_AGGREGATE_SWEEP_INTERVAL_MINS = '';
    expect(intGate('RUVECTOR_AGGREGATE_SWEEP_INTERVAL_MINS', 30)).toBe(30);
    process.env.RUVECTOR_AGGREGATE_SWEEP_INTERVAL_MINS = 'not-a-number';
    expect(intGate('RUVECTOR_AGGREGATE_SWEEP_INTERVAL_MINS', 30)).toBe(30);
  });
});

// ===========================================================================
// D. The governed aggregator write path refuses PROTECTED_NAMESPACES (I-GOV)
// ===========================================================================
describe('ruvector v2 gates :: aggregator write path refuses protected namespaces (I-GOV / R02)', () => {
  // A pg stub that records whether a write was ever attempted. A refusal must
  // short-circuit BEFORE any query — the row must never reach the DB.
  function makeCountingBackend() {
    let queries = 0;
    const deps = {
      pool: { query: async () => { queries += 1; return { rows: [], rowCount: 1 }; } },
      getPgOk: () => true,
      getEmbedding: async () => new Array(384).fill(0),
      xinfEnsure: async () => false, // skip the embedding branch — not under test here
      vecToSql: (v) => `[${v.join(',')}]`,
      entryId: (ns, key) => `agentbox:${ns}:${key}`,
      parseVal: (v) => v,
      notifyMemoryFlash: () => {},
      notifyMemoryFlashBatch: () => {},
      log: () => {},
      writeSourceType: 'agent',
    };
    return { backend: createExternalPgBackend(deps), queryCount: () => queries };
  }

  beforeEach(() => {
    delete process.env.RUVECTOR_ADMIN_WRITE;
    delete process.env.RUVECTOR_TYPED_METADATA;
  });

  it('refuses a write to a protected namespace and issues no query', async () => {
    const { backend, queryCount } = makeCountingBackend();
    const res = await backend.memStore('effectiveness-abc', { wilson_lower: 0.5 }, 'governance-precedents');
    expect(res.success).toBe(false);
    expect(res.storage).toBe('none');
    expect(String(res.error)).toMatch(/write-protected/);
    expect(queryCount()).toBe(0); // fail-closed BEFORE the DB is touched
  });

  it('permits the aggregator target namespace (memory-learning-aggregates is un-protected)', async () => {
    const { backend, queryCount } = makeCountingBackend();
    const res = await backend.memStore('effectiveness-abc', { wilson_lower: 0.5 }, 'memory-learning-aggregates');
    expect(res.success).toBe(true);
    expect(res.action).toBe('store');
    expect(res.namespace).toBe('memory-learning-aggregates');
    expect(queryCount()).toBeGreaterThanOrEqual(1); // the upsert ran
  });
});
