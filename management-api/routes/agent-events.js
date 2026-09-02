/**
 * Agent Events WebSocket Route
 *
 * Provides real-time agent action streaming to VisionClaw.
 * Supports both JSON and binary protocols for efficiency.
 *
 * WebSocket: /v1/agent-events/stream
 * HTTP: /v1/agent-events (recent events)
 *       /v1/agent-events/emit (trigger event - for testing/integration)
 */

const { agentEventPublisher, AgentActionType } = require('../utils/agent-event-publisher');
const { verifyAgentEventRequest, reconcileSourceUrn } = require('../lib/agent-event-auth');
const taxonomy = require('../lib/failure-taxonomy');
const { processHookEvent, getRegistryStats } = require('../hooks/agent-action-hooks');
const { initializeAgentEventWsSubscriber, getAgentEventWsSubscriber } = require('../utils/agent-event-ws-subscriber');

async function agentEventsRoutes(fastify, options) {
  const { logger, metrics } = options;

  // Store active WebSocket connections
  const wsConnections = new Set();

  // Subscribe to agent events and broadcast to all WebSocket clients
  agentEventPublisher.subscribe((event) => {
    const notification = agentEventPublisher.createMcpNotification(event);
    const jsonMessage = JSON.stringify(notification);

    wsConnections.forEach((socket) => {
      try {
        if (socket.readyState === 1) { // OPEN
          if (socket.binaryMode) {
            // Send binary payload
            const binaryPayload = agentEventPublisher.createBinaryPayload(event);
            socket.send(binaryPayload);
          } else {
            // Send JSON
            socket.send(jsonMessage);
          }
        }
      } catch (err) {
        logger.error('WebSocket send error:', err);
      }
    });

    // Track metrics
    metrics?.recordAgentEvent?.(event.action_type);
  });

  /**
   * WebSocket endpoint for real-time agent event streaming
   */
  fastify.get('/v1/agent-events/stream', { websocket: true }, (socket, req) => {
    logger.info('Agent events WebSocket client connected');

    // Configure socket
    socket.binaryMode = req.query.binary === 'true';
    socket.filters = {
      agentTypes: req.query.agents ? req.query.agents.split(',') : null,
      actionTypes: req.query.actions ? req.query.actions.split(',').map(a => AgentActionType[a.toUpperCase()]) : null
    };

    wsConnections.add(socket);

    // Send initial handshake
    socket.send(JSON.stringify({
      type: 'connected',
      protocol: socket.binaryMode ? 'binary' : 'json',
      version: '2.0.0',
      timestamp: new Date().toISOString(),
      message_type: 0x23, // AGENT_ACTION
      filters: socket.filters
    }));

    // Send recent events
    const recentEvents = agentEventPublisher.getRecentEvents(50);
    if (recentEvents.length > 0) {
      socket.send(JSON.stringify({
        type: 'history',
        events: recentEvents,
        count: recentEvents.length
      }));
    }

    // Handle incoming messages (configuration, acknowledgments)
    socket.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());

        if (data.type === 'configure') {
          // Update filters
          if (data.binary !== undefined) {
            socket.binaryMode = data.binary;
          }
          if (data.filters) {
            socket.filters = data.filters;
          }
          socket.send(JSON.stringify({ type: 'configured', filters: socket.filters }));
        }

        if (data.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }

      } catch (err) {
        logger.debug('WebSocket message parse error:', err.message);
      }
    });

    socket.on('close', () => {
      logger.info('Agent events WebSocket client disconnected');
      wsConnections.delete(socket);
    });

    socket.on('error', (err) => {
      logger.error('Agent events WebSocket error:', err);
      wsConnections.delete(socket);
    });
  });

  /**
   * GET /v1/agent-events - Get recent agent events
   */
  fastify.get('/v1/agent-events', {
    schema: {
      description: 'Get recent agent action events',
      tags: ['agent-events'],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 100, minimum: 1, maximum: 1000 },
          since: { type: 'integer', description: 'Timestamp to filter events after' },
          // REC-9 (PRD-019 §REC-9 / ADR-037 D5): resolve a SINGLE record by its
          // canonical urn (or numeric event id). This is the provenance
          // resolver's landing target — /v1/uri/<urn> 307-redirects here as
          // ?id=<urn>. When set, the window params are bypassed and the one
          // matching record is returned (or 404 when the reference is unknown).
          id: { type: 'string', description: 'Resolve a single event by its urn:agentbox:activity reference or numeric id' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            events: {
              type: 'array',
              items: {
                // additionalProperties:true so an id-resolved record keeps its
                // identity/provenance fields (source_urn, target_urn, pubkey,
                // token_count, …) instead of the serializer silently dropping
                // them — otherwise a resolved provenance reference would come
                // back stripped of the very attribution it exists to carry.
                type: 'object',
                additionalProperties: true,
                properties: {
                  id: { type: 'integer' },
                  timestamp: { type: 'integer' },
                  source_agent_id: { type: 'integer' },
                  target_node_id: { type: 'integer' },
                  action_type: { type: 'integer' },
                  action_type_name: { type: 'string' },
                  duration_ms: { type: 'integer' }
                }
              }
            },
            count: { type: 'integer' },
            // Echo of the resolved reference (null on a window query).
            id: { type: ['string', 'null'] },
            timestamp: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { limit = 100, since, id } = request.query;

    // REC-9 (PRD-019 §REC-9 / ADR-037 D5): honour an explicit id/urn lookup.
    // The provenance resolver lands a reference here (/v1/uri/<urn> → 307 →
    // /v1/agent-events?id=<urn>). Before this branch the id was ignored and the
    // route returned an arbitrary recent-events window, so a mirrored turn's
    // urn:agentbox:activity reference resolved to nothing — the item's own
    // "does not resolve to a real execution/action receipt" falsification.
    if (id !== undefined && id !== null && String(id).length > 0) {
      const ref = String(id);
      // Search the whole retained buffer, not just the default window — the
      // referenced record can be older than `limit` events back.
      const all = agentEventPublisher.getRecentEvents(agentEventPublisher.maxBufferSize || 1000);
      // Most-recent match wins: every turn of a session shares one activity urn,
      // so the latest record under that reference is the useful one to return.
      const match = [...all].reverse().find(e => eventMatchesRef(e, ref));

      if (!match) {
        reply.code(404).send({
          error: 'not-found',
          message: `No agent-event resolves the reference: ${ref}`,
          id: ref,
          count: 0
        });
        return;
      }

      const resolved = {
        ...match,
        action_type_name: Object.keys(AgentActionType).find(
          k => AgentActionType[k] === match.action_type
        )?.toLowerCase() || 'unknown'
      };

      reply.send({
        events: [resolved],
        count: 1,
        id: ref,
        timestamp: new Date().toISOString(),
        connected_clients: wsConnections.size
      });
      return;
    }

    let events = agentEventPublisher.getRecentEvents(limit);

    if (since) {
      events = events.filter(e => e.timestamp > since);
    }

    // Add action type names
    events = events.map(e => ({
      ...e,
      action_type_name: Object.keys(AgentActionType).find(
        k => AgentActionType[k] === e.action_type
      )?.toLowerCase() || 'unknown'
    }));

    reply.send({
      events,
      count: events.length,
      id: null,
      timestamp: new Date().toISOString(),
      connected_clients: wsConnections.size
    });
  });

  /**
   * POST /v1/agent-events/emit - Emit an agent action event
   * Used by claude-flow hooks and other systems to report agent activity
   */
  fastify.post('/v1/agent-events/emit', {
    schema: {
      description: 'Emit an agent action event for visualization',
      tags: ['agent-events'],
      body: {
        type: 'object',
        required: ['source_agent_id', 'target_node_id', 'action_type'],
        properties: {
          source_agent_id: {
            anyOf: [{ type: 'integer' }, { type: 'string' }],
            description: 'Agent ID (numeric or string hash)'
          },
          target_node_id: {
            anyOf: [{ type: 'integer' }, { type: 'string' }],
            description: 'Target node ID (numeric or string hash)'
          },
          action_type: {
            oneOf: [
              { type: 'integer', minimum: 0, maximum: 5 },
              { type: 'string', enum: ['query', 'update', 'create', 'delete', 'link', 'transform'] }
            ]
          },
          duration_ms: { type: 'integer', default: 100 },
          metadata: { type: 'object' },
          // REC-3 (CTC emitter wire): optional cost/correlation fields. The
          // trajectory-recorder hook forwards a step's captured token burden and
          // its chain handoff id here so they reach the agent-events envelope.
          token_count: { type: 'integer', minimum: 0 },
          handoff_id: { type: 'string' },
          verification: { type: 'string' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            event_id: { type: 'integer' },
            broadcast_count: { type: 'integer' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const body = request.body;

    // B4: per-agent did:nostr verification (gated; off → no-op, identity null).
    const auth = verifyAgentEventRequest(request);
    if (!auth.ok) {
      // REC-5 (AC5): classify the {success:false} return through the taxonomy. A
      // transport auth-signature rejection is not a multi-agent behaviour failure
      // the current signal can resolve → `unmapped` with the human text as detail.
      const tag = taxonomy.tagFailure({ error: auth.error });
      return reply.code(auth.status).send({ success: false, error: auth.error, ...tag });
    }
    const claimed = body.source_urn || (body.metadata && body.metadata.source_urn) || null;
    const rec = reconcileSourceUrn(claimed, auth.did);
    if (!rec.ok) {
      // REC-5 (AC5): a claimed source_urn that does not match the verified did is
      // an identity-attribution failure — the caller asserting a role/identity it
      // does not hold → FM-1.2 (Disobey Role Specification), text kept as detail.
      const tag = taxonomy.tagFailure({ reason: taxonomy.REASON.IDENTITY_MISMATCH, error: rec.error });
      return reply.code(rec.status).send({ success: false, error: rec.error, ...tag });
    }

    // Convert string IDs to numeric hashes if needed
    const sourceId = typeof body.source_agent_id === 'string'
      ? hashString(body.source_agent_id)
      : body.source_agent_id;

    const targetId = typeof body.target_node_id === 'string'
      ? hashString(body.target_node_id)
      : body.target_node_id;

    // Convert action type string to number
    const actionType = typeof body.action_type === 'string'
      ? AgentActionType[body.action_type.toUpperCase()] || 0
      : body.action_type;

    const emitPayload = {
      source_agent_id: sourceId,
      target_node_id: targetId,
      action_type: actionType,
      duration_ms: body.duration_ms || 100,
      metadata: body.metadata || {}
    };
    // When authenticated, stamp the verified identity so attribution is
    // provable rather than caller-asserted or env-defaulted.
    if (auth.did) {
      emitPayload.source_urn = auth.did;
      emitPayload.pubkey = auth.pubkey;
    }
    // REC-3 (CTC emitter wire): forward the token burden + chain handoff id from
    // the request body onto the emit payload, so the trajectory-recorder's
    // captured CTC fields reach the agent-events envelope the publisher emits.
    if (body.token_count !== undefined) emitPayload.token_count = body.token_count;
    if (body.handoff_id !== undefined)  emitPayload.handoff_id  = body.handoff_id;
    if (body.verification !== undefined) emitPayload.verification = body.verification;

    const event = agentEventPublisher.emitAgentAction(emitPayload);

    logger.debug(`Agent action emitted: ${event.id} (${Object.keys(AgentActionType).find(k => AgentActionType[k] === actionType)})`);

    reply.send({
      success: true,
      event_id: event.id,
      broadcast_count: wsConnections.size
    });
  });

  /**
   * POST /v1/agent-events/batch - Emit multiple events at once
   */
  fastify.post('/v1/agent-events/batch', {
    schema: {
      description: 'Emit multiple agent action events',
      tags: ['agent-events'],
      body: {
        type: 'object',
        required: ['events'],
        properties: {
          events: {
            type: 'array',
            items: {
              type: 'object',
              required: ['source_agent_id', 'target_node_id', 'action_type'],
              properties: {
                source_agent_id: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
                target_node_id: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
                action_type: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
                duration_ms: { type: 'integer' },
                metadata: { type: 'object' }
              }
            }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { events } = request.body;
    const emittedIds = [];

    // B4: verify once for the whole batch; every event inherits the same
    // authenticated identity (gated; off → no-op).
    const auth = verifyAgentEventRequest(request);
    if (!auth.ok) {
      // REC-5 (AC5): classify the {success:false} return through the taxonomy. A
      // transport auth-signature rejection is not a multi-agent behaviour failure
      // the current signal can resolve → `unmapped` with the human text as detail.
      const tag = taxonomy.tagFailure({ error: auth.error });
      return reply.code(auth.status).send({ success: false, error: auth.error, ...tag });
    }

    for (const eventData of events) {
      const claimed = eventData.source_urn
        || (eventData.metadata && eventData.metadata.source_urn) || null;
      const rec = reconcileSourceUrn(claimed, auth.did);
      if (!rec.ok) {
        // REC-5 (AC5): the fourth {success:false} return — the per-event
        // identity-mismatch inside the batch for-loop — classifies through the
        // SAME taxonomy as the singular /emit site three handlers above: a claimed
        // source_urn that does not match the verified did is an identity-attribution
        // failure → FM-1.2 (Disobey Role Specification), the human text preserved
        // as failure_detail. AC5 requires ALL {success:false} returns to classify.
        const tag = taxonomy.tagFailure({ reason: taxonomy.REASON.IDENTITY_MISMATCH, error: rec.error });
        return reply.code(rec.status).send({ success: false, error: rec.error, ...tag });
      }

      const sourceId = typeof eventData.source_agent_id === 'string'
        ? hashString(eventData.source_agent_id)
        : eventData.source_agent_id;

      const targetId = typeof eventData.target_node_id === 'string'
        ? hashString(eventData.target_node_id)
        : eventData.target_node_id;

      const actionType = typeof eventData.action_type === 'string'
        ? AgentActionType[eventData.action_type.toUpperCase()] || 0
        : eventData.action_type;

      const emitPayload = {
        source_agent_id: sourceId,
        target_node_id: targetId,
        action_type: actionType,
        duration_ms: eventData.duration_ms || 100,
        metadata: eventData.metadata || {}
      };
      if (auth.did) {
        emitPayload.source_urn = auth.did;
        emitPayload.pubkey = auth.pubkey;
      }

      const event = agentEventPublisher.emitAgentAction(emitPayload);

      emittedIds.push(event.id);
    }

    reply.send({
      success: true,
      event_ids: emittedIds,
      count: emittedIds.length,
      broadcast_count: wsConnections.size
    });
  });

  /**
   * GET /v1/agent-events/types - Get available action types
   */
  fastify.get('/v1/agent-events/types', {
    schema: {
      description: 'Get available agent action types',
      tags: ['agent-events'],
      response: {
        200: {
          type: 'object',
          properties: {
            types: { type: 'object' },
            colors: { type: 'object' }
          }
        }
      }
    }
  }, async (request, reply) => {
    reply.send({
      types: AgentActionType,
      colors: {
        QUERY: '#3b82f6',      // blue
        UPDATE: '#eab308',     // yellow
        CREATE: '#22c55e',     // green
        DELETE: '#ef4444',     // red
        LINK: '#a855f7',       // purple
        TRANSFORM: '#06b6d4'   // cyan
      },
      message_type: '0x23',
      protocol_version: '2.0.0'
    });
  });

  /**
   * POST /v1/agent-events/hook - Process claude-flow hook event
   * Called by claude-flow hooks system when agents perform actions
   */
  fastify.post('/v1/agent-events/hook', {
    schema: {
      description: 'Process a claude-flow hook event for visualization',
      tags: ['agent-events'],
      body: {
        type: 'object',
        required: ['hook'],
        properties: {
          hook: { type: 'string', description: 'Hook name (pre-task, post-task, pre-edit, etc.)' },
          taskId: { type: 'string' },
          agent: { type: 'string' },
          filePath: { type: 'string' },
          command: { type: 'string' },
          success: { type: 'boolean' },
          exitCode: { type: 'integer' },
          source: { type: 'string' },
          target: { type: 'string' },
          action: { type: 'string' },
          metadata: { type: 'object' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            event_id: { type: 'integer' },
            hook: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { hook, ...data } = request.body;

    const event = processHookEvent(hook, data);

    logger.debug(`Hook processed: ${hook} -> event ${event.id}`);

    reply.send({
      success: true,
      event_id: event.id,
      hook,
      broadcast_count: wsConnections.size
    });
  });

  /**
   * GET /v1/agent-events/registry - Get agent/node ID registry
   */
  fastify.get('/v1/agent-events/registry', {
    schema: {
      description: 'Get agent and node ID registry mappings',
      tags: ['agent-events'],
      response: {
        200: {
          type: 'object',
          properties: {
            agents: { type: 'integer' },
            nodes: { type: 'integer' },
            agentList: { type: 'array' },
            nodeList: { type: 'array' }
          }
        }
      }
    }
  }, async (request, reply) => {
    reply.send(getRegistryStats());
  });

  /**
   * GET /v1/agent-events/status - Connection and buffer status
   */
  fastify.get('/v1/agent-events/status', {
    schema: {
      description: 'Get agent events system status',
      tags: ['agent-events'],
      response: {
        200: {
          type: 'object',
          properties: {
            connected_clients: { type: 'integer' },
            buffer_size: { type: 'integer' },
            total_events_emitted: { type: 'integer' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const sub = getAgentEventWsSubscriber();
    const wsStatus = sub ? sub.status() : { connected: false };

    reply.send({
      connected_clients: wsConnections.size,
      buffer_size: agentEventPublisher.eventBuffer.length,
      total_events_emitted: agentEventPublisher.nextEventId - 1,
      ws_subscriber: wsStatus,
      registry: getRegistryStats(),
      timestamp: new Date().toISOString()
    });
  });

  // ADR-014 / ADR-059 Phase 2 — the bidirectional WebSocket subscriber is now
  // the sole agent-event transport. The legacy MCP-TCP outbound bridge
  // (agent-event-bridge.js) is retired from the route; it is retained in the
  // tree only as the ADR-059 canonical-envelope conformance fixture referenced
  // by tests/sovereign/agent-event-notification.test.js.
  fastify.addHook('onReady', async () => {
    // No-op when AGENTBOX_HOST_WS_URL is absent.
    try {
      await initializeAgentEventWsSubscriber({ logger });
      const sub = getAgentEventWsSubscriber();
      if (sub && sub.url) {
        logger.info(`Agent-events WS subscriber armed for ${sub.url}`);
      }
    } catch (err) {
      logger.warn(`Agent-events WS subscriber deferred: ${err.message}`);
    }
  });
}

/**
 * REC-9: does an event record resolve the given id/urn reference?
 *
 * A reference is either a canonical urn (the provenance resolver's landing
 * value, e.g. urn:agentbox:activity:<scope>:sha256-12-…) matched against any
 * urn-bearing identity field on the envelope, or a bare numeric event id
 * matched against the envelope's own `id`. String equality only — the URN is a
 * name, not a query, so there is no partial/prefix match.
 */
function eventMatchesRef(event, ref) {
  if (!event || ref == null) return false;
  if (String(event.id) === ref) return true;
  const URN_FIELDS = ['source_urn', 'target_urn', 'activity_urn', 'event_urn', 'urn'];
  return URN_FIELDS.some(k => typeof event[k] === 'string' && event[k] === ref);
}

/**
 * Simple string hash to convert string IDs to u32
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

module.exports = agentEventsRoutes;
