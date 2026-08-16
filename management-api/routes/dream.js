/**
 * Dream cockpit routes (ADR-055) — read-only view over the dream engine's
 * per-repo ledgers for the operator console `/dream` panel.
 *
 * GET /dream/status — aggregated ACCEPT/REJECT/INCONCLUSIVE distribution and the
 *   most recent nights per nominated repo. Operator-gated (not on the auth-skip
 *   allowlist in server.js). Never writes; the merge stays on GitHub.
 */

'use strict';

const os = require('os');
const path = require('path');
const { aggregateDreamStatus } = require('../lib/dream-ledger');

/** Workspace root the dream engine scans — matches routes/system.js convention. */
function workspaceRoot() {
  return process.env.WORKSPACE || path.join(os.homedir(), 'workspace');
}

async function dreamRoutes(fastify, options) {
  const logger = options.logger || fastify.log;

  fastify.get('/dream/status', {
    schema: {
      description:
        'Aggregated dream-engine ledger status across nominated repos (read-only, operator-gated). ' +
        'Optional ?limit=1..50 (default 5) bounds the recent-nights list per repo; out-of-range values are clamped.',
      tags: ['dream'],
      response: {
        200: {
          type: 'object',
          properties: {
            generatedAt: { type: 'string' },
            repoCount: { type: 'number' },
            totals: { type: 'object', additionalProperties: true },
            repos: { type: 'array', items: { type: 'object', additionalProperties: true } },
          },
        },
      },
    },
  }, async (request, reply) => {
    // No querystring schema is declared, so Fastify does not coerce/clamp limit —
    // this handler is the sole guard: parse and clamp to [1,50] before slice().
    const raw = Number.parseInt(request.query && request.query.limit, 10);
    const limit = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), 50) : 5;
    logger.debug({ limit }, 'dream status requested');

    const data = aggregateDreamStatus(workspaceRoot(), { limit });
    reply.send({ generatedAt: new Date().toISOString(), ...data });
  });
}

module.exports = dreamRoutes;
