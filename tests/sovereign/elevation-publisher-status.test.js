'use strict';

/**
 * The elevation publisher's no-op must be loud: one warning at start-up, one on
 * the first skipped publish, every skip counted, and `status()` /
 * GET /v1/kg-elevation/federation reporting { configured, skipped, last_error }.
 */

const Fastify = require('../../management-api/node_modules/fastify');
const { buildElevationPublisher, publicStatus } = require('../../management-api/lib/elevation-publisher');
const kgElevationRoutes = require('../../management-api/routes/kg-elevation');
const uris = require('../../management-api/lib/uris');

const PUBKEY = 'c'.repeat(64);
const proposal = () => ({
  proposal_urn: uris.mint({ kind: 'thing', pubkey: PUBKEY, localId: 'proposal-feedface0001' }),
  target_urn: 'urn:visionclaw:concept:x',
  candidate: { term: 'X', domain: 'd', definition: 'x', score: 0.9, reasons: ['named'] },
});
const makeLogger = () => ({ debug: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() });

describe('elevation-publisher — an unconfigured publisher is loud', () => {
  test('warns once at start-up and reports configured:false with the reason', () => {
    const logger = makeLogger();
    const pub = buildElevationPublisher({ sovereign_mesh: { nostr_bridge: true } }, { logger, env: {} });
    expect(pub.enabled).toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toMatchObject({ event: 'elevation-publish.disabled', reason: 'no-relays' });
    expect(pub.status()).toEqual({
      configured: false, reason: 'no-relays', published: 0, skipped: 0, failed: 0, last_error: 'no-relays',
    });
  });

  test('the first skipped publish warns once; every skip is counted', async () => {
    const logger = makeLogger();
    const pub = buildElevationPublisher({ sovereign_mesh: { nostr_bridge: true } }, { logger, env: {} });
    logger.warn.mockClear();

    for (let i = 0; i < 3; i += 1) {
      await expect(pub.publish(proposal())).resolves.toEqual({ published: false, reason: 'no-relays' });
    }
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toMatchObject({ event: 'elevation-publish.skipped', reason: 'no-relays' });
    expect(pub.status()).toMatchObject({ configured: false, skipped: 3, last_error: 'no-relays' });
  });

  test('a gate-off publisher is also loud (the standalone reason is reported)', async () => {
    const logger = makeLogger();
    const pub = buildElevationPublisher({}, { logger, env: { NOSTR_RELAYS: 'wss://r', AGENTBOX_STACK: 's' } });
    await pub.publish(proposal());
    expect(pub.status()).toMatchObject({ configured: false, reason: 'nostr-bridge-gate-off', skipped: 1 });
  });
});

describe('elevation-publisher — a configured publisher reports honestly', () => {
  const env = { NOSTR_RELAYS: 'wss://relay.example', AGENTBOX_STACK: 'sovereign' };
  const manifest = { sovereign_mesh: { nostr_bridge: true } };

  test('configured:true with zero skips after a successful publish', async () => {
    const logger = makeLogger();
    const pub = buildElevationPublisher(manifest, {
      logger, env, bridge: { publish: jest.fn() }, signer: { sign: jest.fn() },
      publishPanelEvent: jest.fn(async (b, s, unsigned) => ({ ...unsigned, id: 'ok-1' })),
    });
    expect(logger.warn).not.toHaveBeenCalled();
    await pub.publish(proposal());
    expect(pub.status()).toEqual({
      configured: true, reason: null, published: 1, skipped: 0, failed: 0, last_error: null,
    });
  });

  test('a publish error is counted as failed and recorded as last_error', async () => {
    const logger = makeLogger();
    const pub = buildElevationPublisher(manifest, {
      logger, env, bridge: { publish: jest.fn() }, signer: { sign: jest.fn() },
      publishPanelEvent: jest.fn(async () => { throw new Error('relay refused'); }),
    });
    await pub.publish(proposal());
    expect(pub.status()).toMatchObject({ configured: true, published: 0, failed: 1, last_error: 'relay refused' });
  });

  test('a signer/bridge load failure makes it unconfigured and counts the skip', async () => {
    const logger = makeLogger();
    const pub = buildElevationPublisher(manifest, {
      logger, env,
      bridgeModule: { NostrBridge: jest.fn(() => ({ connect() {} })), loadSigner: () => { throw new Error('key will not decrypt'); } },
    });
    await pub.publish(proposal());
    await pub.publish(proposal());
    expect(pub.status()).toMatchObject({ configured: false, reason: 'key will not decrypt', skipped: 2, last_error: 'key will not decrypt' });
    // load-failed warning + the single first-skip warning
    expect(logger.warn.mock.calls.map((c) => c[0].event)).toEqual(['elevation-publish.load-failed', 'elevation-publish.skipped']);
  });
});

describe('GET /v1/kg-elevation/federation', () => {
  async function appWith(manifest, publisher) {
    const app = Fastify();
    await app.register(kgElevationRoutes, { logger: makeLogger(), manifest, ...(publisher ? { elevationPublisher: publisher } : {}) });
    return app;
  }

  test('reports the publisher status when the gate is on', async () => {
    const pub = buildElevationPublisher({ sovereign_mesh: { nostr_bridge: true } }, { logger: makeLogger(), env: {} });
    await pub.publish(proposal());
    const app = await appWith({ sovereign_mesh: { kg_elevation: true } }, pub);
    const res = await app.inject({ method: 'GET', url: '/v1/kg-elevation/federation' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ gate: true, configured: false, skipped: 1, last_error: 'no-relays' });
    await app.close();
  });

  test('with the gate off the route reports gate:false and builds no publisher', async () => {
    const app = await appWith({ sovereign_mesh: { kg_elevation: false } });
    const res = await app.inject({ method: 'GET', url: '/v1/kg-elevation/federation' });
    expect(res.json()).toMatchObject({ gate: false, configured: false, reason: 'kg-elevation-disabled', skipped: 0 });
    await app.close();
  });
});

describe('publicStatus — what the public /ready probe may show', () => {
  test('keeps counts and a fixed reason class, drops last_error', () => {
    const out = publicStatus({
      configured: false, reason: 'no-relays', published: 0, skipped: 4, failed: 0, last_error: 'no-relays',
    });
    expect(out).toEqual({ configured: false, reason: 'no-relays', published: 0, skipped: 4, failed: 0 });
    expect(out.last_error).toBeUndefined();
  });

  test('raw load-failure text is collapsed to the class "load-failed"', () => {
    const out = publicStatus({
      configured: false, reason: 'ENOENT /run/secrets/agent/key.age at wss://relay.internal', published: 0, skipped: 1, failed: 0, last_error: 'x',
    });
    expect(out.reason).toBe('load-failed');
    expect(JSON.stringify(out)).not.toMatch(/secrets|relay\.internal/);
  });

  test('a configured publisher has a null reason', () => {
    expect(publicStatus({ configured: true, reason: null, published: 2, skipped: 0, failed: 0, last_error: null }).reason).toBeNull();
  });
});
