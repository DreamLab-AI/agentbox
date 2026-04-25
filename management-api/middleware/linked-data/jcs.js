'use strict';

/**
 * JSON Canonicalization Scheme (JCS) — RFC 8785.
 *
 * Used by surfaces S3 (Verifiable Credentials) and S8 (agentic-payment
 * mandates and receipts) to produce a deterministic byte sequence that
 * the proof block signs. PRD-006 §8.2 requires:
 *
 *   canonicalise(emit(input)) == jcs(emit(input))
 *
 * Tested against the upstream RFC 8785 test vectors in
 * tests/contract/linked-data/jcs.spec.js.
 *
 * Implementation notes:
 *
 *   1. Strings are serialised per Section 3.2.2.2 of RFC 8785, which
 *      defers to ECMA-262 §24.5.2 (JSON.stringify) for escape behaviour
 *      with the explicit constraint that all U+0000..U+001F characters
 *      use the lower-case 6-character `\uXXXX` form except for the five
 *      shortcuts \b \t \n \f \r.
 *
 *   2. Numbers are serialised per Section 3.2.2.3 of RFC 8785, which
 *      defers to ECMA-262 §6.1.6.1.20 (Number.prototype.toString). This
 *      is exactly what `String(value)` does in JavaScript when the value
 *      is a finite number. NaN and ±Infinity are rejected because RFC
 *      8259 forbids them in JSON.
 *
 *   3. Object keys are sorted by Unicode code-point order, not by UTF-16
 *      code-unit order. JavaScript strings are UTF-16 by default, but
 *      the spec requires comparing by code points. We sort using the
 *      iterator-based code-point sequence per `[...str]`.
 *
 *   4. Arrays preserve order.
 *
 *   5. No insignificant whitespace.
 *
 *   6. Non-finite numbers, undefined, functions, and symbols throw.
 */

class JCSEncodingError extends Error {
  constructor(message, value) {
    super(message);
    this.name = 'JCSEncodingError';
    this.value = value;
  }
}

/**
 * Canonicalise a JSON-compatible JavaScript value to its RFC 8785 byte form.
 *
 * @param {*} value
 * @returns {string} canonical JSON
 */
function canonicalise(value) {
  return _serialise(value);
}

function _serialise(value) {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';

  if (typeof value === 'number') return _serialiseNumber(value);
  if (typeof value === 'string') return _serialiseString(value);

  if (Array.isArray(value)) {
    const parts = value.map(_serialise);
    return `[${parts.join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return _serialiseObject(value);
  }

  if (value === undefined) {
    throw new JCSEncodingError('JCS rejects undefined', value);
  }
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new JCSEncodingError(
      `JCS rejects ${typeof value} values`, value
    );
  }
  throw new JCSEncodingError(`JCS does not know how to encode ${typeof value}`, value);
}

function _serialiseNumber(n) {
  if (!Number.isFinite(n)) {
    throw new JCSEncodingError('JCS rejects non-finite numbers (NaN / Infinity)', n);
  }
  if (Object.is(n, -0)) return '0';
  // ECMA-262 Number.prototype.toString matches RFC 8785 §3.2.2.3 for finite
  // values. JavaScript's `String(number)` and `n.toString()` use the
  // same algorithm.
  return String(n);
}

function _serialiseString(s) {
  // Build the JCS-conformant escaped string directly so we don't depend on
  // `JSON.stringify`'s implementation-specific escape choices for chars
  // outside U+0000..U+001F.
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    // Handle surrogate pairs as a unit; we still emit them as-is because
    // RFC 8785 §3.2.2.2 says "as a sequence of UTF-8 bytes" without
    // requiring further escaping for non-BMP code points. We pass them
    // through as the JS string's existing UTF-16 representation, which
    // when later UTF-8 encoded yields the correct bytes.
    if (code === 0x22) out += '\\"';
    else if (code === 0x5C) out += '\\\\';
    else if (code === 0x08) out += '\\b';
    else if (code === 0x09) out += '\\t';
    else if (code === 0x0A) out += '\\n';
    else if (code === 0x0C) out += '\\f';
    else if (code === 0x0D) out += '\\r';
    else if (code < 0x20) {
      out += '\\u' + code.toString(16).padStart(4, '0');
    } else {
      out += s[i];
    }
  }
  out += '"';
  return out;
}

function _serialiseObject(obj) {
  // RFC 8785 §3.2.3: sort by Unicode code point order. JavaScript object
  // keys are strings; we sort by code-point sequence using `[...key]`
  // which iterates code points (not UTF-16 code units) per §21.1.3.27 of
  // ECMA-262 (string iterator). Then we serialise each key:value pair
  // separated by commas with no whitespace.
  const keys = Object.keys(obj).sort(_codePointCompare);
  const parts = [];
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined) continue;       // RFC 8785 §3.2.3 step 4: drop undefined
    parts.push(`${_serialiseString(k)}:${_serialise(v)}`);
  }
  return `{${parts.join(',')}}`;
}

function _codePointCompare(a, b) {
  // Compare two strings by Unicode code point sequence. Sorting by raw
  // string compare in JavaScript is UTF-16 order; for keys without
  // surrogates that matches code points, but for keys containing
  // surrogate pairs (e.g. emoji) the orders diverge. We iterate code
  // points explicitly.
  const aIter = a[Symbol.iterator]();
  const bIter = b[Symbol.iterator]();
  while (true) {
    const aNext = aIter.next();
    const bNext = bIter.next();
    if (aNext.done && bNext.done) return 0;
    if (aNext.done) return -1;
    if (bNext.done) return 1;
    const aCode = aNext.value.codePointAt(0);
    const bCode = bNext.value.codePointAt(0);
    if (aCode !== bCode) return aCode - bCode;
  }
}

module.exports = {
  canonicalise,
  JCSEncodingError,
};
