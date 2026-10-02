'use strict';

/**
 * scripts/sidechain/dispatch-as.js — the rehearsal dispatches demo tasks
 * NIP-98-signed by demo-a / demo-b's own identity keys (owner decision
 * 2026-10-02: no scope change, sign as the agent). These tests pin:
 *   - the header verifies under the estate's own NIP-98 verifier, bound to the
 *     exact URL, method and body bytes, and names the demo agent's pubkey;
 *   - a missing key is refused, never minted (a fresh key would be a fresh,
 *     unfunded identity, silently);
 *   - AGENTBOX_AGENT_PRIVKEY_HEX cannot redirect the signer;
 *   - end to end against the real POST/GET /v1/tasks routes, the created task
 *     echoes didNostr = the demo agent's DID, and a mismatch is reported.
 *
 * Runner: node:test (node --test).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const REPO = path.resolve(__dirname, '..', '..');
const MA = path.join(REPO, 'management-api');
const { getPublicKey } = require(path.join(MA, 'node_modules', 'nostr-tools'));
const { NostrBridge } = require(path.join(REPO, 'mcp', 'servers', 'nostr-bridge.js'));
const dispatchAs = require(path.join(REPO, 'scripts', 'sidechain', 'dispatch-as.js'));

// Fixed test-only secret (not a demo key): 0x11 * 32.
const SK_HEX = '11'.repeat(32);
const PUB = getPublicKey(Buffer.from(SK_HEX, 'hex'));

function keyDir(profile = 'demo-a', content = `${SK_HEX}\n`, mode = 0o600) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-as-'));
  if (content !== null) fs.writeFileSync(path.join(d, `agent-did-${profile}.key`), content, { mode });
  return d;
}

test('loadDemoIdentity reads the profile key file and derives its DID', () => {
  const id = dispatchAs.loadDemoIdentity({ profile: 'demo-a', identityDir: keyDir() });
  assert.equal(id.did, `did:nostr:${PUB}`);
  assert.equal(id.pubkey, PUB);
  assert.equal(Object.keys(id).includes('secret'), false, 'the key is not exposed on the identity');
});

test('a missing key file is refused, never minted', () => {
  const d = keyDir('demo-a', null);
  assert.throws(() => dispatchAs.loadDemoIdentity({ profile: 'demo-a', identityDir: d }), /no identity key/);
  assert.equal(fs.existsSync(path.join(d, 'agent-did-demo-a.key')), false);
});

test('a malformed or group/world-readable key file is refused', () => {
  assert.throws(() => dispatchAs.loadDemoIdentity({ profile: 'demo-a', identityDir: keyDir('demo-a', 'nothex\n') }), /not a 64-hex/);
  assert.throws(() => dispatchAs.loadDemoIdentity({ profile: 'demo-a', identityDir: keyDir('demo-a', `${SK_HEX}\n`, 0o644) }), /0600/);
});

test('a profile name cannot escape the identity dir', () => {
  assert.throws(() => dispatchAs.loadDemoIdentity({ profile: '../x', identityDir: keyDir() }), /profile/);
});

test('AGENTBOX_AGENT_PRIVKEY_HEX cannot redirect the signer', () => {
  const prev = process.env.AGENTBOX_AGENT_PRIVKEY_HEX;
  process.env.AGENTBOX_AGENT_PRIVKEY_HEX = '22'.repeat(32);
  try {
    const id = dispatchAs.loadDemoIdentity({ profile: 'demo-a', identityDir: keyDir() });
    assert.equal(id.pubkey, PUB);
  } finally {
    if (prev === undefined) delete process.env.AGENTBOX_AGENT_PRIVKEY_HEX; else process.env.AGENTBOX_AGENT_PRIVKEY_HEX = prev;
  }
});

test('the header verifies under NostrBridge.verifyNip98, bound to url, method and body', async () => {
  NostrBridge._resetReplayCache();
  const id = dispatchAs.loadDemoIdentity({ profile: 'demo-a', identityDir: keyDir() });
  const url = 'http://127.0.0.1:9090/v1/tasks';
  const body = Buffer.from(JSON.stringify({ agent: 'coder', task: 'hello' }));
  const h = await id.nip98('POST', url, body);
  const ok = NostrBridge.verifyNip98(h, 'POST', url, body);
  assert.equal(ok.valid, true, ok.error);
  assert.equal(ok.pubkey, PUB);
  NostrBridge._resetReplayCache();
  assert.equal(NostrBridge.verifyNip98(h, 'POST', url, Buffer.from('{"tampered":1}')).valid, false);
  NostrBridge._resetReplayCache();
  assert.equal(NostrBridge.verifyNip98(h, 'POST', 'http://127.0.0.1:9090/v1/other', body).valid, false);
});

// A stand-in for management-api's task routes that enforces NIP-98 exactly as
// middleware/auth.js does and echoes didNostr = the verified signer, as
// routes/tasks.js does since d35e89b82.
function fakeApi({ echoDid } = {}) {
  const tasks = new Map();
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const url = `http://${req.headers.host}${req.url}`;
      NostrBridge._resetReplayCache();
      const v = NostrBridge.verifyNip98(req.headers.authorization || '', req.method, url, raw.length ? raw : undefined);
      if (!v.valid) { res.writeHead(401); res.end(JSON.stringify({ error: v.error })); return; }
      if (req.method === 'POST' && req.url === '/v1/tasks') {
        const id = `t${tasks.size + 1}`;
        tasks.set(id, { taskId: id, didNostr: echoDid || `did:nostr:${v.pubkey}`, status: 'running' });
        res.writeHead(202, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ taskId: id, status: 'accepted' }));
        return;
      }
      const m = /^\/v1\/tasks\/([^/]+)$/.exec(req.url);
      if (req.method === 'GET' && m && tasks.has(m[1])) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(tasks.get(m[1])));
        return;
      }
      res.writeHead(404); res.end('{}');
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

test('dispatch: the created task echoes the demo agent DID', async () => {
  const server = await fakeApi();
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const out = await dispatchAs.dispatch({ profile: 'demo-a', identityDir: keyDir(), apiUrl: base, agent: 'coder', task: 'pay demo-b for a summary' });
    assert.equal(out.taskId, 't1');
    assert.equal(out.did, `did:nostr:${PUB}`);
    assert.equal(out.didNostr, `did:nostr:${PUB}`);
    assert.equal(out.attributed, true);
  } finally { server.close(); }
});

test('dispatch: a task echoing another DID is reported unattributed, not success', async () => {
  const server = await fakeApi({ echoDid: `did:nostr:${'ab'.repeat(32)}` });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await assert.rejects(
      dispatchAs.dispatch({ profile: 'demo-a', identityDir: keyDir(), apiUrl: base, agent: 'coder', task: 'x' }),
      /didNostr .* not the signer/,
    );
  } finally { server.close(); }
});

test('dispatch: a 401 surfaces the server error', async () => {
  const server = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(401); res.end('{"error":"nope"}'); }); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    await assert.rejects(
      dispatchAs.dispatch({ profile: 'demo-a', identityDir: keyDir(), apiUrl: base, agent: 'coder', task: 'x' }),
      /POST \/v1\/tasks .*401/,
    );
  } finally { server.close(); }
});
