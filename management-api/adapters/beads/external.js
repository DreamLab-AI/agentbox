'use strict';

/**
 * beads/external — HTTP client adapter delegating to a host-provided beads endpoint.
 *
 * Expects federation.external_url to be set; appends /v1/beads/* paths.
 * Uses Node 20+ native fetch.
 *
 * @see ADR-005 §beads slot, §Manifest contract (E001)
 * @see PRD-001 §Capabilities and adapters
 */

const { BaseAdapter } = require('../base');
const { NotFound, AlreadyClaimed, ValidationError } = require('../errors');
const CONTRACT_VERSIONS = require('../contract-versions');

class ExternalBeadsAdapter extends BaseAdapter {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl      - e.g. https://host.example/agentbox
   * @param {string} [opts.authToken]  - Bearer token if required
   * @param {Function} [opts.fetchFn]  - Override fetch for tests (default: global fetch)
   */
  constructor(opts = {}) {
    super('beads', 'external', CONTRACT_VERSIONS.beads);
    if (!opts.baseUrl) throw new Error('ExternalBeadsAdapter: baseUrl is required');
    this._base = opts.baseUrl.replace(/\/$/, '');
    this._token = opts.authToken || null;
    this._fetch = opts.fetchFn || ((...a) => fetch(...a));
  }

  async createEpic(opts = {}) {
    return this._post('/v1/beads/epics', opts);
  }

  async createChild(opts = {}) {
    return this._post('/v1/beads/children', opts);
  }

  async claim(id, actor) {
    return this._post(`/v1/beads/${encodeURIComponent(id)}/claim`, { actor });
  }

  async close(id, outcome = 'done') {
    return this._post(`/v1/beads/${encodeURIComponent(id)}/close`, { outcome });
  }

  async getReady(filter = {}) {
    const qs = filter && filter.parent_id
      ? `?parent_id=${encodeURIComponent(filter.parent_id)}`
      : '';
    return this._get(`/v1/beads/ready${qs}`);
  }

  async show(id) {
    return this._get(`/v1/beads/${encodeURIComponent(id)}`);
  }

  /** @private */
  async _get(path) {
    const res = await this._fetch(`${this._base}${path}`, {
      headers: this._headers(),
    });
    return this._handleResponse(res);
  }

  /** @private */
  async _post(path, body) {
    const res = await this._fetch(`${this._base}${path}`, {
      method: 'POST',
      headers: { ...this._headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this._handleResponse(res);
  }

  /** @private */
  _headers() {
    const h = { Accept: 'application/json' };
    if (this._token) h['Authorization'] = `Bearer ${this._token}`;
    return h;
  }

  /** @private */
  async _handleResponse(res) {
    if (res.status === 404) {
      const body = await res.json().catch(() => ({}));
      throw new NotFound(body.resource || 'resource', body.id || '?');
    }
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      throw new AlreadyClaimed(body.id || '?', body.actor || '?');
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }));
      throw new ValidationError(body.message || `HTTP ${res.status}`);
    }
    return res.json();
  }
}

module.exports = { ExternalBeadsAdapter };
