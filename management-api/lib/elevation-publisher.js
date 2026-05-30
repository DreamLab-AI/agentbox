'use strict';

/**
 * lib/elevation-publisher — close the WS6 elevation → Nostr federation loop.
 *
 * kg-elevation builds, per high-value candidate, a GOVERNED ontology-propose
 * descriptor (`propose_request`) and an agent_action LINK beam. Until now the
 * proposal never left the box: nothing federated the governed
 * personal→shared-ontology elevation over Nostr, so the moat ("personal→shared
 * ontology elevation federated over Nostr") did not close in code.
 *
 * This module is that closing hop. For each proposal it mints a SIGNED ACSP
 * ActionRequest (kind 31402 — "request a human decision"; agent-control-surface
 * `buildActionRequest`) and publishes it through the ALREADY-CONNECTED
 * NostrBridge. The relay's agent_registry gate + broker_cases projection then
 * surface the elevation in the governance inbox the human approves from — the
 * sanctioned governed path, never the ungoverned /api/ontology/load backdoor.
 *
 * Standalone-or-federated contract (ADR-005):
 *   - The publisher is built ONCE at boot with the resolved manifest. It is a
 *     no-op (returns `{ published: false, reason }`, logged at debug) whenever
 *     the federation surface is unavailable: nostr_bridge gate off, NOSTR_RELAYS
 *     empty, no signing stack, nostr-tools absent, or the key won't decrypt.
 *   - It NEVER throws into the request path: a relay/signing failure for one
 *     proposal degrades to a logged no-op and the existing beam+propose response
 *     is returned unchanged. Federation is additive, never load-bearing.
 *
 * Lifecycle: the bridge connection + signer are owned here, loaded lazily on
 * first publish and cached (mirrors lib/pod-signer). Publication is a thin
 * delegate over agent-control-surface `publishPanelEvent` — no in-request relay
 * connect/disconnect.
 *
 * URN discipline: the panel `d`-tag re-uses the proposal's own canonical
 * `urn:agentbox:thing:<pubkey>:proposal-<sha256-12>` (already minted through
 * lib/uris.js by the extractor) — NIP-33 replaceability keys re-scans of the
 * same concept to the same panel. No ad-hoc identifiers are invented here.
 *
 * @see lib/kg-proposal-extractor.js (produces the proposals)
 * @see lib/agent-control-surface.js (buildActionRequest / publishPanelEvent)
 * @see mcp/servers/nostr-bridge.js (NostrBridge / loadSigner)
 * @see ADR-005 (adapter / standalone-or-federated contract)
 */

const acs = require('./agent-control-surface');

/** Resolve the relay list exactly as NostrBridge would, without constructing it. */
function resolveRelays(env) {
  return (env.NOSTR_RELAYS || '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
}

function nostrBridgeEnabled(manifest) {
  const sm = (manifest && manifest.sovereign_mesh) || {};
  // Either an explicit nostr_bridge gate or the publish_agent_events gate is
  // sufficient intent to federate; both require relays to actually connect.
  return sm.nostr_bridge === true || sm.publish_agent_events === true;
}

/**
 * Build the elevation publisher. Returns an object with a `publish(proposal)`
 * method and an `enabled` flag. When federation is unavailable the returned
 * publisher is inert (`enabled === false`) and every `publish()` resolves to a
 * logged no-op — the caller treats both paths identically.
 *
 * @param {object} manifest - parsed agentbox.toml
 * @param {object} [deps]
 * @param {object}   [deps.logger]            - pino-style logger (debug/warn)
 * @param {object}   [deps.env=process.env]
 * @param {object}   [deps.bridgeModule]      - nostr-bridge module override (tests)
 * @param {object}   [deps.bridge]            - pre-connected NostrBridge override (tests)
 * @param {object}   [deps.signer]            - pre-loaded signer override (tests)
 * @param {Function} [deps.publishPanelEvent] - override for tests
 * @param {object}   [deps.signerOpts]        - forwarded to loadSigner
 * @returns {{ enabled: boolean, reason: string|null,
 *             publish(proposal: object): Promise<object> }}
 */
function buildElevationPublisher(manifest, deps = {}) {
  const env = deps.env || process.env;
  const logger = deps.logger || { debug() {}, warn() {} };
  const publishPanelEvent = deps.publishPanelEvent || acs.publishPanelEvent;

  // ── Static eligibility (decided once, at boot) ──
  let reason = null;
  if (!deps.bridge && !nostrBridgeEnabled(manifest)) {
    reason = 'nostr-bridge-gate-off';
  } else if (!deps.bridge && resolveRelays(env).length === 0) {
    reason = 'no-relays';
  }
  const stack = env.AGENTBOX_STACK || env.AGENTBOX_PROFILE || null;
  if (!reason && !deps.signer && !stack) {
    reason = 'no-signing-stack';
  }

  if (reason) {
    logger.debug({ event: 'elevation-publish.disabled', reason },
      'elevation→Nostr federation inert (standalone or unconfigured)');
    return {
      enabled: false,
      reason,
      async publish() { return { published: false, reason }; },
    };
  }

  // ── Lazy, cached bridge + signer (mirrors lib/pod-signer) ──
  const getBridgeModule = () =>
    deps.bridgeModule || require('../../mcp/servers/nostr-bridge');

  let bridge = deps.bridge || null;
  let signer = deps.signer || null;
  let loadFailed = false;
  let loadFailReason = null;

  function ensureConnected() {
    if (loadFailed) return false;
    if (bridge && signer) return true;
    try {
      const mod = getBridgeModule();
      if (!bridge) {
        bridge = new mod.NostrBridge({ relays: resolveRelays(env) });
        // connect() is fire-and-forget; RelayConnection buffers EVENT frames
        // until the socket opens, so publishing before connect resolves is safe.
        bridge.connect();
      }
      if (!signer) {
        signer = mod.loadSigner(stack, deps.signerOpts || {});
      }
      return true;
    } catch (err) {
      loadFailed = true;
      loadFailReason = err.message;
      logger.warn({ event: 'elevation-publish.load-failed', err: err.message },
        'elevation→Nostr federation unavailable — signing/bridge load failed');
      return false;
    }
  }

  /**
   * Publish ONE proposal as a signed ACSP ActionRequest. Never throws.
   * @param {object} proposal - a kg-proposal-extractor proposal descriptor
   * @returns {Promise<{published:boolean, event_id?:string, reason?:string}>}
   */
  async function publish(proposal) {
    if (!ensureConnected()) {
      return { published: false, reason: loadFailReason || 'load-failed' };
    }
    if (!proposal || !proposal.proposal_urn) {
      return { published: false, reason: 'invalid-proposal' };
    }

    try {
      const cand = proposal.candidate || {};
      // The governed human-decision request. Priority/category/subject tags
      // drive the relay's broker_cases governance inbox projection so the
      // elevation lands where a human approves it — the governed path.
      const unsigned = acs.buildActionRequest({
        panelId: proposal.proposal_urn,           // NIP-33 d-tag = canonical URN
        priority: 'medium',
        category: 'ontology-elevation',
        subjectKind: 'concept',
        subjectId: proposal.target_urn || proposal.proposal_foreign_urn || proposal.proposal_urn,
        title: `Elevate "${cand.term || 'concept'}" to shared ontology`,
        reasoning: Array.isArray(cand.reasons) ? cand.reasons.join(', ') : undefined,
        fields: {
          term: cand.term || null,
          domain: cand.domain || null,
          definition: cand.definition || null,
          score: typeof cand.score === 'number' ? cand.score : null,
          proposal_urn: proposal.proposal_urn,
          target_urn: proposal.target_urn || null,
          proposal_foreign_urn: proposal.proposal_foreign_urn || null,
          // The governed descriptor the operator/ontology bridge then executes.
          propose_request: proposal.propose_request || null,
        },
      });

      const signed = await publishPanelEvent(bridge, signer, unsigned);
      logger.debug(
        { event: 'elevation-publish.ok', proposal_urn: proposal.proposal_urn, event_id: signed && signed.id },
        'governed ontology-elevation proposal published to Nostr'
      );
      return { published: true, event_id: signed ? signed.id : null, kind: unsigned.kind };
    } catch (err) {
      // Federation is additive — a publish failure must not break the response.
      logger.warn(
        { event: 'elevation-publish.error', proposal_urn: proposal && proposal.proposal_urn, err: err.message },
        'elevation→Nostr publish failed — degrading to no-op (beam+propose unaffected)'
      );
      return { published: false, reason: err.message };
    }
  }

  return { enabled: true, reason: null, publish };
}

module.exports = { buildElevationPublisher, resolveRelays, nostrBridgeEnabled };
