'use strict';

/**
 * /admin/users/* — multi-tenant did:nostr pod administration.
 *
 * Mounted when [sovereign_mesh.multi_user].enabled = true.
 * Provisions Solid pods on the embedded solid-pod-rs-server via
 * POST /_admin/provision/{pubkey} (PSK-gated, alpha.15).
 *
 * Endpoints:
 *   POST /admin/users/provision
 *       Body: { pubkey: "<64-char-hex>", invite?: "<nip58-event-json>" }
 *       → 201 { pod_url, web_id, git_url } on success
 *
 *   POST /admin/users/:pubkey/suspend
 *   POST /admin/users/:pubkey/archive
 *       → 200 once suspension/archive is wired (currently 501)
 *
 * Auth: NIP-98 signed by operator pubkey or admin_pubkeys list.
 * PSK: SOLID_ADMIN_KEY env var must match the solid-pod-rs-server
 *      --admin-key / SOLID_ADMIN_KEY on the same host.
 */

const SOLID_BASE      = process.env.SOLID_POD_BASE_URL  || 'http://127.0.0.1:8484';
const SOLID_ADMIN_KEY = process.env.SOLID_ADMIN_KEY     || '';
const SOLID_PUBLIC    = process.env.SOLID_POD_PUBLIC_URL || SOLID_BASE;

async function provisionOnServer(pubkey) {
  if (!SOLID_ADMIN_KEY) {
    const err = new Error('SOLID_ADMIN_KEY env var not set — cannot provision native pod');
    err.code = 'NO_ADMIN_KEY';
    throw err;
  }

  const url = `${SOLID_BASE}/_admin/provision/${pubkey}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Pod-Admin-Key': SOLID_ADMIN_KEY,
        'Content-Type':    'application/json',
      },
    });
  } catch (fetchErr) {
    const err = new Error(`solid-pod-rs-server unreachable at ${SOLID_BASE}: ${fetchErr.message}`);
    err.code = 'SOLID_UNREACHABLE';
    throw err;
  }

  if (res.status === 409) {
    // Pod already exists — idempotent, return existing metadata.
    return { already_existed: true };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`solid-pod-rs provision returned ${res.status}: ${body}`);
    err.code = 'SOLID_ERROR';
    err.status = res.status;
    throw err;
  }
  return res.json().catch(() => ({}));
}

function podMeta(pubkey) {
  return {
    pod_url: `${SOLID_PUBLIC}/pods/${pubkey}/`,
    web_id:  `${SOLID_PUBLIC}/pods/${pubkey}/profile/card#me`,
    git_url: `${SOLID_PUBLIC}/pods/${pubkey}/.git`,
    did:     `did:nostr:${pubkey}`,
  };
}

module.exports = async function adminUsersRoutes(fastify, opts) {
  const logger = opts.logger || fastify.log;

  fastify.post('/admin/users/provision', {
    schema: {
      description: 'Provision a native Solid pod for a did:nostr pubkey. Calls /_admin/provision on solid-pod-rs-server (PSK-gated). Idempotent.',
      tags: ['admin', 'multi-user'],
      body: {
        type: 'object',
        required: ['pubkey'],
        properties: {
          pubkey: { type: 'string', minLength: 64, maxLength: 64, pattern: '^[0-9a-fA-F]{64}$' },
          invite: { type: 'string' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            pod_url:        { type: 'string' },
            web_id:         { type: 'string' },
            git_url:        { type: 'string' },
            did:            { type: 'string' },
            already_existed:{ type: 'boolean' },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { pubkey } = req.body;

    logger.info({ route: '/admin/users/provision', pubkey }, 'provisioning native pod');

    let serverResult;
    try {
      serverResult = await provisionOnServer(pubkey);
    } catch (err) {
      if (err.code === 'NO_ADMIN_KEY') {
        logger.error({ pubkey }, err.message);
        reply.code(503);
        return { error: 'configuration_error', message: err.message };
      }
      if (err.code === 'SOLID_UNREACHABLE') {
        logger.error({ pubkey }, err.message);
        reply.code(502);
        return { error: 'upstream_unreachable', message: err.message };
      }
      logger.error({ pubkey, status: err.status }, err.message);
      reply.code(err.status >= 400 && err.status < 600 ? err.status : 500);
      return { error: 'provision_failed', message: err.message };
    }

    const meta = podMeta(pubkey);
    logger.info({ pubkey, ...meta, already_existed: serverResult.already_existed || false }, 'pod provisioned');

    reply.code(201);
    return { ...meta, already_existed: serverResult.already_existed || false };
  });

  fastify.post('/admin/users/:pubkey/suspend', {
    schema: {
      description: 'Suspend a per-user pod (rejects writes, reads continue). Emits NIP-58 attestation kind 30910.',
      tags: ['admin', 'multi-user'],
      params: {
        type: 'object',
        required: ['pubkey'],
        properties: { pubkey: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' } },
      },
    },
  }, async (req, reply) => {
    logger.warn({ route: '/admin/users/:pubkey/suspend', pubkey: req.params.pubkey, stub: true }, 'suspend called (501)');
    reply.code(501);
    return { error: 'not_implemented', code: 501, message: 'Suspend is queued post-alpha.15.' };
  });

  fastify.post('/admin/users/:pubkey/archive', {
    schema: {
      description: 'Archive a per-user pod (read-only, excluded from federation fanout).',
      tags: ['admin', 'multi-user'],
      params: {
        type: 'object',
        required: ['pubkey'],
        properties: { pubkey: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' } },
      },
    },
  }, async (req, reply) => {
    logger.warn({ route: '/admin/users/:pubkey/archive', pubkey: req.params.pubkey, stub: true }, 'archive called (501)');
    reply.code(501);
    return { error: 'not_implemented', code: 501, message: 'Archive is queued post-alpha.15.' };
  });
};
