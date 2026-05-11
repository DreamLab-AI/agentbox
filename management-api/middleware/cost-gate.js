'use strict';

/**
 * Cost gate for skill execution.
 * Reads skill manifest for declared cost, checks balance via pod payment API,
 * returns 402 if insufficient.
 *
 * Usage in task routes:
 *   fastify.addHook('preHandler', costGate({ logger }));
 *
 * Behaviour:
 *   - Only gates task creation (POST /v1/tasks).
 *   - If the request body omits cost_sats the task is treated as free.
 *   - Balance is queried from the Solid pod payment endpoint at
 *     http://127.0.0.1:<SOLID_POD_PORT>/pay/.balance.
 *   - When the payment backend is unreachable:
 *       COST_GATE_FAIL_CLOSED=true  -> 503 Service Unavailable
 *       otherwise                    -> fail-open (request proceeds)
 */

const SOLID_POD_URL = `http://127.0.0.1:${process.env.SOLID_POD_PORT || 8484}`;

function costGate(opts = {}) {
  const { logger } = opts;

  return async function gate(request, reply) {
    // Only gate task creation (POST /v1/tasks)
    if (request.method !== 'POST' || !request.url.startsWith('/v1/tasks')) return;

    const body = request.body;
    if (!body || !body.cost_sats) return; // no cost declared = free

    const costSats = body.cost_sats;
    const did = request.authenticatedDid; // set by NIP-98 auth middleware
    if (!did) {
      reply.code(401).send({ error: 'Authentication required for paid tasks' });
      return;
    }

    // Check balance via solid-pod-rs
    try {
      const res = await fetch(`${SOLID_POD_URL}/pay/.balance`, {
        headers: { 'X-Forwarded-Did': did },
      });

      if (!res.ok) {
        reply.code(502).send({ error: 'Payment backend unavailable' });
        return;
      }

      const balance = parseInt(res.headers.get('x-balance') || '0', 10);

      if (balance < costSats) {
        reply.code(402).send({
          error: 'Payment Required',
          required_sats: costSats,
          current_balance: balance,
          currency: 'sats',
          deposit_url: '/v1/pay/deposit',
          info_url: '/v1/pay/info',
        });
        return;
      }
    } catch (err) {
      if (logger) logger.warn({ err }, 'Cost gate: payment backend check failed');
      // Fail open if payment backend is down (configurable)
      if (process.env.COST_GATE_FAIL_CLOSED === 'true') {
        reply.code(503).send({ error: 'Payment service unavailable' });
        return;
      }
    }
  };
}

module.exports = { costGate };
