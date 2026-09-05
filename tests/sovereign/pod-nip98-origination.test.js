'use strict';

/**
 * WS4 (PRD-014 Seam C / C2): the pods adapter originates a signed NIP-98
 * Authorization header per request so an autonomous agent authenticates
 * to a default-deny pod instead of going out anonymous.
 *
 * Covers:
 *   - NostrBridge.buildNip98Header builds a kind-27235 event with the
 *     `u`/`method` tags the verifier checks, strips the query string from
 *     `u`, and adds a `payload` hash for bodied requests.
 *   - SolidHttpPodsAdapter attaches the originated header to every verb,
 *     never overwrites a caller-supplied Authorization, and is unsigned
 *     (byte-identical to legacy) when no originator is configured.
 */

const crypto = require('crypto');

// buildNip98Header uses the injected signer (echoSigner) and never touches
// nostr-tools — its loader is lazy — so no module mock is needed here.
const { NostrBridge } = require('../../mcp/servers/nostr-bridge');
const { SolidHttpPodsAdapter } = require('../../management-api/adapters/pods/_solid-http-base');

// A signer that echoes the unsigned event back (no real Schnorr needed).
const echoSigner = {
  async sign(unsigned) {
    return { ...unsigned, id: 'echo-id', pubkey: 'a'.repeat(64), sig: 'echo-sig' };
  },
};

function decodeHeader(header) {
  expect(header.startsWith('Nostr ')).toBe(true);
  const json = Buffer.from(header.slice('Nostr '.length), 'base64').toString('utf8');
  return JSON.parse(json);
}

function tagValue(event, key) {
  const t = event.tags.find((x) => x[0] === key);
  return t ? t[1] : null;
}

describe('NostrBridge.buildNip98Header', () => {
  it('builds a kind-27235 event with u and method tags', async () => {
    const header = await NostrBridge.buildNip98Header(echoSigner, 'put', 'http://h:8484/kg/x');
    const event = decodeHeader(header);
    expect(event.kind).toBe(27235);
    expect(tagValue(event, 'u')).toBe('http://h:8484/kg/x');
    expect(tagValue(event, 'method')).toBe('PUT');
    expect(typeof event.created_at).toBe('number');
  });

  it('strips the query string from the u tag (verifier compares path only)', async () => {
    const header = await NostrBridge.buildNip98Header(
      echoSigner,
      'GET',
      'http://h:8484/kg/?cursor=abc'
    );
    expect(tagValue(decodeHeader(header), 'u')).toBe('http://h:8484/kg/');
  });

  it('adds a payload hash (hex sha256 of body) for bodied requests', async () => {
    const body = '<a> <b> <c> .';
    const header = await NostrBridge.buildNip98Header(echoSigner, 'PUT', 'http://h/x', { body });
    const expected = crypto.createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex');
    expect(tagValue(decodeHeader(header), 'payload')).toBe(expected);
  });

  it('omits the payload tag for empty bodies', async () => {
    const header = await NostrBridge.buildNip98Header(echoSigner, 'GET', 'http://h/x', { body: '' });
    expect(tagValue(decodeHeader(header), 'payload')).toBeNull();
  });

  it('rejects a missing signer', async () => {
    await expect(NostrBridge.buildNip98Header(null, 'GET', 'http://h/x')).rejects.toThrow(/signer/);
  });
});

describe('SolidHttpPodsAdapter NIP-98 origination', () => {
  function makeFetchSpy() {
    const calls = [];
    const fetchFn = async (url, init = {}) => {
      calls.push({ url, init });
      return {
        status: 200,
        url,
        headers: { get: () => 'text/turtle' },
        text: async () => '',
        json: async () => ({}),
      };
    };
    return { calls, fetchFn };
  }

  it('attaches an originated Authorization header to a write', async () => {
    const { calls, fetchFn } = makeFetchSpy();
    const nip98 = (method, url, body) =>
      NostrBridge.buildNip98Header(echoSigner, method, url, { body });
    const adapter = new SolidHttpPodsAdapter({ baseUrl: 'http://h:8484', fetchFn, nip98 });

    await adapter.write('/kg/x', '<a> <b> <c> .', 'text/turtle');

    expect(calls).toHaveLength(1);
    const auth = calls[0].init.headers.Authorization;
    const event = decodeHeader(auth);
    expect(tagValue(event, 'method')).toBe('PUT');
    expect(tagValue(event, 'u')).toBe('http://h:8484/kg/x');
    // body present → payload hash present
    expect(tagValue(event, 'payload')).not.toBeNull();
  });

  it('signs reads too (no body → no payload tag)', async () => {
    const { calls, fetchFn } = makeFetchSpy();
    const nip98 = (method, url, body) =>
      NostrBridge.buildNip98Header(echoSigner, method, url, { body });
    const adapter = new SolidHttpPodsAdapter({ baseUrl: 'http://h:8484', fetchFn, nip98 });

    await adapter.read('/kg/x');
    const event = decodeHeader(calls[0].init.headers.Authorization);
    expect(tagValue(event, 'method')).toBe('GET');
    expect(tagValue(event, 'payload')).toBeNull();
  });

  it('does not overwrite a caller-supplied Authorization header', async () => {
    const { calls, fetchFn } = makeFetchSpy();
    // nip98 would throw if called — proving it is bypassed when auth exists.
    const nip98 = async () => {
      throw new Error('should not be called');
    };
    const adapter = new SolidHttpPodsAdapter({ baseUrl: 'http://h', fetchFn, nip98 });
    // _signedFetch only sees headers it is given; simulate a pre-auth'd call
    // by exercising the wrapper directly.
    await adapter._fetch('http://h/x', {
      method: 'GET',
      headers: { Authorization: 'Bearer abc' },
    });
    expect(calls[0].init.headers.Authorization).toBe('Bearer abc');
  });

  it('is unsigned and byte-identical when no originator is configured', async () => {
    const { calls, fetchFn } = makeFetchSpy();
    const adapter = new SolidHttpPodsAdapter({ baseUrl: 'http://h', fetchFn });
    await adapter.write('/kg/x', 'body', 'text/turtle');
    expect(calls[0].init.headers.Authorization).toBeUndefined();
  });

  it('falls back to unsigned when the originator declines and signing is optional', async () => {
    const { calls, fetchFn } = makeFetchSpy();
    const adapter = new SolidHttpPodsAdapter({
      baseUrl: 'http://h',
      fetchFn,
      nip98: async () => null,
    });
    await adapter.write('/kg/x', 'body', 'text/turtle');
    expect(calls[0].init.headers.Authorization).toBeUndefined();
  });
});

/**
 * ADR-2064: `sign_requests` is a fail-closed switch. When signing is required
 * but no header can be produced, the adapter MUST throw and emit no bytes —
 * never a silent unsigned request against a default-deny pod.
 */
describe('SolidHttpPodsAdapter fail-closed signing (ADR-2064)', () => {
  function makeFetchSpy() {
    const calls = [];
    const fetchFn = async (url, init = {}) => {
      calls.push({ url, init });
      return {
        status: 200,
        url,
        headers: { get: () => 'text/turtle' },
        text: async () => '',
        json: async () => ({}),
      };
    };
    return { calls, fetchFn };
  }

  it('throws SigningUnavailable when requireSigned but no originator is configured', async () => {
    const { calls, fetchFn } = makeFetchSpy();
    const adapter = new SolidHttpPodsAdapter({
      baseUrl: 'http://h',
      fetchFn,
      requireSigned: true,
    });
    await expect(adapter.write('/kg/x', 'body', 'text/turtle')).rejects.toMatchObject({
      name: 'SigningUnavailable',
      code: 'SIGNING_UNAVAILABLE',
      slot: 'pods',
    });
    // The critical assertion: nothing went out unsigned.
    expect(calls).toHaveLength(0);
  });

  it('throws rather than going out unsigned when the originator declines', async () => {
    const { calls, fetchFn } = makeFetchSpy();
    const adapter = new SolidHttpPodsAdapter({
      baseUrl: 'http://h',
      fetchFn,
      requireSigned: true,
      nip98: async () => null, // key undecryptable / signer refused
    });
    await expect(adapter.read('/kg/x')).rejects.toThrow(/declined to sign/);
    expect(calls).toHaveLength(0);
  });

  it('surfaces a throwing originator as a typed SigningUnavailable', async () => {
    const { calls, fetchFn } = makeFetchSpy();
    const adapter = new SolidHttpPodsAdapter({
      baseUrl: 'http://h',
      fetchFn,
      requireSigned: true,
      nip98: async () => {
        throw new Error('nostr.key.enc could not be decrypted');
      },
    });
    await expect(adapter.list('/kg/')).rejects.toMatchObject({
      code: 'SIGNING_UNAVAILABLE',
    });
    await expect(adapter.list('/kg/')).rejects.toThrow(/could not be decrypted/);
    expect(calls).toHaveLength(0);
  });

  it('fails closed across every verb, not just writes', async () => {
    const { calls, fetchFn } = makeFetchSpy();
    const adapter = new SolidHttpPodsAdapter({
      baseUrl: 'http://h',
      fetchFn,
      requireSigned: true,
    });
    await expect(adapter.write('/kg/x', 'b')).rejects.toThrow(/Signing unavailable/);
    await expect(adapter.read('/kg/x')).rejects.toThrow(/Signing unavailable/);
    await expect(adapter.del('/kg/x')).rejects.toThrow(/Signing unavailable/);
    await expect(adapter.list('/kg/')).rejects.toThrow(/Signing unavailable/);
    expect(calls).toHaveLength(0);
  });

  it('still signs normally when requireSigned and the originator works', async () => {
    const { calls, fetchFn } = makeFetchSpy();
    const nip98 = (method, url, body) =>
      NostrBridge.buildNip98Header(echoSigner, method, url, { body });
    const adapter = new SolidHttpPodsAdapter({
      baseUrl: 'http://h:8484',
      fetchFn,
      nip98,
      requireSigned: true,
    });
    await adapter.write('/kg/x', '<a> <b> <c> .', 'text/turtle');
    expect(calls).toHaveLength(1);
    expect(tagValue(decodeHeader(calls[0].init.headers.Authorization), 'method')).toBe('PUT');
  });

  it('trusts a caller-supplied Authorization header even when requireSigned', async () => {
    const { calls, fetchFn } = makeFetchSpy();
    const adapter = new SolidHttpPodsAdapter({
      baseUrl: 'http://h',
      fetchFn,
      requireSigned: true,
    });
    await adapter._fetch('http://h/x', {
      method: 'GET',
      headers: { Authorization: 'Nostr preauthorised' },
    });
    expect(calls[0].init.headers.Authorization).toBe('Nostr preauthorised');
  });
});
