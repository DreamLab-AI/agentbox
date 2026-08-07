'use strict';

/**
 * /v1/beads — REST surface over the beads adapter slot (ADR-005 §beads,
 * ADR-043 D4.3, PRD-021 F3-3, DDD-019 §WorkLedger).
 *
 * The beads adapter is a complete, URN-minting SQLite work ledger
 * (`adapters/beads/local-sqlite.js`) that had no HTTP surface — this route is
 * that surface. Every call is dispatched through `fastify.adapters.beads`, so
 * the standard adapter middleware chain (ADR-005 observability → ADR-008
 * privacy filter, wired by `adapters/index.js` instrumentAdapter) wraps each
 * verb exactly as it does for the memory and pods slots. This route adds no
 * second dispatch path.
 *
 * Self-gating: when `adapters.beads` resolves to "off" (the running default
 * until the WS3 rebuild-class flip lands, `agentbox.toml:12`) every handler
 * returns 503 `{ error: 'beads disabled' }`, mirroring routes/projects.js's
 * manifest self-gate. Auth is the global NIP-98/bearer onRequest hook.
 *
 * Routes:
 *   GET  /v1/beads                 list ready (unclaimed open) beads; ?parent_id filter
 *   GET  /v1/beads/:id             full detail for one bead
 *   POST /v1/beads/epics           create a top-level epic  (createEpic)
 *   POST /v1/beads/:id/children    create a child under :id (createChild)
 *   POST /v1/beads/:id/claim       claim a bead by an actor (claim, idempotent)
 *   POST /v1/beads/:id/close       close a bead with an outcome (close)
 *
 * Bead ids are `urn:agentbox:bead:<pubkey>:<sha256-12>` minted by the adapter
 * via lib/uris.js — never constructed here (ADR-013, N-07).
 */

const beadSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    id:         { type: 'string' },
    title:      { type: 'string' },
    type:       { type: 'string' },
    parent_id:  { type: ['string', 'null'] },
    status:     { type: 'string' },
    priority:   { type: ['integer', 'null'] },
    actor:      { type: ['string', 'null'] },
    tags:       { type: ['object', 'array', 'null'], additionalProperties: true },
    created_at: { type: 'string' },
    updated_at: { type: 'string' },
  },
};

async function beadsRoutes(fastify, options) {
  const { logger } = options;

  /** The constructed beads adapter (instrumented at resolve time). */
  function beads() {
    return fastify.adapters && fastify.adapters.beads;
  }

  /**
   * Self-gate helper. Returns true and sends 503 when the beads slot resolves
   * to "off" (or is unresolved); handlers bail immediately on a true return.
   */
  function gated(reply) {
    const b = beads();
    if (!b || b._implName === 'off' || b.enabled === false) {
      reply.code(503).send({ error: 'beads disabled', message: 'adapters.beads is "off" — no work ledger is mounted' });
      return true;
    }
    return false;
  }

  /**
   * Translate a typed adapter error into an HTTP reply. Returns true when a
   * reply was sent. NotFound → 404, AlreadyClaimed → 409, ValidationError and
   * bare Error('… is required') → 400; everything else re-throws to the global
   * error handler (500, scrubbed).
   */
  function sendAdapterError(reply, err) {
    if (err && (err.name === 'NotFound' || err.code === 'NOT_FOUND')) {
      reply.code(404).send({ error: 'not-found', message: err.message });
      return true;
    }
    if (err && (err.name === 'AlreadyClaimed' || err.code === 'ALREADY_CLAIMED')) {
      reply.code(409).send({ error: 'already-claimed', message: err.message, actor: err.actor });
      return true;
    }
    if (err && (err.name === 'ValidationError' || /is required$/.test(err.message || ''))) {
      reply.code(400).send({ error: 'validation', message: err.message });
      return true;
    }
    return false;
  }

  // ── GET /v1/beads — list ready (unclaimed, open) beads ────────────────────
  fastify.get('/v1/beads', {
    schema: {
      description: 'List ready (unclaimed, open) beads; optionally filtered to one parent epic',
      tags: ['beads'],
      querystring: {
        type: 'object',
        properties: { parent_id: { type: 'string' } },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            beads: { type: 'array', items: beadSchema },
            count: { type: 'integer' },
            timestamp: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (gated(reply)) return;
    const filter = {};
    if (request.query && request.query.parent_id) filter.parent_id = request.query.parent_id;
    const rows = await beads().getReady(filter);
    reply.send({ beads: rows, count: rows.length, timestamp: new Date().toISOString() });
  });

  // ── GET /v1/beads/:id — full detail ───────────────────────────────────────
  fastify.get('/v1/beads/:id', {
    schema: {
      description: 'Get one bead by its urn:agentbox:bead id',
      tags: ['beads'],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      response: { 200: beadSchema },
    },
  }, async (request, reply) => {
    if (gated(reply)) return;
    try {
      const bead = await beads().show(request.params.id);
      reply.send(bead);
    } catch (err) {
      if (sendAdapterError(reply, err)) return;
      throw err;
    }
  });

  // ── POST /v1/beads/epics — create a top-level epic ────────────────────────
  fastify.post('/v1/beads/epics', {
    schema: {
      description: 'Create a top-level epic; the bead id is minted via lib/uris.js',
      tags: ['beads'],
      body: {
        type: 'object',
        required: ['title'],
        properties: {
          title:    { type: 'string' },
          priority: { type: 'integer' },
          actor:    { type: 'string' },
          tags:     { type: 'array', items: { type: 'string' } },
        },
      },
      response: { 201: beadSchema },
    },
  }, async (request, reply) => {
    if (gated(reply)) return;
    try {
      const epic = await beads().createEpic(request.body || {});
      reply.code(201).send(epic);
    } catch (err) {
      if (sendAdapterError(reply, err)) return;
      throw err;
    }
  });

  // ── POST /v1/beads/:id/children — create a child under :id ─────────────────
  fastify.post('/v1/beads/:id/children', {
    schema: {
      description: 'Create a child bead under the parent epic :id',
      tags: ['beads'],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['title'],
        properties: {
          title:    { type: 'string' },
          priority: { type: 'integer' },
          actor:    { type: 'string' },
          tags:     { type: 'array', items: { type: 'string' } },
        },
      },
      response: { 201: beadSchema },
    },
  }, async (request, reply) => {
    if (gated(reply)) return;
    try {
      const child = await beads().createChild({ ...(request.body || {}), parent_id: request.params.id });
      reply.code(201).send(child);
    } catch (err) {
      if (sendAdapterError(reply, err)) return;
      throw err;
    }
  });

  // ── POST /v1/beads/:id/deps — declare a blocking dependency ───────────────
  fastify.post('/v1/beads/:id/deps', {
    schema: {
      description: 'Declare that bead :id is blocked by another bead; :id stays out of getReady until the blocker closes',
      tags: ['beads'],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['blocker_id'],
        properties: {
          blocker_id: { type: 'string' },
          type:       { type: 'string' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            child_id:   { type: 'string' },
            blocker_id: { type: 'string' },
            type:       { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    if (gated(reply)) return;
    try {
      const body = request.body || {};
      const edge = await beads().addDependency(request.params.id, body.blocker_id, body.type || 'blocks');
      reply.code(201).send(edge);
    } catch (err) {
      if (sendAdapterError(reply, err)) return;
      throw err;
    }
  });

  // ── POST /v1/beads/:id/claim — claim a bead by an actor ───────────────────
  fastify.post('/v1/beads/:id/claim', {
    schema: {
      description: 'Claim a bead by an actor (idempotent for the same actor)',
      tags: ['beads'],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        required: ['actor'],
        properties: { actor: { type: 'string' } },
      },
      response: { 200: beadSchema },
    },
  }, async (request, reply) => {
    if (gated(reply)) return;
    try {
      const bead = await beads().claim(request.params.id, (request.body || {}).actor);
      reply.send(bead);
    } catch (err) {
      if (sendAdapterError(reply, err)) return;
      throw err;
    }
  });

  // ── POST /v1/beads/:id/close — close a bead with an outcome ────────────────
  fastify.post('/v1/beads/:id/close', {
    schema: {
      description: 'Close a bead with an outcome (defaults to "done")',
      tags: ['beads'],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      body: {
        type: 'object',
        properties: { outcome: { type: 'string' } },
      },
      response: { 200: beadSchema },
    },
  }, async (request, reply) => {
    if (gated(reply)) return;
    try {
      const outcome = (request.body && request.body.outcome) || 'done';
      const bead = await beads().close(request.params.id, outcome);
      reply.send(bead);
    } catch (err) {
      if (sendAdapterError(reply, err)) return;
      throw err;
    }
  });

  logger.debug({ event: 'beads.route-mounted' }, 'Beads route ready at /v1/beads (self-gates 503 when adapters.beads=off)');
}

module.exports = beadsRoutes;
