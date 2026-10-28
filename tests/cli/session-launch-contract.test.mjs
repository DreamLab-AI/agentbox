// ADR-2153 launch contract: every [[interaction_plane.session_seeds]] entry
// must start, under the pinned CLI versions, into a live pane that is not
// waiting on a human. AoE never checked this, which is how OpenCode v2 dropping
// its TUI model flag silently killed three sessions.
//
// Tiers:
//   static (always, CI-safe): the seeds resolve against config/session-plane/launch.json
//   AGENTBOX_LIVE_LAUNCH=1:    launch each seed on a private tmux server (-L) in its
//                              prepared session directory; pane alive, not blocked
//   AGENTBOX_LIVE_ROUNDTRIP=1: also send one canned prompt and wait for the answer
//
// The live tiers never touch the operator's tmux server and kill their own on exit.
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOME = process.env.HOME || os.homedir();
const WORKSPACE = process.env.WORKSPACE || path.join(HOME, 'workspace');
const PROJECT = path.join(WORKSPACE, 'project');
const contract = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/session-plane/launch.json'), 'utf8'));
const manifestText = fs.readFileSync(path.join(ROOT, 'agentbox.toml'), 'utf8');

// CI's invariants job installs no node_modules, so the seeds are read with a
// narrow extractor: [[interaction_plane.session_seeds]] tables hold only string,
// boolean and string-array scalars. When @iarna/toml is resolvable the extractor
// is checked against it, so a seed shape it cannot read fails loudly.
export function readSeeds(text) {
  const seeds = [];
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      cur = line === '[[interaction_plane.session_seeds]]' ? {} : null;
      if (cur) seeds.push(cur);
      continue;
    }
    if (!cur) continue;
    const m = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!m) throw new Error(`session seed line not understood: ${raw}`);
    cur[m[1]] = JSON.parse(m[2]);
  }
  return seeds;
}

const seeds = readSeeds(manifestText);

export function wrapperPath(slug) {
  return path.join(ROOT, 'config/harness-wrappers', `${slug}.sh`);
}

export function launchKind(seed) {
  const hasWrapper = fs.existsSync(wrapperPath(seed.slug));
  if (hasWrapper && (seed.tool === 'claude' || seed.tool === `custom:${seed.slug}`)) return 'wrapper';
  if (contract.tools[seed.tool]) return seed.tool;
  throw new Error(`seed "${seed.slug}": tool "${seed.tool}" has no launch template`);
}

function fill(s, seed) {
  return s.replaceAll('{slug}', seed.slug).replaceAll('{model}', seed.model ?? '').replaceAll('{wrapper}', wrapperPath(seed.slug));
}

export function resolveLaunch(seed) {
  const kind = launchKind(seed);
  const t = contract.tools[kind];
  const argv = t.argv.map((a) => fill(a, seed));
  const env = {};
  if (seed.model && kind !== 'wrapper') {
    if (t.model_argv) argv.push(...t.model_argv.map((a) => fill(a, seed)));
    for (const [k, v] of Object.entries(t.model_env ?? {})) env[k] = fill(v, seed);
    if (!t.model_argv && !t.model_env) throw new Error(`seed "${seed.slug}": ${kind} has no way to receive a model`);
  }
  return { kind, argv, env, blockers: [...contract.common_blockers, ...t.blockers], ready: t.ready };
}

// AGENTBOX_LAUNCH_DIR runs every seed in one directory, which checks the
// CLI-level contract on its own, before the daemon prepares real session dirs.
export function sessionDir(seed, { override = true } = {}) {
  if (override && process.env.AGENTBOX_LAUNCH_DIR) return process.env.AGENTBOX_LAUNCH_DIR;
  if (!seed.worktree) return PROJECT;
  return path.join(contract.worktree_root.replace(/^~/, HOME), `${contract.worktree_prefix}${seed.slug}`);
}

// ── static tier ─────────────────────────────────────────────────────────────

test('seed extractor agrees with a real TOML parser when one is available', (t) => {
  let TOML;
  for (const base of [import.meta.url, path.join(ROOT, 'noop.js'), path.join(PROJECT, 'agentbox', 'noop.js')]) {
    try { TOML = createRequire(base)('@iarna/toml'); break; } catch { /* next */ }
  }
  if (!TOML) return t.skip('@iarna/toml not installed');
  const parsed = TOML.parse(manifestText).interaction_plane.session_seeds;
  assert.deepEqual(JSON.parse(JSON.stringify(parsed)), seeds);
});

test('every seed resolves to a launch template', () => {
  assert.ok(seeds.length > 0, 'no [[interaction_plane.session_seeds]] found');
  for (const seed of seeds) assert.doesNotThrow(() => resolveLaunch(seed), seed.slug);
});

test('OpenCode never receives the model on argv (v2 removed the TUI flag)', () => {
  for (const seed of seeds.filter((s) => s.tool === 'opencode')) {
    const { argv, env } = resolveLaunch(seed);
    assert.ok(!argv.includes('-m') && !argv.includes('--model'), `${seed.slug}: ${argv.join(' ')}`);
    assert.ok(argv.includes('--standalone'), `${seed.slug}: shares the background service`);
    assert.equal(JSON.parse(env.OPENCODE_CONFIG_CONTENT).model, seed.model);
  }
});

test('the roster matches ADR-2153: loom-raw is the local Qwen seed, the scaffolded loom seed is gone', () => {
  const slugs = seeds.map((s) => s.slug);
  assert.ok(!slugs.includes('loom'), 'scaffolded OpenCode seed "loom" must be removed');
  const raw = seeds.find((s) => s.slug === 'loom-raw');
  assert.equal(raw?.model, 'loom-agent/current');
  assert.equal(new Set(slugs).size, slugs.length, 'duplicate seed slugs');
});

test('worktrees live under the one worktree root and the contract pins no store paths', () => {
  assert.equal(contract.worktree_root, '~/workspace/wt');
  assert.ok(!JSON.stringify(contract).includes('/nix/store/'), 'launch.json must not pin /nix/store paths');
  for (const seed of seeds.filter((s) => s.worktree)) {
    const dir = sessionDir(seed, { override: false });
    assert.ok(dir.startsWith(path.join(WORKSPACE, 'wt') + path.sep), dir);
  }
});

test('every wrapper the contract resolves exists and is executable', () => {
  for (const seed of seeds.filter((s) => launchKind(s) === 'wrapper')) {
    fs.accessSync(wrapperPath(seed.slug), fs.constants.X_OK);
  }
});

// ── live tiers ──────────────────────────────────────────────────────────────

const LIVE = process.env.AGENTBOX_LIVE_LAUNCH === '1' || process.env.AGENTBOX_LIVE_ROUNDTRIP === '1';
const ROUNDTRIP = process.env.AGENTBOX_LIVE_ROUNDTRIP === '1';
const SOCKET = `abs-contract-${process.pid}`;

function tmux(...args) {
  return execFileSync('tmux', ['-L', SOCKET, ...args], { encoding: 'utf8' });
}
function capture(name) {
  return tmux('capture-pane', '-p', '-t', name);
}
function paneDead(name) {
  return tmux('display-message', '-p', '-t', name, '#{pane_dead}').trim() === '1';
}
function shQuote(s) {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}
async function waitFor(fn, seconds) {
  for (let i = 0; i < seconds * 2; i++) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
  return fn();
}

test('live: every seed starts into a live, unblocked pane', { skip: !LIVE && 'set AGENTBOX_LIVE_LAUNCH=1' }, async (t) => {
  const socketPath = path.join(process.env.TMUX_TMPDIR || '/tmp', `tmux-${process.getuid()}`, SOCKET);
  t.after(() => {
    try { tmux('kill-server'); } catch { /* already gone */ }
    fs.rmSync(socketPath, { force: true });
  });
  // remain-on-exit must be global before the first launch: a command that
  // exits at once (OpenCode's old -m failure) would otherwise take its session
  // with it before a per-session option could be set.
  tmux('new-session', '-d', '-s', '_hold');
  tmux('set-option', '-g', 'remain-on-exit', 'on');
  for (const seed of seeds) {
    await t.test(seed.slug, async () => {
      const dir = sessionDir(seed);
      assert.ok(fs.existsSync(dir), `session directory ${dir} is not prepared`);
      const { argv, env, blockers, ready } = resolveLaunch(seed);
      const envArgs = Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
      tmux('new-session', '-d', '-s', seed.slug, '-x', '200', '-y', '50', '-c', dir, ...envArgs, argv.map(shQuote).join(' '));
      const settled = await waitFor(() => {
        const pane = capture(seed.slug);
        return paneDead(seed.slug) || blockers.some((b) => pane.includes(b)) || (ready && pane.includes(ready));
      }, contract.settle_seconds);
      const pane = capture(seed.slug);
      assert.ok(!paneDead(seed.slug), `pane died:\n${pane}`);
      const hit = blockers.find((b) => pane.includes(b));
      assert.equal(hit, undefined, `blocked on "${hit}":\n${pane}`);
      if (ready) assert.ok(settled && pane.includes(ready), `never showed "${ready}":\n${pane}`);

      if (!ROUNDTRIP || seed.slug === 'router') return; // router dispatches to the public fleet by design
      const n = 1000 + Math.floor(Math.random() * 8000);
      tmux('send-keys', '-t', seed.slug, '-l', `Reply with only the word PONG, a hyphen, and the number ${n} plus one.`);
      // Codex treats text and Enter arriving in one burst as a paste and keeps
      // the Enter as a newline; the prompt is only submitted after a pause.
      await new Promise((r) => setTimeout(r, 1500));
      tmux('send-keys', '-t', seed.slug, 'Enter');
      const answered = await waitFor(() => capture(seed.slug).includes(`PONG-${n + 1}`), 180);
      assert.ok(answered, `no PONG-${n + 1} within 180s:\n${capture(seed.slug)}`);
    });
  }
});
