#!/usr/bin/env node

/**
 * Playwright MCP Proxy
 * 
 * This script creates a proxy connection from the main container to the Playwright
 * MCP server running in the GUI container. This allows the main container to use
 * Playwright with visual debugging capabilities through the GUI container's display.
 */

const net = require('net');

// Configuration
const GUI_CONTAINER_HOST = process.env.GUI_CONTAINER_HOST || 'gui-tools-service';
const GUI_PLAYWRIGHT_PORT = parseInt(process.env.GUI_PLAYWRIGHT_PORT || '9879');
const LOCAL_PROXY_PORT = parseInt(process.env.LOCAL_PLAYWRIGHT_PROXY_PORT || '9879');

console.log(`Starting Playwright MCP Proxy`);
console.log(`Proxying localhost:${LOCAL_PROXY_PORT} -> ${GUI_CONTAINER_HOST}:${GUI_PLAYWRIGHT_PORT}`);

// Create the proxy server
const server = net.createServer((clientSocket) => {
  console.log('Client connected to proxy');
  
  // Connect to the Playwright MCP server in the GUI container
  const guiSocket = net.createConnection({
    host: GUI_CONTAINER_HOST,
    port: GUI_PLAYWRIGHT_PORT
  }, () => {
    console.log(`Connected to GUI container Playwright MCP at ${GUI_CONTAINER_HOST}:${GUI_PLAYWRIGHT_PORT}`);
  });
  
  // Pipe data between client and GUI container
  clientSocket.pipe(guiSocket);
  guiSocket.pipe(clientSocket);
  
  // Handle errors
  clientSocket.on('error', (err) => {
    console.error('Client socket error:', err.message);
    guiSocket.destroy();
  });
  
  guiSocket.on('error', (err) => {
    console.error('GUI socket error:', err.message);
    clientSocket.destroy();
  });
  
  // Handle disconnections
  clientSocket.on('close', () => {
    console.log('Client disconnected');
    guiSocket.destroy();
  });
  
  guiSocket.on('close', () => {
    console.log('GUI container connection closed');
    clientSocket.destroy();
  });
});

// Start the proxy server
server.listen(LOCAL_PROXY_PORT, '127.0.0.1', () => {
  console.log(`Playwright MCP Proxy listening on 127.0.0.1:${LOCAL_PROXY_PORT}`);
  console.log(`VNC access available at host:5901 for visual browser debugging`);
});

// Health check endpoint
const healthServer = net.createServer((socket) => {
  // Try to connect to the GUI container to check if it's available
  const testSocket = net.createConnection({
    host: GUI_CONTAINER_HOST,
    port: GUI_PLAYWRIGHT_PORT + 1, // Health check port
    timeout: 2000
  }, () => {
    socket.write('HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"status":"healthy","gui_container":"connected"}\n');
    socket.end();
    testSocket.destroy();
  });
  
  testSocket.on('error', () => {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\n\r\n{"status":"unhealthy","gui_container":"disconnected"}\n');
    socket.end();
  });
});

healthServer.listen(LOCAL_PROXY_PORT + 1, '127.0.0.1', () => {
  console.log(`Health check endpoint at 127.0.0.1:${LOCAL_PROXY_PORT + 1}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down proxy...');
  server.close();
  healthServer.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Shutting down proxy...');
  server.close();
  healthServer.close();
  process.exit(0);
});