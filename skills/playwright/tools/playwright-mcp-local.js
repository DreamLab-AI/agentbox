#!/usr/bin/env node

/**
 * Playwright MCP Local Server
 * 
 * This script runs the Playwright MCP server locally within the multi-agent container.
 * It provides headless browser automation capabilities.
 */

const { spawn } = require('child_process');
const path = require('path');

console.error('Starting Playwright MCP Server locally...');

// Set up environment for headless operation
const env = {
  ...process.env,
  PLAYWRIGHT_BROWSERS_PATH: '/opt/playwright-browsers',
  PLAYWRIGHT_HEADLESS: 'true',
  NODE_ENV: 'production'
};

// Spawn the actual Playwright MCP server
const playwrightMcp = spawn('npx', ['-y', '@executeautomation/playwright-mcp-server'], {
  env: env,
  stdio: 'inherit' // Direct pass-through of stdio
});

// Handle process events
playwrightMcp.on('error', (err) => {
  console.error('Failed to start Playwright MCP server:', err);
  process.exit(1);
});

playwrightMcp.on('exit', (code) => {
  console.error(`Playwright MCP server exited with code ${code}`);
  process.exit(code || 0);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.error('Received SIGTERM, shutting down...');
  playwrightMcp.kill('SIGTERM');
});

process.on('SIGINT', () => {
  console.error('Received SIGINT, shutting down...');
  playwrightMcp.kill('SIGINT');
});