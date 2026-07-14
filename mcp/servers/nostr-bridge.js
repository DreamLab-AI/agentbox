/**
 * nostr-bridge — Nostr client library for agentbox.
 *
 * ARCHITECTURE DECISION: library-only, consumed in-process by management-api.
 * Rationale:
 *   - verifyNip98() is synchronous and called on every authenticated request;
 *     IPC round-trips would add latency for no gain.
 *   - Key material (nostr.key.enc) is already under management-api's boot
 *     lifecycle; sharing it with a separate process requires a second decrypt
 *     path or an inter-process secret transport, both of which expand the
 *     attack surface.
 *   - supervisord granularity is not needed: relay connectivity is a
 *     dependency of management-api, not an independent workload.
 *
 * There is therefore NO supervisord [program:nostr-bridge] block.
 * The [sovereign_mesh].nostr_bridge = true gate in agentbox.toml signals to
 * the entrypoint that management-api should call NostrBridge.connect() at boot.
 *
 * Usage:
 *   const { NostrBridge, loadSigner, kinds } = require('./nostr-bridge');
 *   const bridge = new NostrBridge({ relays: ['wss://relay.damus.io'] });
 *   await bridge.connect();
 *   bridge.subscribe([kinds.AGENT_STATE], (event) => { ... });
 *   await bridge.publish(unsignedEvent, signer);
 *   await bridge.disconnect();
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');

// nostr-tools is in mcp/package.json — require from a path that will resolve
// once installed.  The dynamic require keeps the module loadable when
// nostr-tools is absent (e.g. sovereign_mesh.nostr_bridge = false) so the
// rest of management-api starts cleanly.
let nostrTools;
function getNostrTools() {
  if (!nostrTools) {
    try {
      nostrTools = require('nostr-tools');
    } catch (err) {
      throw new Error(
        'nostr-tools is not installed. Add it to mcp/package.json and run npm install. ' +
        `Original error: ${err.message}`
      );
    }
  }
  return nostrTools;
}

// ─── Kind constants ────────────────────────────────────────────────────────────

const kinds = Object.freeze({
  AUTH:            27235,  // NIP-98 HTTP auth
  CLIENT_AUTH:     22242,  // NIP-42 relay session auth (ephemeral)
  AGENT_STATE:     30078,  // parameterised replaceable — agent state events
  BRIEF_REF:       30000,  // NIP-33 addressable — brief references
  BEAD_REF:        30001,  // NIP-33 addressable — bead/receipt references
  // Agent Control Surface Protocol (kinds 31400-31405)
  PANEL_DEFINITION: 31400, // agent publishes interactive control panel schema
  PANEL_STATE:      31401, // agent publishes current panel data snapshot
  ACTION_REQUEST:   31402, // agent requests human decision
  ACTION_RESPONSE:  31403, // human responds to action request
  PANEL_UPDATE:     31404, // agent publishes incremental state diff
  PANEL_RETIRED:    31405, // agent retires a control panel
  JOB_ESTIMATE:    38200,  // agent job cost estimate (payment system)
  JOB_SETTLEMENT:  38201,  // agent job receipt/settlement (payment system)
  // Generic NIP-33 range constants for subscription filters
  NIP33_MIN:       30000,
  NIP33_MAX:       39999,
});

// ─── Relay connection ──────────────────────────────────────────────────────────

const DEFAULT_BACKOFF_BASE_MS  = 1_000;
const DEFAULT_BACKOFF_MAX_MS   = 60_000;
const DEFAULT_BACKOFF_FACTOR   = 2;
const MAX_JITTER_MS            = 500;
const VERIFY_NIP98_WINDOW_S    = 60;

/**
 * Manages one WebSocket connection to a single Nostr relay.
 * Handles reconnection with exponential backoff.
 *
 * @private
 */
class RelayConnection {
  constructor(url, options = {}) {
    this.url          = url;
    this._backoffBase = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this._backoffMax  = options.backoffMaxMs  ?? DEFAULT_BACKOFF_MAX_MS;
    this._backoffFact = options.backoffFactor ?? DEFAULT_BACKOFF_FACTOR;
    this._WebSocket   = options.WebSocket     ?? require('ws');
    this._ws          = null;
    this._healthy     = false;
    this._attempt     = 0;
    this._destroyed   = false;
    this._pending     = [];   // buffered messages awaiting open
    this._onMessage   = null; // set by NostrBridge after construction
    this._reconnectTimer = null;
    // WebSocket keepalive (liveness detection). Cloudflare Worker /
    // Durable-Object relays stop pushing live events to an idle subscription
    // within ~20s and never send a TCP FIN, so 'close' never fires and the
    // socket sits ESTABLISHED while effectively deaf (observed 2026-06-13: a
    // mention posted ~25s after connect got no delivery; the same mention ~6s
    // after connect was delivered in 1.9s). A periodic ping keeps the
    // connection warm; a missed pong forces terminate() so 'close' drives a
    // reconnect that re-AUTHs (NIP-42) and replays every REQ. Interval is
    // deliberately under the ~20s idle-death window.
    this._pingMs       = options.pingIntervalMs ?? 12000;
    this._pingTimer    = null;
    this._awaitingPong = false;
  }

  get healthy() { return this._healthy; }

  connect() {
    if (this._destroyed) return;
    this._attempt += 1;
    try {
      const ws = new this._WebSocket(this.url);
      this._ws = ws;

      ws.on('open', () => {
        this._healthy = true;
        this._attempt = 0;
        const flush = this._pending.splice(0);
        for (const msg of flush) ws.send(msg);
        this._startKeepalive(ws);
      });

      ws.on('message', (data) => {
        if (this._onMessage) {
          try {
            const parsed = JSON.parse(data.toString());
            this._onMessage(parsed, this.url);
          } catch { /* malformed JSON — ignore */ }
        }
      });

      // Relay answered our keepalive ping — connection is still live.
      ws.on('pong', () => { this._awaitingPong = false; });

      ws.on('close', () => {
        this._healthy = false;
        this._ws = null;
        this._stopKeepalive();
        if (!this._destroyed) this._scheduleReconnect();
      });

      ws.on('error', () => {
        // 'close' fires after 'error'; let the close handler drive reconnect
        this._healthy = false;
      });
    } catch (err) {
      this._healthy = false;
      if (!this._destroyed) this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    const delay = Math.min(
      this._backoffBase * Math.pow(this._backoffFact, this._attempt - 1),
      this._backoffMax
    ) + Math.random() * MAX_JITTER_MS;
    this._reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  _startKeepalive(ws) {
    this._stopKeepalive();
    this._awaitingPong = false;
    this._pingTimer = setInterval(() => {
      if (!this._ws || this._ws.readyState !== 1 /* OPEN */) return;
      if (this._awaitingPong) {
        // No pong since the previous ping — the relay went unresponsive
        // (or its Durable-Object subscription was evicted). Force the socket
        // closed so the 'close' handler reconnects, re-AUTHs and replays REQs.
        try { this._ws.terminate(); } catch { /* ignore */ }
        return;
      }
      this._awaitingPong = true;
      try { this._ws.ping(); } catch { /* ignore */ }
    }, this._pingMs);
    // Keepalive must not keep the process alive on shutdown.
    if (this._pingTimer && this._pingTimer.unref) this._pingTimer.unref();
  }

  _stopKeepalive() {
    if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; }
    this._awaitingPong = false;
  }

  send(message) {
    const serialised = typeof message === 'string' ? message : JSON.stringify(message);
    if (this._ws && this._ws.readyState === 1 /* OPEN */) {
      this._ws.send(serialised);
    } else {
      this._pending.push(serialised);
    }
  }

  disconnect() {
    this._destroyed = true;
    this._stopKeepalive();
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
    if (this._ws) {
      try { this._ws.close(); } catch { /* ignore */ }
      this._ws = null;
    }
    this._healthy = false;
  }
}

// ─── NostrBridge ──────────────────────────────────────────────────────────────

/**
 * Main Nostr client class.
 *
 * @example
 * const bridge = new NostrBridge({
 *   relays: process.env.NOSTR_RELAYS.split(','),
 *   subscribeKinds: [kinds.AUTH, kinds.AGENT_STATE],
 * });
 * await bridge.connect();
 */
class NostrBridge {
  /**
   * @param {object}   options
   * @param {string[]} options.relays           - Relay WebSocket URLs.
   * @param {number[]} [options.subscribeKinds] - Default subscription kinds.
   * @param {object}   [options.relayOptions]   - Forwarded to RelayConnection.
   * @param {Function} [options.WebSocket]      - Injected WS constructor (for tests).
   */
  constructor(options = {}) {
    const relayUrls = options.relays
      ?? (process.env.NOSTR_RELAYS || '')
          .split(',')
          .map(r => r.trim())
          .filter(Boolean);

    if (!Array.isArray(relayUrls) || relayUrls.length === 0) {
      throw new Error('NostrBridge: at least one relay URL is required');
    }

    this._subscribeKinds = options.subscribeKinds ?? [
      kinds.AUTH,
      kinds.AGENT_STATE,
      kinds.BRIEF_REF,
      kinds.BEAD_REF,
    ];

    this._WebSocket = options.WebSocket ?? null;
    this._relayOpts = options.relayOptions ?? {};

    this._connections = new Map(); // url → RelayConnection
    // Caller-facing map: the stableId is what subscribe() returns and
    // unsubscribe() accepts — it NEVER changes for the life of the subscription.
    // `wireId` is the id actually present in the REQ/CLOSE frames on the wire; it
    // is ROTATED on every post-AUTH replay (see _replaySubscriptions) because
    // Cloudflare Durable-Object relays do NOT restart live delivery when a KNOWN
    // subId is re-REQ'd — they only begin pushing for a FRESH subId. Reusing the
    // id on reconnect+re-AUTH is exactly why junkiejarvis went deaf after its
    // first reconnect. Keeping stableId ≠ wireId lets the public subscribe/
    // unsubscribe contract stay intact while the wire id rotates underneath.
    this._subscriptions = new Map(); // stableId → { filter, handler, wireId }
    this._wireIndex = new Map();     // wireId → stableId  (inbound EVENT routing)
    this._subCounter = 0;
    this._authSigner = null; // NIP-42 session signer (setAuthSigner)
    this._pendingAuth = new Map(); // relayUrl → in-flight NIP-42 AUTH event id

    // Subscription-level keepalive (distinct from RelayConnection's socket
    // ping/pong). A Cloudflare Durable-Object relay stops PUSHING to an idle
    // subscription ~20s after its last REQ regardless of socket liveness. The
    // post-AUTH fresh-id re-issue (_replaySubscriptions) only fires on
    // reconnect — but the socket ping keeps the connection warm, so on a
    // healthy link NO reconnect ever happens and the subscription is never
    // refreshed. It therefore goes deaf ~20s after boot and stays deaf (the
    // "junkiejarvis answers at startup then goes quiet" symptom that survived
    // the reconnect-only fix). This timer re-issues every active subscription
    // under a fresh wire id on an interval UNDER that ~20s window, independent
    // of reconnects — the same reason dreamlab-ai-website's DmSession (ADR-042)
    // pokes the relay on a 12s timer. Set to 0 to disable (tests).
    this._subRefreshMs = options.subRefreshIntervalMs ?? 15000;
    this._subRefreshTimer = null;

    for (const url of relayUrls) {
      const connOpts = { ...this._relayOpts };
      if (this._WebSocket) connOpts.WebSocket = this._WebSocket;
      const conn = new RelayConnection(url, connOpts);
      conn._onMessage = this._handleRelayMessage.bind(this);
      this._connections.set(url, conn);
    }
  }

  // ── Lifecycle ──

  /** Open connections to all configured relays. */
  connect() {
    for (const conn of this._connections.values()) {
      conn.connect();
    }
    this._startSubRefresh();
    return Promise.resolve();
  }

  /** Close all relay connections. */
  disconnect() {
    this._stopSubRefresh();
    for (const conn of this._connections.values()) {
      conn.disconnect();
    }
    return Promise.resolve();
  }

  /** Per-relay health map: { [url]: boolean } */
  health() {
    const result = {};
    for (const [url, conn] of this._connections.entries()) {
      result[url] = conn.healthy;
    }
    return result;
  }

  // ── Subscribe ──

  /**
   * Subscribe to events matching the given filter.
   *
   * @param {object|number[]} filter  - Nostr filter object OR array of kind numbers
   *                                    (convenience: auto-wraps in `{ kinds }` filter).
   * @param {Function}        handler - Called with each matching event.
   * @returns {string} Subscription ID (pass to unsubscribe).
   */
  subscribe(filter, handler) {
    const normalisedFilter = Array.isArray(filter)
      ? { kinds: filter }
      : (filter ?? { kinds: this._subscribeKinds });

    // stableId is returned to the caller (and is what unsubscribe() expects).
    // The initial wireId equals it; it rotates on each post-AUTH replay. Inbound
    // EVENT frames are routed back to this record via _wireIndex.
    const stableId = `sub-${++this._subCounter}`;
    const wireId = stableId;
    this._subscriptions.set(stableId, { filter: normalisedFilter, handler, wireId });
    this._wireIndex.set(wireId, stableId);

    const reqMsg = JSON.stringify(['REQ', wireId, normalisedFilter]);
    for (const conn of this._connections.values()) {
      conn.send(reqMsg);
    }
    return stableId;
  }

  /**
   * Cancel a subscription.
   * @param {string} subId - ID returned by subscribe().
   */
  unsubscribe(subId) {
    const sub = this._subscriptions.get(subId);
    if (!sub) return;
    this._subscriptions.delete(subId);
    this._wireIndex.delete(sub.wireId);
    // CLOSE the id currently live on the wire (the rotated wireId, which differs
    // from the caller's stable subId once a post-AUTH replay has run).
    const closeMsg = JSON.stringify(['CLOSE', sub.wireId]);
    for (const conn of this._connections.values()) {
      conn.send(closeMsg);
    }
  }

  // ── Publish ──

  /**
   * Sign and publish an event to all connected relays.
   *
   * @param {object}          unsignedEvent - Event without id/sig/pubkey.
   * @param {{ sign(event): Promise<object> }} signer - Produced by loadSigner().
   * @returns {Promise<object>} The signed event.
   *
   * NOTE: never log the signer object or any field from it — it holds the
   * private key material in memory.
   */
  async publish(unsignedEvent, signer) {
    if (!signer || typeof signer.sign !== 'function') {
      throw new TypeError('publish: signer must have a sign(event) method');
    }
    const signedEvent = await signer.sign(unsignedEvent);

    const eventMsg = JSON.stringify(['EVENT', signedEvent]);
    for (const conn of this._connections.values()) {
      conn.send(eventMsg);
    }
    return signedEvent;
  }

  // ── NIP-98 verify ──

  /**
   * Verify a NIP-98 HTTP Auth header, now with full Schnorr signature check.
   *
   * Replaces the structural-only check in management-api/middleware/auth.js.
   * The middleware delegates here when nostr-tools is available and sovereign_mesh
   * is enabled.
   *
   * @param {string} authHeader - The raw Authorization header value.
   * @param {string} method     - Expected HTTP method (e.g. 'GET').
   * @param {string} url        - Expected request URL (full or path).
   * @returns {{ valid: boolean, pubkey: string|null, error: string|null }}
   */
  static verifyNip98(authHeader, method, url) {
    if (!authHeader || !authHeader.startsWith('Nostr ')) {
      return { valid: false, pubkey: null, error: 'missing or malformed Nostr header' };
    }

    const encoded = authHeader.slice('Nostr '.length).trim();
    if (!encoded) {
      return { valid: false, pubkey: null, error: 'empty token' };
    }

    let event;
    try {
      event = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    } catch {
      return { valid: false, pubkey: null, error: 'token is not valid base64 JSON' };
    }

    if (event.kind !== kinds.AUTH) {
      return { valid: false, pubkey: null, error: `expected kind ${kinds.AUTH}, got ${event.kind}` };
    }

    if (typeof event.created_at !== 'number') {
      return { valid: false, pubkey: null, error: 'missing created_at' };
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - event.created_at) > VERIFY_NIP98_WINDOW_S) {
      return { valid: false, pubkey: null, error: 'event timestamp out of 60-second window' };
    }

    // Extract tags
    const getTag = (key) => {
      const tag = Array.isArray(event.tags)
        ? event.tags.find(t => Array.isArray(t) && t[0] === key)
        : null;
      return tag ? tag[1] : null;
    };

    const methodTag = getTag('method');
    const urlTag    = getTag('u');

    if (!methodTag || methodTag.toUpperCase() !== method.toUpperCase()) {
      return { valid: false, pubkey: null, error: 'method tag mismatch' };
    }

    if (!urlTag || (urlTag !== url && !urlTag.endsWith(url))) {
      return { valid: false, pubkey: null, error: 'url tag mismatch' };
    }

    // Schnorr signature verification via nostr-tools
    // Uses constant-time secp256k1 verification internally — no timing oracle.
    try {
      const { verifyEvent } = getNostrTools();
      const valid = verifyEvent(event);
      if (!valid) {
        return { valid: false, pubkey: null, error: 'invalid Schnorr signature' };
      }
    } catch (err) {
      return { valid: false, pubkey: null, error: `signature verification failed: ${err.message}` };
    }

    return { valid: true, pubkey: event.pubkey, error: null };
  }

  /**
   * Originate a NIP-98 `Authorization` header value for an outbound HTTP
   * request — the signing counterpart of {@link verifyNip98}. Used by the
   * pods adapter so an autonomous agent presents a provable identity to a
   * default-deny Solid pod instead of going out anonymous (PRD-014 Seam C
   * / C2).
   *
   * The kind-27235 event carries the `u` (URL) and `method` tags the
   * verifier checks, plus a `payload` tag (`hex(sha256(body))`) when the
   * request has a body, per NIP-98. The `u` tag is signed WITHOUT any
   * query string: solid-pod-rs reconstructs the expected URL from
   * `req.uri().path()` and compares after trimming a trailing slash, so a
   * signed query would never match.
   *
   * @param {{ sign(event: object): Promise<object> }} signer - from loadSigner().
   * @param {string} method - HTTP method (case-insensitive).
   * @param {string} url - Full request URL; the query string is stripped.
   * @param {object} [opts]
   * @param {string|Buffer} [opts.body] - Request body for the payload hash.
   * @returns {Promise<string>} `Nostr <base64(json(signedEvent))>`.
   */
  static async buildNip98Header(signer, method, url, opts = {}) {
    if (!signer || typeof signer.sign !== 'function') {
      throw new Error('buildNip98Header: a signer with sign(event) is required');
    }
    const queryAt = String(url).indexOf('?');
    const uTag = queryAt === -1 ? String(url) : String(url).slice(0, queryAt);

    const tags = [
      ['u', uTag],
      ['method', String(method).toUpperCase()],
    ];

    const { body } = opts;
    if (body !== undefined && body !== null && body !== '') {
      const buf = Buffer.isBuffer(body)
        ? body
        : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
      if (buf.length > 0) {
        tags.push(['payload', crypto.createHash('sha256').update(buf).digest('hex')]);
      }
    }

    const unsigned = {
      kind: kinds.AUTH,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: '',
    };
    const signed = await signer.sign(unsigned);
    const encoded = Buffer.from(JSON.stringify(signed), 'utf8').toString('base64');
    return `Nostr ${encoded}`;
  }

  // ── Payment events ──

  /**
   * Create, sign, and publish a kind 38200 job cost estimate event.
   *
   * @param {object} jobData
   * @param {string} jobData.job_id           - Unique job identifier (used as NIP-33 `d` tag).
   * @param {string} jobData.endpoint         - Skill/endpoint being invoked.
   * @param {number} jobData.estimated_sats   - Estimated cost in satoshis.
   * @param {number} jobData.hold_sats        - Hold amount (estimated * buffer ratio).
   * @param {number} jobData.dream_tokens     - Equivalent DREAM token cost.
   * @param {number} jobData.rate             - DREAM-per-sat rate at time of estimate.
   * @param {string} jobData.requester_pubkey - Hex pubkey of the requesting agent/user.
   * @param {{ sign(event): Promise<object> }} signer - Produced by loadSigner().
   * @returns {Promise<object>} The signed event.
   */
  async publishJobEstimate(jobData, signer) {
    const event = {
      kind: kinds.JOB_ESTIMATE,
      content: JSON.stringify({
        job_id: jobData.job_id,
        endpoint: jobData.endpoint,
        estimated_sats: jobData.estimated_sats,
        hold_sats: jobData.hold_sats,
        dream_tokens: jobData.dream_tokens,
        rate: jobData.rate,
      }),
      tags: [
        ['d', jobData.job_id],
        ['p', jobData.requester_pubkey],
        ['t', 'job-estimate'],
        ['endpoint', jobData.endpoint],
      ],
      created_at: Math.floor(Date.now() / 1000),
    };
    return this.publish(event, signer);
  }

  /**
   * Create, sign, and publish a kind 38201 job settlement event.
   *
   * @param {object} settlementData
   * @param {string} settlementData.job_id             - Job identifier matching the estimate.
   * @param {number} settlementData.actual_sats        - Actual cost in satoshis.
   * @param {number} settlementData.refund_sats        - Refund amount (hold - actual).
   * @param {string} settlementData.status             - 'settled' or 'failed'.
   * @param {string} settlementData.requester_pubkey   - Hex pubkey of the requesting agent/user.
   * @param {string} settlementData.estimate_event_id  - Event ID of the originating estimate.
   * @param {{ sign(event): Promise<object> }} signer  - Produced by loadSigner().
   * @returns {Promise<object>} The signed event.
   */
  async publishJobSettlement(settlementData, signer) {
    const event = {
      kind: kinds.JOB_SETTLEMENT,
      content: JSON.stringify({
        job_id: settlementData.job_id,
        actual_sats: settlementData.actual_sats,
        refund_sats: settlementData.refund_sats,
        status: settlementData.status,
      }),
      tags: [
        ['d', settlementData.job_id],
        ['p', settlementData.requester_pubkey],
        ['e', settlementData.estimate_event_id],
        ['t', 'job-settlement'],
      ],
      created_at: Math.floor(Date.now() / 1000),
    };
    return this.publish(event, signer);
  }

  /**
   * Subscribe to payment job events (estimates + settlements) for a pubkey.
   *
   * @param {string}   pubkey  - Hex pubkey to filter `p` tags against.
   * @param {Function} handler - Called with each matching event.
   * @returns {string} Subscription ID (pass to unsubscribe).
   */
  subscribeJobEvents(pubkey, handler) {
    return this.subscribe(
      { kinds: [kinds.JOB_ESTIMATE, kinds.JOB_SETTLEMENT], '#p': [pubkey] },
      handler
    );
  }

  // ── NIP-42 relay session auth ──

  /**
   * Register a signer used to answer NIP-42 ["AUTH", <challenge>] frames.
   * Same { sign(unsignedEvent) } contract as publish(). Zone-gated relays
   * (e.g. the DreamLab forum relay) withhold non-public events from
   * unauthenticated sessions — without this, subscriptions silently receive
   * only public-zone traffic.
   *
   * NOTE: never log the signer or any field from it — it fronts private key
   * material.
   *
   * @param {{ sign(event: object): Promise<object>|object }} signer
   */
  setAuthSigner(signer) {
    if (!signer || typeof signer.sign !== 'function') {
      throw new TypeError('setAuthSigner: signer must have a sign(event) method');
    }
    this._authSigner = signer;
  }

  /**
   * Answer a relay's NIP-42 challenge on the socket that issued it, then
   * RE-SEND every active subscription on that socket: relays evaluate REQs
   * against the session state at REQ time, so pre-AUTH subscriptions stay
   * locked to the unauthenticated view until replayed.
   *
   * Fail-open: a signing or send failure is swallowed — the session simply
   * stays unauthenticated (public-zone view), it never crashes the bridge.
   *
   * @private
   */
  async _handleAuthChallenge(challenge, relayUrl) {
    if (!this._authSigner) return; // no signer registered — stay unauth
    const conn = this._connections.get(relayUrl);
    if (!conn) return;
    try {
      const unsigned = {
        kind: kinds.CLIENT_AUTH,
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ['relay', relayUrl],
          ['challenge', challenge],
        ],
        content: '',
      };
      const signed = await this._authSigner.sign(unsigned);
      conn.send(JSON.stringify(['AUTH', signed]));
      // Defer the subscription replay until the relay ACKNOWLEDGES the AUTH with
      // ["OK", <authId>, true] (handled in _handleRelayMessage). Replaying in the
      // SAME tick races the relay's async AUTH verification on Durable-Object
      // relays (Cloudflare): the REQ is evaluated against the still-
      // unauthenticated session, so gated-zone events (friends/family/business)
      // are silently withheld until the next reconnect — the exact "jarvis
      // receives at startup then goes quiet" symptom. Fallback: replay after
      // 1.2s if the relay omits the AUTH ack.
      this._pendingAuth.set(relayUrl, signed.id);
      setTimeout(() => {
        if (this._pendingAuth.get(relayUrl) === signed.id) {
          this._pendingAuth.delete(relayUrl);
          this._replaySubscriptions(relayUrl);
        }
      }, 1200);
      // One-line breadcrumb only — never the challenge or event contents.
      console.log(`[bridge] NIP-42 AUTH sent to ${relayUrl}`);
    } catch { /* fail-open: unauthenticated session keeps its public view */ }
  }

  /**
   * Re-issue every active subscription under a FRESH wire subId so the relay
   * both re-evaluates the REQ against the now-authenticated session AND actually
   * resumes live delivery. Called once the NIP-42 AUTH is acknowledged with OK
   * (or via the fallback timer) — see _handleAuthChallenge.
   *
   * Why a fresh id (the junkiejarvis-deafness fix): Cloudflare Durable-Object
   * relays do NOT restart live push when a KNOWN subId is re-REQ'd — a re-REQ of
   * an existing subscription is a no-op for delivery. Only a CLOSE of the stale
   * id followed by a REQ under a brand-new id makes the Durable Object start
   * pushing again. The old code re-sent the SAME subId, so after the first
   * reconnect+re-AUTH the session re-authenticated but the subscription stayed
   * deaf — the exact "jarvis receives at startup then goes quiet" symptom. This
   * mirrors dreamlab-ai-website src/lib/nostr.ts (ADR-042 DmSession), which for
   * the same reason never re-REQs a live subId and mints a fresh one each time.
   *
   * The caller-facing stableId is preserved (unsubscribe() keeps working); only
   * the wireId rotates, and _wireIndex is rekeyed so inbound EVENT routing
   * resolves to the handler under the new id. CLOSE(old)+REQ(new) is broadcast
   * to ALL connections so the single global wireId stays consistent across
   * relays; because a fresh id RESTORES (never suppresses) delivery, re-issuing
   * on an already-authenticated relay is safe.
   *
   * Fail-open: RelayConnection.send buffers or drops on a dead socket; a replay
   * failure never crashes the bridge.
   * @private
   */
  _replaySubscriptions(relayUrl) {
    if (!this._connections.get(relayUrl)) return;
    this._refreshSubscriptions(`post-AUTH to ${relayUrl}`);
  }

  /**
   * Rotate every active subscription onto a FRESH wire subId (CLOSE old + REQ
   * new) across all connections. Shared by the post-AUTH replay
   * (_replaySubscriptions) and the idle keepalive timer (_startSubRefresh).
   *
   * Why a fresh id, not a re-REQ of the same id: Cloudflare Durable-Object
   * relays do NOT restart live push when a KNOWN subId is re-REQ'd — only a
   * CLOSE of the stale id followed by a REQ under a brand-new id makes the DO
   * begin pushing again. The caller-facing stableId is preserved (unsubscribe()
   * keeps working); only the wireId rotates, and _wireIndex is rekeyed so
   * inbound EVENT routing resolves to the handler under the new id.
   *
   * The stored filter is re-issued VERBATIM every time — deliberately no `since`
   * floor. NIP-59 gift wraps (kind 1059) carry a RANDOMISED created_at up to ~2
   * days in the past, so any `since` filter would silently drop legitimately-new
   * DMs. The agent dedups the resulting historical re-delivery by event id.
   *
   * Fail-open: RelayConnection.send buffers or drops on a dead socket; a rotate
   * failure never crashes the bridge.
   * @private
   */
  _refreshSubscriptions(reason) {
    const conns = Array.from(this._connections.values());
    if (conns.length === 0 || this._subscriptions.size === 0) return;
    let count = 0;
    for (const [stableId, sub] of this._subscriptions.entries()) {
      const oldWire = sub.wireId;
      const newWire = `sub-${++this._subCounter}`;
      this._wireIndex.delete(oldWire);
      sub.wireId = newWire;
      this._wireIndex.set(newWire, stableId);
      const closeMsg = JSON.stringify(['CLOSE', oldWire]);
      const reqMsg   = JSON.stringify(['REQ', newWire, sub.filter]);
      for (const conn of conns) {
        conn.send(closeMsg);
        conn.send(reqMsg);
      }
      count += 1;
    }
    console.log(`[bridge] re-issued ${count} subscription(s) under fresh ids ${reason}`);
  }

  /**
   * Start the subscription-level keepalive: every _subRefreshMs, re-issue all
   * active subscriptions under fresh wire ids so a Durable-Object relay keeps
   * pushing even when the warm socket never reconnects. See the constructor's
   * _subRefreshMs note for the failure mode this prevents.
   * @private
   */
  _startSubRefresh() {
    this._stopSubRefresh();
    if (!(this._subRefreshMs > 0)) return;
    this._subRefreshTimer = setInterval(() => {
      if (this._subscriptions.size === 0) return;
      // Only poke while a socket is actually open. When every link is down the
      // reconnect + post-AUTH replay re-issues anyway, and send() would just
      // buffer into _pending and flush stale on the next open.
      const anyHealthy = Array.from(this._connections.values()).some((c) => c.healthy);
      if (!anyHealthy) return;
      this._refreshSubscriptions('idle-keepalive');
    }, this._subRefreshMs);
    // Must not keep the process alive on shutdown.
    if (this._subRefreshTimer && this._subRefreshTimer.unref) this._subRefreshTimer.unref();
  }

  /** @private */
  _stopSubRefresh() {
    if (this._subRefreshTimer) { clearInterval(this._subRefreshTimer); this._subRefreshTimer = null; }
  }

  // ── Internal message routing ──

  _handleRelayMessage(message, relayUrl) {
    // Relay message shapes: ["EVENT", subId, event], ["EOSE", subId],
    // ["NOTICE", text], ["OK", ...], ["AUTH", challenge] (NIP-42)
    if (!Array.isArray(message) || message.length < 2) return;

    const [type, subId, event] = message;

    if (type === 'AUTH' && typeof subId === 'string' && subId.length > 0) {
      // subId slot carries the challenge string for AUTH frames.
      this._handleAuthChallenge(subId, relayUrl)
        .catch(() => { /* fail-open */ });
      return;
    }

    if (type === 'EVENT' && event) {
      // Relays tag EVENT frames with the WIRE subId; resolve it to the stable
      // subscription record, since the wire id rotates across post-AUTH replays.
      const stableId = this._wireIndex.get(subId);
      const sub = stableId ? this._subscriptions.get(stableId) : undefined;
      if (sub && this._matchesFilter(event, sub.filter)) {
        try {
          sub.handler(event, relayUrl);
        } catch { /* handler errors must not crash the bridge */ }
      }
      return;
    }

    if (type === 'OK') {
      // ["OK", <eventId>, <accepted>, <msg>]. When it acks our in-flight NIP-42
      // AUTH event, the relay session is now authenticated — replay every
      // subscription so gated zones start delivering. (subId carries the event
      // id; the accepted bool is message[2].)
      if (this._pendingAuth.get(relayUrl) === subId) {
        this._pendingAuth.delete(relayUrl);
        if (message[2] === true) this._replaySubscriptions(relayUrl);
      }
      return;
    }
    // EOSE, NOTICE are informational — no action needed for the library contract
  }

  _matchesFilter(event, filter) {
    if (filter.kinds && !filter.kinds.includes(event.kind)) return false;
    if (filter.authors && !filter.authors.includes(event.pubkey)) return false;
    if (filter.since && event.created_at < filter.since) return false;
    if (filter.until && event.created_at > filter.until) return false;
    return true;
  }
}

// ─── loadSigner ───────────────────────────────────────────────────────────────

/**
 * Load and decrypt the Nostr private key for a given stack profile.
 *
 * The key is stored at `/workspace/profiles/<stack>/nostr.key.enc`
 * encrypted with AES-256-GCM.  The passphrase is derived from
 * MANAGEMENT_API_KEY + a profile-local salt stored in the same directory.
 *
 * The raw private key is held only in memory (a Buffer) and is never logged.
 * The returned signer object exposes only a `sign(event)` method.
 *
 * @param {string}  stack            - Profile/stack name.
 * @param {object}  [opts]
 * @param {string}  [opts.profilesRoot='/workspace/profiles'] - Override for tests.
 * @param {string}  [opts.managementKey]  - Override MANAGEMENT_API_KEY.
 * @returns {{ sign(event: object): Promise<object> }}
 */
function loadSigner(stack, opts = {}) {
  const profilesRoot   = opts.profilesRoot   ?? '/workspace/profiles';
  const managementKey  = opts.managementKey  ?? process.env.MANAGEMENT_API_KEY;

  if (!managementKey) {
    throw new Error('loadSigner: MANAGEMENT_API_KEY is not set');
  }

  const encPath  = `${profilesRoot}/${stack}/nostr.key.enc`;
  const saltPath = `${profilesRoot}/${stack}/nostr.salt`;

  const encryptedBuf = fs.readFileSync(encPath);
  const saltHex      = fs.readFileSync(saltPath, 'utf8').trim();
  const salt         = Buffer.from(saltHex, 'hex');

  // Derive a 32-byte key from MANAGEMENT_API_KEY + salt via PBKDF2-SHA256
  // 100 000 iterations matches the sovereign-bootstrap.py writer.
  const derivedKey = crypto.pbkdf2Sync(managementKey, salt, 100_000, 32, 'sha256');

  // File layout: 12-byte IV | 16-byte GCM auth tag | ciphertext
  const iv         = encryptedBuf.subarray(0, 12);
  const authTag    = encryptedBuf.subarray(12, 28);
  const ciphertext = encryptedBuf.subarray(28);

  const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv);
  decipher.setAuthTag(authTag);
  const privKeyHex = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('hex');

  // Zero the derived key from memory as soon as we're done
  derivedKey.fill(0);

  // Return a signer object — never expose the raw key outside this closure.
  return {
    async sign(unsignedEvent) {
      const { finalizeEvent, getPublicKey } = getNostrTools();
      // nostr-tools expects a Uint8Array for the private key
      const privKeyBytes = Buffer.from(privKeyHex, 'hex');
      const event = finalizeEvent(unsignedEvent, privKeyBytes);
      // Overwrite the local Uint8Array view; the hex string in the closure
      // remains until GC but never leaves this module.
      privKeyBytes.fill(0);
      return event;
    },
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  NostrBridge,
  loadSigner,
  kinds,
};
