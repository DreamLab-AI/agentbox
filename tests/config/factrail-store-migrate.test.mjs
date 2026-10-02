// Contract tests for scripts/factrail-store-migrate.mjs (ADR-2121): the sticky
// email taint must survive the move from the jev-compaction plugin to factrail.
// Run: node --test tests/config/factrail-store-migrate.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FACTRAIL, LEGACY, migrate, storeFile } from '../../scripts/factrail-store-migrate.mjs';

const taint = (tool) => ({ tainted: true, count: 1, sample: [tool], at: 1790421736252 });

function scratch(legacy, factrail) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'factrail-store-'));
  if (legacy !== undefined) fs.writeFileSync(path.join(dir, LEGACY), typeof legacy === 'string' ? legacy : JSON.stringify(legacy));
  if (factrail !== undefined) fs.writeFileSync(path.join(dir, FACTRAIL), typeof factrail === 'string' ? factrail : JSON.stringify(factrail));
  return dir;
}
const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
const exists = (dir, f) => fs.existsSync(path.join(dir, f));

test('store file names follow Claude Code: sha256 of name@marketplace, 12 hex', () => {
  // Observed on disk for the installed plugins on 2026-10-02.
  assert.equal(storeFile('jev-compaction', 'agentbox'), 'jev-compaction_agentbox-e312ad2cb810.json');
  assert.equal(storeFile('cc-plugin-diff', 'builtin'), 'cc-plugin-diff_builtin-3903e77c01b1.json');
  assert.match(FACTRAIL, /^factrail_agentbox-[0-9a-f]{12}\.json$/);
});

test('no legacy store: nothing happens', () => {
  const dir = scratch(undefined, undefined);
  assert.deepEqual(migrate(dir), { status: 'none' });
  assert.equal(exists(dir, FACTRAIL), false);
});

test('tainted sessions are carried over; clean records, baselines and last are not', () => {
  const dir = scratch({
    'taint:a': taint('mcp__email-gateway__ask_email'),
    'taint:b': { tainted: false, count: 0, sample: [], at: 1 },
    'baseline:a': { pending: true, at: 1 },
    last: 'jev-compaction: built-in',
  });
  assert.deepEqual(migrate(dir), { status: 'migrated', taints: 1, enabled: false });
  assert.deepEqual(read(dir, FACTRAIL), { 'taint:a': taint('mcp__email-gateway__ask_email') });
  assert.equal(exists(dir, LEGACY), false);
  assert.equal(exists(dir, `${LEGACY}.migrated`), true);
});

test("factrail's own records win: taint only widens, the switch is never overwritten", () => {
  const mine = taint('mcp__claude_ai_Gmail__search');
  const dir = scratch(
    { 'taint:a': taint('mcp__email-gateway__ask_email'), 'taint:c': taint('Skill:email-search'), enabled: true },
    { 'taint:a': mine, enabled: false, 'baseline:z': { pending: false, tokens: 9 } },
  );
  assert.deepEqual(migrate(dir), { status: 'migrated', taints: 1, enabled: false });
  const out = read(dir, FACTRAIL);
  assert.deepEqual(out['taint:a'], mine);
  assert.deepEqual(out['taint:c'], taint('Skill:email-search'));
  assert.equal(out.enabled, false);
  assert.deepEqual(out['baseline:z'], { pending: false, tokens: 9 });
});

test('a clean record in factrail does not hide a legacy taint', () => {
  const dir = scratch({ 'taint:a': taint('mcp__email-gateway__ask_email') }, { 'taint:a': { tainted: false } });
  migrate(dir);
  assert.equal(read(dir, FACTRAIL)['taint:a'].tainted, true);
});

test('the switch position is carried when factrail has none', () => {
  const dir = scratch({ enabled: false }, undefined);
  assert.deepEqual(migrate(dir), { status: 'migrated', taints: 0, enabled: true });
  assert.deepEqual(read(dir, FACTRAIL), { enabled: false });
});

test('one-shot: a second run finds nothing to do', () => {
  const dir = scratch({ 'taint:a': taint('mcp__email-gateway__ask_email') }, undefined);
  migrate(dir);
  assert.deepEqual(migrate(dir), { status: 'none' });
});

test('an unreadable factrail store is refused, never overwritten, and the legacy file is kept', () => {
  const dir = scratch({ 'taint:a': taint('mcp__email-gateway__ask_email') }, '{not json');
  const r = migrate(dir);
  assert.equal(r.status, 'error');
  assert.equal(fs.readFileSync(path.join(dir, FACTRAIL), 'utf8'), '{not json');
  assert.equal(exists(dir, LEGACY), true);
});

test('an unreadable legacy store is refused and left in place', () => {
  const dir = scratch('[1,2]', undefined);
  assert.equal(migrate(dir).status, 'error');
  assert.equal(exists(dir, LEGACY), true);
  assert.equal(exists(dir, FACTRAIL), false);
});
