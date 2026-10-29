#!/usr/bin/env node
/** NIP-98 operator ingress (ADR-2153). Only explicitly named HTTP/WS routes
 * are forwarded. Verification precedes routing; unknown routes return 404.
 * NIP-07 sessions and bounded break-glass access retain their existing gates. */

import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as pathResolve } from 'node:path';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Configuration ───────────────────────────────────────────────────────────

const PORT = Number.parseInt(process.env.NIP98_PROXY_PORT || '9096', 10);
const BIND = process.env.NIP98_PROXY_HOST || '0.0.0.0';
// Custody W2 (bypass 3): NIP98_PROXY_ALLOW_BEARER and NIP98_PROXY_SESSION_SECRET
// are ROLE secrets of ab-ingress (config/custody/env-classes.json). They are read
// through the shared loader (management-api/lib/role-secret.js): <NAME>_FILE,
// then $AGENTBOX_SECRETS_DIR/<NAME> (W1's isolated config), and the bare
// variable only while [security].role_isolation is off. Flag off this is the
// same read as before. An unreadable file reads as unset: break-glass off, a
// per-boot session secret (fail closed, never a crash at the LAN door).
const ROLE_SECRET = (() => {
  for (const c of [
    pathResolve(__dirname, '..', 'management-api', 'lib', 'role-secret.js'),
    pathResolve(__dirname, '..', '..', 'management-api', 'lib', 'role-secret.js'),
    '/opt/agentbox/management-api/lib/role-secret.js',
  ]) {
    try { return require(c); } catch { /* next */ }
  }
  return null;
})();
function roleSecret(name) {
  if (!ROLE_SECRET) {
    if (String(process.env.AGENTBOX_ROLE_ISOLATION || '') === '1') {
      console.error(`[nip98-proxy] role-secret loader unavailable: ${name} not read under role isolation`);
      return '';
    }
    return process.env[name] || '';
  }
  try {
    return ROLE_SECRET.readRoleSecret(name, { log: (l) => console.error(`[nip98-proxy] ${l}`) });
  } catch (err) {
    console.error(`[nip98-proxy] ${err.message}`);
    return '';
  }
}
const BREAK_GLASS = roleSecret('NIP98_PROXY_ALLOW_BEARER');
const BREAK_GLASS_PUBKEY = process.env.NIP98_PROXY_BEARER_PUBKEY || 'break-glass';

// ── ADR-2027 (closeout 2026-09-05): break-glass is BOUNDED authority ─────────
//
// The estate review found "a static break-glass token comparison without
// branch-local expiry/scope checks", and that "returning a mode/identity is not
// durable per-use audit". A break-glass credential that never expires, reaches
// every route, and leaves no record is indistinguishable from a permanent
// backdoor with a dramatic name.
//
// Three bounds, all default-OFF so an existing deployment is byte-compatible
// until an operator sets them — the credential is no weaker than before, and
// becomes materially stronger the moment either bound is configured:
//
//   NIP98_PROXY_BEARER_EXPIRES_AT   ISO-8601 instant, or epoch seconds. After
//                                   it, the token is refused. Unset = no expiry
//                                   (reported as such, never as "bounded").
//   NIP98_PROXY_BEARER_SCOPE        Comma-separated `METHOD /path/prefix`
//                                   entries (`*` for any method). A request
//                                   outside the scope is refused even with the
//                                   correct token. Unset = unrestricted.
//
// Every accepted AND every refused use is audited with a token FINGERPRINT
// (sha256, first 12 hex) — never the token — so a reader can correlate uses of
// one credential across a rotation without the audit log becoming a second
// place the secret lives.
const BREAK_GLASS_EXPIRES_RAW = String(process.env.NIP98_PROXY_BEARER_EXPIRES_AT || '').trim();
const BREAK_GLASS_SCOPE_RAW = String(process.env.NIP98_PROXY_BEARER_SCOPE || '').trim();

/** Parse the expiry into epoch milliseconds. Returns null when unset. */
function parseBreakGlassExpiry(raw) {
  if (!raw) return null;
  // Bare digits are epoch seconds; anything else must be an ISO-8601 instant.
  if (/^\d+$/.test(raw)) return Number(raw) * 1000;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : NaN; // NaN = malformed, handled fail-closed
}
const BREAK_GLASS_EXPIRES_MS = parseBreakGlassExpiry(BREAK_GLASS_EXPIRES_RAW);

/** Parse the scope list into { method, prefix } entries. */
function parseBreakGlassScope(raw) {
  if (!raw) return null;
  const out = [];
  for (const part of raw.split(',')) {
    const entry = part.trim();
    if (!entry) continue;
    const bits = entry.split(/\s+/);
    if (bits.length === 1) out.push({ method: '*', prefix: bits[0] });
    else out.push({ method: bits[0].toUpperCase(), prefix: bits.slice(1).join(' ') });
  }
  return out.length ? out : null;
}
const BREAK_GLASS_SCOPE = parseBreakGlassScope(BREAK_GLASS_SCOPE_RAW);

/** Non-reversible token fingerprint for audit correlation. Never the token. */
function breakGlassFingerprint(token) {
  try {
    return crypto.createHash('sha256').update(String(token), 'utf8').digest('hex').slice(0, 12);
  } catch { return 'unknown'; }
}
const BREAK_GLASS_FP = BREAK_GLASS ? breakGlassFingerprint(BREAK_GLASS) : null;

// Per-use audit counters, surfaced on the health payload. In-process only: this
// is a use RECEIPT, not a durable audit store, and it is labelled as such so
// nobody mistakes a restart-resettable counter for a compliance record.
const breakGlassUse = { accepted: 0, refused: 0, last_accepted_at: null, last_refused_reason: null };

/**
 * Is a break-glass request within the configured scope?
 * @returns {{allowed:boolean, reason?:string}}
 */
function breakGlassScopeAllows(method, url) {
  if (!BREAK_GLASS_SCOPE) return { allowed: true };
  const m = String(method || 'GET').toUpperCase();
  const rawPath = String(url || '/');
  const q = rawPath.indexOf('?');
  const pathOnly = q === -1 ? rawPath : rawPath.slice(0, q);
  for (const entry of BREAK_GLASS_SCOPE) {
    if (entry.method !== '*' && entry.method !== m) continue;
    if (pathOnly === entry.prefix || pathOnly.startsWith(entry.prefix)) return { allowed: true };
  }
  return { allowed: false, reason: `outside break-glass scope (${m} ${pathOnly})` };
}

/**
 * Is the break-glass credential still within its validity window?
 * @returns {{allowed:boolean, reason?:string}}
 */
function breakGlassNotExpired(now = Date.now()) {
  if (BREAK_GLASS_EXPIRES_MS === null) return { allowed: true };
  if (Number.isNaN(BREAK_GLASS_EXPIRES_MS)) {
    // A malformed expiry is fail-closed: an operator who tried to bound the
    // credential and mistyped it must not silently get an unbounded one.
    return { allowed: false, reason: `malformed NIP98_PROXY_BEARER_EXPIRES_AT (${BREAK_GLASS_EXPIRES_RAW})` };
  }
  if (now >= BREAK_GLASS_EXPIRES_MS) {
    return { allowed: false, reason: `break-glass credential expired at ${new Date(BREAK_GLASS_EXPIRES_MS).toISOString()}` };
  }
  return { allowed: true };
}
// Upper bound on the request body we buffer for NIP-98 payload verification
// (Finding 4). Bounds memory against a hostile large-body upload; oversize
// requests are rejected 413 before any upstream contact. Default 25 MiB.
const MAX_BODY_BYTES = Number.parseInt(process.env.NIP98_PROXY_MAX_BODY || String(25 * 1024 * 1024), 10);

// NIP-07 browser-session config. A per-boot random secret is the safe default:
// leaked cookies die with the process and there is exactly one proxy instance
// (sole-ingress invariant), so cross-instance verification is a non-goal.
const SESSION_TTL_S = Number.parseInt(process.env.NIP98_PROXY_SESSION_TTL || '43200', 10);
if (!Number.isSafeInteger(SESSION_TTL_S) || SESSION_TTL_S <= 0) {
  throw new Error('NIP98_PROXY_SESSION_TTL must be a positive integer');
}
const PINNED_SESSION_SECRET = roleSecret('NIP98_PROXY_SESSION_SECRET');
const SESSION_SECRET = PINNED_SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_COOKIE = 'agentbox_nip07_session';

// Optional npub gate (ADR-045 D2): restrict which verified identities are
// accepted at all. Applies to NIP-98 headers and to browser-session minting;
// the break-glass bearer is orthogonal (its own opt-in, its own sentinel).
const allowedPubkeyEntries = (process.env.NIP98_PROXY_ALLOWED_PUBKEYS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
if (allowedPubkeyEntries.some((s) => !/^[0-9a-f]{64}$/.test(s))) {
  throw new Error('NIP98_PROXY_ALLOWED_PUBKEYS entries must be 64-character hex pubkeys');
}
const ALLOWED_PUBKEYS = new Set(allowedPubkeyEntries);

function pubkeyAllowed(pubkey) {
  if (ALLOWED_PUBKEYS.size === 0) return true;
  return ALLOWED_PUBKEYS.has(String(pubkey).toLowerCase());
}

/**
 * ADR-2011 (hex-canonical identity): the ONLY durable identity form is a
 * lowercase 64-hex BIP-340 x-only pubkey. Whatever the verifier hands back is
 * normalised here and rejected if it is not that shape — an npub, an uppercase
 * hex, a truncated key or a missing pubkey must never be stamped upstream as
 * `X-Agentbox-Pubkey`, because storage paths, URLs and memory namespaces are
 * keyed off it. Returns the canonical hex, or null when the value cannot be
 * canonicalised (fail closed).
 */
function canonicalPubkey(raw) {
  if (typeof raw !== 'string') return null;
  const hex = raw.trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

// ─── Multi-upstream routing table (ADR-045 D1) ────────────────────────────────
// Ordered named prefix rules; there is no default upstream. Auth is route-
// independent — every request is NIP-98-verified before any route is consulted,
// and the same identity headers are injected whichever upstream wins. The
// ADR-2153 retires the former default session-board upstream.
// identity-gated paths to surfaces that keep their own auth (defence in depth).

function parseUpstreamTarget(raw, label) {
  const u = new URL(raw);
  if (u.protocol !== 'http:') throw new Error(`${label}: only http targets are supported (got ${u.protocol})`);
  return { hostname: u.hostname, port: Number.parseInt(u.port || '80', 10), protocol: u.protocol };
}

function normalizeRoute(r, i, source) {
  if (!r || typeof r.prefix !== 'string' || !r.prefix.startsWith('/') || r.prefix === '/') {
    throw new Error(`${source} route[${i}]: prefix must be a path starting with "/" (not "/" itself)`);
  }
  if (typeof r.target !== 'string') throw new Error(`${source} route[${i}]: target required`);
  // ADR-069 credential exchange: a route may name an env var whose value is
  // injected upstream as `Authorization: Bearer <token>`, REPLACING whatever
  // the browser sent. The operator authenticates to the proxy (NIP-98 /
  // NIP-07 session); the proxy authenticates to the upstream with a secret
  // the browser never holds (e.g. tab0-bridge's BRIDGE_TOKEN).
  let bearer = null;
  if (r.bearer_env !== undefined || r.bearerEnv !== undefined) {
    const envName = String(r.bearer_env ?? r.bearerEnv);
    const token = process.env[envName];
    if (!token) {
      throw new Error(`${source} route[${i}]: bearer_env ${envName} is not set in the proxy environment (fail closed)`);
    }
    bearer = token;
  }
  return {
    prefix: r.prefix.endsWith('/') ? r.prefix : `${r.prefix}/`,
    strip: r.strip !== false,
    // Browser applications compare Host with Origin for HTTP and WebSockets.
    // Opt in per route; connection targets remain fixed by the trusted config.
    preserveHost: r.preserve_host === true,
    upstream: parseUpstreamTarget(r.target, `${source} route[${i}].target`),
    bearer,
  };
}

// Boot-class config file (ADR-069): the supervisord environment= line is baked
// at image build and cannot safely carry JSON. The entrypoint projects
// agentbox.toml [interaction_plane.proxy] into this file every boot; when it
// exists it extends ROUTES and the pubkey allowlist without a rebuild.
const CONFIG_FILE = process.env.NIP98_PROXY_CONFIG_FILE
  || '/home/devuser/workspace/.agentbox/nip98-proxy-config.json';

const FILE_CONFIG = (() => {
  let raw;
  try {
    raw = readFileSync(CONFIG_FILE, 'utf-8');
  } catch {
    return { routes: [], allowedPubkeys: [] }; // absent file = no extra config
  }
  try {
    const parsed = JSON.parse(raw);
    const routes = Array.isArray(parsed.routes) ? parsed.routes : [];
    const allowed = Array.isArray(parsed.allowedPubkeys) ? parsed.allowedPubkeys : [];
    for (const pk of allowed) {
      if (!/^[0-9a-f]{64}$/i.test(String(pk))) {
        throw new Error(`allowedPubkeys entry ${pk} is not a 64-char hex pubkey`);
      }
    }
    return { routes, allowedPubkeys: allowed.map((p) => String(p).toLowerCase()) };
  } catch (err) {
    // Fatal: a silently dropped route/allowlist at the trust boundary is worse
    // than a loud crash-loop (matches NIP98_PROXY_ROUTES failure semantics).
    console.error(`[nip98-proxy] invalid config file ${CONFIG_FILE}: ${err.message}`);
    process.exit(1);
  }
})();

const ROUTES = (() => {
  const out = [];
  const raw = process.env.NIP98_PROXY_ROUTES;
  try {
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('expected a JSON array');
      parsed.forEach((r, i) => out.push(normalizeRoute(r, i, 'NIP98_PROXY_ROUTES')));
    }
    FILE_CONFIG.routes.forEach((r, i) => {
      const norm = normalizeRoute(r, i, CONFIG_FILE);
      if (!out.some((existing) => existing.prefix === norm.prefix)) out.push(norm); // env wins on conflict
    });
    return out;
  } catch (err) {
    // Fatal, matching invalid AOE_UPSTREAM: a silently dropped route would
    // surface as confusing 404s from the wrong upstream at the trust boundary.
    console.error(`[nip98-proxy] invalid routes: ${err.message}`);
    process.exit(1);
  }
})();

// Merge config-file allowlist entries into the env-derived set (ADR-069):
// either source alone activates the npub gate; entries are unioned.
for (const pk of FILE_CONFIG.allowedPubkeys) ALLOWED_PUBKEYS.add(pk);

// Supervisord-friendly convenience route (see env docs above).
if (process.env.NIP98_PROXY_MGMT_UPSTREAM && !ROUTES.some((r) => r.prefix === '/mgmt/')) {
  try {
    ROUTES.push({
      prefix: '/mgmt/',
      strip: true,
      upstream: parseUpstreamTarget(process.env.NIP98_PROXY_MGMT_UPSTREAM, 'NIP98_PROXY_MGMT_UPSTREAM'),
    });
  } catch (err) {
    console.error(`[nip98-proxy] invalid NIP98_PROXY_MGMT_UPSTREAM: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Resolve the upstream + forwarded path for a request URL. First matching
 * prefix rule wins ("/mgmt" matches its own bare form and "/mgmt/..."); no
 * match returns null, so the caller rejects it before upstream contact.
 * The query string always survives stripping (it sits after the path slice).
 */
function routeFor(rawUrl) {
  const url = String(rawUrl || '/');
  for (const r of ROUTES) {
    const bare = r.prefix.slice(0, -1);
    const isBare = url === bare || url.startsWith(`${bare}?`);
    if (!isBare && !url.startsWith(r.prefix)) continue;
    let path = url;
    if (r.strip) {
      if (isBare) path = url === bare ? '/' : `/${url.slice(bare.length)}`;
      else path = `/${url.slice(r.prefix.length)}`;
    }
    return { upstream: r.upstream, path, bearer: r.bearer, preserveHost: r.preserveHost, isAoe: false };
  }
  return null;
}

function log(level, msg, extra) {
  const line = { ts: new Date().toISOString(), level, component: 'nip98-proxy', msg, ...(extra || {}) };
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  stream.write(`${JSON.stringify(line)}\n`);
}

/**
 * Redact credential-bearing query params before a URL reaches the logs. A
 * signed NIP-98 event (?auth=) is replayable within its freshness window and a
 * break-glass token (?access_token=/?bearer=) is a live secret — neither
 * belongs in log lines.
 */
function redactUrlCreds(rawUrl) {
  return String(rawUrl || '').replace(
    /([?&])(auth|access_token|bearer|token)=[^&]*/gi,
    '$1$2=REDACTED'
  );
}

/**
 * Strip credential query params from a path before it is forwarded upstream.
 * The proxy has already consumed and verified them; forwarding them would put
 * a replayable signed event / live token in upstream logs and access traces.
 */
function stripUrlCreds(path) {
  const stripped = String(path || '').replace(
    /([?&])(auth|access_token|bearer|token)=[^&]*/gi,
    '$1'
  ).replace(/[?&]+$/, '').replace(/\?&/, '?').replace(/&&+/g, '&');
  return stripped === '' ? '/' : stripped;
}

// ─── NIP-98 verifier: reuse NostrBridge.verifyNip98 (same path as auth.js) ─────

function loadNostrBridge() {
  // An EXPLICIT NOSTR_BRIDGE_PATH is authoritative: if the operator names the
  // verifier module, a missing or broken file must NOT silently fall back to
  // some other nostr-bridge.js found elsewhere on the box. Which module
  // implements the identity boundary is not allowed to be a surprise — the
  // fail-closed outcome (every NIP-98 token rejected) is the safe answer.
  const explicit = process.env.NOSTR_BRIDGE_PATH;
  if (explicit) {
    if (!existsSync(explicit)) {
      log('error', 'NOSTR_BRIDGE_PATH does not exist — NIP-98 verification unavailable (no fallback)', { path: explicit });
      return null;
    }
    try {
      const mod = require(explicit);
      if (mod && mod.NostrBridge && typeof mod.NostrBridge.verifyNip98 === 'function') {
        log('info', 'nostr-bridge loaded', { path: explicit });
        return mod.NostrBridge;
      }
      log('error', 'NOSTR_BRIDGE_PATH exports no NostrBridge.verifyNip98 (no fallback)', { path: explicit });
    } catch (err) {
      log('error', 'NOSTR_BRIDGE_PATH failed to load (no fallback)', { path: explicit, error: err.message });
    }
    return null;
  }

  const candidates = [
    // Source-tree layout: config/nip98-proxy/ → mcp/servers/nostr-bridge.js
    pathResolve(__dirname, '../../mcp/servers/nostr-bridge.js'),
    // Baked image layout (Builder A bakes proxy to /opt/agentbox/nip98-proxy).
    '/opt/agentbox/mcp/servers/nostr-bridge.js',
    '/opt/agentbox/management-api/../mcp/servers/nostr-bridge.js',
  // In the immutable image __dirname sits below a Nix-store app root, so the
  // source-layout relative candidate is expected not to exist. Skip absent
  // candidates rather than logging a misleading module-load failure first.
  ].filter((candidate) => candidate && existsSync(candidate));

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

// ─── NIP-07 browser sessions (cookie mint/verify) ─────────────────────────────

/**
 * Session token: `v1.<pubkey>.<expiryEpochSeconds>.<hmacHex>` where the HMAC
 * covers `<pubkey>.<expiry>` under the per-boot secret. Stateless — nothing to
 * store, nothing to leak beyond the cookie itself, and forgery requires the
 * secret. Expiry is inside the MAC, so it cannot be extended client-side.
 */
function mintSessionToken(pubkey, nowS) {
  const exp = (nowS ?? Math.floor(Date.now() / 1000)) + SESSION_TTL_S;
  const mac = crypto.createHmac('sha256', SESSION_SECRET).update(`${pubkey}.${exp}`).digest('hex');
  return `v1.${pubkey}.${exp}.${mac}`;
}

function verifySessionToken(token, nowS) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  const [, pubkey, expStr, mac] = parts;
  if (!/^[0-9a-f]{64}$/.test(pubkey)) return null;
  const exp = Number.parseInt(expStr, 10);
  if (!Number.isFinite(exp) || exp <= (nowS ?? Math.floor(Date.now() / 1000))) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(`${pubkey}.${exp}`).digest('hex');
  if (!constantTimeEqual(mac, expected)) return null;
  if (!pubkeyAllowed(pubkey)) return null;
  return { pubkey, exp };
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

/**
 * Remove OUR session cookie from a Cookie header before forwarding — upstreams
 * must never see the token — while preserving any upstream-owned cookies.
 * Returns null when nothing remains.
 */
function stripSessionCookie(header) {
  if (!header) return null;
  const kept = String(header)
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith(`${SESSION_COOKIE}=`));
  return kept.length ? kept.join('; ') : null;
}

function sessionSetCookie(token, req, maxAgeS) {
  const secure = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; Max-Age=${maxAgeS}; HttpOnly; SameSite=Lax${secure}`;
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

  // Break-glass bearer (explicit opt-in only). ADR-2027: matching the token is
  // necessary, not sufficient — the credential must also be unexpired and the
  // request within its scope, and every outcome is audited by fingerprint.
  if (BREAK_GLASS) {
    let token = null;
    if (authHeader.startsWith('Bearer ')) token = authHeader.slice('Bearer '.length).trim();
    else if (bearerToken) token = bearerToken;
    if (token && constantTimeEqual(token, BREAK_GLASS)) {
      const expiry = breakGlassNotExpired();
      if (!expiry.allowed) {
        breakGlassUse.refused++;
        breakGlassUse.last_refused_reason = expiry.reason;
        log('warn', 'break-glass REFUSED', {
          reason: expiry.reason, fingerprint: BREAK_GLASS_FP,
          method: req.method, path: String(req.url || '').split('?')[0],
        });
        return { ok: false, reason: `break_glass_expired: ${expiry.reason}` };
      }
      const scope = breakGlassScopeAllows(req.method, req.url);
      if (!scope.allowed) {
        breakGlassUse.refused++;
        breakGlassUse.last_refused_reason = scope.reason;
        log('warn', 'break-glass REFUSED', {
          reason: scope.reason, fingerprint: BREAK_GLASS_FP,
          method: req.method, path: String(req.url || '').split('?')[0],
        });
        return { ok: false, reason: `break_glass_out_of_scope: ${scope.reason}` };
      }
      // Auditable USE. The fingerprint correlates uses of one credential across
      // a rotation; the token itself never enters the log.
      breakGlassUse.accepted++;
      breakGlassUse.last_accepted_at = new Date().toISOString();
      log('warn', 'break-glass USED', {
        fingerprint: BREAK_GLASS_FP,
        method: req.method,
        path: String(req.url || '').split('?')[0],
        remote: (req.socket && req.socket.remoteAddress) || null,
        expires_at: BREAK_GLASS_EXPIRES_MS ? new Date(BREAK_GLASS_EXPIRES_MS).toISOString() : null,
        scoped: !!BREAK_GLASS_SCOPE,
        use_count: breakGlassUse.accepted,
      });
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
      // ADR-2011: canonicalise BEFORE the allowlist test, so the gate and the
      // injected header agree on exactly one identity encoding. A verifier that
      // returns a non-canonical (or absent) pubkey is a verifier fault, not an
      // authenticated request.
      const pubkey = canonicalPubkey(result.pubkey);
      if (!pubkey) {
        return { ok: false, reason: 'nip98_noncanonical_pubkey' };
      }
      if (!pubkeyAllowed(pubkey)) {
        return { ok: false, reason: 'pubkey_not_allowed' };
      }
      return { ok: true, pubkey, mode: 'nip98' };
    }
    return { ok: false, reason: `nip98_invalid: ${(result && result.error) || 'unknown'}` };
  }

  // NIP-07 browser session cookie (minted by POST /nip07/session after a
  // verified kind-27235 handshake; see the NIP-07 section in the header docs).
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[SESSION_COOKIE]) {
    const session = verifySessionToken(cookies[SESSION_COOKIE]);
    if (session) {
      return { ok: true, pubkey: session.pubkey, mode: 'nip07-session' };
    }
    return { ok: false, reason: 'session_invalid_or_expired' };
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

// ─── NIP-07 handshake surface (/nip07/*, proxy-owned, never forwarded) ────────

/**
 * Only ever redirect back to a same-origin path: absolute URLs and
 * protocol-relative ("//host") and backslash forms are rejected to keep the
 * handshake from becoming an open redirect. Browsers normalize backslashes in
 * special-scheme URLs, so `/\\host` must not be treated as a local path.
 */
function safeNextPath(raw) {
  const next = String(raw || '/');
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/';
  return next;
}

const HANDSHAKE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agentbox — sign in with Nostr</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
         background: #0d1117; color: #e6edf3;
         font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 26rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { color: #9da7b3; margin: .5rem 0 1.25rem; }
  button { font: inherit; padding: .6rem 1.4rem; border-radius: .5rem; cursor: pointer;
           border: 1px solid #30363d; background: #7c3aed; color: #fff; }
  button:disabled { background: #30363d; cursor: default; }
  #status { margin-top: 1.25rem; font-size: .875rem; color: #9da7b3; min-height: 2.5em;
            white-space: pre-line; }
  #status.err { color: #f85149; }
  code { background: #161b22; padding: .1em .35em; border-radius: .25rem; }
</style>
</head>
<body>
<main>
  <h1>Agentbox interaction plane</h1>
  <p>This surface is identity-gated. Sign a one-time <code>kind-27235</code>
     challenge with your NIP-07 signer (podkey, or any
     <code>window.nostr</code> extension) to start a session.</p>
  <button id="go">Sign in with Nostr</button>
  <div id="status">Looking for a NIP-07 signer&hellip;</div>
</main>
<script>
(() => {
  const status = document.getElementById('status');
  const btn = document.getElementById('go');
  const next = new URLSearchParams(location.search).get('next') || '/';
  const say = (msg, err) => { status.textContent = msg; status.className = err ? 'err' : ''; };

  // Signer extensions inject window.nostr asynchronously — poll briefly
  // before declaring it absent.
  function waitForSigner(timeoutMs) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      (function poll() {
        if (window.nostr && typeof window.nostr.signEvent === 'function') return resolve(window.nostr);
        if (Date.now() - t0 > timeoutMs) return resolve(null);
        setTimeout(poll, 200);
      })();
    });
  }

  async function signIn() {
    btn.disabled = true;
    const signer = await waitForSigner(3000);
    if (!signer) {
      say('No NIP-07 signer detected. Extensions only inject window.nostr into pages they trust — check the signer is enabled for this origin, then retry.', true);
      btn.disabled = false;
      return;
    }
    try {
      say('Signer found — requesting signature\\u2026');
      const url = location.origin + '/nip07/session';
      const unsigned = {
        kind: 27235,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['u', url], ['method', 'POST']],
        content: '',
      };
      const signed = await signer.signEvent(unsigned);
      const res = await fetch('/nip07/session', {
        method: 'POST',
        headers: { authorization: 'Nostr ' + btoa(JSON.stringify(signed)) },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        say('Rejected: ' + (body.message || res.status) + '. Check the signer key is one this ingress allows.', true);
        btn.disabled = false;
        return;
      }
      say('Session started for ' + (body.pubkey || '').slice(0, 16) + '\\u2026 redirecting.');
      location.assign(body.next || next);
    } catch (err) {
      say('Signing failed or was declined: ' + err.message, true);
      btn.disabled = false;
    }
  }

  btn.addEventListener('click', signIn);
  signIn(); // auto-attempt on load; the button covers declines and late injection
})();
</script>
</body>
</html>
`;

/**
 * Handle the proxy-owned /nip07/* surface. Returns true when the request was
 * consumed (response written), false to continue into normal proxying.
 */
function handleNip07(req, res, rawBody) {
  const pathOnly = String(req.url || '/').split('?')[0];
  if (pathOnly !== '/nip07' && !pathOnly.startsWith('/nip07/')) return false;

  if ((pathOnly === '/nip07' || pathOnly === '/nip07/' || pathOnly === '/nip07/login') && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(HANDSHAKE_PAGE);
    return true;
  }

  if (pathOnly === '/nip07/session' && req.method === 'GET') {
    // Probe the cookie itself; unrelated upstream availability/authorization
    // must not make a signed-in browser start prompting its signer again.
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const session = token && verifySessionToken(token);
    res.writeHead(session ? 200 : 401, {
      'content-type': 'application/json', 'cache-control': 'no-store',
    });
    res.end(JSON.stringify(session ? { ok: true, pubkey: session.pubkey } : { ok: false }));
    return true;
  }

  if (pathOnly === '/nip07/session' && req.method === 'POST') {
    const auth = verifyIdentity(req, undefined, rawBody);
    // Only a live NIP-98 signature mints a session: an existing cookie must not
    // self-renew (expiry is the point) and break-glass must not launder its
    // sentinel into a pubkey-bound session.
    if (!auth.ok || auth.mode !== 'nip98') {
      log('warn', 'nip07 session mint rejected', { reason: auth.ok ? `mode_${auth.mode}` : auth.reason, ip: clientIp(req) });
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Unauthorized',
        message: auth.ok ? 'session minting requires a NIP-98 signature' : `NIP-98 verification failed (${auth.reason})`,
      }));
      return true;
    }
    const token = mintSessionToken(auth.pubkey);
    let next = '/';
    try { next = safeNextPath(new URL(req.url, 'http://x').searchParams.get('next')); } catch { /* default */ }
    log('info', 'nip07 session minted', { pubkey: auth.pubkey, ttl_s: SESSION_TTL_S, ip: clientIp(req) });
    res.writeHead(200, {
      'content-type': 'application/json',
      'set-cookie': sessionSetCookie(token, req, SESSION_TTL_S),
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify({ ok: true, pubkey: auth.pubkey, expires_in: SESSION_TTL_S, next }));
    return true;
  }

  if (pathOnly === '/nip07/logout' && (req.method === 'POST' || req.method === 'GET')) {
    res.writeHead(req.method === 'GET' ? 302 : 200, {
      'set-cookie': sessionSetCookie('', req, 0),
      ...(req.method === 'GET' ? { location: '/nip07/' } : { 'content-type': 'application/json' }),
    });
    res.end(req.method === 'GET' ? undefined : JSON.stringify({ ok: true }));
    return true;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'NotFound', message: 'unknown /nip07 endpoint' }));
  return true;
}

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
    // Proxy-owned NIP-07 handshake surface — consumed here, never forwarded.
    if (handleNip07(req, res, rawBody)) return;

    const auth = verifyIdentity(req, undefined, rawBody);
    if (!auth.ok) {
      log('warn', 'request rejected', { method: req.method, url: redactUrlCreds(req.url), reason: auth.reason, ip: clientIp(req) });
      // A human at a browser gets the signer handshake instead of raw JSON;
      // API clients (no text/html Accept) keep the machine-readable 401.
      const wantsHtml = req.method === 'GET' && String(req.headers.accept || '').includes('text/html');
      if (wantsHtml) {
        res.writeHead(302, {
          location: `/nip07/?next=${encodeURIComponent(safeNextPath(req.url))}`,
          'cache-control': 'no-store',
        });
        res.end();
        return;
      }
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Unauthorized',
        message: 'NIP-98 (kind-27235) Authorization header required to reach the interaction plane',
      }));
      return;
    }

    // Resolve the upstream AFTER auth (ADR-045): identity is route-independent.
    const route = routeFor(req.url);
    if (!route) {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'NotFound', message: 'No operator route' }));
      return;
    }

    // Build upstream headers: drop hop-by-hop + Authorization, inject identity.
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (HOP_BY_HOP.has(key.toLowerCase())) continue;
      if (key.toLowerCase() === 'content-length') continue; // recomputed from the buffered body
      // Never trust an inbound identity claim: both stamps are proxy-owned and
      // are re-injected below from the AUTHENTICATED identity (ADR-2009).
      if (key.toLowerCase() === 'x-agentbox-pubkey') continue;
      if (key.toLowerCase() === 'x-agentbox-auth-mode') continue;
      if (key.toLowerCase() === 'x-forwarded-host') continue; // re-emitted below
      if (key.toLowerCase() === 'cookie') {
        const kept = stripSessionCookie(value); // upstreams never see the session token
        if (kept) headers[key] = kept;
        continue;
      }
      headers[key] = value;
    }
    headers.host = route.preserveHost && req.headers.host
      ? req.headers.host : `${route.upstream.hostname}:${route.upstream.port}`;
    headers['x-forwarded-for'] = appendXff(req.headers['x-forwarded-for'], clientIp(req));
    headers['x-forwarded-proto'] = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    // ADR-2010: the host the client signed into the NIP-98 `u` tag. `Host` is
    // rewritten to the upstream, so without this an upstream cannot rebuild the
    // signed URL to re-verify the operator signature it is being handed.
    headers['x-forwarded-host'] = req.headers.host || `127.0.0.1:${PORT}`;
    headers['x-agentbox-pubkey'] = auth.pubkey;
    headers['x-agentbox-auth-mode'] = auth.mode;
    // ADR-069 credential exchange: for routes that declare a bearer, inject the
    // upstream's own token when the operator authenticated by session cookie or
    // break-glass (those carry no upstream-verifiable credential). A genuine
    // NIP-98 header passes through untouched — upstreams like management-api
    // re-verify the signature themselves, and governance decisions REQUIRE the
    // operator's signed identity (a bearer alone must never release a gate).
    if (!route.isAoe && auth.mode === 'nip98') {
      // ADR-2010 title clause: a signed NIP-98 identity ALWAYS reaches the
      // upstream gate. `authorization` is hop-by-hop and was dropped above, so
      // it is re-attached verbatim here — the governance upstream re-verifies
      // the operator's Schnorr signature itself and a bearer must never stand in
      // for it.
      headers.authorization = req.headers.authorization;
    } else if (route.bearer && auth.mode !== 'nip98') {
      headers.authorization = `Bearer ${route.bearer}`;
    }
    // We resend a fixed buffer (transfer-encoding was hop-by-hop and dropped), so
    // declare an accurate content-length only when there is a body to send.
    if (rawBody.length > 0) headers['content-length'] = String(rawBody.length);

    const proxyReq = http.request({
      hostname: route.upstream.hostname,
      port: route.upstream.port,
      method: req.method,
      path: stripUrlCreds(route.path),
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
  // Browsers cannot set Authorization on a WS handshake, so accept credentials
  // from the query string: a break-glass token (?access_token=/?bearer=, only
  // meaningful when break-glass is on) or a signed NIP-98 event (?auth=, the
  // console's signer-only carrier — regression fix: this carrier was lost when
  // /feed moved behind this proxy under ADR-069; the tab0-bridge accepted it,
  // the proxy did not). The ?auth= value is lifted into the Authorization
  // header so it flows through verifyIdentity's canonical NIP-98 path —
  // identical signature/URL-binding/allowlist checks as the header form
  // (signedUrlFor strips the query, matching what the signer committed to).
  // Query credentials are WS-handshake-only; HTTP requests must use headers.
  let queryToken = null;
  try {
    const u = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    queryToken = u.searchParams.get('access_token') || u.searchParams.get('bearer');
    const nip98Param = u.searchParams.get('auth');
    if (nip98Param && !req.headers.authorization) {
      req.headers.authorization = `Nostr ${nip98Param}`;
    }
  } catch { /* malformed URL → no query credentials */ }

  const auth = verifyIdentity(req, queryToken);
  if (!auth.ok) {
    log('warn', 'ws upgrade rejected', { url: redactUrlCreds(req.url), reason: auth.reason, ip: clientIp(req) });
    socket.write(
      'HTTP/1.1 401 Unauthorized\r\n' +
      'Connection: close\r\n' +
      'Content-Length: 0\r\n\r\n'
    );
    socket.destroy();
    return;
  }

  const route = routeFor(req.url);
  if (!route) {
    socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    return;
  }
  const upstreamSocket = net.connect(route.upstream.port, route.upstream.hostname, () => {
    // Rebuild the request line + headers, dropping Authorization and injecting
    // identity, then replay any bytes already read as part of the upgrade.
    const lines = [`${req.method} ${stripUrlCreds(route.path)} HTTP/1.1`];
    const raw = req.rawHeaders;
    for (let i = 0; i < raw.length; i += 2) {
      const name = raw[i];
      const value = raw[i + 1];
      const lname = name.toLowerCase();
      if (lname === 'authorization') continue;
      if (lname === 'x-agentbox-pubkey' || lname === 'x-agentbox-auth-mode') continue;
      if (lname === 'host') {
        lines.push(`Host: ${route.preserveHost ? value : `${route.upstream.hostname}:${route.upstream.port}`}`);
        continue;
      }
      if (lname === 'x-forwarded-for') continue; // re-emitted below, canonicalised
      if (lname === 'x-forwarded-host') continue; // re-emitted below, canonicalised
      if (lname === 'cookie') {
        const kept = stripSessionCookie(value); // upstreams never see the session token
        if (kept) lines.push(`${name}: ${kept}`);
        continue;
      }
      lines.push(`${name}: ${value}`);
    }
    lines.push(`X-Forwarded-For: ${appendXff(req.headers['x-forwarded-for'], clientIp(req))}`);
    lines.push(`X-Forwarded-Proto: ${(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim()}`);
    lines.push(`X-Forwarded-Host: ${req.headers.host || `127.0.0.1:${PORT}`}`); // ADR-2010: signed-URL reconstruction
    lines.push(`X-Agentbox-Pubkey: ${auth.pubkey}`);
    lines.push(`X-Agentbox-Auth-Mode: ${auth.mode}`);
    // ADR-069 credential exchange (WS): the upstream's own bearer, never the
    // browser's; nip98-signed upgrades pass their own header (same rule as HTTP).
    if (!route.isAoe && auth.mode === 'nip98' && req.headers.authorization) {
      // ADR-2010 (WS): same gate as HTTP — the signed identity, never a bearer,
      // reaches a named upstream. Covers both carriers: a real Authorization
      // header and the ?auth= query form lifted into it above.
      lines.push(`Authorization: ${req.headers.authorization}`);
    } else if (route.bearer && auth.mode !== 'nip98') {
      lines.push(`Authorization: Bearer ${route.bearer}`);
    }
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
    upstream: 'named routes only',
    routes: ROUTES.map((r) => `${r.prefix} -> ${r.upstream.hostname}:${r.upstream.port}${r.strip ? ' (strip)' : ''}`),
    nip98: NostrBridge ? 'enabled' : 'DISABLED (fail-closed)',
    breakGlass: BREAK_GLASS
      ? {
        state: 'ENABLED',
        fingerprint: BREAK_GLASS_FP,
        // Say plainly when a bound is ABSENT — an unbounded credential must not
        // read as a bounded one on a status page (ADR-2027).
        expires_at: BREAK_GLASS_EXPIRES_MS
          ? (Number.isNaN(BREAK_GLASS_EXPIRES_MS) ? 'MALFORMED (fail-closed)' : new Date(BREAK_GLASS_EXPIRES_MS).toISOString())
          : 'NO EXPIRY CONFIGURED',
        scope: BREAK_GLASS_SCOPE
          ? BREAK_GLASS_SCOPE.map((e) => `${e.method} ${e.prefix}`)
          : 'UNRESTRICTED',
        audit: 'per-use, by fingerprint, to the proxy log (in-process counters are not a durable audit store)',
      }
      : 'disabled',
    nip07Sessions: `enabled (ttl ${SESSION_TTL_S}s${PINNED_SESSION_SECRET ? ', pinned secret' : ', per-boot secret'})`,
    allowedPubkeys: ALLOWED_PUBKEYS.size || 'any-valid-signature',
  });
});

function shutdown(signal) {
  log('info', 'shutting down', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export {
  verifyIdentity, signedUrlFor, constantTimeEqual, routeFor,
  mintSessionToken, verifySessionToken, stripSessionCookie, safeNextPath,
  redactUrlCreds, stripUrlCreds,
};
