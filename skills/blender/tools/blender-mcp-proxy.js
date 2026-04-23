#!/usr/bin/env node

/**
 * Blender MCP Proxy
 * 
 * This script creates a proxy connection from the main container to the Blender
 * MCP server running in the GUI container.
 */

const net = require('net');

// Configuration
const GUI_CONTAINER_HOST = process.env.GUI_CONTAINER_HOST || 'gui-tools-service';
const GUI_BLENDER_PORT = parseInt(process.env.GUI_BLENDER_PORT || '9876');
const LOCAL_PROXY_PORT = parseInt(process.env.LOCAL_BLENDER_PROXY_PORT || '9876');

console.log(`Starting Blender MCP Proxy`);
console.log(`Proxying localhost:${LOCAL_PROXY_PORT} -> ${GUI_CONTAINER_HOST}:${GUI_BLENDER_PORT}`);

// Create the proxy server
const server = net.createServer((clientSocket) => {
  console.log('Client connected to Blender proxy');
  
  // Connect to the Blender MCP server in the GUI container
  const guiSocket = net.createConnection({
    host: GUI_CONTAINER_HOST,
    port: GUI_BLENDER_PORT
  }, () => {
    console.log(`Connected to GUI container Blender MCP at ${GUI_CONTAINER_HOST}:${GUI_BLENDER_PORT}`);
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
  console.log(`Blender MCP Proxy listening on 127.0.0.1:${LOCAL_PROXY_PORT}`);
  console.log(`VNC access available at host:5901 for visual interaction`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down proxy...');
  server.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Shutting down proxy...');
  server.close();
  process.exit(0);
});