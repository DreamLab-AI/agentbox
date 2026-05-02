'use strict';

/**
 * /v1/memory — agent memory routed through the configured memory adapter.
 *
 * When adapters.memory = "external-pg" (the default when RuVector is present)
 * entries go to PostgreSQL via ExternalPgMemoryAdapter. When memory = "off"
 * and adapters.pods = "local-solid-rs", entries fall through to the operator's
 * Solid pod at /pods/<npub>/memory/<namespace>/<key>.json.
 *
 * Access control (MEMORY_ADMIN_ACCESS_MODE):
 *   "permissive" — Bearer/admin callers use namespaces as-is (ungated).
 *                  NIP-98 callers are still scoped to their pubkey prefix.
 *   "scoped"     — All callers (including admin) are isolated to a
 *                  pubkey-prefixed namespace: "user:<pubkey>:<namespace>".
 *
 * Operator identity comes from AGENTBOX_NPUB (pod path) and
 * AGENTBOX_X_ONLY_PUBKEY_HEX (URN scope — reserved for future owner-scoped memory).
 *
 * Auth enforced by the global onRequest hook — these routes are not public.
 */

const uris = require('../lib/uris');

const NPUB             = process.env.AGENTBOX_NPUB || '';
const ADMIN_ACCESS_MODE = (process.env.MEMORY_ADMIN_ACCESS_MODE || 'scoped').toLowerCase();

function _podPath(namespace, key) {
  return `/pods/${NPUB}/memory/${namespace}/${encodeURIComponent(key)}.json`;
}

/**
 * Resolve the effective namespace for a request.
 *
 * Bearer auth (admin) in "permissive" mode: namespace used as-is.
 * NIP-98 auth (per-user): always scope to "user:<pubkey>:<namespace>".
 * "scoped" mode: scope all callers regardless of auth method.
 */
function _effectiveNamespace(req, rawNamespace) {
  const auth = req.auth || {};
  if (auth.mode === 'nip98' && auth.pubkey) {
    return `user:${auth.pubkey}:${rawNamespace}`;
  }
  if (ADMIN_ACCESS_MODE !== 'permissive') {
    // scoped mode: even bearer admin gets a namespace prefix based on operator pubkey
    const opPubkey = process.env.AGENTBOX_X_ONLY_PUBKEY_HEX || process.env.AGENTBOX_PUBKEY || '';
    if (opPubkey) return `user:${opPubkey}:${rawNamespace}`;
  }
  return rawNamespace;
}

module.exports = async function memoryRoutes(fastify) {
  /** POST /v1/memory — store an entry */
  fastify.post('/v1/memory', {
    schema: {
      tags: ['memory'],
      description: 'Store a memory entry via the configured adapter (external-pg or pod fallback)',
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
        201: { type: 'object', additionalProperties: true },
        503: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } },
      },
    },
  }, async (req, reply) => {
    const { key, value, namespace = 'default' } = req.body;
    const effectiveNs = _effectiveNamespace(req, namespace);
    const mem  = fastify.adapters && fastify.adapters.memory;
    const pods = fastify.adapters && fastify.adapters.pods;

    // external-pg / embedded-ruvector path
    if (mem && mem._implName !== 'off' && mem._implName !== 'placeholder') {
      const result = await mem.store(key, typeof value === 'string' ? value : JSON.stringify(value), effectiveNs);
      return reply.code(201).send(result);
    }

    // Solid-pod fallback for standalone mode
    if (pods && pods._implName !== 'off' && NPUB) {
      let urn = null;
      try { urn = uris.mint({ kind: 'memory', localId: `${effectiveNs}.${key}` }); } catch (_) {}
      const stored_at = new Date().toISOString();
      const entry = { '@context': 'https://schema.org/', '@type': 'MemoryEntry', ...(urn ? { '@id': urn } : {}), key, namespace: effectiveNs, value, stored_at };
      await pods.write(_podPath(effectiveNs, key), JSON.stringify(entry, null, 2), 'application/ld+json');
      return reply.code(201).send({ key, namespace: effectiveNs, stored_at, urn });
    }

    return reply.code(503).send({ error: 'no-memory-adapter', message: 'No memory adapter available (memory=off and pods=off)' });
  });

  /** GET /v1/memory/:key — retrieve an entry */
  fastify.get('/v1/memory/:key', {
    schema: {
      tags: ['memory'],
      params: { type: 'object', properties: { key: { type: 'string' } } },
      querystring: { type: 'object', properties: { namespace: { type: 'string', default: 'default' } } },
    },
  }, async (req, reply) => {
    const { key } = req.params;
    const effectiveNs = _effectiveNamespace(req, req.query.namespace || 'default');
    const mem  = fastify.adapters && fastify.adapters.memory;
    const pods = fastify.adapters && fastify.adapters.pods;

    if (mem && mem._implName !== 'off' && mem._implName !== 'placeholder') {
      const result = await mem.retrieve(key, effectiveNs);
      if (!result) return reply.code(404).send({ error: 'not-found', key, namespace: effectiveNs });
      return reply.send(result);
    }

    if (pods && pods._implName !== 'off' && NPUB) {
      try {
        const { body } = await pods.read(_podPath(effectiveNs, key));
        return reply.send(JSON.parse(body));
      } catch (err) {
        if (err.name === 'NotFound') return reply.code(404).send({ error: 'not-found', key, namespace: effectiveNs });
        throw err;
      }
    }

    return reply.code(503).send({ error: 'no-memory-adapter' });
  });

  /** GET /v1/memory — list entries in a namespace */
  fastify.get('/v1/memory', {
    schema: {
      tags: ['memory'],
      querystring: { type: 'object', properties: { namespace: { type: 'string', default: 'default' } } },
    },
  }, async (req, reply) => {
    const effectiveNs = _effectiveNamespace(req, req.query.namespace || 'default');
    const mem  = fastify.adapters && fastify.adapters.memory;
    const pods = fastify.adapters && fastify.adapters.pods;

    if (mem && mem._implName !== 'off' && mem._implName !== 'placeholder') {
      const items = await mem.list(effectiveNs);
      return reply.send({ namespace: effectiveNs, items });
    }

    if (pods && pods._implName !== 'off' && NPUB) {
      try {
        const { items, cursor } = await pods.list(`/pods/${NPUB}/memory/${effectiveNs}/`);
        return reply.send({ namespace: effectiveNs, items, cursor });
      } catch (err) {
        if (err.name === 'NotFound') return reply.send({ namespace: effectiveNs, items: [], cursor: null });
        throw err;
      }
    }

    return reply.code(503).send({ error: 'no-memory-adapter' });
  });
};
