/**
 * Execution-journal record route (ADR-2071 Phase 1).
 *
 * POST /v1/exec/record — append one AgentExecutionEvent to the ADR-057 journal
 *   on behalf of an out-of-process harness (first caller: the nightly dream
 *   engine, a separate Rust process). Operator-gated (not on the auth-skip
 *   allowlist in server.js).
 *
 * Why a route and not a second writer: the live events adapter
 * (adapters/events/local-jsonl.js) caches the audit-chain head in process
 * memory and appends unlocked, so any second process writing the events log
 * forks `prev_hash` and makes GET /v1/system/audit-chain report tampering.
 * This route reuses the SAME journal singleton as POST /v1/tasks
 * (lib/action-plane.js), so the management API stays the only writer.
 *
 * Journalling, not policing: the route records what a harness says it did.
 * It never approves or denies the side effect (ADR-2071 Phase 2 does that).
 */

'use strict';

const crypto = require('crypto');
const uris = require('../lib/uris');
const { JournalError } = require('../lib/execution-journal');
const { getActionPlane, resolveAgentDid } = require('../lib/action-plane');

/**
 * Event types an external harness may record. The model-visibility types
 * (`model.requested`, `assistant.*`, `input.*`) carry ADR-057 D2 provenance
 * semantics that an HTTP caller cannot satisfy, so they stay internal.
 */
const RECORDABLE_TYPES = Object.freeze([
  'turn.started',
  'step.started',
  'tool.called',
  'tool.completed',
  'step.completed',
  'turn.stopping',
  'turn.completed',
  'turn.cancelled',
]);

const SESSION_RE = /^[A-Za-z0-9._-]{1,160}$/;
const HARNESS_RE = /^[a-z0-9-]{1,40}$/;

/** `session-<harness>-<session>` as an unscoped meta URN (uris.js is the only minter). */
function sessionUrnFor(harness, session) {
  return uris.mint({ kind: 'meta', localId: `session-${harness}-${session}` });
}

/** Deterministic event id for a caller-supplied idempotency key. */
function eventIdFor(sessionUrn, key) {
  const slug = 'exec-' + crypto.createHash('sha256').update(`${sessionUrn}|${key}`).digest('hex').slice(0, 16);
  return uris.mint({ kind: 'meta', localId: slug });
}

async function execRecordRoutes(fastify, options) {
  const logger = options.logger || fastify.log;
  // Tests inject a plane wired to a scratch events directory; production uses
  // the shared singleton so this route and POST /v1/tasks share one writer.
  const getPlane = options.getPlane || (() => getActionPlane({ logger }));

  fastify.post('/v1/exec/record', {
    schema: {
      description:
        'Append one execution-journal event for an out-of-process harness (ADR-2071). ' +
        'Records only; never approves or denies. 503 when the events adapter is not live.',
      tags: ['exec'],
      body: {
        type: 'object',
        required: ['session', 'harness', 'type'],
        additionalProperties: false,
        properties: {
          session: { type: 'string', pattern: SESSION_RE.source },
          harness: { type: 'string', pattern: HARNESS_RE.source },
          type: { type: 'string', enum: RECORDABLE_TYPES.slice() },
          turn: { type: 'integer', minimum: 0 },
          step: { type: 'integer', minimum: 0 },
          key: { type: 'string', minLength: 1, maxLength: 200 },
          causation: { type: 'string', maxLength: 300 },
          correlation: { type: 'string', maxLength: 300 },
          privacy_class: { type: 'string', enum: ['public', 'internal', 'sensitive', 'secret'] },
          occurred_at: { type: 'string', format: 'date-time' },
          payload: { type: 'object', additionalProperties: true },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            session_urn: { type: 'string' },
            event_id: { type: 'string' },
            seq: { type: 'integer' },
            duplicate: { type: 'boolean' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const plane = getPlane();
    if (!plane || !plane.ready || !plane.journal) {
      logger.warn({ reason: plane && plane.reason }, 'exec record refused — journal unavailable');
      return reply.code(503).send({
        error: 'Service Unavailable',
        message: 'The execution journal has no live events adapter',
        details: (plane && plane.reason) || null,
      });
    }

    const b = request.body;
    const sessionUrn = sessionUrnFor(b.harness, b.session);
    const event = {
      session_urn: sessionUrn,
      type: b.type,
      harness: b.harness,
      agent_did: resolveAgentDid(request),
      turn: Number.isInteger(b.turn) ? b.turn : 0,
      payload: b.payload || {},
    };
    if (Number.isInteger(b.step)) event.step = b.step;
    if (b.key) event.event_id = eventIdFor(sessionUrn, b.key);
    if (b.causation) event.causation = b.causation;
    if (b.correlation) event.correlation = b.correlation;
    if (b.privacy_class) event.privacy_class = b.privacy_class;
    if (b.occurred_at) event.occurred_at = b.occurred_at;

    try {
      const { envelope, duplicate } = await plane.journal.append(event);
      return reply.code(201).send({
        session_urn: envelope.session_urn,
        event_id: envelope.event_id,
        seq: envelope.seq,
        duplicate,
      });
    } catch (err) {
      if (err instanceof JournalError) {
        return reply.code(400).send({ error: 'Bad Request', message: err.message, code: err.code });
      }
      throw err;
    }
  });
}

module.exports = execRecordRoutes;
module.exports.RECORDABLE_TYPES = RECORDABLE_TYPES;
module.exports.sessionUrnFor = sessionUrnFor;
