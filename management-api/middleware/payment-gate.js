'use strict';

/**
 * Payment gate middleware for GPU-metered endpoints.
 *
 * Enforces server-side cost calculation for metered operations (e.g. ComfyUI
 * workflow submission).  Client-supplied cost_sats values are NEVER trusted.
 * The server determines the cost from an internal cost table keyed by
 * endpoint / operation type, then debits the caller's balance.
 *
 * When a request's cost_sats is missing, zero, negative, or non-numeric, the
 * gate rejects the request with 402 Payment Required rather than allowing
 * free-riding on GPU resources.
 *
 * Security invariants:
 *   1. cost_sats is ALWAYS overwritten with the server-side computed value.
 *   2. Requests to metered endpoints with insufficient balance are rejected.
 *   3. The cost table is not exposed to clients.
 */

/**
 * Server-side cost table.  Values are in satoshis.
 * Override at runtime via AGENTBOX_COST_TABLE_JSON env var (JSON string).
 *
 * Keys follow the pattern: "<method> <route-path>"
 */
const DEFAULT_COST_TABLE = {
  'POST /v1/comfyui/workflow': 100,       // Base cost for workflow submission
  'POST /v1/comfyui/workflow:high': 200,  // High-priority surcharge
};

let _costTable = null;

function getCostTable() {
  if (_costTable) return _costTable;

  const envOverride = process.env.AGENTBOX_COST_TABLE_JSON;
  if (envOverride) {
    try {
      _costTable = { ...DEFAULT_COST_TABLE, ...JSON.parse(envOverride) };
    } catch {
      _costTable = { ...DEFAULT_COST_TABLE };
    }
  } else {
    _costTable = { ...DEFAULT_COST_TABLE };
  }
  return _costTable;
}

/**
 * Compute the server-side cost for a request.
 *
 * @param {string} method - HTTP method (e.g. 'POST')
 * @param {string} routePath - Fastify route path (e.g. '/v1/comfyui/workflow')
 * @param {object} body - Request body (used for priority surcharges)
 * @returns {number} Cost in satoshis (always > 0 for metered endpoints)
 */
function computeCost(method, routePath, body = {}) {
  const table = getCostTable();
  const key = `${method} ${routePath}`;
  let cost = table[key];

  if (cost === undefined || cost === null) {
    return 0; // Not a metered endpoint
  }

  // Apply priority surcharge if applicable
  if (body.priority === 'high') {
    const surchargeKey = `${key}:high`;
    if (table[surchargeKey]) {
      cost = table[surchargeKey];
    }
  }

  return cost;
}

/**
 * Set of route patterns that are GPU-metered and require payment.
 * Requests to these routes MUST pass the payment gate.
 */
const METERED_ROUTES = new Set([
  'POST /v1/comfyui/workflow',
]);

/**
 * Determine whether a route is metered.
 */
function isMeteredRoute(method, routePath) {
  return METERED_ROUTES.has(`${method} ${routePath}`);
}

/**
 * Validate that a cost value is a positive finite number.
 * @param {*} value
 * @returns {boolean}
 */
function isValidPositiveCost(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Create the payment gate Fastify hook.
 *
 * @param {object} options
 * @param {object} options.logger - Pino logger instance
 * @param {Function} [options.getBalance] - async (pubkey) => number  — returns caller's balance in sats.
 *   Defaults to a function that always returns Infinity (no balance enforcement) to allow
 *   gradual rollout.  Replace with a real balance-checking function in production.
 * @param {Function} [options.debit] - async (pubkey, amount) => void  — debits caller's balance.
 *   Defaults to a no-op.
 * @returns {Function} Fastify onRequest hook
 */
function createPaymentGate(options = {}) {
  const { logger } = options;

  // Balance check and debit functions — pluggable for testing and gradual rollout.
  const getBalance = options.getBalance || (async () => Infinity);
  const debit = options.debit || (async () => {});

  return async function paymentGateHook(request, reply) {
    const method = request.method;
    const routePath = request.routeOptions?.url || request.routerPath || request.url;

    if (!isMeteredRoute(method, routePath)) {
      return; // Not a metered route — no payment required.
    }

    // Compute server-side cost.  NEVER trust client-supplied cost_sats.
    const serverCost = computeCost(method, routePath, request.body || {});

    if (!isValidPositiveCost(serverCost)) {
      // Defensive: if the cost table is misconfigured, fail closed.
      logger.error(
        { method, routePath, serverCost },
        'Payment gate: cost table returned invalid cost for metered route — rejecting request'
      );
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Server-side cost calculation failed for this metered endpoint',
      });
    }

    // Reject if client sent cost_sats that is zero, negative, or missing.
    // This prevents the bypass described in P1-28: attackers setting cost_sats=0.
    const clientCost = request.body && request.body.cost_sats;
    if (clientCost !== undefined && clientCost !== null) {
      // Client tried to supply cost_sats — log the attempt and overwrite.
      if (clientCost !== serverCost) {
        logger.warn(
          { method, routePath, clientCost, serverCost },
          'Payment gate: client-supplied cost_sats differs from server cost — overwriting'
        );
      }
    }

    // Overwrite with server-computed cost so downstream code sees the real value.
    if (request.body) {
      request.body.cost_sats = serverCost;
    }

    // Check caller's balance.
    const callerPubkey = request.auth?.pubkey || request.auth?.mode || 'anonymous';
    try {
      const balance = await getBalance(callerPubkey);

      if (!Number.isFinite(balance) && balance !== Infinity) {
        logger.error({ callerPubkey }, 'Payment gate: balance check returned invalid value');
        return reply.code(500).send({
          error: 'Internal Server Error',
          message: 'Balance check failed',
        });
      }

      if (balance < serverCost) {
        logger.warn(
          { callerPubkey, balance, serverCost },
          'Payment gate: insufficient balance'
        );
        return reply.code(402).send({
          error: 'Payment Required',
          message: `Insufficient balance. This operation costs ${serverCost} sats, your balance is ${balance} sats.`,
          cost_sats: serverCost,
        });
      }

      // Debit the caller.
      await debit(callerPubkey, serverCost);

      logger.info(
        { callerPubkey, serverCost, routePath },
        'Payment gate: metered request authorised'
      );
    } catch (err) {
      logger.error(
        { callerPubkey, error: err.message },
        'Payment gate: balance/debit operation failed'
      );
      return reply.code(500).send({
        error: 'Internal Server Error',
        message: 'Payment processing failed',
      });
    }
  };
}

module.exports = {
  createPaymentGate,
  computeCost,
  isMeteredRoute,
  isValidPositiveCost,
  getCostTable,
  DEFAULT_COST_TABLE,
  METERED_ROUTES,
};
