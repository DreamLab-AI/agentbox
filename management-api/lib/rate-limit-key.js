'use strict';

/**
 * @fastify/rate-limit key generator.
 *
 * `trustProxy` is loopback-only, so behind the nip98-proxy every request's
 * `request.ip` collapses to the LAN door's address and all operators would share
 * one bucket. A request from a loopback peer carries the proxy-VERIFIED identity
 * in X-Agentbox-Pubkey (the proxy drops any inbound copy and re-stamps it from
 * the authenticated identity, ADR-2009); that identity is the key. Any other
 * peer is keyed by its own socket address, so a forged header buys nothing.
 */

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function rateLimitKey(request) {
  const peer = (request.raw && request.raw.socket && request.raw.socket.remoteAddress) || request.ip;
  const id = request.headers && request.headers['x-agentbox-pubkey'];
  if (LOOPBACK.has(peer) && typeof id === 'string' && /^[\x21-\x7e]{1,80}$/.test(id)) return `id:${id}`;
  return request.ip;
}

module.exports = { rateLimitKey };
