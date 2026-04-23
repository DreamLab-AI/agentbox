'use strict';

/**
 * pods/external — HTTP client to a host-provided Solid-compatible pod endpoint.
 *
 * Identical wire semantics to local-jss but points at a remote base URL.
 *
 * @see ADR-005 §pods slot, §Manifest contract (E001)
 * @see PRD-001 §Capabilities and adapters
 */

const { LocalJssPodsAdapter } = require('./local-jss');
const CONTRACT_VERSIONS = require('../contract-versions');

class ExternalPodsAdapter extends LocalJssPodsAdapter {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl     - Host Solid endpoint (required)
   * @param {string} [opts.authToken] - Bearer token
   * @param {Function} [opts.fetchFn]
   */
  constructor(opts = {}) {
    if (!opts.baseUrl) throw new Error('ExternalPodsAdapter: baseUrl is required');
    super(opts);
    // Override impl tag after super sets it
    this.impl = 'external';
    this._token = opts.authToken || null;
    const parentFetch = this._fetch;
    this._fetch = (url, init = {}) => {
      const headers = Object.assign({}, init.headers || {});
      if (this._token) headers['Authorization'] = `Bearer ${this._token}`;
      return parentFetch(url, { ...init, headers });
    };
  }
}

module.exports = { ExternalPodsAdapter };
