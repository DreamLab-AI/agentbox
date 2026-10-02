const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');

test('sidechain parent gate dominates enabled child gates in the system catalogue', () => {
  const { buildSystemView } = require('../../management-api/lib/system-manifest.js');
  for (const enabled of [false, true]) {
    const view = buildSystemView({ sidechain: { enabled, mirror: true, faucet: true } });
    assert.equal(view.modules.find(m => m.id === 'sidechain').state, enabled ? 'on' : 'off');
  }
});

test('[sidechain].enabled dominates a chain table, which dominates its own mirror and faucet', () => {
  const { buildSystemView } = require('../../management-api/lib/system-manifest.js');
  const state = (parent, enabled) => buildSystemView({ sidechain: { enabled: parent, 'dreamlab-txbt4': { enabled, parent: 'txbt4', mirror: true, faucet: true } } })
    .modules.find(m => m.id === 'sidechain-dreamlab-txbt4').state;
  assert.equal(state(false, true), 'off', 'the parent table off turns the chain off');
  assert.equal(state(true, false), 'off', 'the chain off turns its mirror and faucet off');
  assert.equal(state(false, false), 'off');
  assert.equal(state(true, true), 'on');
});

test('mirror retries a failed push without a new block and leaves unrelated staged files alone', { timeout: 15000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sidechain-mirror-test-'));
  const pages = path.join(root, 'pages'), remote = path.join(root, 'remote.git'), state = path.join(root, 'state');
  const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  let child;
  try {
    fs.mkdirSync(pages); fs.mkdirSync(state);
    execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
    git(pages, 'init', '-b', 'main');
    git(pages, 'config', 'user.email', 'fixture@example.invalid');
    git(pages, 'config', 'user.name', 'Synthetic fixture');
    git(pages, 'config', 'commit.gpgsign', 'false');
    for (const [name, value] of Object.entries({ 'chain.json': '{}', 'blocks.dat': 'old', 'blocks.json': '{"to":0}' })) fs.writeFileSync(path.join(pages, name), value);
    git(pages, 'add', '.'); git(pages, 'commit', '-m', 'seed');
    git(pages, 'remote', 'add', 'origin', remote); git(pages, 'push', '-u', 'origin', 'main');
    fs.writeFileSync(path.join(pages, 'unrelated.txt'), 'keep staged'); git(pages, 'add', 'unrelated.txt');
    fs.writeFileSync(path.join(state, 'blocks.dat'), 'new');
    fs.writeFileSync(path.join(state, 'blocks.json'), '{"to":1}');
    fs.writeFileSync(path.join(pages, '.git/hooks/pre-push'), '#!/bin/sh\nif [ ! -e .git/failed-once ]; then touch .git/failed-once; exit 1; fi\n', { mode: 0o755 });
    let output = '';
    child = spawn('bash', [path.resolve(__dirname, '../../config/sidechain/mirror-sync.sh'), pages, '1'], {
      detached: true, env: { ...process.env, SIDESTR_STATE: state, SIDESTR_PRODUCER_URL: 'http://127.0.0.1:1' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', b => { output += b; });
    child.stderr.resume();
    for (let i = 0; i < 100 && !output.includes('mirror synchronized'); i++) await new Promise(r => setTimeout(r, 100));
    assert.match(output, /push failed; will retry/);
    assert.match(output, /mirror synchronized/);
    assert.equal(git(remote, 'show', 'main:blocks.json'), '{"to":1}');
    assert.equal(git(pages, 'diff', '--cached', '--name-only'), 'unrelated.txt');
    assert.equal(git(remote, 'ls-tree', '--name-only', 'main').includes('unrelated.txt'), false);
  } finally {
    if (child) {
      const exited = new Promise(r => child.once('exit', r));
      try { process.kill(-child.pid, 'SIGTERM'); } catch {}
      if (child.exitCode === null && child.signalCode === null) await exited;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
