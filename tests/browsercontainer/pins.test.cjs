// ADR-2207 D6: pins and cleanup in the browser sidecar.
//
// Properties under test:
//   - chrome-devtools-mcp is pinned to exactly 1.13.0 in the image
//   - ws is pinned to exactly 8.23.0 in package.json, and package-lock.json (npm
//     generated) resolves that same version, with no other dependency added
//   - the dead PUPPETEER_EXECUTABLE_PATH is gone
//   - scripts/write-versions.sh records what the build resolved (Chrome beta,
//     Chromium, chrome-devtools-mcp, node, ffmpeg, openbox) as JSON, and a probe
//     that fails yields "unknown" rather than failing the build
//   - the Dockerfile runs it after every install, writing /opt/browsercontainer/versions.json
// Run: node --test tests/browsercontainer/pins.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '../..');
const BC = path.join(REPO, 'browsercontainer');
const df = fs.readFileSync(path.join(BC, 'Dockerfile'), 'utf8');

test('chrome-devtools-mcp pinned to 1.13.0', () => {
  const pins = [...df.matchAll(/chrome-devtools-mcp@(\S+)/g)].map((m) => m[1]);
  assert.deepEqual(pins, ['1.13.0']);
});

test('ws pinned to 8.23.0 and the lock agrees', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(BC, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.dependencies, { ws: '8.23.0' });
  const lock = JSON.parse(fs.readFileSync(path.join(BC, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages[''].dependencies.ws, '8.23.0');
  assert.equal(lock.packages['node_modules/ws'].version, '8.23.0');
  assert.match(lock.packages['node_modules/ws'].resolved, /\/ws-8\.23\.0\.tgz$/);
  assert.match(lock.packages['node_modules/ws'].integrity, /^sha512-/);
  assert.ok(!fs.existsSync(path.join(BC, 'node_modules')) || spawnSync('git', ['-C', REPO, 'check-ignore', '-q',
    'browsercontainer/node_modules']).status === 0, 'node_modules is never committed');
});

test('dead PUPPETEER_EXECUTABLE_PATH removed', () => {
  for (const f of ['supervisord.conf', 'Dockerfile', 'server.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(BC, f), 'utf8'), /PUPPETEER_EXECUTABLE_PATH/, f);
  }
});

test('write-versions.sh records the build, unknown on a failing probe', (t) => {
  const script = path.join(BC, 'scripts/write-versions.sh');
  assert.ok(fs.existsSync(script), 'scripts/write-versions.sh exists');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-ver-'));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const bin = path.join(work, 'bin'); fs.mkdirSync(bin);
  const stub = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  stub('chrome-beta', 'echo "Google Chrome 151.0.7922.47 beta"');
  stub('chromium', 'echo "Chromium 150.0.7871.181 Arch Linux"');
  stub('ffmpeg', 'echo "ffmpeg version n9.1 Copyright (c) 2000-2026"; echo "built with gcc"');
  stub('pacman', '[ "$1" = "-Q" ] && [ "$2" = openbox ] && echo "openbox 3.6.1-12"');
  const npmRoot = path.join(work, 'npm'); fs.mkdirSync(path.join(npmRoot, 'chrome-devtools-mcp'), { recursive: true });
  fs.writeFileSync(path.join(npmRoot, 'chrome-devtools-mcp/package.json'), '{"name":"chrome-devtools-mcp","version":"1.13.0"}');
  const out = path.join(work, 'versions.json');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, CHROME_BETA_BIN: path.join(bin, 'chrome-beta'),
    CHROMIUM_BIN: path.join(bin, 'chromium'), NPM_GLOBAL_ROOT: npmRoot };
  const r = spawnSync('bash', [script, out], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const v = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.equal(v.chrome_beta, 'Google Chrome 151.0.7922.47 beta');
  assert.equal(v.chromium, 'Chromium 150.0.7871.181 Arch Linux');
  assert.equal(v['chrome-devtools-mcp'], '1.13.0');
  assert.equal(v.node, process.version);
  assert.equal(v.ffmpeg, 'ffmpeg version n9.1 Copyright (c) 2000-2026');
  assert.equal(v.openbox, 'openbox 3.6.1-12');
  assert.match(v.built_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);

  stub('ffmpeg', 'exit 1');
  const out2 = path.join(work, 'v2.json');
  const r2 = spawnSync('bash', [script, out2], { env: { ...env, CHROME_BETA_BIN: '/nonexistent', NPM_GLOBAL_ROOT: '/nonexistent' }, encoding: 'utf8' });
  assert.equal(r2.status, 0, 'a failing probe never fails the build');
  const v2 = JSON.parse(fs.readFileSync(out2, 'utf8'));
  assert.equal(v2.chrome_beta, 'unknown');
  assert.equal(v2.ffmpeg, 'unknown');
  assert.equal(v2['chrome-devtools-mcp'], 'unknown');
});

test('Dockerfile writes versions.json after every install', () => {
  const run = df.indexOf('write-versions.sh /opt/browsercontainer/versions.json');
  assert.ok(run > 0, 'RUN write-versions.sh /opt/browsercontainer/versions.json');
  assert.match(df, /COPY --chown=devuser:devuser scripts\/write-versions\.sh \/opt\/browsercontainer\/scripts\/write-versions\.sh/);
  for (const marker of ['pacman -S', 'google-chrome-beta', 'npm install -g chrome-devtools-mcp']) {
    assert.ok(df.indexOf(marker) >= 0 && df.indexOf(marker) < run, `${marker} happens before the versions are recorded`);
  }
});
