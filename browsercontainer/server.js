#!/usr/bin/env node
/**
 * Browser Sidecar — GPU-accelerated Playwright MCP server
 *
 * Launches Chromium with hardware WebGPU/Vulkan flags inside a dedicated
 * container. Supports stdio and SSE transports.
 *
 * Environment:
 *   SIDECAR_TRANSPORT   — "stdio" or "sse" (default: sse)
 *   SIDECAR_PORT        — SSE listen port (default: 8931)
 *   CHROMIUM_PATH       — path to chromium binary
 *   DISPLAY             — X11 display (default: :2)
 *   VK_ICD_FILENAMES    — Vulkan ICD path (passthrough)
 *   __EGL_VENDOR_LIBRARY_FILENAMES — EGL vendor path (passthrough)
 */
'use strict';

const { createConnection } = require('@playwright/mcp');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { SSEServerTransport } = require('@modelcontextprotocol/sdk/server/sse.js');
const { execFileSync } = require('child_process');
const http = require('http');

const log = (msg) => process.stderr.write(`[browsercontainer] ${msg}\n`);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const TRANSPORT  = process.env.SIDECAR_TRANSPORT || 'sse';
const PORT       = parseInt(process.env.SIDECAR_PORT || '8931', 10);
const DISPLAY    = process.env.DISPLAY || ':2';
const OUTPUT_DIR = process.env.PLAYWRIGHT_OUTPUT_DIR || '/tmp/playwright-mcp';

const TIMEOUT_ACTION = parseInt(process.env.PLAYWRIGHT_TIMEOUT || '30000', 10);
const TIMEOUT_NAV    = parseInt(process.env.PLAYWRIGHT_NAV_TIMEOUT || '180000', 10);
const VIEWPORT_W     = parseInt(process.env.VIEWPORT_WIDTH || '1920', 10);
const VIEWPORT_H     = parseInt(process.env.VIEWPORT_HEIGHT || '1080', 10);

function resolveChromium() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  try { return execFileSync('which', ['chromium'], { encoding: 'utf8' }).trim(); } catch {}
  try { return execFileSync('which', ['chromium-browser'], { encoding: 'utf8' }).trim(); } catch {}
  return '/usr/bin/chromium';
}

const CHROMIUM_PATH = resolveChromium();

// ---------------------------------------------------------------------------
// Chrome launch args — hardware WebGPU via Vulkan
// ---------------------------------------------------------------------------

const launchArgs = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-breakpad',
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan,VulkanFromANGLE,DefaultANGLEVulkan,WebGPU,UseSkiaRenderer',
  '--use-angle=vulkan',
  '--ignore-gpu-blocklist',
  '--enable-gpu-rasterization',
  '--disable-gpu-sandbox',
  '--disable-vulkan-surface',
  '--user-data-dir=/tmp/chromium-data',
  `--remote-debugging-port=9222`,
];

// ---------------------------------------------------------------------------
// Environment passed to Chrome subprocess
// ---------------------------------------------------------------------------

const launchEnv = {
  ...process.env,
  DISPLAY,
  ...(process.env.VK_ICD_FILENAMES
    ? { VK_ICD_FILENAMES: process.env.VK_ICD_FILENAMES }
    : {}),
  ...(process.env.__EGL_VENDOR_LIBRARY_FILENAMES
    ? { __EGL_VENDOR_LIBRARY_FILENAMES: process.env.__EGL_VENDOR_LIBRARY_FILENAMES }
    : {}),
};

// ---------------------------------------------------------------------------
// MCP connection config
// ---------------------------------------------------------------------------

const connectionConfig = {
  browser: {
    browserName: 'chromium',
    launchOptions: {
      executablePath: CHROMIUM_PATH,
      headless: false,
      env: launchEnv,
      args: launchArgs,
    },
    contextOptions: {
      viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
      userAgent: [
        'Mozilla/5.0 (X11; Linux x86_64)',
        'AppleWebKit/537.36 (KHTML, like Gecko)',
        'Chrome/120.0.0.0 Safari/537.36',
      ].join(' '),
    },
  },
  capabilities: [
    'core', 'core-navigation', 'core-tabs', 'core-input',
    'network', 'vision', 'storage',
  ],
  outputDir: OUTPUT_DIR,
  imageResponses: 'allow',
  timeouts: {
    action:     TIMEOUT_ACTION,
    navigation: TIMEOUT_NAV,
  },
  snapshot: { mode: 'full' },
};

// ---------------------------------------------------------------------------
// SSE transport server
// ---------------------------------------------------------------------------

async function startSSE(server) {
  const activeSessions = new Map();

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', transport: 'sse', sessions: activeSessions.size }));
      return;
    }

    if (url.pathname === '/sse' && req.method === 'GET') {
      const transport = new SSEServerTransport('/messages', res);
      activeSessions.set(transport.sessionId, transport);

      res.on('close', () => {
        activeSessions.delete(transport.sessionId);
        log(`SSE session closed: ${transport.sessionId}`);
      });

      await server.connect(transport);
      log(`SSE session started: ${transport.sessionId}`);
      return;
    }

    if (url.pathname === '/messages' && req.method === 'POST') {
      const sessionId = url.searchParams.get('sessionId');
      const transport = activeSessions.get(sessionId);
      if (!transport) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }
      await transport.handlePostMessage(req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  httpServer.listen(PORT, '0.0.0.0', () => {
    log(`SSE server listening on 0.0.0.0:${PORT}`);
  });

  return httpServer;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const server = await createConnection(connectionConfig);

  if (TRANSPORT === 'stdio') {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log('stdio transport connected');
  } else {
    await startSSE(server);
  }

  log(`Chromium: ${CHROMIUM_PATH}`);
  log(`Display: ${DISPLAY}`);
  log(`Transport: ${TRANSPORT}`);
  log(`WebGPU: hardware Vulkan`);
  log(`Viewport: ${VIEWPORT_W}x${VIEWPORT_H}`);
  log(`CDP debug: port 9222`);

  process.on('SIGTERM', () => { server.close(); process.exit(0); });
  process.on('SIGINT',  () => { server.close(); process.exit(0); });
}

main().catch(err => {
  log(`Fatal: ${err.message}`);
  process.exit(1);
});
