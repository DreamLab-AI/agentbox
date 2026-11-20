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
 *
 * ADR-2207 additions:
 *   - the MCP child runs in the exchange (cwd and TMPDIR), with usage statistics
 *     and update checks off;
 *   - /health answers 503 when Chrome is unreachable and reports the display and
 *     the versions the image was built with;
 *   - GET /display, POST /display/fullscreen, GET /record, POST /record/start,
 *     POST /record/stop. The three POSTs change state, and this port is published
 *     on the host's loopback with `Access-Control-Allow-Origin: *` on the MCP
 *     endpoints, so they refuse any request carrying an Origin header (agents and
 *     curl send none) and never emit CORS headers. /sse and /messages keep their
 *     CORS behaviour (see ADR-2207: tightening them is a separate decision).
 */
'use strict';

const http = require('http');
const { spawn, execFile } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const log = (msg) => process.stderr.write(`[browsercontainer] ${msg}\n`);

const PORT = parseInt(process.env.SIDECAR_PORT || '8931', 10);
const CDP_PORT = parseInt(process.env.CDP_PORT || '9222', 10);
const VERSIONS_FILE = '/opt/browsercontainer/versions.json';
const MAX_BODY_BYTES = 4096;
const PROTECTED_PATHS = new Set(['/display/fullscreen', '/record/start', '/record/stop']);

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
 * path agentbox mounts. Usage statistics and update checks are off (flag and
 * env), so nothing leaves the estate.
 */
function childSpawnConfig({ cdpPort, exchangeDir, env = process.env }) {
  const childEnv = {
    ...env,
    DISPLAY: env.DISPLAY || ':2',
    CHROME_DEVTOOLS_MCP_NO_USAGE_STATISTICS: '1',
    CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1',
  };
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
      '--no-usage-statistics',
    ],
    options,
  };
}

// ---------------------------------------------------------------------------
// Build facts and record.sh delegation
// ---------------------------------------------------------------------------

/** versions.json written at image build (ADR-2207 D6); {} when absent or unreadable. */
function readVersions(file = VERSIONS_FILE) {
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Runs record.sh with the given args; resolves { code, stdout, stderr }. */
function createRecordRunner({ script = path.join(__dirname, 'record.sh'), env = process.env, timeoutMs = 40000 } = {}) {
  return (args) => new Promise((resolve) => {
    execFile(script, args, { env, timeout: timeoutMs, maxBuffer: 64 * 1024 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      resolve({ code, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

// ---------------------------------------------------------------------------
// Request helpers
// ---------------------------------------------------------------------------

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Reads at most `max` bytes of body; rejects with 413 beyond that (and drains the rest). */
function readBody(req, max = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = false;
    req.on('data', (c) => {
      if (over) return;
      size += c.length;
      if (size > max) {
        over = true;
        reject(new HttpError(413, `body larger than ${max} bytes`));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', (e) => reject(new HttpError(400, e.message)));
  });
}

/**
 * Parses a JSON object body whose keys are all in `allowed`. An empty body is
 * {} when `allowEmpty`; anything else that is not such an object is a 400.
 */
function parseJsonObject(text, allowed, { allowEmpty = false } = {}) {
  if (text.trim() === '') {
    if (allowEmpty) return {};
    throw new HttpError(400, 'JSON body required');
  }
  let v;
  try { v = JSON.parse(text); } catch { throw new HttpError(400, 'body is not JSON'); }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'body must be a JSON object');
  for (const k of Object.keys(v)) {
    if (!allowed.includes(k)) throw new HttpError(400, `unknown field '${k}'`);
  }
  return v;
}

function validateFullscreen(text) {
  const b = parseJsonObject(text, ['on']);
  if (typeof b.on !== 'boolean') throw new HttpError(400, "'on' must be true or false");
  return b.on;
}

function validateRecordStart(text) {
  const b = parseJsonObject(text, ['name'], { allowEmpty: true });
  if (b.name === undefined) return undefined;
  if (typeof b.name !== 'string' || b.name.length < 1 || b.name.length > 128) {
    throw new HttpError(400, "'name' must be a string of 1-128 characters");
  }
  return b.name;
}

function sendJson(res, status, obj, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// Session: bridges one SSE connection to one chrome-devtools-mcp subprocess
// ---------------------------------------------------------------------------

class Session {
  constructor(id, res, resolveExchange, cdpPort = CDP_PORT, { spawnFn = spawn, onDead = () => {} } = {}) {
    this.id = id;
    this.res = res;
    this.resolveExchange = resolveExchange;
    this.cdpPort = cdpPort;
    this.spawnFn = spawnFn;
    this.onDead = onDead;
    this.child = null;
    this.buffer = '';
    this.alive = true;
  }

  start() {
    // Spawn chrome-devtools-mcp in stdio mode, connecting to our persistent Chrome
    const { command, args, options } = childSpawnConfig({
      cdpPort: this.cdpPort,
      exchangeDir: this.resolveExchange(exchangeDirFromEnv()),
    });
    this.child = this.spawnFn(command, args, options);

    this.child.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString();
      this._flushMessages();
    });

    this.child.stderr.on('data', (chunk) => {
      log(`[${this.id.slice(0, 8)}] stderr: ${chunk.toString().trim()}`);
    });

    // A dead child ends the SSE stream, so the client sees the session close and
    // reconnects instead of POSTing into a 503 forever.
    this.child.on('exit', (code) => {
      log(`[${this.id.slice(0, 8)}] subprocess exited (code=${code})`);
      this._die();
    });

    this.child.on('error', (err) => {
      log(`[${this.id.slice(0, 8)}] subprocess error: ${err.message}`);
      this._die();
    });

    // Send SSE endpoint event
    this._sseWrite(`event: endpoint\ndata: /messages?sessionId=${this.id}\n\n`);
    log(`Session ${this.id.slice(0, 8)} started`);
  }

  _die() {
    if (!this.alive) return;
    this.alive = false;
    if (this.res && !this.res.writableEnded) this.res.end();
    this.onDead(this.id);
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
      const child = this.child;
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 3000).unref();
      this.child = null;
    }
    log(`Session ${this.id.slice(0, 8)} destroyed`);
  }
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

/**
 * The bridge's HTTP server. Dependencies are injectable for tests:
 *   cdp     { version(), window(), fullscreen(on) }   (cdp.js cdpClient)
 *   record  (args) => Promise<{ code, stdout, stderr }> (createRecordRunner)
 *   display { width, height, size } | null             (display.js)
 *   versions build facts (readVersions)
 */
function createBridgeServer({
  cdpPort = CDP_PORT,
  display = null,
  versions = {},
  cdp,
  record,
  sessions = new Map(),
  resolveExchange = createExchangeResolver(),
  spawnFn = spawn,
} = {}) {
  const connectorVersion = versions['chrome-devtools-mcp'] || null;

  async function health(res) {
    const base = {
      transport: 'sse',
      sessions: sessions.size,
      connector: 'chrome-devtools-mcp',
      display: display ? display.size : null,
      connectorVersion,
      versions,
    };
    try {
      const v = await cdp.version();
      sendJson(res, 200, { status: 'ok', ...base, chrome: true, cdp: `127.0.0.1:${cdpPort}`,
        chromeVersion: v && v.Browser ? v.Browser : null });
    } catch {
      sendJson(res, 503, { status: 'degraded', ...base, chrome: false });
    }
  }

  async function recordCall(res, args) {
    const r = await record(args);
    let body;
    try { body = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { body = null; }
    const status = r.code === 0 ? 200 : (r.code === 3 || r.code === 4) ? 409 : 500;
    if (!body || typeof body !== 'object') body = { error: (r.stderr || 'record.sh failed').trim().slice(0, 500) };
    sendJson(res, status, body);
  }

  async function route(req, res, url) {
    const p = url.pathname;
    const method = req.method;
    const only = (m) => { if (method !== m) throw new HttpError(405, `${p} accepts ${m} only`); };

    if (p === '/health') return health(res);

    if (p === '/display') {
      only('GET');
      try {
        const window = await cdp.window();
        return sendJson(res, 200, { size: display ? display.size : null, width: display ? display.width : null,
          height: display ? display.height : null, window });
      } catch (e) {
        throw new HttpError(503, `browser window unavailable: ${e.message}`);
      }
    }
    if (p === '/display/fullscreen') {
      only('POST');
      const on = validateFullscreen(await readBody(req));
      try {
        return sendJson(res, 200, { fullscreen: on, window: await cdp.fullscreen(on) });
      } catch (e) {
        throw new HttpError(503, `fullscreen change failed: ${e.message}`);
      }
    }
    if (p === '/record') { only('GET'); return recordCall(res, ['status']); }
    if (p === '/record/start') {
      only('POST');
      const name = validateRecordStart(await readBody(req));
      return recordCall(res, name === undefined ? ['start'] : ['start', name]);
    }
    if (p === '/record/stop') {
      only('POST');
      parseJsonObject(await readBody(req), [], { allowEmpty: true });
      return recordCall(res, ['stop']);
    }

    if (p === '/sse' && method === 'GET') {
      const sessionId = crypto.randomUUID();
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      const session = new Session(sessionId, res, resolveExchange, cdpPort, {
        spawnFn,
        onDead: (id) => {
          const s = sessions.get(id);
          if (s) { s.destroy(); sessions.delete(id); }
        },
      });
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
      return undefined;
    }

    if (p === '/messages' && method === 'POST') {
      const sessionId = url.searchParams.get('sessionId');
      const session = sessions.get(sessionId);
      if (!session) return sendJson(res, 404, { error: 'Session not found' });
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        const ok = session.handleMessage(body);
        if (ok) {
          res.writeHead(202);
          res.end();
        } else {
          sendJson(res, 503, { error: 'Session dead' });
        }
      });
      return undefined;
    }

    return sendJson(res, 404, { error: 'Not found' });
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const isProtected = PROTECTED_PATHS.has(url.pathname);

    if (isProtected) {
      // State-changing: no CORS at all, and any Origin (including "null") is a
      // browser page, never an agent. Refused before the body is read.
      if (req.headers.origin !== undefined) {
        req.resume();
        return sendJson(res, 403, { error: 'requests with an Origin header are refused on this endpoint' },
          { Connection: 'close' });
      }
      if (req.method === 'OPTIONS') return sendJson(res, 405, { error: 'no CORS on this endpoint' });
    } else {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return undefined;
      }
    }

    route(req, res, url).catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 413) req.resume();
      if (!res.headersSent) {
        sendJson(res, status, { error: err.message }, status === 413 ? { Connection: 'close' } : {});
      } else {
        res.destroy();
      }
    });
    return undefined;
  });
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

async function main() {
  await waitForChrome();
  log('Chrome CDP available');

  let display = null;
  try {
    display = require('./display.js').parseDisplaySize();
  } catch (err) {
    log(`WARN: ${err.message}; /display reports no configured size`);
  }
  const sessions = new Map();
  const server = createBridgeServer({
    cdpPort: CDP_PORT,
    display,
    versions: readVersions(),
    cdp: require('./cdp.js').cdpClient(CDP_PORT),
    record: createRecordRunner(),
    sessions,
  });

  server.listen(PORT, '0.0.0.0', () => {
    log(`SSE bridge listening on 0.0.0.0:${PORT}`);
    log(`Connector: chrome-devtools-mcp → 127.0.0.1:${CDP_PORT}`);
    log(`Display: ${display ? display.size : 'unknown'}; exchange: ${exchangeDirFromEnv()}`);
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
  MAX_BODY_BYTES,
  PROTECTED_PATHS,
  exchangeDirFromEnv,
  createExchangeResolver,
  childSpawnConfig,
  readVersions,
  createRecordRunner,
  parseJsonObject,
  validateFullscreen,
  validateRecordStart,
  createBridgeServer,
};

if (require.main === module) {
  main().catch(err => {
    log(`Fatal: ${err.message}`);
    process.exit(1);
  });
}
