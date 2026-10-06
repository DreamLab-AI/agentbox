'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const M = require('./merge-findings.cjs');

const f = (id, family, topics, title, evidence, extra = {}) => ({ id, family, topics, title, evidence, failure: extra.failure ?? '', status: 'unverified' });

const glmA = f('glm:critical:F-01', 'glm', 'CP-03.2', 'Session token never expires after logout', 'logout handler clears the cookie but the session token store keeps the token valid, src/auth/session.rs:44');
const gemA = f('gem:critical:F-04', 'gemini', 'CP-03', 'Logout leaves session token valid in the store', 'the cookie is cleared yet the session token remains valid in the token store src/auth/session.rs:44');
const glmB = f('glm:critical:F-02', 'glm', 'DB-01', 'Migration runs without a lock', 'two replicas can run the schema migration concurrently, db/migrate.rs:10');
const gemB = f('gem:critical:F-01', 'gemini', 'NET-02', 'Retry storm on relay reconnect', 'reconnect uses a fixed delay with no jitter so every client retries together');

test('topic ids normalise to the topic', () => {
  assert.deepStrictEqual([...M.topicIds({ topics: 'CP-03.2, DB-01' })].sort(), ['cp-03', 'db-01']);
});

test('the same problem from two families agrees; unrelated ones do not', () => {
  assert.ok(M.agree(glmA, gemA));
  assert.ok(!M.agree(glmA, gemB));
  assert.ok(!M.agree(glmB, gemB));
});

test('same topic but different claim does not agree', () => {
  const other = f('g:x', 'gemini', 'CP-03', 'Rate limit absent on login endpoint', 'brute force protections are missing for credentials endpoint');
  assert.ok(!M.agree(glmA, other));
});

test('a shared cited file anchors a match when topic ids differ', () => {
  const g = { ...gemA, topics: 'ZZ-09' };
  assert.ok(M.agree(glmA, g));
});

test('agreed findings rank first, order is otherwise stable', () => {
  const merged = M.mergeFindings([{ family: 'glm', findings: [glmB, glmA] }, { family: 'gemini', findings: [gemB, gemA] }]);
  assert.deepStrictEqual(merged.map((x) => x.id), ['glm:critical:F-01', 'gem:critical:F-04', 'glm:critical:F-02', 'gem:critical:F-01']);
  assert.deepStrictEqual(merged[0].families, ['gemini', 'glm']);
  assert.strictEqual(merged[0].agreement, 2);
  assert.deepStrictEqual(merged[0].corroborated_by, ['gem:critical:F-04']);
  assert.strictEqual(merged[2].agreement, 1);
});

test('one family never corroborates itself', () => {
  const twin = { ...glmA, id: 'glm:premortem:F-09' };
  const merged = M.mergeFindings([{ family: 'glm', findings: [glmA, twin] }, { family: 'gemini', findings: [] }]);
  assert.ok(merged.every((x) => x.agreement === 1 && x.corroborated_by.length === 0));
});

test('a third family joins the cluster transitively', () => {
  const third = f('o:1', 'other', 'CP-03.1', 'Token store keeps session token valid after logout', 'logout clears cookie, token remains valid in session token store');
  const merged = M.mergeFindings([{ family: 'glm', findings: [glmA] }, { family: 'gemini', findings: [gemA] }, { family: 'other', findings: [third] }]);
  assert.ok(merged.every((x) => x.agreement === 3));
});

test('familyOf reads the file name', () => {
  assert.strictEqual(M.familyOf('docs/review/2026-10-06-gemini.json'), 'gemini');
  assert.strictEqual(M.familyOf('/x/2026-10-06-glm.json'), 'glm');
  assert.strictEqual(M.familyOf('/x/codex.json'), 'codex');
});

test('the CLI writes merged json and markdown', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-'));
  fs.writeFileSync(path.join(d, '1-glm.json'), JSON.stringify([glmA, glmB]));
  fs.writeFileSync(path.join(d, '1-gemini.json'), JSON.stringify([gemA, gemB]));
  const out = path.join(d, 'merged.json');
  execFileSync(process.execPath, [path.join(__dirname, 'merge-findings.cjs'), path.join(d, '1-glm.json'), path.join(d, '1-gemini.json'), '--out', out]);
  const merged = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(merged.length, 4);
  assert.strictEqual(merged[0].agreement, 2);
  assert.match(fs.readFileSync(path.join(d, 'merged.md'), 'utf8'), /2 finding\(s\) raised independently/);
  assert.throws(() => execFileSync(process.execPath, [path.join(__dirname, 'merge-findings.cjs'), out], { stdio: 'pipe' }));
});
