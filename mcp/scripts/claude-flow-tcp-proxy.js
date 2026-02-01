#!/usr/bin/env node

/**
 * Claude-Flow TCP Proxy
 * 
 * This proxy allows external TCP connections to access claude-flow
 * while keeping the local MCP instance separate for Claude Code.
 * 
 * External clients connect to port 9502 and get their own claude-flow instance.
 * Local Claude Code uses the standard MCP configuration.
 */

const net = require('net');
const { spawn } = require('child_process');
const readline = require('readline');

const TCP_PORT = parseInt(process.env.CLAUDE_FLOW_TCP_PORT || '9502');
const MAX_SESSIONS = parseInt(process.env.CLAUDE_FLOW_MAX_SESSIONS || '10');

class ClaudeFlowTCPProxy {
  constructor() {
    this.sessions = new Map();
    this.server = null;
  }

  log(level, message, sessionId = null) {
    const prefix = sessionId ? `[CF-TCP:${sessionId}]` : '[CF-TCP]';
    console.log(`${prefix} ${new Date().toISOString()} [${level.toUpperCase()}] ${message}`);
  }

  start() {
    this.server = net.createServer((socket) => {
      const sessionId = Math.random().toString(36).substring(7);
      this.handleNewConnection(socket, sessionId);
    });

    this.server.listen(TCP_PORT, '0.0.0.0', () => {
      this.log('info', `Claude-Flow TCP Proxy listening on port ${TCP_PORT}`);
      this.log('info', `Max concurrent sessions: ${MAX_SESSIONS}`);
    });

    // Health endpoint on port + 1
    const healthServer = net.createServer((socket) => {
      const status = {
        active_sessions: this.sessions.size,
        max_sessions: MAX_SESSIONS,
        port: TCP_PORT
      };
      socket.write(`HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(status)}\n`);
      socket.end();
    });
    
    healthServer.listen(TCP_PORT + 1, '127.0.0.1', () => {
      this.log('info', `Health endpoint on port ${TCP_PORT + 1}`);
    });
  }

  handleNewConnection(socket, sessionId) {
    this.log('info', 'New connection', sessionId);

    if (this.sessions.size >= MAX_SESSIONS) {
      this.log('warn', 'Max sessions reached, rejecting connection', sessionId);
      socket.write(JSON.stringify({
        jsonrpc: "2.0",
        id: "error",
        error: {
          code: -32000,
          message: "Maximum concurrent sessions reached"
        }
      }) + '\n');
      socket.end();
      return;
    }

    // Create a new claude-flow instance for this session
    const cfProcess = spawn('/app/node_modules/.bin/claude-flow', ['mcp', 'start'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: '/workspace',
      env: {
        ...process.env,
        CLAUDE_FLOW_DB_PATH: `/workspace/.swarm/sessions/${sessionId}/memory.db`,
        CLAUDE_FLOW_SESSION_ID: sessionId,
        CLAUDE_FLOW_MODE: 'isolated'
      }
    });

    const cfInterface = readline.createInterface({
      input: cfProcess.stdout,
      crlfDelay: Infinity
    });

    const session = {
      socket,
      process: cfProcess,
      interface: cfInterface,
      id: sessionId,
      startTime: new Date()
    };

    this.sessions.set(sessionId, session);

    // Set up data forwarding
    socket.on('data', (data) => {
      const lines = data.toString().split('\n').filter(line => line.trim());
      lines.forEach(line => {
        if (line.trim()) {
          this.log('debug', `Client -> CF: ${line}`, sessionId);
          cfProcess.stdin.write(line + '\n');
        }
      });
    });

    cfInterface.on('line', (line) => {
      if (line.trim()) {
        this.log('debug', `CF -> Client: ${line}`, sessionId);
        socket.write(line + '\n');
      }
    });

    // Handle errors and cleanup
    cfProcess.stderr.on('data', (data) => {
      this.log('error', `CF stderr: ${data}`, sessionId);
    });

    const cleanup = () => {
      this.log('info', 'Session ended', sessionId);
      if (cfProcess.exitCode === null) {
        cfProcess.kill();
      }
      cfInterface.close();
      socket.destroy();
      this.sessions.delete(sessionId);
    };

    socket.on('error', (err) => {
      this.log('error', `Socket error: ${err.message}`, sessionId);
      cleanup();
    });

    socket.on('close', cleanup);
    cfProcess.on('exit', cleanup);

    // Initialize the MCP connection
    const initRequest = {
      jsonrpc: "2.0",
      id: `init-${sessionId}`,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: true }},
        clientInfo: { 
          name: "tcp-proxy", 
          version: "1.0.0",
          sessionId: sessionId 
        }
      }
    };
    
    cfProcess.stdin.write(JSON.stringify(initRequest) + '\n');
    this.log('info', 'Session initialized', sessionId);
  }

  shutdown() {
    this.log('info', 'Shutting down proxy...');
    this.sessions.forEach((session) => {
      session.process.kill();
      session.socket.destroy();
    });
    this.server.close();
  }
}

// Start the proxy
const proxy = new ClaudeFlowTCPProxy();
proxy.start();

// Graceful shutdown
process.on('SIGTERM', () => proxy.shutdown());
process.on('SIGINT', () => proxy.shutdown());