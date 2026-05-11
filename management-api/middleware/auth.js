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

  // Bridge unavailable — cannot verify Schnorr signatures.
  // Reject rather than falling back to structural-only validation, which would
  // accept any well-formatted but unsigned/forged NIP-98 token.
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

function createAuthMiddleware(validToken, options = {}) {
  const authMode = options.authMode || process.env.MANAGEMENT_API_AUTH_MODE || 'hybrid';

  return async function authMiddleware(request, reply) {
    const authHeader = request.headers.authorization || '';
    const nip98Result = verifyNip98Header(authHeader, request);
    const bearerResult = verifyBearerHeader(authHeader, validToken);

    const allowBearer = authMode === 'hybrid' || authMode === 'bearer';
    const allowNip98 = authMode === 'hybrid' || authMode === 'nip98';

    const authResult =
      (allowNip98 && nip98Result)
      || (allowBearer && bearerResult);

    if (!authResult) {
      return reply.code(401).send({
        error: 'Unauthorized',
        message: 'Expected Bearer token or Nostr NIP-98 authorization header'
      });
    }

    request.auth = authResult;
  };
}

module.exports = { createAuthMiddleware };
