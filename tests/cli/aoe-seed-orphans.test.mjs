'use strict';
// Regression test for the seeder's orphan-worktree reaper. On 2026-09-05 the
// first version read `s.path` (the CLI's field) instead of the daemon's
// `project_path`, saw no live sessions, and reaped the four live worktrees.
// The reaper must (1) fail closed when a managed-worktree session has no
// path, (2) keep live, dirty and ahead worktrees, (3) reap clean unreferenced
// ones, (4) move a dead non-worktree directory aside, (5) ignore other slugs.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEEDER = path.resolve(HERE, '..', '..', 'scripts', 'aoe-seed-sessions.mjs');

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid',
  GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
};
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { env: GIT_ENV, encoding: 'utf8', stdio: 'pipe' }).trim();

const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'aoe-seed-orphans-'));
const project = path.join(ws, 'project');
const trees = `${project}-worktrees`;
fs.mkdirSync(project);
git(project, 'init', '-q', '-b', 'main');
fs.writeFileSync(path.join(project, 'README'), 'seed\n');
git(project, 'add', 'README');
git(project, 'commit', '-q', '-m', 'init');
fs.mkdirSync(trees);
const add = (name) => { git(project, 'worktree', 'add', '-q', '-b', name, path.join(trees, name)); return path.join(trees, name); };
const clean = add('loom-2');
const dirty = add('loom-3'); fs.writeFileSync(path.join(dirty, 'scratch.txt'), 'wip\n');
const ahead = add('loom-4'); fs.writeFileSync(path.join(ahead, 'README'), 'changed\n'); git(ahead, 'commit', '-q', '-am', 'work');
const live = add('loom-5');
const other = add('unrelated-2');
const dead = path.join(trees, 'loom-raw'); fs.mkdirSync(path.join(dead, 'agentbox'), { recursive: true });

// The module reads WORKSPACE at import time; set it before the import.
process.env.WORKSPACE = ws;
process.argv[1] = '/definitely/not/the/seeder';
const mod = await import(pathToFileURL(SEEDER).href);
const { reapOrphanWorktrees } = mod;

const registered = () => git(project, 'worktree', 'list', '--porcelain').split('\n').filter((l) => l.startsWith('worktree ')).map((l) => l.slice(9));

test('the reaper is exported and the module did not run main() on import', () => {
  assert.equal(typeof reapOrphanWorktrees, 'function');
});

test('a managed-worktree session without a path makes the reaper refuse to act', () => {
  const before = registered();
  reapOrphanWorktrees([{ title: 'loom', has_managed_worktree: true }]);
  assert.deepEqual(registered(), before);
  assert.ok(fs.existsSync(dead));
});

test('only clean, unreferenced, commit-free worktrees of seeded slugs are reaped', () => {
  reapOrphanWorktrees([
    { title: 'tab0', project_path: project, has_managed_worktree: false },
    { title: 'loom', project_path: live, has_managed_worktree: true },
  ]);
  const after = registered();
  assert.ok(!after.includes(clean), 'clean orphan reaped');
  assert.ok(!fs.existsSync(clean));
  assert.throws(() => git(project, 'rev-parse', '--verify', 'loom-2'), 'orphan branch deleted');
  assert.ok(after.includes(dirty), 'dirty worktree kept');
  assert.ok(after.includes(ahead), 'worktree with commits kept');
  assert.ok(after.includes(live), 'live session worktree kept');
  assert.ok(after.includes(other), 'non-seed slug untouched');
  assert.ok(!fs.existsSync(dead), 'dead directory moved aside');
  const aside = fs.readdirSync(trees).filter((n) => n.startsWith('loom-raw.orphan-'));
  assert.equal(aside.length, 1);
});
