'use strict';

/**
 * Fastify 4 → 5 migration guards (management-api).
 *
 * 1. reply.redirect: Fastify 5 swapped the signature to (url, code). A call
 *    left in the v4 order (code, url) sends a bogus Location, so every
 *    redirecting route is pinned here by status AND Location.
 * 2. Malformed-URL not-found bypass (GHSA-p68q-wchp-6fh7, fixed in fastify
 *    5.12.2): on 4.x a malformed request target under a public prefix was
 *    dispatched to the last-registered encapsulated not-found handler without
 *    running its preHandler, leaking whatever a protected fallback returns.
 *    management-api registers no not-found handler today, so this guards the
 *    fastify floor and any fallback added later.
 */

// Resolve fastify through the management-api install, as the other sovereign
// route tests do (the repo root has no fastify of its own).
const fastify = require('../../management-api/node_modules/fastify');
const uris = require('../../management-api/lib/uris');
const uriResolverRoutes = require('../../management-api/routes/uri-resolver');
const linkedObjectsRoutes = require('../../management-api/routes/linked-objects');
const { createAuthMiddleware } = require('../../management-api/middleware/auth');

const PUBKEY = 'a'.repeat(64);
const POD_BASE = 'http://pod.test:8484';
const noopLogger = { info() {}, warn() {}, error() {}, debug() {}, child() { return this; } };

describe('uri-resolver redirects (fastify 5 reply.redirect(url, code))', () => {
  let app;

  beforeAll(async () => {
    // Same ceiling as server.js: scoped URNs exceed find-my-way's 100-char default.
    app = fastify({ maxParamLength: 512 });
    await app.register(uriResolverRoutes, {
      logger: noopLogger,
      manifest: {
        integrations: { solid_pod_rs: { base_url: POD_BASE } },
        linked_data: { did_documents: 'on' },
      },
    });
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  const resolve = (urn) => app.inject({ method: 'GET', url: `/v1/uri/${encodeURIComponent(urn)}` });

  it('activity → 307 to the agent-events id lookup', async () => {
    const urn = uris.mint({ kind: 'activity', pubkey: PUBKEY, payload: { n: 1 } });
    const res = await resolve(urn);
    expect(res.statusCode).toBe(307);
    expect(res.headers.location).toBe(`/v1/agent-events?id=${encodeURIComponent(urn)}`);
  });

  it('owner-scoped pod kind → 307 to the pod agents path', async () => {
    const urn = uris.mint({ kind: 'pod', pubkey: PUBKEY, payload: { n: 2 } });
    const { local } = uris.parse(urn);
    const res = await resolve(urn);
    expect(res.statusCode).toBe(307);
    expect(res.headers.location).toBe(`${POD_BASE}/agents/${PUBKEY}/pod/${local}`);
  });

  it('did:nostr → 307 to the pod DID document', async () => {
    const res = await resolve(`did:nostr:${PUBKEY}`);
    expect(res.statusCode).toBe(307);
    expect(res.headers.location).toBe(`${POD_BASE}/.well-known/did.json`);
  });

  it('meta → 307 to /v1/meta', async () => {
    const res = await resolve(uris.mint({ kind: 'meta', localId: 'agentbox' }));
    expect(res.statusCode).toBe(307);
    expect(res.headers.location).toBe('/v1/meta');
  });
});

describe('linked-objects viewer redirects', () => {
  const baseViewer = { enabled: true, mountPath: '/lo', sourceCodeHeader: 'https://example.test/src' };

  it('local bundle: GET /lo → 302 to /lo/index.html', async () => {
    const app = fastify();
    await app.register(linkedObjectsRoutes, {
      logger: noopLogger,
      viewer: { ...baseViewer, impl: 'local-linkedobjects' },
    });
    const res = await app.inject({ method: 'GET', url: '/lo' });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/lo/index.html');
    await app.close();
  });

  it('external viewer: /lo and /lo/<tail> → 307 to the external URL (+ tail)', async () => {
    const app = fastify();
    await app.register(linkedObjectsRoutes, {
      logger: noopLogger,
      viewer: { ...baseViewer, impl: 'external', externalUrl: 'https://viewer.example.test/app' },
    });
    const root = await app.inject({ method: 'GET', url: '/lo' });
    expect(root.statusCode).toBe(307);
    expect(root.headers.location).toBe('https://viewer.example.test/app');
    const deep = await app.inject({ method: 'GET', url: '/lo/objects/x?y=1' });
    expect(deep.statusCode).toBe(307);
    expect(deep.headers.location).toBe('https://viewer.example.test/app/objects/x?y=1');
    await app.close();
  });
});

describe('comfyui WebSocket stream (@fastify/websocket >=10 passes the socket itself)', () => {
  const websocket = require('../../management-api/node_modules/@fastify/websocket');
  const comfyuiRoutes = require('../../management-api/routes/comfyui');

  it('answers ping with pong and forwards manager events, then unsubscribes on close', async () => {
    let listener = null;
    let unsubscribed = false;
    const comfyuiManager = {
      subscribe(fn) { listener = fn; return () => { unsubscribed = true; }; },
      subscribeToWorkflow() {},
      unsubscribeFromWorkflow() {},
    };
    const app = fastify();
    await app.register(websocket);
    await app.register(comfyuiRoutes, { logger: noopLogger, metrics: {}, comfyuiManager });
    await app.ready();

    const ws = await app.injectWS('/v1/comfyui/stream');
    const next = () => new Promise((resolve) => ws.once('message', (m) => resolve(JSON.parse(m.toString()))));

    let msg = next();
    ws.send(JSON.stringify({ type: 'ping' }));
    expect(await msg).toEqual({ type: 'pong' });

    msg = next();
    listener({ type: 'progress', workflowId: 'w1' });
    expect(await msg).toEqual({ type: 'progress', workflowId: 'w1' });

    const closed = new Promise((resolve) => ws.once('close', resolve));
    ws.terminate();
    await closed;
    await new Promise((r) => setImmediate(r));
    expect(unsubscribed).toBe(true);
    await app.close();
  });
});

describe('malformed URL cannot reach a protected not-found handler (GHSA-p68q-wchp-6fh7)', () => {
  let app;

  beforeAll(async () => {
    app = fastify();
    const auth = createAuthMiddleware('fastify5-guard-key', { authMode: 'bearer' });
    app.register(async (pub) => {
      pub.get('/', async () => ({ public: true }));
    }, { prefix: '/lo' });
    app.register(async (priv) => {
      priv.addHook('preValidation', auth);
      priv.get('/', async () => ({ ok: true }));
      priv.setNotFoundHandler({ preHandler: auth }, (request, reply) => {
        reply.code(404).send({ secret: 'PROTECTED-FALLBACK' });
      });
    }, { prefix: '/v1' });
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  it.each([
    ['PUT', '/lo/%zz'],
    ['PUT', '/lo/%'],
    ['DELETE', '/lo/%E0%A4%A'],
    ['PATCH', '/v1/%zz'],
  ])('%s %s fails closed without leaking the fallback', async (method, url) => {
    const res = await app.inject({ method, url });
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain('PROTECTED-FALLBACK');
  });

  it('the protected fallback still requires credentials on a well-formed URL', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/does-not-exist' });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain('PROTECTED-FALLBACK');
  });
});
