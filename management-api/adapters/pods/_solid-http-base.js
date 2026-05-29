'use strict';

/**
 * pods/_solid-http-base — Solid-protocol HTTP client base class.
 *
 * Generic client for any Solid-compliant pod server (solid-pod-rs locally,
 * any host-mesh pod externally). Wire semantics: PUT to write, GET to read,
 * PATCH for JSON-patch, DELETE to remove. The concrete adapters
 * (`local-solid-rs.js`, `external.js`) extend this base and supply their
 * own base URL + impl tag.
 *
 * Was previously named `local-jss.js` after the legacy JavaScriptSolidServer
 * stub (retired 2026-04-25). Renamed to reflect its actual role as a Solid
 * HTTP base — the wire contract has always been protocol-level Solid, not
 * JSS-specific.
 *
 * @see ADR-005 §pods slot
 * @see ADR-010 solid-pod-rs adoption
 */

const { BaseAdapter } = require('../base');
const { NotFound, PermissionDenied, ValidationError } = require('../errors');
const CONTRACT_VERSIONS = require('../contract-versions');

const DEFAULT_BASE = 'http://localhost:8484';

class SolidHttpPodsAdapter extends BaseAdapter {
  /**
   * @param {object} [opts]
   * @param {string} [opts.baseUrl='http://localhost:8484']
   * @param {Function} [opts.fetchFn] - Override for tests
   * @param {string}   [opts.impl] - Concrete impl tag (overridden by subclasses)
   * @param {Function} [opts.nip98] - `async (method, url, body) => string|null`.
   *   When supplied, an `Authorization: Nostr <…>` header is originated and
   *   attached to every request so the adapter authenticates to a
   *   default-deny pod instead of going out anonymous (PRD-014 Seam C / C2).
   *   Absent → requests are unsigned (backward compatible).
   */
  constructor(opts = {}) {
    super('pods', opts.impl || 'solid-http', CONTRACT_VERSIONS.pods);
    this._base = (opts.baseUrl || DEFAULT_BASE).replace(/\/$/, '');
    this._rawFetch = opts.fetchFn || ((...a) => fetch(...a));
    this._nip98 = typeof opts.nip98 === 'function' ? opts.nip98 : null;
    // Route every request through the signer when one is configured. All
    // verbs (base and subclass overrides) call `this._fetch`, so wrapping
    // here signs the whole surface in one place.
    this._fetch = this._nip98 ? this._signedFetch.bind(this) : this._rawFetch;
  }

  /**
   * Fetch wrapper that originates and attaches a NIP-98 Authorization
   * header. The originator may decline (return a falsy value), in which
   * case the request proceeds unsigned. A caller-supplied Authorization
   * header is never overwritten.
   * @private
   */
  async _signedFetch(url, init = {}) {
    const method = (init.method || 'GET').toUpperCase();
    const existing = init.headers || {};
    const hasAuth = Object.keys(existing).some((k) => k.toLowerCase() === 'authorization');
    if (hasAuth) return this._rawFetch(url, init);
    const header = await this._nip98(method, url, init.body);
    if (!header) return this._rawFetch(url, init);
    return this._rawFetch(url, { ...init, headers: { ...existing, Authorization: header } });
  }

  /**
   * Write a resource (creates or replaces).
   * @param {string} uri
   * @param {string|Buffer} body
   * @param {string} [contentType='application/ld+json']
   * @returns {{ uri, status, created_at }}
   */
  async write(uri, body, contentType = 'application/ld+json') {
    const res = await this._fetch(`${this._base}${uri}`, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body,
    });
    await this._assert(res, [200, 201]);
    const status = res.status;
    return { uri, status, created_at: new Date().toISOString() };
  }

  /**
   * Read a resource.
   * @param {string} uri
   * @returns {{ uri, body, contentType }}
   */
  async read(uri) {
    const res = await this._fetch(`${this._base}${uri}`, {
      headers: { Accept: '*/*' },
    });
    await this._assert(res, [200]);
    const body = await res.text();
    return { uri, body, contentType: res.headers.get('content-type') };
  }

  /**
   * Apply a JSON-patch diff to an existing resource.
   * @param {string} uri
   * @param {object[]} patch - JSON Patch array
   * @returns {{ uri, updated_at }}
   */
  async patch(uri, patch) {
    const res = await this._fetch(`${this._base}${uri}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json-patch+json' },
      body: JSON.stringify(patch),
    });
    await this._assert(res, [200, 204]);
    return { uri, updated_at: new Date().toISOString() };
  }

  /**
   * Delete a resource.
   * @param {string} uri
   * @returns {{ uri, deleted: true }}
   */
  async del(uri) {
    const res = await this._fetch(`${this._base}${uri}`, { method: 'DELETE' });
    await this._assert(res, [200, 204]);
    return { uri, deleted: true };
  }

  /**
   * List children of a container URI.
   * @param {string} container
   * @param {object} [opts]
   * @param {string} [opts.cursor] - Pagination cursor
   * @returns {{ items: string[], cursor: string|null }}
   */
  async list(container, opts = {}) {
    const url = opts && opts.cursor
      ? `${this._base}${container}?cursor=${encodeURIComponent(opts.cursor)}`
      : `${this._base}${container}`;
    const res = await this._fetch(url, {
      headers: { Accept: 'application/ld+json' },
    });
    await this._assert(res, [200]);
    const body = await res.json();
    // JSS returns a container document; extract member URIs
    const members = (body['@graph'] || [])
      .filter(n => n['@type'] === 'http://www.w3.org/ns/ldp#Resource')
      .map(n => n['@id']);
    return { items: members, cursor: body._cursor || null };
  }

  /** @private */
  async _assert(res, allowedStatuses) {
    if (allowedStatuses.includes(res.status)) return;
    if (res.status === 404) throw new NotFound('pod resource', res.url);
    if (res.status === 403 || res.status === 401)
      throw new PermissionDenied(`WAC policy denied ${res.url}`);
    const text = await res.text().catch(() => '');
    throw new ValidationError(`JSS ${res.status}: ${text.slice(0, 200)}`);
  }
}

module.exports = { SolidHttpPodsAdapter };
