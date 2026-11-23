'use strict';

/**
 * Reconstruct the absolute URL a NIP-98 client SIGNED, as seen by an upstream
 * that sits behind the nip98-proxy (AB-03.15).
 *
 * Problem: the proxy's `/mgmt/` route strips the prefix and rewrites `Host`,
 * then forwards the client's Authorization header unchanged (the proxy holds no
 * signing key and must never re-sign: authority stays with the operator). The
 * client signed `https://<public-host>/mgmt/v1/x`; the upstream only sees
 * `Host: 127.0.0.1:9090` and `/v1/x`, so a naive `proto://host + request.url`
 * can never equal the signed `u` tag and every NIP-98 request through the
 * proxy was a 401.
 *
 * Design: the proxy tells the upstream what it removed, via two headers it owns
 * (it deletes any inbound copy before setting them): `X-Forwarded-Host` (the
 * Host the client signed, ADR-2010) and `X-Forwarded-Prefix` (the stripped route
 * prefix, e.g. `/mgmt`). This module honours them ONLY when
 *   1. the TCP peer is loopback (the proxy is co-located; any remote caller
 *      talking to the API directly gets no forwarded-header trust), and
 *   2. the prefix is on an explicit allowlist (default `/mgmt`, override with
 *      `NIP98_TRUSTED_FORWARDED_PREFIXES`, comma separated), and the host is a
 *      syntactically plain `host[:port]`.
 * Even a spoofed header cannot widen authority: the verifier still requires the
 * signed `u` tag to equal this reconstructed URL exactly, plus method and
 * payload hash, so an attacker must already hold a signature for precisely the
 * URL they claim.
 *
 * Without the proxy (non-loopback peer), the host is the RAW `Host` header and
 * the scheme comes from the socket (TLS or not); X-Forwarded-* from such a peer
 * is ignored. Fastify's `request.host`/`request.protocol` are never used: with a
 * permissive `trustProxy` they are attacker-chosen. A missing or malformed host
 * yields null (401), never a fallback. The raw query is kept in the result; the
 * verifier compares it only when the signed `u` tag carries one.
 */

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const HOST_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;
const PREFIX_RE = /^\/[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/;

function trustedPrefixes(env = process.env) {
  const raw = env.NIP98_TRUSTED_FORWARDED_PREFIXES;
  const list = (raw == null || raw === '' ? '/mgmt' : raw)
    .split(',').map((p) => p.trim()).filter((p) => PREFIX_RE.test(p) && !/(^|\/)\.\.?(\/|$)/.test(p));
  return new Set(list);
}

/** The last entry of a (possibly comma-joined) header: the value Fastify's own `request.host` would pick. */
function lastEntry(value) {
  if (Array.isArray(value)) value = value[value.length - 1];
  if (typeof value !== 'string') return '';
  const i = value.lastIndexOf(',');
  return (i === -1 ? value : value.slice(i + 1)).trim();
}

/**
 * @param {object} request  Fastify request. Only `headers`, `url` and the raw
 *   socket are read: NEVER `request.host` / `request.protocol`, which Fastify
 *   derives from X-Forwarded-* for any peer the `trustProxy` setting covers.
 * @param {object} [opts]
 * @param {object} [opts.env]
 * @param {string} [opts.peer]  Override the TCP peer address (tests).
 * @returns {string|null} absolute URL including the request's raw query, or null
 *   when the host is missing or malformed (the caller must answer 401; there is
 *   no fallback host).
 */
function signedUrlForRequest(request, opts = {}) {
  const headers = request.headers || {};
  const socket = (request.raw && request.raw.socket) || request.socket || {};
  const peer = opts.peer || socket.remoteAddress || '';
  const trusted = LOOPBACK.has(peer);

  let proto = socket.encrypted ? 'https' : 'http';
  let host = typeof headers.host === 'string' ? headers.host.trim() : '';
  let prefix = '';

  if (trusted) {
    const fProto = lastEntry(headers['x-forwarded-proto']).toLowerCase();
    if (fProto === 'http' || fProto === 'https') proto = fProto;
    if (headers['x-forwarded-host'] !== undefined) host = lastEntry(headers['x-forwarded-host']);
    const fPrefix = typeof headers['x-forwarded-prefix'] === 'string' ? headers['x-forwarded-prefix'].trim() : '';
    if (fPrefix && trustedPrefixes(opts.env).has(fPrefix)) prefix = fPrefix;
  }
  if (!HOST_RE.test(host)) return null;

  // Raw path + raw query, byte for byte what the router sees: no decoding or
  // dot-segment resolution happens here (the verifier refuses such paths).
  const rawUrl = String(request.url || '/');
  return `${proto}://${host}${prefix}${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}`;
}

module.exports = { signedUrlForRequest, trustedPrefixes };
