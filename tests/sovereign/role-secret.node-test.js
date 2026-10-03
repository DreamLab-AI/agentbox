'use strict';
// Custody X-1 step 1, W2 (bypass 3): the shared ROLE-secret loader and every JS
// consumer of a ROLE variable. Precedence: <NAME>_FILE wins; the bare variable
// is honoured only while [security].role_isolation is off; under the flag a
// bare ROLE variable present at all is logged as ROLE-ISOLATION-LEAK, ignored.
//
// node --test tests/sovereign/role-secret.node-test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const rs = require(path.join(ROOT, 'management-api/lib/role-secret.js'));
const agentIdentity = require(path.join(ROOT, 'management-api/lib/agent-identity.js'));
const { operatorKeyHex, OPERATOR_KEY_VARS } = require(path.join(ROOT, 'config/hooks/lib/operator-key.cjs'));

const ON = { AGENTBOX_ROLE_ISOLATION: '1' };
const HEX_A = 'a1'.repeat(32);
const HEX_B = 'b2'.repeat(32);
// BIP-340 vector: secret key 3.
const SK3 = '0000000000000000000000000000000000000000000000000000000000000003';
const PK3 = 'f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9';

function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'role-secret-')); }
function secretFile(dir, name, body) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, body, { mode: 0o400 });
  return p;
}
function capture() {
  const lines = [];
  return { lines, log: (l) => lines.push(l) };
}
function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; }
  try {
    for (const [k, v] of Object.entries(vars)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

// ── the loader ───────────────────────────────────────────────────────────────

test('flag off: the bare variable is honoured', () => {
  assert.equal(rs.readRoleSecret('K', { env: { K: ` ${HEX_A} ` } }), HEX_A);
});

test('flag off: <NAME>_FILE wins over <NAME>', () => {
  const d = tmpdir();
  const f = secretFile(d, 'k', `${HEX_B}\n`);
  const r = rs.resolveRoleSecret('K', { env: { K: HEX_A, K_FILE: f } });
  assert.deepEqual([r.value, r.source, r.leaked], [HEX_B, 'file', false]);
});

test('flag on: the bare variable is ignored and logged by name only', () => {
  rs._resetReported();
  const c = capture();
  assert.equal(rs.readRoleSecret('K_ON', { env: { ...ON, K_ON: HEX_A }, log: c.log }), '');
  assert.equal(c.lines.length, 1);
  assert.match(c.lines[0], /ROLE-ISOLATION-LEAK K_ON\b/);
  assert.ok(!c.lines[0].includes(HEX_A), 'no value in the log');
  rs.readRoleSecret('K_ON', { env: { ...ON, K_ON: HEX_A }, log: c.log });
  assert.equal(c.lines.length, 1, 'reported once per process');
});

test('flag on: present-but-empty still counts as a leak', () => {
  const r = rs.resolveRoleSecret('K', { env: { ...ON, K: '' } });
  assert.equal(r.leaked, true);
});

test('flag on: the file is read; a present env var is still reported', () => {
  const d = tmpdir();
  const f = secretFile(d, 'k', HEX_B);
  const r = rs.resolveRoleSecret('K', { env: { ...ON, K: HEX_A, K_FILE: f } });
  assert.deepEqual([r.value, r.source, r.leaked], [HEX_B, 'file', true]);
});

test('an unreadable <NAME>_FILE throws naming the path, never the value, never falling back', () => {
  assert.throws(
    () => rs.readRoleSecret('K', { env: { K: HEX_A, K_FILE: '/nonexistent/k' } }),
    (err) => err.message.includes('/nonexistent/k') && !err.message.includes(HEX_A),
  );
});

test('oversized files and directories are refused', () => {
  const d = tmpdir();
  const big = secretFile(d, 'big', 'a'.repeat(rs.MAX_SECRET_FILE_BYTES + 1));
  assert.throws(() => rs.readSecretFile(big), /larger than/);
  assert.throws(() => rs.readSecretFile(d), /not a regular file/);
});

test('defaultFile is consulted when <NAME>_FILE is unset', () => {
  const d = tmpdir();
  const f = secretFile(d, 'nostr.key', HEX_B);
  assert.equal(rs.readRoleSecret('K', { env: ON, defaultFile: f }), HEX_B);
  assert.equal(rs.readRoleSecret('K', { env: { K: HEX_A }, defaultFile: path.join(d, 'none') }), HEX_A);
});

test('readRoleSecretFirst returns the first value and its name, reporting every leak', () => {
  rs._resetReported();
  const d = tmpdir();
  const f = secretFile(d, 'b', HEX_B);
  const c = capture();
  const r = rs.readRoleSecretFirst(['A1', 'B1', 'C1'], { env: { ...ON, A1: HEX_A, B1_FILE: f, C1: 'x' }, log: c.log });
  assert.deepEqual(r, { value: HEX_B, name: 'B1' });
  assert.deepEqual(c.lines.map((l) => l.split(' ')[2]).sort(), ['A1', 'C1']);
});

test('the flag is exactly "1"', () => {
  for (const v of ['0', '', 'true', 'yes']) assert.equal(rs.roleIsolation({ AGENTBOX_ROLE_ISOLATION: v }), false);
  assert.equal(rs.roleIsolation(ON), true);
});

test('agent-identity re-exports the one loader', () => {
  assert.equal(agentIdentity.readRoleSecret, rs.readRoleSecret);
  assert.equal(agentIdentity.readRoleSecretFirst, rs.readRoleSecretFirst);
  assert.equal(agentIdentity.resolveRoleSecret, rs.resolveRoleSecret);
  assert.equal(agentIdentity.roleIsolation, rs.roleIsolation);
});

// ── consumer: agent-identity loadOrMint (AGENTBOX_AGENT_PRIVKEY_HEX) ────────

test('loadOrMint: AGENTBOX_AGENT_PRIVKEY_HEX_FILE wins; the bare var is ignored under the flag', () => {
  const d = tmpdir();
  const f = secretFile(d, 'did.key', SK3);
  const keyPath = path.join(d, 'agent-did-x.key');
  withEnv({ AGENTBOX_ROLE_ISOLATION: undefined, AGENTBOX_AGENT_PRIVKEY_HEX: HEX_A, AGENTBOX_AGENT_PRIVKEY_HEX_FILE: f }, () => {
    assert.equal(agentIdentity.loadOrMint({ keyPath }).pubkey, PK3);
  });
  withEnv({ AGENTBOX_ROLE_ISOLATION: '1', AGENTBOX_AGENT_PRIVKEY_HEX: SK3, AGENTBOX_AGENT_PRIVKEY_HEX_FILE: undefined }, () => {
    const fresh = path.join(d, 'agent-did-y.key');
    const id = agentIdentity.loadOrMint({ keyPath: fresh, roleSecretOpts: { log() {} } });
    assert.notEqual(id.pubkey, PK3, 'the bare override must not be used under the flag');
    assert.equal(id.minted, true);
  });
  withEnv({ AGENTBOX_ROLE_ISOLATION: undefined, AGENTBOX_AGENT_PRIVKEY_HEX: SK3, AGENTBOX_AGENT_PRIVKEY_HEX_FILE: undefined }, () => {
    assert.equal(agentIdentity.loadOrMint({ keyPath: path.join(d, 'agent-did-z.key') }).pubkey, PK3, 'flag off unchanged');
  });
});

// ── consumer: junkiejarvis-agent readPrivHex ─────────────────────────────────

test('junkiejarvis readPrivHex: env (flag off), file, and refusal under the flag', () => {
  const jj = require(path.join(ROOT, 'management-api/lib/junkiejarvis-agent.js'));
  const d = tmpdir();
  const f = secretFile(d, 'jj', HEX_B);
  const quiet = { log() {} };
  withEnv({ AGENTBOX_ROLE_ISOLATION: undefined, JUNKIEJARVIS_PRIVKEY_HEX: undefined, CONCIERGE_PRIVKEY_HEX: HEX_A, JUNKIEJARVIS_PRIVKEY_HEX_FILE: undefined, CONCIERGE_PRIVKEY_HEX_FILE: undefined }, () => {
    assert.equal(jj.readPrivHex(quiet), HEX_A, 'legacy alias still honoured with the flag off');
  });
  withEnv({ AGENTBOX_ROLE_ISOLATION: '1', JUNKIEJARVIS_PRIVKEY_HEX: HEX_A, JUNKIEJARVIS_PRIVKEY_HEX_FILE: f, CONCIERGE_PRIVKEY_HEX: undefined }, () => {
    assert.equal(jj.readPrivHex(quiet), HEX_B);
  });
  withEnv({ AGENTBOX_ROLE_ISOLATION: '1', JUNKIEJARVIS_PRIVKEY_HEX: HEX_A, JUNKIEJARVIS_PRIVKEY_HEX_FILE: undefined, CONCIERGE_PRIVKEY_HEX: HEX_A }, () => {
    assert.equal(jj.readPrivHex(quiet), '');
  });
  withEnv({ AGENTBOX_ROLE_ISOLATION: '1', JUNKIEJARVIS_PRIVKEY_HEX_FILE: '/nonexistent/jj' }, () => {
    assert.equal(jj.readPrivHex({ ...quiet, logger: { warn() {} } }), '', 'unreadable file reads as no key');
  });
});

// ── consumer: git-bridge resolveDecisionSigner (AGENTBOX_NSEC) ───────────────

test('git-bridge: AGENTBOX_NSEC with the flag off; NSEC_FILE wins; sovereign file under the flag', async () => {
  const { resolveDecisionSigner } = require(path.join(ROOT, 'management-api/routes/git-bridge.js'));
  const d = tmpdir();
  const f = secretFile(d, 'nsec', SK3);
  assert.equal(resolveDecisionSigner({ env: { AGENTBOX_NSEC: HEX_A } }).source, 'AGENTBOX_NSEC');
  assert.equal(resolveDecisionSigner({ env: {} }), null, 'flag off, no key: unsigned as before');
  const viaFile = resolveDecisionSigner({ env: { ...ON, AGENTBOX_NSEC_FILE: f } });
  assert.equal(viaFile.source, 'AGENTBOX_NSEC');
  const tools = require(path.join(ROOT, 'management-api/node_modules/nostr-tools'));
  const ev = await viaFile.sign({ kind: 1, created_at: 1, tags: [], content: 'x' }, {
    ...tools, finalizeEvent: (e, sk) => tools.finalizeEvent(e, Uint8Array.from(Buffer.from(sk, 'hex'))),
  });
  assert.equal(ev.pubkey, PK3);
  let asked = null;
  const sov = resolveDecisionSigner({
    env: { ...ON, AGENTBOX_NSEC: HEX_A },
    loadSovereignSigner: (o) => { asked = o; return { sign: async (e) => ({ ...e, sig: 'sov' }) }; },
  });
  assert.equal(sov.source, 'sovereign-identity', 'the bare AGENTBOX_NSEC is not used under the flag');
  assert.equal((await sov.sign({ kind: 1 })).sig, 'sov');
  assert.ok(asked && asked.env, 'the identity path resolves from the same env');
  assert.equal(resolveDecisionSigner({ env: ON, loadSovereignSigner: () => { throw new Error('ENOENT'); } }), null);
});

// ── consumer: operator key (live mirror, nostr-gateway, nostr-send) ──────────

test('operator key, flag off: the pre-W2 envFirst, unchanged, even with AGENTBOX_BRIDGE_SK_FILE set', () => {
  const d = tmpdir();
  const f = secretFile(d, 'nostr.key', HEX_B);
  assert.deepEqual([...OPERATOR_KEY_VARS], ['AGENTBOX_PRIVKEY_HEX', 'AGENTBOX_BRIDGE_SK', 'OPERATOR_NOSTR_PRIVKEY']);
  assert.equal(operatorKeyHex({ env: { OPERATOR_NOSTR_PRIVKEY: HEX_A, AGENTBOX_BRIDGE_SK_FILE: f } }), HEX_A);
  assert.equal(operatorKeyHex({ env: { AGENTBOX_PRIVKEY_HEX: ` ${HEX_A} `, OPERATOR_NOSTR_PRIVKEY: HEX_B } }), HEX_A);
  assert.equal(operatorKeyHex({ env: {} }), '');
});

test('operator key, flag on: files only, in the same order; bare vars ignored', () => {
  const d = tmpdir();
  const sk = secretFile(d, 'nostr.key', HEX_B);
  const c = capture();
  assert.equal(operatorKeyHex({ env: { ...ON, AGENTBOX_PRIVKEY_HEX: HEX_A, AGENTBOX_BRIDGE_SK_FILE: sk }, log: c.log }), HEX_B);
  assert.equal(operatorKeyHex({ env: { ...ON, OPERATOR_NOSTR_PRIVKEY: HEX_A }, log() {} }), '');
  assert.equal(operatorKeyHex({ env: { ...ON, AGENTBOX_PRIVKEY_HEX_FILE: '/nonexistent/k' }, log() {} }), '', 'never throws');
  assert.equal(operatorKeyHex({ env: { ...ON, AGENTBOX_BRIDGE_SK_FILE: sk }, loaderCandidates: ['/nonexistent/role-secret.js'], log() {} }), '',
    'no loader under the flag: no key, never the env');
});

test('the mirror hook, gateway and nostr-send take the operator key only from operator-key.cjs', () => {
  for (const rel of ['config/hooks/nostr-live-mirror.cjs', 'config/nostr-gateway/gateway.cjs', 'config/nostr-gateway/nostr-send.cjs']) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(src, /operator-key\.cjs/, `${rel} requires operator-key.cjs`);
    assert.match(src, /operatorKeyHex\(/, `${rel} calls operatorKeyHex`);
    assert.doesNotMatch(src, /envFirst\([^)]*(AGENTBOX_PRIVKEY_HEX|OPERATOR_NOSTR_PRIVKEY)/, `${rel} has no direct key read left`);
  }
  const mirror = require(path.join(ROOT, 'config/hooks/nostr-live-mirror.cjs'));
  assert.equal(mirror.operatorKeyHex, operatorKeyHex);
});

test('project-tracking hook: under the flag only the key file counts', () => {
  const src = fs.readFileSync(path.join(ROOT, 'config/hooks/project-tracking-publish.cjs'), 'utf8');
  assert.match(src, /const haveSk = !!\(\(!isolated && envFirst\('AGENTBOX_BRIDGE_SK'\)\) \|\| envFirst\('AGENTBOX_BRIDGE_SK_FILE'\)\);/);
});

// ── the invariant: no JS reads a ROLE variable around the loader ─────────────

test('no JS consumer reads a ROLE variable straight from process.env', () => {
  const table = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/custody/env-classes.json'), 'utf8'));
  const roles = Object.keys(table.classes.ROLE);
  const re = new RegExp(`process\\.env(?:\\.(${roles.join('|')})\\b|\\[\\s*['"\`](${roles.join('|')})['"\`])`);
  const roots = ['management-api/lib', 'management-api/routes', 'management-api/adapters', 'config', 'scripts'];
  const allow = new Set([
    // Deletes the override so a demo cannot sign as the container (not a read).
    'scripts/sidechain/demo-accounts.js', 'scripts/activation/adr-2097-acceptance.js',
  ]);
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) { if (!['node_modules', 'tests', '__tests__'].includes(e.name)) walk(rel); continue; }
      if (!/\.(c|m)?js$/.test(e.name) || /\.(test|spec)\.(c|m)?js$/.test(e.name) || allow.has(rel)) continue;
      const lines = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
      lines.forEach((l, i) => { if (re.test(l) && !/^\s*(\/\/|\*)/.test(l)) offenders.push(`${rel}:${i + 1}`); });
    }
  };
  for (const r of roots) walk(r);
  assert.deepEqual(offenders, []);
});
