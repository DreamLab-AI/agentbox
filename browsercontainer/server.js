#!/usr/bin/env node
/**
 * Browser Container — SSE bridge to chrome-devtools-mcp
 *
 * Spawns Google's chrome-devtools-mcp as a stdio subprocess per session,
 * bridging MCP JSON-RPC between SSE HTTP transport and the connector's
 * stdin/stdout. Chrome is persistent (supervisord), MCP connector attaches
 * via CDP on localhost:9222.
 *
 * This gives us all 40 chrome-devtools-mcp tools (screenshots, accessibility
 * snapshots, performance traces, memory profiling, extension management,
 * WebMCP discovery on Chrome 149+) while preserving hardware WebGPU.
 */
'use strict';

const http = require('http');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const log = (msg) => process.stderr.write(`[browsercontainer] ${msg}\n`);

const PORT = parseInt(process.env.SIDECAR_PORT || '8931', 10);
const CDP_PORT = parseInt(process.env.CDP_PORT || '9222', 10);

// ---------------------------------------------------------------------------
// MCP child: arguments, environment, working directory
// ---------------------------------------------------------------------------

const DEFAULT_EXCHANGE_DIR = '/home/devuser/exchange';

/** The exchange volume's mount in this container (ADR-2207 D2). */
function exchangeDirFromEnv(env = process.env) {
  return env.BROWSER_EXCHANGE_DIR || DEFAULT_EXCHANGE_DIR;
}

/**
 * Returns a function mapping the configured exchange dir to itself when it is a
 * writable directory (creating its mcp/ subdirectory), or to null otherwise. The
 * first failure is logged once per resolver, so a missing volume does not log on
 * every session. Never creates the exchange itself, never deletes anything in it.
 */
function createExchangeResolver(logFn = log) {
  let warned = false;
  return (dir) => {
    try {
      if (!dir || !fs.statSync(dir).isDirectory()) throw new Error('not a directory');
      fs.accessSync(dir, fs.constants.W_OK);
      fs.mkdirSync(path.join(dir, 'mcp'), { recursive: true });
      return dir;
    } catch (err) {
      if (!warned) {
        warned = true;
        logFn(`WARN: exchange ${dir} unusable (${err.code || err.message}); MCP child keeps default cwd and TMPDIR`);
      }
      return null;
    }
  };
}

/**
 * How one chrome-devtools-mcp child is spawned. With an exchange dir, the child's
 * cwd and TMPDIR are the exchange: a relative filePath lands there, and the
 * connector's os.tmpdir() root accepts any path under it at the same absolute
 * path agentbox mounts.
 */
function childSpawnConfig({ cdpPort, exchangeDir, env = process.env }) {
  const childEnv = { ...env, DISPLAY: env.DISPLAY || ':2' };
  if (exchangeDir) childEnv.TMPDIR = exchangeDir;
  const options = { stdio: ['pipe', 'pipe', 'pipe'], env: childEnv };
  if (exchangeDir) options.cwd = exchangeDir;
  return {
    command: 'chrome-devtools-mcp',
    args: [
      `--browser-url=http://127.0.0.1:${cdpPort}`,
      '--headless=false',
      '--category-experimental-webmcp',
      '--experimental-vision',
      '--experimental-memory',
    ],
    options,
  };
}

// ---------------------------------------------------------------------------
// Wait for Chrome CDP to be reachable before accepting sessions
// ---------------------------------------------------------------------------

function waitForChrome(maxWait = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      http.get(`http://127.0.0.1:${CDP_PORT}/json/version`, res => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve(d));
      }).on('error', () => {
        if (Date.now() - start > maxWait) return reject(new Error('Chrome CDP timeout'));
        setTimeout(check, 500);
      });
    };
    check();
  });
}

// ---------------------------------------------------------------------------
// Session: bridges one SSE connection to one chrome-devtools-mcp subprocess
// ---------------------------------------------------------------------------

class Session {
  constructor(id, res, resolveExchange) {
    this.id = id;
    this.res = res;
    this.resolveExchange = resolveExchange;
    this.child = null;
    this.buffer = '';
    this.alive = true;
  }

  start() {
    // Spawn chrome-devtools-mcp in stdio mode, connecting to our persistent Chrome
    const { command, args, options } = childSpawnConfig({
      cdpPort: CDP_PORT,
      exchangeDir: this.resolveExchange(exchangeDirFromEnv()),
    });
    this.child = spawn(command, args, options);

    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString();
      this._flushMessages();
    });

    this.child.stderr.on('data', (chunk) => {
      log(`[${this.id.slice(0, 8)}] stderr: ${chunk.toString().trim()}`);
    });

    this.child.on('exit', (code) => {
      log(`[${this.id.slice(0, 8)}] subprocess exited (code=${code})`);
      this.alive = false;
    });

    this.child.on('error', (err) => {
      log(`[${this.id.slice(0, 8)}] subprocess error: ${err.message}`);
      this.alive = false;
    });

    // Send SSE endpoint event
    this._sseWrite(`event: endpoint\ndata: /messages?sessionId=${this.id}\n\n`);
    log(`Session ${this.id.slice(0, 8)} started`);
  }

  handleMessage(body) {
    if (!this.child || !this.alive) return false;
    this.child.stdin.write(body + '\n');
    return true;
  }

  _flushMessages() {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      this._sseWrite(`event: message\ndata: ${line}\n\n`);
    }
  }

  _sseWrite(data) {
    if (this.res && !this.res.writableEnded) {
      this.res.write(data);
    }
  }

  destroy() {
    this.alive = false;
    if (this.child) {
      this.child.stdin.end();
      this.child.kill('SIGTERM');
      setTimeout(() => {
        try { this.child.kill('SIGKILL'); } catch {}
      }, 3000);
      this.child = null;
    }
    log(`Session ${this.id.slice(0, 8)} destroyed`);
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

async function main() {
  await waitForChrome();
  log('Chrome CDP available');

  const sessions = new Map();
  const resolveExchange = createExchangeResolver();

  const server = http.createServer((req, res) => {
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
      let chromeOk = false;
      const checkReq = http.get(`http://127.0.0.1:${CDP_PORT}/json/version`, (r) => {
        let d = '';
        r.on('data', c => d += c);
        r.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            status: 'ok',
            transport: 'sse',
            sessions: sessions.size,
            chrome: true,
            cdp: `127.0.0.1:${CDP_PORT}`,
            connector: 'chrome-devtools-mcp',
          }));
        });
      });
      checkReq.on('error', () => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'degraded',
          transport: 'sse',
          sessions: sessions.size,
          chrome: false,
          connector: 'chrome-devtools-mcp',
        }));
      });
      return;
    }

    if (url.pathname === '/sse' && req.method === 'GET') {
      const sessionId = crypto.randomUUID();
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const session = new Session(sessionId, res, resolveExchange);
      sessions.set(sessionId, session);
      session.start();

      req.on('close', () => {
        const s = sessions.get(sessionId);
        if (s) {
          s.destroy();
          sessions.delete(sessionId);
        }
        log(`${sessions.size} sessions remaining`);
      });
      return;
    }

    if (url.pathname === '/messages' && req.method === 'POST') {
      const sessionId = url.searchParams.get('sessionId');
      const session = sessions.get(sessionId);
      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const ok = session.handleMessage(body);
        if (ok) {
          res.writeHead(202);
          res.end();
        } else {
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session dead' }));
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  server.listen(PORT, '0.0.0.0', () => {
    log(`SSE bridge listening on 0.0.0.0:${PORT}`);
    log(`Connector: chrome-devtools-mcp → 127.0.0.1:${CDP_PORT}`);
    log(`WebGL: hardware-accelerated via Vulkan/ANGLE (persistent Chrome)`);
  });

  process.on('SIGTERM', () => {
    for (const s of sessions.values()) s.destroy();
    process.exit(0);
  });
  process.on('SIGINT', () => {
    for (const s of sessions.values()) s.destroy();
    process.exit(0);
  });
}

module.exports = {
  DEFAULT_EXCHANGE_DIR,
  exchangeDirFromEnv,
  createExchangeResolver,
  childSpawnConfig,
};

if (require.main === module) {
  main().catch(err => {
    log(`Fatal: ${err.message}`);
    process.exit(1);
  });
}

