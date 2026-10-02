'use strict';

/**
 * Contract test — POST /v1/pay/deposit does not pretend to credit.
 *
 * solid-pod-rs e62d028 (ADR-2008 D6) deleted the pod's TXO stand-in deposit,
 * which credited `(vout + 1) * 1000` sats for any parseable `txid:vout`; its
 * `/pay/.deposit` now accepts only a verified MRC20 body and answers 501 to
 * everything else. This route used to re-serialise `{txo_uri, amount_sats}`,
 * forward it there, and answer `credited: true` with `amount_sats` standing
 * in for a balance the pod never reported.
 *
 * It cannot forward an MRC20 deposit either: the pod binds NIP-98 to its own
 * URL (`u` tag) and to the exact body bytes (`payload` tag), and a header the
 * caller signed for /v1/pay/deposit fails both. So the route answers 501
 * itself, names the pod's own endpoint, and never calls the pod.
 */

const path = require('path');

const MGMT = path.join(__dirname, '../../../management-api');
const Fastify = require(require.resolve('fastify', { paths: [MGMT] }));
const paymentRoutes = require(path.join(MGMT, 'routes/payments'));

const NOOP_LOGGER = { info() {}, warn() {}, error() {}, debug() {} };
const PK = 'b'.repeat(64);
const TXID = 'ab'.repeat(32);

/** Every body shape a client has sent to this route, old and new. */
const BODIES = [
  { txo_uri: `txo:btc:${TXID}:0`, amount_sats: 100000 },
  { txo_uri: `txo:btc:${TXID}:3`, amount_sats: 1 },
  { txo: `${TXID}:0` },
  { amount_sats: 5000, idempotency_key: 'k-1' },
  { type: 'mrc20', state: {}, prevState: {}, anchor: {} },
];

let podCalls;
let realFetch;

async function build({ nip98 = true } = {}) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.auth = nip98 ? { mode: 'nip98', pubkey: PK } : { mode: 'bearer' };
  });
  await app.register(paymentRoutes, { logger: NOOP_LOGGER, metrics: {} });
  await app.ready();
  return app;
}

beforeEach(() => {
  podCalls = [];
  realFetch = global.fetch;
  // A pod that would still credit (the alpha.9 stand-in with its flag on):
  // if the route reaches it, the test sees the call and the fake credit.
  global.fetch = async (url, opts) => {
    podCalls.push({ url: String(url), opts });
    return new Response(JSON.stringify({ balance_sats: 4000, credited: 4000 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };
});

afterEach(() => {
  global.fetch = realFetch;
});

describe('POST /v1/pay/deposit', () => {
  test.each(BODIES)('answers 501 and never reaches the pod: %j', async (body) => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/pay/deposit',
      headers: { authorization: 'Nostr e30=' },
      payload: body,
    });
    await app.close();

    expect(res.statusCode).toBe(501);
    const json = res.json();
    expect(json.error).toBe('deposit-not-served');
    expect(json.credited).toBeUndefined();
    expect(json.new_balance).toBeUndefined();
    expect(json.message).toMatch(/\/pay\/\.deposit/);
    expect(json.message).toMatch(/MRC20/);
    expect(podCalls).toEqual([]);
  });

  test('a bearer caller gets the same 501, not a credit', async () => {
    const app = await build({ nip98: false });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/pay/deposit',
      payload: BODIES[0],
    });
    await app.close();
    expect(res.statusCode).toBe(501);
    expect(podCalls).toEqual([]);
  });

});
