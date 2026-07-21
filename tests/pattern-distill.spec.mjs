// node --test unit tests for ruvector-pattern-distill.mjs (WF2 map §4.1 / implementer-B).
// Pure-function coverage only: idempotency key, provenance stamping, the 4-field
// body + labels-and-paths-first serialisation, type/label/path extraction, and the
// cluster qualification pipeline. NO DB, NO network (the entry guard prevents a tick;
// the pg pool is only built inside a tick).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CURSOR_KEY, CURSOR_NS, CURSOR_TAG, PROVENANCE, PATTERN_SOURCE_DB,
  sha12, distillId, qualifies, deriveType, extractLabels, extractPaths,
  buildBody, serialiseBody, buildMetadata, computeClusters,
} from '../scripts/ruvector-pattern-distill.mjs';

test('constants: distinct cursor identity + firewall provenance', () => {
  assert.equal(CURSOR_KEY, '__pattern_distill_cursor__'); // distinct from aggregation/SONA (R-C8)
  assert.equal(CURSOR_NS, 'memory-learning-aggregates');
  assert.equal(CURSOR_TAG, 'distill:cursor');
  assert.equal(PROVENANCE, 'judge:trajectory');           // I18 execution-tier
  assert.equal(PATTERN_SOURCE_DB, 'trajectory-distillation');
});

test('distillId: deterministic, content-addressed, correct shape', () => {
  const a = 'grep [args:4 flags:2 pipe]';
  const b = 'sed [args:2 flags:1]';
  assert.equal(distillId(a), distillId(a));                        // deterministic → idempotent upsert
  assert.notEqual(distillId(a), distillId(b));                     // content-addressed
  assert.match(distillId(a), /^distilled-sha256-12-[0-9a-f]{12}$/); // exact key format
  assert.equal(distillId(a), `distilled-sha256-12-${sha12(a)}`);
});

test('qualifies: raw sample floor (I06 uses raw n, not weighted)', () => {
  assert.equal(qualifies(20, 20), true);
  assert.equal(qualifies(19, 20), false);
  assert.equal(qualifies(0, 0), true);
  assert.equal(qualifies(null, 20), false);
});

test('deriveType: tool name is the leading token, fallback trajectory-pattern', () => {
  assert.equal(deriveType('grep [args:4 flags:2 pipe]'), 'grep');
  assert.equal(deriveType('sed [args:2 flags:1]'), 'sed');
  assert.equal(deriveType('cd [args:5 flags:1 chain]'), 'cd');
  assert.equal(deriveType(''), 'trajectory-pattern');
  assert.equal(deriveType('   '), 'trajectory-pattern');
  assert.equal(deriveType('[no-tool]'), 'trajectory-pattern'); // bracket-only → no leading token
});

test('extractLabels: tool + bracket tokens, deduped', () => {
  assert.deepEqual(extractLabels('grep [args:4 flags:2 pipe]'), ['grep', 'args:4', 'flags:2', 'pipe']);
  assert.deepEqual(extractLabels('ls [args:1 flags:1]'), ['ls', 'args:1', 'flags:1']);
  assert.deepEqual(extractLabels('bare'), ['bare']);
  // dedupe: tool token repeated inside the bracket collapses
  assert.deepEqual(extractLabels('grep [grep pipe]'), ['grep', 'pipe']);
});

test('extractPaths: pulls path/file/glob tokens, caps, ignores null, length-bounds', () => {
  const paths = extractPaths([
    'matched in /home/devuser/workspace/main.rs and src/lib.mjs',
    'see also config.toml',
    null,
    '*.cu found',
  ]);
  assert.ok(paths.includes('/home/devuser/workspace/main.rs'));
  assert.ok(paths.includes('src/lib.mjs'));
  assert.ok(paths.includes('config.toml'));
  assert.ok(paths.includes('*.cu'));
  // cap respected
  const many = Array.from({ length: 50 }, (_, i) => `file${i}.rs`).join(' ');
  assert.ok(extractPaths([many], 12).length <= 12);
  // no crash on empty / non-array
  assert.deepEqual(extractPaths([]), []);
  assert.deepEqual(extractPaths(null), []);
});

test('buildBody + serialiseBody: 4 fields, labels-and-paths-first ordering', () => {
  const body = buildBody({
    action: 'grep [args:4 flags:2 pipe]', wilson: 0.9712, n: 92,
    meanQuality: 1.0, lastSeen: '2026-07-20T10:00:00.000Z',
    labels: ['grep', 'pipe'], paths: ['src/a.rs'],
  });
  assert.deepEqual(Object.keys(body).sort(), ['detail', 'labels', 'paths', 'summary']);
  assert.match(body.summary, /Wilson-bound success 0\.9712 over 92 samples/);
  assert.match(body.detail, /samples=92/);

  const s = serialiseBody(body);
  // labels first, then paths, then summary, then detail
  assert.ok(s.startsWith('labels: grep pipe | paths: src/a.rs | '));
  assert.ok(s.indexOf('labels:') < s.indexOf('paths:'));
  assert.ok(s.indexOf('paths:') < s.indexOf('Wilson-bound'));

  // labels/paths omitted cleanly when empty
  const bare = serialiseBody(buildBody({ action: 'x', wilson: 0.5, n: 1, meanQuality: 0.5, lastSeen: null, labels: [], paths: [] }));
  assert.ok(!bare.includes('labels:'));
  assert.ok(!bare.includes('paths:'));
});

test('buildMetadata: provenance stamp is judge:trajectory + full metadata contract', () => {
  const body = buildBody({ action: 'grep [args:4 flags:2 pipe]', wilson: 0.9712, n: 92, meanQuality: 1.0, lastSeen: 't', labels: ['grep'], paths: ['a.rs'] });
  const md = buildMetadata({ action: 'grep [args:4 flags:2 pipe]', n: 92, meanQuality: 1.0, wilson: 0.9712, urn: 'urn:agentbox:memory:x', body, halfLife: 14 });
  assert.equal(md.provenance, 'judge:trajectory'); // I18 — load-bearing (promotable tier)
  assert.equal(md.support_count, 92);
  assert.equal(md.wilson, 0.9712);
  assert.equal(md.cluster_key, 'grep [args:4 flags:2 pipe]');
  assert.equal(md.recency_half_life_days, 14);
  assert.deepEqual(md.labels, ['grep']);
  assert.deepEqual(md.paths, ['a.rs']);
  assert.ok(md.body && md.body.summary);
  assert.equal(md.urn, 'urn:agentbox:memory:x');
  assert.ok(typeof md.distilled_at === 'string');
  // no provenance omission possible → acceptance query (provenance IS NULL) can never match a distilled row
  assert.ok(md.provenance !== null && md.provenance !== undefined);
});

test('computeClusters: floor filter, wilson sort, idempotent id + provenance stamp on every row', () => {
  const rows = [
    { pattern: 'grep [args:4 flags:2 pipe]', n: '92', w_total: '90', w_succ: '88', mean_quality: '1.0', last_seen: '2026-07-20T10:00:00.000Z', sample_results: ['matched /home/x/a.rs', 'src/b.mjs'] },
    { pattern: 'sed [args:2 flags:1]', n: '76', w_total: '70', w_succ: '60', mean_quality: '0.96', last_seen: '2026-07-19T10:00:00.000Z', sample_results: ['edited config.toml'] },
    { pattern: 'rare-one [args:1]', n: '3', w_total: '3', w_succ: '3', mean_quality: '1.0', last_seen: '2026-07-18T10:00:00.000Z', sample_results: [] }, // below floor → dropped
  ];
  const clusters = computeClusters(rows, 20, 14);
  assert.equal(clusters.length, 2);                          // rare-one dropped by the floor
  // sorted by wilson desc — grep (88/90 weighted) outranks sed (60/70)
  assert.ok(clusters[0].wilson >= clusters[1].wilson);
  for (const c of clusters) {
    assert.equal(c.id, distillId(c.action));                 // content-addressed idempotency key
    assert.equal(c.metadata.provenance, 'judge:trajectory'); // every distilled row is provenance-stamped
    assert.ok(c.type && typeof c.type === 'string');
    assert.ok(c.serialised.startsWith('labels:'));           // labels-and-paths-first
    assert.ok(c.embVec === undefined);                       // embedding is added later (embed-then-insert)
  }
  const grep = clusters.find((c) => c.action.startsWith('grep'));
  assert.equal(grep.type, 'grep');
  assert.ok(grep.body.paths.includes('/home/x/a.rs'));
  assert.ok(grep.body.paths.includes('src/b.mjs'));
});
