'use strict';

/**
 * LLM Resource Marketplace — Nostr event kinds 38300-38305.
 *
 * Enables did:nostr users, agents, and nodes to negotiate access to
 * LLM resources across the relay mesh. Providers advertise capacity
 * via replaceable events (d-tag = model); consumers request access
 * with capability requirements; providers grant or deny; usage is
 * tracked via receipts that anchor to the urn:agentbox:receipt URN kind
 * and the Web Ledger payment rails in solid-pod-rs.
 *
 * Kind allocation (parameterised replaceable, NIP-01 30000-39999 range):
 *   38300  LLM Capability Advertisement  (replaceable, d-tag = model)
 *   38301  LLM Capability Request
 *   38302  LLM Grant                     (response to 38301)
 *   38303  LLM Deny                      (response to 38301)
 *   38304  LLM Usage Receipt             (references grant)
 *   38305  LLM Grant Revocation          (cancels a grant)
 */

const PUBKEY_RE = /^[0-9a-f]{64}$/;

const KINDS = Object.freeze({
  ADVERTISEMENT: 38300,
  REQUEST:       38301,
  GRANT:         38302,
  DENY:          38303,
  RECEIPT:       38304,
  REVOCATION:    38305,
});

function _now() { return Math.floor(Date.now() / 1000); }

function _requirePubkey(pubkey) {
  if (!pubkey || typeof pubkey !== 'string' || !PUBKEY_RE.test(pubkey)) {
    throw new Error('pubkey must be a 64-char lowercase hex string');
  }
}

function _requireString(value, name) {
  if (!value || typeof value !== 'string') {
    throw new Error(`${name} is required and must be a string`);
  }
}

// ── Event builders ────────────────────────────────────────────────────────────

function buildAdvertisement(opts) {
  _requirePubkey(opts.pubkey);
  _requireString(opts.model, 'model');

  return {
    kind: KINDS.ADVERTISEMENT,
    pubkey: opts.pubkey,
    created_at: _now(),
    tags: [
      ['d', opts.model],
    ],
    content: JSON.stringify({
      model: opts.model,
      context_window: opts.contextWindow || 0,
      max_tokens_per_request: opts.maxTokensPerRequest || 0,
      rate_limit: opts.rateLimit || {},
      cost_per_m_token: opts.costPerMToken || 0,
      capabilities: opts.capabilities || [],
      endpoint: opts.endpoint || '',
    }),
  };
}

function buildRequest(opts) {
  _requirePubkey(opts.pubkey);

  return {
    kind: KINDS.REQUEST,
    pubkey: opts.pubkey,
    created_at: _now(),
    tags: [],
    content: JSON.stringify({
      min_context_window: opts.minContextWindow || 0,
      min_capabilities: opts.minCapabilities || [],
      max_cost_per_m_token: opts.maxCostPerMToken || Infinity,
      max_latency_ms: opts.maxLatencyMs || 0,
      token_budget: opts.tokenBudget || 0,
      purpose: opts.purpose || '',
    }),
  };
}

function buildGrant(opts) {
  _requirePubkey(opts.pubkey);
  _requireString(opts.requestEventId, 'requestEventId');

  return {
    kind: KINDS.GRANT,
    pubkey: opts.pubkey,
    created_at: _now(),
    tags: [
      ['e', opts.requestEventId, '', 'reply'],
      ['p', opts.granteePubkey || ''],
    ],
    content: JSON.stringify({
      model: opts.model || '',
      token_allocation: opts.tokenAllocation || 0,
      expires_at: opts.expiresAt || 0,
      access_token: opts.accessToken || '',
      endpoint: opts.endpoint || '',
    }),
  };
}

function buildDeny(opts) {
  _requirePubkey(opts.pubkey);
  _requireString(opts.requestEventId, 'requestEventId');

  return {
    kind: KINDS.DENY,
    pubkey: opts.pubkey,
    created_at: _now(),
    tags: [
      ['e', opts.requestEventId, '', 'reply'],
      ['p', opts.granteePubkey || ''],
    ],
    content: JSON.stringify({
      reason: opts.reason || '',
    }),
  };
}

function buildReceipt(opts) {
  _requirePubkey(opts.pubkey);
  _requireString(opts.grantEventId, 'grantEventId');

  return {
    kind: KINDS.RECEIPT,
    pubkey: opts.pubkey,
    created_at: _now(),
    tags: [
      ['e', opts.grantEventId, '', 'reply'],
      ['p', opts.consumerPubkey || ''],
    ],
    content: JSON.stringify({
      model: opts.model || '',
      tokens_used: opts.tokensUsed || 0,
      cost_sats: opts.costSats || 0,
      duration_ms: opts.durationMs || 0,
    }),
  };
}

function buildRevocation(opts) {
  _requirePubkey(opts.pubkey);
  _requireString(opts.grantEventId, 'grantEventId');

  return {
    kind: KINDS.REVOCATION,
    pubkey: opts.pubkey,
    created_at: _now(),
    tags: [
      ['e', opts.grantEventId, '', 'reply'],
      ['p', opts.granteePubkey || ''],
    ],
    content: JSON.stringify({
      reason: opts.reason || '',
    }),
  };
}

// ── Validators ────────────────────────────────────────────────────────────────

function validateAdvertisement(content) {
  if (!content.model || typeof content.model !== 'string') {
    return { valid: false, reason: 'model is required' };
  }
  if (!content.context_window || content.context_window <= 0) {
    return { valid: false, reason: 'context_window must be positive' };
  }
  if (!content.endpoint || typeof content.endpoint !== 'string') {
    return { valid: false, reason: 'endpoint is required' };
  }
  if (content.capabilities && !Array.isArray(content.capabilities)) {
    return { valid: false, reason: 'capabilities must be an array' };
  }
  return { valid: true };
}

function validateRequest(content) {
  if (content.token_budget !== undefined && content.token_budget < 0) {
    return { valid: false, reason: 'token_budget must be non-negative' };
  }
  if (content.min_capabilities && !Array.isArray(content.min_capabilities)) {
    return { valid: false, reason: 'min_capabilities must be an array' };
  }
  return { valid: true };
}

// ── Matching engine ───────────────────────────────────────────────────────────

function matchRequests(advertisement, request) {
  if (request.min_context_window && advertisement.context_window < request.min_context_window) {
    return false;
  }
  if (request.max_cost_per_m_token !== undefined &&
      request.max_cost_per_m_token !== Infinity &&
      advertisement.cost_per_m_token > request.max_cost_per_m_token) {
    return false;
  }
  if (request.min_capabilities && request.min_capabilities.length > 0) {
    const adCaps = new Set(advertisement.capabilities || []);
    for (const cap of request.min_capabilities) {
      if (!adCaps.has(cap)) return false;
    }
  }
  return true;
}

// ── In-memory orderbook ───────────────────────────────────────────────────────

class Orderbook {
  constructor() {
    this._ads = new Map();    // key: `${pubkey}:${model}` → ad object
    this._grants = new Map(); // key: grantEventId → grant object
  }

  addAdvertisement(pubkey, ad) {
    const key = `${pubkey}:${ad.model}`;
    this._ads.set(key, { ...ad, pubkey, updatedAt: _now() });
  }

  removeAdvertisements(pubkey) {
    for (const [key] of this._ads) {
      if (key.startsWith(`${pubkey}:`)) this._ads.delete(key);
    }
  }

  getAdvertisements(pubkey) {
    const result = [];
    for (const [key, ad] of this._ads) {
      if (!pubkey || key.startsWith(`${pubkey}:`)) result.push(ad);
    }
    return result;
  }

  findMatches(request) {
    const result = [];
    for (const [, ad] of this._ads) {
      if (matchRequests(ad, request)) result.push(ad);
    }
    return result;
  }

  addGrant(grantEventId, grant) {
    this._grants.set(grantEventId, { ...grant, grantEventId });
  }

  getActiveGrants(consumerPubkey) {
    const now = _now();
    const result = [];
    for (const [, g] of this._grants) {
      if (g.consumerPubkey === consumerPubkey && g.expiresAt > now) {
        result.push(g);
      }
    }
    return result;
  }

  recordUsage(grantEventId, tokensUsed) {
    const grant = this._grants.get(grantEventId);
    if (!grant) return false;
    if (grant.tokensUsed + tokensUsed > grant.tokenAllocation) return false;
    grant.tokensUsed += tokensUsed;
    return true;
  }

  revokeGrant(grantEventId) {
    this._grants.delete(grantEventId);
  }

  pruneExpired() {
    const now = _now();
    for (const [id, g] of this._grants) {
      if (g.expiresAt <= now) this._grants.delete(id);
    }
  }

  stats() {
    let totalTokensAllocated = 0;
    let totalTokensUsed = 0;
    for (const [, g] of this._grants) {
      totalTokensAllocated += g.tokenAllocation || 0;
      totalTokensUsed += g.tokensUsed || 0;
    }
    return {
      advertisements: this._ads.size,
      activeGrants: this._grants.size,
      totalTokensAllocated,
      totalTokensUsed,
    };
  }
}

module.exports = {
  KINDS,
  buildAdvertisement,
  buildRequest,
  buildGrant,
  buildDeny,
  buildReceipt,
  buildRevocation,
  validateAdvertisement,
  validateRequest,
  matchRequests,
  Orderbook,
};
