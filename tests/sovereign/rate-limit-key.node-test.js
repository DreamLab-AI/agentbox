'use strict';

/**
 * Rate-limit key after `trustProxy` was narrowed to loopback (re-review item 3).
 *
 * Behind the nip98-proxy every request reaches management-api from 127.0.0.1 and
 * the XFF chain ends at the LAN door (Caddy), so keying on `request.ip` would put
 * ALL operators in one bucket. The proxy-verified identity (X-Agentbox-Pubkey,
 * honoured only from a loopback peer) is the key instead; every other peer is
 * keyed by its own socket address, and a forged header from such a peer is ignored.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fastify = require('../../management-api/node_modules/fastify');
const rateLimit = require('../../management-api/node_modules/@fastify/rate-limit');
const { rateLimitKey } = require('../../management-api/lib/rate-limit-key');

async function build() {
  const app = fastify({ trustProxy: '127.0.0.1,::1' });
  await app.register(rateLimit, { max: 2, timeWindow: '1 minute', keyGenerator: rateLimitKey, allowList: ['127.0.0.1'] });
  app.get('/x', async () => ({ ok: true }));
  await app.ready();
  return app;
}
const get = (app, remoteAddress, headers = {}) => app.inject({ url: '/x', remoteAddress, headers });

test('proxied identities get separate buckets (not one shared Caddy bucket)', async (t) => {
  const app = await build(); t.after(() => app.close());
  const A = 'a'.repeat(64); const B = 'b'.repeat(64);
  const viaProxy = (pk) => ({ 'x-agentbox-pubkey': pk, 'x-forwarded-for': '203.0.113.9, 192.168.2.5' });
  for (let i = 0; i < 2; i++) assert.equal((await get(app, '127.0.0.1', viaProxy(A))).statusCode, 200);
  assert.equal((await get(app, '127.0.0.1', viaProxy(A))).statusCode, 429, 'identity A is limited');
  assert.equal((await get(app, '127.0.0.1', viaProxy(B))).statusCode, 200, 'identity B is unaffected');
});

test('a non-loopback peer is keyed by its own address; a forged identity header does not help', async (t) => {
  const app = await build(); t.after(() => app.close());
  for (let i = 0; i < 2; i++) assert.equal((await get(app, '172.18.0.9', { 'x-agentbox-pubkey': 'c'.repeat(64) })).statusCode, 200);
  const third = await get(app, '172.18.0.9', { 'x-agentbox-pubkey': 'd'.repeat(64) });
  assert.equal(third.statusCode, 429, 'rotating the forged header does not mint new buckets');
  assert.equal((await get(app, '172.18.0.10')).statusCode, 200, 'another peer has its own bucket');
});
