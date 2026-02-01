/**
 * Agent Event Publisher
 *
 * Emits agent action events for visualization in VisionFlow.
 * Events are broadcast via WebSocket and MCP TCP to connected clients.
 */

const EventEmitter = require('events');

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
      id: this.nextEventId++,
      timestamp: Date.now(),
      type: 'agent_action',
      ...event,
      // Ensure action_type is a number
      action_type: typeof event.action_type === 'string'
        ? AgentActionType[event.action_type.toUpperCase()] || 0
        : event.action_type || 0
    };

    // Buffer the event
    this.eventBuffer.push(fullEvent);
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

    // Total: 15 bytes header + payload
    const buffer = Buffer.alloc(15 + payloadBuffer.length);

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
   * Create JSON-RPC notification for MCP broadcast
   */
  createMcpNotification(event) {
    return {
      jsonrpc: '2.0',
      method: 'notifications/agent_action',
      params: {
        type: 'agent_action',
        event: {
          source_agent_id: event.source_agent_id,
          target_node_id: event.target_node_id,
          action_type: event.action_type,
          action_type_name: Object.keys(AgentActionType).find(
            k => AgentActionType[k] === event.action_type
          )?.toLowerCase() || 'query',
          timestamp: event.timestamp,
          duration_ms: event.duration_ms,
          metadata: event.metadata || {}
        },
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
