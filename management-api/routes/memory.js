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
const { notifyMemoryFlash, notifyMemoryFlashBatch } = require('../lib/memory-flash-notifier');
const {
  assertPrivacyFilterApplied,
  _markPrivacyApplied,
} = require('../middleware/privacy-filter');

/**
 * Resolve whether the JSON-LD encoder (ADR-012 Layer-3) should wrap pods
 * writes for this surface. The encoder is decorated onto fastify as
 * `linkedData` at boot when [linked_data].enabled = true; the S1 pods surface
 * is per-surface gated by [linked_data].pods. Both must be on, and the encoder
 * must be booted, before we route through it.
 *
 * @returns {object|null} the encoder, or null to use the raw pods path.
 */
function _podsEncoder(fastify) {
  const enc = fastify.linkedData;
  if (!enc || enc._booted !== true) return null;
  // _surfaceEnabled('pods') == master gate && [linked_data].pods != 'off'
  return enc._surfaceEnabled && enc._surfaceEnabled('pods') ? enc : null;
}

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
      notifyMemoryFlash({ key, namespace: effectiveNs, action: 'store' });
      return reply.code(201).send(result);
    }

    // Solid-pod fallback for standalone mode
    if (pods && pods._implName !== 'off' && NPUB) {
      let urn = null;
      try { urn = uris.mint({ kind: 'memory', localId: `${effectiveNs}.${key}` }); } catch (_) {}
      const stored_at = new Date().toISOString();
      // Use the pinned schema.org IRI (http://, not https://) from
      // lib/linked-data-contexts.nix so the encoder's documentLoader
      // resolves it from /opt/agentbox/contexts/ rather than fetching
      // at runtime (DDD-004 §L09 — pinned-context-at-build-time rule).
      const entry = { '@context': 'http://schema.org/', '@type': 'MemoryEntry', ...(urn ? { '@id': urn } : {}), key, namespace: effectiveNs, value, stored_at };
      const podPath = _podPath(effectiveNs, key);

      const encoder = _podsEncoder(fastify);
      if (encoder) {
        // ADR-012 Layer-3: route the pods-fallback write through the JSON-LD
        // encoder instead of calling pods.write() directly (register O2 —
        // encoder bypass). The encoder runs the S1 pods surface, input
        // validation, and round-trip before the adapter write.
        //
        // DDD-004 §L08 / f518120e: the encoder asserts privacy ran on THIS
        // payload. Redaction itself executes as Layer-2 inside the wrapped
        // pods.write (the adapterCall); we stamp the per-dispatch privacy mark
        // here so the encoder's fail-closed guard recognises the dispatch as
        // privacy-traversed rather than a bypass. pods is a FAIL-CLOSED slot —
        // an unmarked payload would throw MiddlewareOrderViolation.
        _markPrivacyApplied(entry);
        await encoder.dispatch({
          slot: 'pods',
          operation: 'write',
          payload: entry,
          context: { agent: process.env.AGENTBOX_AGENT_DID || null },
          adapterCall: (encoded) =>
            pods.write(
              podPath,
              JSON.stringify(encoded.document || encoded, null, 2),
              'application/ld+json',
            ),
        });
        return reply.code(201).send({ key, namespace: effectiveNs, stored_at, urn, encoded: true });
      }

      // Raw pods path (linked_data off for the pods surface). Layer-2 privacy
      // still runs inside the wrapped pods.write; assert it was applied so a
      // future refactor that drops the privacy wrapper is caught loudly. pods
      // is fail-closed: an unmarked write trips MiddlewareOrderViolation. We
      // stamp here because Layer-2 redaction runs during the write call itself.
      _markPrivacyApplied(entry);
      assertPrivacyFilterApplied(entry, 'pods', fastify.log);
      await pods.write(podPath, JSON.stringify(entry, null, 2), 'application/ld+json');
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
      notifyMemoryFlash({ key, namespace: effectiveNs, action: 'retrieve' });
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

  /** POST /v1/memory/search — text search within a namespace */
  fastify.post('/v1/memory/search', {
    schema: {
      tags: ['memory'],
      body: {
        type: 'object',
        required: ['query'],
        properties: {
          query:     { type: 'string' },
          namespace: { type: 'string', default: 'default' },
          limit:     { type: 'number', default: 10 },
        },
      },
    },
  }, async (req, reply) => {
    const { query, namespace = 'default', limit = 10 } = req.body;
    const effectiveNs = _effectiveNamespace(req, namespace);
    const mem = fastify.adapters && fastify.adapters.memory;
    if (mem && mem._implName !== 'off' && mem._implName !== 'placeholder' && typeof mem.search === 'function') {
      const result = await mem.search(query, { namespace: effectiveNs, limit });
      notifyMemoryFlashBatch(
        (result.results || []).slice(0, 5).map((r) => ({ key: r.key, namespace: effectiveNs, action: 'search' })),
      );
      const payload = { namespace: effectiveNs, ...result };
      if (fastify.headroom && result.results && result.results.length > 2) {
        const headroom = fastify.headroom;
        const raw = JSON.stringify(result.results);
        const cr = headroom.compress(raw, 'memory', { logger: fastify.log });
        if (cr.compressed) {
          payload.results = JSON.parse(cr.content);
          payload._compression = { ratio: cr.ratio, ccrEntries: cr.ccrEntries };
        }
      }
      return reply.send(payload);
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
