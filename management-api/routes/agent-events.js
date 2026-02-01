/**
 * Agent Events WebSocket Route
 *
 * Provides real-time agent action streaming to VisionFlow.
 * Supports both JSON and binary protocols for efficiency.
 *
 * WebSocket: /v1/agent-events/stream
 * HTTP: /v1/agent-events (recent events)
 *       /v1/agent-events/emit (trigger event - for testing/integration)
 */

const { agentEventPublisher, AgentActionType } = require('../utils/agent-event-publisher');
const { processHookEvent, getRegistryStats } = require('../hooks/agent-action-hooks');
const { initializeAgentEventBridge, getAgentEventBridge } = require('../utils/agent-event-bridge');

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
          since: { type: 'integer', description: 'Timestamp to filter events after' }
        }
      },
      response: {
        200: {
          type: 'object',
          properties: {
            events: {
              type: 'array',
              items: {
                type: 'object',
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
            timestamp: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    const { limit = 100, since } = request.query;

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
            oneOf: [{ type: 'integer' }, { type: 'string' }],
            description: 'Agent ID (numeric or string hash)'
          },
          target_node_id: {
            oneOf: [{ type: 'integer' }, { type: 'string' }],
            description: 'Target node ID (numeric or string hash)'
          },
          action_type: {
            oneOf: [
              { type: 'integer', minimum: 0, maximum: 5 },
              { type: 'string', enum: ['query', 'update', 'create', 'delete', 'link', 'transform'] }
            ]
          },
          duration_ms: { type: 'integer', default: 100 },
          metadata: { type: 'object' }
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

    const event = agentEventPublisher.emitAgentAction({
      source_agent_id: sourceId,
      target_node_id: targetId,
      action_type: actionType,
      duration_ms: body.duration_ms || 100,
      metadata: body.metadata || {}
    });

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
                source_agent_id: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
                target_node_id: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
                action_type: { oneOf: [{ type: 'integer' }, { type: 'string' }] },
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

    for (const eventData of events) {
      const sourceId = typeof eventData.source_agent_id === 'string'
        ? hashString(eventData.source_agent_id)
        : eventData.source_agent_id;

      const targetId = typeof eventData.target_node_id === 'string'
        ? hashString(eventData.target_node_id)
        : eventData.target_node_id;

      const actionType = typeof eventData.action_type === 'string'
        ? AgentActionType[eventData.action_type.toUpperCase()] || 0
        : eventData.action_type;

      const event = agentEventPublisher.emitAgentAction({
        source_agent_id: sourceId,
        target_node_id: targetId,
        action_type: actionType,
        duration_ms: eventData.duration_ms || 100,
        metadata: eventData.metadata || {}
      });

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
    const bridge = getAgentEventBridge();
    const bridgeStatus = bridge ? bridge.getStatus() : { connected: false };

    reply.send({
      connected_clients: wsConnections.size,
      buffer_size: agentEventPublisher.eventBuffer.length,
      total_events_emitted: agentEventPublisher.nextEventId - 1,
      mcp_bridge: bridgeStatus,
      registry: getRegistryStats(),
      timestamp: new Date().toISOString()
    });
  });

  // Initialize MCP TCP bridge on route registration
  fastify.addHook('onReady', async () => {
    try {
      // Only connect if MCP TCP bridge is available
      if (process.env.ENABLE_MCP_BRIDGE !== 'false') {
        await initializeAgentEventBridge({
          logger,
          tcpHost: process.env.MCP_TCP_HOST || 'localhost',
          tcpPort: parseInt(process.env.MCP_TCP_PORT || '9500')
        });
        logger.info('Agent event bridge connected to MCP TCP');
      }
    } catch (err) {
      logger.warn(`Agent event bridge connection deferred: ${err.message}`);
    }
  });
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
