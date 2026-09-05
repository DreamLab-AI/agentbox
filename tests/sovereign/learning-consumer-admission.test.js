'use strict';

/**
 * ADR-2017 — producer-before-consumer admission (closeout acceptance, 2026-09-05).
 *
 * The estate review reproduced two gaps: the validator's W066 was advisory (three
 * consumer-before-producer manifests exited zero), and the hybrid factory applied
 * an effectiveness bonus from a retained aggregate with recording off — with the
 * master learning flag both off and on.
 *
 * The chosen invariant is stated in mcp/servers/lib/ruvector-gates.js:
 * producer-before-consumer means a QUALIFIED RETAINED CORPUS. These tests lock
 * both halves of its enforcement — the runtime admission decision and the
 * consumer that obeys it — across the matrix the ADR names: master-off/consumer-on,
 * each consumer separately, stopped capture with retained aggregates, a missing
 * corpus, a stale corpus, and an environment override.
 */

const path = require('path');

const GATES = path.resolve(__dirname, '../../mcp/servers/lib/ruvector-gates.js');
const HYBRID = path.resolve(__dirname, '../../mcp/servers/lib/memory-hybrid.js');

const LEARNING_ENV = [
  'RUVECTOR_MEMORY_LEARNING_ENABLED',
  'RUVECTOR_RECORD_TRAJECTORIES',
  'RUVECTOR_FEED_RETRIEVAL',
  'RUVECTOR_FEED_ROUTING',
  'RUVECTOR_RETAINED_CORPUS_ACCEPTED',
  'RUVECTOR_RETAINED_CORPUS_MAX_AGE_DAYS',
];

let saved;
beforeEach(() => {
  saved = {};
  for (const k of LEARNING_ENV) { saved[k] = process.env[k]; delete process.env[k]; }
  jest.resetModules();
});
afterEach(() => {
  for (const k of LEARNING_ENV) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

function env(o) { for (const [k, v] of Object.entries(o)) process.env[k] = v; }
function gates() { return require(GATES); }

const DAYS = 86400000;
const fresh = () => new Date(Date.now() - 1 * DAYS);
const stale = () => new Date(Date.now() - 400 * DAYS);

describe('ADR-2017 consumerAdmission — the runtime admission decision', () => {
  test('consumer gate off admits nothing (and never reaches the master check)', () => {
    env({ RUVECTOR_MEMORY_LEARNING_ENABLED: '1', RUVECTOR_RECORD_TRAJECTORIES: '1' });
    const a = gates().consumerAdmission('feed_retrieval');
    expect(a.admitted).toBe(false);
    expect(a.reason).toBe('consumer-gate-off');
  });

  test('MASTER OFF + consumer on is refused — the reproduced defect', () => {
    env({ RUVECTOR_FEED_RETRIEVAL: '1', RUVECTOR_RECORD_TRAJECTORIES: '1' });
    const a = gates().consumerAdmission('feed_retrieval');
    expect(a.admitted).toBe(false);
    expect(a.reason).toBe('master-learning-off');
  });

  test('active capture admits the consumer', () => {
    env({ RUVECTOR_MEMORY_LEARNING_ENABLED: 'true', RUVECTOR_RECORD_TRAJECTORIES: 'true', RUVECTOR_FEED_RETRIEVAL: 'true' });
    const a = gates().consumerAdmission('feed_retrieval');
    expect(a).toMatchObject({ admitted: true, reason: 'active-capture' });
  });

  test('stopped capture with NO corpus acceptance is refused', () => {
    env({ RUVECTOR_MEMORY_LEARNING_ENABLED: '1', RUVECTOR_FEED_RETRIEVAL: '1' });
    const a = gates().consumerAdmission('feed_retrieval', { corpusLastUpdated: fresh(), corpusSize: 42 });
    expect(a.admitted).toBe(false);
    expect(a.reason).toBe('producer-off-and-retained-corpus-not-accepted');
  });

  test('stopped capture WITH an accepted, fresh, non-empty corpus is admitted and records the receipt', () => {
    env({ RUVECTOR_MEMORY_LEARNING_ENABLED: '1', RUVECTOR_FEED_RETRIEVAL: '1', RUVECTOR_RETAINED_CORPUS_ACCEPTED: 'receipt-2026-09-05' });
    const a = gates().consumerAdmission('feed_retrieval', { corpusLastUpdated: fresh(), corpusSize: 42 });
    expect(a.admitted).toBe(true);
    expect(a.reason).toBe('retained-corpus-accepted');
    expect(a.receipt).toBe('receipt-2026-09-05');
  });

  test('an accepted but STALE corpus is refused', () => {
    env({ RUVECTOR_MEMORY_LEARNING_ENABLED: '1', RUVECTOR_FEED_RETRIEVAL: '1', RUVECTOR_RETAINED_CORPUS_ACCEPTED: 'r1' });
    const a = gates().consumerAdmission('feed_retrieval', { corpusLastUpdated: stale(), corpusSize: 42 });
    expect(a.admitted).toBe(false);
    expect(a.reason).toBe('retained-corpus-stale');
    expect(a.corpus_age_days).toBeGreaterThan(a.max_age_days);
  });

  test('an accepted but EMPTY corpus is refused', () => {
    env({ RUVECTOR_MEMORY_LEARNING_ENABLED: '1', RUVECTOR_FEED_RETRIEVAL: '1', RUVECTOR_RETAINED_CORPUS_ACCEPTED: 'r1' });
    const a = gates().consumerAdmission('feed_retrieval', { corpusLastUpdated: fresh(), corpusSize: 0 });
    expect(a.admitted).toBe(false);
    expect(a.reason).toBe('retained-corpus-empty');
  });

  test('an UNDATEABLE corpus is refused rather than assumed fresh', () => {
    env({ RUVECTOR_MEMORY_LEARNING_ENABLED: '1', RUVECTOR_FEED_RETRIEVAL: '1', RUVECTOR_RETAINED_CORPUS_ACCEPTED: 'r1' });
    const a = gates().consumerAdmission('feed_retrieval', { corpusLastUpdated: null });
    expect(a.admitted).toBe(false);
    expect(a.reason).toBe('retained-corpus-freshness-unknown');
  });

  test('the max-age override is honoured (an env override tightens, it does not bypass)', () => {
    env({
      RUVECTOR_MEMORY_LEARNING_ENABLED: '1', RUVECTOR_FEED_RETRIEVAL: '1',
      RUVECTOR_RETAINED_CORPUS_ACCEPTED: 'r1', RUVECTOR_RETAINED_CORPUS_MAX_AGE_DAYS: '2',
    });
    const g = gates();
    expect(g.consumerAdmission('feed_retrieval', { corpusLastUpdated: new Date(Date.now() - 5 * DAYS), corpusSize: 1 }).reason)
      .toBe('retained-corpus-stale');
    expect(g.consumerAdmission('feed_retrieval', { corpusLastUpdated: new Date(Date.now() - 0.5 * DAYS), corpusSize: 1 }).admitted)
      .toBe(true);
  });

  test('there is NO boolean that bypasses acceptance — a truthy-looking value is still a receipt id', () => {
    env({ RUVECTOR_MEMORY_LEARNING_ENABLED: '1', RUVECTOR_FEED_RETRIEVAL: '1', RUVECTOR_RETAINED_CORPUS_ACCEPTED: '   ' });
    const a = gates().consumerAdmission('feed_retrieval', { corpusLastUpdated: fresh(), corpusSize: 9 });
    expect(a.reason).toBe('producer-off-and-retained-corpus-not-accepted');
  });

  test('each consumer is decided separately', () => {
    env({ RUVECTOR_MEMORY_LEARNING_ENABLED: '1', RUVECTOR_RECORD_TRAJECTORIES: '1', RUVECTOR_FEED_RETRIEVAL: '1' });
    const g = gates();
    expect(g.consumerAdmission('feed_retrieval').admitted).toBe(true);
    expect(g.consumerAdmission('feed_routing').reason).toBe('consumer-gate-off');
  });
});

// ── the consumer that obeys the decision ────────────────────────────────────
// A pool stub returning one high-effectiveness aggregate — the "invented
// existing aggregate" shape the review used to raise 0.5 to 0.58.

function hybridWith({ updatedAt = fresh(), rows = 1 } = {}) {
  const aggRows = [];
  for (let i = 0; i < rows; i++) {
    aggRows.push({ tags: ['action:git commit [args:1 flags:0]'], wilson: '0.8', updated_at: updatedAt });
  }
  const queries = [];
  const pool = {
    query: async (sql, params) => { queries.push({ sql, params }); return { rows: aggRows }; },
  };
  const { createHybridTools } = require(HYBRID);
  const tools = createHybridTools({
    pool,
    getPgOk: () => true,
    getEmbedding: async () => new Array(384).fill(0.1),
    xinfEnsure: async () => true,
    vecToSql: (a) => `[${a.join(',')}]`,
    parseVal: (v) => v,
    log: () => {},
    memSearch: async () => ({ success: true, results: [] }),
  });
  return { tools, queries };
}

function oneResult() {
  return [{ key: 'k', score: 0.5, metadata: { tags: ['action:git commit [args:1 flags:0]'] } }];
}

describe('ADR-2017 — the effectiveness bonus obeys admission, not the bare gate', () => {
  test('recording OFF, master OFF, no acceptance → score untouched (was 0.5 → 0.58)', async () => {
    env({ RUVECTOR_FEED_RETRIEVAL: '1' });
    const { tools, queries } = hybridWith();
    const out = await tools.applyEffectivenessBonus(oneResult());
    expect(out[0].score).toBe(0.5);
    expect(out[0].components).toBeUndefined();
    expect(queries.length).toBe(0);
  });

  test('recording OFF, master ON, no acceptance → score untouched and no corpus read', async () => {
    env({ RUVECTOR_MEMORY_LEARNING_ENABLED: '1', RUVECTOR_FEED_RETRIEVAL: '1' });
    const { tools, queries } = hybridWith();
    const out = await tools.applyEffectivenessBonus(oneResult());
    expect(out[0].score).toBe(0.5);
    expect(queries.length).toBe(0);
  });

  test('recording ON → the bonus applies and records its admission provenance', async () => {
    env({ RUVECTOR_MEMORY_LEARNING_ENABLED: '1', RUVECTOR_RECORD_TRAJECTORIES: '1', RUVECTOR_FEED_RETRIEVAL: '1' });
    const { tools } = hybridWith();
    const out = await tools.applyEffectivenessBonus(oneResult());
    expect(out[0].score).toBeCloseTo(0.58, 6);
    expect(out[0].components.effectiveness_bonus).toBeCloseTo(0.08, 6);
    expect(out[0].components.effectiveness_admission).toBe('active-capture');
  });

  test('recording OFF with an ACCEPTED FRESH corpus → the bonus applies, carrying the receipt', async () => {
    env({ RUVECTOR_MEMORY_LEARNING_ENABLED: '1', RUVECTOR_FEED_RETRIEVAL: '1', RUVECTOR_RETAINED_CORPUS_ACCEPTED: 'rcpt-9' });
    const { tools } = hybridWith({ updatedAt: fresh() });
    const out = await tools.applyEffectivenessBonus(oneResult());
    expect(out[0].score).toBeCloseTo(0.58, 6);
    expect(out[0].components.effectiveness_admission).toBe('retained-corpus-accepted');
    expect(out[0].components.effectiveness_corpus_receipt).toBe('rcpt-9');
  });

  test('recording OFF with an ACCEPTED but STALE corpus → withheld, and says why', async () => {
    env({ RUVECTOR_MEMORY_LEARNING_ENABLED: '1', RUVECTOR_FEED_RETRIEVAL: '1', RUVECTOR_RETAINED_CORPUS_ACCEPTED: 'rcpt-9' });
    const { tools } = hybridWith({ updatedAt: stale() });
    const out = await tools.applyEffectivenessBonus(oneResult());
    expect(out[0].score).toBe(0.5);
    expect(out[0].components.effectiveness_bonus_withheld).toBe('retained-corpus-stale');
  });

  test('recording OFF with an accepted but EMPTY corpus → withheld', async () => {
    env({ RUVECTOR_MEMORY_LEARNING_ENABLED: '1', RUVECTOR_FEED_RETRIEVAL: '1', RUVECTOR_RETAINED_CORPUS_ACCEPTED: 'rcpt-9' });
    const { tools } = hybridWith({ rows: 0 });
    const out = await tools.applyEffectivenessBonus(oneResult());
    expect(out[0].score).toBe(0.5);
    expect(out[0].components.effectiveness_bonus_withheld).toBe('retained-corpus-empty');
  });
});

// ── the validator half ──────────────────────────────────────────────────────
describe('ADR-2017 — the validator enforces the same invariant statically', () => {
  const { spawnSync } = require('child_process');
  const fs = require('fs');
  const os = require('os');
  const VALIDATOR = path.resolve(__dirname, '../../scripts/agentbox-config-validate.js');

  // Both streams matter: the validator prints diagnostics on stderr and the
  // verdict line on stdout, so a stdout-only capture would silently miss W066.
  function runValidator(mlBody) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr2017-'));
    const file = path.join(dir, 'agentbox.toml');
    fs.writeFileSync(file, `[memory_learning]\n${mlBody}\n`);
    try {
      const r = spawnSync('node', [VALIDATOR, file], { encoding: 'utf8' });
      return { code: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  test('consumer ahead of producer with no acceptance is now BLOCKING (E066), not advisory', () => {
    const r = runValidator('enabled = true\nrecord_trajectories = false\nfeed_retrieval = true');
    expect(r.out).toMatch(/E066/);
    expect(r.code).not.toBe(0);
  });

  test('each consumer alone trips it, and both are named together', () => {
    expect(runValidator('enabled = true\nrecord_trajectories = false\nfeed_routing = true').out).toMatch(/E066/);
    const both = runValidator('enabled = true\nrecord_trajectories = false\nfeed_retrieval = true\nfeed_routing = true').out;
    expect(both).toMatch(/feed_retrieval and feed_routing/);
  });

  test('declaring a retained-corpus receipt downgrades it to advisory W066', () => {
    const r = runValidator('enabled = true\nrecord_trajectories = false\nfeed_retrieval = true\nretained_corpus_accepted = "rcpt-2026-09-05"');
    expect(r.out).toMatch(/W066/);
    expect(r.out).not.toMatch(/E066/);
  });

  test('a consumer behind an OFF master gate is E067 even with an accepted corpus', () => {
    const r = runValidator('enabled = false\nrecord_trajectories = false\nfeed_retrieval = true\nretained_corpus_accepted = "rcpt"');
    expect(r.out).toMatch(/E067/);
    expect(r.code).not.toBe(0);
  });

  test('the producer-on control and the all-off control stay clean', () => {
    expect(runValidator('enabled = true\nrecord_trajectories = true\nfeed_retrieval = true').out).not.toMatch(/E066|W066|E067/);
    expect(runValidator('enabled = false\nrecord_trajectories = false').out).not.toMatch(/E066|W066|E067/);
  });
});
