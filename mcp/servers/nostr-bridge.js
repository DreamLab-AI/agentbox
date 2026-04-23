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
  AUTH:        27235,  // NIP-98 HTTP auth
  AGENT_STATE: 30078,  // parameterised replaceable — agent state events
  BRIEF_REF:   30000,  // NIP-33 addressable — brief references
  BEAD_REF:    30001,  // NIP-33 addressable — bead/receipt references
  // Generic NIP-33 range constants for subscription filters
  NIP33_MIN:   30000,
  NIP33_MAX:   39999,
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
      });

      ws.on('message', (data) => {
        if (this._onMessage) {
          try {
            const parsed = JSON.parse(data.toString());
            this._onMessage(parsed, this.url);
          } catch { /* malformed JSON — ignore */ }
        }
      });

      ws.on('close', () => {
        this._healthy = false;
        this._ws = null;
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
    this._subscriptions = new Map(); // subId → { filter, handler }
    this._subCounter = 0;

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
    return Promise.resolve();
  }

  /** Close all relay connections. */
  disconnect() {
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

    const subId = `sub-${++this._subCounter}`;
    this._subscriptions.set(subId, { filter: normalisedFilter, handler });

    const reqMsg = JSON.stringify(['REQ', subId, normalisedFilter]);
    for (const conn of this._connections.values()) {
      conn.send(reqMsg);
    }
    return subId;
  }

  /**
   * Cancel a subscription.
   * @param {string} subId - ID returned by subscribe().
   */
  unsubscribe(subId) {
    if (!this._subscriptions.has(subId)) return;
    this._subscriptions.delete(subId);
    const closeMsg = JSON.stringify(['CLOSE', subId]);
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

  // ── Internal message routing ──

  _handleRelayMessage(message, relayUrl) {
    // Relay message shapes: ["EVENT", subId, event], ["EOSE", subId], ["NOTICE", text], ["OK", ...]
    if (!Array.isArray(message) || message.length < 2) return;

    const [type, subId, event] = message;

    if (type === 'EVENT' && event) {
      const sub = this._subscriptions.get(subId);
      if (sub && this._matchesFilter(event, sub.filter)) {
        try {
          sub.handler(event, relayUrl);
        } catch { /* handler errors must not crash the bridge */ }
      }
    }
    // EOSE, NOTICE, OK are informational — no action needed for the library contract
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
