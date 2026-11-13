// tests/memory-qa-protocol.spec.mjs — pure-function tests of the registered
// end-to-end memory protocol (scripts/lib/memory-qa-protocol.mjs, ADR-2201
// clause 5). No database, no model.
//
//   node --test tests/memory-qa-protocol.spec.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PARAMS, FLOORS, ARMS, STRATA, judge, normaliseAnswer, questionDefects, fixtureProblems, fixtureDigest,
  extractJson, parseAction, isRepeat, mcnemarExact, compareArms, verdict, PROTOCOL_VERSION,
} from '../scripts/lib/memory-qa-protocol.mjs';

test('judge: gold contained in the answer after normalisation', () => {
  assert.equal(judge('It took 8 Minutes.', '8 minutes'), true);
  assert.equal(judge('"ADR-2201"', 'adr-2201'), true);
  assert.equal(judge('about  189/200  (median)', '189/200'), true);
});

test('judge: wrong, empty and unknown answers are incorrect', () => {
  assert.equal(judge('9 minutes', '8 minutes'), false);
  assert.equal(judge('unknown', '8 minutes'), false);
  assert.equal(judge('', '8 minutes'), false);
  assert.equal(judge('anything', ''), false, 'an empty gold can never be matched');
});

test('normaliseAnswer folds case, whitespace, quotes and edge punctuation only', () => {
  assert.equal(normaliseAnswer('  “Serial   HNSW”. '), 'serial hnsw');
  assert.equal(normaliseAnswer('v1.2.3'), 'v1.2.3', 'inner punctuation is kept');
});

test('questionDefects accepts a verbatim, specific, non-leaking question', () => {
  const src = 'The serial HNSW rebuild took 8 minutes on 2026-09-05.';
  assert.deepEqual(questionDefects({ question: 'How long did the serial HNSW rebuild take?', answer: '8 minutes' }, { source: src }), []);
});

test('questionDefects rejects each defect class', () => {
  const src = 'The serial HNSW rebuild took 8 minutes on 2026-09-05.';
  const has = (qa, ctx, re) => assert.ok(questionDefects(qa, ctx).some((d) => re.test(d)), `${JSON.stringify(qa)} should fail ${re}`);
  has({ question: 'How long did the rebuild take in total?', answer: '9 minutes' }, { source: src }, /not verbatim/);
  has({ question: 'Did it take 8 minutes to rebuild the index?', answer: '8 minutes' }, { source: src }, /appears in the question/);
  has({ question: 'How long did the serial rebuild take?', answer: '8 minutes' }, { source: src, older: ['an older run also took 8 minutes'] }, /older note/);
  has({ question: 'Was the rebuild serial or parallel here?', answer: 'yes' }, { source: `${src} yes` }, /specific value/);
  has({ question: 'short?', answer: '8 minutes' }, { source: src }, /too short/);
  has({ question: 'How long did the serial rebuild take?', answer: 'x'.repeat(PARAMS.gold_max_chars + 1) }, { source: src }, /length/);
});

function goodFixture() {
  const questions = [];
  const topics = [];
  for (let i = 0; i < PARAMS.questions_per_stratum; i++) {
    topics.push({ key: `topic:${i}`, value: 'state', evidence: [1, 2, 3].map((n) => ({ kind: 'memory', namespace: PARAMS.namespace, key: `n${i}-${n}` })) });
    questions.push({ id: `L${i}`, stratum: 'latest_state', question: 'q?', gold: 'g', source_key: `n${i}-3`, topic_key: `topic:${i}` });
    questions.push({ id: `S${i}`, stratum: 'single_note', question: 'q?', gold: 'g', source_key: `s${i}` });
  }
  return { protocol_version: PROTOCOL_VERSION, questions, topics };
}

test('fixtureProblems: a well-formed fixture has none', () => {
  assert.deepEqual(fixtureProblems(goodFixture()), []);
});

test('fixtureProblems: wrong counts, missing topics and bad topic keys are reported', () => {
  const a = goodFixture(); a.questions.pop();
  assert.ok(fixtureProblems(a).some((p) => new RegExp(`single_note has ${PARAMS.questions_per_stratum - 1}`).test(p)));
  const b = goodFixture(); b.topics.shift();
  assert.ok(fixtureProblems(b).some((p) => /no topic for its cluster/.test(p)));
  const c = goodFixture(); c.topics[0].key = 'summary-0';
  assert.ok(fixtureProblems(c).some((p) => /must start with/.test(p)));
  const d = goodFixture(); d.protocol_version = 99;
  assert.ok(fixtureProblems(d).some((p) => /protocol_version/.test(p)));
});

test('fixtureDigest ignores key order and changes with content', () => {
  const a = { x: 1, y: [{ b: 2, a: 1 }] };
  const b = { y: [{ a: 1, b: 2 }], x: 1 };
  assert.equal(fixtureDigest(a), fixtureDigest(b));
  assert.notEqual(fixtureDigest(a), fixtureDigest({ x: 1, y: [{ a: 1, b: 3 }] }));
  assert.match(fixtureDigest(a), /^[0-9a-f]{64}$/);
});

test('extractJson finds the first balanced object, tolerating prose and braces in strings', () => {
  assert.deepEqual(extractJson('Sure: {"answer": "a } b"} done'), { answer: 'a } b' });
  assert.deepEqual(extractJson('{"action":"search","query":"x"}'), { action: 'search', query: 'x' });
  assert.equal(extractJson('no json here'), null);
  assert.deepEqual(extractJson('{bad} then {"ok":1}'), { ok: 1 });
});

test('parseAction maps replies onto the three actions and fails safe', () => {
  assert.deepEqual(parseAction('{"action":"search","query":" hnsw "}'), { action: 'search', query: 'hnsw' });
  assert.deepEqual(parseAction('{"action":"retrieve","key":"k1"}'), { action: 'retrieve', key: 'k1' });
  assert.deepEqual(parseAction('{"action":"answer","text":"8 minutes"}'), { action: 'answer', text: '8 minutes' });
  assert.deepEqual(parseAction('{"answer":"8 minutes"}'), { action: 'answer', text: '8 minutes' });
  assert.deepEqual(parseAction('I think it is eight'), { action: 'answer', text: 'unknown', malformed: true });
  assert.equal(parseAction('{"action":"search","query":""}').malformed, true);
});

test('isRepeat detects an identical earlier action only', () => {
  const steps = [{ action: 'search', query: 'hnsw rebuild', keys: [] }, { action: 'retrieve', key: 'k1', found: true }];
  assert.equal(isRepeat(steps, { action: 'search', query: 'hnsw rebuild' }), true);
  assert.equal(isRepeat(steps, { action: 'search', query: 'hnsw rebuild time' }), false);
  assert.equal(isRepeat(steps, { action: 'retrieve', key: 'k1' }), true);
  assert.equal(isRepeat(steps, { action: 'retrieve', key: 'hnsw rebuild' }), false);
  assert.equal(isRepeat([], { action: 'search', query: 'x' }), false);
});

test('mcnemarExact matches known exact values', () => {
  assert.equal(mcnemarExact(0, 0), 1);
  assert.ok(Math.abs(mcnemarExact(6, 0) - 0.03125) < 1e-12);
  assert.ok(Math.abs(mcnemarExact(5, 0) - 0.0625) < 1e-12);
  assert.ok(Math.abs(mcnemarExact(8, 1) - 0.0390625) < 1e-12);
  assert.equal(mcnemarExact(3, 3), 1);
  assert.equal(mcnemarExact(1, 8), mcnemarExact(8, 1), 'symmetric');
});

test('compareArms counts discordant pairs and points', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const r = compareArms({ a: true, b: true, c: true, d: false }, { a: true, b: false, c: false, d: false }, ids);
  assert.deepEqual([r.a_correct, r.b_correct, r.a_only, r.b_only, r.diff_points], [3, 1, 2, 0, 50]);
});

// Build synthetic results: `spec[arm][stratum]` = number correct, taken from the front.
function synth(spec) {
  const fx = goodFixture();
  const results = {};
  for (const arm of ARMS) {
    results[arm] = {};
    for (const s of STRATA) {
      const ids = fx.questions.filter((q) => q.stratum === s).map((q) => q.id);
      ids.forEach((id, i) => { results[arm][id] = i < spec[arm][s]; });
    }
  }
  return { results, questions: fx.questions };
}

test('verdict: a large paired gain clears; the control stays valid', () => {
  const { results, questions } = synth({
    closed_book: { latest_state: 2, single_note: 3 },
    one_shot: { latest_state: 10, single_note: 20 },
    iterative: { latest_state: 20, single_note: 35 },
    consolidated: { latest_state: 35, single_note: 35 },
  });
  const v = verdict(results, questions);
  assert.equal(v.control.valid, true);
  const N = PARAMS.questions_per_stratum;
  const points = (net, n) => Math.round((net / n) * 1000) / 10;
  assert.equal(v.iterative_over_one_shot.verdict, 'clears');
  assert.equal(v.iterative_over_one_shot.diff_points, points(25, 2 * N));
  assert.equal(v.consolidated_over_iterative.verdict, 'clears');
  assert.equal(v.consolidated_over_iterative.diff_points, points(15, N));
});

test('verdict: a gain below the point floor fails', () => {
  const { results, questions } = synth({
    closed_book: { latest_state: 0, single_note: 0 },
    one_shot: { latest_state: 20, single_note: 20 },
    iterative: { latest_state: 22, single_note: 22 },
    consolidated: { latest_state: 24, single_note: 22 },
  });
  const v = verdict(results, questions);
  assert.equal(v.iterative_over_one_shot.verdict, 'fails');
  assert.equal(v.consolidated_over_iterative.verdict, 'fails');
});

test('verdict: reaching the point floor without significance is inconclusive, not a pass', () => {
  const fx = goodFixture();
  const L = fx.questions.filter((q) => q.stratum === 'latest_state').map((q) => q.id);
  const results = Object.fromEntries(ARMS.map((a) => [a, {}]));
  for (const q of fx.questions) for (const a of ARMS) results[a][q.id] = false;
  // Exactly the point floor, carried by many discordant pairs in both directions → p > 0.05.
  const net = (L.length * FLOORS.consolidated_over_iterative.min_points) / 100;
  assert.ok(Number.isInteger(net), 'the stratum size must make the point floor a whole number of questions');
  L.slice(0, 10 + net).forEach((id) => { results.consolidated[id] = true; });
  L.slice(10 + net, 20 + net).forEach((id) => { results.iterative[id] = true; });
  const v = verdict(results, fx.questions);
  assert.equal(v.consolidated_over_iterative.diff_points, 10);
  assert.ok(v.consolidated_over_iterative.p > FLOORS.alpha);
  assert.equal(v.consolidated_over_iterative.verdict, 'inconclusive');
});

test('verdict: harm on single-note questions turns a clear into a fail', () => {
  const { results, questions } = synth({
    closed_book: { latest_state: 0, single_note: 0 },
    one_shot: { latest_state: 10, single_note: 20 },
    iterative: { latest_state: 20, single_note: 35 },
    consolidated: { latest_state: 35, single_note: 30 },
  });
  const v = verdict(results, questions);
  assert.equal(v.consolidated_over_iterative.single_note_harm, true);
  assert.equal(v.consolidated_over_iterative.verdict, 'fails');
});

test('verdict: questions answerable without memory void the run', () => {
  const { results, questions } = synth({
    closed_book: { latest_state: 15, single_note: 15 },
    one_shot: { latest_state: 10, single_note: 20 },
    iterative: { latest_state: 30, single_note: 40 },
    consolidated: { latest_state: 45, single_note: 40 },
  });
  const v = verdict(results, questions);
  assert.equal(v.control.valid, false);
  assert.equal(v.iterative_over_one_shot.verdict, 'void');
  assert.equal(v.consolidated_over_iterative.verdict, 'void');
});
