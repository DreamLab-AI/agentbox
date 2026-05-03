/**
 * Hybrid authentication middleware.
 * Supports legacy bearer tokens and NIP-98-style Nostr HTTP auth envelopes.
 *
 * When nostr-tools is installed (sovereign_mesh.nostr_bridge = true in
 * agentbox.toml), NIP-98 events are fully verified including Schnorr
 * signature via NostrBridge.verifyNip98().  When the bridge module is absent
 * the middleware falls back to structural + freshness checks only, preserving
 * behaviour for configurations that do not enable sovereign mesh.
 */

// Attempt to load the Nostr bridge for full Schnorr verification.
// Soft-require: if nostr-tools is not installed, nostrBridge is null and the
// structural fallback below is used instead.
let nostrBridge = null;
try {
  const { NostrBridge } = require('../../mcp/servers/nostr-bridge');
  nostrBridge = NostrBridge;
} catch { /* sovereign_mesh not enabled or nostr-tools not installed */ }

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
    const result = nostrBridge.verifyNip98(header, request.method, requestUrl);
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
  if (!token || token !== validToken) {
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

module.exports = { createAuthMiddleware };
