// ADR-2212: the managed extension policy of the browser sidecar.
//
// Why the policy has this shape. Chromium's UnpackedInstaller::IsLoadingUnpackedAllowed()
// returns !ExtensionManagement::BlocklistedByDefault(); that is true for a
// default-blocked/removed installation mode, whichever policy spells it
// (ExtensionInstallBlocklist ["*"] or ExtensionSettings {"*": {installation_mode:
// "blocked"}}). Its own comment: only PACKED extensions on the allowlist survive a
// wildcard block. Both the CDP call Extensions.loadUnpacked and --load-extension pass
// that gate (chrome 159.0.8154.13: extensions/browser/unpacked_installer.cc), so no
// wildcard default block can coexist with an unpacked Podkey. The id also cannot move:
// the vault in the profile volume is keyed by it.
//
// Properties under test:
//   - no wildcard default block, in either spelling, and no allowlist-only reliance
//   - Podkey's id is allowed, and equals the id derived from the install path the
//     Dockerfile unpacks to (the artefact manifest carries no `key`)
//   - every Chrome Web Store extension is blocked (by update URL), off-store
//     install sources are empty and external extensions are blocked
//   - both browsers get the same file
// Run: node --test tests/browsercontainer/policy-contract.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '../..');
const BC = path.join(REPO, 'browsercontainer');
const ctl = require(path.join(BC, 'podkey-ctl.js'));
const policy = JSON.parse(fs.readFileSync(path.join(BC, 'policies/podkey-only.json'), 'utf8'));
const df = fs.readFileSync(path.join(BC, 'Dockerfile'), 'utf8');
const settings = policy.ExtensionSettings;
const STORE = 'update_url:https://clients2.google.com/service/update2/crx';

test('no wildcard default block (it makes Chrome refuse every unpacked load)', () => {
  assert.ok(!('ExtensionInstallBlocklist' in policy), 'ExtensionInstallBlocklist ["*"] blocks unpacked loads');
  assert.ok(settings && typeof settings === 'object');
  const star = settings['*'];
  assert.ok(star, 'a "*" entry carries the default install_sources');
  assert.ok(!['blocked', 'removed'].includes(star.installation_mode), 'default installation_mode must not block');
  assert.ok(!JSON.stringify(policy).includes('"*"]'), 'no ["*"] list anywhere');
});

test('Podkey id is allowed and equals the id of the path the image unpacks to', () => {
  const dest = df.match(/--dest\s+(\S+)/);
  assert.ok(dest, 'Dockerfile installs Podkey with --dest');
  assert.equal(dest[1], ctl.DEFAULT_EXT_DIR);
  const id = ctl.extensionIdForPath(dest[1]);
  assert.equal(id, ctl.PODKEY_ID);
  assert.equal(settings[id].installation_mode, 'allowed');
  assert.deepEqual(Object.keys(settings).filter((k) => /^[a-p]{32}$/.test(k)), [id], 'exactly one extension id is named');
  // The pinned artefact has no manifest key, which is why the id is path-derived.
  // If upstream adds one, the id changes and this test (and the policy) must follow.
});

test('every Chrome Web Store extension is blocked; other install routes are closed', () => {
  assert.equal(settings[STORE].installation_mode, 'blocked');
  // ExtensionSettings.yaml (159.0.8154.13): an update_url: scope takes only installation_mode and permission lists.
  assert.deepEqual(Object.keys(settings[STORE]), ['installation_mode']);
  assert.deepEqual(settings['*'].install_sources, []);
  assert.equal(policy.BlockExternalExtensions, true);
});

test('Chrome and Chromium receive the same policy file', () => {
  assert.match(df, /COPY policies\/podkey-only\.json \/etc\/opt\/chrome\/policies\/managed\/podkey-only\.json/);
  assert.match(df, /install -D -m 0644 \/etc\/opt\/chrome\/policies\/managed\/podkey-only\.json \/etc\/chromium\/policies\/managed\/podkey-only\.json/);
});
