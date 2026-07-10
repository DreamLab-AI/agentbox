'use strict';

/**
 * lib/governance-decision-waiter — bridges the ALREADY-RUNNING relay consumer's
 * inbound ACSP ActionResponse (kind 31403) dispatch to in-process awaiters
 * (the authority gate, lib/authority.js buildAuthorityGate.guard).
 *
 * ADR-037 D2 gates a zero-tolerance action behind a signed, verified, approving
 * kind-31403 response. The gate PUBLISHES the kind-31402 request and then must
 * CONSUME the forum's signed decision. The single relay subscription that already
 * receives 31403s lives in `mcp/nostr-bridge/relay-consumer.js` (the governance
 * branch that hands each 31403 to `orchestrator.handleGovernanceDecision`). This
 * module reuses THAT seam: the consumer additionally calls `notify(event)` here,
 * and any gate awaiting a matching request id / case_id resolves. There is NO
 * second relay client — the value is the wait registry, the transport stays the
 * one connected consumer.
 *
 * Matching mirrors lib/authority.js readOutcome exactly: a 31403 references its
 * request either by an `e` tag equal to the request event id, or by a `case_id`
 * in its JSON content equal to the request's `case_id`. A `d` tag (NIP-33 panel
 * id) is also honoured as a fallback correlation key.
 *
 * Fail-closed: a request whose response never arrives times out to `null`, which
 * the gate treats as a DENY. No response is ever fabricated here.
 *
 * @see management-api/lib/authority.js          (the awaiter — deps.awaitDecision)
 * @see mcp/nostr-bridge/relay-consumer.js       (the notifier — governance branch)
 * @see management-api/routes/broker-bridge.js    (the gated route)
 */

const DEFAULT_TIMEOUT_MS = 120000;

function _parseContent(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

function _tagVal(event, name) {
  const tags = Array.isArray(event && event.tags) ? event.tags : [];
  const t = tags.find((x) => Array.isArray(x) && x[0] === name);
  return t && typeof t[1] === 'string' ? t[1] : null;
}

class GovernanceDecisionWaiter {
  constructor() {
    /** @type {Map<string, Set<object>>} correlation-key → set of pending entries */
    this._pending = new Map();
  }

  /**
   * Correlation keys a REQUEST can be matched by (what a future 31403 must carry).
   */
  _keysForRequest(signedRequest) {
    const keys = [];
    if (signedRequest && typeof signedRequest.id === 'string') keys.push(`e:${signedRequest.id}`);
    const c = _parseContent(signedRequest && signedRequest.content);
    if (c && typeof c.case_id === 'string') keys.push(`case:${c.case_id}`);
    const d = _tagVal(signedRequest, 'd');
    if (d) keys.push(`d:${d}`);
    return keys;
  }

  /**
   * Correlation keys a RESPONSE (31403) carries (what request it references).
   */
  _keysForResponse(responseEvent) {
    const keys = [];
    const e = _tagVal(responseEvent, 'e');
    if (e) keys.push(`e:${e}`);
    const c = _parseContent(responseEvent && responseEvent.content);
    if (c && typeof c.case_id === 'string') keys.push(`case:${c.case_id}`);
    const d = _tagVal(responseEvent, 'd');
    if (d) keys.push(`d:${d}`);
    return keys;
  }

  _remove(entry) {
    for (const k of entry.keys) {
      const set = this._pending.get(k);
      if (set) {
        set.delete(entry);
        if (set.size === 0) this._pending.delete(k);
      }
    }
  }

  /**
   * The injectable `deps.awaitDecision` for lib/authority.js. Registers a waiter
   * keyed by the request's correlation keys and resolves when a matching 31403 is
   * `notify`d, or `null` on timeout (→ gate DENIES, fail-closed).
   *
   * @param {object} signedRequest - the signed kind-31402 request event
   * @param {object} [opts]
   * @param {number} [opts.timeoutMs]
   * @returns {Promise<object|null>} the signed 31403 event, or null on timeout
   */
  awaitDecision(signedRequest, opts = {}) {
    const keys = this._keysForRequest(signedRequest);
    const timeoutMs = Number.isFinite(opts.timeoutMs) ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;

    // No correlation keys → nothing could ever match → deny immediately (never
    // hang a request handler on an un-addressable wait).
    if (keys.length === 0) return Promise.resolve(null);

    return new Promise((resolve) => {
      const entry = { keys, resolve, timer: null };
      // The timer is intentionally NOT unref'd: a pending governance wait is an
      // in-flight request whose bounded timeout (≤ timeoutMs) must reliably fire
      // to fail-closed, so it keeps the loop alive exactly as long as the wait.
      entry.timer = setTimeout(() => {
        this._remove(entry);
        resolve(null);
      }, timeoutMs);
      for (const k of keys) {
        if (!this._pending.has(k)) this._pending.set(k, new Set());
        this._pending.get(k).add(entry);
      }
    });
  }

  /**
   * Called from the relay consumer's 31403 governance branch. Resolves every
   * pending waiter whose request this response references. Returns whether any
   * waiter matched (for logging).
   *
   * @param {object} responseEvent - the inbound signed kind-31403 event
   * @returns {boolean}
   */
  notify(responseEvent) {
    const keys = this._keysForResponse(responseEvent);
    const resolved = new Set();
    for (const k of keys) {
      const set = this._pending.get(k);
      if (!set) continue;
      for (const entry of Array.from(set)) resolved.add(entry);
    }
    for (const entry of resolved) {
      if (entry.timer) clearTimeout(entry.timer);
      this._remove(entry);
      entry.resolve(responseEvent);
    }
    return resolved.size > 0;
  }

  /** Test/introspection helper — number of distinct pending correlation keys. */
  pendingKeyCount() {
    return this._pending.size;
  }
}

// Module singleton — the ONE registry shared between the relay consumer (notifier)
// and every gated route (awaiter). Both sides `require` this module and get the
// same instance, so no second relay subscription is created.
const singleton = new GovernanceDecisionWaiter();

module.exports = singleton;
module.exports.GovernanceDecisionWaiter = GovernanceDecisionWaiter;
