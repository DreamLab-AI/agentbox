'use strict';

/**
 * pods/external — HTTP client to a host-provided Solid-compatible pod endpoint.
 *
 * Identical wire semantics to local-solid-rs but points at a remote base URL
 * supplied by the host orchestrator.
 *
 * @see ADR-005 §pods slot, §Manifest contract (E001)
 * @see PRD-001 §Capabilities and adapters
 */

const { SolidHttpPodsAdapter } = require('./_solid-http-base');
const CONTRACT_VERSIONS = require('../contract-versions');

class ExternalPodsAdapter extends SolidHttpPodsAdapter {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl     - Host Solid endpoint (required)
   * @param {string} [opts.authToken] - Bearer token
   * @param {Function} [opts.fetchFn]
   */
  constructor(opts = {}) {
    if (!opts.baseUrl) throw new Error('ExternalPodsAdapter: baseUrl is required');
    super({ ...opts, impl: 'external' });
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
