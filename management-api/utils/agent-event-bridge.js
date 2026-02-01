/**
 * Agent Event Bridge
 *
 * Connects the Management API's agent event publisher to the MCP TCP server
 * for forwarding agent action events to VisionFlow.
 *
 * Architecture:
 *   claude-flow hooks → AgentEventPublisher → AgentEventBridge → MCP TCP → VisionFlow
 *
 * Supports both JSON-RPC and binary protocols for maximum efficiency.
 */

const net = require('net');
const { agentEventPublisher, AgentActionType } = require('./agent-event-publisher');

class AgentEventBridge {
  constructor(options = {}) {
    this.tcpHost = options.tcpHost || process.env.MCP_TCP_HOST || 'localhost';
    this.tcpPort = options.tcpPort || parseInt(process.env.MCP_TCP_PORT || '9500');
    this.logger = options.logger || console;
    this.reconnectInterval = options.reconnectInterval || 5000;
    this.useBinaryProtocol = options.useBinaryProtocol || false;

    this.socket = null;
    this.connected = false;
    this.reconnecting = false;
    this.eventCount = 0;
    this.lastError = null;

    // Subscribe to agent events
    this.unsubscribe = agentEventPublisher.subscribe((event) => {
      this.forwardEvent(event);
    });
  }

  /**
   * Connect to MCP TCP server
   */
  async connect() {
    if (this.connected || this.reconnecting) return;

    this.reconnecting = true;

    try {
      await new Promise((resolve, reject) => {
        this.socket = new net.Socket();

        this.socket.connect(this.tcpPort, this.tcpHost, () => {
          this.logger.info(`Agent event bridge connected to MCP TCP at ${this.tcpHost}:${this.tcpPort}`);
          this.connected = true;
          this.reconnecting = false;
          this.lastError = null;

          // Send initialization handshake
          this.sendInitialize();
          resolve();
        });

        this.socket.on('error', (err) => {
          this.lastError = err.message;
          this.logger.error(`Agent event bridge error: ${err.message}`);
          if (!this.connected) {
            reject(err);
          }
        });

        this.socket.on('close', () => {
          this.connected = false;
          this.socket = null;
          this.logger.info('Agent event bridge disconnected, scheduling reconnect...');
          this.scheduleReconnect();
        });

        this.socket.on('data', (data) => {
          this.handleResponse(data);
        });

        // Timeout for connection
        this.socket.setTimeout(5000, () => {
          if (!this.connected) {
            this.socket.destroy();
            reject(new Error('Connection timeout'));
          }
        });
      });
    } catch (err) {
      this.reconnecting = false;
      this.lastError = err.message;
      this.logger.error(`Failed to connect agent event bridge: ${err.message}`);
      this.scheduleReconnect();
    }
  }

  /**
   * Schedule reconnection attempt
   */
  scheduleReconnect() {
    if (this.reconnecting) return;

    setTimeout(() => {
      this.connect();
    }, this.reconnectInterval);
  }

  /**
   * Send MCP initialize request
   */
  sendInitialize() {
    const initRequest = {
      jsonrpc: '2.0',
      id: `init-bridge-${Date.now()}`,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: { listChanged: true },
          experimental: {
            agentEvents: true,
            binaryProtocol: this.useBinaryProtocol
          }
        },
        clientInfo: {
          name: 'agent-event-bridge',
          version: '2.0.0'
        }
      }
    };

    this.send(initRequest);
  }

  /**
   * Handle response from MCP TCP server
   */
  handleResponse(data) {
    try {
      const lines = data.toString().split('\n').filter(l => l.trim());
      for (const line of lines) {
        if (line.startsWith('{')) {
          const msg = JSON.parse(line);
          if (msg.result && msg.id?.startsWith('init-bridge')) {
            this.logger.info('Agent event bridge MCP handshake complete');
          }
        }
      }
    } catch (err) {
      this.logger.debug(`Bridge response parse error: ${err.message}`);
    }
  }

  /**
   * Forward agent event to MCP TCP server
   */
  forwardEvent(event) {
    if (!this.connected || !this.socket) {
      // Buffer events when disconnected? For now, just skip
      return;
    }

    this.eventCount++;

    if (this.useBinaryProtocol) {
      // Send binary payload directly
      const binaryPayload = agentEventPublisher.createBinaryPayload(event);
      this.socket.write(binaryPayload);
    } else {
      // Send JSON-RPC notification
      const notification = {
        jsonrpc: '2.0',
        method: 'notifications/agent_action',
        params: {
          type: 'agent_action',
          event: {
            id: event.id,
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
          // Include binary-compatible fields for VisionFlow decoder
          message_type: 0x23,  // AGENT_ACTION
          protocol_version: 2,
          timestamp: new Date().toISOString()
        }
      };

      this.send(notification);
    }
  }

  /**
   * Send JSON message to MCP TCP server
   */
  send(message) {
    if (!this.socket || !this.connected) return;

    try {
      const data = JSON.stringify(message) + '\n';
      this.socket.write(data);
    } catch (err) {
      this.logger.error(`Failed to send event: ${err.message}`);
    }
  }

  /**
   * Get bridge status
   */
  getStatus() {
    return {
      connected: this.connected,
      tcpHost: this.tcpHost,
      tcpPort: this.tcpPort,
      eventsForwarded: this.eventCount,
      useBinaryProtocol: this.useBinaryProtocol,
      lastError: this.lastError
    };
  }

  /**
   * Disconnect and cleanup
   */
  disconnect() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    this.connected = false;
  }
}

// Singleton bridge instance
let bridgeInstance = null;

/**
 * Get or create bridge instance
 */
function getAgentEventBridge(options) {
  if (!bridgeInstance) {
    bridgeInstance = new AgentEventBridge(options);
  }
  return bridgeInstance;
}

/**
 * Initialize and connect the bridge
 */
async function initializeAgentEventBridge(options) {
  const bridge = getAgentEventBridge(options);
  await bridge.connect();
  return bridge;
}

module.exports = {
  AgentEventBridge,
  getAgentEventBridge,
  initializeAgentEventBridge
};
