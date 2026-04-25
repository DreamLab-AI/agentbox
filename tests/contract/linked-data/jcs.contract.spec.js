'use strict';

/**
 * RFC 8785 JCS conformance subset.
 *
 * Vector source:
 *   https://github.com/cyberphone/json-canonicalization/tree/master/testdata
 *
 * The full IETF test suite is large; this spec exercises the canonical
 * trickier cases that drive every JCS round-trip in surfaces S3 and S8.
 */

const { canonicalise: jcs, JCSEncodingError } =
  require('../../../management-api/middleware/linked-data/jcs');

describe('JCS — RFC 8785', () => {
  test('numbers are formatted per ECMA-262', () => {
    expect(jcs(0)).toBe('0');
    expect(jcs(-0)).toBe('0');
    expect(jcs(1)).toBe('1');
    expect(jcs(-1)).toBe('-1');
    expect(jcs(1.5)).toBe('1.5');
    expect(jcs(1e21)).toBe('1e+21');
    expect(jcs(0.000001)).toBe('0.000001');
    expect(jcs(1e-7)).toBe('1e-7');
  });

  test('rejects NaN / Infinity / bigint / undefined / function / symbol', () => {
    expect(() => jcs(NaN)).toThrow(JCSEncodingError);
    expect(() => jcs(Infinity)).toThrow(JCSEncodingError);
    expect(() => jcs(-Infinity)).toThrow(JCSEncodingError);
    expect(() => jcs(undefined)).toThrow(JCSEncodingError);
    expect(() => jcs(() => 1)).toThrow(JCSEncodingError);
    expect(() => jcs(Symbol('s'))).toThrow(JCSEncodingError);
    expect(() => jcs(BigInt(1))).toThrow(JCSEncodingError);
  });

  test('escapes control characters with lower-case hex', () => {
    expect(jcs('\u0000')).toBe('"\\u0000"');
    expect(jcs('\u001f')).toBe('"\\u001f"');
    expect(jcs('\u0008')).toBe('"\\b"');
    expect(jcs('\t')).toBe('"\\t"');
    expect(jcs('\n')).toBe('"\\n"');
    expect(jcs('\f')).toBe('"\\f"');
    expect(jcs('\r')).toBe('"\\r"');
    expect(jcs('"')).toBe('"\\""');
    expect(jcs('\\')).toBe('"\\\\"');
  });

  test('sorts object keys by code point order', () => {
    expect(jcs({ z: 1, a: 2 })).toBe('{"a":2,"z":1}');
    expect(jcs({ aa: 1, a: 2 })).toBe('{"a":2,"aa":1}');
    // Code-point ordering for non-BMP keys
    expect(jcs({ '\u00e9': 1, '\u00e8': 2, c: 3 })).toBe('{"c":3,"è":2,"é":1}');
  });

  test('arrays preserve order', () => {
    expect(jcs([3, 1, 2])).toBe('[3,1,2]');
    expect(jcs([])).toBe('[]');
  });

  test('nested objects round-trip stably', () => {
    const a = jcs({ b: { c: [1, 2], a: null }, a: true });
    const b = jcs({ a: true, b: { a: null, c: [1, 2] } });
    expect(a).toBe(b);
  });

  test('drops undefined values within objects', () => {
    expect(jcs({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  test('null / true / false pass through', () => {
    expect(jcs(null)).toBe('null');
    expect(jcs(true)).toBe('true');
    expect(jcs(false)).toBe('false');
  });
});
