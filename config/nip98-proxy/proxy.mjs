#!/usr/bin/env node
/**
 * NIP-98 identity ingress proxy for the Agent of Empires (AoE) interaction plane.
 *
 * PRD-021 WS4 / ADR-043 D4.6. This is the SOLE INGRESS to the AoE daemon
 * (`aoe serve --auth none --behind-proxy --host 127.0.0.1 --port 9095`).
 *
 * Every HTTP request and every WebSocket upgrade is authenticated by verifying a
 * kind-27235 NIP-98 `Authorization` header (`Nostr <base64(json(event))>`) with
 * the SAME verification path the management-api runs on its identity-bearing
 * surfaces — `NostrBridge.verifyNip98()` (`mcp/servers/nostr-bridge.js`), the
 * static method `management-api/middleware/auth.js` delegates to. On success the
 * verified BIP-340 x-only pubkey is forwarded upstream as `X-Agentbox-Pubkey`;
 * this is the identity AoE session `AGENTBOX_PROFILE` and the scoped memory
 * namespace derive from (ADR-043 D4.1/D4.4). On failure the request is rejected
 * 401 (HTTP) or closed with a 401 handshake (WS).
 *
 * Sole-ingress invariant (ADR-043 I03, PRD-021 N-05): the daemon binds loopback
 * and runs `--behind-proxy`, so it trusts `X-Forwarded-For`. Nothing other than
 * this proxy may reach `:9095`, or identity is bypassable. This proxy is the
 * trust boundary; it never re-exposes the upstream port.
 *
 * BREAK-GLASS: a permissive bearer bypass exists ONLY when `NIP98_PROXY_ALLOW_BEARER`
 * is set to a shared token. It lets the operator's browser reach the dashboard
 * before NIP-07 signing is wired. It is a documented, opt-in, constant-time-compared
 * escape hatch — never a default. See README.md.
 *
 * Dependency-light: node built-ins only (http, net, crypto, module, url). The
 * only third-party code reached is the repo's already-vendored `nostr-tools`,
 * transitively through `NostrBridge.verifyNip98`.
 *
 * Env (Builder A supplies these in the supervisor block):
 *   NIP98_PROXY_PORT           listen port (default 9096; PRD-021 Appendix B sibling proxy)
 *   NIP98_PROXY_HOST           listen bind address (default 0.0.0.0)
 *   AOE_UPSTREAM               upstream base URL (default http://127.0.0.1:9095)
 *   NOSTR_BRIDGE_PATH          explicit path to nostr-bridge.js (else candidates tried)
 *   NIP98_PROXY_ALLOW_BEARER   break-glass shared bearer token (unset = disabled)
 *   NIP98_PROXY_BEARER_PUBKEY  pubkey stamped for break-glass requests (default "break-glass")
 *   MANAGEMENT_API_URL         informational only (not called by the proxy)
 */

import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Configuration ───────────────────────────────────────────────────────────

const PORT = Number.parseInt(process.env.NIP98_PROXY_PORT || '9096', 10);
const BIND = process.env.NIP98_PROXY_HOST || '0.0.0.0';
const UPSTREAM_URL = process.env.AOE_UPSTREAM || 'http://127.0.0.1:9095';
const BREAK_GLASS = process.env.NIP98_PROXY_ALLOW_BEARER || '';
const BREAK_GLASS_PUBKEY = process.env.NIP98_PROXY_BEARER_PUBKEY || 'break-glass';
// Upper bound on the request body we buffer for NIP-98 payload verification
// (Finding 4). Bounds memory against a hostile large-body upload; oversize
// requests are rejected 413 before any upstream contact. Default 25 MiB.
const MAX_BODY_BYTES = Number.parseInt(process.env.NIP98_PROXY_MAX_BODY || String(25 * 1024 * 1024), 10);

let upstream;
try {
  const u = new URL(UPSTREAM_URL);
  upstream = {
    hostname: u.hostname,
    port: Number.parseInt(u.port || '9095', 10),
    protocol: u.protocol,
  };
} catch (err) {
  console.error(`[nip98-proxy] invalid AOE_UPSTREAM "${UPSTREAM_URL}": ${err.message}`);
  process.exit(1);
}

function log(level, msg, extra) {
  const line = { ts: new Date().toISOString(), level, component: 'nip98-proxy', msg, ...(extra || {}) };
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify(line)}\n`);
}

// ─── NIP-98 verifier: reuse NostrBridge.verifyNip98 (same path as auth.js) ─────

function loadNostrBridge() {
  const candidates = [
    process.env.NOSTR_BRIDGE_PATH,
    // Source-tree layout: config/nip98-proxy/ → mcp/servers/nostr-bridge.js
    pathResolve(__dirname, '../../mcp/servers/nostr-bridge.js'),
    // Baked image layout (Builder A bakes proxy to /opt/agentbox/nip98-proxy).
    '/opt/agentbox/mcp/servers/nostr-bridge.js',
    '/opt/agentbox/management-api/../mcp/servers/nostr-bridge.js',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const mod = require(candidate);
      if (mod && mod.NostrBridge && typeof mod.NostrBridge.verifyNip98 === 'function') {
        log('info', 'nostr-bridge loaded', { path: candidate });
        return mod.NostrBridge;
      }
    } catch (err) {
      log('info', 'nostr-bridge candidate rejected', { path: candidate, error: err.message });
    }
  }
  return null;
}

const NostrBridge = loadNostrBridge();

if (!NostrBridge) {
  // FAIL CLOSED, matching middleware/auth.js: without the bridge, Schnorr
  // signatures cannot be verified, so every NIP-98 token is rejected. Only the
  // explicit break-glass bearer (if configured) can then reach the upstream.
  log('warn', 'nostr-bridge unavailable — NIP-98 verification DISABLED (fail-closed). ' +
    (BREAK_GLASS ? 'Only the break-glass bearer will be accepted.' : 'ALL requests will be 401.'));
}

/**
 * Constant-time string comparison guarding unequal lengths (timingSafeEqual
 * throws on length mismatch). Mirrors verifyBearerHeader in middleware/auth.js.
 */
function constantTimeEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Reconstruct the URL the client signed. NIP-98's `u` tag is signed WITHOUT the
 * query string (buildNip98Header strips it; verifyNip98 compares against the
 * stripped tag), so we present the scheme://host/path form with no query — the
 * exact value the signer committed to.
 */
function signedUrlFor(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = req.headers.host || `127.0.0.1:${PORT}`;
  const path = String(req.url || '/');
  const q = path.indexOf('?');
  const pathNoQuery = q === -1 ? path : path.slice(0, q);
  return `${proto}://${host}${pathNoQuery}`;
}

/**
 * Verify a request's identity. Returns { ok, pubkey, mode, reason }.
 * `bearerToken` lets the WS path pass a token pulled from the query string
 * (browsers cannot set Authorization on the WS handshake).
 * `rawBody` (Buffer) is the exact request body; it is passed to verifyNip98 so
 * the signed `payload` tag is verified against hex(sha256(body)) (Finding 4).
 * WS upgrades and GETs carry no body → undefined/empty.
 */
function verifyIdentity(req, bearerToken, rawBody) {
  const authHeader = req.headers.authorization || '';

  // Break-glass bearer (explicit opt-in only).
  if (BREAK_GLASS) {
    let token = null;
    if (authHeader.startsWith('Bearer ')) token = authHeader.slice('Bearer '.length).trim();
    else if (bearerToken) token = bearerToken;
    if (token && constantTimeEqual(token, BREAK_GLASS)) {
      return { ok: true, pubkey: BREAK_GLASS_PUBKEY, mode: 'break-glass' };
    }
  }

  // NIP-98 (canonical path).
  if (authHeader.startsWith('Nostr ')) {
    if (!NostrBridge) return { ok: false, reason: 'nip98_verifier_unavailable' };
    const url = signedUrlFor(req);
    let result;
    try {
      result = NostrBridge.verifyNip98(authHeader, req.method || 'GET', url, rawBody);
    } catch (err) {
      return { ok: false, reason: `nip98_verify_error: ${err.message}` };
    }
    if (result && result.valid) {
      return { ok: true, pubkey: result.pubkey, mode: 'nip98' };
    }
    return { ok: false, reason: `nip98_invalid: ${(result && result.error) || 'unknown'}` };
  }

  return { ok: false, reason: 'no_credentials' };
}

// ─── X-Forwarded-For handling ──────────────────────────────────────────────────

function clientIp(req) {
  const ra = req.socket && req.socket.remoteAddress;
  return ra || '127.0.0.1';
}

function appendXff(existing, ip) {
  const current = Array.isArray(existing) ? existing.join(', ') : (existing || '');
  return current ? `${current}, ${ip}` : ip;
}

// ─── HTTP proxying ─────────────────────────────────────────────────────────────

const HOP_BY_HOP = new Set([
  'authorization', 'proxy-authorization', 'connection', 'keep-alive',
  'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade',
]);

const server = http.createServer((req, res) => {
  // Finding 4: buffer the request body BEFORE authenticating so the NIP-98
  // `payload` tag is verified against the exact bytes the client signed, then
  // forward those same bytes upstream. GET/HEAD requests carry no body, so the
  // 'end' fires immediately with an empty buffer — no added latency. The buffer
  // is size-capped to bound memory; oversize bodies are 413'd before any
  // upstream contact.
  const chunks = [];
  let total = 0;
  let aborted = false;

  const forward = (rawBody) => {
    const auth = verifyIdentity(req, undefined, rawBody);
    if (!auth.ok) {
      log('warn', 'request rejected', { method: req.method, url: req.url, reason: auth.reason, ip: clientIp(req) });
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Unauthorized',
        message: 'NIP-98 (kind-27235) Authorization header required to reach the interaction plane',
      }));
      return;
    }

    // Build upstream headers: drop hop-by-hop + Authorization, inject identity.
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (HOP_BY_HOP.has(key.toLowerCase())) continue;
      if (key.toLowerCase() === 'content-length') continue; // recomputed from the buffered body
      if (key.toLowerCase() === 'x-agentbox-pubkey') continue; // never trust an inbound claim
      headers[key] = value;
    }
    headers.host = `${upstream.hostname}:${upstream.port}`;
    headers['x-forwarded-for'] = appendXff(req.headers['x-forwarded-for'], clientIp(req));
    headers['x-forwarded-proto'] = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    headers['x-agentbox-pubkey'] = auth.pubkey;
    headers['x-agentbox-auth-mode'] = auth.mode;
    // We resend a fixed buffer (transfer-encoding was hop-by-hop and dropped), so
    // declare an accurate content-length only when there is a body to send.
    if (rawBody.length > 0) headers['content-length'] = String(rawBody.length);

    const proxyReq = http.request({
      hostname: upstream.hostname,
      port: upstream.port,
      method: req.method,
      path: req.url,
      headers,
    }, (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      log('error', 'upstream request failed', { url: req.url, error: err.message });
      if (!res.headersSent) {
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'BadGateway', message: 'interaction-plane upstream unreachable' }));
      } else {
        res.destroy();
      }
    });

    if (rawBody.length > 0) proxyReq.write(rawBody);
    proxyReq.end();
  };

  req.on('data', (chunk) => {
    if (aborted) return;
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      aborted = true;
      log('warn', 'request body too large', { url: req.url, bytes: total, limit: MAX_BODY_BYTES, ip: clientIp(req) });
      res.writeHead(413, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'PayloadTooLarge', message: `request body exceeds ${MAX_BODY_BYTES} bytes` }));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (aborted) return;
    forward(chunks.length ? Buffer.concat(chunks, total) : Buffer.alloc(0));
  });
  req.on('error', () => { aborted = true; });
});

// ─── WebSocket upgrade proxying (live-ws + acp/ws) ─────────────────────────────

server.on('upgrade', (req, socket, head) => {
  // Browsers cannot set Authorization on a WS handshake, so accept a break-glass
  // token from the query string as well (only meaningful when break-glass is on).
  let queryToken = null;
  try {
    const u = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    queryToken = u.searchParams.get('access_token') || u.searchParams.get('bearer');
  } catch { /* malformed URL → no query token */ }

  const auth = verifyIdentity(req, queryToken);
  if (!auth.ok) {
    log('warn', 'ws upgrade rejected', { url: req.url, reason: auth.reason, ip: clientIp(req) });
    socket.write(
      'HTTP/1.1 401 Unauthorized\r\n' +
      'Connection: close\r\n' +
      'Content-Length: 0\r\n\r\n'
    );
    socket.destroy();
    return;
  }

  const upstreamSocket = net.connect(upstream.port, upstream.hostname, () => {
    // Rebuild the request line + headers, dropping Authorization and injecting
    // identity, then replay any bytes already read as part of the upgrade.
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    const raw = req.rawHeaders;
    for (let i = 0; i < raw.length; i += 2) {
      const name = raw[i];
      const value = raw[i + 1];
      const lname = name.toLowerCase();
      if (lname === 'authorization') continue;
      if (lname === 'x-agentbox-pubkey' || lname === 'x-agentbox-auth-mode') continue;
      if (lname === 'host') { lines.push(`Host: ${upstream.hostname}:${upstream.port}`); continue; }
      if (lname === 'x-forwarded-for') continue; // re-emitted below, canonicalised
      lines.push(`${name}: ${value}`);
    }
    lines.push(`X-Forwarded-For: ${appendXff(req.headers['x-forwarded-for'], clientIp(req))}`);
    lines.push(`X-Forwarded-Proto: ${(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim()}`);
    lines.push(`X-Agentbox-Pubkey: ${auth.pubkey}`);
    lines.push(`X-Agentbox-Auth-Mode: ${auth.mode}`);
    upstreamSocket.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) upstreamSocket.write(head);

    socket.pipe(upstreamSocket);
    upstreamSocket.pipe(socket);
  });

  const teardown = () => { socket.destroy(); upstreamSocket.destroy(); };
  upstreamSocket.on('error', (err) => {
    log('error', 'ws upstream failed', { url: req.url, error: err.message });
    teardown();
  });
  socket.on('error', teardown);
  socket.on('close', () => upstreamSocket.destroy());
  upstreamSocket.on('close', () => socket.destroy());
});

server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
});

server.listen(PORT, BIND, () => {
  log('info', 'nip98-proxy listening', {
    bind: `${BIND}:${PORT}`,
    upstream: `${upstream.hostname}:${upstream.port}`,
    nip98: NostrBridge ? 'enabled' : 'DISABLED (fail-closed)',
    breakGlass: BREAK_GLASS ? 'ENABLED' : 'disabled',
  });
});

function shutdown(signal) {
  log('info', 'shutting down', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export { verifyIdentity, signedUrlFor, constantTimeEqual };
