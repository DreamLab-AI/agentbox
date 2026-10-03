#!/usr/bin/env node
'use strict';
// docker-read-proxy — GET-only window onto the host Docker socket for devuser
// under [security].role_isolation (custody X-1 step 1, W0; owner question Q1).
//
// The host Docker daemon is root on the host. With role isolation on, the
// entrypoint stops widening /var/run/docker.sock, and devuser's docker CLI
// points here instead (DOCKER_HOST=unix:///run/docker-ro.sock, set by the
// Phase-8 runtime env). Monitoring keeps working: docker ps, logs, inspect,
// version, info. Everything else gets 403: exec, run, create, start, kill,
// rm, cp in or out (archive), export, attach, images, volumes, build.
// `docker exec` moves to the host shell.
//
// Shape:
//   - Runs only when AGENTBOX_ROLE_ISOLATION=1; otherwise exits 0 at once.
//   - Started as root by supervisord, binds the listen socket with umask 0111
//     (mode 0666 at bind time, no chmod, so nothing can be swapped in between),
//     then drops to uid/gid 65534 keeping exactly one supplementary group: the
//     upstream socket's group. It refuses to join group 0.
//   - Strict allowlist on method and raw path; no percent-encoding, dot
//     segments, double slashes or absolute-form targets; no Upgrade.
//   - Request bodies are never forwarded; hop-by-hop headers are dropped.
//
// No dependencies beyond node:http and node:fs. Test:
// tests/runtime-contract/RC-X1-05.node-test.cjs.
// TODO(custody W1): register this program in lib/role-accounts.nix with its
// own account instead of uid 65534 + the socket's group.

const fs = require('node:fs');
const http = require('node:http');

const DEFAULT_UPSTREAM = '/var/run/docker.sock';
const DEFAULT_LISTEN = '/run/docker-ro.sock';
const NOBODY = 65534;
const MAX_URL = 4096;

// Optional /vMAJOR.MINOR prefix, then exactly one allowed route. Container ids
// and names: Docker's own charset, first character alphanumeric.
const ROUTE = /^(?:\/v1\.\d{1,3})?\/(?:_ping|version|info|containers\/json|containers\/[A-Za-z0-9][A-Za-z0-9_.-]{0,254}\/(?:json|logs))$/;
const QUERY = /^[A-Za-z0-9%&=_.,:+~*-]*$/;
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade',
  'content-length', 'expect',
]);

/**
 * Decide whether a request may pass to the Docker daemon.
 * @param {string} method HTTP method as received.
 * @param {string} rawUrl Request target exactly as received (path + query).
 * @returns {boolean} true only for GET/HEAD on the read-only allowlist.
 */
function isAllowed(method, rawUrl) {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (typeof rawUrl !== 'string' || rawUrl.length === 0 || rawUrl.length > MAX_URL) return false;
  if (rawUrl.includes('#')) return false;
  const q = rawUrl.indexOf('?');
  const pathPart = q === -1 ? rawUrl : rawUrl.slice(0, q);
  const query = q === -1 ? '' : rawUrl.slice(q + 1);
  if (!ROUTE.test(pathPart)) return false;
  if (!QUERY.test(query)) return false;
  return true;
}

function cleanHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

function deny(res, method, rawUrl, why) {
  const pathOnly = String(rawUrl).split('?')[0].slice(0, 200).replace(/[^\x20-\x7e]/g, '?');
  process.stderr.write(`[docker-read-proxy] deny ${String(method).slice(0, 10)} ${pathOnly} (${why})\n`);
  const body = JSON.stringify({
    message: `docker-read-proxy: ${method} ${pathOnly} is refused; this socket is read-only `
      + '(role_isolation). ps, logs, inspect, version and info work here; run exec/run/cp from the host shell.',
  });
  res.writeHead(403, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Connection: 'close' });
  res.end(method === 'HEAD' ? undefined : body);
}

/**
 * Build the proxy server (not yet listening).
 * @param {{upstream: string}} opts Path of the real Docker socket.
 * @returns {http.Server}
 */
function createProxy({ upstream }) {
  const server = http.createServer((req, res) => {
    req.resume(); // never forward a body
    if (req.headers.upgrade || /\bupgrade\b/i.test(String(req.headers.connection || ''))) {
      return deny(res, req.method, req.url, 'upgrade');
    }
    if (!isAllowed(req.method, req.url)) return deny(res, req.method, req.url, 'not on allowlist');

    const up = http.request({
      socketPath: upstream,
      method: req.method,
      path: req.url,
      headers: { ...cleanHeaders(req.headers), host: 'docker' },
      agent: false,
    }, (upRes) => {
      res.writeHead(upRes.statusCode || 502, cleanHeaders(upRes.headers));
      upRes.pipe(res);
    });
    up.on('error', (err) => {
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: `docker-read-proxy: upstream unavailable (${err.code || 'error'})` }));
      } else {
        res.destroy();
      }
    });
    res.on('close', () => up.destroy());
    up.end();
  });
  // A protocol upgrade (attach/ws, exec hijack) never reaches the handler above:
  // with an 'upgrade' listener Node hands us the raw socket, which we refuse.
  server.on('upgrade', (req, socket) => {
    process.stderr.write('[docker-read-proxy] deny upgrade\n');
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
  });
  server.maxConnections = 64;
  server.headersTimeout = 15000;
  server.requestTimeout = 0; // `docker logs -f` streams indefinitely
  return server;
}

function dropPrivileges(socketGid) {
  if (socketGid === 0) {
    throw new Error('upstream socket group is 0; refusing to join group root (fix the host socket group)');
  }
  process.setgroups([socketGid]);
  process.setgid(NOBODY);
  process.setuid(NOBODY);
  if (process.getuid() === 0 || process.geteuid() === 0 || process.getgid() === 0) {
    throw new Error('privilege drop did not take');
  }
}

function main() {
  const env = process.env;
  if (env.AGENTBOX_ROLE_ISOLATION !== '1') {
    process.stdout.write('[docker-read-proxy] role_isolation is off; devuser keeps the raw socket. Exiting.\n');
    process.exit(0);
  }
  const upstream = env.DOCKER_READ_PROXY_UPSTREAM || DEFAULT_UPSTREAM;
  const listen = env.DOCKER_READ_PROXY_LISTEN || DEFAULT_LISTEN;
  let st;
  try {
    st = fs.statSync(upstream);
  } catch (e) {
    process.stderr.write(`[docker-read-proxy] FATAL: ${upstream}: ${e.code}\n`);
    process.exit(1);
  }
  if (!st.isSocket()) {
    process.stderr.write(`[docker-read-proxy] FATAL: ${upstream} is not a socket\n`);
    process.exit(1);
  }
  try {
    fs.unlinkSync(listen); // unlink never follows a symlink
  } catch (e) {
    if (e.code !== 'ENOENT') {
      process.stderr.write(`[docker-read-proxy] FATAL: cannot clear ${listen}: ${e.code}\n`);
      process.exit(1);
    }
  }
  const server = createProxy({ upstream });
  const prevMask = process.umask(0o111);
  server.on('error', (e) => {
    process.stderr.write(`[docker-read-proxy] FATAL: ${e.message}\n`);
    process.exit(1);
  });
  server.listen(listen, () => {
    process.umask(prevMask);
    try {
      if (process.getuid() === 0) dropPrivileges(st.gid);
    } catch (e) {
      process.stderr.write(`[docker-read-proxy] FATAL: ${e.message}\n`);
      process.exit(1);
    }
    process.stdout.write(`[docker-read-proxy] ${listen} → ${upstream} (GET-only; uid ${process.getuid()}, groups ${process.getgroups().join(',')})\n`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

module.exports = { isAllowed, createProxy, ROUTE };

if (require.main === module) main();
