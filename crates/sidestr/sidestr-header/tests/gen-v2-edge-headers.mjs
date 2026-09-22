// Regenerates tests/fixtures/v2-edge-headers.json from the JS reference kernel:
// 28 BLAKE2b v2 headers at the field extremes (fill 0x00/0xff, flags
// {0,1,2,3,4,7,255}, time 0/u32::MAX) with the kernel's hash, 72-byte signed
// prefix, sha256 of that prefix and decoded time. Written by the GPT-6 Astra
// evidence auditor, 2026-09-22; vendored so `audit_regressions.rs` is
// self-contained.
//
//   SIDESTR_SIDING=/path/to/spec/siding node tests/gen-v2-edge-headers.mjs
//
// Run from the sidestr-header crate root. Needs the `siding` checkout and the
// schema kernel it resolves (upstream revision at the time: spec 2de40bda,
// schema b8cbf633).
import fs from 'node:fs/promises';
import path from 'node:path';

const siding = process.env.SIDESTR_SIDING;
if (!siding) throw new Error('set SIDESTR_SIDING to the siding checkout');
const { loadEngine } = await import(path.join(siding, 'lib/engine.mjs'));
const here = path.dirname(new URL(import.meta.url).pathname);
const doc = JSON.parse(await fs.readFile(path.join(here, 'fixtures/txbt4-siding/chain.json')));
const e = await loadEngine(doc);
const cases = [];
for (const fill of [0, 255]) for (const flags of [0, 1, 2, 3, 4, 7, 255]) for (const time of [0, 4294967295]) {
  const b = fill.toString(16).padStart(2, '0');
  const h = {
    version: 0xa0000000, prevBlockHash: b.repeat(32), merkleRoot: b.repeat(32), timeOnWire: time,
    bits: 0x207fffff, nonce: fill ? 4294967295 : 0, nonce2: fill ? 4294967295 : 0, nonce3: fill ? 4294967295 : 0,
    extranonce: b.repeat(16), timeOffset: fill ? 4294967295 : 0, txCount: fill ? 65535 : 0, flags,
    xorKeyMaskClearBits: fill, xorKey: b.repeat(16), height: fill ? 4294967295 : 0, mmRhs: b.repeat(32),
  };
  const bytes = e.k.codec.encode('BlockHeader', h);
  cases.push({
    label: `fill=${fill} flags=${flags} time=${time}`,
    hex: Buffer.from(bytes).toString('hex'),
    hash: e.k.codec.blockHash(h),
    prefix: Buffer.from(bytes.slice(0, 72)).toString('hex'),
    data: Buffer.from(e.hash.sha256(bytes.slice(0, 72))).toString('hex'),
    time: e.pow.headerTime(h),
  });
}
const out = path.join(here, 'fixtures/v2-edge-headers.json');
await fs.writeFile(out, JSON.stringify(cases, null, 2));
console.log(`${cases.length} edge headers written to ${out}`);
