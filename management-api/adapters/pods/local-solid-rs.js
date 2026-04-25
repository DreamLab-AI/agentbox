'use strict';

/**
 * pods/local-solid-rs — HTTP client to the embedded solid-pod-rs server.
 *
 * Wire protocol is Solid 0.11: PUT/GET/PATCH/DELETE with content negotiation
 * (Turtle, JSON-LD, N-Triples), LDP container listing with Link: rel="next"
 * pagination, WAC deny-by-default enforcement, and Solid Notifications 0.2.
 *
 * Identical surface to SolidHttpPodsAdapter — solid-pod-rs speaks the same
 * protocol JSS speaks — but the server actually implements every verb the
 * adapter already expected, including proper 401/403 classes and atomic-rename
 * filesystem semantics (ADR-009 invariants I01 and I08 hold against this
 * server; they do not hold against the legacy Python stub).
 *
 * @see ADR-010 §Decision — first-class pod implementation class
 * @see ADR-005 §pods slot
 * @see DDD-003 §PodMailbox invariants
 */

const { SolidHttpPodsAdapter } = require('./_solid-http-base');
const { NotFound, PermissionDenied, ValidationError } = require('../errors');
const CONTRACT_VERSIONS = require('../contract-versions');

const DEFAULT_BASE = 'http://127.0.0.1:8484';

class LocalSolidRsPodsAdapter extends SolidHttpPodsAdapter {
  /**
   * @param {object} [opts]
   * @param {string} [opts.baseUrl='http://127.0.0.1:8484']
   * @param {Function} [opts.fetchFn]
   * @param {boolean} [opts.probeCapabilities=true]  Probe OPTIONS on first use.
   */
  constructor(opts = {}) {
    super({ ...opts, baseUrl: opts.baseUrl || DEFAULT_BASE, impl: 'local-solid-rs' });
    this.contractVersion = CONTRACT_VERSIONS.pods;

    this._probed = false;
    this._capabilities = {
      acceptPatch: null,
      acceptPost:  null,
      conformance: null,
    };
    this._probeOnFirstUse = opts.probeCapabilities !== false;
  }

  /**
   * Probe OPTIONS / for WAC, patch, and LDP capabilities.
   * Cached after first successful call; idempotent.
   */
  async probeCapabilities() {
    if (this._probed) return this._capabilities;
    try {
      const res = await this._fetch(`${this._base}/`, { method: 'OPTIONS' });
      this._capabilities.acceptPatch = res.headers.get('accept-patch');
      this._capabilities.acceptPost  = res.headers.get('accept-post');
      this._capabilities.conformance = res.headers.get('link');
      this._probed = true;
    } catch {
      // Probing is advisory; fall back to static assumptions.
      this._probed = true;
    }
    return this._capabilities;
  }

  /**
   * List a container with LDP Link: rel="next" pagination.
   * solid-pod-rs emits pagination in the Link header per LDP-Paging, while
   * the legacy Python stub uses a _cursor body field. We try Link first and
   * fall back to the body for JSS compatibility.
   */
  async list(container, opts = {}) {
    if (this._probeOnFirstUse) await this.probeCapabilities();

    const url = opts && opts.cursor
      ? `${this._base}${container}?cursor=${encodeURIComponent(opts.cursor)}`
      : `${this._base}${container}`;

    const res = await this._fetch(url, {
      headers: { Accept: 'application/ld+json' },
    });
    await this._assertFromRes(res, [200]);

    const body = await res.json();
    const members = (body['@graph'] || [])
      .filter(n => {
        const t = n['@type'];
        if (!t) return false;
        const types = Array.isArray(t) ? t : [t];
        return types.some(s =>
          s === 'http://www.w3.org/ns/ldp#Resource' ||
          s === 'http://www.w3.org/ns/ldp#Container' ||
          s === 'http://www.w3.org/ns/ldp#BasicContainer'
        );
      })
      .map(n => n['@id']);

    // Prefer LDP Link: rel="next" header (solid-pod-rs canonical pagination).
    const linkHeader = res.headers.get('link') || '';
    const linkNext = this._extractLinkRel(linkHeader, 'next');
    const cursor = linkNext || body._cursor || null;

    return { items: members, cursor };
  }

  /**
   * Extract a URL for a named Link rel from a Link header.
   * Handles the RFC-8288 shape: <url>; rel="name", <url2>; rel="other"
   * @private
   */
  _extractLinkRel(headerValue, relName) {
    if (!headerValue) return null;
    const parts = headerValue.split(',');
    for (const p of parts) {
      const match = p.trim().match(/^<([^>]+)>\s*;\s*rel\s*=\s*"?([^";]+)"?/);
      if (match && match[2] === relName) return match[1];
    }
    return null;
  }

  /**
   * Apply an N3 patch in preference to JSON-patch when the server advertises
   * both. Falls through to JSON-patch if N3 is unavailable or caller provides
   * a JSON-patch array explicitly.
   */
  async patch(uri, patch, opts = {}) {
    if (this._probeOnFirstUse) await this.probeCapabilities();

    const wantN3 = opts && opts.format === 'n3';
    const supportsN3 = (this._capabilities.acceptPatch || '').includes('text/n3');

    if (wantN3 && supportsN3) {
      const res = await this._fetch(`${this._base}${uri}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'text/n3' },
        body: typeof patch === 'string' ? patch : String(patch),
      });
      await this._assertFromRes(res, [200, 204]);
      return { uri, updated_at: new Date().toISOString(), format: 'n3' };
    }
    // Default: delegate to the parent JSON-patch path.
    return super.patch(uri, patch);
  }

  /** @private — public-style _assert accessor for use inside this class. */
  async _assertFromRes(res, allowed) {
    if (allowed.includes(res.status)) return;
    if (res.status === 404) throw new NotFound('pod resource', res.url);
    if (res.status === 403 || res.status === 401)
      throw new PermissionDenied(`WAC policy denied ${res.url}`);
    const text = await res.text().catch(() => '');
    throw new ValidationError(`solid-pod-rs ${res.status}: ${text.slice(0, 200)}`);
  }
}

module.exports = { LocalSolidRsPodsAdapter };
