'use strict';

/**
 * /v1/memory — agent memory backed by the operator's Solid pod.
 *
 * Entries are written as JSON-LD resources under:
 *   /pods/<npub>/memory/<namespace>/<key>.json
 *
 * Requires adapters.pods = "local-solid-rs" (or any pods adapter). Returns
 * 503 when the pods slot is "off". Auth is enforced by the global onRequest
 * hook — these routes are not public.
 *
 * The operator identity is read from AGENTBOX_NPUB (bech32, used as the pod
 * path segment) and AGENTBOX_X_ONLY_PUBKEY_HEX (hex, used in URN scope).
 */

const uris = require('../lib/uris');

const NPUB    = process.env.AGENTBOX_NPUB              || '';
const PUBKEY  = process.env.AGENTBOX_X_ONLY_PUBKEY_HEX || '';

function podPath(namespace, key) {
  return `/pods/${NPUB}/memory/${namespace}/${encodeURIComponent(key)}.json`;
}

module.exports = async function memoryRoutes(fastify) {
  /** POST /v1/memory — store an entry in the operator's pod */
  fastify.post('/v1/memory', {
    schema: {
      tags: ['memory'],
      description: 'Store a memory entry in the operator Solid pod',
      body: {
        type: 'object',
        required: ['key', 'value'],
        properties: {
          key:       { type: 'string' },
          value:     {},
          namespace: { type: 'string', default: 'default' },
        },
      },
      response: {
        201: { type: 'object', properties: { urn: {}, path: { type: 'string' }, stored_at: { type: 'string' } } },
        503: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } },
      },
    },
  }, async (req, reply) => {
    const pods = fastify.adapters && fastify.adapters.pods;
    if (!pods || pods._implName === 'off') {
      return reply.code(503).send({ error: 'pods-adapter-off', message: 'pods adapter is off' });
    }
    if (!NPUB) {
      return reply.code(503).send({ error: 'no-identity', message: 'AGENTBOX_NPUB not set' });
    }

    const { key, value, namespace = 'default' } = req.body;
    const stored_at = new Date().toISOString();

    let urn = null;
    try { urn = uris.mint({ kind: 'memory', localId: `${namespace}.${key}` }); } catch (_) {}

    const entry = {
      '@context': 'https://schema.org/',
      '@type': 'MemoryEntry',
      ...(urn ? { '@id': urn } : {}),
      key,
      namespace,
      value,
      stored_at,
    };

    await pods.write(podPath(namespace, key), JSON.stringify(entry, null, 2), 'application/ld+json');
    return reply.code(201).send({ urn, path: podPath(namespace, key), stored_at });
  });

  /** GET /v1/memory/:key — retrieve an entry */
  fastify.get('/v1/memory/:key', {
    schema: {
      tags: ['memory'],
      params: { type: 'object', properties: { key: { type: 'string' } } },
      querystring: { type: 'object', properties: { namespace: { type: 'string', default: 'default' } } },
    },
  }, async (req, reply) => {
    const pods = fastify.adapters && fastify.adapters.pods;
    if (!pods || pods._implName === 'off') return reply.code(503).send({ error: 'pods-adapter-off' });
    if (!NPUB) return reply.code(503).send({ error: 'no-identity' });

    const { key } = req.params;
    const namespace = req.query.namespace || 'default';
    try {
      const { body } = await pods.read(podPath(namespace, key));
      return reply.send(JSON.parse(body));
    } catch (err) {
      if (err.name === 'NotFound') return reply.code(404).send({ error: 'not-found', key, namespace });
      throw err;
    }
  });

  /** GET /v1/memory — list entries in a namespace */
  fastify.get('/v1/memory', {
    schema: {
      tags: ['memory'],
      querystring: { type: 'object', properties: { namespace: { type: 'string', default: 'default' } } },
    },
  }, async (req, reply) => {
    const pods = fastify.adapters && fastify.adapters.pods;
    if (!pods || pods._implName === 'off') return reply.code(503).send({ error: 'pods-adapter-off' });
    if (!NPUB) return reply.code(503).send({ error: 'no-identity' });

    const namespace = req.query.namespace || 'default';
    try {
      const { items, cursor } = await pods.list(`/pods/${NPUB}/memory/${namespace}/`);
      return reply.send({ namespace, items, cursor });
    } catch (err) {
      if (err.name === 'NotFound') return reply.send({ namespace, items: [], cursor: null });
      throw err;
    }
  });
};
