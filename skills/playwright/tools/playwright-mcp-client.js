#!/usr/bin/env node

/**
 * Playwright MCP Client
 * 
 * This client connects to the Playwright MCP proxy, which forwards
 * requests to the Playwright server running in the GUI container.
 * This enables visual browser automation through VNC.
 */

const net = require('net');
const readline = require('readline');

const PROXY_HOST = process.env.PLAYWRIGHT_PROXY_HOST || '127.0.0.1';
const PROXY_PORT = parseInt(process.env.PLAYWRIGHT_PROXY_PORT || '9879');

console.error(`Connecting to Playwright MCP via proxy at ${PROXY_HOST}:${PROXY_PORT}`);

// Create connection to proxy
const socket = net.createConnection({
  host: PROXY_HOST,
  port: PROXY_PORT
}, () => {
  console.error('Connected to Playwright MCP proxy');
  console.error('Visual browser access available via VNC on port 5901');
});

// Set up stdio interface
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

// Forward stdin to socket
rl.on('line', (line) => {
  socket.write(line + '\n');
});

// Forward socket data to stdout
socket.on('data', (data) => {
  process.stdout.write(data);
});

// Handle errors
socket.on('error', (err) => {
  console.error('Proxy connection error:', err.message);
  console.error('Make sure the GUI container is running and the proxy is active');
  process.exit(1);
});

socket.on('close', () => {
  console.error('Proxy connection closed');
  process.exit(0);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  socket.destroy();
  process.exit(0);
});

process.on('SIGINT', () => {
  socket.destroy();
  process.exit(0);
});