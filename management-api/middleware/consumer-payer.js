'use strict';

/**
 * middleware/consumer-payer.js -- C2 native consumer payer.
 *
 * Resolves a spend offer against the agentbox ledger (solid-pod-rs) by
 * POSTing to the deposit endpoint. Handles idempotency (409 = already
 * processed) and surfaces a typed outcome so callers can route to the
 * receipt minter (C4) without parsing HTTP status codes.
 *
 * resolveSidestr() is the sidestr rail's payer (ADR-2097 D3, amended
 * 2026-10-02): it pays a classified `sidestr` offer as one sidechain
 * transaction signed with the payer's spend key through sidestr-agent, and
 * waits for the including block. Its production caller is POST /v1/chain/pay
 * (routes/chain-payments.js), behind spend-policy in rail mode.
 *
 * @see PRD-015 §C2  @see ADR-032  @see ADR-2097
 */

const uris = require('../lib/uris');
const { guardChain, waitForInclusion, journalled } = require('../lib/sidestr-rail');

const POD_BASE = 'http://127.0.0.1:' + (process.env.SOLID_POD_PORT || 8484);

/**
 * Resolve a spend offer against the agentbox ledger.
 *
 * @param {object} offer
 * @param {number} offer.amount              - Amount in satoshis to spend
 * @param {string} [offer.deposit]           - Override deposit path or full URL
 *   (default: "/v1/pay/deposit"). When the value starts with "http" it is used
 *   as-is; otherwise it is appended to POD_BASE.
 * @param {object} ctx
 * @param {string} ctx.authHeader            - Authorization header value (NIP-98 or bearer)
 * @param {string} ctx.idempotencyKey        - Caller-supplied idempotency key
 * @param {object} [ctx.logger]              - Optional pino-compatible logger
 * @returns {Promise<{
 *   success: boolean,
 *   newBalance: number|null,
 *   error: string|null,
 *   outcome: "paid"|"failed"|"insufficient-balance"|"unknown-error"
 * }>}
 */
async function resolveAgentboxLedger(offer, { authHeader, idempotencyKey, logger } = {}) {
  const log = logger || { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

  const depositPath = offer.deposit || '/v1/pay/deposit';
  const url = depositPath.startsWith('http') ? depositPath : (POD_BASE + depositPath);

  log.debug({ url, amount_sats: offer.amount, idempotencyKey }, 'consumer-payer: resolving spend offer');

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        amount_sats: offer.amount,
        idempotency_key: idempotencyKey,
      }),
    });
  } catch (err) {
    log.error({ url, err: err.message }, 'consumer-payer: ledger unreachable');
    return { success: false, newBalance: null, error: err.message, outcome: 'unknown-error' };
  }

  // 409 Conflict = idempotency replay — treat as success (already processed)
  if (res.status === 409) {
    log.info({ url, idempotencyKey }, 'consumer-payer: idempotent replay (409)');
    return { success: true, newBalance: null, error: null, outcome: 'paid' };
  }

  // 402 Payment Required = insufficient balance
  if (res.status === 402) {
    log.warn({ url, amount_sats: offer.amount }, 'consumer-payer: insufficient balance (402)');
    return { success: false, newBalance: null, error: 'insufficient-balance', outcome: 'insufficient-balance' };
  }

  // 2xx = success
  if (res.ok) {
    let body = {};
    try {
      body = await res.json();
    } catch {
      // non-JSON body is fine; balance will be null
    }
    const newBalance = body.balance_sats ?? body.new_balance ?? null;
    log.info({ url, newBalance, idempotencyKey }, 'consumer-payer: spend accepted');
    return { success: true, newBalance, error: null, outcome: 'paid' };
  }

  // All other non-2xx
  let errBody = {};
  try {
    errBody = await res.json();
  } catch {
    // ignore parse failure
  }
  const errMsg = errBody.error || errBody.message || `ledger returned ${res.status}`;
  log.error({ url, status: res.status, errMsg }, 'consumer-payer: ledger error response');
  return { success: false, newBalance: null, error: errMsg, outcome: 'failed' };
}

/**
 * Pay a classified `sidestr` offer (pay402 classify → scheme "sidestr",
 * payable true). Every side effect is journalled as a tool.called /
 * tool.completed pair under `ctx.paymentUrn` (ADR-2071):
 *
 *   sidestr.send    sidestr-agent send <address> <sats> --post, signed with
 *                   the payer's k_spend, broadcast by POST /tx and kind 23500
 *   sidestr.settle  the payee's script holds an output of the txid in a block
 *
 * Before anything is signed: the producer's chain document must be the
 * compiled chain (guardChain), and sidestr-agent's own encoding of the offer's
 * spend key must equal the offer's address.
 *
 * @param {object} offer              - pay402 sidestr offer
 * @param {object} ctx
 * @param {object} ctx.rail           - sidestr-rail railConfig() (enabled)
 * @param {string} ctx.payerDid       - did:nostr of the paying agent
 * @param {object} ctx.spendKey       - { spendKeyPath, spendPubkey } (findSpendKey)
 * @param {string} ctx.paymentUrn     - the journal session for this payment
 * @param {object} ctx.journal        - ExecutionJournal
 * @param {object} ctx.agent          - createSidestrAgent()
 * @param {object} ctx.producer       - createProducer(rail.producer_url)
 * @param {function} [ctx.onBroadcast] - (send result) => void, for the record
 * @param {object} [ctx.logger]
 * @param {number} [ctx.intervalMs]   - inclusion poll interval
 * @returns {Promise<{success: boolean, outcome: "settled"|"broadcast"|"failed",
 *   txid: string|null, fee: number|null, event: string|null, blockHash: string|null,
 *   blockHeight: number|null, receiptUrn: string|null, error: string|null}>}
 */
async function resolveSidestr(offer, ctx) {
  const log = ctx.logger || { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  const { rail, payerDid, spendKey, paymentUrn, journal, agent, producer } = ctx;
  const base = { session_urn: paymentUrn, agent_did: payerDid };
  const failed = (error) => ({ success: false, outcome: 'failed', txid: null, fee: null, event: null, blockHash: null, blockHeight: null, receiptUrn: null, error });

  if (!offer || offer.scheme !== 'sidestr' || offer.chain_id !== rail.chain_id) return failed('offer-not-for-this-rail');
  const payerHex = /^did:nostr:([0-9a-f]{64})$/.exec(payerDid || '');
  if (!payerHex) return failed('payer-did-invalid');

  let payee;
  try {
    guardChain(await producer.chainDocument(), rail.chain_id);
    payee = await agent.address({ url: rail.producer_url, who: offer.pubkey });
  } catch (err) {
    log.warn({ err: err.message }, 'consumer-payer: sidestr pre-flight refused');
    return failed(err.message);
  }
  if (!payee || payee.address !== offer.address || !/^5120[0-9a-f]{64}$/.test(payee.script || '')) {
    return failed('offer address does not encode the offer pubkey on this chain');
  }

  let sent;
  try {
    sent = await journalled(journal, base, 'sidestr.send',
      { chain_id: rail.chain_id, to: offer.address, amount_sats: offer.amount_sats, memo: offer.memo },
      async () => {
        const r = await agent.send({ url: rail.producer_url, keyFile: spendKey.spendKeyPath, relays: rail.relays, to: offer.address, amountSats: offer.amount_sats });
        if (!r || !/^[0-9a-f]{64}$/.test(r.txid || '') || r.chain !== rail.chain_id) throw new Error('sidestr-agent send returned no txid for this chain');
        if (!r.posted || r.posted.txid !== r.txid) throw new Error('the producer did not accept the transaction');
        return { txid: r.txid, event: r.event || null, fee: r.fee ?? null, vsize: r.vsize ?? null, relays_ok: r.relaysOk ?? null, dup: !!r.posted.dup };
      });
  } catch (err) {
    log.error({ err: err.message }, 'consumer-payer: sidestr send failed');
    return failed(err.message);
  }
  if (typeof ctx.onBroadcast === 'function') ctx.onBroadcast(sent);

  let inclusion = null;
  try {
    inclusion = await journalled(journal, base, 'sidestr.settle',
      { txid: sent.txid, script: payee.script, min_value: offer.amount_sats },
      async () => {
        const inc = await waitForInclusion({
          producer, script: payee.script, txid: sent.txid, minValue: offer.amount_sats,
          timeoutMs: rail.settle_timeout_s * 1000, intervalMs: ctx.intervalMs || 2000,
        });
        if (!inc) throw new Error(`not included within ${rail.settle_timeout_s} s`);
        return { block_hash: inc.blockHash, block_height: inc.height, outpoint: inc.outpoint, value: inc.value };
      });
  } catch (err) {
    log.warn({ txid: sent.txid, err: err.message }, 'consumer-payer: sidestr payment broadcast, not yet included');
    return { success: false, outcome: 'broadcast', txid: sent.txid, fee: sent.fee, event: sent.event, blockHash: null, blockHeight: null, receiptUrn: null, error: err.message };
  }

  const receiptUrn = uris.mint({
    kind: 'receipt',
    pubkey: payerHex[1],
    payload: {
      payment_urn: paymentUrn, chain_id: rail.chain_id, txid: sent.txid,
      block_hash: inclusion.block_hash, block_height: inclusion.block_height,
      amount_sats: offer.amount_sats, payee_pubkey: offer.pubkey, payee_did: offer.payee_did || null, memo: offer.memo,
    },
  });
  log.info({ txid: sent.txid, block: inclusion.block_hash, receiptUrn }, 'consumer-payer: sidestr payment settled');
  return {
    success: true, outcome: 'settled', txid: sent.txid, fee: sent.fee, event: sent.event,
    blockHash: inclusion.block_hash, blockHeight: inclusion.block_height, receiptUrn, error: null,
  };
}

module.exports = { resolveAgentboxLedger, resolveSidestr };
