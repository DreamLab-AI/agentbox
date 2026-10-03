'use strict';
// Custody X-1 step 1, W2 (bypass 3): the env-secret inventory.
// node --test tests/security/env-secret-inventory.node-test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(ROOT, 'scripts', 'ci', 'env-secret-inventory.js');
const inv = require(SCRIPT);
const table = inv.loadTable();

const REQUIRED_ROLE = [
  'AGENTBOX_NSEC', 'AGENTBOX_PRIVKEY_HEX', 'AGENTBOX_BRIDGE_SK', 'OPERATOR_NOSTR_PRIVKEY',
  'JUNKIEJARVIS_PRIVKEY_HEX', 'AGENTBOX_AGENT_PRIVKEY_HEX',
];
const REQUIRED_DEVUSER = [
  'BRIDGE_TOKEN', 'MANAGEMENT_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ZAI_API_KEY',
  'GITHUB_TOKEN', 'CRATES_TOKEN', 'RUVECTOR_PG_PASSWORD', 'CLOUDFLARE_TUNNEL_TOKEN',
];

test('the table has exactly the three classes', () => {
  assert.deepEqual(Object.keys(table.classes).sort(), ['DEVUSER_CLASS', 'NON_SECRET', 'ROLE']);
});

test('the brief\'s ROLE secrets are ROLE, each with a role and a <NAME>_FILE', () => {
  for (const n of REQUIRED_ROLE) {
    const e = table.classes.ROLE[n];
    assert.ok(e, `${n} must be ROLE`);
    assert.ok(e.role, `${n} names a role`);
    assert.equal(e.file_var, `${n}_FILE`);
  }
});

test('the brief\'s devuser-class credentials are DEVUSER_CLASS exceptions with reasons', () => {
  for (const n of REQUIRED_DEVUSER) {
    const e = table.classes.DEVUSER_CLASS[n];
    assert.ok(e, `${n} must be DEVUSER_CLASS`);
    assert.ok(e.exception && e.reason, `${n} carries an exception and a reason`);
  }
});

test('BRIDGE_TOKEN records the break-glass double, dated, pointing at ADR-2027', () => {
  const e = table.classes.DEVUSER_CLASS.BRIDGE_TOKEN;
  assert.match(e.exception, /ADR-2027/);
  assert.match(e.reason, /break-glass/);
  assert.match(e.reason, /\b2026-\d\d-\d\d\b/);
});

test('every name the scanned code reads is classified, once (--check on the repo)', () => {
  const r = spawnSync(process.execPath, [SCRIPT, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^PASS \(env-secret-inventory\)/);
});

test('an unclassified name read by the code fails the check', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-inv-'));
  try {
    fs.writeFileSync(path.join(tmp, 'a.js'), 'const x = process.env.BRAND_NEW_SETTING;\n');
    const t = { ...table, sources: ['a.js'], sources_exclude: [] };
    const found = inv.scan(t, tmp);
    const v = inv.check(t, found, {});
    assert.ok(v.some((s) => s.startsWith('UNCLASSIFIED BRAND_NEW_SETTING')), v.join('\n'));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('a secret-shaped name cannot ride a NON_SECRET pattern', () => {
  const t = JSON.parse(JSON.stringify(table));
  t.classes.NON_SECRET.patterns = [{ re: '^NEWSVC_' }];
  const found = new Map([['NEWSVC_API_KEY', ['x.js']], ['NEWSVC_PORT', ['x.js']]]);
  const v = inv.check(t, found, {});
  assert.ok(v.some((s) => s.startsWith('SECRET-SHAPED NEWSVC_API_KEY')), v.join('\n'));
  assert.ok(!v.some((s) => s.includes('NEWSVC_PORT')), 'a pointer-shaped name may use a pattern');
});

test('a name in two classes is ambiguous', () => {
  const t = JSON.parse(JSON.stringify(table));
  t.classes.NON_SECRET.names.push('BRIDGE_TOKEN');
  const v = inv.check(t, new Map([['BRIDGE_TOKEN', ['x']]]), {});
  assert.ok(v.some((s) => s.startsWith('AMBIGUOUS BRIDGE_TOKEN')));
});

test('the entrypoint scrub list equals the ROLE set (NAME:role)', () => {
  const ep = inv.entrypointRoleList();
  assert.ok(ep, 'entrypoint defines _AB_ROLE_ENV_VARS');
  const want = Object.fromEntries(Object.entries(table.classes.ROLE).map(([n, e]) => [n, e.role]));
  assert.deepEqual(ep, want);
  const t = JSON.parse(JSON.stringify(table));
  delete t.classes.ROLE.TAILSCALE_AUTHKEY;
  const v = inv.check(t, inv.scan(t), ep);
  assert.ok(v.some((s) => /has TAILSCALE_AUTHKEY:root, which the table does not/.test(s)), v.join('\n'));
});

test('extraction: shell, nix, compose, js and rust readers', () => {
  const has = (txt, kind, n) => inv.extractNames(txt, kind).has(n);
  assert.ok(has('echo "${FOO_BAR:-x}" $BAZ', 'shell', 'FOO_BAR'));
  assert.ok(has('echo "${FOO_BAR:-x}" $BAZ', 'shell', 'BAZ'));
  assert.ok(has('url="http://x:%(ENV_MANAGEMENT_API_PORT)s"', 'nix', 'MANAGEMENT_API_PORT'));
  assert.ok(has('    - TAILSCALE_AUTHKEY=${TAILSCALE_AUTHKEY:-}\n', 'compose', 'TAILSCALE_AUTHKEY'));
  assert.ok(has("process.env['A_B'] || process.env.C_D", 'js', 'A_B'));
  assert.ok(has("envFirst('AGENTBOX_PRIVKEY_HEX', 'OPERATOR_NOSTR_PRIVKEY')", 'js', 'OPERATOR_NOSTR_PRIVKEY'));
  assert.ok(has("readRoleSecret('JUNKIEJARVIS_PRIVKEY_HEX')", 'js', 'JUNKIEJARVIS_PRIVKEY_HEX'));
  assert.ok(has('env.non_empty("AGENTBOX_BRIDGE_SK")', 'rust', 'AGENTBOX_BRIDGE_SK'));
  assert.ok(has('pub const KEY_VAR: &str = "JUNKIEJARVIS_PRIVKEY_HEX";', 'rust', 'JUNKIEJARVIS_PRIVKEY_HEX'));
  assert.ok(has('env.first(&["A_ONE", "B_TWO"])', 'rust', 'B_TWO'));
});

test('the inventory reads code, never an env file', () => {
  for (const p of ['.env', 'x/.env', '.env.example', 'a/.env.solid-pods.template']) {
    assert.throws(() => inv.refuseEnvFile(p), /refusing to read env file/);
  }
  assert.doesNotThrow(() => inv.refuseEnvFile('config/entrypoint-unified.sh'));
  for (const s of table.sources) assert.ok(!/(^|\/)\.env/.test(s), `source ${s} is not an env file`);
});

test('the report prints names only (no values, no assignments)', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /\b[0-9a-f]{64}\b/i, 'no 64-hex material');
  assert.doesNotMatch(r.stdout, /nsec1[0-9a-z]{20,}/, 'no bech32 secret');
  assert.doesNotMatch(r.stdout, /^\s*[A-Z_][A-Z0-9_]*=/m, 'no NAME=value lines');
  const j = JSON.parse(spawnSync(process.execPath, [SCRIPT, '--json'], { encoding: 'utf8' }).stdout);
  for (const [c, names] of Object.entries(j.names)) {
    for (const n of names) assert.match(n, /^[A-Z_][A-Z0-9_]*$/, `${c} entry ${n} is a bare name`);
  }
});
