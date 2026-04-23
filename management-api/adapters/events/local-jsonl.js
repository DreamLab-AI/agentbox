'use strict';

/**
 * events/local-jsonl — append-only JSONL event log under /workspace/events/.
 *
 * Files rotate daily: /workspace/events/YYYY-MM-DD.jsonl
 * Subscription handlers are in-process (for the same process instance).
 *
 * Event schema: { ts, session_id, execution_id, kind, payload }
 *
 * @see ADR-005 §events slot
 * @see PRD-001 §Capabilities and adapters
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { BaseAdapter } = require('../base');
const { NotFound, ValidationError } = require('../errors');
const CONTRACT_VERSIONS = require('../contract-versions');

const REQUIRED_FIELDS = ['kind'];

class LocalJsonlEventsAdapter extends BaseAdapter {
  /**
   * @param {object} [opts]
   * @param {string} [opts.eventsDir='/workspace/events'] - Directory for JSONL files
   * @param {Function} [opts.appendFn] - Override fs.appendFileSync for tests
   */
  constructor(opts = {}) {
    super('events', 'local-jsonl', CONTRACT_VERSIONS.events);
    this._dir = opts.eventsDir || '/workspace/events';
    this._appendFn = opts.appendFn || null;
    this._subscribers = new Map(); // id -> { filter, handler }
  }

  /**
   * Dispatch an event. Appends to today's JSONL file and notifies subscribers.
   * @param {object} event
   * @param {string} event.kind     - Event kind (required)
   * @param {object} [event.payload]
   * @param {string} [event.session_id]
   * @param {string} [event.execution_id]
   * @returns {{ ts, kind, id }}
   */
  async dispatch(event) {
    if (!event || !event.kind) {
      throw new ValidationError('event.kind is required');
    }
    const record = {
      ts: new Date().toISOString(),
      session_id: event.session_id || null,
      execution_id: event.execution_id || null,
      kind: event.kind,
      payload: event.payload || {},
    };
    this._append(record);
    // Notify in-process subscribers
    for (const { filter, handler } of this._subscribers.values()) {
      if (!filter || !filter.kind || filter.kind === record.kind) {
        try { handler(record); } catch (_) { /* subscriber errors are isolated */ }
      }
    }
    return { ts: record.ts, kind: record.kind };
  }

  /**
   * Subscribe to events matching filter.
   * @param {object|null} filter - { kind } or null for all
   * @param {Function} handler   - Called with each matching event record
   * @returns {string} subscriptionId
   */
  async subscribe(filter, handler) {
    if (typeof handler !== 'function') throw new ValidationError('handler must be a function');
    const id = randomUUID();
    this._subscribers.set(id, { filter, handler });
    return id;
  }

  /**
   * Remove a subscription.
   * @param {string} subscriptionId
   */
  async unsubscribe(subscriptionId) {
    if (!this._subscribers.has(subscriptionId)) throw new NotFound('subscription', subscriptionId);
    this._subscribers.delete(subscriptionId);
  }

  /** @private */
  _filePath() {
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return path.join(this._dir, `${date}.jsonl`);
  }

  /** @private */
  _append(record) {
    const line = JSON.stringify(record) + '\n';
    if (this._appendFn) {
      this._appendFn(this._filePath(), line);
      return;
    }
    try {
      fs.mkdirSync(this._dir, { recursive: true });
      fs.appendFileSync(this._filePath(), line, 'utf8');
    } catch (err) {
      // Non-fatal: event is still dispatched to in-process subscribers
      process.stderr.write(`[events/local-jsonl] write failed: ${err.message}\n`);
    }
  }
}

module.exports = { LocalJsonlEventsAdapter };
