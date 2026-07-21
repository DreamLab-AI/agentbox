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
