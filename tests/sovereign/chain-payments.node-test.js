'use strict';

/**
 * ADR-2097 (amended 2026-10-02): the sidestr rail's routes, end to end in
 * process. A fake sidestr-agent and a fake producer stand in for the binary
 * and the chain; identities, spend keys and bindings are real (nostr-tools),
 * and so are the classifier, spend-policy, the payer and the journal.
 *
 * Runner: node:test (nostr-tools is ESM-only under jest). The live run
 * against `sidestr:dreamlab` is scripts/activation/adr-2097-acceptance.mjs.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Fastify = require('../../management-api/node_modules/fastify');
const { getPublicKey } = require('../../management-api/node_modules/nostr-tools');
const chainPayments = require('../../management-api/routes/chain-payments');
const spendKeys = require('../../management-api/lib/sidestr-spend-key');
const { buildSidestrAcceptsEntry } = require('../../management-api/lib/pay402');
const { ExecutionJournal } = require('../../management-api/lib/execution-journal');
const { createPaymentsStore } = require('../../management-api/lib/sidestr-payments-store');
const uris = require('../../management-api/lib/uris');

const logger = { debug() {}, info() {}, warn() {}, error() {}, child() { return this; } };
// Every case runs on both estate chains: SIDESTR_CHAIN=dreamlab-txbt4 (the SC1
// demo chain, default here) and dreamlab. Stubs only: the txbt4 chain mints
// nothing and the estate holds no post-fork txbt4 coins yet.
const NAME = process.env.SIDESTR_TEST_CHAIN || 'dreamlab-txbt4';
const DOC = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config', 'sidechain', NAME, 'chain.json'), 'utf8'));
const CHAIN = `sidestr:${NAME}`;
const PREFIX = DOC.addressPrefix;
const TXID = 'ab'.repeat(32);
const BLOCK = 'cd'.repeat(32);
const PAYER_SK = '11'.repeat(32);
const PAYEE_SK = '33'.repeat(32);
const APPROVER_SK = '44'.repeat(32);
const PAYER = getPublicKey(Buffer.from(PAYER_SK, 'hex'));
const PAYEE = getPublicKey(Buffer.from(PAYEE_SK, 'hex'));
const APPROVER = getPublicKey(Buffer.from(APPROVER_SK, 'hex'));
const fakeAddress = (pk) => `${PREFIX}1p${'q'.repeat(52)}${pk.slice(0, 6).replace(/[^02-9ac-hj-np-z]/g, 'q')}`;

function rail(over = {}) {
  return { enabled: true, chain_id: CHAIN, producer_url: 'http://producer.test', max_sats_per_payment: 2000, max_sats_per_day: 10000, approval_threshold_sats: 1000, settle_timeout_s: 2, ...over };
}

function setup({ railOver = {}, price = 1000, doc = DOC, plane = 'live', offerChain = CHAIN, addressFor } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-pay-'));
  const mkId = (sk, name) => {
    const keyPath = path.join(dir, `agent-did-${name}.key`);
    fs.writeFileSync(keyPath, `${sk}\n`, { mode: 0o600 });
    return { pubkey: getPublicKey(Buffer.from(sk, 'hex')), keyPath };
  };
  const payer = spendKeys.loadOrMintSpend({ identity: mkId(PAYER_SK, 'payer'), chainId: CHAIN, identityDir: dir });
  const payeeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-payee-'));
  const payeeIdPath = path.join(payeeDir, 'agent-did-payee.key');
  fs.writeFileSync(payeeIdPath, `${PAYEE_SK}\n`, { mode: 0o600 });
  const payee = spendKeys.loadOrMintSpend({ identity: { pubkey: PAYEE, keyPath: payeeIdPath }, chainId: CHAIN });

  const state = { sends: 0, retries: [], paid: false, events: [], tip: 950, checkpoints: [] };
  const memo = uris.mint({ kind: 'receipt', pubkey: PAYEE, payload: { price, n: Math.random() } });
  const entry = offerChain === CHAIN
    ? buildSidestrAcceptsEntry({ chainId: CHAIN, address: fakeAddress(payee.spendPubkey), pubkey: payee.spendPubkey, amountSats: price, memo, payTo: `did:nostr:${PAYEE}`, binding: payee.binding })
    : { scheme: 'sidestr', chain_id: offerChain, address: fakeAddress(payee.spendPubkey), pubkey: payee.spendPubkey, amount_sats: price, memo };
  const json = (status, body) => ({ status, ok: status < 400, headers: new Headers({ 'content-type': 'application/json' }), text: async () => JSON.stringify(body), json: async () => body });

  const fetch = async (url, init = {}) => {
    const u = String(url);
    if (u === 'http://producer.test/chain.json') return json(200, doc);
    if (u === 'http://producer.test/tip') return json(200, { height: state.tip, hash: BLOCK, time: 1790972000 });
    if (u === 'http://producer.test/checkpoints.json') return json(200, { checkpoints: state.checkpoints });
    if (u.startsWith('http://producer.test/coins/5120' + payee.spendPubkey)) return json(200, state.paid ? [{ outpoint: `${TXID}:0`, value: price, height: 950, coinbase: false }] : []);
    if (u.startsWith('http://producer.test/coins/5120' + payer.spendPubkey)) return json(200, [{ outpoint: `${'12'.repeat(32)}:1`, value: 1845, height: 950, coinbase: false }, { outpoint: `${'34'.repeat(32)}:0`, value: 500, height: 951, coinbase: false }]);
    if (u.startsWith('http://producer.test/coins/')) return json(200, []);
    if (u === 'http://producer.test/blocks.json') return json(200, { network: CHAIN, blocks: [{ height: 949, hash: 'ee'.repeat(32) }, { height: 950, hash: BLOCK }] });
    if (u === 'http://payee.test/thing') {
      const h = new Headers(init.headers || {});
      if (h.get('x-sidestr-payment')) { state.retries.push(h.get('x-sidestr-payment')); return json(200, { ok: true, thing: 42 }); }
      return json(402, { error: 'payment-required', accepts: [entry] });
    }
    if (u === 'http://free.test/') return json(200, { free: true });
    throw new Error(`unexpected fetch ${u}`);
  };
  const agent = {
    async address({ who }) { const a = addressFor ? addressFor(who) : fakeAddress(who); return { pubkey: who, address: a, script: `5120${who}`, did: `did:nostr:${who}` }; },
    async send({ to, amountSats, keyFile }) {
      state.sends += 1;
      assert.equal(keyFile, payer.spendKeyPath, 'pays with the spend key, never the identity key');
      assert.equal(to, entry.address);
      state.paid = true;
      return { cmd: 'send', chain: CHAIN, txid: TXID, event: 'ef'.repeat(32), amount: amountSats, fee: 154, posted: { txid: TXID, fee: 154, dup: false }, relaysOk: 3, relays: 3 };
    },
  };
  const journal = new ExecutionJournal({ eventsAdapter: { dispatch: async (e) => { state.events.push(e.payload); } } });
  const getPlane = () => (plane === 'live' ? { ready: true, journal } : { ready: false, reason: 'test: no events adapter' });
  const store = createPaymentsStore({ file: path.join(dir, 'payments.json') });
  return { dir, payeeDir, payer, payee, state, fetch, agent, getPlane, store, entry, manifest: { sidechain: { enabled: true, announce_mirror: 'https://dreamlab-ai.github.io/sidestr-dreamlab', 'dreamlab-txbt4': { enabled: false, port: 3451, announce_mirror: 'https://dreamlab-ai.github.io/sidestr-dreamlab-txbt4' } }, payments: { consumer: { enabled: false, max_sats_per_call: 100, approval_threshold_sats: 50 }, sidestr: rail(railOver) } } };
}

async function app(ctx) {
  const a = Fastify();
  a.addHook('preValidation', async (req) => {
    const h = req.headers['x-test-auth'];
    if (h) req.auth = JSON.parse(h);
  });
  await a.register(chainPayments, {
    logger, manifest: ctx.manifest, fetch: ctx.fetch, agent: ctx.agent, store: ctx.store,
    getPlane: ctx.getPlane, identityDir: ctx.dir, mintAtBoot: false, intervalMs: 10,
  });
  await a.ready();
  return a;
}

const nip98 = (pk) => JSON.stringify({ mode: 'nip98', pubkey: pk });
const pay = (a, body = { url: 'http://payee.test/thing' }, pk = PAYER) =>
  a.inject({ method: 'POST', url: '/v1/chain/pay', headers: { 'x-test-auth': nip98(pk) }, payload: body });

describe('POST /v1/chain/pay', () => {
  let ctx; let a;
  afterEach(async () => {
    if (a) await a.close();
    for (const d of [ctx && ctx.dir, ctx && ctx.payeeDir]) if (d) fs.rmSync(d, { recursive: true, force: true });
    a = null;
  });

  test('pays a 1,000-sat sidestr 402 and retries with a receipt citing the txid and block', async () => {
    ctx = setup(); a = await app(ctx);
    const res = await pay(a);
    assert.equal(res.statusCode, 200, res.body);
    const out = res.json();
    assert.equal(out.paid, true);
    assert.deepEqual(out.response, { status: 200, body: { ok: true, thing: 42 } });
    const p = out.payment;
    assert.equal(p.status, 'settled');
    assert.equal(p.settled, true);
    assert.equal(p.txid, TXID);
    assert.equal(p.block_hash, BLOCK);
    assert.equal(p.block_height, 950);
    assert.equal(p.amount_sats, 1000);
    assert.equal(p.payer, `did:nostr:${PAYER}`);
    assert.equal(p.payee, `did:nostr:${PAYEE}`, 'payee DID verified through its 38420 binding');
    assert.match(p.receipt_urn, new RegExp(`^urn:agentbox:receipt:${PAYER}:sha256-12-[0-9a-f]{12}$`));
    assert.equal(ctx.state.retries.length, 1);
    assert.match(ctx.state.retries[0], new RegExp(`^txid=${TXID}; memo=urn:agentbox:receipt:${PAYEE}:`));

    const list = await a.inject({ method: 'GET', url: '/v1/chain/payments' });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().chain, CHAIN);
    assert.deepEqual(list.json().payments[0], p);
  });

  test('journals each side effect as a tool.called/tool.completed pair under the payment URN', async () => {
    ctx = setup(); a = await app(ctx);
    const p = (await pay(a)).json().payment;
    const ev = ctx.state.events.filter((e) => e.session_urn === p.payment_urn);
    const called = ev.filter((e) => e.type === 'tool.called');
    const completed = ev.filter((e) => e.type === 'tool.completed');
    assert.deepEqual(called.map((e) => e.payload.tool), ['sidestr.send', 'sidestr.settle', 'http.retry']);
    assert.equal(completed.length, 3);
    for (const c of called) assert.equal(completed.filter((d) => d.causation === c.event_id).length, 1);
    assert.equal(completed[0].payload.result.txid, TXID);
    assert.equal(completed[1].payload.result.block_hash, BLOCK);
    assert.ok(!JSON.stringify(ev).includes(fs.readFileSync(ctx.payer.spendKeyPath, 'utf8').trim()), 'no key material in the journal');
  });

  test('refuses above max_sats_per_payment and signs nothing', async () => {
    ctx = setup({ price: 2500 }); a = await app(ctx);
    const res = await pay(a);
    assert.equal(res.statusCode, 402);
    assert.deepEqual(res.json(), { error: 'exceeds-per-call-cap' });
    assert.equal(ctx.state.sends, 0);
  });

  test('refuses past max_sats_per_day, counted from the persisted record', async () => {
    ctx = setup({ railOver: { max_sats_per_day: 2500 } }); a = await app(ctx);
    assert.equal((await pay(a)).statusCode, 200);
    ctx.state.paid = false;
    assert.equal((await pay(a)).statusCode, 200);
    const third = await pay(a);
    assert.equal(third.statusCode, 402);
    assert.deepEqual(third.json(), { error: 'daily-budget-exceeded' });
    assert.equal(ctx.state.sends, 2);
  });

  test('parks above approval_threshold_sats; only an allowlisted approver who is not the payer releases it', async () => {
    const saved = process.env.AGENTBOX_APPROVAL_ALLOWLIST;
    process.env.AGENTBOX_APPROVAL_ALLOWLIST = `${APPROVER},${PAYER}`;
    try {
      ctx = setup({ price: 1500 }); a = await app(ctx);
      const parked = await pay(a);
      assert.equal(parked.statusCode, 202);
      const p = parked.json().payment;
      assert.equal(p.status, 'pending-approval');
      assert.equal(ctx.state.sends, 0);
      const decide = (auth, decision = 'approve') => a.inject({ method: 'POST', url: `/v1/chain/payments/${p.id}/decide`, headers: { 'x-test-auth': auth }, payload: { decision } });
      assert.equal((await decide(JSON.stringify({ mode: 'bearer' }))).statusCode, 401);
      assert.equal((await decide(nip98('55'.repeat(32)))).statusCode, 403);
      const own = await decide(nip98(PAYER));
      assert.equal(own.statusCode, 403);
      assert.equal(own.json().error, 'payer-cannot-approve-own-payment');
      const ok = await decide(nip98(APPROVER));
      assert.equal(ok.statusCode, 200, ok.body);
      assert.equal(ok.json().payment.status, 'settled');
      assert.equal(ctx.state.sends, 1);
      assert.equal((await decide(nip98(APPROVER))).statusCode, 409);
    } finally {
      if (saved === undefined) delete process.env.AGENTBOX_APPROVAL_ALLOWLIST; else process.env.AGENTBOX_APPROVAL_ALLOWLIST = saved;
    }
  });

  test('a denied payment is never signed', async () => {
    const saved = process.env.AGENTBOX_APPROVAL_ALLOWLIST;
    process.env.AGENTBOX_APPROVAL_ALLOWLIST = APPROVER;
    try {
      ctx = setup({ price: 1500 }); a = await app(ctx);
      const p = (await pay(a)).json().payment;
      const res = await a.inject({ method: 'POST', url: `/v1/chain/payments/${p.id}/decide`, headers: { 'x-test-auth': nip98(APPROVER) }, payload: { decision: 'deny' } });
      assert.equal(res.json().payment.status, 'denied');
      assert.equal(ctx.state.sends, 0);
    } finally {
      if (saved === undefined) delete process.env.AGENTBOX_APPROVAL_ALLOWLIST; else process.env.AGENTBOX_APPROVAL_ALLOWLIST = saved;
    }
  });

  test('no payment proceeds unjournalled', async () => {
    ctx = setup({ plane: 'down' }); a = await app(ctx);
    const res = await pay(a);
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().error, 'journal-unavailable');
    assert.equal(ctx.state.sends, 0);
  });

  test('a NIP-98 caller cannot pay as another DID', async () => {
    ctx = setup(); a = await app(ctx);
    const res = await pay(a, { url: 'http://payee.test/thing', payer_did: `did:nostr:${APPROVER}` });
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error, 'payer-mismatch');
  });

  test('a caller without a spend key cannot pay', async () => {
    ctx = setup(); a = await app(ctx);
    const res = await pay(a, undefined, APPROVER);
    assert.equal(res.statusCode, 403);
    assert.equal(res.json().error, 'no-spend-key');
  });

  test('an offer on an uncompiled chain is refused before policy', async () => {
    ctx = setup({ offerChain: 'sidestr:mainnet-reserve' }); a = await app(ctx);
    const res = await pay(a);
    assert.equal(res.statusCode, 402);
    assert.deepEqual(res.json(), { error: 'offer-not-payable', scheme: 'unknown', reason: 'sidestr-chain-refused' });
    assert.equal(ctx.state.sends, 0);
  });

  test('a producer serving another chain trips the guard and nothing is signed', async () => {
    ctx = setup({ doc: { ...DOC, genesisHash: '00'.repeat(32) } }); a = await app(ctx);
    const res = await pay(a);
    assert.equal(res.statusCode, 502);
    assert.equal(res.json().payment.status, 'failed');
    assert.match(res.json().payment.error, /chain guard/);
    assert.equal(ctx.state.sends, 0);
  });

  test('an offer whose address does not encode its pubkey is refused', async () => {
    ctx = setup({ addressFor: () => `${PREFIX}1p${'z'.repeat(58)}` }); a = await app(ctx);
    const res = await pay(a);
    assert.equal(res.statusCode, 502);
    assert.match(res.json().payment.error, /does not encode/);
    assert.equal(ctx.state.sends, 0);
  });

  test('a target that does not answer 402 is passed through unpaid', async () => {
    ctx = setup(); a = await app(ctx);
    const res = await pay(a, { url: 'http://free.test/' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { paid: false, response: { status: 200, body: { free: true } } });
  });
});

describe('rail gate and read routes', () => {
  let ctx; let a;
  afterEach(async () => {
    if (a) await a.close();
    for (const d of [ctx && ctx.dir, ctx && ctx.payeeDir]) if (d) fs.rmSync(d, { recursive: true, force: true });
  });

  test('GET /v1/chain/sessions is an empty list for now', async () => {
    ctx = setup(); a = await app(ctx);
    const res = await a.inject({ method: 'GET', url: '/v1/chain/sessions' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { schema: 'agentbox.chain.sessions/1', chain: CHAIN, sessions: [] });
  });

  test('GET /v1/chain/payments follows agentbox.chain.payments/1 (the VisionClaw contract)', async () => {
    ctx = setup(); a = await app(ctx);
    const paid = (await pay(a)).json().payment;
    ctx.state.checkpoints = [{ height: 950, hash: BLOCK, parentTxid: 'aa'.repeat(32), at: 1790972100, parentHeight: null, confirmations: 0 }];
    const res = await a.inject({ method: 'GET', url: '/v1/chain/payments' });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.deepEqual(Object.keys(body), ['schema', 'chain', 'mirror_url', 'tip', 'checkpoint', 'payments', 'balances']);
    assert.equal(body.schema, 'agentbox.chain.payments/1');
    assert.equal(body.chain, CHAIN);
    assert.equal(body.mirror_url, `https://dreamlab-ai.github.io/sidestr-${NAME}`);
    assert.deepEqual(body.tip, { height: 950, hash: BLOCK });
    assert.deepEqual(body.checkpoint, { parent: DOC.parent, txid: 'aa'.repeat(32), height: null, covers_height: 950 });
    const row = body.payments[0];
    assert.deepEqual(Object.keys(row).slice(0, 8), ['txid', 'payer', 'payee', 'amount_sats', 'block_height', 'block_hash', 'settled', 'time']);
    assert.deepEqual({ txid: row.txid, payer: row.payer, payee: row.payee, amount_sats: row.amount_sats, block_height: row.block_height, block_hash: row.block_hash, settled: row.settled, time: row.time },
      { txid: TXID, payer: `did:nostr:${PAYER}`, payee: `did:nostr:${PAYEE}`, amount_sats: 1000, block_height: 950, block_hash: BLOCK, settled: true, time: paid.time });
    assert.deepEqual(body.balances, [
      { did: `did:nostr:${PAYER}`, settled_sats: 1845, fold_height: 950 },
      { did: `did:nostr:${PAYEE}`, settled_sats: 1000, fold_height: 950 },
    ], 'confirmed coins at or below the tip only (the height-951 coin is not counted)');
  });

  test('a payment above the tip reads unsettled; a producer outage leaves tip and balances empty', async () => {
    ctx = setup(); a = await app(ctx);
    await pay(a);
    assert.equal((await a.inject({ method: 'GET', url: '/v1/chain/payments' })).json().tip.height, 950);
    ctx.state.tip = 949;
    let body = (await a.inject({ method: 'GET', url: '/v1/chain/payments' })).json();
    // cached for 5 s: the first read already saw tip 950
    assert.equal(body.tip.height, 950);
    await a.close();
    a = await app(ctx);
    body = (await a.inject({ method: 'GET', url: '/v1/chain/payments' })).json();
    assert.equal(body.tip.height, 949);
    assert.equal(body.payments[0].settled, false);
    ctx.fetch = async () => { throw new Error('producer down'); };
    await a.close();
    a = await app(ctx);
    body = (await a.inject({ method: 'GET', url: '/v1/chain/payments' })).json();
    assert.equal(body.tip, null);
    assert.deepEqual(body.balances, []);
    assert.equal(body.payments[0].settled, true, 'falls back to the stored inclusion');
  });

  test('every route answers 503 with [payments.sidestr] off', async () => {
    ctx = setup({ railOver: { enabled: false } }); a = await app(ctx);
    for (const [method, url, payload] of [
      ['POST', '/v1/chain/pay', { url: 'http://payee.test/thing' }],
      ['POST', '/v1/chain/payments/x/decide', { decision: 'approve' }],
      ['GET', '/v1/chain/payments'],
      ['GET', '/v1/chain/sessions'],
    ]) {
      const res = await a.inject({ method, url, payload, headers: { 'x-test-auth': nip98(PAYER) } });
      assert.equal(res.statusCode, 503, `${method} ${url}`);
      assert.equal(res.json().gate, 'payments.sidestr.enabled');
    }
    assert.equal(ctx.state.sends, 0);
  });
});
