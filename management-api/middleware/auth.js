/**
 * Hybrid authentication middleware.
 * Supports legacy bearer tokens and NIP-98-style Nostr HTTP auth envelopes.
 *
 * When nostr-tools is installed (sovereign_mesh.nostr_bridge = true in
 * agentbox.toml), NIP-98 events are fully verified including Schnorr
 * signature via NostrBridge.verifyNip98().  When the bridge module is absent
 * NIP-98 authentication is rejected outright because Schnorr signatures
 * cannot be verified without the bridge — structural-only checks are
 * insufficient as they would accept forged tokens.
 */

// Attempt to load the Nostr bridge for full Schnorr verification.
// Soft-require: if nostr-tools is not installed, nostrBridge is null and the
// structural fallback below is used instead.
const crypto = require('crypto');

// The relative path only resolves when this file runs from the repo/app-root
// tree. The baked image packages management-api as its OWN nix derivation
// (…-management-api-0.0.0/lib/node_modules/agentic-flow-management-api), where
// `../../mcp` points inside the package and does not exist — so the overlay
// path and an env override are tried as fallbacks. Same relocation class as
// aoe-seed-sessions.mjs REQUIRE_BASES and nip98-proxy's candidate list.
let nostrBridge = null;
{
  const candidates = [
    process.env.NOSTR_BRIDGE_PATH,
    '../../mcp/servers/nostr-bridge',
    '/opt/agentbox/mcp/servers/nostr-bridge.js',
  ].filter(Boolean);
  const failures = [];
  for (const candidate of candidates) {
    try {
      const { NostrBridge } = require(candidate);
      if (NostrBridge && typeof NostrBridge.verifyNip98 === 'function') {
        nostrBridge = NostrBridge;
        break;
      }
      failures.push(`${candidate}: loaded but no verifyNip98`);
    } catch (err) {
      failures.push(`${candidate}: ${String(err.message).split('\n')[0]}`);
    }
  }
  if (!nostrBridge) {
    // Loud, once, at startup: without the bridge every NIP-98 header is
    // rejected (fail closed) and only Bearer auth works — that must never be
    // a silent degradation again (cockpit 401 storm, 2026-08-07).
    console.warn(
      '[management-api] NostrBridge unavailable — NIP-98 auth will be REJECTED, Bearer only. Tried: '
      + failures.join(' | '),
    );
  }
}

function decodeBase64Json(value) {
  const decoded = Buffer.from(value, 'base64').toString('utf8');
  return JSON.parse(decoded);
}

function getTag(event, key) {
  const tag = Array.isArray(event.tags)
    ? event.tags.find((entry) => Array.isArray(entry) && entry[0] === key)
    : null;
  return tag ? tag[1] : null;
}

function verifyNip98Header(header, request) {
  if (!header.startsWith('Nostr ')) {
    return null;
  }

  const requestUrl = `${request.protocol || 'http'}://${request.hostname}${request.url}`;

  // Full path: delegate to NostrBridge for Schnorr signature verification.
  if (nostrBridge) {
    // Finding 4: pass the RAW request body so verifyNip98 can bind it to the
    // signed `payload` tag. `request.rawBody` is the exact received bytes,
    // preserved by registerRawBody()'s content-type parser (a re-serialised
    // `request.body` would not reproduce the signer's byte stream). When it is
    // absent (parser not registered, or the auth hook ran before body parsing)
    // verifyNip98 falls back to header-only verification — no false rejects.
    const result = nostrBridge.verifyNip98(header, request.method, requestUrl, request.rawBody);
    if (!result.valid) return null;
    // Re-decode the event to return the full event object in the result, as
    // the auth result consumers may inspect event.tags or event.pubkey.
    let event;
    try {
      event = decodeBase64Json(header.slice('Nostr '.length).trim());
    } catch {
      return null;
    }
    return {
      mode: 'nip98',
      pubkey: result.pubkey,
      event,
    };
  }

  // FAIL CLOSED: nostr-tools is not available so Schnorr signature
  // verification cannot be performed. Reject all NIP-98 tokens.
  // Callers should use API key (Bearer) auth as a fallback.
  return null;
}

function verifyBearerHeader(header, validToken) {
  if (!header.startsWith('Bearer ')) {
    return null;
  }

  const token = header.slice('Bearer '.length).trim();
  // Fail closed when no valid token is configured on the server side.
  if (!token || !validToken) {
    return null;
  }

  // R-003: constant-time comparison. Guard unequal lengths first because
  // crypto.timingSafeEqual throws on mismatched buffer lengths.
  const tokenBuf = Buffer.from(token, 'utf8');
  const validBuf = Buffer.from(validToken, 'utf8');
  if (tokenBuf.length !== validBuf.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(tokenBuf, validBuf)) {
    return null;
  }

  return {
    mode: 'bearer',
  };
}

/**
 * Resolve the effective auth mode.
 *
 * Modes:
 *   "hybrid"       — Bearer OR NIP-98 accepted (either is sufficient).
 *                    Used when sovereign_mesh is off; suitable for dev and
 *                    operator-only deployments.
 *   "nip98"        — Only NIP-98 Nostr HTTP Auth accepted. Bearer rejected.
 *   "bearer"       — Only Bearer API-key accepted. NIP-98 rejected.
 *   "strict-nip98" — Only NIP-98 accepted. Bearer rejected unconditionally,
 *                    even for admin calls. Required when
 *                    sovereign_mesh.enabled = true so every authenticated
 *                    call carries a verifiable Nostr signature.
 *
 * Auto-elevation rule (applied when authMode is not set explicitly):
 *   If AGENTBOX_SOVEREIGN_MESH_ENABLED=true and no explicit authMode is set
 *   via MANAGEMENT_API_AUTH_MODE, the effective mode becomes "strict-nip98"
 *   instead of "hybrid". This enforces the sovereignty claim without
 *   requiring the operator to update an env var when sovereign mode is toggled.
 */
function _resolveAuthMode(requestedMode) {
  const mode = requestedMode || process.env.MANAGEMENT_API_AUTH_MODE || 'hybrid';
  if (mode !== 'hybrid') return mode;

  // Auto-elevate hybrid → strict-nip98 when sovereign_mesh is active.
  const sovereignEnabled =
    (process.env.AGENTBOX_SOVEREIGN_MESH_ENABLED || '').toLowerCase() === 'true';
  if (sovereignEnabled) return 'strict-nip98';

  return 'hybrid';
}

function createAuthMiddleware(validToken, options = {}) {
  const authMode = _resolveAuthMode(options.authMode);

  return async function authMiddleware(request, reply) {
    const authHeader = request.headers.authorization || '';
    const nip98Result = verifyNip98Header(authHeader, request);
    const bearerResult = verifyBearerHeader(authHeader, validToken);

    // strict-nip98: Bearer is unconditionally rejected; only NIP-98 accepted.
    const allowBearer = authMode === 'hybrid' || authMode === 'bearer';
    const allowNip98  = authMode === 'hybrid' || authMode === 'nip98' || authMode === 'strict-nip98';

    const authResult =
      (allowNip98 && nip98Result)
      || (allowBearer && bearerResult);

    if (!authResult) {
      // Distinguish rejection reason for operators debugging auth issues.
      const bearerPresent = authHeader.startsWith('Bearer ');
      const nip98Present  = authHeader.startsWith('Nostr ');

      if ((authMode === 'strict-nip98' || authMode === 'nip98') && bearerPresent && !nip98Present) {
        return reply.code(401).send({
          error: 'Unauthorized',
          message: `Auth mode is "${authMode}" — Bearer tokens are not accepted. Use Nostr NIP-98 HTTP Auth.`
        });
      }

      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Expected Bearer token or Nostr NIP-98 authorization header'
      });
    }

    request.auth = authResult;
  };
}

/**
 * Register a content-type parser that preserves the RAW request body as a
 * Buffer on `request.rawBody` while still delivering parsed JSON to route
 * handlers.
 *
 * Finding 4: the NIP-98 `payload` tag commits to hex(sha256(rawBody)), so the
 * verifier needs the exact bytes the client signed — Fastify's parsed
 * `request.body` is a re-materialised object and cannot reproduce them.
 *
 * WIRING (server owner): Fastify parses the body AFTER the `onRequest` phase,
 * so for body binding to take effect on the management-api the auth hook must
 * consume `request.rawBody` at `preValidation` (or `preHandler`), not
 * `onRequest`; and this parser must be registered on the app. Both are
 * no-ops for GET/HEAD (no body) and fully backward-compatible: without them the
 * verifier simply skips body binding.
 *
 * @param {import('fastify').FastifyInstance} app
 */
function registerRawBody(app) {
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
      req.rawBody = body; // Buffer of the exact received bytes
      if (!body || body.length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(body.toString('utf8')));
      } catch (err) {
        err.statusCode = 400;
        done(err);
      }
    }
  );
}

module.exports = { createAuthMiddleware, registerRawBody };
