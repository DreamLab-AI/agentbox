'use strict';

/**
 * /admin/users/* — multi-tenant did:nostr pod administration.
 *
 * Surface mounted when [sovereign_mesh.multi_user].enabled = true.
 * Bodies are 501 Not Implemented until the implementation pass after
 * solid-pod-rs alpha.12 lands and the [sovereign_mesh.git] wiring
 * (queued task: agentbox-git-wiring) completes.
 *
 * See:
 *   - ADR-017 — multi-tenant did:nostr pods (status: Proposed)
 *   - PRD-007 — multi-tenant federation (status: Proposed)
 *
 * Endpoints
 *   POST /admin/users/provision
 *       Body: { pubkey: "<64-char-hex>", invite?: "<nip58-event-json>" }
 *       Result: 201 with provisioned pod metadata once implemented.
 *
 *   POST /admin/users/:pubkey/suspend
 *       Body: { reason?: string }
 *       Result: 200 once implemented; emits NIP-58 attestation kind 30910.
 *
 *   POST /admin/users/:pubkey/archive
 *       Body: { reason?: string }
 *       Result: 200 once implemented; transitions pod to read-only.
 *
 * Auth: enforced by the global onRequest hook in server.js. Only callers
 * whose pubkey appears in [sovereign_mesh.multi_user].admin_pubkeys (or
 * the operator pubkey itself) reach these handlers in the implementation
 * pass — the stub does not yet gate.
 */

const NOT_IMPLEMENTED_BODY = Object.freeze({
  error: 'not_implemented',
  code: 501,
  message:
    'Multi-tenant did:nostr pod administration is scaffolded but not yet implemented. ' +
    'Implementation is queued for follow-on after solid-pod-rs alpha.12 lands and the ' +
    '[sovereign_mesh.git] wiring is in place.',
  reference: 'docs/reference/prd/PRD-007-multi-tenant-federation.md',
});

function attachLink(reply) {
  reply.header(
    'link',
    '</docs/reference/prd/PRD-007-multi-tenant-federation.md>; rel="describedby"; type="text/markdown"'
  );
}

module.exports = async function adminUsersRoutes(fastify, opts) {
  const logger = opts.logger || fastify.log;

  fastify.post('/admin/users/provision', {
    schema: {
      description:
        'Provision a new per-user pod by did:nostr pubkey. PRD-007 §F7. 501 until implementation pass.',
      tags: ['admin', 'multi-user'],
      body: {
        type: 'object',
        required: ['pubkey'],
        properties: {
          pubkey: { type: 'string', minLength: 64, maxLength: 64, pattern: '^[0-9a-fA-F]{64}$' },
          invite: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    logger.warn({
      route: '/admin/users/provision',
      pubkey: req.body && req.body.pubkey,
      stub: true,
    }, 'multi-user provisioning endpoint called (stub, 501)');
    attachLink(reply);
    reply.code(501);
    return NOT_IMPLEMENTED_BODY;
  });

  fastify.post('/admin/users/:pubkey/suspend', {
    schema: {
      description:
        'Suspend a per-user pod (rejects writes; reads continue). PRD-007 §F7. 501 until implementation pass.',
      tags: ['admin', 'multi-user'],
      params: {
        type: 'object',
        required: ['pubkey'],
        properties: { pubkey: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' } },
      },
    },
  }, async (req, reply) => {
    logger.warn({
      route: '/admin/users/:pubkey/suspend',
      pubkey: req.params.pubkey,
      stub: true,
    }, 'multi-user suspend endpoint called (stub, 501)');
    attachLink(reply);
    reply.code(501);
    return NOT_IMPLEMENTED_BODY;
  });

  fastify.post('/admin/users/:pubkey/archive', {
    schema: {
      description:
        'Archive a per-user pod (read-only, excluded from federation fanout). PRD-007 §F7. 501 until implementation pass.',
      tags: ['admin', 'multi-user'],
      params: {
        type: 'object',
        required: ['pubkey'],
        properties: { pubkey: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' } },
      },
    },
  }, async (req, reply) => {
    logger.warn({
      route: '/admin/users/:pubkey/archive',
      pubkey: req.params.pubkey,
      stub: true,
    }, 'multi-user archive endpoint called (stub, 501)');
    attachLink(reply);
    reply.code(501);
    return NOT_IMPLEMENTED_BODY;
  });
};
