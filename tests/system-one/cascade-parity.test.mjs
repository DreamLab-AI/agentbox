// The hook's local first stage must be the ranker the cutoff was measured with.
//
// `[skills.routing].cascade_cutoff` was read off system-one-eval's BM25 ranker
// (ADR-2095 addendum 2026-09-23). A cutoff only transfers to the ranker it was
// measured on, so the JS port in config/hooks/lib/skill-route.cjs is held to the
// Rust instrument's own output on the routing corpus: same pick, same relative
// margin, for all 86 turns over the frozen 116-option candidate map.
//
// Regenerate the golden with the command in its `_regenerate` field whenever the
// ranker changes on either side — never by editing the numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const lib = require(resolve(HERE, '../../config/hooks/lib/skill-route.cjs'));
const golden = JSON.parse(readFileSync(resolve(HERE, 'cascade-bm25-parity.json'), 'utf8'));

test('the golden covers the corpus it claims to', () => {
  assert.equal(golden.prompts.length, 86);
  assert.equal(golden.picks.length, golden.prompts.length);
  assert.ok(Object.keys(golden.candidates).length > 100);
});

test('JS BM25 reproduces the Rust ranker: same pick, same relative margin, every turn', () => {
  const drift = [];
  golden.prompts.forEach((prompt, i) => {
    const got = lib.localRank(prompt, golden.candidates);
    const want = golden.picks[i];
    if (got.choice !== want.choice || Math.abs(got.margin - want.margin) > 1e-9) {
      drift.push(`#${i}: rust ${want.choice} ${want.margin} · js ${got.choice} ${got.margin}`);
    }
  });
  assert.deepEqual(drift, []);
});

test('the default cutoff reproduces the measured in-sample point (41 of 86 answered locally, 52.3% escalated)', () => {
  const local = golden.picks.filter((p) => p.margin >= lib.DEFAULT_CASCADE_CUTOFF).length;
  assert.equal(local, 41);
});

test('ported helpers match the Rust doc examples', () => {
  assert.deepEqual(lib.tokenise('Port the Python CLI to Rust!'), ['port', 'python', 'cli', 'rust']);
  const docs = ['port python to rust', 'render a mermaid diagram'].map(lib.tokenise);
  const s = lib.bm25(lib.tokenise('rust port'), docs);
  assert.ok(s[0] > s[1]);
  assert.equal(lib.stripExclusion('Draws diagrams. Not for charts, use the dataviz skill.'), 'Draws diagrams.');
});
