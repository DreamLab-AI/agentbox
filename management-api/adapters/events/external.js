'use strict';

/**
 * events/external — HTTP POST event sink to a configured host endpoint.
 *
 * @see ADR-005 §events slot, §Manifest contract (E001, E005)
 * @see PRD-001 §Capabilities and adapters
 */

const { randomUUID } = require('crypto');
const { BaseAdapter } = require('../base');
const { ValidationError, NotFound } = require('../errors');
const CONTRACT_VERSIONS = require('../contract-versions');

class ExternalEventsAdapter extends BaseAdapter {
  /**
   * @param {object} opts
   * @param {string} opts.url          - HTTP POST endpoint
   * @param {string} [opts.authToken]
   * @param {Function} [opts.fetchFn]
   */
  constructor(opts = {}) {
    super('events', 'external', CONTRACT_VERSIONS.events);
    if (!opts.url) throw new Error('ExternalEventsAdapter: url is required');
    this._url = opts.url;
    this._token = opts.authToken || null;
    this._fetch = opts.fetchFn || ((...a) => fetch(...a));
    this._subscribers = new Map();
  }

  async dispatch(event) {
    if (!event || !event.kind) throw new ValidationError('event.kind is required');
    const record = {
      ts: new Date().toISOString(),
      session_id: event.session_id || null,
      execution_id: event.execution_id || null,
      kind: event.kind,
      payload: event.payload || {},
    };
    const headers = { 'Content-Type': 'application/json' };
    if (this._token) headers['Authorization'] = `Bearer ${this._token}`;
    const res = await this._fetch(this._url, {
      method: 'POST',
      headers,
      body: JSON.stringify(record),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new ValidationError(`Event sink returned ${res.status}: ${text.slice(0, 200)}`);
    }
    return { ts: record.ts, kind: record.kind };
  }

  async subscribe(filter, handler) {
    if (typeof handler !== 'function') throw new ValidationError('handler must be a function');
    const id = randomUUID();
    this._subscribers.set(id, { filter, handler });
    return id;
  }

  async unsubscribe(subscriptionId) {
    if (!this._subscribers.has(subscriptionId)) throw new NotFound('subscription', subscriptionId);
    this._subscribers.delete(subscriptionId);
  }
}

module.exports = { ExternalEventsAdapter };
