'use strict';

/**
 * The sidestr payment rail's HTTP surface (ADR-2097, amended 2026-10-02;
 * ADR-2098 D5 read routes). Owner decision 2026-10-02, SC2: a payment is one
 * sidechain transaction.
 *
 *   POST /v1/chain/pay                    fetch a URL; on a sidestr 402, pay it and
 *                                         retry with the receipt. Spend-policy (rail
 *                                         mode) runs here and on no other route.
 *   POST /v1/chain/payments/:id/decide    release or deny a parked payment
 *                                         (NIP-98, approval allowlist, never the payer)
 *   GET  /v1/chain/payments               the payer-side record, for VisionClaw
 *   GET  /v1/chain/sessions               Hitch sessions: [] until S2's host lands
 *
 * Auth is the global NIP-98/bearer preValidation hook (server.js); nothing
 * here is on its skip list. The paying identity is the NIP-98 signer, or for
 * the operator bearer the body's `payer_did` (default AGENTBOX_AGENT_DID); a
 * NIP-98 caller naming another payer is refused before policy (ADR-2098 D5).
 * The payer's spend key must already exist (minted at spawn); this route
 * never mints one for a caller.
 *
 * Pay pipeline (preHandlers, then handler):
 *   1. resolveOffer  rail on, journal live, payer has a spend key, target
 *                    answered 402 with a payable sidestr offer → paymentContext
 *   2. spendPolicy   [payments.sidestr] caps, daily budget per payer (persisted
 *                    through the payments store), approval threshold
 *   3. handler       park (202) above the threshold, else pay → retry
 *
 * Self-gating: every route answers 503 when [payments.sidestr] is off.
 */

const { classify } = require('../lib/pay402');
const { spendPolicy } = require('../middleware/spend-policy');
const { resolveSidestr } = require('../middleware/consumer-payer');
const { railConfig, createProducer, journalled, PAYMENT_HEADER, formatPaymentHeader } = require('../lib/sidestr-rail');
const { createPaymentsStore } = require('../lib/sidestr-payments-store');
const { createSidestrAgent } = require('../lib/sidestr-agent-cli');
const spendKeys = require('../lib/sidestr-spend-key');
const authz = require('../lib/authz');
const uris = require('../lib/uris');

const BODY_CAP = 64 * 1024;
const DID_RE = /^did:nostr:([0-9a-f]{64})$/;
const DROP_PERSISTED = new Set(['authorization', 'cookie', 'proxy-authorization']);
const DROP_OUTBOUND = new Set(['host', 'content-length', 'connection', 'transfer-encoding', PAYMENT_HEADER]);

/**
 * One payment row. The first eight fields are the contract VisionClaw renders
 * (agentbox.chain.payments/1, agreed with S5 on 2026-10-02); the rest are the
 * payer-side record. `settled` is inclusion at or below `tipHeight` when the
 * tip is known.
 */
function view(r, tipHeight) {
  const included = r.settled === true && Number.isInteger(r.block_height);
  return {
    txid: r.txid || null,
    payer: r.payer_did,
    payee: r.payee_did || null,
    amount_sats: r.amount_sats,
    block_height: r.block_height ?? null,
    block_hash: r.block_hash || null,
    settled: included && (!Number.isInteger(tipHeight) || r.block_height <= tipHeight),
    time: r.settled_at || r.created_at,
    id: r.id,
    status: r.status,
    chain_id: r.chain_id,
    payee_pubkey: r.payee_pubkey,
    payee_address: r.payee_address,
    fee_sats: r.fee_sats ?? null,
    memo: r.memo,
    payment_urn: r.payment_urn,
    receipt_urn: r.receipt_urn || null,
    url: r.url,
    response_status: r.response_status ?? null,
    error: r.error || null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    settled_at: r.settled_at || null,
  };
}

async function readCapped(res) {
  const text = await res.text();
  return text.length > BODY_CAP ? text.slice(0, BODY_CAP) : text;
}

function parseMaybeJson(text) {
  try { return JSON.parse(text); } catch { return text; }
}

async function chainPaymentsRoutes(fastify, options = {}) {
  const { manifest = {} } = options;
  const logger = options.logger || fastify.log;
  const rail = railConfig(manifest);
  const fetchFn = options.fetch || globalThis.fetch;
  const store = options.store || createPaymentsStore();
  const agent = options.agent || createSidestrAgent();
  const producer = rail.enabled ? (options.producer || createProducer(rail.producer_url, { fetch: fetchFn })) : null;
  const getPlane = options.getPlane || (() => require('../lib/action-plane').getActionPlane({ logger }));
  const identityDir = options.identityDir;
  const verifyEvent = options.verifyEvent || spendKeys.verifyEventFresh;
  const intervalMs = options.intervalMs;
  const reservations = new Map(); // payer did → sats reserved by the policy, not yet in the store

  // The container agent's k_spend is minted beside its k_id when the rail is
  // on (its spawn is this process's boot); AoE agents get theirs at session
  // create (routes/sessions-boundary.js). Fail-open: no key, no payments.
  if (rail.enabled && options.mintAtBoot !== false) {
    try {
      const identity = require('../lib/agent-identity').loadOrMint();
      if (identity && identity.persisted) {
        const s = spendKeys.loadOrMintSpend({ identity, chainId: rail.chain_id });
        logger.info({ did: s.did, spend_pubkey: s.spendPubkey, minted: s.minted, binding: s.binding.id }, 'sidestr rail: spend key ready');
        spendKeys.publishBinding(s.binding, rail.relays).then(
          (r) => logger.debug({ binding: s.binding.id, ...r }, 'sidestr rail: binding published'),
          () => {},
        );
      }
    } catch (err) {
      logger.warn({ err: err.message }, 'sidestr rail: could not ready the agent spend key');
    }
  }

  function disabled(reply) {
    return reply.code(503).send({ error: 'sidestr rail disabled', gate: 'payments.sidestr.enabled', reason: rail.reason });
  }

  function payerOf(request) {
    const auth = request.auth || {};
    const asked = request.body && request.body.payer_did;
    if (auth.mode === 'nip98') {
      const own = `did:nostr:${String(auth.pubkey || '').toLowerCase()}`;
      if (asked && asked !== own) return { error: 'payer-mismatch' };
      return { did: own };
    }
    const did = asked || process.env.AGENTBOX_AGENT_DID || null;
    return DID_RE.test(did || '') ? { did } : { error: 'payer-unknown' };
  }

  function release(did, sats) {
    const left = (reservations.get(did) || 0) - sats;
    if (left > 0) reservations.set(did, left); else reservations.delete(did);
  }

  const policyHook = spendPolicy(manifest, {
    rail: 'sidestr',
    keyOf: (req) => req.payerDid,
    spentToday: (did) => store.spentToday(did, rail.chain_id) + (reservations.get(did) || 0),
    reserve: (did, sats) => reservations.set(did, (reservations.get(did) || 0) + sats),
  });

  async function resolveOffer(request, reply) {
    if (!rail.enabled) return disabled(reply);
    const plane = getPlane();
    if (!plane || !plane.ready || !plane.journal) {
      return reply.code(503).send({ error: 'journal-unavailable', message: 'No payment proceeds unjournalled (ADR-2071)' });
    }
    request.plane = plane;
    const payer = payerOf(request);
    if (payer.error) return reply.code(403).send({ error: payer.error });
    request.payerDid = payer.did;
    const spendKey = spendKeys.findSpendKey({ didHex: DID_RE.exec(payer.did)[1], chainId: rail.chain_id, identityDir });
    if (!spendKey) return reply.code(403).send({ error: 'no-spend-key', message: `${payer.did} has no spend key on ${rail.chain_id}` });
    request.spendKey = spendKey;

    const b = request.body;
    const method = (b.method || 'GET').toUpperCase();
    const headers = {};
    for (const [k, v] of Object.entries(b.headers || {})) {
      if (!DROP_OUTBOUND.has(k.toLowerCase()) && typeof v === 'string') headers[k] = v;
    }
    request.target = { url: b.url, method, headers, body: typeof b.body === 'string' ? b.body : undefined };

    let res;
    try {
      res = await fetchFn(b.url, { method, headers, body: request.target.body, signal: AbortSignal.timeout(15000), redirect: 'manual' });
    } catch (err) {
      return reply.code(502).send({ error: 'target-unreachable', message: err.message });
    }
    const text = await readCapped(res);
    if (res.status !== 402) {
      request.noPaymentNeeded = { status: res.status, body: parseMaybeJson(text) };
      return undefined;
    }
    const c = classify({ status: 402, headers: res.headers, body: text }, {
      rails: { sidestr: { enabled: true, chain_id: rail.chain_id } }, verifyEvent,
    });
    if (c.scheme !== 'sidestr' || !c.payable) {
      return reply.code(402).send({ error: 'offer-not-payable', scheme: c.scheme, reason: c.reason });
    }
    if (Number.isInteger(b.max_sats) && c.offer.amount_sats > b.max_sats) {
      return reply.code(402).send({ error: 'offer-exceeds-max-sats', amount_sats: c.offer.amount_sats, max_sats: b.max_sats });
    }
    request.offer = c.offer;
    request.paymentContext = { cost_sats: c.offer.amount_sats };
    return undefined;
  }

  async function policyUnlessFree(request, reply) {
    if (request.noPaymentNeeded) return undefined;
    return policyHook(request, reply);
  }

  async function retry(rec, plane) {
    const t = rec.target;
    return journalled(plane.journal, { session_urn: rec.payment_urn, agent_did: rec.payer_did }, 'http.retry',
      { url: t.url, method: t.method },
      async () => {
        const res = await fetchFn(t.url, {
          method: t.method,
          headers: { ...t.headers, [PAYMENT_HEADER]: formatPaymentHeader({ txid: rec.txid, memo: rec.memo, receiptUrn: rec.receipt_urn }) },
          body: t.body, signal: AbortSignal.timeout(60000), redirect: 'manual',
        });
        return { status: res.status, body: parseMaybeJson(await readCapped(res)) };
      });
  }

  async function execute(rec, plane, transientHeaders) {
    const spendKey = spendKeys.findSpendKey({ didHex: DID_RE.exec(rec.payer_did)[1], chainId: rail.chain_id, identityDir });
    if (!spendKey) return store.update(rec.id, { status: 'failed', error: 'no-spend-key' });
    store.update(rec.id, { status: 'paying' });
    const r = await resolveSidestr(rec.offer, {
      rail, payerDid: rec.payer_did, spendKey, paymentUrn: rec.payment_urn, journal: plane.journal,
      agent, producer, logger, intervalMs,
      onBroadcast: (s) => store.update(rec.id, { status: 'broadcast', txid: s.txid, fee_sats: s.fee, event_id: s.event }),
    });
    if (r.outcome === 'failed') return { rec: store.update(rec.id, { status: 'failed', error: r.error }) };
    if (r.outcome === 'broadcast') return { rec: store.update(rec.id, { status: 'broadcast', error: r.error }) };
    let paid = store.update(rec.id, {
      status: 'settled', settled: true, settled_at: new Date().toISOString(),
      block_hash: r.blockHash, block_height: r.blockHeight, receipt_urn: r.receiptUrn, fee_sats: r.fee,
    });
    let response = null;
    try {
      const target = transientHeaders ? { ...paid.target, headers: { ...paid.target.headers, ...transientHeaders } } : paid.target;
      response = await retry({ ...paid, target }, plane);
      paid = store.update(rec.id, { response_status: response.status });
    } catch (err) {
      paid = store.update(rec.id, { error: `paid, retry failed: ${err.message}` });
    }
    return { rec: paid, response };
  }

  fastify.post('/v1/chain/pay', {
    schema: {
      description: 'Fetch a URL; on a sidestr 402 within policy, pay it on the configured chain and retry with the receipt (ADR-2097).',
      tags: ['chain'],
      body: {
        type: 'object',
        required: ['url'],
        additionalProperties: false,
        properties: {
          url: { type: 'string', pattern: '^https?://', maxLength: 2048 },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'get', 'post', 'put'] },
          headers: { type: 'object', additionalProperties: { type: 'string' } },
          body: { type: 'string', maxLength: 16384 },
          max_sats: { type: 'integer', minimum: 1 },
          payer_did: { type: 'string', pattern: DID_RE.source },
        },
      },
    },
    preHandler: [resolveOffer, policyUnlessFree],
  }, async (request, reply) => {
    if (request.noPaymentNeeded) return reply.send({ paid: false, response: request.noPaymentNeeded });
    const offer = request.offer;
    const payerHex = DID_RE.exec(request.payerDid)[1];
    const t = request.target;
    const persistedHeaders = {};
    const transientHeaders = {};
    for (const [k, v] of Object.entries(t.headers)) (DROP_PERSISTED.has(k.toLowerCase()) ? transientHeaders : persistedHeaders)[k] = v;
    const createdAt = new Date().toISOString();
    const paymentUrn = uris.mint({
      kind: 'receipt', pubkey: payerHex,
      payload: { type: 'sidestr-payment', chain_id: rail.chain_id, memo: offer.memo, payee_pubkey: offer.pubkey, amount_sats: offer.amount_sats, url: t.url, created_at: createdAt },
    });
    let rec;
    try {
      rec = store.create({
        status: request.requiresApproval ? 'pending-approval' : 'paying',
        chain_id: rail.chain_id, payer_did: request.payerDid, payer_spend_pubkey: request.spendKey.spendPubkey,
        payee_did: offer.payee_did, payee_pubkey: offer.pubkey,
        payee_address: offer.address, amount_sats: offer.amount_sats, memo: offer.memo, payment_urn: paymentUrn,
        url: t.url, offer, target: { ...t, headers: persistedHeaders },
      });
    } finally {
      release(request.payerDid, offer.amount_sats);
    }
    if (request.requiresApproval) {
      logger.info({ id: rec.id, payer: rec.payer_did, amount: rec.amount_sats }, 'sidestr rail: payment parked for approval');
      return reply.code(202).send({ paid: false, payment: view(rec) });
    }
    const out = await execute(rec, request.plane, transientHeaders);
    const ok = out.rec.status === 'settled';
    return reply.code(ok ? 200 : 502).send({ paid: ok, payment: view(out.rec), response: out.response || null });
  });

  fastify.post('/v1/chain/payments/:id/decide', {
    schema: {
      description: 'Release (approve) or deny a sidestr payment parked above approval_threshold_sats. NIP-98, approval allowlist, never the payer.',
      tags: ['chain'],
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', maxLength: 64 } } },
      body: { type: 'object', required: ['decision'], additionalProperties: false, properties: { decision: { type: 'string', enum: ['approve', 'deny'] } } },
    },
  }, async (request, reply) => {
    if (!rail.enabled) return disabled(reply);
    if (!request.auth || request.auth.mode !== 'nip98') {
      return reply.code(401).send({ error: 'nip98_required', message: 'A payment approval must be NIP-98 signed' });
    }
    const pk = String(request.auth.pubkey || '').toLowerCase();
    if (!authz.isApprover(pk, manifest)) return reply.code(403).send({ error: 'forbidden_not_approver' });
    const rec = store.get(request.params.id);
    if (!rec) return reply.code(404).send({ error: 'not-found' });
    if (rec.payer_did === `did:nostr:${pk}`) return reply.code(403).send({ error: 'payer-cannot-approve-own-payment' });
    if (rec.status !== 'pending-approval') return reply.code(409).send({ error: 'not-pending', status: rec.status });
    if (request.body.decision === 'deny') {
      return reply.send({ paid: false, payment: view(store.update(rec.id, { status: 'denied', decided_by: `did:nostr:${pk}` })) });
    }
    const plane = getPlane();
    if (!plane || !plane.ready || !plane.journal) return reply.code(503).send({ error: 'journal-unavailable' });
    store.update(rec.id, { decided_by: `did:nostr:${pk}` });
    const out = await execute(rec, plane, null);
    const ok = out.rec.status === 'settled';
    return reply.code(ok ? 200 : 502).send({ paid: ok, payment: view(out.rec), response: out.response || null });
  });

  // Chain-derived facts for the read routes: tip, last checkpoint and the
  // settled balance of each spend key, cached briefly so a polling renderer
  // does not hammer the producer. Any producer failure degrades to null.
  const CACHE_MS = 5000;
  let cache = { at: 0, key: '', value: null };
  async function chainFacts(spendKeysByDid) {
    const key = JSON.stringify(spendKeysByDid);
    if (cache.value && cache.key === key && Date.now() - cache.at < CACHE_MS) return cache.value;
    let tip = null;
    try {
      const t = await producer.tip();
      if (t && Number.isInteger(t.height) && /^[0-9a-f]{64}$/.test(t.hash || '')) tip = { height: t.height, hash: t.hash };
    } catch { tip = null; }
    let checkpoint = null;
    try {
      const ck = await producer.checkpoints();
      const last = ck && Array.isArray(ck.checkpoints) ? ck.checkpoints[ck.checkpoints.length - 1] : null;
      if (last && last.parentTxid) {
        checkpoint = { parent: rail.chain.parent, txid: last.parentTxid, height: Number.isInteger(last.parentHeight) ? last.parentHeight : null, covers_height: last.height };
      }
    } catch { checkpoint = null; }
    const balances = [];
    if (tip) {
      for (const [did, spendPubkey] of Object.entries(spendKeysByDid)) {
        try {
          const coins = await producer.coins(`5120${spendPubkey}`);
          const settled = (Array.isArray(coins) ? coins : [])
            .filter((c) => Number.isInteger(c.height) && c.height <= tip.height)
            .reduce((a, c) => a + (Number(c.value) || 0), 0);
          balances.push({ did, settled_sats: settled, fold_height: tip.height });
        } catch { /* a DID the producer cannot answer for is left out */ }
      }
    }
    const value = { tip, checkpoint, balances };
    cache = { at: Date.now(), key, value };
    return value;
  }

  fastify.get('/v1/chain/payments', {
    schema: {
      description: 'Sidestr payments made by agents on this box, with the chain tip, last checkpoint and settled balances (agentbox.chain.payments/1; ADR-2097, ADR-2098 D5).',
      tags: ['chain'],
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: { payer: { type: 'string', pattern: DID_RE.source }, limit: { type: 'integer', minimum: 1, maximum: 1000 } },
      },
    },
  }, async (request, reply) => {
    if (!rail.enabled) return disabled(reply);
    const q = request.query || {};
    const rows = store.list({ payer: q.payer, limit: q.limit || 100 }).filter((r) => r.chain_id === rail.chain_id);
    // Settled balances for every DID on either side whose spend key is known:
    // the payer's from the record (or its key file), the payee's only when its
    // 38420 binding verified (payee_did set).
    const spendByDid = {};
    for (const r of rows) {
      if (!spendByDid[r.payer_did]) {
        let pk = r.payer_spend_pubkey;
        if (!pk) {
          const k = spendKeys.findSpendKey({ didHex: DID_RE.exec(r.payer_did)[1], chainId: rail.chain_id, identityDir });
          pk = k && k.spendPubkey;
        }
        if (pk) spendByDid[r.payer_did] = pk;
      }
      if (r.payee_did && !spendByDid[r.payee_did]) spendByDid[r.payee_did] = r.payee_pubkey;
    }
    const facts = await chainFacts(spendByDid);
    return reply.send({
      schema: 'agentbox.chain.payments/1',
      chain: rail.chain_id,
      mirror_url: rail.mirror_url,
      tip: facts.tip,
      checkpoint: facts.checkpoint,
      payments: rows.map((r) => view(r, facts.tip ? facts.tip.height : null)),
      balances: facts.balances,
    });
  });

  fastify.get('/v1/chain/sessions', {
    schema: { description: 'Hitch payment sessions on the configured chain (agentbox.chain.sessions/1). Empty until the S2 Hitch host lands.', tags: ['chain'] },
  }, async (request, reply) => {
    if (!rail.enabled) return disabled(reply);
    return reply.send({ schema: 'agentbox.chain.sessions/1', chain: rail.chain_id, sessions: [] });
  });
}

module.exports = chainPaymentsRoutes;
module.exports.view = view;
