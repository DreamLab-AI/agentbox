// Text that crosses a size cap on the Nostr/agent message paths is split into
// numbered parts or visibly marked, never cut silently (2026-11-18: a 500-char
// inbound cap, 3,500-char outbound caps and a 20,000-char hook cap all sliced
// without a trace).
//   node --test tests/config/nostr-dm-parts.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { clip, clipTail, splitParts } = require(path.resolve(__dirname, '../../config/nostr-gateway/dm-parts.cjs'));

test('clip leaves short text alone and marks what it cut', () => {
  assert.equal(clip('hello', 10), 'hello');
  const out = clip('x'.repeat(100), 40);
  assert.ok(out.length <= 40, `${out.length} > 40`);
  assert.match(out, /…\[\+\d+ chars cut\]$/);
  const kept = out.replace(/…\[\+\d+ chars cut\]$/, '').length;
  assert.equal(Number(out.match(/\+(\d+)/)[1]), 100 - kept, 'the marker counts exactly what was dropped');
});

test('clipTail keeps the newest end and marks the start', () => {
  const lines = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
  const out = clipTail(lines, 300);
  assert.ok(out.length <= 300);
  assert.ok(out.endsWith('line 199'), 'the newest line survives');
  assert.match(out, /^…\[\d+ chars cut\]\n/);
});

test('no cut splits a surrogate pair', () => {
  const s = '😀'.repeat(50);
  for (const max of [21, 22, 23, 40]) {
    for (const out of [clip(s, max), clipTail(s, max)]) assert.doesNotMatch(out, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  }
});

test('splitParts: one part when it fits, numbered parts that rejoin exactly otherwise', () => {
  assert.deepEqual(splitParts('short', 100), ['short']);
  const text = Array.from({ length: 400 }, (_, i) => `paragraph ${i} with some words.`).join('\n');
  const parts = splitParts(text, 1000, 50);
  assert.ok(parts.length > 1);
  parts.forEach((p, i) => {
    assert.ok(p.length <= 1000, `part ${i} is ${p.length}`);
    assert.ok(p.startsWith(`(${i + 1}/${parts.length}) `), p.slice(0, 12));
  });
  assert.equal(parts.map((p) => p.replace(/^\(\d+\/\d+\) /, '')).join(''), text, 'nothing lost or added');
});

test('splitParts caps the part count and says how much went unsent', () => {
  const text = 'y'.repeat(50_000);
  const parts = splitParts(text, 1000, 4);
  assert.equal(parts.length, 4);
  assert.match(parts[3], /…\[\+\d+ chars cut\]$/);
  parts.forEach((p) => assert.ok(p.length <= 1000));
});
