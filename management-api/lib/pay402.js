'use strict';

/**
 * pay402.js -- HTTP 402 scheme classifier and accepts-entry builder.
 *
 * SCHEME GRAMMAR (ADR-032 D2 — security gate, fail-closed):
 *
 *   Precedence top-to-bottom, first match wins.
 *
 *   agentbox-ledger (EITHER form, both require status 402):
 *     (a) body.accepts[] contains an entry with scheme === "agentbox-ledger"
 *     (b) X-Pay-Currency header === "sats" AND body.deposit_endpoint is a string
 *     Amount: body.cost_sats is authoritative; X-Cost header is advisory only.
 *     Both forms present AND amounts disagree → unknown(reason: amount-mismatch).
 *
 *   x402:
 *     body is JSON with an integer x402Version AND body.accepts[] contains
 *     objects with scheme and network fields.
 *     x402Version !== 1 → { scheme: "x402", payable: false, reason: "unsupported-version" }
 *
 *   l402:
 *     status 402 OR 401 (the only scheme that accepts 401).
 *     WWW-Authenticate header present, auth-scheme is L402 or LSAT (case-insensitive).
 *     MUST have macaroon param AND invoice param starting lnbc / lntb / lnbcrt.
 *     Missing or bad invoice → unknown(reason: "l402-malformed").
 *
 *   unknown: everything else. Terminal. Fail-closed. No payment rail.
 *
 * classify() contract:
 *   - Pure function. No network. Never throws.
 *   - Body capped at 64 KiB BEFORE JSON.parse. Over-size → unknown.
 *   - Headers are normalised to lowercase (RFC 9110).
 *   - Returns { scheme, payable, offer, reason }.
 *   - payable is true only for agentbox-ledger when
 *     process.env.CONSUMER_ENABLED === "true".
 */

const BODY_MAX_BYTES = 64 * 1024; // 64 KiB

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalise headers: return an object whose keys are lowercase strings.
 * Accepts a plain object or anything with a get() method (Headers / IncomingMessage).
 *
 * @param {object} raw
 * @returns {object}
 */
function _normaliseHeaders(raw) {
  if (!raw || typeof raw !== 'object') return {};
  // If it has a .get() method (e.g. Fetch Headers, node-fetch), iterate entries.
  if (typeof raw.get === 'function' && typeof raw.entries === 'function') {
    const out = {};
    for (const [k, v] of raw.entries()) {
      out[k.toLowerCase()] = v;
    }
    return out;
  }
  // Plain object
  const out = {};
  for (const k of Object.keys(raw)) {
    out[k.toLowerCase()] = raw[k];
  }
  return out;
}

/**
 * Safely parse body to a JSON object.
 * Returns null if body is null/undefined, not a string/Buffer, over-size, or
 * not valid JSON representing an object.
 *
 * @param {string|Buffer|null|undefined} body
 * @returns {object|null}
 */
function _parseBody(body) {
  if (body == null) return null;

  let str;
  if (Buffer.isBuffer(body)) {
    if (body.length > BODY_MAX_BYTES) return null;
    str = body.toString('utf8');
  } else if (typeof body === 'string') {
    // Cap by byte length to be accurate for multi-byte chars.
    if (Buffer.byteLength(body, 'utf8') > BODY_MAX_BYTES) return null;
    str = body;
  } else if (typeof body === 'object') {
    // Already parsed — but we must still guard size.
    // Re-serialise to measure; if it passes, return the original object.
    try {
      const reserialised = JSON.stringify(body);
      if (Buffer.byteLength(reserialised, 'utf8') > BODY_MAX_BYTES) return null;
      return body;
    } catch {
      return null;
    }
  } else {
    return null;
  }

  try {
    const parsed = JSON.parse(str);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Parse a WWW-Authenticate header value and return an object whose keys are
 * the auth-scheme (lower-cased) and all discovered params.
 *
 *   e.g. 'L402 macaroon="abc", invoice="lnbc..."'
 *   → { authScheme: 'l402', macaroon: 'abc', invoice: 'lnbc...' }
 *
 * Returns null when the header value is absent or unparseable.
 *
 * @param {string} headerValue
 * @returns {{ authScheme: string, [param: string]: string }|null}
 */
function _parseWwwAuthenticate(headerValue) {
  if (typeof headerValue !== 'string' || !headerValue.trim()) return null;

  const spaceIdx = headerValue.indexOf(' ');
  let authScheme, paramStr;
  if (spaceIdx === -1) {
    authScheme = headerValue.trim().toLowerCase();
    paramStr = '';
  } else {
    authScheme = headerValue.slice(0, spaceIdx).trim().toLowerCase();
    paramStr = headerValue.slice(spaceIdx + 1).trim();
  }

  const result = { authScheme };

  // Parse key="value" or key=value pairs separated by commas.
  // This regex is intentionally liberal — the strings we care about are
  // controlled by the agentbox payment gate.
  const paramRe = /([A-Za-z_][A-Za-z0-9_]*)=(?:"([^"]*)"|([^,\s]*))/g;
  let m;
  while ((m = paramRe.exec(paramStr)) !== null) {
    const key = m[1].toLowerCase();
    const val = m[2] !== undefined ? m[2] : m[3];
    result[key] = val;
  }

  return result;
}

// ---------------------------------------------------------------------------
// classify()
// ---------------------------------------------------------------------------

/**
 * Classify an HTTP response as a specific payment scheme.
 *
 * @param {object} response
 * @param {number}               response.status  - HTTP status code
 * @param {object}               response.headers - Raw headers (object or Headers instance)
 * @param {string|Buffer|object|null} response.body - Response body (raw string, Buffer, or pre-parsed object)
 * @returns {{ scheme: string, payable: boolean, offer: object|null, reason: string|null }}
 */
function classify({ status, headers, body } = {}) {
  const h = _normaliseHeaders(headers);
  const parsed = _parseBody(body);

  // -------------------------------------------------------------------------
  // Over-size body guard (raw string/Buffer path only — object path handled
  // inside _parseBody already; null result is the signal).
  // We surface this as unknown rather than propagating a parse error.
  // -------------------------------------------------------------------------
  const bodyIsOverSize = (() => {
    if (body == null) return false;
    if (Buffer.isBuffer(body)) return body.length > BODY_MAX_BYTES;
    if (typeof body === 'string') return Buffer.byteLength(body, 'utf8') > BODY_MAX_BYTES;
    return false;
  })();
  if (bodyIsOverSize) {
    return { scheme: 'unknown', payable: false, offer: null, reason: 'body-too-large' };
  }

  // -------------------------------------------------------------------------
  // Scheme 1: agentbox-ledger
  // Requires status 402.
  // -------------------------------------------------------------------------
  if (status === 402) {
    const hasLegacyHeader =
      h['x-pay-currency'] === 'sats' &&
      parsed !== null &&
      typeof parsed.deposit_endpoint === 'string';

    const enrichedEntry = Array.isArray(parsed?.accepts)
      ? parsed.accepts.find((e) => e && e.scheme === 'agentbox-ledger')
      : null;

    const hasEnriched = enrichedEntry !== null && enrichedEntry !== undefined;

    if (hasLegacyHeader || hasEnriched) {
      // Amount reconciliation: body.cost_sats is authoritative.
      const bodyCostSats =
        parsed !== null && typeof parsed.cost_sats === 'number'
          ? parsed.cost_sats
          : null;

      if (hasLegacyHeader && hasEnriched) {
        // Both forms present: check for amount disagreement.
        const enrichedAmount =
          typeof enrichedEntry.amount === 'number' ? enrichedEntry.amount : null;
        if (
          bodyCostSats !== null &&
          enrichedAmount !== null &&
          bodyCostSats !== enrichedAmount
        ) {
          return {
            scheme: 'unknown',
            payable: false,
            offer: null,
            reason: 'amount-mismatch',
          };
        }
      }

      const amount = bodyCostSats;
      const offer = {
        scheme: 'agentbox-ledger',
        currency: 'sats',
        amount,
        deposit_endpoint: parsed?.deposit_endpoint || null,
        info_endpoint: parsed?.info_endpoint || null,
      };

      const payable = process.env.CONSUMER_ENABLED === 'true';
      return { scheme: 'agentbox-ledger', payable, offer, reason: null };
    }
  }

  // -------------------------------------------------------------------------
  // Scheme 2: x402
  // Requires status 402, body with integer x402Version and valid accepts[].
  // -------------------------------------------------------------------------
  if (status === 402 && parsed !== null) {
    const version = parsed.x402Version;
    const hasX402Accepts =
      Array.isArray(parsed.accepts) &&
      parsed.accepts.length > 0 &&
      parsed.accepts.every(
        (e) => e && typeof e.scheme === 'string' && typeof e.network === 'string',
      );

    if (Number.isInteger(version) && hasX402Accepts) {
      if (version !== 1) {
        return {
          scheme: 'x402',
          payable: false,
          offer: null,
          reason: 'unsupported-version',
        };
      }
      return {
        scheme: 'x402',
        payable: false,
        offer: { x402Version: version, accepts: parsed.accepts },
        reason: null,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Scheme 3: l402
  // Accepts status 402 OR 401 (only scheme that accepts 401).
  // -------------------------------------------------------------------------
  if (status === 402 || status === 401) {
    const wwwAuth = h['www-authenticate'];
    const authInfo = _parseWwwAuthenticate(wwwAuth);

    if (authInfo && (authInfo.authScheme === 'l402' || authInfo.authScheme === 'lsat')) {
      const macaroon = authInfo.macaroon;
      const invoice = authInfo.invoice;

      if (!macaroon || !invoice) {
        return { scheme: 'unknown', payable: false, offer: null, reason: 'l402-malformed' };
      }

      // Invoice MUST start with lnbc / lntb / lnbcrt (case-insensitive prefix check).
      const invoiceLower = invoice.toLowerCase();
      const validPrefix =
        invoiceLower.startsWith('lnbc') ||
        invoiceLower.startsWith('lntb') ||
        invoiceLower.startsWith('lnbcrt');

      if (!validPrefix) {
        return { scheme: 'unknown', payable: false, offer: null, reason: 'l402-malformed' };
      }

      return {
        scheme: 'l402',
        payable: false,
        offer: { macaroon, invoice },
        reason: null,
      };
    }
  }

  // -------------------------------------------------------------------------
  // Scheme 4: unknown (terminal, fail-closed)
  // -------------------------------------------------------------------------
  return { scheme: 'unknown', payable: false, offer: null, reason: null };
}

// ---------------------------------------------------------------------------
// buildAcceptsEntry()
// ---------------------------------------------------------------------------

/**
 * Build a standard agentbox-ledger accepts entry for inclusion in a 402 body.
 *
 * @param {object} opts
 * @param {number} opts.costSats       - Cost in satoshis
 * @param {string} opts.operatorDid    - Operator DID (pay_to)
 * @param {string} [opts.depositPath]  - Deposit endpoint path (default: /v1/pay/deposit)
 * @param {string} [opts.infoPath]     - Info endpoint path (default: /v1/pay/info)
 * @returns {object}
 */
function buildAcceptsEntry({ costSats, operatorDid, depositPath, infoPath } = {}) {
  return {
    scheme: 'agentbox-ledger',
    currency: 'sats',
    amount: costSats,
    pay_to: operatorDid,
    ledger: 'web-ledger',
    deposit: depositPath || '/v1/pay/deposit',
    info: infoPath || '/v1/pay/info',
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { classify, buildAcceptsEntry };
