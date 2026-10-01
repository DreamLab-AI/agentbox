// ADR-2093 amendment 2026-10-01 — credential redaction on the Jev request body
// (hooks/redact.mjs). Pure-function tests; no engine, no network.
// Run: node --test tests/config/jev-compaction-redact.test.mjs
//
// Credential-shaped fixtures are assembled at run time (j(...)) so no
// secret-shaped literal sits in the repository for scanners to trip on.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { REDACTED, redactDeep, redactSecrets } from '../../config/claude-plugins/jev-compaction/hooks/redact.mjs';

const j = (...parts) => parts.join('');
const R = REDACTED;
const red = (text, known) => redactSecrets(text, known);

describe('credential shapes are removed whole', () => {
  const cases = {
    anthropic: j('sk-', 'ant-api03-', 'Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z'),
    openai: j('sk-', 'proj-', 'Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Ji1Hg0Fe'),
    githubClassic: j('gh', 'p_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'),
    githubFine: j('github', '_pat_', '11ABCDEFG0123456789_abcdefghijKLMNOP'),
    awsKeyId: j('AK', 'IA', 'IOSFODNN7EXAMPLE'),
    nsec: j('ns', 'ec1', 'vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5'),
    slack: j('xo', 'xb-', '1234567890-abcdefghij'),
    jwt: j('ey', 'JhbGciOiJIUzI1NiJ9', '.', 'eyJzdWIiOiIxMjM0In0', '.', 'dBjftJeZ4CVPmB92K27uhbUJU1p1r'),
  };
  for (const [name, secret] of Object.entries(cases)) {
    test(name, () => {
      const r = red(`before ${secret} after`);
      assert.equal(r.text, `before ${R} after`);
      assert.equal(r.count, 1);
    });
  }
  test('a PEM private key, complete or cut off by truncation', () => {
    const begin = j('-----BEGIN ', 'OPENSSH PRIVATE KEY-----');
    const end = j('-----END ', 'OPENSSH PRIVATE KEY-----');
    const body = 'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW';
    assert.equal(red(`key:\n${begin}\n${body}\n${end}\ndone`).text, `key:\n${R}\ndone`);
    assert.equal(red(`{"content":"${begin}\\n${body.slice(0, 20)}…`).text, `{"content":"${R}`);
  });
  test('a token truncated to a short head still goes, when its prefix is distinctive', () => {
    assert.equal(red(j('x sk-', 'ant-api03', '-Ab3d…')).text, `x ${R}…`);
  });
});

describe('named slots keep the name and drop the value', () => {
  test('Bearer / Basic headers, in curl lines and in JSON-stringified tool input', () => {
    const tok = j('abc', '123DEF456ghi789');
    assert.equal(red(`curl -H "Authorization: Bearer ${tok}" https://x`).text, `curl -H "Authorization: Bearer ${R}" https://x`);
    assert.equal(red(JSON.stringify({ command: `curl -H 'Authorization: Basic ${tok}='` })).text, JSON.stringify({ command: `curl -H 'Authorization: Basic ${R}'` }));
  });
  test('env assignments, JSON keys and CLI flags', () => {
    const aws = j('wJalrXUtnFEMI/K7MDENG/', 'bPxRfiCYEXAMPLEKEY');
    assert.equal(red(`export AWS_SECRET_ACCESS_KEY=${aws}`).text, `export AWS_SECRET_ACCESS_KEY=${R}`);
    assert.equal(red(`{"apiKey":"${j('q8', 'Lm2Zx7Tp')}","model":"x"}`).text, `{"apiKey":"${R}","model":"x"}`);
    assert.equal(red(`DB_PASSWORD: ${j('hunter2', 'Hunter2')}`).text, `DB_PASSWORD: ${R}`);
    assert.equal(red(`tool --api-key ${j('k3y', 'V4lue99')} --verbose`).text, `tool --api-key ${R} --verbose`);
    assert.equal(red(`tool --token=${j('t0k', 'enV4lue')}`).text, `tool --token=${R}`);
  });
  test('URL credentials keep scheme, user and host', () => {
    const url = j('postgres://svc:', 'S3cr3t-P4ss', '@ruvector-postgres:5432/ruvector');
    assert.equal(red(`psql ${url}`).text, `psql postgres://svc:${R}@ruvector-postgres:5432/ruvector`);
  });
  test('the plugin\'s own key is removed exactly, wherever it appears', () => {
    const key = 'typesafe-key-value-0001';
    const r = red(`echo ${key} | tee x; again ${key}`, [key]);
    assert.equal(r.text, `echo ${R} | tee x; again ${R}`);
    assert.equal(r.count, 2);
  });
});

describe('ordinary text, ids and code pass through untouched', () => {
  const keep = [
    'TYPESAFE_API_KEY=$TYPESAFE_API_KEY',
    'const token = config.apiKey;',
    'password: required',
    'Bearer authentication is used here',
    'toolu_01A2b3C4d5E6f7G8h9J0kLmN and call_t12 and result_t12',
    'sha256-12-0a1b2c3d4e5f and commit 878f23311c0ffee0123456789abcdef012345678',
    'npm-run-all-and-some-very-long-kebab-name',
    'task-runner-sk-module and disk-usage-report-generator',
    'maxStateTokens: 25000, tokens: 180000',
    'see https://github.com/tamaratran/fast-jev-compaction/pull/112',
    'cargo test --release -- --nocapture',
  ];
  for (const text of keep) {
    test(text, () => assert.deepEqual(red(text), { text, count: 0 }));
  }
});

describe('redactDeep', () => {
  test('walks state and questions, leaves keys and non-strings, does not mutate its input', () => {
    const secret = j('gh', 'p_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8');
    const state = { history: [{ id: 't1', tool: 'Bash', input: `{"command":"git push https://x:${secret}@github.com/o/r"}`, chars: 12 }], goal: 'ship' };
    const questions = { call_t1: { type: 'noul', instructions: 'Tool call t1 (Bash) should stay' } };
    const frozen = JSON.stringify(state);
    const s = redactDeep(state);
    const q = redactDeep(questions);
    assert.equal(JSON.stringify(state), frozen);
    assert.equal(s.count, 1);
    assert.equal(s.value.history[0].chars, 12);
    assert.equal(s.value.history[0].id, 't1');
    assert.ok(!JSON.stringify(s.value).includes(secret));
    assert.deepEqual(q, { value: questions, count: 0 });
  });
  test('a string state (the compact fallback form) is redacted too', () => {
    const r = redactDeep(j('t3 Bash curl -H "Bearer ', 'abc123DEF456ghi789', '"'));
    assert.equal(r.value, `t3 Bash curl -H "Bearer ${R}"`);
  });
});

describe('cost', () => {
  test('linear on adversarial input: 200 kB of near-misses in well under a second', () => {
    const chunks = [
      'a_'.repeat(20_000), 'token'.repeat(5_000), 'sk-'.repeat(10_000), '-----BEGIN PRIVATE KEY-----'.repeat(500),
      'Bearer '.repeat(5_000), 'x://u:'.repeat(5_000), 'AKIA'.repeat(5_000),
    ];
    const t0 = performance.now();
    for (const c of chunks) red(c);
    assert.ok(performance.now() - t0 < 1000, `${Math.round(performance.now() - t0)} ms`);
  });
});
