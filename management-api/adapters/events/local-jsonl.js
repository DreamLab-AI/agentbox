'use strict';

/**
 * events/local-jsonl — append-only JSONL event log under $WORKSPACE/events/
 * (the agent workspace, normally /home/devuser/workspace).
 *
 * Files rotate daily: $WORKSPACE/events/YYYY-MM-DD.jsonl
 * Subscription handlers are in-process (for the same process instance).
 *
 * Event schema: { ts, session_id, execution_id, kind, payload,
 *                 seq, prev_hash, hash }
 *
 * The last three fields are the ADR-039 tamper-evidence chain:
 * hash = SHA256(prev_hash ‖ canonical_json(record − chain fields)), threading
 * across daily rotation and process restarts (tail resumed from the newest
 * file on first append). Edits, splices and reorders become detectable via
 * GET /v1/system/audit-chain. Chain state only advances on a successful
 * write, so a failed append never leaves the on-disk chain pointing at a
 * record that was never persisted.
 *
 * @see ADR-005 §events slot
 * @see ADR-039 §D3 (hash-chained events log)
 * @see PRD-001 §Capabilities and adapters
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { BaseAdapter } = require('../base');
const { NotFound, ValidationError } = require('../errors');
const CONTRACT_VERSIONS = require('../contract-versions');
const uris = require('../../lib/uris');
const auditChain = require('../../lib/audit-chain');

const REQUIRED_FIELDS = ['kind'];

class LocalJsonlEventsAdapter extends BaseAdapter {
  /**
   * @param {object} [opts]
   * @param {string} [opts.eventsDir='$WORKSPACE/events'] - Directory for JSONL files
   * @param {Function} [opts.appendFn] - Override fs.appendFileSync for tests
   */
  constructor(opts = {}) {
    super('events', 'local-jsonl', CONTRACT_VERSIONS.events);
    const workspace = process.env.WORKSPACE || path.join(os.homedir(), 'workspace');
    this._dir = opts.eventsDir || path.join(workspace, 'events');
    this._appendFn = opts.appendFn || null;
    this._subscribers = new Map(); // id -> { filter, handler }
    this._chain = null; // lazy { prevHash, seq } — resumed from disk tail
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
    if (!this._chain) this._initChain();
    const record = {
      ts: new Date().toISOString(),
      session_id: event.session_id || null,
      execution_id: event.execution_id || null,
      kind: event.kind,
      payload: event.payload || {},
      seq: this._chain.seq,
    };
    record.prev_hash = this._chain.prevHash;
    record.hash = auditChain.hashRecord(this._chain.prevHash, record);
    if (this._append(record)) {
      this._chain = { prevHash: record.hash, seq: record.seq + 1 };
    }
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
    const pubkey = process.env.AGENTBOX_PUBKEY || '0'.repeat(64);
    const id = uris.mint({ kind: 'event', pubkey, payload: { filter: filter || {}, ts: Date.now() } });
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

  /**
   * Resume the hash chain from the newest on-disk record (or genesis).
   * With an injected appendFn (tests) there is no disk state to resume.
   * @private
   */
  _initChain() {
    if (this._appendFn) {
      this._chain = { prevHash: auditChain.GENESIS_HASH, seq: 0 };
      return;
    }
    this._chain = auditChain.readTail(this._dir);
  }

  /**
   * @private
   * @returns {boolean} true when the record was persisted (chain may advance)
   */
  _append(record) {
    const line = JSON.stringify(record) + '\n';
    if (this._appendFn) {
      this._appendFn(this._filePath(), line);
      return true;
    }
    try {
      fs.mkdirSync(this._dir, { recursive: true });
      fs.appendFileSync(this._filePath(), line, 'utf8');
      return true;
    } catch (err) {
      // Non-fatal: event is still dispatched to in-process subscribers
      process.stderr.write(`[events/local-jsonl] write failed: ${err.message}\n`);
      return false;
    }
  }
}

module.exports = { LocalJsonlEventsAdapter };
