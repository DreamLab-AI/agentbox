'use strict';

/**
 * Round-trip helper — PRD-006 §8.1, DDD-004 §L12.
 *
 * Asserts:
 *
 *     emit(input) == compact(expand(emit(input)), context)
 *
 * for a given JSON-LD payload and the surface's PinnedContextIRI.
 *
 * Used by tests/contract/linked-data/round-trip.spec.js as the contract
 * harness, and by individual surface modules as a self-check before they
 * return bytes from `encode()`. The round-trip uses jsonld.js with the
 * resolver's documentLoader so no network I/O occurs.
 */

let _jsonld = null;
function _loadJsonld() {
  if (_jsonld) return _jsonld;
  try {
    _jsonld = require('jsonld');
  } catch (err) {
    throw new Error(
      'jsonld package not available. Run `npm install` in management-api/ ' +
      'or ensure the buildNpmPackage closure includes jsonld@^8 ' +
      `(${err.message})`,
    );
  }
  return _jsonld;
}

class RoundTripViolation extends Error {
  constructor(surface, expectedSha, actualSha) {
    super(
      `RoundTripViolation: surface ${surface} produced different bytes ` +
      `after expand→compact (expected ${expectedSha}, got ${actualSha})`,
    );
    this.name = 'RoundTripViolation';
    this.surface = surface;
    this.expected = expectedSha;
    this.actual = actualSha;
  }
}

/**
 * Run an expand→compact pair against the supplied payload and verify the
 * output matches the input modulo @context object identity (we compare
 * the structural equivalence of the two documents under JSON
 * canonicalisation).
 *
 * @param {object} opts
 * @param {object} opts.resolver — ContextResolver
 * @param {object} opts.payload — the JSON-LD document to round-trip
 * @param {object|string} opts.context — context value to use for compact()
 * @param {string} [opts.surface] — surface id, for error reporting
 * @returns {Promise<object>} the compacted document (same shape as input)
 */
async function roundTrip({ resolver, payload, context, surface }) {
  const jsonld = _loadJsonld();
  const docLoader = resolver.documentLoader();
  const expanded = await jsonld.expand(payload, { documentLoader: docLoader });
  const compacted = await jsonld.compact(expanded, context, { documentLoader: docLoader });

  const inputCanon = _canon(_strip(payload));
  const outputCanon = _canon(_strip(compacted));
  if (inputCanon !== outputCanon) {
    const inSha = _sha(inputCanon);
    const outSha = _sha(outputCanon);
    throw new RoundTripViolation(surface || 'unknown', inSha, outSha);
  }
  return compacted;
}

function _strip(doc) {
  // For round-trip purposes, we care about structural equivalence after
  // expand→compact, not the @context object identity (compact may inline
  // a context object instead of preserving the original IRI string).
  // We strip @context from the comparison so the test focuses on the
  // claim-bearing content.
  if (Array.isArray(doc)) return doc.map(_strip);
  if (doc && typeof doc === 'object') {
    const out = {};
    for (const k of Object.keys(doc).sort()) {
      if (k === '@context') continue;
      out[k] = _strip(doc[k]);
    }
    return out;
  }
  return doc;
}

function _canon(value) {
  // We use plain JSON.stringify with a sorted-keys replacer here because
  // we don't need RFC 8785 strictness for the equivalence check — we just
  // need stability. The JCS module is used for signing, not equivalence.
  return JSON.stringify(value, Object.keys(value || {}).sort());
}

function _sha(s) {
  return require('crypto').createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 16);
}

module.exports = {
  roundTrip,
  RoundTripViolation,
};
