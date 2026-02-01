#!/usr/bin/env node
/**
 * Unified MCP Gateway
 * Consolidates TCP, WebSocket, and shared context for MCP services
 */

const net = require('net');
const { WebSocketServer } = require('ws');
const http = require('http');

class SharedContext {
  constructor() {
    this.agents = new Map();
    this.sessions = new Map();
    this.tools = new Map();
    this.agentEventSubscribers = new Set(); // Track clients subscribed to agent events
    this.broadcastCount = 0; // Throttle logging
    this.lastLogTime = 0;
  }

  registerAgent(id, metadata) {
    this.agents.set(id, { ...metadata, registeredAt: Date.now() });
    console.log(`[MCP Gateway] Agent registered: ${id}`);
  }

  getAgent(id) {
    return this.agents.get(id);
  }

  getAllAgents() {
    return Array.from(this.agents.values());
  }

  createSession(id, protocol, socket) {
    this.sessions.set(id, { id, protocol, socket, createdAt: Date.now() });
    console.log(`[MCP Gateway] Session created: ${id} (${protocol})`);
  }

  getSession(id) {
    return this.sessions.get(id);
  }

  closeSession(id) {
    // Remove from agent event subscribers
    const session = this.sessions.get(id);
    if (session) {
      this.agentEventSubscribers.delete(session);
    }
    this.sessions.delete(id);
    console.log(`[MCP Gateway] Session closed: ${id}`);
  }

  // Subscribe session to agent events
  subscribeToAgentEvents(sessionId) {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.agentEventSubscribers.add(session);
      console.log(`[MCP Gateway] Session ${sessionId} subscribed to agent events`);
    }
  }

  // Broadcast agent action event to all subscribers
  broadcastAgentEvent(event) {
    const message = JSON.stringify(event);
    let count = 0;

    for (const session of this.agentEventSubscribers) {
      try {
        if (session.protocol === 'tcp' && session.socket && !session.socket.destroyed) {
          session.socket.write(message + '\n');
          count++;
        } else if (session.protocol === 'websocket' && session.socket && session.socket.readyState === 1) {
          session.socket.send(message);
          count++;
        }
      } catch (err) {
        // Throttle error logging to once per 10 seconds
        const now = Date.now();
        if (now - this.lastLogTime > 10000) {
          console.error(`[MCP Gateway] Broadcast error to ${session.id}:`, err.message);
          this.lastLogTime = now;
        }
      }
    }

    this.broadcastCount++;
    return count;
  }
}

class TCPServer {
  constructor(sharedContext, port = 9500) {
    this.context = sharedContext;
    this.port = port;
    this.server = null;
  }

  start() {
    this.server = net.createServer((socket) => {
      const sessionId = `tcp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.context.createSession(sessionId, 'tcp', socket);

      socket.on('data', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(sessionId, message, socket);
        } catch (error) {
          console.error(`[TCP] Parse error:`, error);
          socket.write(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Parse error' },
            id: null
          }) + '\n');
        }
      });

      socket.on('error', (error) => {
        console.error(`[TCP] Socket error:`, error);
        this.context.closeSession(sessionId);
      });

      socket.on('close', () => {
        this.context.closeSession(sessionId);
      });
    });

    this.server.listen(this.port, () => {
      console.log(`[MCP Gateway] TCP server listening on port ${this.port}`);
    });
  }

  handleMessage(sessionId, message, socket) {
    const { id, method, params } = message;

    // Route to appropriate handler based on method
    let response;
    switch (method) {
      case 'initialize':
        // MCP handshake - auto-subscribe to agent events
        this.context.subscribeToAgentEvents(sessionId);
        response = {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'mcp-gateway', version: '2.0.0' },
            capabilities: {
              tools: { listChanged: true },
              experimental: { agentEvents: true }
            }
          }
        };
        break;

      case 'notifications/agent_action':
        // Forward agent action events to all subscribers (VisionFlow)
        const broadcastCount = this.context.broadcastAgentEvent({
          jsonrpc: '2.0',
          method: 'notifications/agent_action',
          params: params
        });
        // Throttled logging - only log every 100th broadcast or every 30 seconds
        if (this.context.broadcastCount % 100 === 1) {
          console.log(`[MCP Gateway] Agent action broadcast #${this.context.broadcastCount} to ${broadcastCount} clients`);
        }
        if (id) {
          response = { jsonrpc: '2.0', id, result: { broadcast_count: broadcastCount } };
        }
        break;

      case 'agent_events/subscribe':
        // Explicit subscription to agent events
        this.context.subscribeToAgentEvents(sessionId);
        response = {
          jsonrpc: '2.0',
          id,
          result: { subscribed: true, session_id: sessionId }
        };
        break;

      case 'tools/list':
        response = this.handleToolsList(id);
        break;
      case 'tools/call':
        response = this.handleToolCall(id, params);
        break;
      case 'agent/register':
        response = this.handleAgentRegister(id, params);
        break;
      case 'agent/list':
        response = this.handleAgentList(id);
        break;
      default:
        response = {
          jsonrpc: '2.0',
          error: { code: -32601, message: 'Method not found' },
          id
        };
    }

    if (response) {
      socket.write(JSON.stringify(response) + '\n');
    }
  }

  handleToolsList(id) {
    const tools = this.context.getAllAgents().map(agent => ({
      name: agent.id,
      description: agent.description || 'Agent tool',
      inputSchema: agent.inputSchema || {}
    }));

    return {
      jsonrpc: '2.0',
      result: { tools },
      id
    };
  }

  handleToolCall(id, params) {
    return {
      jsonrpc: '2.0',
      result: {
        content: [{ type: 'text', text: 'Tool executed via gateway' }]
      },
      id
    };
  }

  handleAgentRegister(id, params) {
    this.context.registerAgent(params.id, params);
    return {
      jsonrpc: '2.0',
      result: { success: true, agentId: params.id },
      id
    };
  }

  handleAgentList(id) {
    return {
      jsonrpc: '2.0',
      result: {
        agents: this.context.getAllAgents(),
        count: this.context.agents.size
      },
      id
    };
  }

  stop() {
    if (this.server) {
      this.server.close();
      console.log('[MCP Gateway] TCP server stopped');
    }
  }
}

class WebSocketServerWrapper {
  constructor(sharedContext, port = 3002) {
    this.context = sharedContext;
    this.port = port;
    this.httpServer = null;
    this.wss = null;
  }

  start() {
    this.httpServer = http.createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'healthy',
          agents: this.context.agents.size,
          sessions: this.context.sessions.size,
          agentEventSubscribers: this.context.agentEventSubscribers.size,
          timestamp: new Date().toISOString()
        }));
      } else if (req.url === '/agent-events/status') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          subscribers: this.context.agentEventSubscribers.size,
          sessions: Array.from(this.context.sessions.values()).map(s => ({
            id: s.id,
            protocol: s.protocol,
            createdAt: s.createdAt
          })),
          timestamp: new Date().toISOString()
        }));
      } else {
        res.writeHead(404);
        res.end();
      }
    });

    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws) => {
      const sessionId = `ws-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.context.createSession(sessionId, 'websocket', ws);

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleMessage(sessionId, message, ws);
        } catch (error) {
          console.error(`[WS] Parse error:`, error);
          ws.send(JSON.stringify({
            jsonrpc: '2.0',
            error: { code: -32700, message: 'Parse error' },
            id: null
          }));
        }
      });

      ws.on('error', (error) => {
        console.error(`[WS] Socket error:`, error);
        this.context.closeSession(sessionId);
      });

      ws.on('close', () => {
        this.context.closeSession(sessionId);
      });
    });

    this.httpServer.listen(this.port, () => {
      console.log(`[MCP Gateway] WebSocket server listening on port ${this.port}`);
    });
  }

  handleMessage(sessionId, message, ws) {
    const { id, method, params } = message;

    let response;
    switch (method) {
      case 'initialize':
        // MCP handshake - auto-subscribe to agent events
        this.context.subscribeToAgentEvents(sessionId);
        response = {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: { name: 'mcp-gateway', version: '2.0.0' },
            capabilities: {
              tools: { listChanged: true },
              experimental: { agentEvents: true }
            }
          }
        };
        break;

      case 'notifications/agent_action':
        // Forward agent action events to all subscribers (VisionFlow)
        const broadcastCount = this.context.broadcastAgentEvent({
          jsonrpc: '2.0',
          method: 'notifications/agent_action',
          params: params
        });
        // Logging handled in broadcastAgentEvent (throttled)
        if (id) {
          response = { jsonrpc: '2.0', id, result: { broadcast_count: broadcastCount } };
        }
        break;

      case 'agent_events/subscribe':
        this.context.subscribeToAgentEvents(sessionId);
        response = {
          jsonrpc: '2.0',
          id,
          result: { subscribed: true, session_id: sessionId }
        };
        break;

      case 'tools/list':
        response = {
          jsonrpc: '2.0',
          id,
          result: {
            tools: this.context.getAllAgents().map(agent => ({
              name: agent.id,
              description: agent.description || 'Agent tool',
              inputSchema: agent.inputSchema || {}
            }))
          }
        };
        break;

      case 'agent/register':
        this.context.registerAgent(params.id, params);
        response = {
          jsonrpc: '2.0',
          id,
          result: { success: true, agentId: params.id }
        };
        break;

      case 'agent/list':
        response = {
          jsonrpc: '2.0',
          id,
          result: {
            agents: this.context.getAllAgents(),
            count: this.context.agents.size
          }
        };
        break;

      default:
        response = {
          jsonrpc: '2.0',
          error: { code: -32601, message: 'Method not found' },
          id
        };
    }

    if (response) {
      ws.send(JSON.stringify(response));
    }
  }

  stop() {
    if (this.wss) {
      this.wss.close();
    }
    if (this.httpServer) {
      this.httpServer.close();
      console.log('[MCP Gateway] WebSocket server stopped');
    }
  }
}

class MCPGateway {
  constructor(config = {}) {
    this.config = {
      tcpPort: config.tcpPort || 9500,
      wsPort: config.wsPort || 3002,
      ...config
    };

    this.sharedContext = new SharedContext();
    this.tcpServer = new TCPServer(this.sharedContext, this.config.tcpPort);
    this.wsServer = new WebSocketServerWrapper(this.sharedContext, this.config.wsPort);
  }

  start() {
    console.log('[MCP Gateway] Starting unified MCP gateway...');
    this.tcpServer.start();
    this.wsServer.start();
    console.log('[MCP Gateway] All services started');
  }

  stop() {
    console.log('[MCP Gateway] Stopping all services...');
    this.tcpServer.stop();
    this.wsServer.stop();
    console.log('[MCP Gateway] All services stopped');
  }
}

// Main execution
if (require.main === module) {
  const config = {
    tcpPort: parseInt(process.env.MCP_TCP_PORT || '9500'),
    wsPort: parseInt(process.env.MCP_WS_PORT || '3002')
  };

  const gateway = new MCPGateway(config);

  // Handle graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[MCP Gateway] SIGTERM received, shutting down...');
    gateway.stop();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('[MCP Gateway] SIGINT received, shutting down...');
    gateway.stop();
    process.exit(0);
  });

  gateway.start();
}

module.exports = { MCPGateway, SharedContext, TCPServer, WebSocketServerWrapper };