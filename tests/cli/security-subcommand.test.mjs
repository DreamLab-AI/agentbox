'use strict';
// ER-14 regression guard: `./agentbox.sh security` was dispatched (case arm
// running scripts/security-scan.sh) but missing from the argument-parser
// allowlist, so it was rejected as "Unknown command" before dispatch.
// Only --help and a deliberately invalid scan are run: no Docker, Nix or network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const run = (...args) =>
  spawnSync('bash', [path.join(ROOT, 'agentbox.sh'), ...args], { encoding: 'utf8' });

test('security is accepted by the subcommand allowlist and reaches security-scan.sh', () => {
  const r = run('security', '--help');
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout + r.stderr, /Unknown command/);
  assert.match(r.stdout, /security-scan\.sh report/);
});

test('security scan without a digest-pinned image fails in the scanner, not the allowlist', () => {
  const r = run('security', 'scan');
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stdout + r.stderr, /Unknown command/);
  assert.match(r.stderr, /immutable repository@sha256:DIGEST/);
});

test('an unknown subcommand is still rejected', () => {
  const r = run('definitely-not-a-command');
  assert.equal(r.status, 1);
  assert.match(r.stdout + r.stderr, /Unknown command: definitely-not-a-command/);
});

test('usage text lists security', () => {
  const r = run('--help');
  assert.match(r.stdout, /security\b.*SBOM/);
});
