'use strict';

/**
 * well-known.js -- B1: /.well-known/x402.json discovery route.
 *
 * Fastify plugin that serves a static x402 payment-surface manifest at the
 * standard well-known URI so that HTTP clients can discover the agentbox-ledger
 * payment scheme without prior knowledge of the operator's endpoints.
 *
 * Activation: manifest.payments.broadcast.well_known === true
 * When disabled: GET /.well-known/x402.json returns 404.
 *
 * The manifest JSON is generated once at boot and cached in a closure variable
 * to avoid per-request serialisation overhead.
 *
 * Note: the auth-skip for /.well-known/x402.json (parallel to did.json) must
 * be added to the onRequest hook in server.js by the synthesis agent:
 *
 *   if (request.url === '/.well-known/x402.json') return;
 */

/**
 * @param {import('fastify').FastifyInstance} fastify
 * @param {{ manifest?: object, logger?: object }} opts
 */
async function wellKnownRoutes(fastify, opts) {
  const { manifest, logger } = opts;

  const broadcastCfg = (manifest && manifest.payments && manifest.payments.broadcast) || {};
  const wellKnownEnabled = broadcastCfg.well_known === true;

  // Generate the manifest JSON once at boot and cache in this closure.
  // generatedAt is captured at plugin registration time (boot), not per-request.
  let cachedManifest = null;
  if (wellKnownEnabled) {
    const bootTime = new Date();
    cachedManifest = {
      x402Version: 1,
      description: 'agentbox payment surfaces',
      operator: 'did:nostr:' + (process.env.AGENTBOX_PUBKEY || ''),
      generatedAt: bootTime.toISOString(),
      accepts: [
        {
          scheme: 'agentbox-ledger',
          currency: 'sats',
          ledger: 'web-ledger',
          deposit: '/v1/pay/deposit',
          info: '/v1/pay/info',
        },
      ],
      routes: [],
    };

    if (logger) {
      logger.info(
        { event: 'well-known.x402-manifest-cached', operator: cachedManifest.operator },
        'x402 well-known manifest cached at boot'
      );
    }
  }

  // GET /.well-known/x402.json
  // No auth required — public discovery endpoint per x402 spec.
  fastify.get('/.well-known/x402.json', {
    schema: {
      description: 'x402 payment-surface discovery manifest (B1)',
      tags: ['payments'],
      response: {
        200: {
          type: 'object',
          properties: {
            x402Version: { type: 'number' },
            description:  { type: 'string' },
            operator:     { type: 'string' },
            generatedAt:  { type: 'string' },
            accepts:      { type: 'array', items: { type: 'object' } },
            routes:       { type: 'array', items: { type: 'object' } },
          },
        },
        404: {
          type: 'object',
          properties: {
            error:   { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (!wellKnownEnabled) {
      return reply.code(404).send({
        error: 'not-found',
        message: 'x402 well-known manifest is not enabled on this agentbox',
      });
    }

    reply
      .header('Content-Type', 'application/json')
      .header('Cache-Control', 'public, max-age=3600')
      .code(200)
      .send(cachedManifest);
  });
}

module.exports = wellKnownRoutes;
