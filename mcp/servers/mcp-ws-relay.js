#!/usr/bin/env node

// WebSocket to MCP Bridge
// Uses global claude-flow installation instead of npx
// Enhanced with authentication and security

const WebSocket = require('ws');
const { spawn } = require('child_process');
const AuthMiddleware = require('./auth-middleware');

const PORT = process.env.MCP_BRIDGE_PORT || 3002;
const HOST = '0.0.0.0'; // Listen on all network interfaces
const MAX_CONNECTIONS = parseInt(process.env.WS_MAX_CONNECTIONS || '100');

// Initialize authentication middleware
const auth = new AuthMiddleware();
const activeConnections = new Map();

const wss = new WebSocket.Server({ 
    host: HOST, 
    port: PORT,
    verifyClient: (info, cb) => {
        // Extract client info
        const clientIp = info.req.socket.remoteAddress;
        const { token } = auth.extractAuth(info.req);
        
        // Check if IP is blocked
        if (auth.isIPBlocked(clientIp)) {
            auth.logSecurityEvent('blocked_connection', { ip: clientIp });
            cb(false, 403, 'Forbidden');
            return;
        }
        
        // Check authentication
        if (!auth.validateToken(token)) {
            auth.logSecurityEvent('invalid_auth', { ip: clientIp });
            cb(false, 401, 'Unauthorized');
            return;
        }
        
        // Check connection limit
        if (activeConnections.size >= MAX_CONNECTIONS) {
            auth.logSecurityEvent('connection_limit', { ip: clientIp });
            cb(false, 503, 'Service Unavailable');
            return;
        }
        
        cb(true);
    }
});

console.log(`[MCP Bridge] WebSocket-to-Stdio bridge listening on ws://${HOST}:${PORT}`);
console.log(`[MCP Bridge] Using global claude-flow installation at /usr/bin/claude-flow`);

wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    const clientId = `${clientIp}:${req.socket.remotePort}-${Date.now()}`;
    
    // Check rate limiting
    if (!auth.checkRateLimit(clientIp)) {
        auth.logSecurityEvent('rate_limit_exceeded', { ip: clientIp });
        auth.blockIP(clientIp, 300000); // Block for 5 minutes
        ws.close(1008, 'Rate limit exceeded');
        return;
    }
    
    console.log(`[MCP Bridge] New client connected from ${clientIp}`);
    auth.logSecurityEvent('connection_established', { clientId, ip: clientIp });
    
    // Track active connection
    activeConnections.set(clientId, { ws, ip: clientIp, startTime: Date.now() });

    // For each new WebSocket connection, spawn a dedicated claude-flow MCP process.
    // This provides perfect session isolation using global installation.
    const mcpProcess = spawn('/usr/bin/claude-flow', ['mcp', 'start', '--stdio', '--file', '/workspace/.mcp.json'], {
        cwd: '/workspace', // Run in the context of the user's workspace
        stdio: ['pipe', 'pipe', 'pipe'], // stdin, stdout, stderr
        env: {
            ...process.env,
            CLAUDE_FLOW_DIRECT_MODE: 'true',
            CLAUDE_FLOW_GLOBAL: 'true',
            CLAUDE_FLOW_DATABASE: '/workspace/.swarm/memory.db'
        }
    });

    console.log(`[MCP Bridge] Spawned claude-flow MCP process with PID: ${mcpProcess.pid}`);

    // Pipe data from the claude-flow process's stdout to the WebSocket client
    mcpProcess.stdout.on('data', (data) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(data.toString());
        }
    });

    // Pipe data from the WebSocket client to the claude-flow process's stdin
    ws.on('message', (message) => {
        // Validate and sanitize input
        const validation = auth.validateInput(message.toString());
        if (!validation.valid) {
            console.error(`[MCP Bridge] Invalid input from ${clientIp}: ${validation.error}`);
            auth.logSecurityEvent('invalid_input', { clientId, error: validation.error });
            return;
        }
        
        // Rate limit check for individual messages
        if (!auth.checkRateLimit(clientId)) {
            ws.send(JSON.stringify({ 
                jsonrpc: '2.0', 
                error: { 
                    code: -32000, 
                    message: 'Rate limit exceeded' 
                }
            }));
            return;
        }
        
        const sanitizedMessage = typeof validation.sanitized === 'string' 
            ? validation.sanitized 
            : JSON.stringify(validation.sanitized);
        
        mcpProcess.stdin.write(sanitizedMessage + '\n');
    });

    // Handle WebSocket close event
    ws.on('close', () => {
        console.log(`[MCP Bridge] Client disconnected from ${clientIp}`);
        auth.logSecurityEvent('connection_closed', { clientId, ip: clientIp });
        activeConnections.delete(clientId);
        mcpProcess.kill();
    });

    // Handle claude-flow process exit
    mcpProcess.on('close', (code) => {
        console.log(`[MCP Bridge] claude-flow process exited with code ${code}`);
        if (ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
    });

    // Handle errors from the claude-flow process
    mcpProcess.stderr.on('data', (data) => {
        console.error(`[MCP Bridge] claude-flow stderr: ${data}`);
    });

    // Handle errors from the WebSocket
    ws.on('error', (error) => {
        console.error(`[MCP Bridge] WebSocket error: ${error.message}`);
        auth.logSecurityEvent('websocket_error', { clientId, error: error.message });
        activeConnections.delete(clientId);
        mcpProcess.kill();
    });
});

// Health check endpoint
const http = require('http');
const healthPort = parseInt(process.env.MCP_WS_HEALTH_PORT || '3003');

const healthServer = http.createServer((req, res) => {
    // Set CORS headers
    const origin = req.headers.origin;
    if (auth.config.corsAllowedOrigins.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }
    
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            status: 'healthy',
            connections: wss.clients.size,
            activeConnections: activeConnections.size,
            port: PORT,
            uptime: process.uptime(),
            authEnabled: auth.config.authEnabled,
            maxConnections: MAX_CONNECTIONS
        }));
    } else {
        res.writeHead(404);
        res.end();
    }
});

healthServer.listen(healthPort, '127.0.0.1', () => {
    console.log(`[MCP Bridge] Health check endpoint at http://127.0.0.1:${healthPort}/health`);
});

// Handle server errors
wss.on('error', (error) => {
    console.error(`[MCP Bridge] Server error: ${error.message}`);
});

// Connection cleanup interval
setInterval(() => {
    const now = Date.now();
    const timeout = parseInt(process.env.WS_CONNECTION_TIMEOUT || '300000');
    
    for (const [clientId, connection] of activeConnections.entries()) {
        if (now - connection.startTime > timeout) {
            console.log(`[MCP Bridge] Closing idle connection: ${clientId}`);
            auth.logSecurityEvent('connection_timeout', { clientId });
            connection.ws.close(1001, 'Connection timeout');
            activeConnections.delete(clientId);
        }
    }
}, 30000); // Check every 30 seconds

// Graceful shutdown
process.on('SIGINT', () => {
    console.log(`[MCP Bridge] Shutting down...`);
    auth.logSecurityEvent('server_shutdown', { activeConnections: activeConnections.size });
    
    // Close all active connections
    for (const [clientId, connection] of activeConnections.entries()) {
        connection.ws.close(1001, 'Server shutting down');
    }
    
    wss.close(() => {
        process.exit(0);
    });
});

process.on('SIGTERM', () => {
    console.log(`[MCP Bridge] Shutting down...`);
    wss.close(() => {
        process.exit(0);
    });
});