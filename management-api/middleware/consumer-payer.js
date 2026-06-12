'use strict';

/**
 * middleware/consumer-payer.js -- C2 native consumer payer.
 *
 * Resolves a spend offer against the agentbox ledger (solid-pod-rs) by
 * POSTing to the deposit endpoint. Handles idempotency (409 = already
 * processed) and surfaces a typed outcome so callers can route to the
 * receipt minter (C4) without parsing HTTP status codes.
 *
 * @see PRD-015 §C2  @see ADR-032
 */

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

module.exports = { resolveAgentboxLedger };
