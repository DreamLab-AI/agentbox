'use strict';
// Regression guard for the 2026-10-01 tmux-client hijack. `aoe add --launch`
// (and `aoe session attach`) hand the CALLING process's terminal to the new
// session with `tmux switch-client`; from a shell that merely inherited
// TMUX (a coding agent's tool shell) that is the operator's client, whatever
// tab they are on. Two layers keep it from recurring:
//   1. the baked aoe (DreamLab-AI/agentbox-of-empires) refuses to attach from
//      a non-tty shell — the flake must not pin a revision older than that fix;
//   2. nothing in this repo's scripts, config or skills may launch-and-attach
//      without `--no-attach` (the explicit form), so a future aoe regression
//      cannot be reached from our own tooling either.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Revisions of the fork known to switch the caller's client unconditionally.
const UNSAFE_AOE_REVS = ['d615b8c829028e272b492ea1726e8f490bc1479c'];

test('flake does not pin an aoe revision that attaches from a non-tty shell', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'flake.lock'), 'utf8'));
  const node = lock.nodes.aoe;
  assert.ok(node, 'flake.lock has an aoe input');
  assert.equal(node.locked.owner, 'DreamLab-AI');
  assert.equal(node.locked.repo, 'agentbox-of-empires');
  assert.ok(
    !UNSAFE_AOE_REVS.includes(node.locked.rev),
    `flake.lock pins aoe ${node.locked.rev}, which hijacks the caller's tmux client on --launch`,
  );
});

test('no tracked script, config or skill launches an aoe session attached', () => {
  const tracked = execFileSync('git', ['-C', ROOT, 'ls-files', '--', 'scripts', 'config', 'skills', 'agentbox.sh', 'docs/user'], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(sh|mjs|cjs|js|ts|md|toml|nix)$/.test(f));
  const offenders = [];
  // An `aoe add` whose argument list carries -l / --launch (as a standalone
  // short flag or inside a cluster like -yl) and no --no-attach.
  const launchFlag = /(^|\s)(--launch|-[a-zA-Z]*l[a-zA-Z]*)(\s|$)/;
  for (const f of tracked) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    text.split('\n').forEach((line, i) => {
      const m = /\baoe\s+add\b(.*)$/.exec(line);
      if (!m) return;
      const args = m[1];
      if (launchFlag.test(args) && !/--no-attach/.test(args)) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], `aoe add --launch without --no-attach:\n${offenders.join('\n')}`);
});
