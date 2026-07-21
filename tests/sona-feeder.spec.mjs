// node --test unit tests for ruvector-sona-feeder.mjs (WF2 map §3.1 / implementer-B).
// Pure-function coverage only: trajectory_json construction, reward rollup, the
// compound cursor comparison, and the restart self-heal decision. NO DB, NO network
// — importing the feeder module is side-effect-safe (the entry guard prevents a
// tick/loop, the pg pool is only built inside a tick).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SONA_SCOPE, SONA_EMBEDDING_DIM, CURSOR_KEY, CURSOR_NS, CURSOR_TAG,
  clampReward, computeFinalReward, assembleTrajectoryJson,
  cursorAdvances, shouldReseed,
} from '../scripts/ruvector-sona-feeder.mjs';

test('constants match the A↔B contract (scope, dim, cursor identity)', () => {
  assert.equal(SONA_SCOPE, 'agentbox_memory');       // must equal implementer-A's apply/health string
  assert.equal(SONA_EMBEDDING_DIM, 384);             // I22 dimension tag
  assert.equal(CURSOR_KEY, '__sona_learn_cursor__'); // distinct from aggregation/distill keys (R-C8)
  assert.equal(CURSOR_NS, 'memory-learning-aggregates');
  assert.equal(CURSOR_TAG, 'sona:cursor');
});

test('clampReward: null/undefined → 0, clamps to [0,1], rejects non-finite', () => {
  assert.equal(clampReward(null), 0);
  assert.equal(clampReward(undefined), 0);
  assert.equal(clampReward(0.9), 0.9);
  assert.equal(clampReward(1.5), 1);
  assert.equal(clampReward(-0.2), 0);
  assert.equal(clampReward('nope'), 0);
  assert.equal(clampReward('0.5'), 0.5); // numeric strings coerce
});

test('computeFinalReward: success dominates, else recency-agnostic mean, else 0.5', () => {
  assert.equal(computeFinalReward(true, [0.1, 0.2]), 1.0);   // success=true wins
  assert.equal(computeFinalReward(false, [0.9, 1.0]), 0.0);  // success=false wins
  assert.equal(computeFinalReward(null, [0.8, 0.6]), 0.7);   // mean of judged steps
  assert.equal(computeFinalReward(null, []), 0.5);           // no steps → default
  assert.equal(computeFinalReward(null, [2, 2]), 1);         // mean clamped to 1
  assert.equal(computeFinalReward(null, [NaN, 0.4]), 0.4);   // non-finite filtered
});

test('assembleTrajectoryJson: confirmed live shape, initial optional, no attention_weights', () => {
  const stepEntries = [
    { embedding: [0.1, 0.2], reward: 0.9 },
    { embedding: [0.3, 0.4], reward: 1.4 }, // clamps to 1
  ];
  const withInit = assembleTrajectoryJson({ initialEmb: [0.01, 0.02], stepEntries, finalReward: 1.0 });
  assert.deepEqual(Object.keys(withInit).sort(), ['final_reward', 'initial', 'steps']);
  assert.deepEqual(withInit.initial, [0.01, 0.02]);
  assert.equal(withInit.steps.length, 2);
  assert.equal(withInit.steps[0].reward, 0.9);
  assert.equal(withInit.steps[1].reward, 1);          // clamped
  assert.equal(withInit.final_reward, 1.0);
  // attention_weights is deliberately omitted (map §3.1 / V4).
  assert.ok(!('attention_weights' in withInit.steps[0]));

  const noInit = assembleTrajectoryJson({ initialEmb: null, stepEntries, finalReward: 2 });
  assert.ok(!('initial' in noInit));                   // omitted when absent
  assert.equal(noInit.final_reward, 1);                // final_reward clamped to 1

  const emptyInit = assembleTrajectoryJson({ initialEmb: [], stepEntries, finalReward: 0.5 });
  assert.ok(!('initial' in emptyInit));                // empty array treated as absent
});

test('cursorAdvances: compound (ended_at, id) strict-after ordering', () => {
  const prev = { cursorAfter: '2026-07-20 10:00:00.000000', cursorId: 'traj-b' };
  // no prior cursor → everything advances
  assert.equal(cursorAdvances({ endedTs: '2026-01-01 00:00:00.000000', trajId: 'x' }, null), true);
  assert.equal(cursorAdvances({ endedTs: '2026-01-01 00:00:00.000000', trajId: 'x' }, { cursorAfter: null }), true);
  // later timestamp advances
  assert.equal(cursorAdvances({ endedTs: '2026-07-20 10:00:00.000001', trajId: 'a' }, prev), true);
  // earlier timestamp does not
  assert.equal(cursorAdvances({ endedTs: '2026-07-20 09:59:59.999999', trajId: 'z' }, prev), false);
  // equal timestamp, higher id advances (tie-break)
  assert.equal(cursorAdvances({ endedTs: '2026-07-20 10:00:00.000000', trajId: 'traj-c' }, prev), true);
  // equal timestamp, equal or lower id does not (already fed → no double-count)
  assert.equal(cursorAdvances({ endedTs: '2026-07-20 10:00:00.000000', trajId: 'traj-b' }, prev), false);
  assert.equal(cursorAdvances({ endedTs: '2026-07-20 10:00:00.000000', trajId: 'traj-a' }, prev), false);
});

test('shouldReseed: guarded restart self-heal (reconciled with V5, no hot-loop)', () => {
  const cursor = { cursorAfter: '2026-07-20 10:00:00.000000', cursorId: 'traj-b' };
  const emptyEngine = { trajectories_buffered: 0, patterns_stored: 0 };
  const warmEngine = { trajectories_buffered: 5, patterns_stored: 2 };

  // fed before + engine empty + not yet reseeded → reseed once
  assert.equal(shouldReseed({ cursor, stats: emptyEngine, alreadyReseeded: false }), true);
  // already reseeded this process → never again (the V5 hot-loop guard)
  assert.equal(shouldReseed({ cursor, stats: emptyEngine, alreadyReseeded: true }), false);
  // never fed (no cursor) → no reseed
  assert.equal(shouldReseed({ cursor: null, stats: emptyEngine, alreadyReseeded: false }), false);
  assert.equal(shouldReseed({ cursor: { cursorAfter: null }, stats: emptyEngine, alreadyReseeded: false }), false);
  // engine warm (counters moved) → no reseed
  assert.equal(shouldReseed({ cursor, stats: warmEngine, alreadyReseeded: false }), false);
  // no stats signal → do not thrash
  assert.equal(shouldReseed({ cursor, stats: null, alreadyReseeded: false }), false);
});
