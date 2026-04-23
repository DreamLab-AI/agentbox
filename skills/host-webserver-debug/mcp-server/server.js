#!/usr/bin/env node
/**
 * Host Webserver Debug MCP Server
 * Provides tools for debugging host web servers from containers
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema
} = require('@modelcontextprotocol/sdk/types.js');

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

// Import tools
const { takeScreenshot } = require('../tools/screenshot.js');
const { debugCors } = require('../tools/debug-cors.js');

// State
let bridgeProcess = null;
let bridgeStatus = { running: false, pid: null, startTime: null };

// Detect host gateway IP
function detectGatewayIP() {
  try {
    const result = execSync("ip route | grep default | awk '{print $3}'", { encoding: 'utf8' });
    return result.trim() || '192.168.0.51';
  } catch {
    return '192.168.0.51';
  }
}

// Check if host is reachable
async function checkHostHealth(hostIp, port) {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: hostIp,
      port: port,
      path: '/',
      method: 'HEAD',
      timeout: 5000
    }, (res) => {
      resolve({
        reachable: true,
        statusCode: res.statusCode,
        headers: res.headers
      });
    });

    req.on('error', (err) => {
      resolve({
        reachable: false,
        error: err.message
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        reachable: false,
        error: 'Connection timeout'
      });
    });

    req.end();
  });
}

// Check bridge status
async function checkBridgeStatus() {
  if (!bridgeProcess || !bridgeStatus.running) {
    return { running: false };
  }

  try {
    const result = await new Promise((resolve) => {
      const req = https.request({
        hostname: 'localhost',
        port: process.env.HTTPS_PORT || 3001,
        path: '/',
        method: 'HEAD',
        rejectUnauthorized: false,
        timeout: 3000
      }, (res) => {
        resolve({ responding: true, statusCode: res.statusCode });
      });

      req.on('error', () => resolve({ responding: false }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ responding: false });
      });
      req.end();
    });

    return {
      running: true,
      pid: bridgeStatus.pid,
      startTime: bridgeStatus.startTime,
      uptime: Date.now() - new Date(bridgeStatus.startTime).getTime(),
      ...result
    };
  } catch {
    return { running: false };
  }
}

// Create MCP server
const server = new Server(
  {
    name: 'host-webserver-debug',
    version: '1.0.0'
  },
  {
    capabilities: {
      tools: {},
      resources: {}
    }
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'bridge_start',
        description: 'Start HTTPS bridge proxy to host web server',
        inputSchema: {
          type: 'object',
          properties: {
            host_ip: {
              type: 'string',
              description: 'Host IP address (auto-detected if not provided)'
            },
            https_port: {
              type: 'number',
              description: 'Local HTTPS port (default: 3001)',
              default: 3001
            },
            target_port: {
              type: 'number',
              description: 'Remote HTTP port on host (default: 3001)',
              default: 3001
            }
          }
        }
      },
      {
        name: 'bridge_status',
        description: 'Check HTTPS bridge proxy status',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'bridge_stop',
        description: 'Stop HTTPS bridge proxy',
        inputSchema: { type: 'object', properties: {} }
      },
      {
        name: 'screenshot',
        description: 'Take screenshot of web page via HTTPS bridge',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'URL to screenshot (default: https://localhost:3001)',
              default: 'https://localhost:3001'
            },
            filename: {
              type: 'string',
              description: 'Output filename (auto-generated if not provided)'
            },
            full_page: {
              type: 'boolean',
              description: 'Capture full page (default: true)',
              default: true
            },
            output_dir: {
              type: 'string',
              description: 'Output directory (default: /tmp/screenshots)'
            }
          }
        }
      },
      {
        name: 'debug_cors',
        description: 'Analyze CORS configuration and issues',
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'URL to test (default: https://localhost:3001)',
              default: 'https://localhost:3001'
            },
            origin: {
              type: 'string',
              description: 'Origin header value'
            },
            method: {
              type: 'string',
              description: 'HTTP method to test (default: GET)',
              default: 'GET'
            }
          }
        }
      },
      {
        name: 'health_check',
        description: 'Check if host web server is reachable',
        inputSchema: {
          type: 'object',
          properties: {
            host_ip: {
              type: 'string',
              description: 'Host IP address (auto-detected if not provided)'
            },
            port: {
              type: 'number',
              description: 'Port to check (default: 3001)',
              default: 3001
            }
          }
        }
      },
      {
        name: 'get_host_ip',
        description: 'Detect Docker host gateway IP address',
        inputSchema: { type: 'object', properties: {} }
      }
    ]
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case 'bridge_start': {
        if (bridgeProcess && bridgeStatus.running) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: 'Bridge already running',
                status: bridgeStatus
              }, null, 2)
            }]
          };
        }

        const hostIp = args.host_ip || detectGatewayIP();
        const httpsPort = args.https_port || 3001;
        const targetPort = args.target_port || 3001;

        const proxyPath = path.join(__dirname, '..', 'tools', 'https-proxy.js');

        bridgeProcess = spawn('node', [proxyPath], {
          env: {
            ...process.env,
            HOST_IP: hostIp,
            HTTPS_PORT: String(httpsPort),
            TARGET_PORT: String(targetPort),
            CERT_DIR: path.join(__dirname, '..', 'tools')
          },
          stdio: ['ignore', 'pipe', 'pipe']
        });

        bridgeStatus = {
          running: true,
          pid: bridgeProcess.pid,
          startTime: new Date().toISOString(),
          hostIp,
          httpsPort,
          targetPort
        };

        bridgeProcess.on('exit', (code) => {
          bridgeStatus.running = false;
          bridgeStatus.exitCode = code;
        });

        // Wait for startup
        await new Promise(resolve => setTimeout(resolve, 1000));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              message: 'HTTPS bridge started',
              local: `https://localhost:${httpsPort}`,
              target: `http://${hostIp}:${targetPort}`,
              pid: bridgeProcess.pid
            }, null, 2)
          }]
        };
      }

      case 'bridge_status': {
        const status = await checkBridgeStatus();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(status, null, 2)
          }]
        };
      }

      case 'bridge_stop': {
        if (bridgeProcess) {
          bridgeProcess.kill('SIGTERM');
          bridgeProcess = null;
          bridgeStatus = { running: false };
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ success: true, message: 'Bridge stopped' }, null, 2)
            }]
          };
        }
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: false, error: 'Bridge not running' }, null, 2)
          }]
        };
      }

      case 'screenshot': {
        const result = await takeScreenshot({
          url: args.url || 'https://localhost:3001',
          filename: args.filename,
          fullPage: args.full_page !== false,
          outputDir: args.output_dir || '/tmp/screenshots'
        });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        };
      }

      case 'debug_cors': {
        const result = await debugCors({
          url: args.url || 'https://localhost:3001',
          origin: args.origin || args.url || 'https://localhost:3001',
          method: args.method || 'GET'
        });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2)
          }]
        };
      }

      case 'health_check': {
        const hostIp = args.host_ip || detectGatewayIP();
        const port = args.port || 3001;
        const result = await checkHostHealth(hostIp, port);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              host: hostIp,
              port,
              ...result
            }, null, 2)
          }]
        };
      }

      case 'get_host_ip': {
        const hostIp = detectGatewayIP();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              host_ip: hostIp,
              method: 'gateway detection'
            }, null, 2)
          }]
        };
      }

      default:
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ error: `Unknown tool: ${name}` }, null, 2)
          }],
          isError: true
        };
    }
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: error.message,
          stack: error.stack
        }, null, 2)
      }],
      isError: true
    };
  }
});

// List resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: [
      {
        uri: 'host-debug://status',
        name: 'Bridge Status',
        description: 'Current status of HTTPS bridge proxy',
        mimeType: 'application/json'
      },
      {
        uri: 'host-debug://capabilities',
        name: 'Skill Capabilities',
        description: 'Available debugging capabilities',
        mimeType: 'application/json'
      }
    ]
  };
});

// Read resources
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  if (uri === 'host-debug://status') {
    const status = await checkBridgeStatus();
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(status, null, 2)
      }]
    };
  }

  if (uri === 'host-debug://capabilities') {
    return {
      contents: [{
        uri,
        mimeType: 'application/json',
        text: JSON.stringify({
          name: 'host-webserver-debug',
          version: '1.0.0',
          capabilities: [
            'HTTPS to HTTP bridge proxy',
            'Screenshot capture',
            'CORS debugging',
            'Health checking',
            'Host IP detection'
          ],
          display: process.env.DISPLAY || ':1'
        }, null, 2)
      }]
    };
  }

  throw new Error(`Unknown resource: ${uri}`);
});

// Main
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Host Webserver Debug MCP server running on stdio');
}

main().catch(console.error);
