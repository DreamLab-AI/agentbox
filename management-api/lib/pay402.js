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
 *   sidestr (ADR-2097 D3): accepts[] scheme "sidestr". unknown: all else, terminal.
 *
 * classify() contract:
 *   - Pure function. No network. Never throws.
 *   - Body capped at 64 KiB BEFORE JSON.parse. Over-size → unknown.
 *   - Headers are normalised to lowercase (RFC 9110).
 *   - Returns { scheme, payable, offer, reason }.
 *   - payable: agentbox-ledger iff CONSUMER_ENABLED === "true"; sidestr iff
 *     opts.rails.sidestr is enabled for the offer's chain (see SIDESTR below).
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
function classify({ status, headers, body } = {}, opts = {}) {
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
  // Scheme 4: sidestr (ADR-2097 D3). Below agentbox-ledger (D4) and below the
  // two foreign schemes, whose detection shapes it cannot collide with.
  // -------------------------------------------------------------------------
  if (status === 402 && parsed !== null && Array.isArray(parsed.accepts)) {
    const sidestr = _classifySidestr(parsed.accepts, opts || {});
    if (sidestr) return sidestr;
  }

  // -------------------------------------------------------------------------
  // Scheme 5: unknown (terminal, fail-closed)
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
// SIDESTR (ADR-2097 D3, amended 2026-10-02; owner decision SC2)
// ---------------------------------------------------------------------------
//
// A 402 whose accepts[] carries an entry
//
//   { scheme: "sidestr", chain_id: "sidestr:<name>", address: "<prefix>1p…",
//     pubkey: "<64-hex payee spend key>", amount_sats: <int>,
//     memo: "urn:agentbox:receipt:<payee hex>:sha256-12-<hex>",
//     pay_to?: "did:nostr:<hex>", binding?: <kind-38420 event> }
//
// settles as one sidechain transaction: the payer signs with its spend key
// (never its identity key, ADR-2101 D3) through sidestr-agent and broadcasts
// it (producer POST /tx and kind 23500). The payer's receipt cites the txid
// and the hash of the including block.
//
// Value-leak guard: only chains compiled into SIDESTR_CHAINS are accepted,
// and every compiled chain must sit on a testnet parent (checked at load).
// A chain id from a 402 is never trusted to name a producer: the payer pays
// through the producer its own [payments.sidestr] names, after checking that
// producer's chain document against this table.
//
// payable: true only when opts.rails.sidestr = { enabled: true, chain_id }
// names the offer's chain. CONSUMER_ENABLED plays no part (and turning the
// rail on never makes an agentbox-ledger offer payable).

/** Parents a compiled chain may sit on. No mainnet parent, ever. */
const TESTNET_PARENTS = Object.freeze(['tbtc4', 'txbt4']);

/**
 * The chains this build will pay on. A new chain is a reviewed edit here plus
 * a fixture, never a runtime option. `hash` is the id of the chain's kind-3500
 * event (sidestr 0.0.5); null for a chain sealed before 0.0.5, which is then
 * pinned by `genesisHash` alone.
 */
const SIDESTR_CHAINS = Object.freeze({
  'sidestr:dreamlab': Object.freeze({
    parent: 'tbtc4',
    hash: null,
    genesisHash: '4db37517728bd509c0cb96ee5a2e3e2a77f9e965a092e9f67948b413d453dbc0',
    addressPrefix: 'drm',
  }),
  // The agent-payments demo chain (owner decision SC1), sealed beside BLAKE2b
  // testnet4 at agentbox f7465412d. Not anchored (SC5): no checkpoints.
  'sidestr:dreamlab-txbt4': Object.freeze({
    parent: 'txbt4',
    hash: null,
    genesisHash: '1009aa2984d5c699fe61ef1e5905afe472a49d67551542045726828c8b82d108',
    addressPrefix: 'drt',
  }),
});

/**
 * Throw unless every chain in `table` sits on a testnet parent and is fully
 * pinned. Run against SIDESTR_CHAINS at module load.
 *
 * @param {object} table
 */
function assertTestnetOnly(table) {
  for (const [id, c] of Object.entries(table || {})) {
    if (!c || !TESTNET_PARENTS.includes(c.parent)) {
      throw new Error(`pay402: chain ${id} has parent ${c && c.parent}; only testnet parents (${TESTNET_PARENTS.join(', ')}) are compiled in, never mainnet`);
    }
    if (!/^[0-9a-f]{64}$/.test(c.genesisHash || '') || !/^[a-z]{1,16}$/.test(c.addressPrefix || '')) {
      throw new Error(`pay402: chain ${id} is not fully pinned (genesisHash, addressPrefix)`);
    }
  }
}
assertTestnetOnly(SIDESTR_CHAINS);

const HEX64_RE = /^[0-9a-f]{64}$/;
const DID_NOSTR_RE = /^did:nostr:([0-9a-f]{64})$/;
const RECEIPT_URN_RE = /^urn:agentbox:receipt:[0-9a-f]{64}:sha256-12-[0-9a-f]{12}$/;
const BECH32_DATA_RE = /^[02-9ac-hj-np-z]{8,90}$/;
const SIDESTR_FIELDS = new Set(['scheme', 'chain_id', 'address', 'pubkey', 'amount_sats', 'memo', 'pay_to', 'binding']);

/** The `d` tag a kind-38420 binding carries for this chain and DID. */
function sidestrBindingD(chain, didHex) {
  return `${chain.hash || chain.genesisHash}:${didHex}`;
}

/**
 * Validate one sidestr accepts entry. Returns { offer } or { reason }.
 */
function _sidestrEntry(e, verifyEvent) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return { reason: 'sidestr-malformed' };
  for (const k of Object.keys(e)) if (!SIDESTR_FIELDS.has(k)) return { reason: 'sidestr-malformed' };
  const chain = Object.prototype.hasOwnProperty.call(SIDESTR_CHAINS, e.chain_id) ? SIDESTR_CHAINS[e.chain_id] : null;
  if (!chain) return { reason: 'sidestr-chain-refused' };
  const prefix = `${chain.addressPrefix}1p`;
  if (typeof e.address !== 'string' || !e.address.startsWith(prefix) || !BECH32_DATA_RE.test(e.address.slice(prefix.length))) {
    return { reason: 'sidestr-malformed' };
  }
  if (typeof e.pubkey !== 'string' || !HEX64_RE.test(e.pubkey)) return { reason: 'sidestr-malformed' };
  if (!Number.isSafeInteger(e.amount_sats) || e.amount_sats < 1) return { reason: 'sidestr-malformed' };
  if (typeof e.memo !== 'string' || !RECEIPT_URN_RE.test(e.memo)) return { reason: 'sidestr-malformed' };
  let payTo = null;
  if (e.pay_to !== undefined) {
    if (typeof e.pay_to !== 'string' || !DID_NOSTR_RE.test(e.pay_to)) return { reason: 'sidestr-malformed' };
    payTo = e.pay_to;
  }
  if (e.binding !== undefined && payTo === null) return { reason: 'sidestr-malformed' };

  // The payee DID counts only when its identity key signed a kind-38420
  // binding naming this spend key on this chain (ADR-2101 D4).
  let payeeDid = null;
  if (e.binding !== undefined) {
    const b = e.binding;
    const didHex = DID_NOSTR_RE.exec(payTo)[1];
    const dTag = b && Array.isArray(b.tags) ? b.tags.find((t) => Array.isArray(t) && t[0] === 'd') : null;
    const shapeOk = b && typeof b === 'object' && b.kind === 38420 && b.pubkey === didHex
      && b.content === e.pubkey && dTag && dTag[1] === sidestrBindingD(chain, didHex);
    if (!shapeOk) return { reason: 'sidestr-binding-invalid' };
    if (typeof verifyEvent === 'function') {
      let ok = false;
      try { ok = verifyEvent(b) === true; } catch { ok = false; }
      if (!ok) return { reason: 'sidestr-binding-invalid' };
      payeeDid = payTo;
    }
  }

  const offer = {
    scheme: 'sidestr',
    chain_id: e.chain_id,
    address: e.address,
    pubkey: e.pubkey,
    amount_sats: e.amount_sats,
    memo: e.memo,
    pay_to: payTo,
    payee_did: payeeDid,
  };
  if (e.binding !== undefined) offer.binding = e.binding;
  return { offer };
}

/**
 * Classify the sidestr entries of an accepts[] array. Returns null when there
 * is no sidestr entry (so classification falls through to unknown).
 */
function _classifySidestr(accepts, opts) {
  const entries = accepts.filter((e) => e && e.scheme === 'sidestr');
  if (entries.length === 0) return null;
  const rail = opts.rails && opts.rails.sidestr;
  const results = entries.map((e) => _sidestrEntry(e, opts.verifyEvent));
  const valid = results.filter((r) => r.offer);
  if (valid.length === 0) {
    const reasons = results.map((r) => r.reason);
    const reason = reasons.includes('sidestr-binding-invalid') ? 'sidestr-binding-invalid'
      : reasons.includes('sidestr-chain-refused') ? 'sidestr-chain-refused' : 'sidestr-malformed';
    return { scheme: 'unknown', payable: false, offer: null, reason };
  }
  const configured = rail && rail.enabled === true && typeof rail.chain_id === 'string' ? rail.chain_id : null;
  const chosen = (configured && valid.find((r) => r.offer.chain_id === configured)) || valid[0];
  const payable = configured !== null && chosen.offer.chain_id === configured;
  return {
    scheme: 'sidestr',
    payable,
    offer: chosen.offer,
    reason: payable || !configured ? null : 'sidestr-chain-not-configured',
  };
}

/**
 * Build a sidestr accepts[] entry for a payee's 402 (ADR-2097 D3). Throws on a
 * chain that is not compiled in, or on any field the classifier would refuse,
 * so a payee can never emit an offer a payer here would not accept.
 *
 * @param {object} opts
 * @param {string} opts.chainId     - "sidestr:<name>", compiled in SIDESTR_CHAINS
 * @param {string} opts.address     - the payee spend key's chain address
 * @param {string} opts.pubkey      - the payee spend key (x-only hex)
 * @param {number} opts.amountSats  - price in sats
 * @param {string} opts.memo        - the payee's receipt URN for this charge
 * @param {string} [opts.payTo]     - the payee's did:nostr
 * @param {object} [opts.binding]   - the payee's kind-38420 binding event
 * @returns {object}
 */
function buildSidestrAcceptsEntry({ chainId, address, pubkey, amountSats, memo, payTo, binding } = {}) {
  if (!Object.prototype.hasOwnProperty.call(SIDESTR_CHAINS, chainId)) {
    throw new Error(`pay402: chain ${chainId} is not compiled in`);
  }
  const entry = { scheme: 'sidestr', chain_id: chainId, address, pubkey, amount_sats: amountSats, memo };
  if (payTo !== undefined) entry.pay_to = payTo;
  if (binding !== undefined) entry.binding = binding;
  const r = _sidestrEntry(entry, null);
  if (!r.offer) throw new Error(`pay402: refusing to build a sidestr entry (${r.reason})`);
  return entry;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  classify,
  buildAcceptsEntry,
  buildSidestrAcceptsEntry,
  sidestrBindingD,
  assertTestnetOnly,
  SIDESTR_CHAINS,
  TESTNET_PARENTS,
};
