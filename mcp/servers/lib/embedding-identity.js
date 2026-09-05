'use strict';
/**
 * embedding-identity.js — the EFFECTIVE model identity of the embedding
 * transport, and the pin that rejects an incompatible swap.
 *
 * ADR-2019 (384-dim freeze) closeout, 2026-09-05.
 *
 * The dimension check the entry point already performs (384) is necessary and
 * insufficient: `EMBEDDING_MODEL` is an environment override, and two different
 * 384-dimension models produce mutually meaningless geometry in the same
 * column. A corpus embedded with bge-small and queried with a different
 * 384-dim model returns confident nonsense — the failure has no error, only
 * silently wrong recall.
 *
 * The fix is an EFFECTIVE identity: embed a fixed probe text and fingerprint
 * the returned vector. That fingerprint is a property of the deployed model and
 * its preprocessing, not of the name in the environment — a renamed model, a
 * re-quantised checkpoint or a changed pooling strategy all move it, while a
 * restart of the same model does not. It is quantised before hashing so that
 * ordinary floating-point/backend jitter does not produce a false mismatch.
 *
 * Contract:
 *   • `config/embedding-identity.json` is the PIN. It records the accepted
 *     model name, dimension, preprocessing and fingerprint.
 *   • `verifyEmbeddingIdentity()` compares the live probe against the pin and
 *     returns a verdict. `ok:false` with `reason:'fingerprint-mismatch'` is an
 *     incompatible same-dimension change and MUST fail the caller closed.
 *   • With no pin file the verdict is `ok:true, state:'unpinned'` carrying the
 *     computed fingerprint, so an operator can freeze it deliberately rather
 *     than having a pin invented for them.
 *   • `RUVECTOR_EMBED_IDENTITY_OVERRIDE=<fingerprint>` accepts one specific
 *     divergent fingerprint for a supervised migration. A bare `true` is NOT
 *     accepted — an override must name what it is overriding to.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// The probe is FROZEN. Changing it changes every fingerprint, so it lives here
// as a constant rather than a configurable — a migration re-pins, never re-probes
// with different text.
const PROBE_TEXT = 'agentbox embedding identity probe v1: the quick brown fox jumps over the lazy dog.';
const PROBE_VERSION = 1;
const EXPECTED_DIM = 384;
// Quantisation: 4 decimal places absorbs backend/threading jitter while still
// separating genuinely different models by many orders of magnitude.
const QUANT_DECIMALS = 4;

const PIN_PATHS = [
  path.resolve(__dirname, '..', '..', '..', 'config', 'embedding-identity.json'),
  '/opt/agentbox/config/embedding-identity.json',
];

/** Quantise + hash a probe vector into a stable, comparable fingerprint. */
function fingerprintVector(vec) {
  if (!Array.isArray(vec) || vec.length === 0) throw new Error('fingerprintVector: empty vector');
  const q = vec.map((v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error('fingerprintVector: non-finite component');
    // Normalise -0 to 0 so the textual form is stable.
    const r = Number(n.toFixed(QUANT_DECIMALS));
    return Object.is(r, -0) ? 0 : r;
  });
  const digest = crypto.createHash('sha256').update(q.join(','), 'utf8').digest('hex');
  return `emb1-${vec.length}-${digest.slice(0, 16)}`;
}

/** The declared (name-level) identity — what the environment CLAIMS. */
function declaredIdentity(env = process.env) {
  return {
    model: env.EMBEDDING_MODEL || 'bge-small-en-v1.5',
    endpoint: env.XINFERENCE_ENDPOINT || 'http://xinference:9997',
    dim: EXPECTED_DIM,
    preprocessing: {
      // The store and the harness both embed at most this prefix; it is part of
      // the retrieval contract, so a change to it invalidates a recall receipt.
      embed_prefix_chars: 2000,
      normalisation: 'none (transport returns L2-normalised bge vectors)',
      probe_version: PROBE_VERSION,
      quant_decimals: QUANT_DECIMALS,
    },
  };
}

/** Read the pin, or null when unpinned. Never throws on a missing file. */
function readPin(paths = PIN_PATHS) {
  for (const p of paths) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object' && obj.fingerprint) return { ...obj, _path: p };
    } catch { /* next candidate */ }
  }
  return null;
}

/**
 * Probe the live transport and compute the effective identity.
 * @param {(text:string)=>Promise<number[]>} getEmbedding
 */
async function probeIdentity(getEmbedding, env = process.env) {
  const declared = declaredIdentity(env);
  const vec = await getEmbedding(PROBE_TEXT);
  if (!Array.isArray(vec)) throw new Error('embedding probe returned a non-array');
  return {
    ...declared,
    observed_dim: vec.length,
    fingerprint: fingerprintVector(vec),
    probed_at: new Date().toISOString(),
  };
}

/**
 * Compare a probed identity against the pin.
 * @returns {{ok:boolean, state:string, reason?:string, message?:string, effective:object, pin:object|null}}
 */
function compareToPin(effective, pin, env = process.env) {
  if (effective.observed_dim !== EXPECTED_DIM) {
    return {
      ok: false, state: 'rejected', reason: 'dimension-mismatch',
      message: `embedding dimension ${effective.observed_dim} != frozen ${EXPECTED_DIM} (ADR-2019 geometry freeze)`,
      effective, pin: pin || null,
    };
  }
  if (!pin) {
    return {
      ok: true, state: 'unpinned', effective, pin: null,
      message: `no embedding-identity pin found — freeze the current model by writing config/embedding-identity.json with fingerprint ${effective.fingerprint}`,
    };
  }
  if (pin.fingerprint === effective.fingerprint) {
    const renamed = pin.model && pin.model !== effective.model;
    return {
      ok: true, state: renamed ? 'accepted-renamed' : 'accepted', effective, pin,
      ...(renamed ? { message: `model name changed (${pin.model} → ${effective.model}) but the effective geometry is identical — accepted` } : {}),
    };
  }
  const override = String(env.RUVECTOR_EMBED_IDENTITY_OVERRIDE || '').trim();
  if (override && override === effective.fingerprint) {
    return {
      ok: true, state: 'override', effective, pin,
      reason: 'fingerprint-mismatch',
      message: `effective embedding identity ${effective.fingerprint} differs from the pin ${pin.fingerprint}; accepted ONLY because RUVECTOR_EMBED_IDENTITY_OVERRIDE names this exact fingerprint. The corpus geometry is now mixed until a re-embed and a passing recall run.`,
    };
  }
  return {
    ok: false, state: 'rejected', reason: 'fingerprint-mismatch',
    message:
      `INCOMPATIBLE embedding model: effective identity ${effective.fingerprint} ` +
      `(model="${effective.model}") does not match the pinned ${pin.fingerprint} ` +
      `(model="${pin.model}"). Dimensions agree (${EXPECTED_DIM}) — dimension agreement is NOT compatibility. ` +
      `Re-embed the corpus and re-pin, or set RUVECTOR_EMBED_IDENTITY_OVERRIDE=${effective.fingerprint} for a supervised migration.`,
    effective, pin,
  };
}

/**
 * Probe + compare in one call. Any transport error is returned as an explicit
 * `unavailable` verdict rather than being confused with a mismatch.
 */
async function verifyEmbeddingIdentity(getEmbedding, opts = {}) {
  const env = opts.env || process.env;
  const pin = opts.pin !== undefined ? opts.pin : readPin(opts.pinPaths);
  let effective;
  try {
    effective = await probeIdentity(getEmbedding, env);
  } catch (e) {
    return {
      ok: true, state: 'unavailable', reason: 'probe-failed',
      message: `embedding identity could not be probed: ${(e && e.message) || e}`,
      effective: { ...declaredIdentity(env), fingerprint: null },
      pin: pin || null,
    };
  }
  return compareToPin(effective, pin, env);
}

module.exports = {
  PROBE_TEXT, PROBE_VERSION, EXPECTED_DIM, QUANT_DECIMALS, PIN_PATHS,
  fingerprintVector, declaredIdentity, readPin, probeIdentity,
  compareToPin, verifyEmbeddingIdentity,
};
