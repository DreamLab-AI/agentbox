// trust-seed.cjs must trust every estate checkout in every Claude config store a
// session can read: ~/.claude.json and each wrapper profile's own
// profiles/<slug>/.claude/.claude.json (its CLAUDE_CONFIG_DIR). Seeding only the
// root store left the zai session blocked on the trust prompt (ADR-2153).
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config/hooks/trust-seed.cjs');

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'trust-seed-'));
  const ws = path.join(home, 'workspace');
  const repo = path.join(ws, 'wt', 'aoe-codex');
  fs.mkdirSync(repo, { recursive: true });
  fs.writeFileSync(path.join(repo, '.git'), 'gitdir: elsewhere\n');
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ keep: 1 }));
  const zai = path.join(ws, 'profiles', 'zai', '.claude');
  fs.mkdirSync(zai, { recursive: true });
  fs.writeFileSync(path.join(zai, '.claude.json'), JSON.stringify({ projects: { '/other': { hasTrustDialogAccepted: false, x: 1 } } }));
  fs.mkdirSync(path.join(ws, 'profiles', 'never-run'), { recursive: true });
  return { home, ws, repo, zai };
}

function run({ home, ws }, ...args) {
  execFileSync(process.execPath, [SCRIPT, ...args], { env: { ...process.env, HOME: home, WORKSPACE: ws }, stdio: 'pipe' });
}

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

test('trusts worktrees in the root store and in every wrapper profile store', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.home, { recursive: true, force: true }));
  run(f);
  for (const store of [path.join(f.home, '.claude.json'), path.join(f.zai, '.claude.json')]) {
    const cfg = read(store);
    assert.equal(cfg.projects[f.repo]?.hasTrustDialogAccepted, true, store);
    assert.equal(cfg.projects[f.ws]?.hasTrustDialogAccepted, true, store);
  }
  assert.equal(read(path.join(f.home, '.claude.json')).keep, 1, 'other root state kept');
  assert.equal(read(path.join(f.zai, '.claude.json')).projects['/other'].x, 1, 'other profile state kept');
});

test('never creates a store for a profile that has not run', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.home, { recursive: true, force: true }));
  run(f);
  assert.ok(!fs.existsSync(path.join(f.ws, 'profiles', 'never-run', '.claude', '.claude.json')));
});

test('dry run writes nothing', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.home, { recursive: true, force: true }));
  const before = fs.readFileSync(path.join(f.zai, '.claude.json'), 'utf8');
  run(f, '--dry-run');
  assert.equal(fs.readFileSync(path.join(f.zai, '.claude.json'), 'utf8'), before);
});
