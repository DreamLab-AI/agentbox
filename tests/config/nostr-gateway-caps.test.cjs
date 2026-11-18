// The gateway's caps never cut silently (2026-11-18). Functions are lifted from
// gateway.cjs itself, as nostr-gateway-lock.test.cjs does, so the test exercises
// the shipped code rather than a copy.
//   node --test tests/config/nostr-gateway-caps.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const dir = path.resolve(__dirname, '../../config/nostr-gateway');
const source = fs.readFileSync(path.join(dir, 'gateway.cjs'), 'utf8');
const lift = (start, end) => {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `gateway.cjs no longer has ${start.trim()}`);
  return source.slice(a, b);
};
const MAX = source.match(/const MAX_BODY = (\d+);/)[1];
const MAX_I = source.match(/const MAX_INSTR = (\d+);/)[1];
const fns = [lift('function sanitize(s)', '\nfunction allWindows'), lift('// A reply longer than one DM', '\nfunction audit(')].join('\n');

function sandbox() {
  const sent = [];
  const logs = [];
  const ctx = {
    ...require(path.join(dir, 'dm-parts.cjs')),
    MAX_BODY: Number(MAX), MAX_INSTR: Number(MAX_I),
    buildWrap: (t) => ({ content: t }), log: (...a) => logs.push(a.join(' ')),
    String, JSON,
  };
  vm.createContext(ctx);
  vm.runInContext(fns, ctx);
  const ws = { send: (m) => sent.push(JSON.parse(m)[1].content) };
  return { ctx, ws, sent, logs };
}

test('an instruction is no longer cut at 500, and a real cut is marked', () => {
  const { ctx } = sandbox();
  const mid = 'word '.repeat(400).trim();
  assert.equal(ctx.sanitize(mid), mid, '2,000 chars pass whole (the old cap was 500)');
  const huge = ctx.sanitize('z'.repeat(10_000));
  assert.ok(huge.length <= Number(MAX_I));
  assert.match(huge, /…\[\+\d+ chars cut\]$/);
});

test('sanitize still strips what could act at a shell prompt', () => {
  const { ctx } = sandbox();
  assert.equal(ctx.sanitize('a\nb\t`c` $(d) \\e'), 'a b c (d) e');
});

test('an echo shows the start and the full length', () => {
  const { ctx } = sandbox();
  assert.equal(ctx.echo('short'), '"short"');
  assert.match(ctx.echo('q'.repeat(2000)), /^"q{150}…" \(2000 chars, all sent\)$/);
});

test('a long reply goes as numbered parts, each within one DM, nothing lost', () => {
  const { ctx, ws, sent, logs } = sandbox();
  const text = Array.from({ length: 300 }, (_, i) => `line ${i}: agent output`).join('\n');
  ctx.reply(ws, text);
  assert.ok(sent.length > 1);
  sent.forEach((p, i) => { assert.ok(p.length <= Number(MAX)); assert.ok(p.startsWith(`(${i + 1}/${sent.length}) `)); });
  assert.equal(sent.map((p) => p.replace(/^\(\d+\/\d+\) /, '')).join(''), text);
  assert.match(logs[0], /parts/);
  sent.length = 0;
  ctx.reply(ws, 'ok');
  assert.deepEqual(sent, ['ok'], 'a short reply is one unchanged DM');
});

test('peek keeps the newest lines of a tail', () => {
  assert.match(source, /clipTail\(tail, MAX_BODY - head\.length\)/, 'peek must clip from the start, not the end');
  assert.doesNotMatch(source, /\$\{tail\}`\.slice\(0, MAX_BODY\)/);
});
