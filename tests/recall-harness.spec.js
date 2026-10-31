'use strict';
/**
 * tests/recall-harness.spec.js — pure-function unit tests for the recall
 * regression harness (scripts/ruvector-recall-harness.mjs, ADR-040 D2 / W-B).
 *
 * No DB, no network: these cover only the deterministic scoring/allocation
 * helpers the harness exports (median-of-N, set-intersection recall, the
 * stratified allocator, the band verdict, and the fixture hash). The DB-bound
 * measurement paths are proven separately by a live `agentbox.sh ruvector recall`
 * run against the sidecar.
 *
 * Run with node's built-in runner (no jest dependency):
 *   node --test tests/recall-harness.spec.js
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { join } = require('node:path');

// The harness is ESM (.mjs); load it via dynamic import (CJS-safe). Importing it
// is side-effect-free — main() is guarded behind an invoked-directly check.
const HARNESS = pathToFileURL(join(__dirname, '..', 'scripts', 'ruvector-recall-harness.mjs')).href;
let H;
async function harness() { if (!H) H = await import(HARNESS); return H; }

test('median: odd length returns the middle element', async () => {
  const { median } = await harness();
  assert.equal(median([187, 141, 200]), 187);        // sorts to [141,187,200]
  assert.equal(median([5]), 5);
});

test('median: even length averages the two middle values', async () => {
  const { median } = await harness();
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test('median: empty / all-non-finite → null; NaNs filtered out', async () => {
  const { median } = await harness();
  assert.equal(median([]), null);
  assert.equal(median([NaN, undefined, null]), null);
  assert.equal(median([10, NaN, 20, 30]), 20);        // NaN dropped → [10,20,30]
});

test('intersectionRecall: |retrieved∩gt| / min(k,|gt|)', async () => {
  const { intersectionRecall } = await harness();
  // 3 of the 3 ground-truth keys recovered in the top-10 → 3/min(10,3)=1
  assert.equal(intersectionRecall(['a', 'b', 'c', 'x', 'y'], new Set(['a', 'b', 'c']), 10), 1);
  // only 1 of 2 gt keys present → 1/2
  assert.equal(intersectionRecall(['a', 'z'], new Set(['a', 'b']), 10), 0.5);
  // empty ground truth → null (no denominator; never counted as a pass or fail)
  assert.equal(intersectionRecall(['a'], new Set(), 10), null);
});

test('intersectionRecall: honours the top-k truncation', async () => {
  const { intersectionRecall } = await harness();
  // gt key 'c' sits at rank 3 but k=2 → only ranks 1-2 counted → 0 hits
  assert.equal(intersectionRecall(['x', 'y', 'c'], new Set(['c']), 2), 0);
  assert.equal(intersectionRecall(['c', 'y', 'x'], new Set(['c']), 2), 1);
});

test('allocateStratified: floor honoured, cap honoured, sums to total', async () => {
  const { allocateStratified } = await harness();
  const sizes = { 'ruvnet-kb': 131987, 'knowledge/pages': 20119, small: 60, tiny: 55 };
  const alloc = allocateStratified(200, sizes, { cap: { 'ruvnet-kb': 80 }, floor: 1 });
  const sum = Object.values(alloc).reduce((s, x) => s + x, 0);
  assert.equal(sum, 200, 'allocation sums to the requested total');
  assert.equal(alloc['ruvnet-kb'], 80, 'dominant namespace clamped at its cap');
  for (const ns of Object.keys(sizes)) {
    assert.ok(alloc[ns] >= 1, `${ns} keeps its ≥1 floor`);
    assert.ok(alloc[ns] <= sizes[ns], `${ns} never exceeds its own row count`);
  }
});

test('allocateStratified: never exceeds a namespace row count even when small', async () => {
  const { allocateStratified } = await harness();
  // total 100 but only 30 rows across all namespaces → capacity-bounded
  const alloc = allocateStratified(100, { a: 10, b: 12, c: 8 }, { floor: 1 });
  assert.equal(alloc.a, 10);
  assert.equal(alloc.b, 12);
  assert.equal(alloc.c, 8);
});

test('verdictFromMedians: PASS only when all three classes clear the band', async () => {
  const { verdictFromMedians } = await harness();
  const band = { self_recall_min: 187, self_recall_of: 200, true_recall_min: 118, true_recall_of: 120, exact_token_hybrid_delta_min: 0 };
  assert.equal(verdictFromMedians({ self_recall: 188, true_recall: 119, exact_token_delta: 2 }, band).pass, true);
  assert.equal(verdictFromMedians({ self_recall: 187, true_recall: 118, exact_token_delta: 0 }, band).pass, true, 'exact band edges are inclusive');
});

test('verdictFromMedians: any class below band → FAIL with a reason', async () => {
  const { verdictFromMedians } = await harness();
  const band = { self_recall_min: 187, self_recall_of: 200, true_recall_min: 118, true_recall_of: 120, exact_token_hybrid_delta_min: 0 };
  const selfFail = verdictFromMedians({ self_recall: 141, true_recall: 119, exact_token_delta: 6 }, band);
  assert.equal(selfFail.pass, false);
  assert.match(selfFail.reasons.join(' '), /self-recall/);
  assert.equal(verdictFromMedians({ self_recall: 188, true_recall: 87, exact_token_delta: 6 }, band).pass, false);
  // a negative hybrid delta (hybrid traded away exact-token recall) fails
  assert.equal(verdictFromMedians({ self_recall: 188, true_recall: 119, exact_token_delta: -1 }, band).pass, false);
});

test('verdictFromMedians: null exact-token delta is a FAIL, never a silent pass', async () => {
  const { verdictFromMedians } = await harness();
  const band = { self_recall_min: 187, self_recall_of: 200, true_recall_min: 118, true_recall_of: 120, exact_token_hybrid_delta_min: 0 };
  const v = verdictFromMedians({ self_recall: 200, true_recall: 120, exact_token_delta: null }, band);
  assert.equal(v.pass, false);
  assert.match(v.reasons.join(' '), /exact-token/);
});

test('fixtureHash: deterministic, and changes when the id set changes', async () => {
  const { fixtureHash } = await harness();
  const fx = {
    self_recall: { ids: ['a', 'b'] },
    true_recall: { ids: ['c'] },
    exact_token: [{ token: 'HNSW', namespace: 'projects/ruvector' }],
    baseline: { self_recall: [188, 200] },
    band: { self_recall_min: 187 },
  };
  const h1 = fixtureHash(fx);
  assert.match(h1, /^sha256-[0-9a-f]{64}$/);
  assert.equal(h1, fixtureHash(fx), 'stable across calls');
  const fx2 = { ...fx, self_recall: { ids: ['a', 'b', 'z'] } };
  assert.notEqual(h1, fixtureHash(fx2), 'a changed id list changes the hash');
});

// ── fixture v2 (ADR-2018 amendment, 2026-10-31) ───────────────────────────────
// Negatives, min_docs, stale-gold exclusion. No live DB: the pool is an in-memory
// fake that answers the one existence query, and memSearch is a scripted fake.
// v1 behaviour is pinned by the tests above plus the frozen-hash test below.

const { readFileSync, writeFileSync, mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { spawnSync } = require('node:child_process');

const g = (ns, key, doc) => ({ namespace: ns, key, ...(doc ? { doc } : {}) });
const V2_BAND = { positive_hit_rate_min: 0.5, negative_pass_rate_min: 1, max_stale_gold_fraction: 0.25, median_of: 3, k: 10 };
const keyOf = (x) => `${x.namespace}\u0000${x.key}`;

function v2Fixture(cases, band = V2_BAND) {
  return { schema: 'ruvector-recall-fixture/v2', version: 2, built_at: '2026-10-31T00:00:00Z', embedding: { model: 'bge-small-en-v1.5', dim: 384 }, relevance_floor: 0.55, band, baseline: null, cases };
}
async function sealed(cases, band) {
  const { fixtureHashV2 } = await harness();
  const fx = v2Fixture(cases, band);
  fx.fixture_hash = fixtureHashV2(fx);
  return fx;
}
// existing: array of {namespace,key} present in the fake memory_entries
function fakePool(existing) {
  const have = new Set(existing.map(keyOf));
  return {
    queries: 0,
    async query(sql, params) {
      assert.match(sql, /^\s*SELECT namespace, key FROM memory_entries/, 'v2 only issues the read-only existence SELECT');
      assert.doesNotMatch(sql, /INSERT|UPDATE|DELETE|CREATE|ALTER|DROP/i);
      this.queries++;
      const rows = [];
      params[0].forEach((ns, i) => { if (have.has(`${ns}\u0000${params[1][i]}`)) rows.push({ namespace: ns, key: params[1][i] }); });
      return { rows };
    },
  };
}
// script: query -> [{namespace,key,score}]
function fakeMem(script) {
  return { memSearch: async (q) => ({ success: true, results: (script[q] || []).map((r) => ({ ...r })) }) };
}
const stubBinding = async () => ({ embedding: { model: 'bge-small-en-v1.5', fingerprint: 'fp', state: 'pinned', ok: true }, corpus: { revision: 'corpus-x', embedded: 1, memory_entries: 1, pending_embeddings: 0 }, filters: {}, gates: {} });

test('v2: negative passes only when nothing clears the floor; a result at the floor fails it', async () => {
  const { runHarnessV2 } = await harness();
  const fx = await sealed([{ id: 'n1', query: 'nothing here', negative: true }, { id: 'n2', query: 'at floor', negative: true }, { id: 'n3', query: 'weak', negative: true }]);
  const mem = fakeMem({
    'nothing here': [],
    'at floor': [{ namespace: 'a', key: 'x', score: 0.55 }],
    'weak': [{ namespace: 'a', key: 'y', score: 0.549 }, { namespace: 'a', key: 'z', score: 0.4 }],
  });
  const r = await runHarnessV2({ pool: fakePool([]), memTools: mem, collectBinding: stubBinding, xinfEnsure: async () => true }, fx, { runs: 1, k: 10 });
  const byId = Object.fromEntries(r.runs_detail[0].cases.map((c) => [c.id, c]));
  assert.equal(byId.n1.pass, true);
  assert.equal(byId.n2.pass, false, 'score == floor clears it');
  assert.deepEqual(byId.n2.offenders.map((o) => o.key), ['x']);
  assert.equal(byId.n3.pass, true, 'only sub-floor noise');
  assert.equal(r.medians.negative_pass_rate, 2 / 3);
  assert.equal(r.verdict.pass, false);
});

test('v2: a degraded or failed search is never a negative pass', async () => {
  const { runHarnessV2 } = await harness();
  const fx = await sealed([{ id: 'n1', query: 'q1', negative: true }, { id: 'n2', query: 'q2', negative: true }]);
  const mem = { memSearch: async (q) => (q === 'q1' ? { success: true, degraded: true, results: [] } : { success: false, error: 'pg unavailable' }) };
  const r = await runHarnessV2({ pool: fakePool([]), memTools: mem, collectBinding: stubBinding, xinfEnsure: async () => false }, fx, { runs: 1, k: 10 });
  assert.equal(r.runs_detail[0].negative.passes, 0);
  assert.match(r.runs_detail[0].cases[0].error, /degraded/);
  assert.equal(r.config.xinference, 'DOWN');
});

test('v2: min_docs counts DISTINCT gold source pages, not chunks, and only above the floor', async () => {
  const { runHarnessV2 } = await harness();
  const gold = [g('kp', 'pageA#1', 'pageA'), g('kp', 'pageA#2', 'pageA'), g('kp', 'pageB#1', 'pageB')];
  const fx = await sealed([
    { id: 'two-docs', query: 'both', min_docs: 2, gold },
    { id: 'chunks-only', query: 'dupes', min_docs: 2, gold },
    { id: 'one-doc', query: 'one', gold },
    { id: 'below-floor', query: 'weak', min_docs: 2, gold },
  ]);
  const mem = fakeMem({
    both: [{ namespace: 'kp', key: 'pageA#1', score: 0.9 }, { namespace: 'kp', key: 'pageB#1', score: 0.7 }],
    dupes: [{ namespace: 'kp', key: 'pageA#1', score: 0.9 }, { namespace: 'kp', key: 'pageA#2', score: 0.8 }],
    one: [{ namespace: 'kp', key: 'pageA#2', score: 0.6 }],
    weak: [{ namespace: 'kp', key: 'pageA#1', score: 0.9 }, { namespace: 'kp', key: 'pageB#1', score: 0.5 }],
  });
  const pool = fakePool(gold);
  const r = await runHarnessV2({ pool, memTools: mem, collectBinding: stubBinding, xinfEnsure: async () => true }, fx, { runs: 1, k: 10 });
  const c = Object.fromEntries(r.runs_detail[0].cases.map((x) => [x.id, x]));
  assert.equal(c['two-docs'].pass, true);
  assert.equal(c['chunks-only'].pass, false);
  assert.equal(c['chunks-only'].docs_found, 1);
  assert.equal(c['one-doc'].pass, true);
  assert.equal(c['below-floor'].pass, false);
  assert.equal(c['below-floor'].docs_found_ignoring_floor, 2, 'diagnostic keeps the unfloored view');
  assert.equal(r.medians.positive_hit_rate, 0.5);
});

test('v2: stale gold is excluded from the denominators, counted separately, not a silent miss', async () => {
  const { runHarnessV2, partitionGold, checkGoldExistence } = await harness();
  const fx = await sealed([
    { id: 'live', query: 'qa', gold: [g('kp', 'a')] },
    { id: 'half', query: 'qb', gold: [g('kp', 'b1'), g('kp', 'b2')] },
    { id: 'dead', query: 'qc', gold: [g('kp', 'c')] },
    { id: 'dead-min', query: 'qd', min_docs: 2, gold: [g('kp', 'd1'), g('kp', 'd2')] },
  ], { ...V2_BAND, max_stale_gold_fraction: 1 });
  const existing = [g('kp', 'a'), g('kp', 'b1'), g('kp', 'd1')]; // b2, c, d2 are gone
  const pool = fakePool(existing);
  const part = partitionGold(fx, await checkGoldExistence(pool, fx));
  assert.deepEqual(part.stale.stale_cases, ['dead', 'dead-min'], 'a case whose live gold cannot satisfy min_docs is excluded whole');
  assert.equal(part.stale.gold_total, 6);
  assert.equal(part.stale.stale_gold, 3);
  assert.equal(part.stale.stale_fraction, 0.5);
  const mem = fakeMem({ qa: [{ namespace: 'kp', key: 'a', score: 0.9 }], qb: [{ namespace: 'kp', key: 'b1', score: 0.9 }] });
  const r = await runHarnessV2({ pool, memTools: mem, collectBinding: stubBinding, xinfEnsure: async () => true }, fx, { runs: 3, k: 10 });
  assert.equal(r.runs_detail[0].positive.of, 2, 'denominator is the 2 scorable cases, not 4');
  assert.equal(r.medians.positive_hit_rate, 1, 'stale gold did not lower the rate');
  assert.equal(r.stale_gold.stale_gold, 3);
  assert.deepEqual(r.stale_gold.stale_gold_entries.map((e) => e.key).sort(), ['c', 'd2', 'b2'].sort());
});

test('v2: stale gold above the configured fraction fails the verdict even with perfect hits', async () => {
  const { runHarnessV2 } = await harness();
  const fx = await sealed([
    { id: 'ok', query: 'q', gold: [g('kp', 'a')] },
    { id: 'gone', query: 'q2', gold: [g('kp', 'z')] },
  ], { ...V2_BAND, negative_pass_rate_min: null, max_stale_gold_fraction: 0.25 });
  const r = await runHarnessV2({ pool: fakePool([g('kp', 'a')]), memTools: fakeMem({ q: [{ namespace: 'kp', key: 'a', score: 0.9 }] }), collectBinding: stubBinding, xinfEnsure: async () => true }, fx, { runs: 1, k: 10 });
  assert.equal(r.medians.positive_hit_rate, 1);
  assert.equal(r.verdict.pass, false);
  assert.match(r.verdict.reasons.join(' '), /stale gold 1\/2 .*exceeds the 25\.0% bound/);
});

test('v2: a required class with no scorable case fails (empty denominator is never a pass)', async () => {
  const { verdictV2 } = await harness();
  const band = { positive_hit_rate_min: 0.5, negative_pass_rate_min: 1, max_stale_gold_fraction: 1 };
  const stale = { stale_gold: 1, gold_total: 1, stale_fraction: 1 };
  assert.equal(verdictV2({ positive_hit_rate: null, negative_pass_rate: 1 }, band, stale, { positive: 1, negative: 1 }).pass, false);
  assert.equal(verdictV2({ positive_hit_rate: 1, negative_pass_rate: null }, band, stale, { positive: 1, negative: 0 }).pass, false);
  assert.equal(verdictV2({ positive_hit_rate: 1, negative_pass_rate: null }, { ...band, negative_pass_rate_min: null }, stale, { positive: 1, negative: 0 }).pass, true);
});

test('v2: validateFixtureV2 rejects malformed cases', async () => {
  const { validateFixtureV2 } = await harness();
  const bad = v2Fixture([
    { id: 'a', query: 'q', negative: true, gold: [g('n', 'k')] },
    { id: 'a', query: '', gold: [] },
    { id: 'c', query: 'q', min_docs: 3, gold: [g('n', 'k1'), g('n', 'k2')] },
  ]);
  const errs = validateFixtureV2(bad).join(' | ');
  assert.match(errs, /negative case must not carry gold/);
  assert.match(errs, /duplicate id/);
  assert.match(errs, /min_docs 3 exceeds the 2 distinct gold doc/);
  assert.deepEqual(validateFixtureV2(await sealed([{ id: 'x', query: 'q', gold: [g('n', 'k')] }])), []);
});

test('v2: fixtureHashV2 binds cases, band and floor but not the baseline', async () => {
  const { fixtureHashV2 } = await harness();
  const a = await sealed([{ id: 'x', query: 'q', gold: [g('n', 'k')] }]);
  const h = fixtureHashV2(a);
  assert.match(h, /^sha256-[0-9a-f]{64}$/);
  assert.equal(h, fixtureHashV2({ ...a, baseline: { positive_hit_rate: 0.9 } }));
  assert.notEqual(h, fixtureHashV2({ ...a, relevance_floor: 0.6 }));
  assert.notEqual(h, fixtureHashV2({ ...a, band: { ...a.band, positive_hit_rate_min: 0.1 } }));
  assert.notEqual(h, fixtureHashV2({ ...a, cases: [{ id: 'x', query: 'q2', gold: [g('n', 'k')] }] }));
});

test('v2: buildFixtureV2 resolves gold_match read-only, verifies gold, and refuses missing gold', async () => {
  const { buildFixtureV2, validateFixtureV2 } = await harness();
  const rows = [{ namespace: 'kp', key: 'Page#1' }, { namespace: 'kp', key: 'Page#2' }];
  const seen = [];
  const pool = {
    async query(sql, params) {
      seen.push(sql);
      assert.doesNotMatch(sql, /INSERT|UPDATE|DELETE|CREATE|ALTER|DROP/i);
      if (/ILIKE/.test(sql)) return { rows };
      const have = new Set(rows.map(keyOf).concat([keyOf({ namespace: 'kp', key: 'Solo' })]));
      return { rows: params[0].map((ns, i) => ({ namespace: ns, key: params[1][i] })).filter((x) => have.has(keyOf(x))) };
    },
  };
  const fx = await buildFixtureV2(pool, { cases: [
    { id: 'm', query: 'q', namespace: 'kp', min_docs: 1, gold_match: { namespace: 'kp', ilike: 'zzz', doc_regex: '^([^#]+)#' } },
    { id: 'solo', query: 'q2', gold: [g('kp', 'Solo')] },
    { id: 'neg', query: 'unrelated', negative: true },
  ] });
  assert.deepEqual(validateFixtureV2(fx), []);
  assert.deepEqual(fx.cases[0].gold.map((x) => x.doc), ['Page', 'Page']);
  assert.equal(fx.cases[2].negative, true);
  assert.equal(fx.relevance_floor, 0.55);
  assert.match(fx.fixture_hash, /^sha256-/);
  await assert.rejects(buildFixtureV2(pool, { cases: [{ id: 'bad', query: 'q', gold: [g('kp', 'Missing')] }] }), /not present in memory_entries/);
});

test('v1 is untouched: the checked-in v1 fixture still hashes to its frozen fixture_hash', async () => {
  const { fixtureHash } = await harness();
  const fx = JSON.parse(readFileSync(join(__dirname, '..', 'scripts', 'recall-fixtures', 'recall-fixture.v1.json'), 'utf8'));
  assert.equal(fixtureHash(fx), fx.fixture_hash);
  assert.equal(fx.fixture_hash, 'sha256-993c8d45c063fadc755209b2d534c720d045db2b4dbe6bca759e61c44e0d8312');
});

// The gate runs as a subprocess against a tmp receipt + tmp fixture, offline.
async function gateRun(report, fixture, extraArgs = [], env = {}) {
  const { buildReceiptV2 } = await harness();
  const dir = mkdtempSync(join(tmpdir(), 'recall-gate-v2-'));
  const fxPath = join(dir, 'recall-fixture.v2.json');
  const rcPath = join(dir, 'receipt.json');
  writeFileSync(fxPath, JSON.stringify(fixture));
  writeFileSync(rcPath, JSON.stringify(buildReceiptV2(report, 'recall-fixture.v2.json')));
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('RUVECTOR_')));
  const p = spawnSync(process.execPath, [join(__dirname, '..', 'scripts', 'recall-gate.mjs'), '--receipt', rcPath, '--fixture', fxPath, '--skip-live-probe', '--json', ...extraArgs], { env: { ...cleanEnv, ...env }, encoding: 'utf8' });
  return { code: p.status, out: JSON.parse(p.stdout) };
}
async function passingReport(stale = 0) {
  const { runHarnessV2 } = await harness();
  const gold = [g('kp', 'a'), g('kp', 'b'), g('kp', 'c'), g('kp', 'd')];
  const fx = await sealed([
    { id: 'p1', query: 'q1', gold: [gold[0]] }, { id: 'p2', query: 'q2', gold: [gold[1]] },
    { id: 'p3', query: 'q3', gold: [gold[2]] }, { id: 'p4', query: 'q4', gold: [gold[3]] },
    { id: 'n1', query: 'none', negative: true },
  ], { ...V2_BAND, max_stale_gold_fraction: 0.25 });
  const mem = fakeMem({ q1: [{ namespace: 'kp', key: 'a', score: 0.9 }], q2: [{ namespace: 'kp', key: 'b', score: 0.9 }], q3: [{ namespace: 'kp', key: 'c', score: 0.9 }], q4: [{ namespace: 'kp', key: 'd', score: 0.9 }] });
  const report = await runHarnessV2({ pool: fakePool(gold.slice(0, 4 - stale)), memTools: mem, collectBinding: stubBinding, xinfEnsure: async () => true }, fx, { runs: 3, k: 10 });
  return { report, fx };
}

test('v2 gate: permits a clean receipt; refuses stale gold over the bound; --max-stale-gold-fraction only tightens', async () => {
  const ok = await passingReport(0);
  assert.equal(ok.report.verdict.pass, true);
  const permitted = await gateRun(ok.report, ok.fx);
  assert.equal(permitted.code, 0, JSON.stringify(permitted.out.refusals));
  assert.equal((await gateRun(ok.report, ok.fx, ['--max-stale-gold-fraction', '0'])).code, 0, '0 stale <= 0');

  const one = await passingReport(1); // 1/4 stale = 25%: at the bound, still permitted
  assert.equal(one.report.verdict.pass, true);
  assert.equal((await gateRun(one.report, one.fx)).code, 0);
  const tight = await gateRun(one.report, one.fx, ['--max-stale-gold-fraction', '0.1']);
  assert.equal(tight.code, 3);
  assert.match(tight.out.refusals.join(' '), /stale gold 1\/4 .*exceeds/);

  const two = await passingReport(2); // 50% > 25%: the harness already FAILs; the gate refuses on both counts
  assert.equal(two.report.verdict.pass, false);
  const refused = await gateRun(two.report, two.fx);
  assert.equal(refused.code, 3);
  assert.match(refused.out.refusals.join(' '), /stale gold 2\/4/);
});

test('v2 receipts never share the v1 receipt path the gate reads by default', async () => {
  const { RECEIPT_PATH, RECEIPT_PATH_V2 } = await harness();
  assert.notEqual(RECEIPT_PATH, RECEIPT_PATH_V2);
  assert.match(RECEIPT_PATH, /latest-receipt\.json$/);
  assert.match(RECEIPT_PATH_V2, /latest-receipt\.v2\.json$/);
  const gate = readFileSync(join(__dirname, '..', 'scripts', 'recall-gate.mjs'), 'utf8');
  assert.match(gate, /const RECEIPT_PATH = join\([^)]*'latest-receipt\.json'\)/, 'gate default receipt is still the v1 file');
  assert.doesNotMatch(gate, /join\([^)]*latest-receipt\.v2/, 'gate never defaults to the v2 receipt');
});

test('v2 gate: refuses when the fixture changed, the floor drifted, or RUVECTOR_HYBRID_FUSION moved', async () => {
  const { report, fx } = await passingReport(0);
  const edited = { ...fx, cases: fx.cases.slice(0, 4) };
  edited.fixture_hash = (await harness()).fixtureHashV2(edited);
  const a = await gateRun(report, edited);
  assert.equal(a.code, 3);
  assert.match(a.out.refusals.join(' '), /not the one measured/);

  const b = await gateRun({ ...report, config: { ...report.config, relevance_floor: 0.4 } }, fx);
  assert.equal(b.code, 3);
  assert.match(b.out.refusals.join(' '), /relevance floor changed/);

  const c = await gateRun(report, fx, [], { RUVECTOR_HYBRID_FUSION: 'rrf' });
  assert.equal(c.code, 3);
  assert.match(c.out.refusals.join(' '), /RUVECTOR_HYBRID_FUSION: run=blend now=rrf/);
});
