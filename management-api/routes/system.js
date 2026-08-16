'use strict';

/**
 * System surface routes (ADR-039 — docBox back-port)
 *
 *   GET /v1/system              live system view: core spine (resolved
 *                               adapters), surfaces, modules — each with its
 *                               gate, introspected on/off/available state and
 *                               apply-class (live | boot | rebuild)
 *   GET /v1/system/audit-chain  verify the hash-chained events JSONL log;
 *                               ?days=N limits to the newest N daily files
 *
 * Both routes are read-only and authed (not on the public allow-list).
 * Mounted unconditionally — like /v1/uri, this is core observability of the
 * box itself, not an optional capability, so it carries no manifest gate.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildSystemView } = require('../lib/system-manifest');
const { buildExecutionCoverage } = require('../lib/execution-coverage');
const auditChain = require('../lib/audit-chain');

function eventsDir() {
  const workspace = process.env.WORKSPACE || path.join(os.homedir(), 'workspace');
  return path.join(workspace, 'events');
}

async function systemRoutes(fastify, options) {
  const { manifest, adapters, logger } = options;

  fastify.get('/v1/system', async (request, reply) => {
    // Live coverage snapshots from the execution subsystems when the server has
    // wired them; otherwise the block reports the declared contract (ADR-057 D5,
    // ADR-058 D3, ADR-059 D5). `execution` never claims coverage it cannot prove.
    const live = (options.execution && typeof options.execution.snapshot === 'function')
      ? options.execution.snapshot()
      : {};
    reply.send({
      generated_at: new Date().toISOString(),
      ...buildSystemView(manifest || {}, adapters || null),
      execution: buildExecutionCoverage(live),
    });
  });

  fastify.get('/v1/system/audit-chain', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          days: { type: 'integer', minimum: 1, maximum: 3650 },
        },
      },
    },
  }, async (request, reply) => {
    const dir = eventsDir();
    let files = [];
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort();
    } catch (_) {
      // Missing directory = no events yet: an empty chain is a valid chain.
    }
    if (request.query.days) {
      files = files.slice(-request.query.days);
    }
    const result = auditChain.verifyFiles(files.map((f) => path.join(dir, f)));
    if (!result.ok) {
      logger.warn({ event: 'audit-chain.broken', ...result }, 'Events log hash chain verification FAILED');
    }
    reply.send({
      generated_at: new Date().toISOString(),
      dir,
      ...result,
    });
  });
}

module.exports = systemRoutes;
