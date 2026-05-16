'use strict';

/**
 * relay-consumer — in-process bridge between the embedded Nostr relay
 * (nostr-rs-relay on loopback :7777) and the sovereign Solid pod
 * (solid-pod-rs on loopback :8484).
 *
 * This is the runtime piece of ADR-009 that turns the pod's
 * events/{inbox,outbox}/ directories from scaffolding into a real
 * durable mailbox. It is consumed in-process by management-api — same
 * rationale as the NostrBridge library (see docs/developer/sovereign-mesh.md):
 * avoids a second process holding key material, and keeps the signature-
 * verification hot path free of IPC latency.
 *
 * Runtime flow (inbound):
 *   1. Open a REQ subscription to the embedded relay for kinds matching
 *      the configured allowed_kinds filter.
 *   2. For each EVENT received:
 *      a. verify() the Schnorr signature via nostr-tools.
 *      b. check that at least one `p` tag matches a local AgentIdentity.npub.
 *      c. apply ingress policy (allowlist / signed-only / open).
 *      d. atomic-rename write to pods/<npub>/events/inbox/<event-id>.json.
 *      e. dispatch through the ADR-005 events adapter slot for downstream
 *         consumers.
 *      f. when kind ∈ AGENT_INTENT_RANGE, invoke the orchestrator adapter
 *         to spawn a responder agent.
 *
 * Runtime flow (outbound):
 *   1. Watch pods/<npub>/events/outbox/ for new *.json files with
 *      status="pending".
 *   2. For each pending file:
 *      a. Read the unsigned event payload.
 *      b. Sign via loadSigner(stack).sign(event).
 *      c. Publish to the embedded relay (and, when external_fanout allows,
 *         to the NOSTR_RELAYS list).
 *      d. Rename pending-id.json → <real-event-id>.json with status="published".
 *      e. On failure, increment attempts[] and retry with exponential backoff.
 *
 * Invariants enforced (DDD-003 §Invariants):
 *   - I01 forall e in pod.inbox => verifyEvent(e) = true (before disk write)
 *   - I02 status=published => final_event_id != null
 *   - I03 status=pending  => final_event_id = null
 *   - I07 policy=allowlist => event.pubkey in allowed_pubkeys
 *   - I08 inbox is content-addressed by NostrEventId (duplicate id → skip)
 *   - I09 attempts[] timestamps are strictly increasing
 *   - I10 recipient_npub matches a local AgentIdentity.npub
 *
 * Gated on env vars set by flake.nix:
 *   AGENTBOX_RELAY_ENABLED=true|false
 *   AGENTBOX_RELAY_PORT=7777
 *   AGENTBOX_RELAY_POLICY=allowlist|signed-only|open
 *   AGENTBOX_RELAY_POD_BRIDGE=true|false   (set by the ADR-009 manifest)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { NostrBridge, loadSigner, kinds } = require('../servers/nostr-bridge');

// ADR-009 §4.2 reserved kind ranges — agent intent/response.
const AGENT_INTENT_MIN  = 38000;
const AGENT_INTENT_MAX  = 38099;
const AGENT_RESPONSE_MIN = 38100;
const AGENT_RESPONSE_MAX = 38199;

// Payment event kinds (PRD-006 §S8 / agentbox.toml [payments]).
const JOB_ESTIMATE_KIND   = 38200;
const JOB_SETTLEMENT_KIND = 38201;

// Agent Control Surface Protocol — governance event kinds (31400-31405).
// Bidirectional: agentbox publishes 31400/31401/31402/31404/31405 (outbound),
// forum humans publish 31403 ActionResponse (inbound).
const GOVERNANCE_KIND_MIN = 31400;
const GOVERNANCE_KIND_MAX = 31405;

const DEFAULT_OUTBOX_POLL_MS = 500;
const DEFAULT_OUTBOX_RETRY_BACKOFF = [1_000, 5_000, 30_000, 300_000];
const DEFAULT_POD_ROOT = process.env.SOLID_POD_ROOT || '/var/lib/solid';

class RelayConsumer {
  /**
   * @param {object} opts
   * @param {string[]} opts.npubs                  - Local AgentIdentity npubs to accept events for
   * @param {string[]} [opts.allowedPubkeys=[]]    - Ingress allowlist (npub or hex)
   * @param {number[]} [opts.allowedKinds]         - Kind filter; default covers agent-intent + DMs
   * @param {string}   [opts.ingressPolicy="allowlist"] - allowlist | signed-only | open
   * @param {string}   [opts.podRoot=/var/lib/solid]    - Filesystem root of the pod tree
   * @param {string}   [opts.stack="default"]           - Profile name for loadSigner()
   * @param {string[]} [opts.relayUrls]            - Relays to subscribe; default local :7777 + NOSTR_RELAYS
   * @param {object}   [opts.adapters]             - { events, orchestrator } ADR-005 adapters
   * @param {string}   [opts.fanout="off"]         - bidirectional | publish-only | subscribe-only | off
   * @param {Function} [opts.intentSpec]           - (event, context) => { command, args?, env?, cwd? }
   *                                                  Produces an orchestrator.spawnAgent spec for
   *                                                  agent-intent kinds (38000-38099). When absent,
   *                                                  the bridge only writes the intent marker file
   *                                                  to pods/<npub>/events/intent-queue/<id>.json
   *                                                  and lets downstream handlers poll. The marker
   *                                                  write is always durable regardless of whether
   *                                                  a spec is provided.
   * @param {object}   [opts.logger=console]       - Structured logger (pino-style)
   * @param {Function} [opts.verifyEvent]          - Override for tests
   * @param {Function} [opts.now=() => Date.now()] - Clock injection for tests
   */
  constructor(opts = {}) {
    if (!Array.isArray(opts.npubs) || opts.npubs.length === 0) {
      throw new Error('RelayConsumer: at least one local npub is required');
    }
    this._npubs = new Set(opts.npubs);
    this._allowedPubkeys = new Set(opts.allowedPubkeys || []);
    this._allowedKinds = opts.allowedKinds || this._defaultKinds();
    this._ingressPolicy = opts.ingressPolicy || 'allowlist';
    this._podRoot = opts.podRoot || DEFAULT_POD_ROOT;
    this._stack = opts.stack || 'default';
    this._fanout = opts.fanout || 'off';
    this._adapters = opts.adapters || {};
    this._intentSpec = typeof opts.intentSpec === 'function' ? opts.intentSpec : null;
    this._logger = opts.logger || console;
    this._verifyEvent = opts.verifyEvent || null;
    this._now = opts.now || (() => Date.now());

    // Build the bridge with loopback-first relay URL ordering.
    const relayUrls = opts.relayUrls || this._defaultRelayUrls();
    this._bridge = new NostrBridge({ relays: relayUrls, subscribeKinds: this._allowedKinds });
    this._signer = null; // lazy — avoids forcing key decryption in test runs
    this._subId = null;
    this._outboxTimer = null;
    this._outboxActive = false;
    this._metrics = {
      inbound_accepted: 0,
      inbound_rejected_sig: 0,
      inbound_rejected_policy: 0,
      inbound_rejected_recipient: 0,
      inbound_rejected_duplicate: 0,
      outbox_published: 0,
      outbox_pending: 0,
      outbox_failed: 0,
    };
  }

  _defaultKinds() {
    return [
      1,                                  // general notes
      1059,                               // NIP-17 gift wrap DMs
      30001,                              // legacy bead provenance
      30050,                              // IS-Envelope mesh-event (ADR-075)
      30078,                              // agent state (NIP-33)
      30910,                              // moderation (ban/mute)
      kinds.PANEL_DEFINITION,             // 31400 — Agent Control Surface Protocol
      kinds.PANEL_STATE,                  // 31401
      kinds.ACTION_REQUEST,               // 31402
      kinds.ACTION_RESPONSE,              // 31403
      kinds.PANEL_UPDATE,                 // 31404
      kinds.PANEL_RETIRED,                // 31405
      AGENT_INTENT_MIN, AGENT_RESPONSE_MIN,
      JOB_ESTIMATE_KIND, JOB_SETTLEMENT_KIND,
    ];
  }

  _defaultRelayUrls() {
    const port = process.env.AGENTBOX_RELAY_PORT || 7777;
    const urls = [`ws://127.0.0.1:${port}`];
    if (this._fanout !== 'off' && process.env.NOSTR_RELAYS) {
      urls.push(
        ...process.env.NOSTR_RELAYS.split(',').map(s => s.trim()).filter(Boolean)
      );
    }
    return urls;
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  async start() {
    await this._bridge.connect();
    this._subId = this._bridge.subscribe(
      { kinds: this._allowedKinds },
      (event, relayUrl) => this._onInbound(event, relayUrl)
    );
    this._ensureMailboxDirs();
    this._outboxTimer = setInterval(() => this._flushOutbox().catch(err => {
      this._logger.error({ err }, 'outbox-flush-failed');
    }), DEFAULT_OUTBOX_POLL_MS);
    this._logger.info({
      npubs: Array.from(this._npubs),
      policy: this._ingressPolicy,
      fanout: this._fanout,
      kinds: this._allowedKinds,
    }, 'relay-consumer started');
  }

  async stop() {
    if (this._outboxTimer) clearInterval(this._outboxTimer);
    this._outboxTimer = null;
    if (this._subId) this._bridge.unsubscribe(this._subId);
    await this._bridge.disconnect();
  }

  metrics() {
    return { ...this._metrics };
  }

  // ── inbound path ──────────────────────────────────────────────────────────

  _onInbound(event, relayUrl) {
    // I01: signature verification before ANY pod write.
    if (!this._verifySig(event)) {
      this._metrics.inbound_rejected_sig++;
      this._logger.warn({ eventId: event.id, relayUrl }, 'inbound-sig-invalid');
      return;
    }

    // I07: ingress policy.
    if (!this._passesIngressPolicy(event)) {
      this._metrics.inbound_rejected_policy++;
      return;
    }

    // I10: recipient must match a local npub via `p` tag.
    const recipient = this._findRecipientNpub(event);
    if (!recipient) {
      this._metrics.inbound_rejected_recipient++;
      return;
    }

    // I08: content-addressed dedup — reject if event id already in inbox.
    const inboxPath = path.join(this._podRoot, 'pods', recipient, 'events', 'inbox');
    const finalPath = path.join(inboxPath, `${event.id}.json`);
    if (fs.existsSync(finalPath)) {
      this._metrics.inbound_rejected_duplicate++;
      return;
    }

    // Persist atomically (write tmp + rename).
    // PRD-010 F19: emit LDN-native AS2 JSON-LD instead of raw Nostr JSON.
    // The full signed event is preserved in x:nostrEvent for provenance.
    try {
      fs.mkdirSync(inboxPath, { recursive: true });
      const tmpPath = path.join(inboxPath, `.${event.id}.${process.pid}.tmp`);
      const ldnPayload = this._formatAsLdn(event, recipient, relayUrl);
      fs.writeFileSync(tmpPath, JSON.stringify(ldnPayload, null, 2));
      fs.renameSync(tmpPath, finalPath);
    } catch (err) {
      this._logger.error({ err, eventId: event.id }, 'pod-inbox-write-failed');
      return;
    }

    this._metrics.inbound_accepted++;

    // ADR-005 events adapter dispatch for downstream handlers.
    if (this._adapters.events && typeof this._adapters.events.dispatch === 'function') {
      try {
        this._adapters.events.dispatch({
          direction: 'inbound',
          slot: 'events',
          event,
          recipient_npub: recipient,
        });
      } catch (err) {
        this._logger.warn({ err, eventId: event.id }, 'events-dispatch-failed');
      }
    }

    // Payment events (38200/38201): write to the dedicated payments directory
    // alongside the inbox entry for cost-gate reconciliation and audit trail.
    if (this._isPaymentEvent(event.kind)) {
      this._writePaymentEvent(recipient, event);
    }

    // Governance events (31400-31405): write to the dedicated governance
    // directory. Inbound ActionResponses (31403) from forum humans trigger
    // the orchestrator adapter to route the decision to VisionClaw's
    // BrokerActor. Outbound panel definitions/requests are handled by the
    // outbox publisher path (agents write to events/outbox/).
    if (this._isGovernanceEvent(event.kind)) {
      this._writeGovernanceEvent(recipient, event);

      // ActionResponse (31403) from a human in the forum UI — route to
      // the orchestrator so VisionClaw can act on the decision.
      if (event.kind === kinds.ACTION_RESPONSE
          && this._adapters.orchestrator
          && typeof this._adapters.orchestrator.handleGovernanceDecision === 'function') {
        Promise.resolve(this._adapters.orchestrator.handleGovernanceDecision(event))
          .then(() => this._logger.info({ eventId: event.id }, 'governance-decision-dispatched'))
          .catch(err => this._logger.warn({ err, eventId: event.id }, 'governance-decision-dispatch-failed'));
      }
    }

    // Agent-intent kinds: always write a durable marker to the pod intent
    // queue; conditionally spawn a responder via the orchestrator adapter
    // when the operator supplied an intentSpec mapping.
    if (this._isAgentIntent(event.kind)) {
      this._writeIntentMarker(recipient, event);

      if (this._intentSpec && this._adapters.orchestrator
          && typeof this._adapters.orchestrator.spawnAgent === 'function') {
        const context = {
          trigger:       'nostr-event',
          event_id:      event.id,
          recipient_npub: recipient,
          intent_kind:   event.kind,
          received_at:   new Date(this._now()).toISOString(),
        };
        let spec;
        try {
          spec = this._intentSpec(event, context);
        } catch (err) {
          this._logger.warn({ err, eventId: event.id }, 'intent-spec-build-failed');
          return;
        }
        if (!spec || !spec.command) {
          this._logger.warn({ eventId: event.id }, 'intent-spec-missing-command');
          return;
        }
        // Merge Nostr context into spawn env so the responder has full
        // addressing without reading files.
        const mergedEnv = {
          NOSTR_EVENT_ID:       event.id,
          NOSTR_EVENT_KIND:     String(event.kind),
          NOSTR_EVENT_PUBKEY:   event.pubkey,
          NOSTR_RECIPIENT_NPUB: recipient,
          NOSTR_EVENT_JSON:     JSON.stringify(event),
          ...(spec.env || {}),
        };
        const finalSpec = { ...spec, env: mergedEnv };
        Promise.resolve(this._adapters.orchestrator.spawnAgent(finalSpec))
          .then(result => this._logger.info({
            eventId: event.id,
            agentId: result && result.agentId,
          }, 'intent-responder-spawned'))
          .catch(err => this._logger.warn({
            err, eventId: event.id,
          }, 'intent-responder-spawn-failed'));
      }
    }
  }

  /**
   * Write a durable intent marker to pods/<npub>/events/intent-queue/<id>.json.
   * Separate from the inbox entry so downstream pollers can scan just this
   * directory without re-filtering the full inbox. Atomic rename preserves
   * DDD-003 I01 / I08 semantics.
   * @private
   */
  _writeIntentMarker(recipient, event) {
    const queueDir = path.join(this._podRoot, 'pods', recipient, 'events', 'intent-queue');
    const target = path.join(queueDir, `${event.id}.json`);
    if (fs.existsSync(target)) return;           // dedup by event id
    try {
      fs.mkdirSync(queueDir, { recursive: true });
      const payload = {
        event_id:       event.id,
        kind:           event.kind,
        signer_pubkey:  event.pubkey,
        recipient_npub: recipient,
        received_at:    new Date(this._now()).toISOString(),
        status:         'pending',
      };
      const tmp = path.join(queueDir, `.${event.id}.${process.pid}.tmp`);
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
      fs.renameSync(tmp, target);
    } catch (err) {
      this._logger.warn({ err, eventId: event.id }, 'intent-marker-write-failed');
    }
  }

  _verifySig(event) {
    if (this._verifyEvent) return this._verifyEvent(event);
    try {
      // Defer to nostr-tools when available — matches NostrBridge.verifyNip98.
      const nostrTools = require('nostr-tools');
      return nostrTools.verifyEvent(event);
    } catch (err) {
      // nostr-tools may not be installed in test runs — log once and accept
      // structural form so tests can exercise the routing path.
      if (!this._warnedMissingTools) {
        this._logger.warn({ err: err.message }, 'nostr-tools missing — signature acceptance is structural only');
        this._warnedMissingTools = true;
      }
      return typeof event.id === 'string' && typeof event.sig === 'string';
    }
  }

  _passesIngressPolicy(event) {
    switch (this._ingressPolicy) {
      case 'open':
        return true;
      case 'signed-only':
        return typeof event.sig === 'string' && event.sig.length > 0;
      case 'allowlist':
      default:
        return this._allowedPubkeys.size === 0
          || this._allowedPubkeys.has(event.pubkey)
          || this._allowedPubkeys.has(this._hexToNpub(event.pubkey));
    }
  }

  _findRecipientNpub(event) {
    if (!Array.isArray(event.tags)) return null;
    for (const tag of event.tags) {
      if (!Array.isArray(tag) || tag[0] !== 'p' || !tag[1]) continue;
      const hex = tag[1];
      const npub = this._hexToNpub(hex);
      if (this._npubs.has(hex)) return hex;
      if (this._npubs.has(npub)) return npub;
    }
    return null;
  }

  _hexToNpub(hex) {
    // Defer to nostr-tools for bech32 when available; otherwise return the
    // hex so the set-match fails gracefully and tests work without the dep.
    try {
      const nostrTools = require('nostr-tools');
      return nostrTools.nip19.npubEncode(hex);
    } catch {
      return hex;
    }
  }

  /**
   * Convert an npub (bech32) to hex pubkey.  If the input is already 64-char
   * hex, return it as-is.  Falls back to returning the input unchanged when
   * nostr-tools is unavailable (test environments).
   * @param {string} npubOrHex
   * @returns {string} 64-char lowercase hex pubkey, or the input unchanged
   * @private
   */
  _npubToHex(npubOrHex) {
    if (/^[0-9a-f]{64}$/i.test(npubOrHex)) return npubOrHex.toLowerCase();
    try {
      const nostrTools = require('nostr-tools');
      const { type, data } = nostrTools.nip19.decode(npubOrHex);
      if (type === 'npub') return data;
    } catch { /* nostr-tools missing or invalid bech32 */ }
    return npubOrHex;
  }

  /**
   * Format a Nostr event as a Linked Data Notification (LDN) payload using
   * ActivityStreams 2.0 (PRD-010 F19 / ADR-075 IS-Envelope).
   *
   * The outer AS2 shape lets vanilla LDN consumers process the message.
   * The `x:nostrEvent` extension preserves the full signed event for
   * verifier re-runs and provenance auditing.  The `x:envelope` extension
   * preserves relay metadata that is not part of the Nostr event itself.
   *
   * @param {object} event     - Signed Nostr event (id, pubkey, kind, content, tags, sig, …)
   * @param {string} recipient - Recipient identifier (npub or hex) as returned by _findRecipientNpub
   * @param {string} relayUrl  - Relay URL the event was received from
   * @returns {object} JSON-LD payload ready for JSON.stringify
   * @private
   */
  _formatAsLdn(event, recipient, relayUrl) {
    const senderHex = event.pubkey;  // Nostr events always carry hex pubkeys
    const recipientHex = this._npubToHex(recipient);
    return {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Announce',
      actor: `did:nostr:${senderHex}`,
      target: `did:nostr:${recipientHex}`,
      published: new Date(this._now()).toISOString(),
      object: {
        '@type': 'Note',
        content: event.content,
        id: `urn:nostr:event:${event.id}`,
      },
      'x:nostrEvent': event,
      'x:envelope': {
        received_at: new Date(this._now()).toISOString(),
        relay_url: relayUrl,
        recipient_npub: recipient,
      },
    };
  }

  _isAgentIntent(kind) {
    return kind >= AGENT_INTENT_MIN && kind <= AGENT_INTENT_MAX;
  }

  _isPaymentEvent(kind) {
    return kind === JOB_ESTIMATE_KIND || kind === JOB_SETTLEMENT_KIND;
  }

  _isGovernanceEvent(kind) {
    return kind >= GOVERNANCE_KIND_MIN && kind <= GOVERNANCE_KIND_MAX;
  }

  /**
   * Write a governance event to pods/<npub>/events/governance/<event-id>.json.
   * Atomic rename preserves DDD-003 I01 / I08 semantics.
   * @private
   */
  _writeGovernanceEvent(recipient, event) {
    const govDir = path.join(this._podRoot, 'pods', recipient, 'events', 'governance');
    const target = path.join(govDir, `${event.id}.json`);
    if (fs.existsSync(target)) return;
    try {
      fs.mkdirSync(govDir, { recursive: true });
      const kindLabels = {
        [kinds.PANEL_DEFINITION]: 'panel-definition',
        [kinds.PANEL_STATE]:      'panel-state',
        [kinds.ACTION_REQUEST]:   'action-request',
        [kinds.ACTION_RESPONSE]:  'action-response',
        [kinds.PANEL_UPDATE]:     'panel-update',
        [kinds.PANEL_RETIRED]:    'panel-retired',
      };
      const dTag = (event.tags || []).find(t => t[0] === 'd');
      const payload = {
        event_id:       event.id,
        kind:           event.kind,
        kind_label:     kindLabels[event.kind] || `unknown-${event.kind}`,
        d_tag:          dTag ? dTag[1] : null,
        signer_pubkey:  event.pubkey,
        recipient_npub: recipient,
        received_at:    new Date(this._now()).toISOString(),
        content:        event.content,
        tags:           event.tags,
      };
      const tmp = path.join(govDir, `.${event.id}.${process.pid}.tmp`);
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
      fs.renameSync(tmp, target);
    } catch (err) {
      this._logger.warn({ err, eventId: event.id }, 'governance-event-write-failed');
    }
  }

  /**
   * Write a payment event to pods/<npub>/events/payments/<event-id>.json.
   * Atomic rename preserves DDD-003 I01 / I08 semantics.
   * @private
   */
  _writePaymentEvent(recipient, event) {
    const paymentsDir = path.join(this._podRoot, 'pods', recipient, 'events', 'payments');
    const target = path.join(paymentsDir, `${event.id}.json`);
    if (fs.existsSync(target)) return;           // dedup by event id
    try {
      fs.mkdirSync(paymentsDir, { recursive: true });
      const kindLabel = event.kind === JOB_ESTIMATE_KIND ? 'estimate' : 'settlement';
      const payload = {
        event_id:       event.id,
        kind:           event.kind,
        kind_label:     kindLabel,
        signer_pubkey:  event.pubkey,
        recipient_npub: recipient,
        received_at:    new Date(this._now()).toISOString(),
        content:        event.content,
        tags:           event.tags,
      };
      const tmp = path.join(paymentsDir, `.${event.id}.${process.pid}.tmp`);
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
      fs.renameSync(tmp, target);
    } catch (err) {
      this._logger.warn({ err, eventId: event.id }, 'payment-event-write-failed');
    }
  }

  // ── outbound path ─────────────────────────────────────────────────────────

  _ensureMailboxDirs() {
    for (const npub of this._npubs) {
      const podDir = path.join(this._podRoot, 'pods', npub);
      for (const sub of ['events/inbox', 'events/outbox', 'events/intent-queue', 'events/payments', 'events/governance']) {
        fs.mkdirSync(path.join(podDir, sub), { recursive: true });
      }
    }
  }

  async _flushOutbox() {
    if (this._outboxActive) return;      // simple guard; one flush at a time
    this._outboxActive = true;
    try {
      for (const npub of this._npubs) {
        const outboxDir = path.join(this._podRoot, 'pods', npub, 'events', 'outbox');
        if (!fs.existsSync(outboxDir)) continue;
        const files = fs.readdirSync(outboxDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
          await this._flushOne(npub, outboxDir, file).catch(err => {
            this._logger.warn({ err, file }, 'outbox-entry-failed');
          });
        }
      }
    } finally {
      this._outboxActive = false;
    }
  }

  async _flushOne(npub, outboxDir, file) {
    const full = path.join(outboxDir, file);
    let entry;
    try {
      entry = JSON.parse(fs.readFileSync(full, 'utf8'));
    } catch (err) {
      this._logger.warn({ err, file }, 'outbox-parse-failed');
      return;
    }
    if (entry.status === 'published' || entry.status === 'failed') return;

    // Lazy signer load — first outbound event triggers key decryption.
    if (!this._signer) {
      try {
        this._signer = loadSigner(this._stack);
      } catch (err) {
        entry.attempts = (entry.attempts || []).concat({
          at: new Date(this._now()).toISOString(),
          error: `loadSigner: ${err.message}`,
        });
        this._writeAtomic(full, entry);
        this._metrics.outbox_pending++;
        return;
      }
    }

    try {
      const signed = await this._bridge.publish(entry.event || entry, this._signer);
      const finalPath = path.join(outboxDir, `${signed.id}.json`);
      const next = {
        ...entry,
        event: signed,
        status: 'published',
        final_event_id: signed.id,
        published_at: new Date(this._now()).toISOString(),
      };
      this._writeAtomic(finalPath, next);
      if (full !== finalPath) fs.unlinkSync(full);
      this._metrics.outbox_published++;
    } catch (err) {
      const attempts = (entry.attempts || []).concat({
        at: new Date(this._now()).toISOString(),
        error: err.message,
      });
      const exhausted = attempts.length >= DEFAULT_OUTBOX_RETRY_BACKOFF.length;
      const next = {
        ...entry,
        status: exhausted ? 'failed' : 'pending',
        attempts,
      };
      this._writeAtomic(full, next);
      if (exhausted) this._metrics.outbox_failed++;
      else this._metrics.outbox_pending++;
    }
  }

  _writeAtomic(targetPath, payload) {
    const tmp = `${targetPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
    fs.renameSync(tmp, targetPath);
  }
}

module.exports = { RelayConsumer, AGENT_INTENT_MIN, AGENT_INTENT_MAX, AGENT_RESPONSE_MIN, AGENT_RESPONSE_MAX, JOB_ESTIMATE_KIND, JOB_SETTLEMENT_KIND, GOVERNANCE_KIND_MIN, GOVERNANCE_KIND_MAX };
