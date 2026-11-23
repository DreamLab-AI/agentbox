'use strict';

/**
 * AB-03.15 — NIP-98 through the nip98-proxy `/mgmt/` route.
 *
 * The proxy strips `/mgmt`, rewrites Host to the upstream and forwards the
 * client's Authorization header unchanged (it holds no signing key). The client
 * signed the PUBLIC url (`http://<public>/mgmt/v1/x`); management-api used to
 * rebuild `http://<upstream-host>/v1/x` and answer 401. The proxy now reports
 * `X-Forwarded-Host` + `X-Forwarded-Prefix`; the upstream honours them from a
 * loopback peer only, for allowlisted prefixes only, and the verifier requires
 * an EXACT url match, so a spoofed header cannot widen what a signature
 * authorises.
 *
 * Runner: node:test (needs nostr-tools; skips otherwise), wired into
 * management-api `npm run test:node`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const fastify = require('../../management-api/node_modules/fastify');
const { createAuthMiddleware, registerRawBody } = require('../../management-api/middleware/auth');

let nostrTools = null;
try { nostrTools = require('../../management-api/node_modules/nostr-tools'); } catch { /* skip below */ }
let NostrBridge = null;
try { ({ NostrBridge } = require('../../mcp/servers/nostr-bridge')); } catch { /* skip below */ }

const live = !!(nostrTools && NostrBridge && typeof NostrBridge.buildNip98Header === 'function');
const skip = live ? false : 'NostrBridge cannot load nostr-tools (mcp/ deps not installed)';
const reset = () => { if (NostrBridge && NostrBridge._resetReplayCache) NostrBridge._resetReplayCache(); };

const PUBLIC = 'agentbox.example:9096';
const UPSTREAM_HOST = '127.0.0.1:9090';

async function build() {
  const app = fastify();
  registerRawBody(app);
  app.addHook('preValidation', createAuthMiddleware(null, { authMode: 'nip98' }));
  app.post('/v1/x', async (request) => ({ ok: true, pubkey: request.auth && request.auth.pubkey }));
  app.get('/v1/x', async (request) => ({ ok: true, pubkey: request.auth && request.auth.pubkey }));
  await app.ready();
  return app;
}

function signer() {
  const sk = nostrTools.generateSecretKey();
  return { pk: nostrTools.getPublicKey(sk), signer: { async sign(evt) { return nostrTools.finalizeEvent(evt, sk); } } };
}

/** Headers exactly as the proxy emits them for `/mgmt/v1/x`. */
const viaProxy = (extra = {}) => ({
  host: UPSTREAM_HOST,
  'x-forwarded-host': PUBLIC,
  'x-forwarded-proto': 'http',
  'x-forwarded-prefix': '/mgmt',
  ...extra,
});

test('AB-03.15: signed NIP-98 request through /mgmt/ authenticates upstream', { skip }, async (t) => {
  const app = await build();
  t.after(() => app.close());
  const { pk, signer: s } = signer();

  await t.test('GET with query string (signer strips the query)', async () => {
    reset();
    const header = await NostrBridge.buildNip98Header(s, 'GET', `http://${PUBLIC}/mgmt/v1/x?probe=1`);
    const res = await app.inject({ method: 'GET', url: '/v1/x?probe=1', headers: viaProxy({ authorization: header }) });
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().pubkey, pk);
  });

  await t.test('POST with payload binding', async () => {
    reset();
    const body = JSON.stringify({ a: 1 });
    const header = await NostrBridge.buildNip98Header(s, 'POST', `http://${PUBLIC}/mgmt/v1/x`, { body });
    const res = await app.inject({ method: 'POST', url: '/v1/x', payload: body,
      headers: viaProxy({ authorization: header, 'content-type': 'application/json' }) });
    assert.equal(res.statusCode, 200, res.body);
  });

  await t.test('a signature for the STRIPPED url does not authorise the prefixed request', async () => {
    reset();
    const header = await NostrBridge.buildNip98Header(s, 'GET', `http://${PUBLIC}/v1/x`);
    const res = await app.inject({ method: 'GET', url: '/v1/x', headers: viaProxy({ authorization: header }) });
    assert.equal(res.statusCode, 401);
  });
});

test('AB-03.15: forwarded headers cannot widen a signature', { skip }, async (t) => {
  const app = await build();
  t.after(() => app.close());
  const { signer: s } = signer();

  await t.test('non-loopback peer: forwarded prefix/host are ignored', async () => {
    reset();
    const header = await NostrBridge.buildNip98Header(s, 'GET', `http://${PUBLIC}/mgmt/v1/x`);
    const res = await app.inject({ method: 'GET', url: '/v1/x', remoteAddress: '172.18.0.9',
      headers: viaProxy({ authorization: header }) });
    assert.equal(res.statusCode, 401);
  });

  await t.test('non-allowlisted prefix is ignored even from loopback', async () => {
    reset();
    const header = await NostrBridge.buildNip98Header(s, 'GET', `http://${PUBLIC}/other/v1/x`);
    const res = await app.inject({ method: 'GET', url: '/v1/x',
      headers: viaProxy({ authorization: header, 'x-forwarded-prefix': '/other' }) });
    assert.equal(res.statusCode, 401);
  });

  await t.test('method and payload stay bound', async () => {
    reset();
    const header = await NostrBridge.buildNip98Header(s, 'GET', `http://${PUBLIC}/mgmt/v1/x`);
    const res = await app.inject({ method: 'POST', url: '/v1/x', payload: '{}',
      headers: viaProxy({ authorization: header, 'content-type': 'application/json' }) });
    assert.equal(res.statusCode, 401);
  });
});

test('verifyNip98 compares the url tag EXACTLY (no endsWith)', { skip }, async (t) => {
  const { signer: s } = signer();
  const mk = (u) => NostrBridge.buildNip98Header(s, 'GET', u);

  await t.test('rejects a signature for a longer url that merely ends with the request url', async () => {
    reset();
    const header = await mk('http://evil.example/prefix/http://a.test/v1/x');
    assert.equal(NostrBridge.verifyNip98(header, 'GET', 'http://a.test/v1/x').valid, false);
  });

  await t.test('rejects a bare path as the expected url', async () => {
    reset();
    const header = await mk('http://a.test/v1/x');
    assert.equal(NostrBridge.verifyNip98(header, 'GET', '/v1/x').valid, false);
  });

  await t.test('rejects a different path suffix', async () => {
    reset();
    const header = await mk('http://a.test/admin/v1/x');
    assert.equal(NostrBridge.verifyNip98(header, 'GET', 'http://a.test/v1/x').valid, false);
  });

  await t.test('normalises scheme/host case and default port; ignores request query when unsigned', async () => {
    reset();
    const header = await mk('HTTP://A.test:80/v1/x');
    assert.equal(NostrBridge.verifyNip98(header, 'GET', 'http://a.test/v1/x?q=1').valid, true);
  });

  await t.test('a signed query must match the request query', async () => {
    reset();
    const raw = nostrTools.finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000),
      tags: [['u', 'http://a.test/v1/x?q=1'], ['method', 'GET']], content: '' }, nostrTools.generateSecretKey());
    const header = `Nostr ${Buffer.from(JSON.stringify(raw)).toString('base64')}`;
    assert.equal(NostrBridge.verifyNip98(header, 'GET', 'http://a.test/v1/x?q=2').valid, false);
    reset();
    assert.equal(NostrBridge.verifyNip98(header, 'GET', 'http://a.test/v1/x?q=1').valid, true);
  });
});

// ── Security review follow-ups ───────────────────────────────────────────────

const { signedUrlForRequest } = require('../../management-api/lib/nip98-url');
const fakeReq = (headers, url = '/v1/x', peer = '172.18.0.1', encrypted = false) => ({
  headers, url, host: headers['x-forwarded-host'] || headers.host, protocol: headers['x-forwarded-proto'] || 'http',
  raw: { socket: { remoteAddress: peer, encrypted } }, socket: { remoteAddress: peer, encrypted },
});

test('nip98-url: a non-loopback peer cannot influence host, scheme or prefix', () => {
  // Fastify (trustProxy: true) would have returned these forged values from request.host/protocol.
  const r = fakeReq({ host: 'agentbox:9090', 'x-forwarded-host': 'public.example/bridge', 'x-forwarded-proto': 'https', 'x-forwarded-prefix': '/mgmt' });
  assert.equal(signedUrlForRequest(r), 'http://agentbox:9090/v1/x');
  const tls = fakeReq({ host: 'agentbox:9090', 'x-forwarded-proto': 'http' }, '/v1/x', '172.18.0.1', true);
  assert.equal(signedUrlForRequest(tls), 'https://agentbox:9090/v1/x');
});

test('nip98-url: an invalid host yields null (no fallback), on every branch', () => {
  assert.equal(signedUrlForRequest(fakeReq({ host: 'evil.example/bridge' })), null);
  assert.equal(signedUrlForRequest(fakeReq({ host: 'a b' })), null);
  assert.equal(signedUrlForRequest(fakeReq({})), null);
  assert.equal(signedUrlForRequest(fakeReq({ host: 'ok:1', 'x-forwarded-host': 'public.example/bridge' }, '/v1/x', '127.0.0.1')), null);
});

test('nip98-url: loopback peer honours forwarded host/proto/prefix, keeps the query, takes the last proto/host entry', () => {
  const r = fakeReq({ host: '127.0.0.1:9090', 'x-forwarded-host': 'a.example, pub.example:9096', 'x-forwarded-proto': 'http, https', 'x-forwarded-prefix': '/mgmt' }, '/v1/x?q=1&z=2', '127.0.0.1');
  assert.equal(signedUrlForRequest(r), 'https://pub.example:9096/mgmt/v1/x?q=1&z=2');
});

test('Fastify trustProxy is narrowed to loopback and request.host ignores forged headers from other peers', async () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../../management-api/server.js'), 'utf8');
  assert.match(src, /trustProxy:\s*'127\.0\.0\.1,::1'/);
  assert.doesNotMatch(src, /trustProxy:\s*true/);
  const app = fastify({ trustProxy: '127.0.0.1,::1' });
  app.get('/h', async (rq) => ({ host: rq.host, proto: rq.protocol }));
  await app.ready();
  const bad = await app.inject({ url: '/h', remoteAddress: '172.18.0.1', headers: { host: 'a', 'x-forwarded-host': 'evil', 'x-forwarded-proto': 'https' } });
  assert.deepEqual(bad.json(), { host: 'a', proto: 'http' });
  const ok = await app.inject({ url: '/h', remoteAddress: '127.0.0.1', headers: { host: 'a', 'x-forwarded-host': 'pub' } });
  assert.equal(ok.json().host, 'pub');
  await app.close();
});

test('verifyNip98 rejects dot-segments, encoded dots/slashes and backslashes in the url (never resolves them)', { skip }, async (t) => {
  const { signer: s } = signer();
  const bad = [
    'http://a.test/lo/../admin', 'http://a.test/lo/%2e%2e/admin', 'http://a.test/lo/%2E./admin', 'http://a.test/lo/./x',
    'http://a.test/lo/a%2fb', 'http://a.test/lo/a%5cb', 'http://a.test/lo\\..\\admin',
  ];
  for (const u of bad) {
    await t.test(u, async () => {
      reset();
      const raw = nostrTools.finalizeEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000),
        tags: [['u', u], ['method', 'GET']], content: '' }, nostrTools.generateSecretKey());
      const header = `Nostr ${Buffer.from(JSON.stringify(raw)).toString('base64')}`;
      assert.equal(NostrBridge.verifyNip98(header, 'GET', u).valid, false, 'tag side');
      reset();
      const ok = await s.sign({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', 'http://a.test/admin'], ['method', 'GET']], content: '' });
      const h2 = `Nostr ${Buffer.from(JSON.stringify(ok)).toString('base64')}`;
      assert.equal(NostrBridge.verifyNip98(h2, 'GET', u).valid, false, 'request side');
    });
  }
});

test('verifyNip98 trailing slash: exact unless ignoreTrailingSlash; a signed query is compared (full-URL signers work)', { skip }, async () => {
  const { signer: s } = signer();
  const sign = async (u) => {
    const ev = await s.sign({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', u], ['method', 'GET']], content: '' });
    return `Nostr ${Buffer.from(JSON.stringify(ev)).toString('base64')}`;
  };
  reset(); assert.equal(NostrBridge.verifyNip98(await sign('http://a.test/v1/x/'), 'GET', 'http://a.test/v1/x').valid, false);
  reset(); assert.equal(NostrBridge.verifyNip98(await sign('http://a.test/v1/x/'), 'GET', 'http://a.test/v1/x', undefined, { ignoreTrailingSlash: true }).valid, true);
  reset(); assert.equal(NostrBridge.verifyNip98(await sign('http://a.test/v1/x?q=1'), 'GET', 'http://a.test/v1/x?q=1').valid, true);
  reset(); assert.equal(NostrBridge.verifyNip98(await sign('http://a.test/v1/x?q=1'), 'GET', 'http://a.test/v1/x?q=2').valid, false);
});

test('through the auth gate: a spec-style client that signs the FULL url (with query) authenticates; a different query does not', { skip }, async (t) => {
  const app = await build();
  t.after(() => app.close());
  const { signer: s } = signer();
  reset();
  const h = await s.sign({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', `http://${PUBLIC}/mgmt/v1/x?probe=1`], ['method', 'GET']], content: '' });
  const header = `Nostr ${Buffer.from(JSON.stringify(h)).toString('base64')}`;
  const bad = await app.inject({ method: 'GET', url: '/v1/x?probe=2', headers: viaProxy({ authorization: header }) });
  assert.equal(bad.statusCode, 401);
  reset();
  const ok = await app.inject({ method: 'GET', url: '/v1/x?probe=1', headers: viaProxy({ authorization: header }) });
  assert.equal(ok.statusCode, 200, ok.body);
});

test('verifyNip98 rejects control characters (tab, CR, LF, NUL, DEL) in either url', { skip }, async (t) => {
  const { signer: s } = signer();
  const sign = async (u) => {
    const ev = await s.sign({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', u], ['method', 'GET']], content: '' });
    return `Nostr ${Buffer.from(JSON.stringify(ev)).toString('base64')}`;
  };
  for (const ch of ['\t', '\r', '\n', '\u0000', '\u007f']) {
    await t.test(`char ${JSON.stringify(ch)}`, async () => {
      reset();
      assert.equal(NostrBridge.verifyNip98(await sign(`http://a.test/v1/x${ch}y`), 'GET', `http://a.test/v1/x${ch}y`).valid, false, 'tag');
      reset();
      assert.equal(NostrBridge.verifyNip98(await sign('http://a.test/v1/xy'), 'GET', `http://a.test/v1/x${ch}y`).valid, false, 'request');
    });
  }
});
