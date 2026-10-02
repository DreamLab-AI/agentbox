'use strict';

/**
 * sidestr-payee — the selling side of the sidestr rail (ADR-2097 D3, amended
 * 2026-10-02): issue a 402 whose accepts[] names this agent's spend key and a
 * fresh receipt URN, then redeem a paid retry by finding the payment on chain.
 *
 *   const payee = createPayee({ rail, did, spend, agent, producer });
 *   const challenge = await payee.challenge({ resource: '/thing', amountSats: 1000 });
 *   // → { status: 402, headers, body: { error, accepts: [ sidestr entry ] } }
 *   const r = await payee.redeem(req.headers['x-sidestr-payment'], { resource: '/thing' });
 *   // → { ok: true, txid, blockHash, height, memo } | { ok: false, reason }
 *
 * A memo (urn:agentbox:receipt:<payee hex>:sha256-12-…) is minted per charge
 * through uris.js and redeems once, for one txid; a txid redeems one memo.
 * Redemption trusts only the payee's own producer (rail.producer_url), whose
 * chain document must pass the same guard the payer runs.
 */

const crypto = require('crypto');
const uris = require('./uris');
const { buildSidestrAcceptsEntry } = require('./pay402');
const { guardChain, parsePaymentHeader, waitForInclusion } = require('./sidestr-rail');

/**
 * @param {object} opts
 * @param {object} opts.rail      - railConfig() of the payee (enabled)
 * @param {string} opts.did       - the payee's did:nostr
 * @param {object} opts.spend     - { spendPubkey, binding } (loadOrMintSpend)
 * @param {object} opts.agent     - createSidestrAgent()
 * @param {object} opts.producer  - createProducer(rail.producer_url)
 * @param {function} [opts.now]   - () => Date
 */
function createPayee({ rail, did, spend, agent, producer, now = () => new Date() }) {
  const m = /^did:nostr:([0-9a-f]{64})$/.exec(did || '');
  if (!m) throw new Error('sidestr-payee: did must be did:nostr:<hex>');
  const didHex = m[1];
  const issued = new Map(); // memo → { resource, amountSats, txid|null }
  const spentTxids = new Set();
  let names = null;

  async function myNames() {
    if (names) return names;
    guardChain(await producer.chainDocument(), rail.chain_id);
    const a = await agent.address({ url: rail.producer_url, who: spend.spendPubkey });
    if (!a || a.pubkey !== spend.spendPubkey || !/^5120[0-9a-f]{64}$/.test(a.script || '')) {
      throw new Error('sidestr-payee: sidestr-agent did not name the spend key');
    }
    names = { address: a.address, script: a.script };
    return names;
  }

  return {
    async challenge({ resource, amountSats }) {
      const { address } = await myNames();
      const memo = uris.mint({
        kind: 'receipt',
        pubkey: didHex,
        payload: { type: 'sidestr-charge', chain_id: rail.chain_id, resource, amount_sats: amountSats, nonce: crypto.randomBytes(16).toString('hex'), issued_at: now().toISOString() },
      });
      issued.set(memo, { resource, amountSats, txid: null });
      const entry = buildSidestrAcceptsEntry({
        chainId: rail.chain_id, address, pubkey: spend.spendPubkey, amountSats, memo,
        payTo: did, binding: spend.binding,
      });
      return {
        status: 402,
        headers: { 'content-type': 'application/json' },
        body: { error: 'payment-required', message: `This resource costs ${amountSats} sats on ${rail.chain_id}.`, accepts: [entry] },
      };
    },

    async redeem(headerValue, { resource, timeoutMs = 30000, intervalMs = 2000 } = {}) {
      const p = parsePaymentHeader(headerValue);
      if (!p) return { ok: false, reason: 'no-payment-header' };
      const charge = issued.get(p.memo);
      if (!charge) return { ok: false, reason: 'unknown-memo' };
      if (resource !== undefined && charge.resource !== resource) return { ok: false, reason: 'memo-for-another-resource' };
      if (charge.txid && charge.txid !== p.txid) return { ok: false, reason: 'memo-already-redeemed' };
      if (!charge.txid && spentTxids.has(p.txid)) return { ok: false, reason: 'txid-already-redeemed' };
      const { script } = await myNames();
      const inc = await waitForInclusion({ producer, script, txid: p.txid, minValue: charge.amountSats, timeoutMs, intervalMs });
      if (!inc) return { ok: false, reason: 'payment-not-found' };
      charge.txid = p.txid;
      spentTxids.add(p.txid);
      return { ok: true, txid: p.txid, blockHash: inc.blockHash, height: inc.height, memo: p.memo, receiptUrn: p.receiptUrn };
    },
  };
}

module.exports = { createPayee };
