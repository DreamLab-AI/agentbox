'use strict';

/**
 * P2-10 — Linked-data surface input validation contract tests.
 *
 * Verifies that validatePayload rejects malformed, oversized, and
 * structurally abusive inputs before they reach any surface encoder.
 */

const {
  validatePayload,
  InputValidationError,
  PayloadTooLargeError,
  DEFAULT_MAX_PAYLOAD_BYTES,
  DEFAULT_MAX_STRING_LENGTH,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_KEYS,
} = require('../../../management-api/middleware/linked-data/input-validator');

// Minimal mock resolver that behaves like ContextResolver.tryResolve().
function mockResolver(knownIris) {
  return {
    tryResolve(iri) {
      return knownIris.includes(iri) ? { '@context': {} } : null;
    },
  };
}

describe('P2-10 — Input Validator', () => {
  // ── Type checks ──────────────────────────────────────────────────────────

  describe('payload type validation', () => {
    test('rejects null payload', () => {
      expect(() => validatePayload(null)).toThrow(InputValidationError);
      expect(() => validatePayload(null)).toThrow(/non-null object/);
    });

    test('rejects undefined payload', () => {
      expect(() => validatePayload(undefined)).toThrow(InputValidationError);
      expect(() => validatePayload(undefined)).toThrow(/non-null object/);
    });

    test('rejects array payload', () => {
      expect(() => validatePayload([1, 2, 3])).toThrow(InputValidationError);
      expect(() => validatePayload([1, 2, 3])).toThrow(/plain object.*array/);
    });

    test('rejects string payload', () => {
      expect(() => validatePayload('hello')).toThrow(InputValidationError);
      expect(() => validatePayload('hello')).toThrow(/plain object.*string/);
    });

    test('rejects number payload', () => {
      expect(() => validatePayload(42)).toThrow(InputValidationError);
      expect(() => validatePayload(42)).toThrow(/plain object.*number/);
    });

    test('rejects boolean payload', () => {
      expect(() => validatePayload(true)).toThrow(InputValidationError);
    });

    test('accepts valid plain object', () => {
      expect(() => validatePayload({ id: 'urn:test:1', name: 'ok' })).not.toThrow();
    });

    test('accepts empty object', () => {
      expect(() => validatePayload({})).not.toThrow();
    });

    test('error has correct code for null', () => {
      try {
        validatePayload(null, { surfaceId: 'S1' });
      } catch (err) {
        expect(err.code).toBe('PAYLOAD_REQUIRED');
        expect(err.surface).toBe('S1');
        return;
      }
      throw new Error('expected to throw');
    });
  });

  // ── Size checks ──────────────────────────────────────────────────────────

  describe('payload size validation', () => {
    test('rejects payload exceeding default 1 MB limit', () => {
      const bigString = 'x'.repeat(1024 * 1024 + 1);
      expect(() => validatePayload({ data: bigString })).toThrow(PayloadTooLargeError);
    });

    test('rejects payload exceeding custom byte limit', () => {
      const payload = { data: 'x'.repeat(500) };
      expect(() =>
        validatePayload(payload, { maxPayloadBytes: 100 }),
      ).toThrow(PayloadTooLargeError);
    });

    test('accepts payload within limit', () => {
      const payload = { data: 'x'.repeat(100) };
      expect(() =>
        validatePayload(payload, { maxPayloadBytes: 1024 }),
      ).not.toThrow();
    });

    test('PayloadTooLargeError carries byteLength and limit', () => {
      const payload = { data: 'x'.repeat(200) };
      try {
        validatePayload(payload, { maxPayloadBytes: 10, surfaceId: 'S3' });
      } catch (err) {
        expect(err).toBeInstanceOf(PayloadTooLargeError);
        expect(err).toBeInstanceOf(InputValidationError);
        expect(err.code).toBe('PAYLOAD_TOO_LARGE');
        expect(err.surface).toBe('S3');
        expect(err.byteLength).toBeGreaterThan(10);
        expect(err.limit).toBe(10);
        return;
      }
      throw new Error('expected to throw');
    });

    test('rejects circular-reference payloads as non-serialisable', () => {
      const obj = {};
      obj.self = obj;
      expect(() => validatePayload(obj)).toThrow(InputValidationError);
      try {
        validatePayload(obj);
      } catch (err) {
        expect(err.code).toBe('PAYLOAD_NOT_SERIALISABLE');
        return;
      }
    });
  });

  // ── Structural checks ────────────────────────────────────────────────────

  describe('depth validation', () => {
    test('rejects payload nested beyond default depth limit', () => {
      let obj = { leaf: true };
      for (let i = 0; i < DEFAULT_MAX_DEPTH + 2; i++) {
        obj = { nested: obj };
      }
      expect(() => validatePayload(obj)).toThrow(InputValidationError);
      try {
        validatePayload(obj);
      } catch (err) {
        expect(err.code).toBe('PAYLOAD_TOO_DEEP');
        return;
      }
    });

    test('rejects payload nested beyond custom depth limit', () => {
      const obj = { a: { b: { c: { d: { e: 1 } } } } };
      expect(() =>
        validatePayload(obj, { maxDepth: 3 }),
      ).toThrow(InputValidationError);
    });

    test('accepts payload within depth limit', () => {
      const obj = { a: { b: { c: 1 } } };
      expect(() =>
        validatePayload(obj, { maxDepth: 10 }),
      ).not.toThrow();
    });
  });

  describe('key count validation', () => {
    test('rejects payload with too many keys', () => {
      const obj = {};
      for (let i = 0; i < 50; i++) {
        obj[`key${i}`] = 'value';
      }
      expect(() =>
        validatePayload(obj, { maxKeys: 20 }),
      ).toThrow(InputValidationError);
      try {
        validatePayload(obj, { maxKeys: 20 });
      } catch (err) {
        expect(err.code).toBe('TOO_MANY_KEYS');
        return;
      }
    });

    test('counts keys across nested objects', () => {
      const obj = {
        a: { a1: 1, a2: 2, a3: 3 },
        b: { b1: 1, b2: 2, b3: 3 },
      };
      // Total keys: a, b (2) + a1, a2, a3 (3) + b1, b2, b3 (3) = 8
      expect(() =>
        validatePayload(obj, { maxKeys: 5 }),
      ).toThrow(InputValidationError);
    });
  });

  describe('string length validation', () => {
    test('rejects individual string exceeding limit', () => {
      const obj = { data: 'x'.repeat(1000) };
      expect(() =>
        validatePayload(obj, { maxStringLength: 500 }),
      ).toThrow(InputValidationError);
      try {
        validatePayload(obj, { maxStringLength: 500 });
      } catch (err) {
        expect(err.code).toBe('STRING_TOO_LONG');
        return;
      }
    });

    test('checks strings in nested objects', () => {
      const obj = { nested: { deep: 'x'.repeat(1000) } };
      expect(() =>
        validatePayload(obj, { maxStringLength: 500 }),
      ).toThrow(InputValidationError);
    });

    test('checks strings in arrays', () => {
      const obj = { items: ['ok', 'x'.repeat(1000)] };
      expect(() =>
        validatePayload(obj, { maxStringLength: 500 }),
      ).toThrow(InputValidationError);
    });

    test('accepts strings within limit', () => {
      const obj = { data: 'x'.repeat(100) };
      expect(() =>
        validatePayload(obj, { maxStringLength: 500 }),
      ).not.toThrow();
    });
  });

  // ── @context validation ──────────────────────────────────────────────────

  describe('@context validation', () => {
    const KNOWN_IRI = 'https://agentbox.dreamlab-ai.systems/ns/v1#';
    const UNKNOWN_IRI = 'https://evil.example.com/context.jsonld';

    test('rejects unknown @context IRI when resolver is provided', () => {
      const resolver = mockResolver([KNOWN_IRI]);
      const payload = { '@context': UNKNOWN_IRI, name: 'test' };
      expect(() =>
        validatePayload(payload, { resolver }),
      ).toThrow(InputValidationError);
      try {
        validatePayload(payload, { resolver });
      } catch (err) {
        expect(err.code).toBe('UNKNOWN_CONTEXT_IRI');
        return;
      }
    });

    test('accepts known @context IRI', () => {
      const resolver = mockResolver([KNOWN_IRI]);
      const payload = { '@context': KNOWN_IRI, name: 'test' };
      expect(() =>
        validatePayload(payload, { resolver }),
      ).not.toThrow();
    });

    test('validates each IRI in an @context array', () => {
      const resolver = mockResolver([KNOWN_IRI]);
      const payload = { '@context': [KNOWN_IRI, UNKNOWN_IRI], name: 'test' };
      expect(() =>
        validatePayload(payload, { resolver }),
      ).toThrow(InputValidationError);
    });

    test('accepts inline @context objects', () => {
      const resolver = mockResolver([KNOWN_IRI]);
      const payload = {
        '@context': [KNOWN_IRI, { '@vocab': 'urn:test:' }],
        name: 'test',
      };
      expect(() =>
        validatePayload(payload, { resolver }),
      ).not.toThrow();
    });

    test('rejects unknown @import IRI inside inline context', () => {
      const resolver = mockResolver([KNOWN_IRI]);
      const payload = {
        '@context': [{ '@import': UNKNOWN_IRI }],
        name: 'test',
      };
      expect(() =>
        validatePayload(payload, { resolver }),
      ).toThrow(InputValidationError);
    });

    test('rejects non-string non-object @context entries', () => {
      const resolver = mockResolver([KNOWN_IRI]);
      const payload = { '@context': [42], name: 'test' };
      expect(() =>
        validatePayload(payload, { resolver }),
      ).toThrow(InputValidationError);
      try {
        validatePayload(payload, { resolver });
      } catch (err) {
        expect(err.code).toBe('INVALID_CONTEXT_TYPE');
        return;
      }
    });

    test('skips @context validation when no resolver provided', () => {
      const payload = { '@context': 'https://anything.example.com/', name: 'test' };
      expect(() => validatePayload(payload)).not.toThrow();
    });
  });

  // ── Integration: error is InputValidationError ───────────────────────────

  describe('error class hierarchy', () => {
    test('PayloadTooLargeError is instanceof InputValidationError', () => {
      const err = new PayloadTooLargeError(2000, 1000, 'S1');
      expect(err).toBeInstanceOf(InputValidationError);
      expect(err).toBeInstanceOf(Error);
    });

    test('InputValidationError carries surface id', () => {
      const err = new InputValidationError('TEST_CODE', 'test', 'S5');
      expect(err.surface).toBe('S5');
      expect(err.code).toBe('TEST_CODE');
      expect(err.name).toBe('InputValidationError');
    });
  });

  // ── Defaults are exported ────────────────────────────────────────────────

  describe('exported defaults', () => {
    test('default limits are sensible', () => {
      expect(DEFAULT_MAX_PAYLOAD_BYTES).toBe(1 * 1024 * 1024);
      expect(DEFAULT_MAX_STRING_LENGTH).toBe(256 * 1024);
      expect(DEFAULT_MAX_DEPTH).toBe(32);
      expect(DEFAULT_MAX_KEYS).toBe(1000);
    });
  });
});
