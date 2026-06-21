'use strict';

/**
 * lib/receipt-minter.js -- C4 receipt and activity URN minter.
 *
 * Mints canonical `urn:agentbox:receipt:*` and `urn:agentbox:activity:*`
 * URIs for every spend attempt so the audit trail has zero gaps. Both
 * functions are unconditionally try/catch — they MUST NOT throw under any
 * input, including missing or malformed pubkeys.
 *
 * Called on every spend path: paid, denied, failed, pending-approval.
 *
 * @see PRD-015 §C4  @see ADR-032  @see lib/uris.js
 */

const { mint } = require('./uris');
const bc20 = require('./bc20-provenance-bridge');

/**
 * Canonical outcome labels for spend attempts.
 * Use these values as the `outcome` argument to ensure URN stability.
 */
const OUTCOMES = Object.freeze({
  PAID:    'paid',
  DENIED:  'denied',
  FAILED:  'failed',
  PENDING: 'pending-approval',
});

/**
 * Mint a spend receipt URN.
 *
 * The resulting URI is content-addressed: identical inputs produce
 * the same URI, enabling idempotent audit log entries.
 *
 * @param {object} opts
 * @param {string} opts.pubkey          - Agent BIP-340 x-only pubkey hex (or did:nostr: form)
 * @param {string} opts.origin          - Originating endpoint / caller identifier
 * @param {string} opts.scheme          - Payment scheme (e.g. "sats", "dream", "free")
 * @param {number} opts.amountSats      - Amount in satoshis
 * @param {string} opts.outcome         - One of OUTCOMES values
 * @param {string} opts.idempotencyKey  - Caller-supplied idempotency key
 * @returns {string} `urn:agentbox:receipt:<pubkey>:<sha256-12-…>` or fallback error URN
 */
function mintSpendReceipt({ pubkey, origin, scheme, amountSats, outcome, idempotencyKey } = {}) {
  try {
    return mint({
      kind: 'receipt',
      pubkey,
      payload: {
        origin,
        scheme,
        amount_sats: amountSats,
        outcome,
        idempotency_key: idempotencyKey,
      },
    });
  } catch (_e) {
    return 'urn:agentbox:receipt:error:mint-failed';
  }
}

/**
 * Mint a spend activity URN.
 *
 * Records the action type as `pay-<scheme>` in the activity stream.
 * Content-addressed so the same spend event always maps to the same URI.
 *
 * @param {object} opts
 * @param {string} opts.pubkey          - Agent BIP-340 x-only pubkey hex (or did:nostr: form)
 * @param {string} opts.origin          - Originating endpoint / caller identifier
 * @param {string} opts.scheme          - Payment scheme (e.g. "sats", "dream", "free")
 * @param {number} opts.amountSats      - Amount in satoshis
 * @param {string} opts.outcome         - One of OUTCOMES values
 * @param {string} opts.idempotencyKey  - Caller-supplied idempotency key
 * @returns {string} `urn:agentbox:activity:<pubkey>:<sha256-12-…>` or fallback error URN
 */
function mintSpendActivity({ pubkey, origin, scheme, amountSats, outcome, idempotencyKey } = {}) {
  let urn;
  try {
    urn = mint({
      kind: 'activity',
      pubkey,
      payload: {
        type: 'pay-' + scheme,
        origin,
        amount_sats: amountSats,
        outcome,
        idempotency_key: idempotencyKey,
      },
    });
  } catch (_e) {
    return 'urn:agentbox:activity:error:mint-failed';
  }
  crossActivityOutbound(urn);
  return urn;
}

/**
 * Cross an activity URN outbound through BC20 so it reaches the
 * VisionClaw provenance graph (PRD-022 WS-2, ADR-127 D2.3).
 *
 * Fail-open: crossing failures are logged but never block the caller.
 */
function crossActivityOutbound(activityUrn) {
  try {
    if (!activityUrn || activityUrn.includes(':error:')) return null;
    return bc20.crossOutbound(activityUrn, bc20.durableStore());
  } catch (e) {
    try { process.stderr.write(`[receipt-minter] crossOutbound failed: ${e.message}\n`); } catch { /* noop */ }
    return null;
  }
}

module.exports = { mintSpendReceipt, mintSpendActivity, crossActivityOutbound, OUTCOMES };
