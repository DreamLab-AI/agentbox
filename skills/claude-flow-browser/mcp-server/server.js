#!/usr/bin/env node
/**
 * @claude-flow/browser MCP Server Wrapper
 *
 * This is a thin wrapper that starts the @claude-flow/browser MCP server.
 * The actual implementation is in the npm package.
 *
 * Priority: 1 (PRIMARY browser system)
 * Fallback: playwright-mcp, chrome-devtools-mcp
 */

const { spawn } = require('child_process');
const path = require('path');

// Configuration
const PORT = process.env.CLAUDE_FLOW_BROWSER_PORT || 9510;
const DISPLAY = process.env.DISPLAY || ':1';
const HEADLESS = process.env.BROWSER_HEADLESS || 'false';

console.log('[claude-flow-browser] Starting MCP server...');
console.log(`[claude-flow-browser] Port: ${PORT}`);
console.log(`[claude-flow-browser] Display: ${DISPLAY}`);
console.log(`[claude-flow-browser] Headless: ${HEADLESS}`);

// Start the @claude-flow/browser server
const server = spawn('npx', [
  '@claude-flow/browser',
  'serve',
  '--port', PORT.toString(),
  '--display', DISPLAY,
  HEADLESS === 'true' ? '--headless' : ''
].filter(Boolean), {
  stdio: 'inherit',
  env: {
    ...process.env,
    DISPLAY,
    BROWSER_HEADLESS: HEADLESS
  }
});

server.on('error', (err) => {
  console.error('[claude-flow-browser] Failed to start:', err.message);
  process.exit(1);
});

server.on('exit', (code) => {
  console.log(`[claude-flow-browser] Server exited with code ${code}`);
  process.exit(code || 0);
});

// Handle shutdown gracefully
process.on('SIGTERM', () => {
  console.log('[claude-flow-browser] Received SIGTERM, shutting down...');
  server.kill('SIGTERM');
});

process.on('SIGINT', () => {
  console.log('[claude-flow-browser] Received SIGINT, shutting down...');
  server.kill('SIGINT');
});
