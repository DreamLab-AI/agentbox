#!/usr/bin/env node
/**
 * ADR-2207 D3: DevTools reachable by name, with Chrome's DNS-rebinding defence kept.
 *
 * Listens on 0.0.0.0:9223 and forwards to Chrome's DevTools endpoint on
 * 127.0.0.1:9222. Chrome refuses any Host that is not an IP literal or localhost
 * ("Host header is specified and is not an IP address or localhost"), so the old
 * socat byte pipe made http://browsercontainer:9223/json/version fail. This proxy:
 *
 *   - accepts only Host values that are IP literals, `localhost`, or a name in
 *     CDP_PROXY_ALLOWED_HOSTS (default `browsercontainer`), compared
 *     case-insensitively with the port ignored. Anything else, a missing or
 *     malformed Host included, gets 403 before Chrome is contacted, for plain
 *     requests and WebSocket upgrades alike. compose publishes this port on the
 *     host's loopback, so a page on evil.example rebinding to 127.0.0.1 must still
 *     be refused: that is exactly the check Chrome makes, moved here;
 *   - forwards HTTP with `Host: 127.0.0.1:9222` and the method verbatim (Chrome
 *     wants PUT for /json/new);
 *   - in /json, /json/list, /json/version and /json/new responses, rewrites the
 *     host in webSocketDebuggerUrl and in devtoolsFrontendUrl's ws= value to the
 *     host the caller used (port included), recomputing Content-Length;
 *   - passes WebSocket upgrades through as a raw byte pipe after rewriting the
 *     Host header line;
 *   - closes both sides on error, answers 502 when Chrome is down, and never logs
 *     a URL's query string or any message body.
 *
 * No dependencies beyond Node's standard library.
 */
'use strict';

const http = require('http');
const net = require('net');

const DEFAULT_ALLOWED_HOSTS = ['browsercontainer'];
const REWRITE_PATHS = new Set(['/json', '/json/list', '/json/version', '/json/new']);
const MAX_JSON_BYTES = 8 * 1024 * 1024;

/** Allow-list from CDP_PROXY_ALLOWED_HOSTS (comma-separated); default ['browsercontainer']. */
function allowedHostsFromEnv(env = process.env) {
  const raw = env.CDP_PROXY_ALLOWED_HOSTS;
  if (raw === undefined) return [...DEFAULT_ALLOWED_HOSTS];
  return raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
}

/**
 * Splits a Host header into its host part (lower-cased, IPv6 without brackets),
 * or returns null when it is malformed.
 */
function hostPart(header) {
  if (typeof header !== 'string' || header === '') return null;
  let host;
  let rest;
  if (header.startsWith('[')) {
    const end = header.indexOf(']');
    if (end < 0) return null;
    host = header.slice(1, end);
    rest = header.slice(end + 1);
    if (net.isIPv6(host) !== true) return null;
  } else {
    const colon = header.indexOf(':');
    host = colon < 0 ? header : header.slice(0, colon);
    rest = colon < 0 ? '' : header.slice(colon);
  }
  if (rest !== '' && !/^:[0-9]{1,5}$/.test(rest)) return null;
  return host.toLowerCase();
}

/** True when the Host header may reach Chrome (see the module comment). */
function hostAllowed(header, allowedHosts = DEFAULT_ALLOWED_HOSTS) {
  const host = hostPart(header);
  if (host === null || host === '') return false;
  if (net.isIP(host) !== 0) return true;
  if (host === 'localhost') return true;
  return allowedHosts.includes(host);
}

/** Rewrites the DevTools URLs in a /json* response body to the caller's host. */
function rewriteBody(text, callerHost) {
  const data = JSON.parse(text);
  const fix = (o) => {
    if (!o || typeof o !== 'object') return;
    if (typeof o.webSocketDebuggerUrl === 'string') {
      o.webSocketDebuggerUrl = o.webSocketDebuggerUrl.replace(/^(wss?:\/\/)[^/]+/, `$1${callerHost}`);
    }
    if (typeof o.devtoolsFrontendUrl === 'string') {
      o.devtoolsFrontendUrl = o.devtoolsFrontendUrl.replace(/([?&]wss?=)[^/&]+/, `$1${callerHost}`);
    }
  };
  if (Array.isArray(data)) data.forEach(fix); else fix(data);
  return JSON.stringify(data);
}

function refuse(res) {
  res.writeHead(403, { 'Content-Type': 'text/plain', Connection: 'close' });
  res.end('Host not allowed\n');
}

function createProxy({
  upstreamHost = '127.0.0.1',
  upstreamPort = 9222,
  allowedHosts = allowedHostsFromEnv(),
  log = (m) => process.stderr.write(`[cdp-proxy] ${m}\n`),
} = {}) {
  const upstream = `${upstreamHost}:${upstreamPort}`;
  const pathOf = (url) => String(url || '').split('?')[0];

  const server = http.createServer((req, res) => {
    const callerHost = req.headers.host;
    if (!hostAllowed(callerHost, allowedHosts)) {
      log(`403 ${req.method} ${pathOf(req.url)}`);
      return refuse(res);
    }
    const headers = { ...req.headers, host: upstream };
    const up = http.request({ host: upstreamHost, port: upstreamPort, method: req.method, path: req.url, headers },
      (ur) => {
        if (!REWRITE_PATHS.has(pathOf(req.url))) {
          res.writeHead(ur.statusCode, ur.headers);
          ur.pipe(res);
          return;
        }
        const chunks = [];
        let size = 0;
        ur.on('data', (c) => {
          size += c.length;
          if (size > MAX_JSON_BYTES) { ur.destroy(); res.destroy(); return; }
          chunks.push(c);
        });
        ur.on('end', () => {
          let out = Buffer.concat(chunks);
          try {
            out = Buffer.from(rewriteBody(out.toString('utf8'), callerHost));
          } catch {
            // Not JSON (an error page): pass it on unchanged.
          }
          const h = { ...ur.headers, 'content-length': String(out.length) };
          delete h['transfer-encoding'];
          res.writeHead(ur.statusCode, h);
          res.end(out);
        });
        ur.on('error', () => res.destroy());
      });
    up.on('error', (err) => {
      log(`502 ${req.method} ${pathOf(req.url)} (${err.code || 'error'})`);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain', Connection: 'close' });
        res.end('DevTools endpoint unavailable\n');
      } else {
        res.destroy();
      }
    });
    req.pipe(up);
  });

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    if (!hostAllowed(req.headers.host, allowedHosts)) {
      log(`403 upgrade ${pathOf(req.url)}`);
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nHost not allowed\n');
      return;
    }
    const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const name = req.rawHeaders[i];
      lines.push(name.toLowerCase() === 'host' ? `Host: ${upstream}` : `${name}: ${req.rawHeaders[i + 1]}`);
    }
    if (!req.headers.host) lines.push(`Host: ${upstream}`);
    const up = net.connect(upstreamPort, upstreamHost, () => {
      up.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head && head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on('error', (err) => {
      log(`502 upgrade ${pathOf(req.url)} (${err.code || 'error'})`);
      if (socket.writable && !up.bytesRead) {
        socket.end('HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n');
      } else {
        socket.destroy();
      }
    });
    up.on('close', () => socket.destroy());
    socket.on('close', () => up.destroy());
  });

  server.on('clientError', (err, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    else socket.destroy();
  });
  return server;
}

module.exports = { DEFAULT_ALLOWED_HOSTS, allowedHostsFromEnv, hostPart, hostAllowed, rewriteBody, createProxy };

if (require.main === module) {
  const port = parseInt(process.env.CDP_PROXY_PORT || '9223', 10);
  const upstreamPort = parseInt(process.env.CDP_PORT || '9222', 10);
  const allowedHosts = allowedHostsFromEnv();
  const server = createProxy({ upstreamPort, allowedHosts });
  server.listen(port, '0.0.0.0', () => {
    process.stderr.write(`[cdp-proxy] 0.0.0.0:${port} -> 127.0.0.1:${upstreamPort}; ` +
      `Host allow-list: IP literals, localhost, ${allowedHosts.join(', ') || '(no names)'}\n`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
