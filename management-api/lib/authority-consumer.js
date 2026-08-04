'use strict';

/**
 * lib/authority-consumer — the canonical `awaitDecision` consumer for the
 * authority gate (ADR-043 D4.7, PRD-021 F3-6, DDD-019 §authority).
 *
 * The authority gate (lib/authority.js buildAuthorityGate) blocks a
 * zero-tolerance (or unclassified/escalation-required) action until a signed,
 * Schnorr-verified, APPROVING kind-31403 ActionResponse referencing its
 * kind-31402 ActionRequest arrives; without a decision consumer every such
 * action is DENIED (fail-closed, authority.js:217-224). This module is the
 * consumer the operator decision (ADR-043 D4.7) makes canonical: the EMBEDDED
 * RELAY. It:
 *
 *   1. PUBLISHES the gate's kind-31402 request, signed by the operator
 *      delegation key, over an already-connected NostrBridge (publishActionRequest).
 *   2. SUBSCRIBES once for kind-31403 decisions and resolves any pending
 *      gate wait whose request the 31403 references — but ONLY when the 31403
 *      verifies (Schnorr) AND its author is on the approval allowlist
 *      (awaitDecision + the inbound handler).
 *
 * The mobile path (Amethyst/Amber holding a delegated allowlisted key) answers
 * these 31403s directly. The dashboard is the SECOND front door (routes/
 * approvals.js): it renders the open 31402s (listPending) and, on operator
 * click, SIGNS and publishes a 31403 via the operator delegation key
 * (signAndPublishDecision) — a NIP-98-authed request, never an unsigned
 * approval. Either way the decision record is a signed event and the gate's
 * fail-closed semantics survive (an un-answered or unverified decision denies).
 *
 * Lazily connects the bridge + loads the signer on first use (mirrors
 * server.js buildVoiceIntentDispatcher), so building the consumer at boot opens
 * no relay connection. Returns null when the sovereign bridge, relays, or a
 * signer stack are unavailable — the gate then falls back to its default
 * (governance-decision-waiter or a blanket deny), never a silent success.
 *
 * @see lib/authority.js               (buildAuthorityGate — deps.awaitDecision/publishActionRequest)
 * @see lib/agent-control-surface.js   (buildActionRequest / publishPanelEvent — the 31402 producer)
 * @see lib/governance-decision-waiter.js (the relay-consumer-fed waiter this generalises)
 * @see routes/approvals.js            (the dashboard signing front door)
 */

const acs = require('./agent-control-surface');
const authz = require('./authz');

const ACTION_RESPONSE_KIND = acs.kinds.ACTION_RESPONSE; // 31403 — we CONSUME
const DEFAULT_TIMEOUT_MS = 120000;
const DECIDED_CACHE_MAX = 512; // bound the decided-request cache

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

/** Correlation keys a REQUEST can be matched by (what a future 31403 must carry). */
function _keysForRequest(signedRequest) {
  const keys = [];
  if (signedRequest && typeof signedRequest.id === 'string') keys.push(`e:${signedRequest.id}`);
  const c = _parseContent(signedRequest && signedRequest.content);
  if (c && typeof c.case_id === 'string') keys.push(`case:${c.case_id}`);
  const d = _tagVal(signedRequest, 'd');
  if (d) keys.push(`d:${d}`);
  return keys;
}

/** Correlation keys a RESPONSE (31403) carries (what request it references). */
function _keysForResponse(responseEvent) {
  const keys = [];
  const e = _tagVal(responseEvent, 'e');
  if (e) keys.push(`e:${e}`);
  const c = _parseContent(responseEvent && responseEvent.content);
  if (c && typeof c.case_id === 'string') keys.push(`case:${c.case_id}`);
  const d = _tagVal(responseEvent, 'd');
  if (d) keys.push(`d:${d}`);
  return keys;
}

/**
 * Build an unsigned kind-31403 ActionResponse referencing a request. The wire
 * shape mirrors what lib/authority.js readOutcome and the waiter matching
 * expect: an `e` tag = request id, a `d` tag = panel id, and a JSON content
 * carrying `outcome` (+ optional `case_id`, `reasoning`). Signing is the
 * caller's — the operator delegation key signs this, never the module.
 *
 * @param {object} p
 * @param {string} p.requestId   - the kind-31402 event id being answered
 * @param {string} [p.panelId]   - the NIP-33 d-tag of the request panel
 * @param {string} [p.caseId]    - the request's case_id (content correlation)
 * @param {string} [p.requesterPubkey] - the request author (for the `p` tag)
 * @param {string} p.outcome     - 'approve' | 'reject' | 'defer'
 * @param {string} [p.reasoning]
 * @param {number} [p.createdAt]
 * @returns {object} unsigned Nostr event
 */
function buildActionResponse(p = {}) {
  if (typeof p.requestId !== 'string' || !p.requestId) {
    throw new TypeError('buildActionResponse: requestId is required');
  }
  const outcome = String(p.outcome || '').toLowerCase();
  if (!outcome) throw new TypeError('buildActionResponse: outcome is required');

  const tags = [];
  if (p.panelId) tags.push(['d', p.panelId]);
  tags.push(['e', p.requestId]);
  if (p.requesterPubkey) tags.push(['p', p.requesterPubkey]);
  tags.push(['t', 'action-response']);

  const content = JSON.stringify({
    outcome,
    case_id: typeof p.caseId === 'string' ? p.caseId : null,
    reasoning: typeof p.reasoning === 'string' ? p.reasoning : null,
  });

  return {
    kind: ACTION_RESPONSE_KIND,
    created_at: typeof p.createdAt === 'number' ? p.createdAt : Math.floor(Date.now() / 1000),
    tags,
    content,
  };
}

/**
 * Build the authority consumer. Returns `{ publishActionRequest, awaitDecision,
 * verifyEvent, listPending, signAndPublishDecision, ... }`, or null when the
 * consumer cannot be wired (no relays / no signer stack / bridge disabled).
 *
 * @param {object} opts
 * @param {object} opts.manifest - parsed agentbox.toml
 * @param {object} [opts.logger]
 * @param {object} [opts.bridgeFactory] - test hook: () => connected-NostrBridge-like
 * @param {object} [opts.signer]        - test hook: pre-loaded signer
 * @param {number} [opts.defaultTimeoutMs]
 * @returns {object|null}
 */
function buildAuthorityConsumer(opts = {}) {
  const manifest = opts.manifest || {};
  const logger = opts.logger || { debug() {}, warn() {}, info() {} };
  const defaultTimeoutMs = Number.isFinite(opts.defaultTimeoutMs) ? opts.defaultTimeoutMs : DEFAULT_TIMEOUT_MS;

  const sm = (manifest.sovereign_mesh) || {};
  const bridgeEnabled = sm.nostr_bridge === true || opts.bridgeFactory != null;
  const relays = String(process.env.NOSTR_RELAYS || '')
    .split(',').map((r) => r.trim()).filter(Boolean);
  const integ = (manifest.integrations && manifest.integrations.solid_pod_rs) || {};
  const stack = process.env.AGENTBOX_STACK || process.env.AGENTBOX_PROFILE || integ.sign_stack || null;

  if (!bridgeEnabled || (relays.length === 0 && !opts.bridgeFactory) || (!stack && !opts.signer)) {
    logger.debug({
      event: 'authority-consumer.unwired',
      nostr_bridge: bridgeEnabled, relays: relays.length, stack: !!stack,
    }, 'Authority-gate awaitDecision consumer not wired (gate falls back to its default deny/waiter)');
    return null;
  }

  // Approval allowlist: only a 31403 from an allowlisted pubkey (mobile
  // delegated key OR the operator delegation key the dashboard signs with) may
  // release the gate. The predicate is now the ONE shared policy in lib/authz.js
  // (approvalAllowlist), so the relay consumer and the HTTP front doors
  // (routes/approvals.js, routes/mandate.js) enforce exactly the same set.
  const allow = authz.approvalAllowlist(manifest);

  const verifyEvent = opts.verifyEvent || ((event) => {
    try {
      const { verifyEvent: v } = require('nostr-tools');
      return v(event) === true;
    } catch {
      return false; // cannot verify → fail-closed
    }
  });

  /** @type {Map<string, Set<object>>} correlation-key → set of pending entries */
  const pendingByKey = new Map();
  /** @type {Map<string, object>} requestId → { request, panelId, caseId, requesterPubkey, createdAt } */
  const openRequests = new Map();
  /**
   * @type {Map<string, object>} requestId → { outcome, response_event_id, decided_at }
   * Records requests a verified 31403 has ALREADY answered — whether from the
   * dashboard front door or the mobile path — so the HTTP surface can return 409
   * (already decided) instead of silently re-signing a second decision. Bounded
   * FIFO so it cannot grow without limit.
   */
  const decided = new Map();
  /**
   * @type {Set<string>} requestIds a signAndPublishDecision call has CLAIMED
   * and not yet finished. Finding 4: a decision claim is taken synchronously
   * (before the first await), so a concurrent POST for the same id sees the
   * claim and rejects DECISION_IN_FLIGHT instead of publishing a second signed
   * 31403. Cleared on success (id moves to `decided`) or on publish failure
   * (pending restored so a retry can succeed).
   */
  const inFlight = new Set();

  function _markDecided(requestId, meta) {
    if (typeof requestId !== 'string' || !requestId) return;
    if (decided.has(requestId)) { decided.delete(requestId); } // refresh recency
    decided.set(requestId, meta || {});
    while (decided.size > DECIDED_CACHE_MAX) {
      const oldest = decided.keys().next().value;
      decided.delete(oldest);
    }
  }

  // Lazily-connected { bridge, signer }; the subscription is installed once.
  let ready = null;
  let subscribed = false;

  async function ensureReady() {
    if (ready) return ready;
    let bridge;
    let signer;
    if (opts.bridgeFactory) {
      bridge = await opts.bridgeFactory();
    } else {
      let NostrBridge;
      try { ({ NostrBridge } = require('./nostr-bridge')); }
      catch { ({ NostrBridge } = require('../../mcp/servers/nostr-bridge')); }
      bridge = new NostrBridge({ relays });
      await bridge.connect();
    }
    if (opts.signer) {
      signer = opts.signer;
    } else {
      let loadSigner;
      try { ({ loadSigner } = require('./nostr-bridge')); }
      catch { ({ loadSigner } = require('../../mcp/servers/nostr-bridge')); }
      signer = loadSigner(stack, {});
    }
    ready = { bridge, signer };
    installSubscription(bridge);
    return ready;
  }

  function installSubscription(bridge) {
    if (subscribed || !bridge || typeof bridge.subscribe !== 'function') return;
    subscribed = true;
    try {
      bridge.subscribe({ kinds: [ACTION_RESPONSE_KIND] }, (event) => {
        try { handleInboundDecision(event); } catch (_) { /* never crash the bridge */ }
      });
    } catch (err) {
      subscribed = false;
      logger.warn({ err: err.message }, 'authority-consumer: failed to subscribe for 31403 decisions');
    }
  }

  function _removeEntry(entry) {
    for (const k of entry.keys) {
      const set = pendingByKey.get(k);
      if (set) {
        set.delete(entry);
        if (set.size === 0) pendingByKey.delete(k);
      }
    }
    if (entry.requestId) openRequests.delete(entry.requestId);
  }

  /**
   * Resolve every pending waiter a verified, allowlisted 31403 references.
   * Rejects (does not resolve) a 31403 that fails Schnorr verification or whose
   * author is off the allowlist — the waiter then times out to null (DENY).
   */
  function handleInboundDecision(responseEvent) {
    if (!responseEvent || responseEvent.kind !== ACTION_RESPONSE_KIND) return false;
    const author = String(responseEvent.pubkey || '').toLowerCase();
    if (!allow.has(author)) {
      logger.warn({ event: 'authority-consumer.reject', reason: 'not-allowlisted', pubkey: author },
        'authority-consumer: 31403 from a non-allowlisted key ignored');
      return false;
    }
    if (!verifyEvent(responseEvent)) {
      logger.warn({ event: 'authority-consumer.reject', reason: 'unverified-signature' },
        'authority-consumer: 31403 failed Schnorr verification, ignored');
      return false;
    }
    const keys = _keysForResponse(responseEvent);
    const resolved = new Set();
    for (const k of keys) {
      const set = pendingByKey.get(k);
      if (!set) continue;
      for (const entry of Array.from(set)) resolved.add(entry);
    }
    for (const entry of resolved) {
      if (entry.timer) clearTimeout(entry.timer);
      _removeEntry(entry);
      entry.resolve(responseEvent);
    }

    // Record the decision so the HTTP surface reports 409 (already decided) and
    // never signs a second 31403 for the same request — regardless of whether a
    // local awaitDecision waiter existed. Covers the mobile path too: a verified
    // 31403 answered on Amethyst marks the open request decided + closes it.
    const decidedIds = new Set();
    const refId = _tagVal(responseEvent, 'e');
    if (refId) decidedIds.add(refId);
    for (const entry of resolved) if (entry.requestId) decidedIds.add(entry.requestId);
    if (decidedIds.size) {
      const outcome = String(_parseContent(responseEvent.content).outcome || '').toLowerCase() || null;
      for (const rid of decidedIds) {
        _markDecided(rid, { outcome, response_event_id: responseEvent.id || null, decided_at: Math.floor(Date.now() / 1000) });
        openRequests.delete(rid);
      }
    }
    return resolved.size > 0;
  }

  /**
   * deps.publishActionRequest — sign the gate's unsigned kind-31402 with the
   * operator key and publish it over the connected bridge. Returns the SIGNED
   * request (so a response can be matched to its id). Records it as open.
   */
  async function publishActionRequest(unsigned) {
    const { bridge, signer } = await ensureReady();
    const signed = await acs.publishPanelEvent(bridge, signer, unsigned);
    if (signed && typeof signed.id === 'string') {
      const c = _parseContent(signed.content);
      openRequests.set(signed.id, {
        request: signed,
        requestId: signed.id,
        panelId: _tagVal(signed, 'd'),
        caseId: typeof c.case_id === 'string' ? c.case_id : null,
        requesterPubkey: signed.pubkey || null,
        title: _tagVal(signed, 'title'),
        priority: _tagVal(signed, 'priority'),
        createdAt: signed.created_at || Math.floor(Date.now() / 1000),
      });
    }
    return signed;
  }

  /**
   * deps.awaitDecision — register a waiter keyed by the request's correlation
   * keys; resolve with the verified, allowlisted 31403, or null on timeout
   * (→ the gate DENIES, fail-closed).
   */
  function awaitDecision(signedRequest, waitOpts = {}) {
    const keys = _keysForRequest(signedRequest);
    const timeoutMs = Number.isFinite(waitOpts.timeoutMs) ? waitOpts.timeoutMs : defaultTimeoutMs;
    if (keys.length === 0) return Promise.resolve(null);

    return new Promise((resolve) => {
      const entry = {
        keys,
        requestId: signedRequest && typeof signedRequest.id === 'string' ? signedRequest.id : null,
        resolve,
        timer: null,
      };
      // Not unref'd: a pending governance wait is an in-flight request whose
      // bounded timeout must reliably fire to fail-closed.
      entry.timer = setTimeout(() => {
        _removeEntry(entry);
        resolve(null);
      }, timeoutMs);
      for (const k of keys) {
        if (!pendingByKey.has(k)) pendingByKey.set(k, new Set());
        pendingByKey.get(k).add(entry);
      }
    });
  }

  /** The open 31402 requests currently awaiting a decision (for the dashboard). */
  function listPending() {
    return Array.from(openRequests.values()).map((r) => ({
      request_event_id: r.requestId,
      panel_id: r.panelId,
      case_id: r.caseId,
      requester_pubkey: r.requesterPubkey,
      title: r.title,
      priority: r.priority,
      created_at: r.createdAt,
      content: _parseContent(r.request && r.request.content),
    }));
  }

  /** One open request's stored metadata, or null. */
  function getPending(requestId) {
    return openRequests.get(requestId) || null;
  }

  /** True iff a verified 31403 has already answered this request. */
  function isDecided(requestId) {
    return decided.has(requestId);
  }

  /** The recorded decision for a request, or null. */
  function getDecision(requestId) {
    return decided.get(requestId) || null;
  }

  /**
   * The dashboard signing front door: sign a kind-31403 decision for `requestId`
   * with the operator delegation key and publish it. The consumer's own
   * subscription then releases the matching gate wait. Returns the signed 31403.
   * Never signs an unsigned HTTP approval into a decision — the event is always
   * Schnorr-signed here.
   *
   * @param {object} p
   * @param {string} p.requestId
   * @param {string} p.outcome   - 'approve' | 'reject' | 'defer'
   * @param {string} [p.reasoning]
   * @returns {Promise<object>} the signed 31403 event
   */
  async function signAndPublishDecision(p = {}) {
    // Finding 4 (concurrent double-sign): reject a call for a request another
    // in-flight call has already claimed, BEFORE inspecting openRequests — the
    // claim below removes the id from openRequests, so a concurrent call would
    // otherwise misread it as NOT_PENDING. Node is single-threaded, so this
    // check + the synchronous claim below (both before the first await) form a
    // sufficient mutual exclusion; no lock library is needed.
    if (inFlight.has(p.requestId)) {
      const err = new Error(`request ${p.requestId} is already being decided`);
      err.code = 'DECISION_IN_FLIGHT';
      throw err;
    }
    const open = openRequests.get(p.requestId);
    // Fail-closed: never sign a decision for a request that is not currently
    // pending. An unknown id, or one a prior 31403 already answered, must NOT
    // produce a second signed decision (finding 2). The HTTP route maps this to
    // 404/409 before calling in; the throw is the belt-and-braces last line.
    if (!open) {
      if (decided.has(p.requestId)) {
        const err = new Error(`request ${p.requestId} has already been decided`);
        err.code = 'ALREADY_DECIDED';
        throw err;
      }
      const err = new Error(`request ${p.requestId} is not pending (unknown or expired)`);
      err.code = 'NOT_PENDING';
      throw err;
    }

    // ATOMIC CLAIM (synchronous, pre-await): take ownership of the request so a
    // concurrent call for the same id trips the DECISION_IN_FLIGHT guard above.
    // Removing it from openRequests here also means a concurrent call cannot
    // re-read it as pending.
    inFlight.add(p.requestId);
    openRequests.delete(p.requestId);

    let signed;
    try {
      const unsigned = buildActionResponse({
        requestId: p.requestId,
        panelId: open.panelId,
        caseId: open.caseId,
        requesterPubkey: open.requesterPubkey,
        outcome: p.outcome,
        reasoning: p.reasoning,
      });
      const { bridge, signer } = await ensureReady();
      signed = await bridge.publish(unsigned, signer);
    } catch (err) {
      // Publish (or signer/bridge readiness, or response build) FAILED: restore
      // the pending state and release the claim so a retry can succeed. Nothing
      // was signed and published, so the request is genuinely still open.
      openRequests.set(p.requestId, open);
      inFlight.delete(p.requestId);
      throw err;
    }

    // SUCCESS: release local waiters immediately (do not wait for the loopback
    // echo), then mark decided and drop the claim. openRequests was already
    // cleared by the claim; handleInboundDecision is idempotent against it.
    try { handleInboundDecision(signed); } catch (_) { /* ignore */ }
    _markDecided(p.requestId, {
      outcome: String(p.outcome || '').toLowerCase() || null,
      response_event_id: signed && signed.id ? signed.id : null,
      decided_at: Math.floor(Date.now() / 1000),
    });
    openRequests.delete(p.requestId);
    inFlight.delete(p.requestId);
    return signed;
  }

  return {
    publishActionRequest,
    awaitDecision,
    verifyEvent,
    listPending,
    getPending,
    isDecided,
    getDecision,
    signAndPublishDecision,
    buildActionResponse,
    // test/introspection
    _handleInboundDecision: handleInboundDecision,
    _allowlist: allow,
  };
}

module.exports = {
  buildAuthorityConsumer,
  buildActionResponse,
  ACTION_RESPONSE_KIND,
};
