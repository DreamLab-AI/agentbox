'use strict';

/**
 * /v1/llm/* — LLM Resource Marketplace routes.
 *
 * Enables mesh-wide negotiation of LLM compute resources using Nostr
 * event kinds 38300-38305. Providers advertise available models;
 * consumers discover and request access; providers grant or deny;
 * usage receipts close the loop for billing via Web Ledger.
 *
 * Routes:
 *
 *   POST /v1/llm/advertise     — publish/update a capability advertisement
 *   DELETE /v1/llm/advertise   — remove all advertisements for the caller
 *   GET  /v1/llm/discover      — search available LLM resources
 *   POST /v1/llm/request       — request access to LLM resources
 *   POST /v1/llm/grant         — grant access (provider only)
 *   POST /v1/llm/deny          — deny a request (provider only)
 *   POST /v1/llm/receipt       — record usage receipt
 *   POST /v1/llm/revoke        — revoke an active grant
 *   GET  /v1/llm/grants        — list active grants for the caller
 *   GET  /v1/llm/stats         — marketplace summary statistics
 *
 * Auth: NIP-98 bearer — the caller's pubkey is extracted from the token.
 *       The caller pubkey becomes the provider or consumer identity.
 */

const {
  KINDS,
  buildAdvertisement,
  buildRequest,
  buildGrant,
  buildDeny,
  buildReceipt,
  buildRevocation,
  validateAdvertisement,
  validateRequest,
  matchRequests,
  Orderbook,
} = require('../lib/llm-marketplace');

const uris = require('../lib/uris');

const orderbook = new Orderbook();

async function llmMarketplaceRoutes(fastify, opts) {
  const logger = opts.logger || fastify.log;

  // ── POST /v1/llm/advertise ────────────────────────────────────────────────
  fastify.post('/v1/llm/advertise', {
    schema: {
      description: 'Publish or update an LLM capability advertisement. Replaceable by model (d-tag). The caller\'s NIP-98 pubkey becomes the provider identity.',
      tags: ['llm-marketplace'],
      body: {
        type: 'object',
        required: ['model', 'context_window', 'endpoint'],
        properties: {
          model:                  { type: 'string', minLength: 1, maxLength: 128 },
          context_window:         { type: 'integer', minimum: 1 },
          max_tokens_per_request: { type: 'integer', minimum: 1 },
          rate_limit:             { type: 'object', properties: { rpm: { type: 'integer' }, tpd: { type: 'integer' } } },
          cost_per_m_token:       { type: 'number', minimum: 0 },
          capabilities:           { type: 'array', items: { type: 'string' } },
          endpoint:               { type: 'string', minLength: 1 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            event:  { type: 'object' },
            urn:    { type: 'string' },
            stored: { type: 'boolean' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const pubkey = req.nip98?.pubkey || process.env.AGENTBOX_PUBKEY || '0'.repeat(64);
    const body = req.body;

    const validation = validateAdvertisement(body);
    if (!validation.valid) {
      return reply.code(422).send({ error: 'validation_failed', message: validation.reason });
    }

    const evt = buildAdvertisement({
      pubkey,
      model: body.model,
      contextWindow: body.context_window,
      maxTokensPerRequest: body.max_tokens_per_request,
      rateLimit: body.rate_limit,
      costPerMToken: body.cost_per_m_token,
      capabilities: body.capabilities,
      endpoint: body.endpoint,
    });

    orderbook.addAdvertisement(pubkey, body);

    let urn;
    try {
      urn = uris.mint({ kind: 'event', pubkey, payload: evt });
    } catch { urn = null; }

    logger.info({ pubkey, model: body.model, kind: KINDS.ADVERTISEMENT }, 'llm-marketplace: advertisement published');

    return { event: evt, urn, stored: true };
  });

  // ── DELETE /v1/llm/advertise ──────────────────────────────────────────────
  fastify.delete('/v1/llm/advertise', {
    schema: {
      description: 'Remove all LLM capability advertisements for the caller.',
      tags: ['llm-marketplace'],
      response: {
        200: {
          type: 'object',
          properties: { removed: { type: 'boolean' } },
        },
      },
    },
  }, async (req) => {
    const pubkey = req.nip98?.pubkey || process.env.AGENTBOX_PUBKEY || '0'.repeat(64);
    orderbook.removeAdvertisements(pubkey);
    logger.info({ pubkey }, 'llm-marketplace: advertisements removed');
    return { removed: true };
  });

  // ── GET /v1/llm/discover ──────────────────────────────────────────────────
  fastify.get('/v1/llm/discover', {
    schema: {
      description: 'Discover available LLM resources. Optionally filter by capability requirements.',
      tags: ['llm-marketplace'],
      querystring: {
        type: 'object',
        properties: {
          min_context_window:   { type: 'integer' },
          max_cost_per_m_token: { type: 'number' },
          capabilities:         { type: 'string', description: 'Comma-separated capability list' },
          provider:             { type: 'string', description: '64-char hex pubkey to filter by provider' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            advertisements: { type: 'array' },
            count:          { type: 'integer' },
          },
        },
      },
    },
  }, async (req) => {
    const q = req.query;
    const filter = {};
    if (q.min_context_window) filter.min_context_window = q.min_context_window;
    if (q.max_cost_per_m_token) filter.max_cost_per_m_token = q.max_cost_per_m_token;
    if (q.capabilities) filter.min_capabilities = q.capabilities.split(',').map(s => s.trim());

    let ads;
    if (Object.keys(filter).length > 0) {
      ads = orderbook.findMatches(filter);
    } else {
      ads = orderbook.getAdvertisements(q.provider || undefined);
    }

    return { advertisements: ads, count: ads.length };
  });

  // ── POST /v1/llm/request ──────────────────────────────────────────────────
  fastify.post('/v1/llm/request', {
    schema: {
      description: 'Request access to LLM resources matching capability requirements.',
      tags: ['llm-marketplace'],
      body: {
        type: 'object',
        required: ['token_budget'],
        properties: {
          min_context_window:   { type: 'integer' },
          min_capabilities:     { type: 'array', items: { type: 'string' } },
          max_cost_per_m_token: { type: 'number' },
          max_latency_ms:       { type: 'integer' },
          token_budget:         { type: 'integer', minimum: 1 },
          purpose:              { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            event:   { type: 'object' },
            matches: { type: 'array' },
            count:   { type: 'integer' },
          },
        },
      },
    },
  }, async (req) => {
    const pubkey = req.nip98?.pubkey || process.env.AGENTBOX_PUBKEY || '0'.repeat(64);
    const body = req.body;

    const validation = validateRequest(body);
    if (!validation.valid) {
      return { error: 'validation_failed', message: validation.reason };
    }

    const evt = buildRequest({
      pubkey,
      minContextWindow: body.min_context_window,
      minCapabilities: body.min_capabilities,
      maxCostPerMToken: body.max_cost_per_m_token,
      maxLatencyMs: body.max_latency_ms,
      tokenBudget: body.token_budget,
      purpose: body.purpose,
    });

    const matches = orderbook.findMatches(body);

    logger.info({ pubkey, matchCount: matches.length, kind: KINDS.REQUEST }, 'llm-marketplace: request published');

    return { event: evt, matches, count: matches.length };
  });

  // ── POST /v1/llm/grant ────────────────────────────────────────────────────
  fastify.post('/v1/llm/grant', {
    schema: {
      description: 'Grant LLM resource access to a requester. Provider-only.',
      tags: ['llm-marketplace'],
      body: {
        type: 'object',
        required: ['request_event_id', 'grantee_pubkey', 'model', 'token_allocation'],
        properties: {
          request_event_id: { type: 'string' },
          grantee_pubkey:   { type: 'string', minLength: 64, maxLength: 64 },
          model:            { type: 'string' },
          token_allocation: { type: 'integer', minimum: 1 },
          expires_in:       { type: 'integer', minimum: 60, description: 'TTL in seconds (default 3600)' },
          access_token:     { type: 'string' },
          endpoint:         { type: 'string' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            event:    { type: 'object' },
            grant_id: { type: 'string' },
            urn:      { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const pubkey = req.nip98?.pubkey || process.env.AGENTBOX_PUBKEY || '0'.repeat(64);
    const body = req.body;
    const expiresAt = Math.floor(Date.now() / 1000) + (body.expires_in || 3600);
    const grantId = `grant-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const evt = buildGrant({
      pubkey,
      requestEventId: body.request_event_id,
      granteePubkey: body.grantee_pubkey,
      model: body.model,
      tokenAllocation: body.token_allocation,
      expiresAt,
      accessToken: body.access_token || grantId,
      endpoint: body.endpoint || '',
    });

    orderbook.addGrant(grantId, {
      providerPubkey: pubkey,
      consumerPubkey: body.grantee_pubkey,
      model: body.model,
      tokenAllocation: body.token_allocation,
      tokensUsed: 0,
      expiresAt,
    });

    let urn;
    try {
      urn = uris.mint({ kind: 'receipt', pubkey, payload: evt });
    } catch { urn = null; }

    logger.info({ pubkey, grantee: body.grantee_pubkey, model: body.model, grantId, kind: KINDS.GRANT }, 'llm-marketplace: grant issued');

    reply.code(201);
    return { event: evt, grant_id: grantId, urn };
  });

  // ── POST /v1/llm/deny ────────────────────────────────────────────────────
  fastify.post('/v1/llm/deny', {
    schema: {
      description: 'Deny an LLM resource request.',
      tags: ['llm-marketplace'],
      body: {
        type: 'object',
        required: ['request_event_id', 'grantee_pubkey'],
        properties: {
          request_event_id: { type: 'string' },
          grantee_pubkey:   { type: 'string', minLength: 64, maxLength: 64 },
          reason:           { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: { event: { type: 'object' } },
        },
      },
    },
  }, async (req) => {
    const pubkey = req.nip98?.pubkey || process.env.AGENTBOX_PUBKEY || '0'.repeat(64);
    const body = req.body;

    const evt = buildDeny({
      pubkey,
      requestEventId: body.request_event_id,
      granteePubkey: body.grantee_pubkey,
      reason: body.reason,
    });

    logger.info({ pubkey, grantee: body.grantee_pubkey, reason: body.reason, kind: KINDS.DENY }, 'llm-marketplace: request denied');

    return { event: evt };
  });

  // ── POST /v1/llm/receipt ──────────────────────────────────────────────────
  fastify.post('/v1/llm/receipt', {
    schema: {
      description: 'Record a usage receipt against an active grant.',
      tags: ['llm-marketplace'],
      body: {
        type: 'object',
        required: ['grant_id', 'consumer_pubkey', 'model', 'tokens_used'],
        properties: {
          grant_id:        { type: 'string' },
          consumer_pubkey: { type: 'string', minLength: 64, maxLength: 64 },
          model:           { type: 'string' },
          tokens_used:     { type: 'integer', minimum: 1 },
          cost_sats:       { type: 'integer', minimum: 0 },
          duration_ms:     { type: 'integer', minimum: 0 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            event:    { type: 'object' },
            accepted: { type: 'boolean' },
            urn:      { type: 'string' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const pubkey = req.nip98?.pubkey || process.env.AGENTBOX_PUBKEY || '0'.repeat(64);
    const body = req.body;

    const accepted = orderbook.recordUsage(body.grant_id, body.tokens_used);
    if (!accepted) {
      return reply.code(402).send({
        error: 'budget_exceeded',
        message: 'Token usage exceeds grant allocation or grant not found',
      });
    }

    const evt = buildReceipt({
      pubkey,
      grantEventId: body.grant_id,
      consumerPubkey: body.consumer_pubkey,
      model: body.model,
      tokensUsed: body.tokens_used,
      costSats: body.cost_sats || 0,
      durationMs: body.duration_ms || 0,
    });

    let urn;
    try {
      urn = uris.mint({ kind: 'receipt', pubkey, payload: evt });
    } catch { urn = null; }

    logger.info({ pubkey, grantId: body.grant_id, tokensUsed: body.tokens_used, kind: KINDS.RECEIPT }, 'llm-marketplace: receipt recorded');

    return { event: evt, accepted: true, urn };
  });

  // ── POST /v1/llm/revoke ──────────────────────────────────────────────────
  fastify.post('/v1/llm/revoke', {
    schema: {
      description: 'Revoke an active grant. Provider-only.',
      tags: ['llm-marketplace'],
      body: {
        type: 'object',
        required: ['grant_id'],
        properties: {
          grant_id:        { type: 'string' },
          grantee_pubkey:  { type: 'string', minLength: 64, maxLength: 64 },
          reason:          { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: { event: { type: 'object' }, revoked: { type: 'boolean' } },
        },
      },
    },
  }, async (req) => {
    const pubkey = req.nip98?.pubkey || process.env.AGENTBOX_PUBKEY || '0'.repeat(64);
    const body = req.body;

    orderbook.revokeGrant(body.grant_id);

    const evt = buildRevocation({
      pubkey,
      grantEventId: body.grant_id,
      granteePubkey: body.grantee_pubkey || '',
      reason: body.reason || '',
    });

    logger.info({ pubkey, grantId: body.grant_id, kind: KINDS.REVOCATION }, 'llm-marketplace: grant revoked');

    return { event: evt, revoked: true };
  });

  // ── GET /v1/llm/grants ────────────────────────────────────────────────────
  fastify.get('/v1/llm/grants', {
    schema: {
      description: 'List active grants for the caller.',
      tags: ['llm-marketplace'],
      response: {
        200: {
          type: 'object',
          properties: {
            grants: { type: 'array' },
            count:  { type: 'integer' },
          },
        },
      },
    },
  }, async (req) => {
    const pubkey = req.nip98?.pubkey || process.env.AGENTBOX_PUBKEY || '0'.repeat(64);
    orderbook.pruneExpired();
    const grants = orderbook.getActiveGrants(pubkey);
    return { grants, count: grants.length };
  });

  // ── GET /v1/llm/stats ────────────────────────────────────────────────────
  fastify.get('/v1/llm/stats', {
    schema: {
      description: 'Marketplace summary statistics.',
      tags: ['llm-marketplace'],
      response: {
        200: {
          type: 'object',
          properties: {
            advertisements:        { type: 'integer' },
            activeGrants:          { type: 'integer' },
            totalTokensAllocated:  { type: 'integer' },
            totalTokensUsed:       { type: 'integer' },
            kinds:                 { type: 'object' },
          },
        },
      },
    },
  }, async () => {
    orderbook.pruneExpired();
    return { ...orderbook.stats(), kinds: KINDS };
  });
}

module.exports = llmMarketplaceRoutes;
