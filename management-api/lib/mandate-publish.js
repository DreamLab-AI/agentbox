'use strict';

/**
 * lib/mandate-publish — publish a signed mandate event and know it landed (AB-11).
 *
 * The kind-30078 mandate envelope used to be signed and dropped. Here it goes
 * to `NOSTR_RELAYS` through `NostrBridge`, as server.js buildVoiceIntentDispatcher
 * does, and the publish only counts as a success when the LOCAL relay
 * (`ws://127.0.0.1:7777`) answers OK: the local relay is the authoritative copy
 * the rest of the mesh syncs from, so "published" without it is not published.
 * Other relays are best effort and reported.
 *
 * The bridge is connected lazily on first use and kept; a relay that is down at
 * that moment is reconnected by the bridge itself.
 */

const DEFAULT_REQUIRED_RELAY = 'ws://127.0.0.1:7777';

const normRelay = (u) => String(u || '').trim().replace(/\/+$/, '');

function relaysFromEnv(env = process.env) {
  return String(env.NOSTR_RELAYS || '').split(',').map((r) => r.trim()).filter(Boolean);
}

function loadBridgeModule() {
  const candidates = [process.env.NOSTR_BRIDGE_PATH, './nostr-bridge', '../../mcp/servers/nostr-bridge',
    '/opt/agentbox/mcp/servers/nostr-bridge.js'].filter(Boolean);
  for (const c of candidates) {
    try { return require(c); } catch { /* next */ }
  }
  throw new Error(`nostr-bridge unresolvable (tried ${candidates.length} paths)`);
}

/**
 * @param {object} [opts]
 * @param {object} [opts.env]
 * @param {string[]} [opts.relays]            - override NOSTR_RELAYS
 * @param {string} [opts.requiredRelay]       - must answer OK (default ws://127.0.0.1:7777)
 * @param {number} [opts.timeoutMs]
 * @param {(relays: string[]) => object} [opts.bridgeFactory] - returns a bridge with connect/publishSigned/disconnect
 * @returns {{ publish(event: object): Promise<{ ok: boolean, reason?: string, results: object }>, close(): Promise<void> }}
 */
function createPublisher(opts = {}) {
  const env = opts.env || process.env;
  const required = normRelay(opts.requiredRelay || env.AGENTBOX_MANDATE_REQUIRED_RELAY || DEFAULT_REQUIRED_RELAY);
  const timeoutMs = opts.timeoutMs || 5000;
  let bridge = null;

  async function getBridge(relays) {
    if (bridge) return bridge;
    const make = opts.bridgeFactory || ((r) => { const { NostrBridge } = loadBridgeModule(); return new NostrBridge({ relays: r }); });
    const b = make(relays);
    await b.connect();
    bridge = b;
    return b;
  }

  return {
    async publish(event) {
      const relays = (opts.relays || relaysFromEnv(env));
      if (relays.length === 0) return { ok: false, reason: 'NOSTR_RELAYS is not set', results: {} };
      const configured = relays.map(normRelay);
      if (!configured.includes(required)) {
        return { ok: false, reason: `the required relay ${required} is not in NOSTR_RELAYS`, results: {} };
      }
      let results;
      try {
        const b = await getBridge(relays);
        results = await b.publishSigned(event, { timeoutMs });
      } catch (err) {
        return { ok: false, reason: `relay publish failed: ${err.message}`, results: {} };
      }
      // Compare on the normalised URL: the bridge keys results by the URL as configured.
      const byNorm = Object.fromEntries(Object.entries(results).map(([u, r]) => [normRelay(u), r]));
      const req = byNorm[required];
      if (!req || req.ok !== true) {
        return { ok: false, reason: `${required} did not accept the event: ${req ? req.message : 'no answer'}`, results };
      }
      return { ok: true, results };
    },
    async close() {
      if (!bridge) return;
      try { await bridge.disconnect(); } catch (_) { /* ignore */ }
      bridge = null;
    },
  };
}

module.exports = { createPublisher, DEFAULT_REQUIRED_RELAY, relaysFromEnv };
