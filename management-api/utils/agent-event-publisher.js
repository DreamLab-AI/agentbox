/**
 * Agent Event Publisher
 *
 * Emits agent action events for visualization in VisionClaw.
 * Events are broadcast via WebSocket and MCP TCP to connected clients.
 */

const EventEmitter = require('events');
const uris = require('../lib/uris');
const taxonomy = require('../lib/failure-taxonomy');
// ADR-2026 provenance closeout: the durable record behind the ring buffer. An
// event evicted from memory must still resolve — a mirrored reference on the
// operator's phone outlives 1,000 events.
const { agentEventArchive } = require('./agent-event-archive');

// Agent action types matching the Rust binary protocol
const AgentActionType = {
  QUERY: 0,      // blue - agent querying data
  UPDATE: 1,     // yellow - agent updating state
  CREATE: 2,     // green - agent creating new entity
  DELETE: 3,     // red - agent removing entity
  LINK: 4,       // purple - agent linking entities
  TRANSFORM: 5   // cyan - agent transforming data
};

class AgentEventPublisher extends EventEmitter {
  constructor(logger) {
    super();
    this.logger = logger || console;
    this.subscribers = new Set();
    this.eventBuffer = [];
    this.maxBufferSize = 1000;
    this.nextEventId = 1;
  }

  /**
   * Subscribe to agent events
   * @param {Function} callback - Called with each event
   * @returns {Function} Unsubscribe function
   */
  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  /**
   * Emit an agent action event
   * @param {Object} event - Agent action event data
   */
  emitAgentAction(event) {
    const fullEvent = {
      version: 3,
      id: this.nextEventId++,
      timestamp: Date.now(),
      type: 'agent_action',
      direction: event.direction || 'outbound',
      ...event,
      // Ensure action_type is a number
      action_type: typeof event.action_type === 'string'
        ? AgentActionType[event.action_type.toUpperCase()] || 0
        : event.action_type || 0
    };

    // Phase 1 of ADR-014 / ADR-059: optional identity attribution.
    // When the caller provides any of these fields they are forwarded;
    // when omitted, the envelope still validates and renders correctly.
    //   source_urn:  did:nostr:<hex> | urn:agentbox:agent:<scope>:<local>
    //   target_urn:  urn:visionclaw:kg:<hex-pubkey>:<sha256-12-hex>  (foreign URN)
    //   pubkey:      did:nostr hex of the agent or its operator
    if (event.source_urn !== undefined) fullEvent.source_urn = event.source_urn;
    if (event.target_urn !== undefined) fullEvent.target_urn = event.target_urn;
    if (event.pubkey !== undefined)     fullEvent.pubkey     = event.pubkey;

    // REC-3 (CTC — contextual transaction cost, emitter side, PRD-019 REC-3 /
    // ADR-037): additive cost/correlation fields matching VisionClaw's PRD-023
    // CTC contract — token burden, the handoff-chain correlation id, and a
    // verification outcome (populated by the REC-8 anti-fox verifier when a
    // closure check ran). Forwarded only when the caller supplies them; an
    // existing success-only caller emits none of them (byte-compatible).
    if (event.token_count !== undefined)  fullEvent.token_count  = event.token_count;
    if (event.handoff_id  !== undefined)  fullEvent.handoff_id   = event.handoff_id;
    if (event.verification !== undefined) fullEvent.verification = event.verification;

    // REC-6 (AC4, PRD-019 / ADR-037 D2): the authority classification the gate
    // resolved for this action (`recoverable` | `zero-tolerance` |
    // `escalation-required`) is recorded on the envelope so a governance/CTC
    // consumer can see which actions were gated and how they were dispositioned.
    // Forwarded only when the caller supplies it — an existing caller that never
    // ran through the authority gate emits none (byte-compatible).
    if (event.authority_class !== undefined) fullEvent.authority_class = event.authority_class;

    // REC-5 (AC3): any action whose outcome is a FAILURE carries a MAST
    // failure_mode tag on the envelope — a mode id or the `unmapped` sentinel,
    // never a free-text error alone. A caller signals failure by passing
    // `outcome:'failure'`, a `failure` context object, or a pre-resolved
    // `failure_mode`. A non-failure event carries no mode (byte-compatible for
    // existing success-only callers).
    //
    // ADR-2015 closeout (2026-09-05) — ONE CANONICAL FAILURE FIELD.
    // The estate review reproduced the same event carrying two different tags:
    // the trajectory mapper wrote its classified mode into
    // `metadata.failure_mode`, while this classifier only looked at a top-level
    // `failure_mode`/`failure` — so a perfectly good FM-1.2 arrived alongside a
    // top-level `unmapped`, and two consumers reading different locations
    // disagreed about the same failure.
    //
    // The canonical wire field is the TOP-LEVEL `failure_mode` on the envelope.
    // `metadata.failure_mode` is a producer-side mirror, and it is PROMOTED
    // here when the top level carries nothing — a producer's specific
    // classification is never discarded in favour of `unmapped`.
    const metaMode = (event.metadata && typeof event.metadata.failure_mode === 'string')
      ? event.metadata.failure_mode
      : null;
    const isFailure = event.outcome === 'failure'
      || (event.metadata && event.metadata.outcome === 'failure')
      || event.failure != null
      || typeof event.failure_mode === 'string'
      || metaMode !== null;
    if (isFailure) {
      if (taxonomy.isTag(fullEvent.failure_mode)) {
        // caller supplied a valid top-level tag — it wins
      } else if (taxonomy.isTag(metaMode)) {
        // promote the producer's mirror rather than classifying an empty context
        fullEvent.failure_mode = metaMode;
      } else {
        const ctx = (event.failure && typeof event.failure === 'object')
          ? event.failure
          : { mode: event.failure_mode || metaMode };
        fullEvent.failure_mode = taxonomy.classify(ctx);
      }
      // Keep the mirror consistent with the canonical field so a consumer that
      // reads either location sees the SAME tag (the disagreement is the bug).
      if (fullEvent.metadata && typeof fullEvent.metadata === 'object') {
        fullEvent.metadata.failure_mode = fullEvent.failure_mode;
      }
    }

    // Auto-populate identity fields from environment ONLY when the caller
    // supplied NEITHER (ADR-2042). source_urn/pubkey are one identity pair:
    // filling each independently could mix a caller-asserted identity (e.g.
    // a verified per-request source_urn from agent-event-auth.js) with the
    // container's own env fallback on the OTHER field — misattributing the
    // event to neither the real actor nor the container consistently. The
    // caller's identity wins whenever it supplied any part of it; the env
    // value is the last resort, applied to both fields together.
    if (fullEvent.source_urn == null && fullEvent.pubkey == null) {
      fullEvent.source_urn = process.env.AGENTBOX_URN
        || process.env.AGENTBOX_DID
        || null;
      fullEvent.pubkey = process.env.AGENTBOX_DID || null;
    }

    // Buffer the event
    this.eventBuffer.push(fullEvent);
    // Durably archive BEFORE eviction can occur, so the retained record and the
    // archived one never diverge. Fail-open: archiving never breaks an emit.
    try { agentEventArchive.append(fullEvent); } catch { /* archive is best-effort */ }
    if (this.eventBuffer.length > this.maxBufferSize) {
      this.eventBuffer.shift();
    }

    // Notify all subscribers
    this.subscribers.forEach(callback => {
      try {
        callback(fullEvent);
      } catch (err) {
        this.logger.error('Agent event subscriber error:', err);
      }
    });

    // Emit on EventEmitter for other listeners
    this.emit('agent_action', fullEvent);
    this.emit('event', fullEvent);

    return fullEvent;
  }

  /**
   * Emit a query action (agent reading data)
   */
  emitQuery(sourceAgentId, targetNodeId, metadata = {}) {
    return this.emitAgentAction({
      source_agent_id: sourceAgentId,
      target_node_id: targetNodeId,
      action_type: AgentActionType.QUERY,
      duration_ms: metadata.duration_ms || 100,
      ...metadata
    });
  }

  /**
   * Emit an update action (agent modifying data)
   */
  emitUpdate(sourceAgentId, targetNodeId, metadata = {}) {
    return this.emitAgentAction({
      source_agent_id: sourceAgentId,
      target_node_id: targetNodeId,
      action_type: AgentActionType.UPDATE,
      duration_ms: metadata.duration_ms || 200,
      ...metadata
    });
  }

  /**
   * Emit a create action (agent creating new entity)
   */
  emitCreate(sourceAgentId, targetNodeId, metadata = {}) {
    return this.emitAgentAction({
      source_agent_id: sourceAgentId,
      target_node_id: targetNodeId,
      action_type: AgentActionType.CREATE,
      duration_ms: metadata.duration_ms || 300,
      ...metadata
    });
  }

  /**
   * Emit a delete action (agent removing entity)
   */
  emitDelete(sourceAgentId, targetNodeId, metadata = {}) {
    return this.emitAgentAction({
      source_agent_id: sourceAgentId,
      target_node_id: targetNodeId,
      action_type: AgentActionType.DELETE,
      duration_ms: metadata.duration_ms || 150,
      ...metadata
    });
  }

  /**
   * Emit a link action (agent connecting entities)
   */
  emitLink(sourceAgentId, targetNodeId, metadata = {}) {
    return this.emitAgentAction({
      source_agent_id: sourceAgentId,
      target_node_id: targetNodeId,
      action_type: AgentActionType.LINK,
      duration_ms: metadata.duration_ms || 250,
      ...metadata
    });
  }

  /**
   * Emit a transform action (agent transforming data)
   */
  emitTransform(sourceAgentId, targetNodeId, metadata = {}) {
    return this.emitAgentAction({
      source_agent_id: sourceAgentId,
      target_node_id: targetNodeId,
      action_type: AgentActionType.TRANSFORM,
      duration_ms: metadata.duration_ms || 350,
      ...metadata
    });
  }

  /**
   * Get recent events from buffer
   */
  getRecentEvents(limit = 100) {
    return this.eventBuffer.slice(-limit);
  }

  /**
   * Create binary payload for AGENT_ACTION message (0x23)
   * Format: [version:1][type:1][source_id:4][target_id:4][action_type:1][timestamp:4][duration:2][payload_len:2]
   */
  createBinaryPayload(event) {
    const payloadJson = JSON.stringify(event.metadata || {});
    const payloadBuffer = Buffer.from(payloadJson, 'utf8');

    // Total: 19 bytes header + payload
    // Header: version(1) + type(1) + source_id(4) + target_id(4) +
    //         action_type(1) + timestamp(4) + duration(2) + payload_len(2) = 19
    const buffer = Buffer.alloc(19 + payloadBuffer.length);

    buffer.writeUInt8(0x02, 0);                          // Version (V2)
    buffer.writeUInt8(0x23, 1);                          // Message type (AGENT_ACTION)
    buffer.writeUInt32LE(event.source_agent_id || 0, 2); // Source agent ID
    buffer.writeUInt32LE(event.target_node_id || 0, 6);  // Target node ID
    buffer.writeUInt8(event.action_type || 0, 10);       // Action type
    buffer.writeUInt32LE(event.timestamp || Date.now(), 11); // Timestamp
    buffer.writeUInt16LE(event.duration_ms || 100, 15);  // Duration
    buffer.writeUInt16LE(payloadBuffer.length, 17);      // Payload length

    // Copy payload if present
    if (payloadBuffer.length > 0) {
      payloadBuffer.copy(buffer, 19);
    }

    return buffer;
  }

  /**
   * Create JSON-RPC notification for MCP/WebSocket broadcast.
   *
   * This is the SINGLE canonical wire-envelope builder (ADR-059 §2: agentbox
   * is the canonical schema source; VisionClaw mirrors this shape in
   * src/agent_events/schema.rs). Every transport — the /v1/agent-events/stream
   * WebSocket and the deprecated MCP-TCP bridge — emits through here, so the
   * ADR-013 identity attribution (source_urn / target_urn / pubkey) is never
   * dropped at the federation boundary. The legacy numeric ids are retained for
   * backward compatibility; the URN/pubkey fields are optional in Phase 1 and
   * become required under fail-closed attribution in Phase 5.
   */
  createMcpNotification(event) {
    return {
      jsonrpc: '2.0',
      method: 'notifications/agent_action',
      params: {
        type: 'agent_action',
        event: {
          version: 3,
          id: event.id,
          source_agent_id: event.source_agent_id,
          target_node_id: event.target_node_id,
          action_type: event.action_type,
          action_type_name: Object.keys(AgentActionType).find(
            k => AgentActionType[k] === event.action_type
          )?.toLowerCase() || 'query',
          timestamp: event.timestamp,
          duration_ms: event.duration_ms,
          source_urn: event.source_urn || null,
          target_urn: event.target_urn || null,
          pubkey: event.pubkey || null,
          // REC-5: MAST failure tag forwarded on the wire (null on success).
          failure_mode: event.failure_mode || null,
          // REC-3: CTC fields on the wire — token burden, handoff-chain id, and
          // verification outcome. Null when absent → byte-compatible with
          // existing consumers (same discipline as failure_mode above).
          token_count: (typeof event.token_count === 'number') ? event.token_count : null,
          handoff_id: event.handoff_id || null,
          verification: event.verification || null,
          // REC-6 (AC4): authority classification on the wire — null when the
          // action never ran through the gate (byte-compatible, same discipline).
          authority_class: event.authority_class || null,
          metadata: event.metadata || {}
        },
        message_type: 0x23,   // AGENT_ACTION — binary-frame parity (ADR-059 §1)
        protocol_version: 2,
        timestamp: new Date().toISOString()
      }
    };
  }
}

// Export singleton and types
const agentEventPublisher = new AgentEventPublisher();

module.exports = {
  AgentEventPublisher,
  AgentActionType,
  agentEventPublisher
};
