import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('successful rehash counts zero unresolved hashes on one line', () => {
  const source = fs.readFileSync('scripts/prefetch-hashes.sh', 'utf8');
  const line = source.split('\n').find(x => x.trimStart().startsWith('remaining=$(grep -c'));
  assert(line);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-hash-count-'));
  try {
    fs.writeFileSync(path.join(root, 'flake.nix'), 'resolved = "sha256-real";\n');
    const run = spawnSync('bash', ['-eu', '-c', `${line}\n[ "$remaining" -eq 0 ]\nprintf '%s' "$remaining"`], {
      encoding: 'utf8', env: {...process.env, REPO_ROOT: root},
    });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, '0');
  } finally { fs.rmSync(root, {recursive:true, force:true}); }
});

test('release discovery accepts npm object and singleton-array responses', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-pin-test-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.mkdirSync(path.join(root, 'bin'));
    fs.copyFileSync('scripts/bump-npm-cli-versions.sh', path.join(root, 'scripts/bump.sh'));
    fs.writeFileSync(path.join(root, 'flake.nix'), 'p = mkNpmCli { pkgName = "fixture"; version = "1.0.0"; };');
    const meta = { time: { '1.0.0': '2020-01-01', '1.1.0': '2020-01-02' }, versions: ['1.0.0', '1.1.0'] };
    for (const response of [meta, [meta]]) {
      fs.writeFileSync(path.join(root, 'bin/npm'), '#!/bin/sh\ncat "$NPM_TEST_METADATA"\n', { mode: 0o755 });
      fs.writeFileSync(path.join(root, 'metadata.json'), JSON.stringify(response));
      const run = spawnSync('bash', [path.join(root, 'scripts/bump.sh'), '--dry-run'], {
        encoding: 'utf8', env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, NPM_TEST_METADATA: path.join(root, 'metadata.json') },
      });
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stdout, /1\.0\.0 -> 1\.1\.0/);
      assert.match(run.stdout, /1 bump\(s\) available/);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
