#!/usr/bin/env node

/**
 * Secure Client Example
 * Demonstrates how to connect to MCP servers with authentication
 */

const WebSocket = require('ws');
const net = require('net');
const readline = require('readline');

// Configuration from environment
const config = {
  wsUrl: process.env.MCP_WS_URL || 'ws://localhost:3002',
  wsToken: process.env.WS_AUTH_TOKEN || 'your-websocket-token',
  tcpHost: process.env.MCP_TCP_HOST || 'localhost',
  tcpPort: parseInt(process.env.MCP_TCP_PORT || '9500'),
  tcpToken: process.env.TCP_AUTH_TOKEN || 'your-tcp-token'
};

/**
 * WebSocket Client Example with Authentication
 */
class SecureWebSocketClient {
  constructor(url, token) {
    this.url = url;
    this.token = token;
    this.ws = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      console.log(`[WS] Connecting to ${this.url}...`);
      
      // Connect with authentication header
      this.ws = new WebSocket(this.url, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      this.ws.on('open', () => {
        console.log('[WS] Connected successfully');
        this.initialize().then(resolve).catch(reject);
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          this.handleMessage(message);
        } catch (error) {
          console.error('[WS] Invalid message:', error.message);
        }
      });

      this.ws.on('error', (error) => {
        console.error('[WS] Error:', error.message);
        reject(error);
      });

      this.ws.on('close', (code, reason) => {
        console.log(`[WS] Disconnected: ${code} - ${reason}`);
      });
    });
  }

  async initialize() {
    const response = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'secure-client-example',
        version: '1.0.0'
      }
    });
    console.log('[WS] Initialized:', response.result);
  }

  sendRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(request));
    });
  }

  handleMessage(message) {
    if (message.id && this.pendingRequests.has(message.id)) {
      const { resolve, reject } = this.pendingRequests.get(message.id);
      this.pendingRequests.delete(message.id);

      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message);
      }
    } else if (message.method) {
      // Handle notifications
      console.log('[WS] Notification:', message);
    }
  }

  async listTools() {
    const response = await this.sendRequest('tools/list');
    return response.result.tools;
  }

  async callTool(name, args = {}) {
    const response = await this.sendRequest('tools/call', {
      name,
      arguments: args
    });
    return response.result;
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

/**
 * TCP Client Example with Authentication
 */
class SecureTCPClient {
  constructor(host, port, token) {
    this.host = host;
    this.port = port;
    this.token = token;
    this.socket = null;
    this.requestId = 0;
    this.pendingRequests = new Map();
    this.buffer = '';
    this.authenticated = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      console.log(`[TCP] Connecting to ${this.host}:${this.port}...`);
      
      this.socket = net.createConnection(this.port, this.host);

      this.socket.on('connect', () => {
        console.log('[TCP] Connected successfully');
        this.authenticate().then(resolve).catch(reject);
      });

      this.socket.on('data', (data) => {
        this.buffer += data.toString();
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() || '';

        lines.forEach(line => {
          if (line.trim()) {
            try {
              const message = JSON.parse(line);
              this.handleMessage(message);
            } catch (error) {
              console.error('[TCP] Invalid message:', error.message);
            }
          }
        });
      });

      this.socket.on('error', (error) => {
        console.error('[TCP] Error:', error.message);
        reject(error);
      });

      this.socket.on('close', () => {
        console.log('[TCP] Disconnected');
      });
    });
  }

  async authenticate() {
    const response = await this.sendRequest('authenticate', {
      token: this.token
    });
    
    if (response.result && response.result.authenticated) {
      this.authenticated = true;
      console.log('[TCP] Authentication successful');
      await this.initialize();
    } else {
      throw new Error('Authentication failed');
    }
  }

  async initialize() {
    const response = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'secure-tcp-client',
        version: '1.0.0'
      }
    });
    console.log('[TCP] Initialized:', response.result);
  }

  sendRequest(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.requestId;
      const request = {
        jsonrpc: '2.0',
        id,
        method,
        params
      };

      this.pendingRequests.set(id, { resolve, reject });
      this.socket.write(JSON.stringify(request) + '\n');
    });
  }

  handleMessage(message) {
    if (message.id && this.pendingRequests.has(message.id)) {
      const { resolve, reject } = this.pendingRequests.get(message.id);
      this.pendingRequests.delete(message.id);

      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message);
      }
    } else if (message.method) {
      // Handle notifications
      console.log('[TCP] Notification:', message);
    }
  }

  close() {
    if (this.socket) {
      this.socket.end();
    }
  }
}

/**
 * Example usage
 */
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || 'ws';

  console.log('🔒 Secure MCP Client Example\n');
  console.log('Configuration:');
  console.log(`  Mode: ${mode}`);
  
  try {
    if (mode === 'ws') {
      console.log(`  URL: ${config.wsUrl}`);
      console.log(`  Token: ${config.wsToken.substring(0, 8)}...\n`);

      const client = new SecureWebSocketClient(config.wsUrl, config.wsToken);
      await client.connect();

      // Example: List available tools
      console.log('\n📋 Available Tools:');
      const tools = await client.listTools();
      tools.forEach(tool => {
        console.log(`  - ${tool.name}: ${tool.description}`);
      });

      // Example: Call a tool
      console.log('\n🔧 Calling swarm_status tool:');
      try {
        const result = await client.callTool('swarm_status', {});
        console.log('Result:', JSON.stringify(result, null, 2));
      } catch (error) {
        console.log('Tool call error:', error.message);
      }

      // Keep connection open for interactive mode
      if (args.includes('--interactive')) {
        console.log('\n💡 Interactive mode - type commands or "exit" to quit');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });

        rl.on('line', async (input) => {
          if (input === 'exit') {
            client.close();
            rl.close();
          } else {
            // Parse and execute command
            try {
              const [method, ...params] = input.split(' ');
              const result = await client.sendRequest(method, params[0] ? JSON.parse(params.join(' ')) : {});
              console.log('Response:', JSON.stringify(result, null, 2));
            } catch (error) {
              console.error('Error:', error.message);
            }
          }
        });
      } else {
        // Close after examples
        setTimeout(() => client.close(), 2000);
      }

    } else if (mode === 'tcp') {
      console.log(`  Host: ${config.tcpHost}:${config.tcpPort}`);
      console.log(`  Token: ${config.tcpToken.substring(0, 8)}...\n`);

      const client = new SecureTCPClient(config.tcpHost, config.tcpPort, config.tcpToken);
      await client.connect();

      // Similar examples for TCP...
      setTimeout(() => client.close(), 2000);

    } else {
      console.error('Invalid mode. Use "ws" or "tcp"');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Run the example
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { SecureWebSocketClient, SecureTCPClient };