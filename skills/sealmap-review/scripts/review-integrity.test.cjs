'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const C = require('./review-cadence.cjs');
const E = require('./external-review.cjs');
const M = require('./merge-findings.cjs');
const base = { topics: 'SP-01', title: 'Private provenance leaks resource data', evidence: 'src/prov.rs:99 resource data lacks WAC read check', failure: 'anonymous caller reads private data', status: 'unverified' };
const origin = (model, pack = 'a'.repeat(64)) => ({ schema: 1, run_id: model, pack_sha256: pack, scope_sha256: 'c'.repeat(64), register: 'include', reviewer: { model }, complete: true });

test('agreement needs a matching pack and scope, known distinct families and completed provenance', () => {
  const merge = (a, b) => M.mergeFindings([{ family: 'monday', findings: [{ ...base, id: 'a', origin: a }] }, { family: 'tuesday', findings: [{ ...base, id: 'b', origin: b }] }]);
  assert.equal(merge(origin('glm-5.3'), origin('gemini-3.8-flash'))[0].agreement, 2);
  for (const [a, b] of [[undefined, undefined], [origin('glm-5.3'), origin('glm-4')], [origin('glm-5.3'), origin('unknown')], [origin('glm-5.3'), origin('gemini-3.8-flash', 'b'.repeat(64))], [origin('glm-5.3'), { ...origin('gemini-3.8-flash'), scope_sha256: 'd'.repeat(64) }], [origin('glm-5.3'), { ...origin('gemini-3.8-flash'), complete: false }]]) {
    assert.ok(merge(a, b).every(f => f.agreement <= 1), 'uncorroborated when evidence does not establish comparability');
  }
});

test('triage refuses contradictory and quoted verdicts while retaining a valid NO control', () => {
  assert.equal(C.parseVerdict('VERDICT: NO\nREASON: unchanged'), false);
  assert.equal(C.parseVerdict('VERDICT: NO\nVERDICT: YES'), true);
  assert.equal(C.parseVerdict('Previously VERDICT: NO\nVERDICT: YES'), true);
});

test('review parser refuses malformed, truncated and incomplete findings; explicit empty review is valid', () => {
  assert.throws(() => E.checkedFindings('## F-01 — hidden failure', 'critical'), /inconclusive/);
  assert.throws(() => E.checkedFindings('### F-01 — incomplete', 'critical'), /inconclusive/);
  assert.throws(() => E.checkedFindings('The prompt said:\n```\nNO_FINDINGS\n```\nCould not inspect.', 'critical'), /inconclusive/);
  assert.throws(() => E.checkedFindings('## Not judgeable from this material\nNO_FINDINGS', 'critical'), /inconclusive/);
  assert.deepEqual(E.checkedFindings('NO_FINDINGS\n## Not judgeable from this material\nRuntime deployment.', 'critical'), []);
  assert.equal(E.checkedFindings('### F-01 — failure\n- Topics: A-01\n- Evidence: read.rs:1\n- Failure: bad access', 'critical').length, 1);
});

test('corrupt ledger and invalid spend refuse paid accounting without changing the raw file', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'review-integrity-'));
  try {
    const file = C.ledgerPath(repo); fs.mkdirSync(path.dirname(file), { recursive: true });
    const raw = '{"kind":"audit-reservation","est_usd":'; fs.writeFileSync(file, raw);
    assert.throws(() => C.readLedger(repo), /ledger/);
    assert.equal(fs.readFileSync(file, 'utf8'), raw);
    assert.throws(() => C.monthToDateUsd([[{ reviewer: 'gemini', ts: '2026-11-03', est_usd: -5 }]], new Date('2026-11-03')), /spend/);
  } finally { fs.rmSync(repo, { recursive: true }); }
});

test('receipt command delegates unchanged arguments and preserves CLI outcome; unavailable never passes', async () => {
  let call;
  const spawn = (...args) => { call = args; return { status: 1, stdout: '', stderr: '' }; };
  assert.equal(await C.main(['receipts', 'check', '/tmp/receipts.json', '--json', '--require-resolved'], { spawn }), 1);
  assert.deepEqual(call[0], 'sealmap');
  assert.deepEqual(call[1], ['review', 'check', '/tmp/receipts.json', '--json', '--require-resolved']);
  assert.throws(() => C.receiptCommand(['summary', 'r.json'], () => ({ error: new Error('ENOENT') })), /unavailable/);
});

test('diagnostic status preserves a corrupt ledger, while an audit refuses before transport', async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'review-budget-'));
  try {
    fs.mkdirSync(path.dirname(C.ledgerPath(repo)), { recursive: true });
    fs.writeFileSync(C.ledgerPath(repo), '{broken');
    assert.match(C.statusOf([repo], new Date()).text, /accounting INCONCLUSIVE/);
    await assert.rejects(C.auditGemini(repo, { now: new Date(), cfg: C.DEFAULTS, dryRun: false, runExternal: () => { throw new Error('must never call'); } }), /invalid review ledger/);
    assert.equal(fs.readFileSync(C.ledgerPath(repo), 'utf8'), '{broken');
    fs.writeFileSync(C.ledgerPath(repo), JSON.stringify({ ts: '2026-11-03', reviewer: 'gemini', kind: 'audit', est_usd: 2 }));
    C.appendLedger(repo, { reviewer: 'glm', kind: 'triage' });
    assert.equal(C.readLedger(repo).length, 2, 'a complete EOF row is separated without rewriting it');
  } finally { fs.rmSync(repo, { recursive: true }); }
});
