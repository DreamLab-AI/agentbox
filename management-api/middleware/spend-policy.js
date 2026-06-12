'use strict';

/**
 * spend-policy.js -- Consumer payment spend-policy enforcement middleware.
 *
 * Factory function that returns a Fastify preHandler hook driven entirely by
 * the manifest's [payments.consumer] section. All failure modes are
 * fail-closed: any misconfiguration or missing policy denies the request with
 * HTTP 402 rather than allowing it through.
 *
 * Usage:
 *
 *   const { spendPolicy } = require('../middleware/spend-policy');
 *   const { loadManifest } = require('../adapters/manifest-loader');
 *
 *   const manifest = loadManifest();
 *   fastify.addHook('preHandler', spendPolicy(manifest));
 *
 * Policy fields (manifest.payments.consumer):
 *   enabled               {boolean}  Master gate. Missing or false → 402.
 *   max_sats_per_call     {integer}  Hard cap per individual call.
 *   daily_budget_sats     {integer}  Rolling daily budget keyed by date+origin.
 *   approval_threshold_sats {integer} Calls above this set request.requiresApproval.
 *   allow_origins         {string[]} Allowlist. Non-empty → origin must be present.
 *   deny_origins          {string[]} Denylist checked before allowlist.
 *
 * Request context used:
 *   request.paymentContext?.cost_sats  -- set by upstream payment-gate middleware
 *   request.spendAmount                -- fallback integer cost in sats
 *
 * On pass:
 *   request.spendApproved = true
 *   request.requiresApproval = true   -- set (only) when costSats > approval_threshold_sats
 */

// Module-level daily budget accumulator.
// Key: "<YYYY-MM-DD>|<origin>" → accumulated sats spent today.
// Entries are never written to disk; they reset on process restart.
const _dailySpend = new Map();

/**
 * Return the current UTC date string "YYYY-MM-DD".
 */
function _todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Increment the daily spend counter for a given date+origin pair and return
 * the new total (including this call's cost).
 *
 * @param {string} dateKey   - "YYYY-MM-DD"
 * @param {string} origin    - caller origin string (may be empty)
 * @param {number} costSats  - sats to add
 * @returns {number}
 */
function _incrementDailySpend(dateKey, origin, costSats) {
  const key = `${dateKey}|${origin}`;
  const current = _dailySpend.get(key) || 0;
  const next = current + costSats;
  _dailySpend.set(key, next);
  return next;
}

/**
 * Peek at the current daily spend without mutating.
 *
 * @param {string} dateKey
 * @param {string} origin
 * @returns {number}
 */
function _peekDailySpend(dateKey, origin) {
  return _dailySpend.get(`${dateKey}|${origin}`) || 0;
}

/**
 * Create a spend-policy preHandler hook from the given manifest.
 *
 * @param {object} manifest - Parsed agentbox.toml object
 * @returns {function} Fastify async preHandler hook
 */
function spendPolicy(manifest) {
  return async function spendPolicyHook(request, reply) {
    // ── 1. Parse policy — any failure is fail-closed ──────────────────────
    let policy;
    try {
      const payments = manifest && manifest.payments;
      policy = payments && payments.consumer;
      // Coerce to plain object; TOML parser may return undefined
      if (!policy || typeof policy !== 'object') {
        policy = null;
      }
    } catch (_err) {
      reply.code(402).send({ error: 'policy-invalid' });
      return reply;
    }

    // ── 2. Master gate ────────────────────────────────────────────────────
    if (!policy || policy.enabled !== true) {
      reply.code(402).send({ error: 'consumer-payments-disabled' });
      return reply;
    }

    // ── 3. Validate required numeric fields exist on policy object ────────
    //    (We need at least max_sats_per_call; others may be optional.)
    //    Any structural anomaly → policy-invalid.
    let maxSatsPerCall, dailyBudgetSats, approvalThresholdSats;
    let allowOrigins, denyOrigins;
    try {
      maxSatsPerCall        = policy.max_sats_per_call;
      dailyBudgetSats       = policy.daily_budget_sats;
      approvalThresholdSats = policy.approval_threshold_sats;
      allowOrigins          = Array.isArray(policy.allow_origins) ? policy.allow_origins : [];
      denyOrigins           = Array.isArray(policy.deny_origins)  ? policy.deny_origins  : [];

      // max_sats_per_call is required; everything else is optional.
      if (typeof maxSatsPerCall !== 'number' || !Number.isFinite(maxSatsPerCall) || maxSatsPerCall < 1) {
        reply.code(402).send({ error: 'policy-invalid' });
        return reply;
      }
    } catch (_err) {
      reply.code(402).send({ error: 'policy-invalid' });
      return reply;
    }

    // ── 4. Resolve caller origin ──────────────────────────────────────────
    const origin = (request.headers && request.headers.origin) || '';

    // ── 5. Deny-list check ────────────────────────────────────────────────
    if (denyOrigins.length > 0 && denyOrigins.includes(origin)) {
      reply.code(402).send({ error: 'origin-denied' });
      return reply;
    }

    // ── 6. Allow-list check ───────────────────────────────────────────────
    //    Non-empty allowlist: origin must be present in it.
    if (allowOrigins.length > 0 && !allowOrigins.includes(origin)) {
      reply.code(402).send({ error: 'origin-not-allowed' });
      return reply;
    }

    // ── 7. Resolve call cost ──────────────────────────────────────────────
    let costSats;
    try {
      costSats = (request.paymentContext && typeof request.paymentContext.cost_sats === 'number')
        ? request.paymentContext.cost_sats
        : request.spendAmount;

      if (typeof costSats !== 'number' || !Number.isFinite(costSats) || costSats < 0) {
        // No cost context present; treat as zero (pass through — cost checks
        // below are no-ops when cost is 0).
        costSats = 0;
      }
    } catch (_err) {
      reply.code(402).send({ error: 'policy-invalid' });
      return reply;
    }

    // ── 8. Per-call cap ───────────────────────────────────────────────────
    if (costSats > maxSatsPerCall) {
      reply.code(402).send({ error: 'exceeds-per-call-cap' });
      return reply;
    }

    // ── 9. Daily budget check ─────────────────────────────────────────────
    if (typeof dailyBudgetSats === 'number' && Number.isFinite(dailyBudgetSats) && dailyBudgetSats >= 1) {
      const dateKey      = _todayKey();
      const spentSoFar   = _peekDailySpend(dateKey, origin);
      const projectedTotal = spentSoFar + costSats;

      if (projectedTotal > dailyBudgetSats) {
        reply.code(402).send({ error: 'daily-budget-exceeded' });
        return reply;
      }

      // Commit the spend to the accumulator.
      _incrementDailySpend(dateKey, origin, costSats);
    }

    // ── 10. Approval threshold ────────────────────────────────────────────
    //    Does NOT deny — sets a flag for downstream handlers.
    if (
      typeof approvalThresholdSats === 'number' &&
      Number.isFinite(approvalThresholdSats) &&
      approvalThresholdSats >= 0 &&
      costSats > approvalThresholdSats
    ) {
      request.requiresApproval = true;
    }

    // ── 11. Pass ──────────────────────────────────────────────────────────
    request.spendApproved = true;
  };
}

module.exports = { spendPolicy };
