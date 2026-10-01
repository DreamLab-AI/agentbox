'use strict';

/**
 * NIP-98 URL binding keeps the Host port (Fastify 5 migration).
 *
 * middleware/auth.js rebuilds the signed URL as protocol://<host><url> and the
 * bridge requires it to equal the event's `u` tag. Fastify 5 changed
 * `request.hostname` to drop the port (`request.host` keeps it), so a server
 * reached on a non-default port — the management API's normal :9090 — would
 * reject every valid NIP-98 token if the middleware still read `hostname`.
 *
 * Runner: node:test (`node --test tests/sovereign/nip98-host-port.node-test.js`,
 * wired into management-api `npm run test:node`) — nostr-tools pulls ESM-only
 * @noble packages that the jest runtime cannot require, so the live signature
 * path is only exercisable here. Skips (does not pass) when the bridge cannot
 * load nostr-tools, i.e. mcp/ dependencies are not installed.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const fastify = require('../../management-api/node_modules/fastify');
const { createAuthMiddleware, registerRawBody } = require('../../management-api/middleware/auth');

let nostrTools = null;
try { nostrTools = require('../../management-api/node_modules/nostr-tools'); } catch { /* skip below */ }
let NostrBridge = null;
try { ({ NostrBridge } = require('../../mcp/servers/nostr-bridge')); } catch { /* skip below */ }

function bridgeVerifies() {
  if (!nostrTools || !NostrBridge || typeof NostrBridge.buildNip98Header !== 'function') return false;
  try {
    const sk = nostrTools.generateSecretKey();
    const ev = nostrTools.finalizeEvent(
      { kind: 27235, created_at: Math.floor(Date.now() / 1000), tags: [['u', 'http://x/'], ['method', 'GET']], content: '' },
      sk,
    );
    const r = NostrBridge.verifyNip98(`Nostr ${Buffer.from(JSON.stringify(ev)).toString('base64')}`, 'GET', 'http://x/');
    if (typeof NostrBridge._resetReplayCache === 'function') NostrBridge._resetReplayCache();
    return !!(r && r.valid === true);
  } catch {
    return false;
  }
}

const live = bridgeVerifies();
const PATH = '/v1/decisions';

test('NIP-98 URL binding includes the Host port', { skip: live ? false : 'NostrBridge cannot load nostr-tools (mcp/ deps not installed)' }, async (t) => {
  const sk = nostrTools.generateSecretKey();
  const pk = nostrTools.getPublicKey(sk);
  const signer = { async sign(evt) { return nostrTools.finalizeEvent(evt, sk); } };

  const app = fastify();
  registerRawBody(app);
  const auth = createAuthMiddleware(null, { authMode: 'nip98' });
  app.addHook('preValidation', auth);
  app.post(PATH, async (request) => ({ ok: true, pubkey: request.auth && request.auth.pubkey }));
  await app.ready();
  t.after(() => app.close());

  const body = JSON.stringify({ decision: 'approve', nonce: 1 });
  const send = (host, header) => app.inject({
    method: 'POST',
    url: PATH,
    headers: { host, authorization: header, 'content-type': 'application/json' },
    payload: body,
  });
  const reset = () => { if (typeof NostrBridge._resetReplayCache === 'function') NostrBridge._resetReplayCache(); };

  await t.test('token signed for host:port authorises on that host:port', async () => {
    reset();
    const header = await NostrBridge.buildNip98Header(signer, 'POST', `http://localhost:9090${PATH}`, { body });
    const res = await send('localhost:9090', header);
    assert.equal(res.statusCode, 200, res.body);
    assert.equal(res.json().pubkey, pk);
  });

  await t.test('token signed without the port is rejected on host:port', async () => {
    reset();
    const header = await NostrBridge.buildNip98Header(signer, 'POST', `http://localhost${PATH}`, { body });
    const res = await send('localhost:9090', header);
    assert.equal(res.statusCode, 401, res.body);
  });

  await t.test('token signed for a portless host still authorises there', async () => {
    reset();
    const header = await NostrBridge.buildNip98Header(signer, 'POST', `http://localhost${PATH}`, { body });
    const res = await send('localhost', header);
    assert.equal(res.statusCode, 200, res.body);
  });
});
