const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runCase(t, { nixFails = false, invalidCompose = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'compose refresh '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'scripts'));
  fs.mkdirSync(path.join(root, 'bin'));
  fs.mkdirSync(path.join(root, 'generated'));
  fs.copyFileSync(path.resolve(__dirname, '../../scripts/refresh-compose.sh'),
    path.join(root, 'scripts/refresh-compose.sh'));
  fs.writeFileSync(path.join(root, 'docker-compose.yml'), 'old configuration\n');
  fs.writeFileSync(path.join(root, 'generated/docker-compose.yml'), 'new configuration\n');
  fs.writeFileSync(path.join(root, 'bin/nix'),
    `#!/bin/sh\n${nixFails ? 'exit 1' : 'printf "%s\\n" "$COMPOSE_TEST_ROOT/generated"'}\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'bin/docker'),
    `#!/bin/sh\nexit ${invalidCompose ? 1 : 0}\n`, { mode: 0o755 });
  const result = spawnSync('bash', [path.join(root, 'scripts/refresh-compose.sh')], {
    encoding: 'utf8',
    env: { ...process.env, COMPOSE_TEST_ROOT: root, PATH: `${root}/bin:${process.env.PATH}` },
  });
  return { result, content: fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8') };
}

test('successful generation replaces stale Compose, including paths with spaces', t => {
  const { result, content } = runCase(t);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(content, 'new configuration\n');
});
test('failed Nix generation preserves the existing configuration', t => {
  const { result, content } = runCase(t, { nixFails: true });
  assert.notEqual(result.status, 0);
  assert.equal(content, 'old configuration\n');
});
test('invalid generated Compose preserves the existing configuration', t => {
  const { result, content } = runCase(t, { invalidCompose: true });
  assert.notEqual(result.status, 0);
  assert.equal(content, 'old configuration\n');
});
