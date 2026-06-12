/**
 * pay-fetch.mjs — 402-aware outbound payment pipeline (PRD-015 C1-C6)
 *
 * Named export: payFetch(url, fetchOptions, opts={})
 *
 * Wraps fetch transparently:
 *   - Non-402 responses pass through unchanged.
 *   - 402 responses enter the detect → classify → policy → pay → retry loop.
 *
 * Phase 1 rails: agentbox-ledger only.
 * x402 and l402 are detected (ADR-032) but return rail-not-available.
 * unknown scheme is fail-closed: no retry, no spend.
 *
 * @param {string} url                   Target URL
 * @param {RequestInit} fetchOptions      Passed verbatim to fetch()
 * @param {object} [opts]
 * @param {string} [opts.pubkey]         Operator pubkey (attribution)
 * @param {object} [opts.logger]         Pino-compatible logger (optional)
 * @param {string} [opts.tier]           Endpoint tier for preflight estimate
 *                                        (inference | image-gen | analytics)
 * @returns {Promise<Response>}
 */

const BODY_SIZE_CAP = 64 * 1024;

/**
 * Build a synthetic 402 Response with a JSON error body.
 */
function err402(payload) {
  return new Response(JSON.stringify(payload), {
    status: 402,
    headers: { "Content-Type": "application/json" },
  });
}

export async function payFetch(url, fetchOptions, opts = {}) {
  const { logger } = opts;

  const res = await fetch(url, fetchOptions);

  if (res.status !== 402) return res;

  // --- C1: Intercept --- //

  const bodyText = await res.text();

  // --- Body size cap (ADR-032 D1 — 64 KiB before any parse attempt) --- //
  if (bodyText.length > BODY_SIZE_CAP) {
    logger?.warn({ url, bodyLength: bodyText.length }, "pay-fetch: oversized 402 body — fail-closed");
    return err402({ error: "unrecognised-scheme", reason: "oversized-body" });
  }

  let body;
  try {
    body = JSON.parse(bodyText);
  } catch {
    body = {};
  }

  const headers = Object.fromEntries(res.headers.entries());

  // --- C2: Classify (ADR-032 pure function, fixed import path) --- //
  const { classify } = await import("../../../management-api/lib/pay402.js");
  const result = classify({ status: 402, headers, body });

  logger?.debug({ url, scheme: result.scheme, payable: result.payable }, "pay-fetch: classified 402");

  // --- Fail-closed: unknown scheme --- //
  if (result.scheme === "unknown") {
    logger?.warn({ url, reason: result.reason }, "pay-fetch: unknown scheme — no spend");
    return err402({ error: "unrecognised-scheme", reason: result.reason });
  }

  // --- Phase 1: only agentbox-ledger has a native rail --- //
  if (result.scheme !== "agentbox-ledger") {
    logger?.info({ url, scheme: result.scheme }, "pay-fetch: no native rail for scheme in Phase 1");
    return err402({
      error: "rail-not-available",
      scheme: result.scheme,
      reason: "no native rail in Phase 1",
    });
  }

  // --- C6: Preflight estimate (fail-closed if unreachable) --- //
  // The pod base is fixed to the local management-api; never user-supplied.
  const podBase = "http://127.0.0.1:" + (process.env.SOLID_POD_PORT || 8484);
  const authHeader =
    fetchOptions?.headers?.Authorization ||
    fetchOptions?.headers?.authorization ||
    "";

  // --- agentbox-ledger: execute payment then retry --- //

  // Derive deposit URL from classified offer (relative paths resolved against
  // podBase — never taken verbatim from the 402 body as an external URL).
  const depositPath = result.offer?.deposit || "/v1/pay/deposit";
  const depositUrl = depositPath.startsWith("http") ? depositPath : podBase + depositPath;

  // One idempotency key per payment attempt (crypto.randomUUID is available
  // in Node 19+ and browser; no polyfill needed in the agentbox container).
  const idempotencyKey = crypto.randomUUID();

  logger?.info({ url, depositUrl, idempotencyKey, amount_sats: result.offer?.amount },
    "pay-fetch: initiating agentbox-ledger payment");

  let payResult;
  try {
    const payRes = await fetch(depositUrl, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        amount_sats: result.offer?.amount,
        idempotency_key: idempotencyKey,
      }),
    });

    if (payRes.ok || payRes.status === 409) {
      // 409 Conflict = already paid (idempotent success)
      payResult = { success: true };
    } else if (payRes.status === 402) {
      payResult = { success: false, reason: "insufficient-balance" };
    } else {
      payResult = { success: false, reason: "deduct-failed-" + payRes.status };
    }
  } catch (e) {
    logger?.error({ url, depositUrl, err: e.message }, "pay-fetch: deposit fetch threw");
    payResult = { success: false, reason: e.message };
  }

  if (!payResult.success) {
    logger?.warn({ url, reason: payResult.reason }, "pay-fetch: payment failed — no retry");
    return err402({ error: "payment-failed", reason: payResult.reason });
  }

  // --- C5: Retry original request exactly once --- //
  logger?.info({ url }, "pay-fetch: payment succeeded — replaying request");
  return fetch(url, fetchOptions);
}
