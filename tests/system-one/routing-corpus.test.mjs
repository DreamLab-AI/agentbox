// SSO contract §8.5 — validation of the labelled routing corpus.
//
// This suite makes no claim about accuracy: it cannot, and neither can the corpus
// (see README.md — it is largely self-authored, which flatters the system that
// authored it). What it does is keep the corpus honest as an artefact: every label
// resolves to a skill the router could actually pick, every case states a reason,
// every provenance tier is declared, and the `late_discriminative` flag matches the
// rule it claims to follow. A corpus that silently rots is worse than none, because
// system-one-eval will report a number from it either way.
//
// Run: node --test tests/system-one/routing-corpus.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const require = createRequire(import.meta.url);
const lib = require(path.join(REPO, 'config/hooks/lib/skill-route.cjs'));

const corpus = JSON.parse(fs.readFileSync(path.join(HERE, 'routing-cases.json'), 'utf8'));
const { cases } = corpus;
const candidates = lib.loadCandidates(path.join(REPO, 'skills'));
const CLASSES = new Set(['none', 'near-neighbour', 'boundary', 'single']);
const PROVENANCE = new Set(Object.keys(corpus._provenance));

/** 48 tokens at the estate's own datum: a 461-char description ≈ 115 tokens (§10.1). */
const CUT_CHARS = 192;
const BOUNDARY_MARKER = /\b(use when|use for|use after|not for|never for|do not use|don't use|rather than|instead of|when not|not when|use only)\b/i;
function lateDiscriminative(skill) {
  if (skill === 'none') return false;
  const rubric = candidates[skill];
  if (!rubric || rubric.length <= CUT_CHARS) return false;
  const m = rubric.match(BOUNDARY_MARKER);
  return !m || m.index >= CUT_CHARS;
}

describe('the corpus documents itself', () => {
  test('it carries its role, schema and provenance tiers, and a README beside it', () => {
    assert.ok(corpus._role.length > 80);
    assert.deepEqual(Object.keys(corpus._schema).sort(),
      ['class', 'expected_skill', 'late_discriminative', 'prompt', 'provenance', 'rationale'].sort());
    assert.ok(PROVENANCE.size >= 3, 'a single-provenance corpus has no independent cases to point at');
    assert.ok(fs.existsSync(path.join(HERE, 'README.md')), 'the honesty of a corpus lives in its README');
  });

  test('every case has exactly the declared fields — no silent extras, no silent gaps', () => {
    const want = Object.keys(corpus._schema).sort();
    for (const [i, c] of cases.entries()) {
      assert.deepEqual(Object.keys(c).sort(), want, `case ${i}: ${c.prompt.slice(0, 50)}`);
    }
  });
});

describe('every case is answerable by the system it is used to measure', () => {
  test('each label is `none` or a skill the live router would actually offer', () => {
    for (const c of cases) {
      if (c.expected_skill === lib.NONE) continue;
      assert.ok(candidates[c.expected_skill],
        `${c.expected_skill} is not a routable candidate — deprecated, superseded, not-installed or gone`);
    }
  });

  test('the repo skills tree and the baked tree agree, so a label means the same thing in both', (t) => {
    const baked = lib.loadCandidates('/opt/agentbox/skills');
    if (!Object.keys(baked).length) return t.skip('no baked skills tree in this environment');
    for (const c of cases) {
      if (c.expected_skill === lib.NONE) continue;
      assert.equal(baked[c.expected_skill], candidates[c.expected_skill],
        `${c.expected_skill}: the rubric the router scores differs from the one in the repo`);
    }
  });

  test('no prompt is short enough to be skipped before it reaches the judge', () => {
    const min = lib.config({}).minChars;
    for (const c of cases) {
      assert.ok(c.prompt.trim().length >= min, `"${c.prompt}" (${c.prompt.length} chars) would skip as short-prompt`);
      assert.equal(c.prompt.trim().startsWith('/'), false, 'a slash command never reaches the judge');
    }
  });

  test('no prompt is long enough to be clamped — the corpus measures routing, not truncation', () => {
    for (const c of cases) assert.equal(lib.clampPrompt(c.prompt).truncated, false);
  });

  test('prompts are unique — a duplicate is a silent double weight on one judgement', () => {
    const seen = new Map();
    for (const c of cases) {
      const k = c.prompt.trim().toLowerCase();
      assert.equal(seen.has(k), false, `duplicate prompt: ${c.prompt.slice(0, 60)}`);
      seen.set(k, c);
    }
  });

  test('every case states a reason and a declared class and provenance', () => {
    for (const c of cases) {
      assert.ok(c.rationale.length > 25, `a one-word rationale is an opinion: ${c.prompt.slice(0, 50)}`);
      assert.ok(CLASSES.has(c.class), `unknown class ${c.class}`);
      assert.ok(PROVENANCE.has(c.provenance), `undeclared provenance ${c.provenance}`);
    }
  });
});

describe('the corpus is shaped like the thing it measures', () => {
  test('all four classes are present, and `none` is a substantial share as it is in the real log', () => {
    const byClass = {};
    for (const c of cases) byClass[c.class] = (byClass[c.class] || 0) + 1;
    for (const k of CLASSES) assert.ok(byClass[k] >= 5, `class ${k}: only ${byClass[k] || 0} cases`);
    const none = cases.filter((c) => c.expected_skill === lib.NONE).length;
    // 66 of the 101 routed turns in ~/.claude/skill-route.jsonl picked `none`. A corpus
    // of interesting cases cannot match that, but a corpus with a handful of `none`
    // cases would score well on a router that never declines.
    assert.ok(none / cases.length >= 0.15, `only ${none}/${cases.length} cases expect \`none\``);
  });

  test('every case labelled class `none` expects `none`, and vice versa is NOT required', () => {
    for (const c of cases) {
      if (c.class === 'none') assert.equal(c.expected_skill, lib.NONE, c.prompt.slice(0, 50));
    }
    // A boundary case may also expect `none` — that is the point of a boundary case:
    // it looks like a skill's territory and is not. Recorded so the asymmetry is
    // deliberate rather than an oversight.
    const noneOutsideClass = cases.filter((c) => c.expected_skill === lib.NONE && c.class !== 'none');
    assert.ok(noneOutsideClass.every((c) => c.class === 'boundary'),
      'a `none` label outside class `none` only makes sense as a boundary case');
  });

  test('at least a third of the labelled skills are distinct — not eighty cases about five skills', () => {
    const distinct = new Set(cases.map((c) => c.expected_skill)).size;
    assert.ok(distinct >= cases.length / 3, `${distinct} distinct labels across ${cases.length} cases`);
  });

  test('no single skill dominates the corpus', () => {
    const counts = {};
    for (const c of cases) counts[c.expected_skill] = (counts[c.expected_skill] || 0) + 1;
    for (const [skill, n] of Object.entries(counts)) {
      if (skill === lib.NONE) continue;
      assert.ok(n <= 6, `${skill} appears ${n} times`);
    }
  });
});

describe('the late-discriminative subgroup (§10.1) is computed, not asserted', () => {
  test('every flag matches the stated rule, recomputed here from the live rubrics', () => {
    for (const c of cases) {
      assert.equal(c.late_discriminative, lateDiscriminative(c.expected_skill),
        `${c.expected_skill}: flag disagrees with the rule in _schema.late_discriminative`);
    }
  });

  test('the rule is documented where a reader will find it', () => {
    assert.match(corpus._schema.late_discriminative, /48 tokens/);
    assert.match(corpus._schema.late_discriminative, /192 chars/);
    assert.match(fs.readFileSync(path.join(HERE, 'README.md'), 'utf8'), /late_discriminative/);
  });

  test('the subgroup is big enough to report on and small enough not to be the whole corpus', () => {
    const flagged = cases.filter((c) => c.late_discriminative).length;
    assert.ok(flagged >= 10, `only ${flagged} flagged cases — too few to read a subgroup number from`);
    assert.ok(flagged <= cases.length * 0.75, `${flagged}/${cases.length} flagged — the flag has stopped discriminating`);
  });

  test('no case labelled `none` is flagged — there is no rubric to amputate', () => {
    for (const c of cases) {
      if (c.expected_skill === lib.NONE) assert.equal(c.late_discriminative, false);
    }
  });

  test('a flagged label really does have its boundary clause past the cut', () => {
    for (const c of cases.filter((x) => x.late_discriminative)) {
      const rubric = candidates[c.expected_skill];
      const head = rubric.slice(0, CUT_CHARS);
      assert.equal(BOUNDARY_MARKER.test(head), false,
        `${c.expected_skill}: a boundary clause survives the first ${CUT_CHARS} chars, so it is not late-discriminative`);
    }
  });
});
