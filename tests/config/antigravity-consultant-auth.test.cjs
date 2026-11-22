'use strict';
// ADR-2214: the Antigravity consultant follows [providers.gemini].auth_mode.
// Under oauth it passes no key and no provider override, and copies (never
// links) the primary sign-in token into its own home.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { authMode, cliAuth, syncOAuthToken } =
  require('../../mcp/consultants/antigravity/server.js');

const TOKEN = path.join('.gemini', 'antigravity-cli', 'antigravity-oauth-token');

test('auth mode defaults to api_key and only "oauth" selects OAuth', () => {
  assert.equal(authMode({}), 'api_key');
  assert.equal(authMode({ AGENTBOX_ANTIGRAVITY_AUTH_MODE: 'web_login' }), 'api_key');
  assert.equal(authMode({ AGENTBOX_ANTIGRAVITY_AUTH_MODE: 'oauth' }), 'oauth');
});

test('oauth passes neither the key nor a provider override, even with a key set', () => {
  const auth = cliAuth({ AGENTBOX_ANTIGRAVITY_AUTH_MODE: 'oauth', GEMINI_API_KEY: 'fake-secret' });
  assert.equal(auth.mode, 'oauth');
  assert.deepEqual(auth.args, []);
  assert.equal('GEMINI_API_KEY' in auth.env, false);
  assert.equal(JSON.stringify(auth).includes('fake-secret'), false);
});

test('api_key mode keeps the session-only gemini provider', () => {
  const auth = cliAuth({ GEMINI_API_KEY: 'fake-secret' });
  assert.equal(auth.mode, 'api_key');
  assert.equal(JSON.parse(auth.args[1]).modelProvider, 'gemini');
  assert.equal(auth.env.GEMINI_API_KEY, 'fake-secret');
});

test('token sync copies, re-copies only when the primary is newer, never links', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-sync-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const primary = path.join(root, 'primary');
  const home = path.join(root, 'consultant');
  assert.equal(syncOAuthToken(primary, home), false, 'no primary token: nothing to do');

  const src = path.join(primary, TOKEN);
  const dst = path.join(home, TOKEN);
  fs.mkdirSync(path.dirname(src), { recursive: true });
  fs.writeFileSync(src, '{"token":"one"}', { mode: 0o600 });
  fs.utimesSync(src, new Date(1e12), new Date(1e12));
  assert.equal(syncOAuthToken(primary, home), true);
  assert.equal(fs.lstatSync(dst).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(dst, 'utf8'), '{"token":"one"}');
  assert.equal(fs.statSync(dst).mode & 0o777, 0o600);
  assert.equal(syncOAuthToken(primary, home), false, 'up to date');

  // A consultant-side refresh is kept until the primary changes.
  fs.writeFileSync(dst, '{"token":"refreshed-here"}');
  fs.utimesSync(dst, new Date(1e12 + 5000), new Date(1e12 + 5000));
  assert.equal(syncOAuthToken(primary, home), false);
  fs.writeFileSync(src, '{"token":"two"}');
  fs.utimesSync(src, new Date(1e12 + 10000), new Date(1e12 + 10000));
  assert.equal(syncOAuthToken(primary, home), true, 'fresh sign-in propagates');
  assert.equal(fs.readFileSync(dst, 'utf8'), '{"token":"two"}');
  assert.equal(fs.readFileSync(src, 'utf8'), '{"token":"two"}', 'primary never written');

  // A stale symlink from an older layout is replaced by a file.
  fs.rmSync(dst); fs.symlinkSync(src, dst);
  assert.equal(syncOAuthToken(primary, home), true);
  assert.equal(fs.lstatSync(dst).isSymbolicLink(), false);
  assert.equal(syncOAuthToken(primary, primary), false, 'same home is a no-op');
});
