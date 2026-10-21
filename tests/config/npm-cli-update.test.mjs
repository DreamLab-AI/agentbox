import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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
