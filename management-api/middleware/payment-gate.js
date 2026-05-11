'use strict';

/**
 * payment-gate.js -- HTTP 402 enforcement middleware.
 *
 * Factory function that returns a Fastify preHandler hook. When applied to a
 * route, the hook checks the caller's balance (via solid-pod-rs) and returns
 * HTTP 402 Payment Required with a standard body if the balance is insufficient.
 *
 * On success the hook deducts the cost by posting to solid-pod-rs and decorates
 * the response with X-Cost, X-Balance, and X-Pay-Currency headers.
 *
 * Usage:
 *
 *   const { paymentGate } = require('../middleware/payment-gate');
 *
 *   // Fixed-cost route
 *   fastify.addHook('preHandler', paymentGate({ costSats: 100 }));
 *
 *   // Tier-based route (reads from env multipliers)
 *   fastify.addHook('preHandler', paymentGate({ tier: 'inference', units: 1 }));
 *
 *   // Dynamic cost from request body
 *   fastify.addHook('preHandler', paymentGate({
 *     costFn: (request) => request.body.units * 10,
 *   }));
 *
 * Environment:
 *
 *   SOLID_POD_PORT        -- solid-pod-rs port (default: 8484)
 *   BASE_COST_SATS        -- base cost per unit (default: 10)
 *   INFERENCE_MULTIPLIER  -- (default: 10)
 *   IMAGE_GEN_MULTIPLIER  -- (default: 100)
 *   ANALYTICS_MULTIPLIER  -- (default: 5)
 */

const POD_BASE = `http://127.0.0.1:${process.env.SOLID_POD_PORT || 8484}`;

const BASE_COST_SATS       = parseInt(process.env.BASE_COST_SATS, 10) || 10;
const INFERENCE_MULTIPLIER = parseFloat(process.env.INFERENCE_MULTIPLIER) || 10;
const IMAGE_GEN_MULTIPLIER = parseFloat(process.env.IMAGE_GEN_MULTIPLIER) || 100;
const ANALYTICS_MULTIPLIER = parseFloat(process.env.ANALYTICS_MULTIPLIER) || 5;

const TIER_MULTIPLIERS = Object.freeze({
  'inference':  INFERENCE_MULTIPLIER,
  'image-gen':  IMAGE_GEN_MULTIPLIER,
  'analytics':  ANALYTICS_MULTIPLIER,
});

/**
 * Query the caller's sat balance from solid-pod-rs.
 * Returns { balance_sats: number } or throws.
 */
async function _queryBalance(authHeader) {
  const headers = { Accept: 'application/json' };
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }

  let res;
  try {
    res = await fetch(`${POD_BASE}/pay/.balance`, { method: 'GET', headers });
  } catch (err) {
    const wrapped = new Error(`Payment service unreachable: ${err.message}`);
    wrapped.statusCode = 502;
    throw wrapped;
  }

  if (!res.ok) {
    const wrapped = new Error(`Payment service returned ${res.status}`);
    wrapped.statusCode = res.status >= 500 ? 502 : res.status;
    throw wrapped;
  }

  const body = await res.json();
  const balanceSats = body.balance_sats
    ?? parseInt(res.headers.get('X-Balance') || '0', 10);
  return { balance_sats: balanceSats };
}

/**
 * Deduct a cost from the caller's balance via solid-pod-rs.
 * Returns the updated balance or throws.
 */
async function _deductBalance(costSats, authHeader) {
  const headers = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (authHeader) {
    headers['Authorization'] = authHeader;
  }

  let res;
  try {
    res = await fetch(`${POD_BASE}/pay/.deduct`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ amount_sats: costSats }),
    });
  } catch (err) {
    const wrapped = new Error(`Payment service unreachable: ${err.message}`);
    wrapped.statusCode = 502;
    throw wrapped;
  }

  if (!res.ok) {
    const wrapped = new Error(`Payment deduction failed: ${res.status}`);
    wrapped.statusCode = res.status >= 500 ? 502 : res.status;
    throw wrapped;
  }

  const body = await res.json();
  return { balance_sats: body.balance_sats ?? body.new_balance ?? 0 };
}

/**
 * Resolve the cost in sats from the gate options.
 *
 * @param {object} opts - Gate configuration
 * @param {object} request - Fastify request
 * @returns {number} cost in satoshis
 */
function _resolveCost(opts, request) {
  if (typeof opts.costFn === 'function') {
    return opts.costFn(request);
  }
  if (typeof opts.costSats === 'number') {
    return opts.costSats;
  }
  if (opts.tier) {
    const multiplier = TIER_MULTIPLIERS[opts.tier];
    if (multiplier === undefined) {
      throw new Error(`paymentGate: unknown tier "${opts.tier}"`);
    }
    const units = opts.units || 1;
    return BASE_COST_SATS * multiplier * units;
  }
  throw new Error('paymentGate: must specify costSats, tier, or costFn');
}

/**
 * Create an HTTP 402 payment gate preHandler hook.
 *
 * @param {object} opts
 * @param {number}   [opts.costSats]  - Fixed cost in satoshis
 * @param {string}   [opts.tier]      - Tier name (inference, image-gen, analytics)
 * @param {number}   [opts.units]     - Number of units for tier-based cost (default: 1)
 * @param {function} [opts.costFn]    - Dynamic cost function (request) => sats
 * @param {boolean}  [opts.dryRun]    - If true, check balance but do not deduct
 * @returns {function} Fastify preHandler hook
 */
function paymentGate(opts = {}) {
  return async function paymentGateHook(request, reply) {
    // Bearer-only auth (admin) bypasses payment if explicitly configured.
    if (opts.bypassBearer && request.auth && request.auth.mode === 'bearer') {
      return;
    }

    const costSats = _resolveCost(opts, request);
    if (costSats <= 0) return;

    const authHeader = request.headers.authorization || '';

    // Query current balance
    let balance;
    try {
      balance = await _queryBalance(authHeader);
    } catch (err) {
      request.log.error({ err: err.message }, 'payment-gate: balance query failed');
      reply.code(err.statusCode || 502).send({
        error: 'payment-service-error',
        message: `Cannot verify payment balance: ${err.message}`,
      });
      return reply;
    }

    // Check sufficiency
    if (balance.balance_sats < costSats) {
      reply.header('X-Cost', String(costSats));
      reply.header('X-Pay-Currency', 'sats');
      reply.header('X-Balance', String(balance.balance_sats));
      reply.code(402).send({
        error: 'payment-required',
        message: `Insufficient balance. This request costs ${costSats} sats; current balance is ${balance.balance_sats} sats.`,
        cost_sats: costSats,
        balance_sats: balance.balance_sats,
        currency: 'sats',
        deposit_endpoint: '/v1/pay/deposit',
        info_endpoint: '/v1/pay/info',
      });
      return reply;
    }

    // Deduct unless dry-run
    if (!opts.dryRun) {
      let updated;
      try {
        updated = await _deductBalance(costSats, authHeader);
      } catch (err) {
        request.log.error({ err: err.message }, 'payment-gate: deduction failed');
        reply.code(err.statusCode || 502).send({
          error: 'payment-deduction-failed',
          message: `Balance deduction failed: ${err.message}`,
        });
        return reply;
      }
      balance.balance_sats = updated.balance_sats;
    }

    // Decorate the response with payment headers
    reply.header('X-Cost', String(costSats));
    reply.header('X-Pay-Currency', 'sats');
    reply.header('X-Balance', String(balance.balance_sats));

    // Attach payment context to the request for downstream handlers
    request.paymentContext = {
      cost_sats: costSats,
      balance_sats: balance.balance_sats,
      deducted: !opts.dryRun,
    };
  };
}

module.exports = { paymentGate };
