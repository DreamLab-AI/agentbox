'use strict';

// Offline budget integrity controls: no provider calls, no production state.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const C = require('./review-cadence.cjs');
const NOW = new Date('2026-11-03T09:00:00Z');

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sealmap-budget-')));
  const repo = path.join(root, 'repo'), stateDir = path.join(root, 'private-state');
  fs.mkdirSync(repo);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, repo, stateDir, witness: path.join(stateDir, 'gemini-budget-2026-11.json') };
}
const reservation = { ts: NOW.toISOString(), kind: 'audit-reservation', reviewer: 'gemini', shard: 'core', pack_sha256: 'a'.repeat(64), est_usd: 2 };

test('budget witness deduplicates aliases and accepts append-only settlement refunds', (t) => {
  const f = fixture(t), alias = path.join(f.root, 'alias');
  fs.symlinkSync(f.repo, alias);
  C.appendLedger(f.repo, reservation);
  const initial = C.budgetLedgers([alias, f.repo, alias], NOW, f);
  assert.deepEqual(initial.repos, [f.repo]);
  assert.equal(initial.mtd, 2);
  assert.equal(fs.statSync(f.witness).mode & 0o777, 0o600);
  assert.equal(fs.statSync(f.stateDir).mode & 0o777, 0o700);
  const raw = fs.readFileSync(f.witness, 'utf8');
  assert.deepEqual(Object.keys(JSON.parse(raw).ledgers[f.repo]).sort(), ['bytes', 'sha256']);
  assert.ok(!raw.includes('est_usd'), 'the witness is not another spend ledger');
  C.appendLedger(f.repo, { ...reservation, kind: 'audit', reservation_at: reservation.ts, est_usd: 0.3 });
  const settled = C.budgetLedgers([], NOW, f);
  assert.equal(settled.mtd, 0.3, 'retained repos and valid settlements remain accountable without selection');
  assert.ok(JSON.parse(fs.readFileSync(f.witness)).ledgers[f.repo].bytes > JSON.parse(raw).ledgers[f.repo].bytes);
});

test('Git checkout of an older ledger and same-length rewrites cannot reopen the budget', (t) => {
  const f = fixture(t);
  const git = (...args) => execFileSync('git', ['-C', f.repo, ...args], { stdio: 'ignore' });
  git('init', '-q');
  C.appendLedger(f.repo, { ...reservation, est_usd: 0 });
  git('add', '.');
  git('-c', 'user.name=Budget Test', '-c', 'user.email=budget@example.invalid', 'commit', '-qm', 'old ledger');
  C.appendLedger(f.repo, reservation);
  C.budgetLedgers([f.repo], NOW, f);
  const charged = fs.readFileSync(C.ledgerPath(f.repo));
  const witness = fs.readFileSync(f.witness);
  git('checkout', '--', 'docs/diagrams/review-ledger.jsonl');
  assert.throws(() => C.budgetLedgers([f.repo], NOW, f), /rewind or rewrite/);
  assert.deepEqual(fs.readFileSync(f.witness), witness, 'failure never replaces the witness with a new baseline');
  fs.writeFileSync(C.ledgerPath(f.repo), charged.toString().replace('"est_usd":2', '"est_usd":0'));
  assert.equal(fs.statSync(C.ledgerPath(f.repo)).size, charged.length);
  assert.throws(() => C.budgetLedgers([f.repo], NOW, f), /rewind or rewrite/);
  fs.writeFileSync(C.ledgerPath(f.repo), charged);
  assert.equal(C.budgetLedgers([f.repo], NOW, f).mtd, 2, 'restoring the observed bytes repairs accounting');
});

test('remembered history remains in scope after corpus disappearance, exclusion or repository removal', (t) => {
  const f = fixture(t);
  C.appendLedger(f.repo, reservation);
  C.budgetLedgers([f.repo], NOW, f);
  assert.equal(C.budgetLedgers([], NOW, f).mtd, 2, 'no corpus or current discovery entry is needed');
  fs.renameSync(f.repo, path.join(f.root, 'removed-repo'));
  assert.throws(() => C.budgetLedgers([], NOW, f), /rewind or rewrite/);
});

test('unreadable ledgers and corrupt or unavailable witness state fail closed without replacement', (t) => {
  const f = fixture(t);
  C.appendLedger(f.repo, reservation);
  C.budgetLedgers([f.repo], NOW, f);
  const ledger = fs.readFileSync(C.ledgerPath(f.repo));
  fs.unlinkSync(C.ledgerPath(f.repo));
  fs.mkdirSync(C.ledgerPath(f.repo));
  assert.throws(() => C.budgetLedgers([], NOW, f), /cannot read review ledger/);
  fs.rmdirSync(C.ledgerPath(f.repo)); fs.writeFileSync(C.ledgerPath(f.repo), ledger);
  fs.writeFileSync(f.witness, '{broken');
  assert.throws(() => C.budgetLedgers([], NOW, f), /witness is inconclusive/);
  assert.equal(fs.readFileSync(f.witness, 'utf8'), '{broken');
  fs.unlinkSync(f.witness); fs.mkdirSync(f.witness);
  assert.throws(() => C.budgetLedgers([], NOW, f), /witness is inconclusive/);
  fs.rmdirSync(f.witness);
  fs.writeFileSync(f.witness, JSON.stringify({ version: 1, month: '2026-11', ledgers: { [f.repo]: { bytes: 1, sha256: 'invalid' } } }));
  assert.throws(() => C.budgetLedgers([], NOW, f), /invalid ledger witness/);
});

test('read-only accounting diagnoses rewinds without creating or advancing private state', (t) => {
  const f = fixture(t);
  C.appendLedger(f.repo, reservation);
  assert.equal(C.budgetLedgers([f.repo], NOW, { ...f, persist: false }).mtd, 2);
  assert.ok(!fs.existsSync(f.stateDir));
  C.budgetLedgers([f.repo], NOW, f);
  const previous = fs.readFileSync(f.witness);
  C.appendLedger(f.repo, { ...reservation, kind: 'audit', reservation_at: reservation.ts, est_usd: 0.4 });
  assert.equal(C.budgetLedgers([], NOW, { ...f, persist: false }).mtd, 0.4);
  assert.deepEqual(fs.readFileSync(f.witness), previous);
  fs.writeFileSync(C.ledgerPath(f.repo), '');
  const status = C.statusOf([], NOW, {}, { repos: [], stateDir: f.stateDir });
  assert.equal(status.mtd, null);
  assert.match(status.text, /accounting INCONCLUSIVE.*rewind or rewrite/);
  assert.deepEqual(fs.readFileSync(f.witness), previous);
});

test('a witness inside a reviewed working tree is refused', (t) => {
  const f = fixture(t);
  C.appendLedger(f.repo, reservation);
  assert.throws(() => C.budgetLedgers([f.repo], NOW, { stateDir: path.join(f.repo, 'state') }), /outside every reviewed working tree/);
  const alias = path.join(f.root, 'repo-link');
  fs.symlinkSync(f.repo, alias);
  assert.throws(() => C.budgetLedgers([f.repo], NOW, { stateDir: path.join(alias, 'new', 'state') }), /outside every reviewed working tree/);
  assert.ok(!fs.existsSync(path.join(f.repo, 'state')));
});
