// SSO contract §8.2 — the golden fixtures are a shared artefact: this suite and
// crates/system-one/system-one-client read the same files from the same paths. It
// asserts the §2 HARD RULES on every fixture, so a fixture that drifts out of
// contract is caught here rather than in whichever parser happens to notice.
//
// It does NOT assert that the cloud emits these bytes — see golden/manifest.json
// `_origin`: the fixtures are synthesised from the contract, not recorded.
//
// Run: node --test tests/system-one/golden-fixtures.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(HERE, 'golden');
const manifest = JSON.parse(fs.readFileSync(path.join(GOLDEN, 'manifest.json'), 'utf8'));
const read = (f) => JSON.parse(fs.readFileSync(path.join(GOLDEN, f), 'utf8'));
const CHOICE_KINDS = new Set(['choice', 'score', 'noul']);

const kindOf = (a) => (a.type && CHOICE_KINDS.has(a.type) ? a.type
  : 'choice' in a ? 'choice' : 'score' in a ? 'score' : 'noul' in a ? 'noul' : null);

describe('golden fixtures — the directory and its index agree', () => {
  test('every JSON file on disk is indexed, and every indexed file exists', () => {
    const onDisk = fs.readdirSync(GOLDEN).filter((f) => f.endsWith('.json') && f !== 'manifest.json').sort();
    const indexed = manifest.fixtures.map((f) => f.file).sort();
    assert.deepEqual(onDisk, indexed, 'an unindexed fixture is an undocumented contract');
  });

  test('both shapes are represented — the Rust client is written against both', () => {
    const shapes = new Set(manifest.fixtures.map((f) => f.shape));
    assert.deepEqual([...shapes].sort(), ['sso', 'typesafe']);
    for (const shape of ['sso', 'typesafe']) {
      const of = manifest.fixtures.filter((f) => f.shape === shape);
      assert.ok(of.some((f) => f.http_status === 200), `${shape}: no success fixture`);
      assert.ok(of.some((f) => f.http_status >= 400), `${shape}: no error fixture`);
    }
  });

  test('every fixture states its origin honestly, in the index and once only', () => {
    assert.match(manifest._origin, /SYNTHESISED, not recorded/);
    for (const f of manifest.fixtures) {
      const body = read(f.file);
      for (const k of Object.keys(body)) {
        assert.ok(!k.startsWith('_'), `${f.file}: metadata key ${k} inside a wire document`);
      }
    }
  });
});

describe('golden fixtures — §2 hard rules hold on every success body', () => {
  const successes = manifest.fixtures.filter((f) => f.http_status === 200);

  for (const f of successes) {
    test(`${f.file}: answers present, every answer is one of the three primitives`, () => {
      const body = read(f.file);
      assert.equal(typeof body.model, 'string');
      assert.ok(body.answers && Object.keys(body.answers).length > 0);
      for (const [name, a] of Object.entries(body.answers)) {
        assert.ok(kindOf(a), `${name}: not a choice, score or noul`);
      }
      assert.equal(typeof body.usage.input_tokens, 'number');
      assert.equal(typeof body.usage.output_tokens, 'number');
    });

    test(`${f.file}: choice is always one of its own probability keys, and the mass sums to 1`, () => {
      const body = read(f.file);
      for (const [name, a] of Object.entries(body.answers)) {
        if (kindOf(a) !== 'choice') continue;
        assert.ok(a.probabilities && typeof a.probabilities === 'object', `${name}: no probabilities`);
        assert.ok(a.choice in a.probabilities, `${name}: choice ${a.choice} is not among the options`);
        const vals = Object.values(a.probabilities);
        assert.ok(vals.every((v) => typeof v === 'number' && v >= 0 && v <= 1), `${name}: a probability out of range`);
        assert.ok(Math.abs(vals.reduce((x, y) => x + y, 0) - 1) < 1e-9, `${name}: mass does not sum to 1`);
        const best = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1])[0][0];
        assert.equal(a.choice, best, `${name}: choice is not the argmax`);
      }
    });

    test(`${f.file}: noul and score stay inside their ranges`, () => {
      const body = read(f.file);
      for (const [name, a] of Object.entries(body.answers)) {
        if (kindOf(a) === 'noul') {
          assert.ok(a.noul >= 0 && a.noul <= 1, `${name}: noul out of range`);
        }
        if (kindOf(a) === 'score') {
          const levels = Object.keys(a.legend).length;
          assert.ok(a.score >= 0 && a.score <= levels - 1, `${name}: score outside its levels`);
          assert.ok(Object.keys(a.probabilities).every((k) => typeof k === 'string' && /^\d+$/.test(k)),
            `${name}: Score probabilities must be keyed by level index as a string`);
        }
      }
    });
  }
});

describe('golden fixtures — the assertions the index promises are true of the bytes', () => {
  const get = (o, dotted) => dotted.split('.').reduce((v, k) => (v == null ? v : v[k]), o);

  for (const f of manifest.fixtures) {
    test(`${f.file}: ${Object.keys(f.assert).join(', ')}`, () => {
      const body = read(f.file);
      const probs = body.answers?.skill?.probabilities;
      for (const [k, want] of Object.entries(f.assert)) {
        switch (k) {
          case 'probabilities_keys': assert.equal(Object.keys(probs).length, want); break;
          case 'probabilities_sum':
            assert.ok(Math.abs(Object.values(probs).reduce((a, b) => a + b, 0) - want) < 1e-9); break;
          case 'nonzero_options': assert.equal(Object.values(probs).filter((v) => v > 0).length, want); break;
          case 'zero_options': assert.equal(Object.values(probs).filter((v) => v === 0).length, want); break;
          case 'answer_kinds':
            assert.deepEqual(Object.values(body.answers).map(kindOf).sort(), [...want].sort()); break;
          case 'score.legend_keys': assert.equal(Object.keys(body.answers.severity.legend).length, want); break;
          case 'score.probabilities_keys_are_strings':
            assert.equal(Object.keys(body.answers.severity.probabilities).every((x) => typeof x === 'string'), want); break;
          default: assert.equal(get(body, k), want, k);
        }
      }
    });
  }
});

describe('golden fixtures — the SSO block is the honesty channel (§2, §3)', () => {
  const sso = manifest.fixtures.filter((f) => f.shape === 'sso' && f.http_status === 200);

  test('every SSO success body carries an sso block with real timings', () => {
    for (const f of sso) {
      const b = read(f.file);
      assert.ok(b.sso, `${f.file}: no sso block`);
      assert.ok(b.sso.engine_ms > 0 && b.sso.facade_ms >= b.sso.engine_ms,
        `${f.file}: façade time must include engine time`);
    }
  });

  test('shortlisting never narrows the world: `to` < `from`, yet all `from` keys still carry a probability', () => {
    for (const f of sso) {
      const b = read(f.file);
      for (const [q, s] of Object.entries(b.sso.shortlisted || {})) {
        assert.ok(s.to < s.from, `${f.file}/${q}: a shortlist that reduces nothing is not a shortlist`);
        assert.ok(s.to >= 2, `${f.file}/${q}: below k=2 the façade must error, not answer`);
        assert.equal(Object.keys(b.answers[q].probabilities).length, s.from,
          `${f.file}/${q}: re-expansion must cover every ORIGINAL option`);
        assert.equal(Object.values(b.answers[q].probabilities).filter((v) => v > 0).length <= s.to, true,
          `${f.file}/${q}: more options carry mass than were sent to the engine`);
      }
    }
  });

  test('the compressed option budget is reported and never exceeds laya\'s 48-token amputation point (§10.1)', () => {
    for (const f of sso) {
      for (const s of Object.values(read(f.file).sso.shortlisted || {})) {
        if (!s.compressed_option_tokens) continue;
        assert.ok(s.compressed_option_tokens.max <= 48, 'a rubric over 48 tokens would be cut mid-sentence by the SDK');
        assert.ok(s.compressed_option_tokens.mean <= s.compressed_option_tokens.max);
      }
    }
  });

  test('windowing reports what it actually evaluated, and selects fewer windows than it made', () => {
    for (const f of sso) {
      const b = read(f.file);
      for (const [q, wd] of Object.entries(b.sso.windowed || {})) {
        assert.ok(wd.selected >= 1 && wd.selected <= wd.windows, `${f.file}/${q}: nonsensical window counts`);
        assert.ok(q in b.answers, `${f.file}: ${q} reported windowed but never answered`);
      }
    }
  });

  test('a local answer costs the engine far fewer input tokens than the cloud read — that is the whole point', () => {
    const cloud = read('typesafe-choice-router.json').usage.input_tokens;
    const local = read('sso-choice-router-shortlisted.json').usage.input_tokens;
    assert.ok(local < cloud / 10, `expected an order of magnitude: cloud ${cloud}, local ${local}`);
  });
});

describe('golden fixtures — error bodies are errors, not thin answers (§2)', () => {
  for (const f of manifest.fixtures.filter((x) => x.http_status >= 400)) {
    test(`${f.file}: carries a coded error and NO answers key`, () => {
      const b = read(f.file);
      assert.equal(typeof b.error.code, 'string');
      assert.ok(b.error.message.length > 0);
      assert.equal('answers' in b, false, 'an error body that also answers invites a consumer to use the answer');
    });
  }
});
