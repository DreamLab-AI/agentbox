// W9 (custody-isolation 2026-10-03): the sidecar's Chrome profile lives on a named volume.
//
// Podkey keeps its encrypted vault, public key and consent grants in
// chrome.storage.local inside the Chrome profile. Before W9 the profile was
// /tmp/chrome-profile in the container layer and vanished on every recreate.
// Inspects Compose's resolved model; never prints environment values.
//
// Cases:
//   1. the service mounts a volume at the profile path launch-chromium.sh uses
//   2. that volume is declared with the stable name browsercontainer-profile
//      and is not external (compose creates it on a fresh host)
//   3. /tmp/chrome-profile appears nowhere in the resolved model
//   4. the podkey-loader supervisord program exists and Chrome keeps its CDP port
// Run: node tests/browsercontainer/compose-profile-volume.test.cjs
'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const cwd = path.resolve(__dirname, '../..');
const PROFILE = '/home/devuser/chrome-profile';
const model = JSON.parse(execFileSync('docker', ['compose', '--project-name', 'agentbox',
  '-f', 'docker-compose.browsercontainer.yml', 'config', '--format', 'json'],
  { cwd, encoding: 'utf8', env: { ...process.env, NVIDIA_VISIBLE_DEVICES: 'all' } }));

let passed = 0;
const svc = model.services.browsercontainer;

const mount = svc.volumes.find((v) => v.target === PROFILE);
assert.equal(mount?.type, 'volume', `a volume is mounted at ${PROFILE}`);
assert.equal(mount.source, 'browsercontainer-profile');
passed++;

const vol = model.volumes['browsercontainer-profile'];
assert.equal(vol?.name, 'browsercontainer-profile', 'stable volume name, independent of project name');
assert.ok(!vol.external, 'compose creates the volume on a fresh host');
passed++;

assert.ok(!JSON.stringify(model).includes('/tmp/chrome-profile'), '/tmp/chrome-profile is gone from compose');
passed++;

const launch = fs.readFileSync(path.join(cwd, 'browsercontainer/launch-chromium.sh'), 'utf8');
const sup = fs.readFileSync(path.join(cwd, 'browsercontainer/supervisord.conf'), 'utf8');
assert.ok(launch.includes(`CHROME_PROFILE_DIR:-${PROFILE}`), 'launch uses the mounted profile path');
assert.match(sup, /\[program:podkey-loader\][^[]*command=node \/opt\/browsercontainer\/podkey-ctl\.js load --watch/);
assert.match(launch, /--remote-debugging-port=9222/);
passed++;

console.log(`PASS: ${passed} compose/profile checks (volume browsercontainer-profile at ${PROFILE}, /tmp profile gone, loader wired)`);
