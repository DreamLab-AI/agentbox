/**
 * Hybrid authentication middleware.
 * Supports legacy bearer tokens and NIP-98-style Nostr HTTP auth envelopes.
 *
 * NIP-98 verification here is structural and freshness-based; it does not yet
 * verify Schnorr signatures. That keeps the management API ready for sovereign
 * auth headers without breaking existing local flows.
 */

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

  const encoded = header.slice('Nostr '.length).trim();
  if (!encoded) {
    return null;
  }

  let event;
  try {
    event = decodeBase64Json(encoded);
  } catch {
    return null;
  }

  if (event.kind !== 27235 || typeof event.created_at !== 'number') {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - event.created_at) > 60) {
    return null;
  }

  const methodTag = getTag(event, 'method');
  const urlTag = getTag(event, 'u');
  const requestUrl = `${request.protocol || 'http'}://${request.hostname}${request.url}`;

  if (methodTag !== request.method) {
    return null;
  }

  if (!urlTag || !(urlTag === requestUrl || urlTag.endsWith(request.url))) {
    return null;
  }

  return {
    mode: 'nip98',
    pubkey: event.pubkey || null,
    event,
  };
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
