'use strict';

/**
 * Unit tests for management-api/lib/llm-marketplace.js
 *
 * LLM Resource Marketplace — Nostr kinds 38300-38305 for negotiating
 * access to LLM resources across the did:nostr mesh.
 *
 * Test coverage:
 *   - Event kind constants
 *   - buildAdvertisement: creates valid kind-38300 replaceable events
 *   - buildRequest: creates valid kind-38301 capability requests
 *   - buildGrant: creates valid kind-38302 grant responses
 *   - buildDeny: creates valid kind-38303 deny responses
 *   - buildReceipt: creates valid kind-38304 usage receipts
 *   - buildRevocation: creates valid kind-38305 grant revocations
 *   - validateAdvertisement: schema validation
 *   - validateRequest: schema validation
 *   - matchRequests: matches requests against advertisements
 *   - Orderbook: in-memory state management
 */

const VALID_PUBKEY = 'a'.repeat(64);
const OTHER_PUBKEY = 'b'.repeat(64);

// ── Load the module under test ────────────────────────────────────────────────

const {
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
} = require('../../management-api/lib/llm-marketplace');

// ── Kind constants ────────────────────────────────────────────────────────────

describe('LLM Marketplace kind constants', () => {
  it('defines six sequential kinds starting at 38300', () => {
    expect(KINDS.ADVERTISEMENT).toBe(38300);
    expect(KINDS.REQUEST).toBe(38301);
    expect(KINDS.GRANT).toBe(38302);
    expect(KINDS.DENY).toBe(38303);
    expect(KINDS.RECEIPT).toBe(38304);
    expect(KINDS.REVOCATION).toBe(38305);
  });

  it('kind object is frozen', () => {
    expect(Object.isFrozen(KINDS)).toBe(true);
  });
});

// ── buildAdvertisement ────────────────────────────────────────────────────────

describe('buildAdvertisement', () => {
  const validOpts = {
    pubkey: VALID_PUBKEY,
    model: 'claude-opus-4-6',
    contextWindow: 200000,
    maxTokensPerRequest: 32000,
    rateLimit: { rpm: 60, tpd: 1000000 },
    costPerMToken: 15,
    capabilities: ['code', 'vision', 'tool-use'],
    endpoint: 'https://agentbox.tailnet.ts.net:8080/v1/llm/proxy',
  };

  it('returns an event with kind 38300', () => {
    const evt = buildAdvertisement(validOpts);
    expect(evt.kind).toBe(38300);
  });

  it('sets the pubkey from opts', () => {
    const evt = buildAdvertisement(validOpts);
    expect(evt.pubkey).toBe(VALID_PUBKEY);
  });

  it('uses model as the d-tag for replaceability', () => {
    const evt = buildAdvertisement(validOpts);
    const dTag = evt.tags.find(t => t[0] === 'd');
    expect(dTag).toBeDefined();
    expect(dTag[1]).toBe('claude-opus-4-6');
  });

  it('includes model, context_window, and capabilities in content', () => {
    const evt = buildAdvertisement(validOpts);
    const content = JSON.parse(evt.content);
    expect(content.model).toBe('claude-opus-4-6');
    expect(content.context_window).toBe(200000);
    expect(content.capabilities).toContain('vision');
  });

  it('includes rate_limit and cost_per_m_token in content', () => {
    const evt = buildAdvertisement(validOpts);
    const content = JSON.parse(evt.content);
    expect(content.rate_limit.rpm).toBe(60);
    expect(content.cost_per_m_token).toBe(15);
  });

  it('includes the endpoint in content', () => {
    const evt = buildAdvertisement(validOpts);
    const content = JSON.parse(evt.content);
    expect(content.endpoint).toBe('https://agentbox.tailnet.ts.net:8080/v1/llm/proxy');
  });

  it('sets created_at to current unix timestamp', () => {
    const before = Math.floor(Date.now() / 1000);
    const evt = buildAdvertisement(validOpts);
    const after = Math.floor(Date.now() / 1000);
    expect(evt.created_at).toBeGreaterThanOrEqual(before);
    expect(evt.created_at).toBeLessThanOrEqual(after);
  });

  it('throws on missing pubkey', () => {
    expect(() => buildAdvertisement({ ...validOpts, pubkey: undefined }))
      .toThrow(/pubkey/i);
  });

  it('throws on missing model', () => {
    expect(() => buildAdvertisement({ ...validOpts, model: undefined }))
      .toThrow(/model/i);
  });

  it('throws on invalid pubkey format', () => {
    expect(() => buildAdvertisement({ ...validOpts, pubkey: 'not-hex' }))
      .toThrow(/pubkey/i);
  });
});

// ── buildRequest ──────────────────────────────────────────────────────────────

describe('buildRequest', () => {
  const validOpts = {
    pubkey: OTHER_PUBKEY,
    minContextWindow: 100000,
    minCapabilities: ['code'],
    maxCostPerMToken: 20,
    maxLatencyMs: 5000,
    tokenBudget: 500000,
    purpose: 'code-review-swarm',
  };

  it('returns an event with kind 38301', () => {
    const evt = buildRequest(validOpts);
    expect(evt.kind).toBe(38301);
  });

  it('includes requirements in content', () => {
    const evt = buildRequest(validOpts);
    const content = JSON.parse(evt.content);
    expect(content.min_context_window).toBe(100000);
    expect(content.min_capabilities).toContain('code');
    expect(content.max_cost_per_m_token).toBe(20);
    expect(content.token_budget).toBe(500000);
    expect(content.purpose).toBe('code-review-swarm');
  });

  it('throws on missing pubkey', () => {
    expect(() => buildRequest({ ...validOpts, pubkey: undefined }))
      .toThrow(/pubkey/i);
  });
});

// ── buildGrant ────────────────────────────────────────────────────────────────

describe('buildGrant', () => {
  it('returns an event with kind 38302', () => {
    const evt = buildGrant({
      pubkey: VALID_PUBKEY,
      requestEventId: 'abc123',
      granteePubley: OTHER_PUBKEY,
      model: 'claude-opus-4-6',
      tokenAllocation: 500000,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      accessToken: 'tok_grant_xyz',
      endpoint: 'https://agentbox.tailnet.ts.net:8080/v1/llm/proxy',
    });
    expect(evt.kind).toBe(38302);
  });

  it('references the request event via e-tag', () => {
    const evt = buildGrant({
      pubkey: VALID_PUBKEY,
      requestEventId: 'abc123',
      granteePubkey: OTHER_PUBKEY,
      model: 'claude-opus-4-6',
      tokenAllocation: 500000,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      accessToken: 'tok_grant_xyz',
      endpoint: 'https://agentbox.tailnet.ts.net:8080/v1/llm/proxy',
    });
    const eTag = evt.tags.find(t => t[0] === 'e');
    expect(eTag).toBeDefined();
    expect(eTag[1]).toBe('abc123');
  });

  it('references the grantee via p-tag', () => {
    const evt = buildGrant({
      pubkey: VALID_PUBKEY,
      requestEventId: 'abc123',
      granteePubkey: OTHER_PUBKEY,
      model: 'claude-opus-4-6',
      tokenAllocation: 500000,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      accessToken: 'tok_grant_xyz',
      endpoint: 'https://agentbox.tailnet.ts.net:8080/v1/llm/proxy',
    });
    const pTag = evt.tags.find(t => t[0] === 'p');
    expect(pTag).toBeDefined();
    expect(pTag[1]).toBe(OTHER_PUBKEY);
  });

  it('includes access_token and token_allocation in content', () => {
    const evt = buildGrant({
      pubkey: VALID_PUBKEY,
      requestEventId: 'abc123',
      granteePubkey: OTHER_PUBKEY,
      model: 'claude-opus-4-6',
      tokenAllocation: 500000,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      accessToken: 'tok_grant_xyz',
      endpoint: 'https://agentbox.tailnet.ts.net:8080/v1/llm/proxy',
    });
    const content = JSON.parse(evt.content);
    expect(content.access_token).toBe('tok_grant_xyz');
    expect(content.token_allocation).toBe(500000);
    expect(content.model).toBe('claude-opus-4-6');
  });
});

// ── buildDeny ─────────────────────────────────────────────────────────────────

describe('buildDeny', () => {
  it('returns an event with kind 38303', () => {
    const evt = buildDeny({
      pubkey: VALID_PUBKEY,
      requestEventId: 'abc123',
      granteePubkey: OTHER_PUBKEY,
      reason: 'rate-limit-exhausted',
    });
    expect(evt.kind).toBe(38303);
  });

  it('includes reason in content', () => {
    const evt = buildDeny({
      pubkey: VALID_PUBKEY,
      requestEventId: 'abc123',
      granteePubkey: OTHER_PUBKEY,
      reason: 'rate-limit-exhausted',
    });
    const content = JSON.parse(evt.content);
    expect(content.reason).toBe('rate-limit-exhausted');
  });
});

// ── buildReceipt ──────────────────────────────────────────────────────────────

describe('buildReceipt', () => {
  it('returns an event with kind 38304', () => {
    const evt = buildReceipt({
      pubkey: VALID_PUBKEY,
      grantEventId: 'grant123',
      consumerPubkey: OTHER_PUBKEY,
      model: 'claude-opus-4-6',
      tokensUsed: 15000,
      costSats: 225,
      durationMs: 4200,
    });
    expect(evt.kind).toBe(38304);
  });

  it('includes usage metrics in content', () => {
    const evt = buildReceipt({
      pubkey: VALID_PUBKEY,
      grantEventId: 'grant123',
      consumerPubkey: OTHER_PUBKEY,
      model: 'claude-opus-4-6',
      tokensUsed: 15000,
      costSats: 225,
      durationMs: 4200,
    });
    const content = JSON.parse(evt.content);
    expect(content.tokens_used).toBe(15000);
    expect(content.cost_sats).toBe(225);
    expect(content.duration_ms).toBe(4200);
    expect(content.model).toBe('claude-opus-4-6');
  });

  it('references the grant event via e-tag', () => {
    const evt = buildReceipt({
      pubkey: VALID_PUBKEY,
      grantEventId: 'grant123',
      consumerPubkey: OTHER_PUBKEY,
      model: 'claude-opus-4-6',
      tokensUsed: 15000,
      costSats: 225,
      durationMs: 4200,
    });
    const eTag = evt.tags.find(t => t[0] === 'e');
    expect(eTag[1]).toBe('grant123');
  });
});

// ── buildRevocation ───────────────────────────────────────────────────────────

describe('buildRevocation', () => {
  it('returns an event with kind 38305', () => {
    const evt = buildRevocation({
      pubkey: VALID_PUBKEY,
      grantEventId: 'grant123',
      granteePubkey: OTHER_PUBKEY,
      reason: 'abuse-detected',
    });
    expect(evt.kind).toBe(38305);
  });

  it('references the grant event via e-tag', () => {
    const evt = buildRevocation({
      pubkey: VALID_PUBKEY,
      grantEventId: 'grant123',
      granteePubkey: OTHER_PUBKEY,
      reason: 'abuse-detected',
    });
    const eTag = evt.tags.find(t => t[0] === 'e');
    expect(eTag[1]).toBe('grant123');
  });
});

// ── validateAdvertisement ─────────────────────────────────────────────────────

describe('validateAdvertisement', () => {
  const validContent = {
    model: 'claude-opus-4-6',
    context_window: 200000,
    max_tokens_per_request: 32000,
    rate_limit: { rpm: 60 },
    cost_per_m_token: 15,
    capabilities: ['code'],
    endpoint: 'https://example.com/llm',
  };

  it('returns { valid: true } for valid content', () => {
    expect(validateAdvertisement(validContent).valid).toBe(true);
  });

  it('rejects missing model', () => {
    const r = validateAdvertisement({ ...validContent, model: undefined });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/model/i);
  });

  it('rejects non-positive context_window', () => {
    const r = validateAdvertisement({ ...validContent, context_window: 0 });
    expect(r.valid).toBe(false);
  });

  it('rejects missing endpoint', () => {
    const r = validateAdvertisement({ ...validContent, endpoint: undefined });
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/endpoint/i);
  });

  it('rejects capabilities that is not an array', () => {
    const r = validateAdvertisement({ ...validContent, capabilities: 'code' });
    expect(r.valid).toBe(false);
  });
});

// ── validateRequest ───────────────────────────────────────────────────────────

describe('validateRequest', () => {
  const validContent = {
    min_context_window: 100000,
    min_capabilities: ['code'],
    max_cost_per_m_token: 20,
    token_budget: 500000,
  };

  it('returns { valid: true } for valid content', () => {
    expect(validateRequest(validContent).valid).toBe(true);
  });

  it('rejects non-positive token_budget', () => {
    const r = validateRequest({ ...validContent, token_budget: -1 });
    expect(r.valid).toBe(false);
  });

  it('accepts missing optional fields', () => {
    const r = validateRequest({ token_budget: 100 });
    expect(r.valid).toBe(true);
  });
});

// ── matchRequests ─────────────────────────────────────────────────────────────

describe('matchRequests', () => {
  const ad = {
    model: 'claude-opus-4-6',
    context_window: 200000,
    max_tokens_per_request: 32000,
    rate_limit: { rpm: 60 },
    cost_per_m_token: 15,
    capabilities: ['code', 'vision', 'tool-use'],
    endpoint: 'https://example.com/llm',
  };

  it('matches when all requirements are satisfied', () => {
    const req = {
      min_context_window: 100000,
      min_capabilities: ['code'],
      max_cost_per_m_token: 20,
    };
    expect(matchRequests(ad, req)).toBe(true);
  });

  it('rejects when context_window is too small', () => {
    const req = { min_context_window: 300000 };
    expect(matchRequests(ad, req)).toBe(false);
  });

  it('rejects when required capability is missing', () => {
    const req = { min_capabilities: ['audio'] };
    expect(matchRequests(ad, req)).toBe(false);
  });

  it('rejects when cost exceeds budget', () => {
    const req = { max_cost_per_m_token: 10 };
    expect(matchRequests(ad, req)).toBe(false);
  });

  it('matches when no constraints are specified', () => {
    expect(matchRequests(ad, {})).toBe(true);
  });
});

// ── Orderbook ─────────────────────────────────────────────────────────────────

describe('Orderbook', () => {
  let book;

  beforeEach(() => {
    book = new Orderbook();
  });

  it('accepts and retrieves advertisements', () => {
    book.addAdvertisement(VALID_PUBKEY, {
      model: 'claude-opus-4-6',
      context_window: 200000,
      capabilities: ['code'],
      cost_per_m_token: 15,
      endpoint: 'https://example.com/llm',
    });
    const ads = book.getAdvertisements();
    expect(ads).toHaveLength(1);
    expect(ads[0].model).toBe('claude-opus-4-6');
  });

  it('replaces advertisement for same pubkey+model (d-tag semantics)', () => {
    book.addAdvertisement(VALID_PUBKEY, {
      model: 'claude-opus-4-6',
      context_window: 200000,
      capabilities: ['code'],
      cost_per_m_token: 15,
      endpoint: 'https://a.com/llm',
    });
    book.addAdvertisement(VALID_PUBKEY, {
      model: 'claude-opus-4-6',
      context_window: 200000,
      capabilities: ['code', 'vision'],
      cost_per_m_token: 12,
      endpoint: 'https://b.com/llm',
    });
    const ads = book.getAdvertisements();
    expect(ads).toHaveLength(1);
    expect(ads[0].cost_per_m_token).toBe(12);
  });

  it('keeps separate advertisements for different models', () => {
    book.addAdvertisement(VALID_PUBKEY, {
      model: 'claude-opus-4-6',
      context_window: 200000,
      capabilities: ['code'],
      cost_per_m_token: 15,
      endpoint: 'https://a.com/llm',
    });
    book.addAdvertisement(VALID_PUBKEY, {
      model: 'claude-haiku-4-5',
      context_window: 200000,
      capabilities: ['code'],
      cost_per_m_token: 1,
      endpoint: 'https://a.com/llm',
    });
    expect(book.getAdvertisements()).toHaveLength(2);
  });

  it('finds matching advertisements for a request', () => {
    book.addAdvertisement(VALID_PUBKEY, {
      model: 'claude-opus-4-6',
      context_window: 200000,
      capabilities: ['code', 'vision'],
      cost_per_m_token: 15,
      endpoint: 'https://a.com/llm',
    });
    book.addAdvertisement(OTHER_PUBKEY, {
      model: 'claude-haiku-4-5',
      context_window: 200000,
      capabilities: ['code'],
      cost_per_m_token: 1,
      endpoint: 'https://b.com/llm',
    });
    const matches = book.findMatches({
      min_capabilities: ['vision'],
      max_cost_per_m_token: 20,
    });
    expect(matches).toHaveLength(1);
    expect(matches[0].model).toBe('claude-opus-4-6');
  });

  it('removes advertisements by pubkey', () => {
    book.addAdvertisement(VALID_PUBKEY, {
      model: 'claude-opus-4-6',
      context_window: 200000,
      capabilities: ['code'],
      cost_per_m_token: 15,
      endpoint: 'https://a.com/llm',
    });
    book.removeAdvertisements(VALID_PUBKEY);
    expect(book.getAdvertisements()).toHaveLength(0);
  });

  it('tracks active grants', () => {
    book.addGrant('grant-1', {
      providerPubkey: VALID_PUBKEY,
      consumerPubkey: OTHER_PUBKEY,
      model: 'claude-opus-4-6',
      tokenAllocation: 500000,
      tokensUsed: 0,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    const grants = book.getActiveGrants(OTHER_PUBKEY);
    expect(grants).toHaveLength(1);
    expect(grants[0].model).toBe('claude-opus-4-6');
  });

  it('records token usage against a grant', () => {
    book.addGrant('grant-1', {
      providerPubkey: VALID_PUBKEY,
      consumerPubkey: OTHER_PUBKEY,
      model: 'claude-opus-4-6',
      tokenAllocation: 500000,
      tokensUsed: 0,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    const ok = book.recordUsage('grant-1', 15000);
    expect(ok).toBe(true);
    const grants = book.getActiveGrants(OTHER_PUBKEY);
    expect(grants[0].tokensUsed).toBe(15000);
  });

  it('rejects usage that exceeds token allocation', () => {
    book.addGrant('grant-1', {
      providerPubkey: VALID_PUBKEY,
      consumerPubkey: OTHER_PUBKEY,
      model: 'claude-opus-4-6',
      tokenAllocation: 1000,
      tokensUsed: 0,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    const ok = book.recordUsage('grant-1', 2000);
    expect(ok).toBe(false);
  });

  it('revokes a grant', () => {
    book.addGrant('grant-1', {
      providerPubkey: VALID_PUBKEY,
      consumerPubkey: OTHER_PUBKEY,
      model: 'claude-opus-4-6',
      tokenAllocation: 500000,
      tokensUsed: 0,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    book.revokeGrant('grant-1');
    expect(book.getActiveGrants(OTHER_PUBKEY)).toHaveLength(0);
  });

  it('expires grants past their expiresAt', () => {
    book.addGrant('grant-1', {
      providerPubkey: VALID_PUBKEY,
      consumerPubkey: OTHER_PUBKEY,
      model: 'claude-opus-4-6',
      tokenAllocation: 500000,
      tokensUsed: 0,
      expiresAt: Math.floor(Date.now() / 1000) - 10, // already expired
    });
    book.pruneExpired();
    expect(book.getActiveGrants(OTHER_PUBKEY)).toHaveLength(0);
  });

  it('returns summary stats', () => {
    book.addAdvertisement(VALID_PUBKEY, {
      model: 'claude-opus-4-6',
      context_window: 200000,
      capabilities: ['code'],
      cost_per_m_token: 15,
      endpoint: 'https://a.com/llm',
    });
    book.addGrant('grant-1', {
      providerPubkey: VALID_PUBKEY,
      consumerPubkey: OTHER_PUBKEY,
      model: 'claude-opus-4-6',
      tokenAllocation: 500000,
      tokensUsed: 100,
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
    });
    const stats = book.stats();
    expect(stats.advertisements).toBe(1);
    expect(stats.activeGrants).toBe(1);
    expect(stats.totalTokensAllocated).toBe(500000);
    expect(stats.totalTokensUsed).toBe(100);
  });
});
