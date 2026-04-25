'use strict';

/**
 * Canonical URI grammar — invariants L13–L15 (DDD-004).
 *
 * Verifies the contract that every URI is unique by construction and
 * that the resolver is a pure function (best-effort resolvability,
 * never raises, never blocks on I/O).
 */

const uris = require('../../../management-api/lib/uris');

describe('ADR-013 — Canonical URI grammar', () => {
  describe('L13 — uniqueness', () => {
    test('same payload mints the same URI', () => {
      const npub = 'npub1agentbox00000000000000000000000000000000';
      const a = uris.mint({ kind: 'credential', npub, payload: { foo: 'bar', n: 1 } });
      const b = uris.mint({ kind: 'credential', npub, payload: { n: 1, foo: 'bar' } });
      expect(a).toBe(b);
    });

    test('different payloads mint different URIs', () => {
      const npub = 'npub1agentbox00000000000000000000000000000000';
      const a = uris.mint({ kind: 'credential', npub, payload: { foo: 'a' } });
      const b = uris.mint({ kind: 'credential', npub, payload: { foo: 'b' } });
      expect(a).not.toBe(b);
    });

    test('non-content-addressed kinds use localId', () => {
      const a = uris.mint({ kind: 'skill', localId: 'console-buddy' });
      const b = uris.mint({ kind: 'skill', localId: 'console-buddy' });
      expect(a).toBe('urn:agentbox:skill:console-buddy');
      expect(a).toBe(b);
    });

    test('owner-scoped kinds reject missing npub', () => {
      expect(() => uris.mint({ kind: 'credential', payload: { foo: 'bar' } }))
        .toThrow(/npub scope/);
    });

    test('did:nostr is honoured as scope', () => {
      const u = uris.mint({
        kind: 'credential',
        npub: 'did:nostr:npub1agent00000000000000000000000000000000000',
        payload: { foo: 'bar' },
      });
      expect(u).toContain(':npub1agent00000000000000000000000000000000000:');
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
        'did:nostr:npub1agent00000000000000000000000000000000000',
        { podBase: 'http://127.0.0.1:8484' },
      );
      expect(out).toBe('http://127.0.0.1:8484/.well-known/did.json');
    });

    test('did:nostr without podBase returns null', () => {
      expect(uris.resolveCanonical('did:nostr:npub1abcdefgh00000000000000000000000000000000')).toBeNull();
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
    test('isCanonical recognises the two grammar branches', () => {
      expect(uris.isCanonical('did:nostr:npub1abc00000000000000000000000000000000000000')).toBe(true);
      expect(uris.isCanonical('urn:agentbox:skill:foo')).toBe(true);
      expect(uris.isCanonical('urn:agentbox:credential:npub1abc:sha256-12-deadbeef0000')).toBe(true);
      expect(uris.isCanonical('urn:uuid:abc')).toBe(false);
      expect(uris.isCanonical('http://example.com')).toBe(false);
    });

    test('parse decomposes a scoped URN', () => {
      const p = uris.parse('urn:agentbox:credential:npub1abc:sha256-12-deadbeef0000');
      expect(p).toEqual({
        scheme: 'urn',
        kind: 'credential',
        npub: 'npub1abc',
        local: 'sha256-12-deadbeef0000',
      });
    });

    test('parse decomposes did:nostr', () => {
      const p = uris.parse('did:nostr:npub1abc00000000000000000000000000000000000000');
      expect(p).toEqual({
        scheme: 'did',
        method: 'nostr',
        npub: 'npub1abc00000000000000000000000000000000000000',
      });
    });
  });
});
