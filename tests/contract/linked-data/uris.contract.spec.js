'use strict';

/**
 * Canonical URI grammar — invariants L13–L15 (DDD-004).
 *
 * Verifies the contract that every URI is unique by construction and
 * that the resolver is a pure function (best-effort resolvability,
 * never raises, never blocks on I/O). All fixtures use BIP-340 x-only
 * pubkey hex per ADR-013; bech32 npub is exercised at the parameter-
 * normalisation boundary only.
 */

const uris = require('../../../management-api/lib/uris');

const AGENT_PUBKEY  = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const AGENT_PUBKEY2 = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

describe('ADR-013 — Canonical URI grammar', () => {
  describe('L13 — uniqueness', () => {
    test('same payload mints the same URI', () => {
      const a = uris.mint({ kind: 'credential', pubkey: AGENT_PUBKEY, payload: { foo: 'bar', n: 1 } });
      const b = uris.mint({ kind: 'credential', pubkey: AGENT_PUBKEY, payload: { n: 1, foo: 'bar' } });
      expect(a).toBe(b);
    });

    test('different payloads mint different URIs', () => {
      const a = uris.mint({ kind: 'credential', pubkey: AGENT_PUBKEY, payload: { foo: 'a' } });
      const b = uris.mint({ kind: 'credential', pubkey: AGENT_PUBKEY, payload: { foo: 'b' } });
      expect(a).not.toBe(b);
    });

    test('non-content-addressed kinds use localId', () => {
      const a = uris.mint({ kind: 'skill', localId: 'console-buddy' });
      const b = uris.mint({ kind: 'skill', localId: 'console-buddy' });
      expect(a).toBe('urn:agentbox:skill:console-buddy');
      expect(a).toBe(b);
    });

    test('owner-scoped kinds reject missing pubkey', () => {
      expect(() => uris.mint({ kind: 'credential', payload: { foo: 'bar' } }))
        .toThrow(/pubkey scope/);
    });

    test('did:nostr is honoured as scope', () => {
      const u = uris.mint({
        kind: 'credential',
        pubkey: `did:nostr:${AGENT_PUBKEY}`,
        payload: { foo: 'bar' },
      });
      expect(u).toContain(`:${AGENT_PUBKEY}:`);
    });

    test('npub deprecated alias still accepted (backward compat)', () => {
      const a = uris.mint({ kind: 'credential', pubkey: AGENT_PUBKEY, payload: { x: 1 } });
      const b = uris.mint({ kind: 'credential', npub:   AGENT_PUBKEY, payload: { x: 1 } });
      expect(a).toBe(b);
    });
  });

  describe('ADR-048 — decision kind', () => {
    test('decision mints a scope-required content-addressed URN', () => {
      const u = uris.mint({
        kind: 'decision',
        pubkey: AGENT_PUBKEY,
        payload: { summary: 'merge X', rationale: 'r' },
      });
      expect(u).toMatch(new RegExp(`^urn:agentbox:decision:${AGENT_PUBKEY}:sha256-12-[0-9a-f]{12}$`));
      expect(uris.isCanonical(u)).toBe(true);
    });

    test('decision content-addresses the payload (same in → same URN)', () => {
      const a = uris.mint({ kind: 'decision', pubkey: AGENT_PUBKEY, payload: { s: 'a', n: 1 } });
      const b = uris.mint({ kind: 'decision', pubkey: AGENT_PUBKEY, payload: { n: 1, s: 'a' } });
      expect(a).toBe(b);
    });

    test('decision rejects missing pubkey scope', () => {
      expect(() => uris.mint({ kind: 'decision', payload: { summary: 's' } }))
        .toThrow(/pubkey scope/);
    });

    test('decision requires a payload (content-addressed)', () => {
      expect(() => uris.mint({ kind: 'decision', pubkey: AGENT_PUBKEY }))
        .toThrow(/content-addressed/);
    });

    test('unknown kind still throws (kinds remain closed)', () => {
      expect(() => uris.mint({ kind: 'verdict', pubkey: AGENT_PUBKEY, payload: { s: 1 } }))
        .toThrow(uris.UnknownUriKind);
    });
  });

  describe('ADR-2098 (amended 2026-10-02) — chain kind keyed by the chain event id', () => {
    const HASH = 'ab'.repeat(32);
    const SIGNER = '7092810a05359b29acfa1f884d0e1a8e0290309e1133198b0f059447a4c76d62';
    const GENESIS = '4db37517728bd509c0cb96ee5a2e3e2a77f9e965a092e9f67948b413d453dbc0';
    const DOC = { id: 'sidestr:dreamlab', parent: 'tbtc4', signer: SIGNER, genesisHash: GENESIS };
    const EVENT = {
      kind: 3500, id: HASH, pubkey: SIGNER, sig: 'cd'.repeat(64), created_at: 1790900000,
      tags: [['n', 'sidestr:dreamlab'], ['t', 'sidestr']],
      content: JSON.stringify({ id: 'sidestr:dreamlab', parent: 'tbtc4', genesisHash: GENESIS }),
    };
    const verifyOk = () => true;

    test('mints a chain URN from a 64-hex id, unscoped, with a sha256-12 display form', () => {
      const u = uris.mint({ kind: 'chain', localId: HASH });
      expect(u).toBe(`urn:agentbox:chain:${HASH}`);
      expect(uris.isCanonical(u)).toBe(true);
      expect(uris.parse(u)).toEqual({ scheme: 'urn', kind: 'chain', pubkey: null, local: HASH });
      expect(uris.chainDisplay(u)).toBe(`sha256-12-${HASH.slice(0, 12)}`);
      expect(uris.chainDisplay(HASH)).toBe(`sha256-12-${HASH.slice(0, 12)}`);
    });

    test('upper-case hex is the same id, minted in lower case', () => {
      expect(uris.mint({ kind: 'chain', localId: HASH.toUpperCase() })).toBe(`urn:agentbox:chain:${HASH}`);
    });

    test("rejects 'sidestr:<name>' as a local id rather than slugging it", () => {
      expect(() => uris.mint({ kind: 'chain', localId: 'sidestr:dreamlab' })).toThrow(uris.MalformedUri);
      expect(() => uris.mint({ kind: 'chain', localId: 'dreamlab' })).toThrow(/local id must match/);
      expect(() => uris.mint({ kind: 'chain', localId: HASH.slice(0, 63) })).toThrow(uris.MalformedUri);
      expect(() => uris.mint({ kind: 'chain', localId: GENESIS + '00' })).toThrow(uris.MalformedUri);
    });

    test('a chain URN on an alias is not canonical and does not parse or resolve', () => {
      // URN_RE admits one colon after the kind, so this would otherwise read as
      // scope `sidestr` + local `dreamlab`.
      const bad = 'urn:agentbox:chain:sidestr:dreamlab';
      expect(uris.isCanonical(bad)).toBe(false);
      expect(uris.parse(bad)).toBeNull();
      expect(uris.resolveCanonical(bad, { managementApiBase: 'http://127.0.0.1:9090' })).toBeNull();
      expect(uris.isCanonical('urn:agentbox:chain:dreamlab')).toBe(false);
    });

    test('resolves through /v1/uri on the chains surface', () => {
      const out = uris.resolveCanonical(`urn:agentbox:chain:${HASH}`, { managementApiBase: 'http://127.0.0.1:9090' });
      expect(out).toBe(`http://127.0.0.1:9090/v1/uri/${encodeURIComponent(`urn:agentbox:chain:${HASH}`)}?surface=chains`);
    });

    test('the record carries hash, alias and genesisHash separately, keyed by the event id', () => {
      const r = uris.chainRecord({ document: DOC, event: EVENT, verify: verifyOk });
      expect(r).toEqual({
        urn: `urn:agentbox:chain:${HASH}`, hash: HASH, display: `sha256-12-${HASH.slice(0, 12)}`,
        alias: 'sidestr:dreamlab', genesisHash: GENESIS, signer: SIGNER, legacy: false,
      });
    });

    test('an event that does not verify, or disagrees with the document, is refused', () => {
      expect(() => uris.chainRecord({ document: DOC, event: EVENT, verify: () => false })).toThrow(/does not verify/);
      expect(() => uris.chainRecord({ document: DOC, event: EVENT })).toThrow(/needs a verifier/);
      expect(() => uris.chainRecord({ document: DOC, event: { ...EVENT, kind: 33501 }, verify: verifyOk })).toThrow(/kind 3500/);
      expect(() => uris.chainRecord({ document: { ...DOC, id: 'sidestr:other' }, event: EVENT, verify: verifyOk })).toThrow(/is for sidestr:dreamlab/);
      expect(() => uris.chainRecord({ document: { ...DOC, genesisHash: 'ef'.repeat(32) }, event: EVENT, verify: verifyOk })).toThrow(/genesisHash/);
      expect(() => uris.chainRecord({ document: { ...DOC, signer: 'ee'.repeat(32) }, event: EVENT, verify: verifyOk })).toThrow(/not the document's signer/);
      const otherSigner = { ...EVENT, content: JSON.stringify({ id: 'sidestr:dreamlab', signer: 'ee'.repeat(32) }) };
      expect(() => uris.chainRecord({ event: otherSigner, verify: verifyOk })).toThrow(/signer other than/);
      const notInSet = { ...EVENT, content: JSON.stringify({ id: 'sidestr:dreamlab', signers: ['ee'.repeat(32)] }) };
      expect(() => uris.chainRecord({ event: notInSet, verify: verifyOk })).toThrow(/not one of the document's signers/);
    });

    test('a chain without an event resolves by alias + genesis, flagged legacy, with no URN', () => {
      const legacy = uris.chainRecord({ document: DOC });
      expect(legacy).toEqual({
        urn: null, hash: null, display: null, alias: 'sidestr:dreamlab', genesisHash: GENESIS, signer: SIGNER, legacy: true,
      });
      expect(uris.resolveChain({ alias: 'sidestr:dreamlab', genesisHash: GENESIS }, [legacy])).toBe(legacy);
      expect(uris.resolveChain({ alias: 'sidestr:dreamlab', genesisHash: GENESIS.toUpperCase() }, [legacy])).toBe(legacy);
      // An alias alone is a name, not a proof; a wrong genesis is another chain.
      expect(uris.resolveChain({ alias: 'sidestr:dreamlab' }, [legacy])).toBeNull();
      expect(uris.resolveChain({ alias: 'sidestr:dreamlab', genesisHash: 'ef'.repeat(32) }, [legacy])).toBeNull();
      expect(() => uris.chainRecord({ document: { id: 'sidestr:dreamlab' } })).toThrow(/no genesisHash/);
    });

    test('a resolver never redirects one id to another', () => {
      const r = uris.chainRecord({ document: DOC, event: EVENT, verify: verifyOk });
      expect(uris.resolveChain({ hash: HASH }, [r])).toBe(r);
      expect(uris.resolveChain({ urn: `urn:agentbox:chain:${HASH}` }, [r])).toBe(r);
      // Same alias and genesis, different hash: no fallback.
      expect(uris.resolveChain({ hash: 'cd'.repeat(32) }, [r])).toBeNull();
      expect(uris.resolveChain({ urn: 'urn:agentbox:chain:sidestr:dreamlab' }, [r])).toBeNull();
      // Alias + genesis reaches the hashed record as itself, not as legacy.
      expect(uris.resolveChain({ alias: 'sidestr:dreamlab', genesisHash: GENESIS }, [r]).legacy).toBe(false);
    });
  });

  describe('L14 — resolver is a pure function', () => {
    test('resolveCanonical never throws on weird input', () => {
      expect(() => uris.resolveCanonical(null)).not.toThrow();
      expect(() => uris.resolveCanonical('not-a-uri')).not.toThrow();
      expect(() => uris.resolveCanonical(42)).not.toThrow();
    });

    test('returns null for non-canonical input', () => {
      expect(uris.resolveCanonical('urn:uuid:deadbeef')).toBeNull();
      expect(uris.resolveCanonical('http://example.com')).toBeNull();
    });

    test('did:nostr resolves to /.well-known/did.json under podBase', () => {
      const out = uris.resolveCanonical(
        `did:nostr:${AGENT_PUBKEY}`,
        { podBase: 'http://127.0.0.1:8484' },
      );
      expect(out).toBe('http://127.0.0.1:8484/.well-known/did.json');
    });

    test('did:nostr without podBase returns null', () => {
      expect(uris.resolveCanonical(`did:nostr:${AGENT_PUBKEY}`)).toBeNull();
    });

    test('urn:agentbox routes through management-api', () => {
      const u = uris.mint({ kind: 'mcp', localId: 'playwright' });
      const out = uris.resolveCanonical(u, { managementApiBase: 'http://127.0.0.1:9090' });
      expect(out).toContain('/v1/uri/');
      expect(out).toContain(encodeURIComponent(u));
    });
  });

  describe('L15 — kinds are closed', () => {
    test('unknown kind throws at mint', () => {
      expect(() => uris.mint({ kind: 'frobnitz', localId: 'x' }))
        .toThrow(uris.UnknownUriKind);
    });

    test('every advertised kind has a metadata entry', () => {
      for (const k of Object.keys(uris.KINDS)) {
        const spec = uris.KINDS[k];
        expect(typeof spec.ownerScope).toBe('boolean');
        expect(typeof spec.contentAddressed).toBe('boolean');
        expect(typeof spec.resolvableSurface).toBe('string');
      }
    });
  });

  describe('parse / isCanonical', () => {
    test('isCanonical recognises both grammar branches', () => {
      expect(uris.isCanonical(`did:nostr:${AGENT_PUBKEY}`)).toBe(true);
      expect(uris.isCanonical('urn:agentbox:skill:foo')).toBe(true);
      expect(uris.isCanonical(`urn:agentbox:credential:${AGENT_PUBKEY}:sha256-12-deadbeef0000`)).toBe(true);
      expect(uris.isCanonical('urn:uuid:abc')).toBe(false);
      expect(uris.isCanonical('http://example.com')).toBe(false);
      // Bech32 npub in a DID is no longer canonical in the URI grammar
      expect(uris.isCanonical('did:nostr:npub1abc00000000000000000000000000000000000000')).toBe(false);
    });

    test('parse decomposes a scoped URN', () => {
      const p = uris.parse(`urn:agentbox:credential:${AGENT_PUBKEY}:sha256-12-deadbeef0000`);
      expect(p).toEqual({
        scheme: 'urn',
        kind: 'credential',
        pubkey: AGENT_PUBKEY,
        local: 'sha256-12-deadbeef0000',
      });
    });

    test('parse decomposes did:nostr', () => {
      const p = uris.parse(`did:nostr:${AGENT_PUBKEY}`);
      expect(p).toEqual({
        scheme: 'did',
        method: 'nostr',
        pubkey: AGENT_PUBKEY,
      });
    });
  });
});
