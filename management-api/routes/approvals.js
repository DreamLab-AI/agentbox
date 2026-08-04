'use strict';

/**
 * /v1/approvals — the pending-approvals dashboard surface (ADR-043 D4.7,
 * PRD-021 F3-6). The SECOND front door to the authority gate's decision loop
 * (the first is the mobile Amethyst/Amber allowlisted key answering 31403s
 * directly).
 *
 *   GET  /v1/approvals            list the open kind-31402 ActionRequests the
 *                                 authority gate is blocking on.
 *   POST /v1/approvals/:id/decide SIGN and publish a kind-31403 ActionResponse
 *                                 for request :id, via the operator delegation
 *                                 key — releasing (approve) or denying (reject)
 *                                 the blocked action.
 *
 * Hard rule (ADR-043 D4.7): the decision record is ALWAYS a Schnorr-signed
 * kind-31403 event. This route NEVER writes an unsigned approval — POST /decide
 * requires NIP-98 auth (the operator proving identity) and then asks the
 * authority consumer to sign a 31403 with the operator delegation key
 * (lib/authority-consumer.js signAndPublishDecision). An unsigned or bearer-only
 * approval is rejected. The consumer's own relay subscription then resolves the
 * matching gate wait, so the gate's fail-closed semantics are preserved.
 *
 * The route is a thin front-end over the authority consumer decorated onto
 * fastify at boot (server.js). When no consumer is wired (no relays / no signer
 * stack) it self-gates: GET returns an empty list with a note, POST returns 503.
 *
 * Builder C's front-end targets exactly these two endpoints.
 */

const authz = require('../lib/authz');

async function approvalsRoutes(fastify, options) {
  const { logger } = options;

  // Manifest for the approval allowlist. The route is registered with only
  // { logger } today (server.js), so load the manifest here as a fallback; a
  // future server.js edit can pass options.manifest and this becomes a no-op.
  let manifest = options.manifest;
  if (!manifest) {
    try { manifest = require('../adapters/manifest-loader').loadManifest(); }
    catch (_) { manifest = {}; }
  }

  /** The authority consumer, injected at registration or decorated on fastify. */
  function consumer() {
    return options.authorityConsumer || fastify.authorityConsumer || null;
  }

  // ── GET /v1/approvals — list open 31402 requests ──────────────────────────
  fastify.get('/v1/approvals', {
    schema: {
      description: 'List the open kind-31402 ActionRequests the authority gate is blocking on',
      tags: ['approvals'],
      response: {
        200: {
          type: 'object',
          properties: {
            approvals: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: true,
                properties: {
                  request_event_id: { type: 'string' },
                  panel_id: { type: ['string', 'null'] },
                  case_id: { type: ['string', 'null'] },
                  requester_pubkey: { type: ['string', 'null'] },
                  title: { type: ['string', 'null'] },
                  priority: { type: ['string', 'null'] },
                  created_at: { type: ['integer', 'null'] },
                },
              },
            },
            count: { type: 'integer' },
            wired: { type: 'boolean' },
            note: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const c = consumer();
    if (!c || typeof c.listPending !== 'function') {
      return reply.send({ approvals: [], count: 0, wired: false, note: 'authority consumer not wired (no relay/signer)' });
    }
    const approvals = c.listPending();
    reply.send({ approvals, count: approvals.length, wired: true });
  });

  // ── POST /v1/approvals/:id/decide — sign + publish a 31403 ────────────────
  fastify.post('/v1/approvals/:id/decide', {
    schema: {
      description: 'Sign and publish a kind-31403 decision (via the operator delegation key) for request :id',
      tags: ['approvals'],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      // Accept either the canonical `outcome` (approve|reject|defer) or the
      // dashboard's `decision` (approve|deny). `deny` normalises to `reject`
      // below so both the SPA (setup/frontend/dist/app.js) and API callers work.
      body: {
        type: 'object',
        properties: {
          outcome:   { type: 'string', enum: ['approve', 'reject', 'defer'] },
          decision:  { type: 'string', enum: ['approve', 'deny', 'reject', 'defer'] },
          reasoning: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          additionalProperties: true,
          properties: {
            success: { type: 'boolean' },
            request_event_id: { type: 'string' },
            response_event_id: { type: 'string' },
            outcome: { type: 'string' },
            decided_by: { type: 'string' },
          },
        },
        401: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } },
        403: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } },
        404: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } },
        409: { type: 'object', additionalProperties: true, properties: { error: { type: 'string' }, message: { type: 'string' } } },
        503: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    // NIP-98 required: an approval decision must be proven by the operator's own
    // signature, never a bearer token. The signed 31403 the consumer publishes
    // is what carries the authority — but the REQUEST to sign it must itself be
    // NIP-98-authed so a leaked bearer key cannot release a zero-tolerance gate.
    if (!request.auth || request.auth.mode !== 'nip98') {
      return reply.code(401).send({
        error: 'nip98_required',
        message: 'Approval decisions require NIP-98 auth (an unsigned/bearer approval is prohibited by ADR-043 D4.7).',
      });
    }

    // Finding 2 (Critical): a VERIFIED NIP-98 signature is not enough — the
    // signer must be on the approval allowlist (the operator or a delegated
    // approver). Any other authenticated key is Forbidden, never allowed to
    // release a governance gate.
    if (!authz.isApprover(request.auth.pubkey, manifest)) {
      logger.warn(
        { event: 'approvals.forbidden', requestId: request.params.id, pubkey: request.auth.pubkey },
        'approvals: decide refused — signer is not on the approval allowlist',
      );
      return reply.code(403).send({
        error: 'forbidden_not_approver',
        message: 'This NIP-98 key is not on the approval allowlist (ADR-043 D4.7 — operator/allowlisted keys only).',
      });
    }

    const c = consumer();
    if (!c || typeof c.signAndPublishDecision !== 'function') {
      return reply.code(503).send({
        error: 'authority_consumer_unwired',
        message: 'No authority consumer is wired (no relay/signer) — cannot sign a 31403 decision.',
      });
    }

    const { id } = request.params;

    // A request that a prior 31403 already answered must not be re-decided
    // (409) — check BEFORE the pending lookup, since a decided request is no
    // longer pending. Then an id the gate never opened (or that expired) is 404.
    if (typeof c.isDecided === 'function' && c.isDecided(id)) {
      const prior = typeof c.getDecision === 'function' ? c.getDecision(id) : null;
      return reply.code(409).send({
        error: 'already_decided',
        message: 'This request has already been decided (a signed 31403 was published).',
        request_event_id: id,
        outcome: prior && prior.outcome ? prior.outcome : undefined,
        response_event_id: prior && prior.response_event_id ? prior.response_event_id : undefined,
      });
    }
    if (typeof c.getPending === 'function' && !c.getPending(id)) {
      return reply.code(404).send({
        error: 'unknown_request',
        message: 'No open kind-31402 request with that id is awaiting a decision.',
      });
    }
    const body = request.body || {};
    // Normalise the dashboard's `decision`/`deny` spelling onto the canonical
    // 31403 `outcome`/`reject` vocabulary (ADR-043 D4.7 semantics).
    let outcome = body.outcome || body.decision;
    if (outcome === 'deny') outcome = 'reject';
    if (!outcome || !['approve', 'reject', 'defer'].includes(outcome)) {
      return reply.code(400).send({
        error: 'invalid_outcome',
        message: 'Body must carry outcome (approve|reject|defer) or decision (approve|deny).',
      });
    }
    const { reasoning } = body;

    let signed;
    try {
      signed = await c.signAndPublishDecision({ requestId: id, outcome, reasoning });
    } catch (err) {
      // Safety net for the fail-closed throws — the guards above normally catch
      // these first, but a race (a decision landing between the check and the
      // sign) still maps to the correct status rather than a 502.
      if (err && err.code === 'ALREADY_DECIDED') {
        return reply.code(409).send({ error: 'already_decided', message: err.message, request_event_id: id });
      }
      if (err && err.code === 'NOT_PENDING') {
        return reply.code(404).send({ error: 'unknown_request', message: err.message });
      }
      logger.warn({ err: err.message, requestId: id }, 'approvals: failed to sign/publish 31403 decision');
      return reply.code(502).send({ error: 'sign_publish_failed', message: err.message });
    }

    logger.info(
      { event: 'approvals.decided', requestId: id, outcome, response_event_id: signed && signed.id, decided_by: request.auth.pubkey },
      'approvals: signed 31403 decision published',
    );

    reply.send({
      success: true,
      request_event_id: id,
      response_event_id: signed && signed.id,
      outcome,
      decided_by: request.auth.pubkey,
    });
  });

  logger.debug({ event: 'approvals.route-mounted' }, 'Approvals route ready at /v1/approvals');
}

module.exports = approvalsRoutes;
