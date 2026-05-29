'use strict';

/**
 * WS9 (PRD-014 Seam B / B4): the agent-event auth gate verifies a NIP-98
 * header on the emit/batch routes and derives the acting agent's identity
 * from the signature, so source_urn is provable, not caller-asserted.
 * Default policy `off` is a no-op (zero behavioural change).
 */

const {
  verifyAgentEventRequest,
  reconcileSourceUrn,
  resolvePolicy,
} = require('../../management-api/lib/agent-event-auth');

const AGENT = 'c'.repeat(64);

function req(headers = {}, url = '/v1/agent-events/emit') {
  return { headers, url };
}

describe('resolvePolicy', () => {
  it('defaults to off and lowercases', () => {
    expect(resolvePolicy({})).toBe('off');
    expect(resolvePolicy({ AGENTBOX_AGENT_EVENT_AUTH: 'NIP98' })).toBe('nip98');
  });
});

describe('verifyAgentEventRequest', () => {
  it('off policy is a no-op: ok with a null identity', () => {
    const r = verifyAgentEventRequest(req(), { policy: 'off' });
    expect(r).toEqual({ ok: true, did: null, pubkey: null });
  });

  it('nip98 policy rejects a missing Authorization header (401)', () => {
    const r = verifyAgentEventRequest(req(), { policy: 'nip98' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
  });

  it('nip98 policy rejects an invalid signature (401) with the verifier error', () => {
    const verify = () => ({ valid: false, pubkey: null, error: 'invalid Schnorr signature' });
    const r = verifyAgentEventRequest(req({ authorization: 'Nostr xxx' }), { policy: 'nip98', verify });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.error).toMatch(/invalid Schnorr/);
  });

  it('nip98 policy derives did:nostr from the verified pubkey and checks method/path', () => {
    const seen = {};
    const verify = (header, method, url) => {
      seen.header = header; seen.method = method; seen.url = url;
      return { valid: true, pubkey: AGENT, error: null };
    };
    const r = verifyAgentEventRequest(
      req({ authorization: 'Nostr token' }, '/v1/agent-events/emit?x=1'),
      { policy: 'nip98', verify }
    );
    expect(r).toEqual({ ok: true, did: `did:nostr:${AGENT}`, pubkey: AGENT });
    expect(seen.method).toBe('POST');
    // query string is stripped before comparison (originator signs path only)
    expect(seen.url).toBe('/v1/agent-events/emit');
  });

  it('an unknown policy fails closed (500)', () => {
    const r = verifyAgentEventRequest(req(), { policy: 'bogus' });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(500);
  });

  it('a throwing verifier is contained as a 401', () => {
    const verify = () => { throw new Error('nostr-tools missing'); };
    const r = verifyAgentEventRequest(req({ authorization: 'Nostr t' }), { policy: 'nip98', verify });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.error).toMatch(/nostr-tools missing/);
  });
});

describe('reconcileSourceUrn', () => {
  it('passes when unauthenticated (no verified did)', () => {
    expect(reconcileSourceUrn('did:nostr:anything', null).ok).toBe(true);
  });

  it('passes when the claim matches or is absent', () => {
    expect(reconcileSourceUrn(null, `did:nostr:${AGENT}`).ok).toBe(true);
    expect(reconcileSourceUrn(`did:nostr:${AGENT}`, `did:nostr:${AGENT}`).ok).toBe(true);
  });

  it('rejects a mismatched claim (403)', () => {
    const r = reconcileSourceUrn('did:nostr:deadbeef', `did:nostr:${AGENT}`);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
  });
});
