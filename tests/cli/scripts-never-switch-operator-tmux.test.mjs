'use strict';
// Regression guard for the 2026-10-01 tmux-client hijack. Agent of Empires'
// `aoe add --launch` handed the CALLING process's terminal to the new session
// with `tmux switch-client`; from a shell that merely inherited TMUX (a coding
// agent's tool shell) that client is the operator's, whatever tab they are on.
// AoE is retired (ADR-2153), but the mechanism is not specific to it, so the
// guard is kept in general form:
//   1. the AoE package and supervisor stay retired;
//   2. no tracked script, config or skill calls `tmux switch-client` (only the
//      picker, `agentbox-sessions pick`, may, and only on its own client) and
//      nothing invokes the retired `aoe` CLI.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the AoE package and supervisor are retired', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'flake.lock'), 'utf8'));
  assert.equal(lock.nodes[lock.root].inputs.aoe, undefined);
  const flake = fs.readFileSync(path.join(ROOT, 'flake.nix'), 'utf8');
  assert.ok(!flake.includes('[program:aoe-serve]'));
  assert.ok(!flake.includes('agent-of-empires'), 'no Agent of Empires mount or path in the image');
  assert.match(flake, /\[program:agentbox-sessions\][\s\S]*?autostart=true/);
});

test('no tracked script, config or skill switches a tmux client or runs the aoe CLI', () => {
  const tracked = execFileSync('git', ['-C', ROOT, 'ls-files', '--', 'scripts', 'config', 'skills', 'agentbox.sh', 'docs/user'], { encoding: 'utf8' })
    .split('\n')
    .filter((f) => /\.(sh|mjs|cjs|js|ts|toml|nix|fish)$/.test(f));
  const offenders = [];
  for (const f of tracked) {
    const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    text.split('\n').forEach((line, i) => {
      const code = line.replace(/^\s*(#|\/\/).*$/, '');
      if (/\btmux\b.*\bswitch-client\b/.test(code)) offenders.push(`${f}:${i + 1}: tmux switch-client: ${line.trim()}`);
      if (/(^|[\s;&|(`$'"])aoe\s+(add|session|serve|list|attach)\b/.test(code)) offenders.push(`${f}:${i + 1}: aoe CLI: ${line.trim()}`);
    });
  }
  assert.deepEqual(offenders, [], `scripts must never retarget the operator's tmux client:\n${offenders.join('\n')}`);
});
