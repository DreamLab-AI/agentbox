'use strict';

/**
 * FINDING 1 (External security audit) — NIP-98 body verification must be WIRED.
 *
 * Before the fix, server.js ran the auth check in an `onRequest` hook (before
 * Fastify parses the body) and never called `registerRawBody(app)`, so
 * `request.rawBody` was always undefined during auth. The NIP-98 `payload` tag
 * (= sha256(rawBody)) was therefore never checked: a captured header could be
 * replayed over a SUBSTITUTED body.
 *
 * The fix (server.js): call `registerRawBody(app)` so the content-type parser
 * captures the exact received bytes on `request.rawBody`, and move the auth hook
 * from `onRequest` to `preValidation` (which runs AFTER body parsing) so
 * verifyNip98Header receives `request.rawBody` and the payload binding engages.
 *
 * This test mounts a minimal Fastify app the same way server.js now does —
 * `registerRawBody(app)` + `createAuthMiddleware(...)` at `preValidation` + a
 * POST route — and asserts:
 *   (a) a correctly-signed body authorises (200, pubkey surfaced), and
 *   (b) the SAME header replayed with a substituted body → 401.
 *
 * The live-signature case needs nostr-tools (Schnorr verify). If it is
 * unresolvable in this runtime the live block is skipped, but the WIRING is
 * still proven with a stub verifier: rawBody present at preValidation, and a
 * payload mismatch taking the 401 path.
 */

const crypto = require('crypto');
// Resolve fastify via the management-api install (node_modules lives there, not
// at the repo root) — the same path the other sovereign route tests use.
const fastify = require('../../management-api/node_modules/fastify');
const { createAuthMiddleware, registerRawBody } = require('../../management-api/middleware/auth');

let nostrTools = null;
// nostr-tools is installed under management-api/node_modules and is ESM-first;
// require its CJS entry explicitly (jest's rootDir is the repo root, which has
// no nostr-tools of its own, and a bare/dir require resolves the ESM build).
try { nostrTools = require('../../management-api/node_modules/nostr-tools/lib/cjs/index.js'); } catch { /* skip live case below */ }

let NostrBridge = null;
try { ({ NostrBridge } = require('../../mcp/servers/nostr-bridge')); } catch { /* absent → live case skipped */ }

// The bridge's Schnorr verify resolves nostr-tools relative to its OWN location
// (mcp/servers.getNostrTools). In this repo nostr-tools is only installed under
// management-api/node_modules, so the bridge cannot reach it here and the live
// Schnorr path is unavailable — exactly the runtime the task says to skip
// (mirroring the proxy self-test's skip). We PROVE resolution by verifying a
// freshly-signed token: `valid === true` only when getNostrTools() resolved AND
// the Schnorr check ran; a "not installed" runtime returns valid:false.
let bridgeVerifyResolves = false;
if (nostrTools && NostrBridge && typeof NostrBridge.verifyNip98 === 'function') {
  try {
    const sk = nostrTools.generateSecretKey();
    const probe = nostrTools.finalizeEvent(
      { kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', 'http://x/'], ['method', 'GET']], content: '' },
      sk,
    );
    const header = `Nostr ${Buffer.from(JSON.stringify(probe), 'utf8').toString('base64')}`;
    const r = NostrBridge.verifyNip98(header, 'GET', 'http://x/');
    bridgeVerifyResolves = !!(r && r.valid === true);
    if (typeof NostrBridge._resetReplayCache === 'function') NostrBridge._resetReplayCache();
  } catch { bridgeVerifyResolves = false; }
}

function sha256hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ── Live signature path (requires nostr-tools + the bridge) ─────────────────
const liveAvailable = !!(
  nostrTools &&
  NostrBridge &&
  typeof NostrBridge.buildNip98Header === 'function' &&
  bridgeVerifyResolves
);
const describeLive = liveAvailable ? describe : describe.skip;

describeLive('NIP-98 body binding — live signature (finding 1)', () => {
  const HOST = 'localhost';
  const PATH = '/v1/decisions';
  const URL = `http://${HOST}${PATH}`;

  let sk;
  let pk;
  let signer;
  let app;

  beforeAll(async () => {
    sk = nostrTools.generateSecretKey();
    pk = nostrTools.getPublicKey(sk);
    signer = { async sign(evt) { return nostrTools.finalizeEvent(evt, sk); } };

    app = fastify();
    // Same wiring server.js now uses.
    registerRawBody(app);
    const auth = createAuthMiddleware(null, { authMode: 'nip98' });
    app.addHook('preValidation', async (request, reply) => {
      // Prove rawBody is available at this phase (the whole point of the fix).
      request._rawBodyAtPreValidation = Buffer.isBuffer(request.rawBody)
        ? request.rawBody.length
        : null;
      await auth(request, reply);
    });
    app.post(PATH, async (request) => ({
      ok: true,
      pubkey: request.auth && request.auth.pubkey,
      raw_len_at_preval: request._rawBodyAtPreValidation,
    }));
    await app.ready();
  });

  afterAll(async () => { if (app) await app.close(); });

  beforeEach(() => {
    // Fresh replay window each assertion so a reused header id is not tripped
    // by the bridge's replay defence.
    if (typeof NostrBridge._resetReplayCache === 'function') NostrBridge._resetReplayCache();
  });

  it('(a) a correctly-signed body authorises (200) and surfaces the signer pubkey', async () => {
    const body = JSON.stringify({ decision: 'approve', request_id: 'req-xyz', nonce: 1 });
    const header = await NostrBridge.buildNip98Header(signer, 'POST', URL, { body });

    const res = await app.inject({
      method: 'POST',
      url: PATH,
      headers: { host: HOST, authorization: header, 'content-type': 'application/json' },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.ok).toBe(true);
    expect(parsed.pubkey).toBe(pk);
    // rawBody WAS present at preValidation — the producer + phase move both work.
    expect(parsed.raw_len_at_preval).toBe(Buffer.byteLength(body, 'utf8'));
  });

  it('(b) the SAME header replayed over a SUBSTITUTED body → 401 (payload unbound rejected)', async () => {
    const signedBody = JSON.stringify({ decision: 'approve', request_id: 'req-xyz', nonce: 2 });
    const header = await NostrBridge.buildNip98Header(signer, 'POST', URL, { body: signedBody });

    // Attacker swaps the body while replaying the captured header.
    const substituted = JSON.stringify({ decision: 'approve', request_id: 'req-EVIL', nonce: 2 });
    expect(substituted).not.toBe(signedBody);

    const res = await app.inject({
      method: 'POST',
      url: PATH,
      headers: { host: HOST, authorization: header, 'content-type': 'application/json' },
      payload: substituted,
    });

    expect(res.statusCode).toBe(401);
  });

  it('(c) sanity: header signed over the substituted body DOES authorise (proves it is the binding, not the body)', async () => {
    const body = JSON.stringify({ decision: 'reject', request_id: 'req-abc', nonce: 3 });
    const header = await NostrBridge.buildNip98Header(signer, 'POST', URL, { body });
    const res = await app.inject({
      method: 'POST',
      url: PATH,
      headers: { host: HOST, authorization: header, 'content-type': 'application/json' },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
  });
});

// ── Wiring proof (always runs, no crypto dependency) ────────────────────────
// Even without nostr-tools, prove the two mechanical guarantees the fix rests
// on: (1) registerRawBody surfaces the EXACT bytes on request.rawBody at the
// preValidation phase, and (2) a verifier that binds sha256(rawBody) rejects a
// mismatch with 401 from that phase. A stub verifier stands in for the Schnorr
// check so the wiring is asserted independently of the runtime's crypto libs.
describe('NIP-98 body binding — wiring proof with a stub verifier (finding 1)', () => {
  const PATH = '/wire';
  let app;

  beforeAll(async () => {
    app = fastify();
    registerRawBody(app);
    // Stub verifier: the client presents the payload hash it claims to have
    // signed via X-Expected-Sha256; the server recomputes it over the RAW bytes
    // captured by registerRawBody and rejects a mismatch — exactly the shape of
    // the real payload-tag binding, minus Schnorr.
    app.addHook('preValidation', async (request, reply) => {
      const expected = request.headers['x-expected-sha256'];
      if (!Buffer.isBuffer(request.rawBody)) {
        return reply.code(500).send({ error: 'rawBody_missing_at_preValidation' });
      }
      const got = sha256hex(request.rawBody);
      if (expected && got !== expected) {
        return reply.code(401).send({ error: 'payload_hash_mismatch' });
      }
      request._boundHash = got;
    });
    app.post(PATH, async (request) => ({
      ok: true,
      raw_len: request.rawBody.length,
      bound_hash: request._boundHash,
    }));
    await app.ready();
  });

  afterAll(async () => { if (app) await app.close(); });

  it('rawBody holds the exact received bytes at preValidation and a matching payload hash authorises', async () => {
    const body = JSON.stringify({ a: 1, spaced: '  keep  whitespace  ' });
    const res = await app.inject({
      method: 'POST',
      url: PATH,
      headers: { 'content-type': 'application/json', 'x-expected-sha256': sha256hex(Buffer.from(body, 'utf8')) },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.raw_len).toBe(Buffer.byteLength(body, 'utf8'));
    expect(parsed.bound_hash).toBe(sha256hex(Buffer.from(body, 'utf8')));
  });

  it('a substituted body under a captured payload hash → 401 from preValidation', async () => {
    const signedBody = JSON.stringify({ decision: 'approve' });
    const expected = sha256hex(Buffer.from(signedBody, 'utf8'));
    const substituted = JSON.stringify({ decision: 'approve-EVIL' });
    const res = await app.inject({
      method: 'POST',
      url: PATH,
      headers: { 'content-type': 'application/json', 'x-expected-sha256': expected },
      payload: substituted,
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).error).toBe('payload_hash_mismatch');
  });

  it('bodyless GET-style empty payload still parses (rawBody empty, JSON body = {})', async () => {
    // The parser returns {} for an empty buffer; assert no crash and 200 when no
    // expected hash is presented (mirrors auth-exempt / bodyless behaviour).
    const res = await app.inject({
      method: 'POST',
      url: PATH,
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).raw_len).toBe(0);
  });
});
