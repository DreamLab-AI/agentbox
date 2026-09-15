'use strict';

/**
 * lib/authority-journal — the durable sink for authority-gate DENIALS
 * (PRD-augmentation-conditions FR4.4, EXP-AC-004, ADR-2087).
 *
 * The defect this closes: `lib/authority.js` denied correctly and fail-closed on
 * every path, but the only trace a denial left was a `logger.warn`. A log line
 * is not an accountability record — it is not hash-chained, not addressable, and
 * not visible on the surface an operator actually reads. Condition C3
 * (accountability and recovery) asks whether authority decisions are
 * *observable*; a denial nobody can enumerate fails that question regardless of
 * how correct the denial was.
 *
 * One record, two sinks, because the two things an operator needs come from
 * different places:
 *
 *   1. THE EVENTS ADAPTER (ADR-005 `events` slot). Gives the record the ADR-039
 *      hash chain — `prev_hash`/`hash`/`seq` — so a deleted or reordered denial
 *      is detectable at `GET /v1/system/audit-chain`. The adapter takes an
 *      arbitrary `kind`, so `authority.deny` needs no change to the ADR-057
 *      execution vocabulary (which is deliberately closed and turn-scoped; a
 *      gate denial is neither).
 *   2. THE AGENT-EVENT PUBLISHER. This is what `/v1/agent-events` reads — the
 *      ring buffer plus the ADR-2026 durable archive. Without this sink the
 *      record exists but the route the PRD names cannot return it.
 *
 * NEITHER SINK IS ALLOWED TO HIDE A FAILURE. `append()` always resolves with
 * `{journalled, published, error}` saying exactly which sinks took the record;
 * the caller (the gate) logs loudly on a miss. The action stays denied either
 * way — fail-closed on the decision, fail-open and LOUD on the record of it.
 *
 * @see lib/authority.js            (the producer — every deny path)
 * @see adapters/events/local-jsonl.js (the hash chain)
 * @see routes/agent-events.js      (the read surface)
 * @see ADR-2087, EXP-AC-004
 */

const { agentEventPublisher } = require('../utils/agent-event-publisher');

/** The events-adapter `kind` for a gate denial. Also the record's `type`. */
const AUTHORITY_DENY_KIND = 'authority.deny';

/**
 * The `kind` for a receipt the mutation owner could not mirror to the forum
 * (FR4.2: "failure to post is journalled, never silent"). Same sinks, same
 * chain — a human who never learns their approval applied and a receipt that
 * never reached the forum are the same accountability gap seen from two ends.
 */
const RECEIPT_POST_FAILED_KIND = 'authority.receipt-post-failed';

/** Record types this journal accepts. A record's `type` selects the event kind. */
const RECORD_KINDS = Object.freeze([AUTHORITY_DENY_KIND, RECEIPT_POST_FAILED_KIND]);

const NOOP_LOGGER = { debug() {}, info() {}, warn() {}, error() {} };

/**
 * Build the denial journal.
 *
 * @param {object} [deps]
 * @param {{dispatch: Function}} [deps.eventsAdapter] - resolved ADR-005 events adapter.
 *   Absent (or `off`) → no hash-chained append; the publisher sink still runs.
 * @param {{emitAgentAction: Function}} [deps.publisher] - defaults to the shared
 *   agent-event publisher singleton that backs `/v1/agent-events`.
 * @param {object} [deps.logger]
 * @param {() => string} [deps.now] - ISO-8601 clock override (tests)
 * @returns {{ append: (record: object) => Promise<{journalled: boolean, published: boolean, error?: string}> }}
 */
function buildAuthorityJournal(deps = {}) {
  const eventsAdapter = (deps.eventsAdapter && typeof deps.eventsAdapter.dispatch === 'function')
    ? deps.eventsAdapter : null;
  const publisher = deps.publisher === null
    ? null
    : (deps.publisher || agentEventPublisher);
  const logger = deps.logger || NOOP_LOGGER;
  const now = typeof deps.now === 'function' ? deps.now : () => new Date().toISOString();

  /**
   * Append one denial record.
   *
   * @param {object} record
   * @param {string} record.stage            - where in the gate the denial happened
   * @param {string} record.reason           - machine-readable reason
   * @param {string} [record.agent_did]
   * @param {string} [record.action_class]
   * @param {string} [record.authority_class]
   * @param {string} [record.operation_sha256]
   * @param {object} [record.task_properties]
   * @param {string} [record.request_event_id]
   * @param {string} [record.response_event_id]
   */
  async function append(record) {
    const r = record || {};
    // An unlabelled denial is not a record: "denied" without WHERE and WHY is
    // exactly the un-actionable log line this module replaces.
    if (typeof r.stage !== 'string' || r.stage.length === 0) {
      throw new TypeError('authority.deny record requires a stage');
    }
    if (typeof r.reason !== 'string' || r.reason.length === 0) {
      throw new TypeError('authority.deny record requires a reason');
    }

    const kind = RECORD_KINDS.includes(r.type) ? r.type : AUTHORITY_DENY_KIND;

    const payload = {
      type: kind,
      occurred_at: now(),
      agent_did: r.agent_did || null,
      stage: r.stage,
      reason: r.reason,
      action_class: r.action_class || null,
      authority_class: r.authority_class || null,
      operation_sha256: r.operation_sha256 || null,
      task_properties: r.task_properties || null,
      request_event_id: r.request_event_id || null,
      response_event_id: r.response_event_id || null,
    };

    const errors = [];

    let journalled = false;
    if (eventsAdapter) {
      try {
        await eventsAdapter.dispatch({
          kind,
          session_id: r.session_urn || null,
          execution_id: r.request_event_id || null,
          payload,
        });
        journalled = true;
      } catch (err) {
        errors.push(`events: ${err.message}`);
        logger.error({ event: `${kind}.unchained`, stage: r.stage, err: err.message },
          `${kind} could not be appended to the hash-chained events log`);
      }
    }

    let published = false;
    if (publisher && typeof publisher.emitAgentAction === 'function') {
      try {
        publisher.emitAgentAction({
          // A denial mutates nothing; it is recorded as an UPDATE of governance
          // state whose outcome is a failure, so the REC-5 taxonomy tags it and
          // the visual surface renders it as a blocked action rather than a
          // successful one.
          action_type: 'update',
          source_agent_id: r.agent_did || 'authority-gate',
          target_node_id: r.action_class || 'action',
          outcome: 'failure',
          duration_ms: 0,
          authority_class: r.authority_class || undefined,
          ...(r.agent_did ? { source_urn: r.agent_did } : {}),
          metadata: {
            event: kind,
            outcome: 'failure',
            stage: r.stage,
            reason: r.reason,
            action_class: r.action_class || null,
            authority_class: r.authority_class || null,
            operation_sha256: r.operation_sha256 || null,
            task_properties: r.task_properties || null,
            request_event_id: r.request_event_id || null,
            response_event_id: r.response_event_id || null,
          },
        });
        published = true;
      } catch (err) {
        errors.push(`publisher: ${err.message}`);
        logger.error({ event: `${kind}.unpublished`, stage: r.stage, err: err.message },
          `${kind} could not be published to /v1/agent-events`);
      }
    }

    const result = { journalled, published };
    result.kind = kind;
    if (errors.length) result.error = errors.join('; ');
    else if (!journalled && !published) result.error = `no ${kind} sink is wired`;
    return result;
  }

  return { append, kind: AUTHORITY_DENY_KIND };
}

module.exports = { buildAuthorityJournal, AUTHORITY_DENY_KIND, RECEIPT_POST_FAILED_KIND, RECORD_KINDS };
