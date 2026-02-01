#!/usr/bin/env node

// Persistent MCP TCP Server - Fixes agent tracking
// Maintains single MCP instance across all connections
// Enhanced with authentication and security

const { spawn } = require('child_process');
const net = require('net');
const readline = require('readline');
const AuthMiddleware = require('./auth-middleware');

const TCP_PORT = process.env.MCP_TCP_PORT || 9500;
const LOG_LEVEL = process.env.MCP_LOG_LEVEL || 'info';
const MAX_CONNECTIONS = parseInt(process.env.TCP_MAX_CONNECTIONS || '50');

class PersistentMCPServer {
  constructor() {
    this.mcpProcess = null;
    this.mcpInterface = null;
    this.clients = new Map();
    this.initialized = false;
    this.initPromise = null;
    this.auth = new AuthMiddleware();
  }

  log(level, message, ...args) {
    const levels = { debug: 0, info: 1, warn: 2, error: 3 };
    if (levels[level] >= levels[LOG_LEVEL]) {
      console.log(`[PMCP-${level.toUpperCase()}] ${new Date().toISOString()} ${message}`, ...args);
    }
  }

  async startMCPProcess() {
    if (this.mcpProcess) return;

    this.log('info', 'Starting persistent MCP process...');

    // Check if we should use the generic relay mode
    const mcpCommand = process.env.MCP_TCP_COMMAND || '/app/node_modules/.bin/claude-flow';
    const mcpArgs = process.env.MCP_TCP_ARGS ? process.env.MCP_TCP_ARGS.split(' ') : ['mcp', 'start'];

    // Create isolated directory for TCP server's claude-flow instance
    // This ensures it creates .swarm/memory.db in its own directory, not /workspace/.swarm/memory.db
    const tcpServerDir = '/workspace/.swarm/tcp-server-instance';
    const fs = require('fs');
    if (!fs.existsSync(tcpServerDir)) {
      fs.mkdirSync(tcpServerDir, { recursive: true, mode: 0o755 });
    }

    this.log('info', `Starting MCP: ${mcpCommand} ${mcpArgs.join(' ')}`);
    this.log('info', `Working directory: ${tcpServerDir} (isolated DB)`);

    // Merge with dev user's environment to ensure proper access to tools
    const devEnv = {
      ...process.env,
      HOME: '/home/dev',
      USER: 'dev',
      PATH: `/home/dev/.local/bin:/opt/venv312/bin:/home/dev/.cargo/bin:/home/dev/.deno/bin:/app/core-assets/scripts:/app/core-assets/mcp-tools:/home/ubuntu/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin`,
      CLAUDE_FLOW_DIRECT_MODE: 'true',
      CLAUDE_FLOW_DB_PATH: '/workspace/.swarm/tcp-server.db',
      // Ensure access to Claude configuration
      CLAUDE_CONFIG_DIR: '/home/dev/.claude',
      CLAUDE_PROJECT_ROOT: '/workspace',
      // SQLite connection pooling settings
      SQLITE_BUSY_TIMEOUT: '60000',  // 60 second timeout
      SQLITE_JOURNAL_MODE: 'WAL',    // Write-Ahead Logging
      SQLITE_SYNCHRONOUS: 'NORMAL'   // Balance safety/performance
    };

    this.mcpProcess = spawn(mcpCommand, mcpArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: tcpServerDir,  // Run in isolated directory
      env: devEnv,
      uid: process.getuid(), // Run as same user
      gid: process.getgid()
    });

    this.mcpInterface = readline.createInterface({
      input: this.mcpProcess.stdout,
      crlfDelay: Infinity
    });

    this.mcpInterface.on('line', (line) => this.handleMCPOutput(line));
    this.mcpProcess.stderr.on('data', (data) => this.log('debug', `MCP: ${data}`));
    this.mcpProcess.on('close', (code) => {
      this.log('error', `MCP exited: ${code}`);
      this.mcpProcess = null;
      this.initialized = false;
      setTimeout(() => this.startMCPProcess(), 5000);
    });

    await this.initializeMCP();
  }

  async initializeMCP() {
    if (this.initialized) return;
    const initRequest = {
      jsonrpc: "2.0",
      id: "init-" + Date.now(),
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: true }},
        clientInfo: { name: "tcp-wrapper", version: "1.0.0" }
      }
    };
    return new Promise((resolve) => {
      this.initPromise = { resolve, id: initRequest.id };
      this.mcpProcess.stdin.write(JSON.stringify(initRequest) + '\n');
    });
  }

  handleMCPOutput(line) {
    if (!line.startsWith('{')) return;
    try {
      const msg = JSON.parse(line);
      if (this.initPromise && msg.id === this.initPromise.id) {
        this.initialized = true;
        this.log('info', 'MCP initialized');
        this.initPromise.resolve();
        this.initPromise = null;
        return;
      }

      // Check for client messages from hooks/notifications
      if (msg.method === 'notifications/message' || msg.method === 'notification' ||
          (msg.params && (msg.params.type === 'client' || msg.params.level === 'client'))) {
        this.log('info', 'Client message detected from agent:', msg.params?.message);
        // Broadcast as client_message event
        const clientMessageEvent = {
          jsonrpc: '2.0',
          method: 'notification',
          params: {
            type: 'client_message',
            message: msg.params?.message || msg.params?.text,
            timestamp: new Date().toISOString(),
            session_id: msg.params?.session_id,
            agent_id: msg.params?.agent_id
          }
        };
        this.broadcastToClients(JSON.stringify(clientMessageEvent));
      }

      // Handle agent action events for VisionFlow visualization
      if (msg.method === 'notifications/agent_action' ||
          (msg.params && msg.params.type === 'agent_action')) {
        this.log('debug', 'Agent action event:', msg.params?.event?.action_type_name);
        // Forward directly to all clients - VisionFlow will decode
        this.broadcastToClients(line);
      }

      if (!msg.id) {
        this.broadcastToClients(line);
        return;
      }
      const clientId = this.findClientByRequestId(msg.id);
      if (clientId) {
        const client = this.clients.get(clientId);
        if (client && client.socket) {
          client.socket.write(line + '\n');
        }
      }
    } catch (err) {
      this.log('error', `Parse error: ${err.message}`);
    }
  }

  findClientByRequestId(requestId) {
    for (const [clientId, client] of this.clients) {
      if (client.pendingRequests && client.pendingRequests.has(requestId)) {
        client.pendingRequests.delete(requestId);
        return clientId;
      }
    }
    return null;
  }

  broadcastToClients(message) {
    for (const [clientId, client] of this.clients) {
      if (client.socket && !client.socket.destroyed) {
        client.socket.write(message + '\n');
      }
    }
  }

  async handleClient(socket) {
    const clientId = `${socket.remoteAddress}:${socket.remotePort}-${Date.now()}`;
    const clientIp = socket.remoteAddress;
    
    // Check if IP is blocked (only if auto-blocking is enabled)
    if (process.env.AUTO_BLOCK_ENABLED === 'true' && this.auth.isIPBlocked(clientIp)) {
        this.auth.logSecurityEvent('tcp_blocked_connection', { ip: clientIp });
        socket.write(JSON.stringify({ error: 'Forbidden' }) + '\n');
        socket.end();
        return;
    }
    
    // Check connection limit
    if (this.clients.size >= MAX_CONNECTIONS) {
        this.auth.logSecurityEvent('tcp_connection_limit', { ip: clientIp });
        socket.write(JSON.stringify({ error: 'Service unavailable - connection limit reached' }) + '\n');
        socket.end();
        return;
    }
    
    // Check rate limiting (only if rate limiting is enabled)
    if (process.env.RATE_LIMIT_ENABLED === 'true' && !this.auth.checkRateLimit(clientIp)) {
        this.auth.logSecurityEvent('tcp_rate_limit_exceeded', { ip: clientIp });
        this.auth.blockIP(clientIp, 300000); // Block for 5 minutes
        socket.write(JSON.stringify({ error: 'Rate limit exceeded' }) + '\n');
        socket.end();
        return;
    }
    
    this.log('info', `Client connected: ${clientId}`);
    this.auth.logSecurityEvent('tcp_connection_established', { clientId, ip: clientIp });

    if (!this.initialized) {
      let waitCount = 0;
      while (!this.initialized && waitCount < 20) {
        await new Promise(resolve => setTimeout(resolve, 100));
        waitCount++;
      }
      if (!this.initialized) {
        socket.write('{"error":"MCP not ready"}\n');
        socket.end();
        return;
      }
    }

    this.clients.set(clientId, {
      socket,
      pendingRequests: new Set(),
      buffer: '',
      authenticated: false,
      ip: clientIp,
      connectionTime: Date.now()
    });

    socket.on('data', (data) => {
      const client = this.clients.get(clientId);
      if (!client) return;
      client.buffer += data.toString();
      const lines = client.buffer.split('\n');
      client.buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.trim()) {
          // Validate input before processing
          const validation = this.auth.validateInput(line);
          if (!validation.valid) {
            this.log('error', `Invalid input from ${clientId}: ${validation.error}`);
            this.auth.logSecurityEvent('tcp_invalid_input', { clientId, error: validation.error });
            socket.write(JSON.stringify({
              jsonrpc: '2.0',
              error: {
                code: -32600,
                message: 'Invalid request: ' + validation.error
              }
            }) + '\n');
            continue;
          }
          
          // Rate limit check for individual messages (only if rate limiting is enabled)
          if (process.env.RATE_LIMIT_ENABLED === 'true' && !this.auth.checkRateLimit(clientIp)) {
            socket.write(JSON.stringify({
              jsonrpc: '2.0',
              error: {
                code: -32000,
                message: 'Rate limit exceeded'
              }
            }) + '\n');
            continue;
          }
          
          const sanitizedInput = typeof validation.sanitized === 'string'
            ? validation.sanitized
            : JSON.stringify(validation.sanitized);
          
          this.handleClientRequest(clientId, sanitizedInput);
        }
      }
    });

    socket.on('close', () => {
      this.log('info', `Client disconnected: ${clientId}`);
      this.auth.logSecurityEvent('tcp_connection_closed', { clientId, ip: clientIp });
      this.clients.delete(clientId);
    });

    socket.on('error', (err) => {
      this.log('error', `Client error: ${err.message}`);
      this.auth.logSecurityEvent('tcp_client_error', { clientId, error: err.message });
      this.clients.delete(clientId);
    });
  }

  handleClientRequest(clientId, requestStr) {
    try {
      const request = JSON.parse(requestStr);
      const client = this.clients.get(clientId);
      if (!client) return;
      
      // Handle authentication
      if (this.auth.config.authEnabled && !client.authenticated) {
        if (request.method === 'authenticate') {
          if (this.auth.validateToken(request.params?.token)) {
            client.authenticated = true;
            client.socket.write(JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              result: { authenticated: true }
            }) + '\n');
            this.auth.logSecurityEvent('tcp_auth_success', { clientId });
            return;
          } else {
            client.socket.write(JSON.stringify({
              jsonrpc: '2.0',
              id: request.id,
              error: {
                code: -32000,
                message: 'Authentication failed'
              }
            }) + '\n');
            this.auth.logSecurityEvent('tcp_auth_failed', { clientId });
            client.socket.end();
            return;
          }
        } else if (request.method !== 'initialize') {
          // Require authentication for all methods except initialize
          client.socket.write(JSON.stringify({
            jsonrpc: '2.0',
            id: request.id,
            error: {
              code: -32000,
              message: 'Authentication required'
            }
          }) + '\n');
          return;
        }
      }

      if (request.method === 'initialize') {
        client.socket.write(JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: "2024-11-05",
            serverInfo: { name: "claude-flow", version: "2.0.0-alpha.101" }
          }
        }) + '\n');
        return;
      }

      if (request.id) {
        client.pendingRequests.add(request.id);
      }
      this.mcpProcess.stdin.write(requestStr + '\n');
      this.log('debug', `Forwarded: ${request.id}`);
    } catch (err) {
      this.log('error', `Invalid request: ${err.message}`);
    }
  }

  async start() {
    await this.startMCPProcess();
    
    // Start connection cleanup interval
    setInterval(() => {
      const now = Date.now();
      const timeout = parseInt(process.env.TCP_CONNECTION_TIMEOUT || '300000');
      
      for (const [clientId, client] of this.clients.entries()) {
        if (now - client.connectionTime > timeout) {
          this.log('info', `Closing idle TCP connection: ${clientId}`);
          this.auth.logSecurityEvent('tcp_connection_timeout', { clientId });
          client.socket.end();
          this.clients.delete(clientId);
        }
      }
    }, 30000); // Check every 30 seconds
    
    const server = net.createServer((socket) => this.handleClient(socket));
    server.listen(TCP_PORT, '0.0.0.0', () => {
      this.log('info', `Persistent MCP TCP server on port ${TCP_PORT}`);
      this.log('info', `Authentication: ${this.auth.config.authEnabled ? 'enabled' : 'disabled'}`);
      this.log('info', `Max connections: ${MAX_CONNECTIONS}`);
    });
    server.on('error', (err) => {
      this.log('error', `Server error: ${err.message}`);
      if (err.code === 'EADDRINUSE') process.exit(1);
    });
  }
}

const server = new PersistentMCPServer();
server.start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});

process.on('SIGINT', () => {
  if (server.mcpProcess) server.mcpProcess.kill();
  process.exit(0);
});
