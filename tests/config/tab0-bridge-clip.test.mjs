// tab0-bridge and its turn-sink hook mark every cut instead of slicing silently
// (2026-11-18). The helper is lifted from each file, since the live copies run
// standalone from ~/workspace/tab0-bridge.
//   node --test tests/config/tab0-bridge-clip.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

for (const file of ['server.mjs', 'turn-sink.cjs']) {
  const src = fs.readFileSync(new URL(`../../config/tab0-bridge/${file}`, import.meta.url), 'utf8');
  const a = src.indexOf('function clipMarked(');
  const b = src.indexOf('\n}\n', a);
  test(`${file}: clipMarked marks a cut, keeps short text, never splits a surrogate`, () => {
    assert.ok(a >= 0 && b > a, `${file} has no clipMarked`);
    const ctx = { String, Math };
    vm.createContext(ctx);
    vm.runInContext(src.slice(a, b + 2), ctx);
    assert.equal(ctx.clipMarked('hi', 10), 'hi');
    const out = ctx.clipMarked('x'.repeat(50_000), 20_000);
    assert.ok(out.length <= 20_000);
    assert.match(out, /…\[\+\d+ chars cut\]$/);
    const emoji = ctx.clipMarked('😀'.repeat(40), 31);
    assert.doesNotMatch(emoji, /[\uD800-\uDBFF]…/);
  });
  test(`${file}: no silent slice remains on a message path`, () => {
    assert.doesNotMatch(src, /text\.slice\(0, 20000\)|slice\(0, 3500\)|text\.slice\(0, 12000\)/);
  });
}
