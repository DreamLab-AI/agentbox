'use strict';

/**
 * Privacy-filter middleware — ADR-008.
 *
 * Wraps adapter dispatch with a call to the local opf-router sidecar
 * (default http://127.0.0.1:9092) before the payload reaches any adapter
 * implementation. This is the second middleware layer in the canonical
 * three-layer stack:
 *
 *   1. Observability   (ADR-005 — observability/metrics.js wrapDispatch)
 *   2. Privacy filter  (ADR-008 — this file)          <── you are here
 *   3. JSON-LD encoder (ADR-012 — middleware/linked-data/encoder.js)
 *
 * DDD-004 §L08: privacy redaction completes before the encoder runs.
 *
 * Policy per slot (read from manifest [privacy_filter.policy]):
 *   strict  — call OPF; on error, reject the write (fail-closed, 503)
 *   soft    — call OPF; on error, allow the write (fail-open, warn + counter)
 *   off     — skip OPF entirely (pass-through)
 *
 * Fail-closed guard:
 *   When OPF_MODE ≠ "off" AND the sidecar is unreachable AND policy = strict,
 *   the write is rejected with AdapterWriteRejected. If OPF_MODE = "off",
 *   all policies behave as "off" regardless of manifest setting.
 *
 * Metrics emitted:
 *   opf_requests_total{slot,op}
 *   opf_redactions_total{slot}
 *   opf_latency_ms_sum / opf_latency_ms_count
 *   opf_fail_closed_total{slot}
 *   opf_fail_open_total{slot}
 *
 * Middleware-order assertion:
 *   On module load, the ordering invariant is written to an in-process
 *   symbol so that the wrapDispatch caller can assert it. A
 *   MiddlewareOrderViolation is emitted to stderr if the encoder is wired
 *   before this module has been applied.
 */

const promClient = require('prom-client');

// ---------------------------------------------------------------------------
// Prometheus counters/histograms (registered on the default register so they
// merge with the existing agentbox registry without requiring a ref pass-in).
// ---------------------------------------------------------------------------

let _countersBootstrapped = false;
let opfRequestsTotal,
    opfRedactionsTotal,
    opfLatencyMsHistogram,
    opfFailClosedTotal,
    opfFailOpenTotal,
    opfMiddlewareOrderViolations;

function _bootstrapCounters() {
  if (_countersBootstrapped) return;
  _countersBootstrapped = true;

  opfRequestsTotal = new promClient.Counter({
    name: 'opf_requests_total',
    help: 'Total OPF redaction requests by slot and operation',
    labelNames: ['slot', 'op'],
  });
  opfRedactionsTotal = new promClient.Counter({
    name: 'opf_redactions_total',
    help: 'Total PII entities redacted by slot',
    labelNames: ['slot'],
  });
  opfLatencyMsHistogram = new promClient.Histogram({
    name: 'opf_latency_ms',
    help: 'OPF /redact round-trip latency in milliseconds',
    labelNames: ['slot', 'op'],
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000],
  });
  opfFailClosedTotal = new promClient.Counter({
    name: 'opf_fail_closed_total',
    help: 'Writes rejected because OPF was unreachable and policy=strict',
    labelNames: ['slot'],
  });
  opfFailOpenTotal = new promClient.Counter({
    name: 'opf_fail_open_total',
    help: 'Writes allowed despite OPF failure because policy=soft',
    labelNames: ['slot'],
  });
  opfMiddlewareOrderViolations = new promClient.Counter({
    name: 'opf_middleware_order_violations_total',
    help: 'Number of times the middleware was wired in the wrong order',
    labelNames: ['slot'],
  });
}

// In-process sentinel — set to true once this module has been required.
// The LinkedDataEncoder checks for it at dispatch time.
const PRIVACY_FILTER_APPLIED_KEY = Symbol.for('agentbox.privacyFilterApplied');
global[PRIVACY_FILTER_APPLIED_KEY] = true;

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

class AdapterWriteRejected extends Error {
  constructor(slot, reason) {
    super(`AdapterWriteRejected[${slot}]: ${reason}`);
    this.name = 'AdapterWriteRejected';
    this.slot = slot;
    this.statusCode = 503;
  }
}

// ---------------------------------------------------------------------------
// Default slot policy table (matches ADR-008 §Manifest contract defaults)
// ---------------------------------------------------------------------------

const DEFAULT_POLICY = {
  pods:         'strict',
  memory:       'strict',
  events:       'soft',
  beads:        'soft',
  orchestrator: 'off',
};

// ---------------------------------------------------------------------------
// Module-level config (re-read per call so hot-reload / test override works)
// ---------------------------------------------------------------------------

function _opfEndpoint() {
  return process.env.OPF_ENDPOINT || 'http://127.0.0.1:9092';
}

function _opfMode() {
  return (process.env.OPF_MODE || 'off').toLowerCase();
}

/**
 * Resolve the effective policy for a slot.
 *
 * @param {string} slot
 * @param {object|null} manifest
 * @returns {'strict'|'soft'|'off'}
 */
function _slotPolicy(slot, manifest) {
  if (_opfMode() === 'off') return 'off';

  const policy = (manifest && manifest.privacy_filter && manifest.privacy_filter.policy) || {};
  const resolved = policy[slot] || DEFAULT_POLICY[slot] || 'off';
  return resolved;
}

// ---------------------------------------------------------------------------
// Core redaction call
// ---------------------------------------------------------------------------

/**
 * Detect the argument shape of a write call.
 *
 * Two call conventions exist in the codebase:
 *
 *   A) Object convention (routes layer):
 *        fn({ key, value, namespace, ... })    — single object argument
 *
 *   B) Positional convention (adapter interface):
 *        fn(key, value, namespace)             — positional strings
 *
 * We distinguish by checking whether args[0] is a plain object with a
 * `value` property (convention A) or a string/primitive (convention B).
 *
 * @param {Array} args
 * @returns {'object'|'positional'}
 */
function _callConvention(args) {
  const first = args[0];
  if (first !== null && typeof first === 'object' && 'value' in first) return 'object';
  return 'positional';
}

/**
 * Serialise text content from a write call's arguments for redaction.
 *
 * @param {Array} args  - full args array passed to the adapter method
 * @returns {string}
 */
function _extractText(args) {
  if (_callConvention(args) === 'object') {
    const payload = args[0];
    return typeof payload.value === 'string' ? payload.value : JSON.stringify(payload.value);
  }
  // Positional: args = [key, value, namespace?]
  // The value is always the second argument.
  const value = args[1];
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Rebuild the args array with the redacted text substituted in.
 *
 * @param {Array} args      - original args
 * @param {string} redacted - text returned by OPF
 * @returns {Array}
 */
function _substituteRedacted(args, redacted) {
  if (_callConvention(args) === 'object') {
    return [{ ...args[0], value: redacted }, ...args.slice(1)];
  }
  // Positional: replace args[1] (value)
  const newArgs = [...args];
  newArgs[1] = redacted;
  return newArgs;
}

/**
 * Call the OPF sidecar. Returns { redactedText, replacedCount } or throws.
 *
 * @param {string} text
 * @param {string} slot
 * @param {string} op
 * @returns {Promise<{redactedText: string, replacedCount: number}>}
 */
async function _callOpf(text, slot, op) {
  const endpoint = `${_opfEndpoint()}/redact`;
  const body = JSON.stringify({ text, slot });

  const t0 = Date.now();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(5000),
  });
  const latency = Date.now() - t0;

  opfLatencyMsHistogram.labels(slot, op).observe(latency);
  opfRequestsTotal.labels(slot, op).inc();

  if (!response.ok) {
    throw new Error(`OPF returned HTTP ${response.status}`);
  }

  const data = await response.json();
  const replacedCount = Array.isArray(data.replaced) ? data.replaced.length : 0;
  if (replacedCount > 0) {
    opfRedactionsTotal.labels(slot).inc(replacedCount);
  }
  return { redactedText: data.text, replacedCount };
}

// ---------------------------------------------------------------------------
// Middleware assertion — MiddlewareOrderViolation
// ---------------------------------------------------------------------------

/**
 * Assert that the privacy filter was applied before the JSON-LD encoder.
 * Call this from the encoder's dispatch path.
 *
 * Emits MiddlewareOrderViolation to stderr and increments the violation
 * counter if the filter sentinel is absent.
 *
 * @param {string} slot
 * @param {object|null} logger  - optional pino-compatible logger
 */
function assertPrivacyFilterApplied(slot, logger) {
  if (_opfMode() === 'off') return; // nothing to assert when filter is off
  if (global[PRIVACY_FILTER_APPLIED_KEY] === true) return;

  const msg = `MiddlewareOrderViolation: JSON-LD encoder invoked for slot="${slot}" but privacy-filter middleware has not been applied. Canonical order: observability → privacy → encoder. Fix: ensure middleware/privacy-filter.js is required before middleware/linked-data/encoder.js in the dispatch wrapper.`;
  process.stderr.write(JSON.stringify({
    event: 'MiddlewareOrderViolation',
    slot,
    ts: new Date().toISOString(),
    msg,
  }) + '\n');

  if (_countersBootstrapped) {
    opfMiddlewareOrderViolations.labels(slot).inc();
  }
}

// ---------------------------------------------------------------------------
// Main export: wrapWithPrivacyFilter
// ---------------------------------------------------------------------------

/**
 * Wrap an adapter dispatch function with OPF privacy-filter redaction.
 *
 * This wraps the *adapter call*, not the Fastify request. It is applied
 * as the second layer in wrapDispatch (after observability, before encoder).
 *
 * @param {string} slot        - Adapter slot name
 * @param {string} methodName  - Adapter method name (for metrics)
 * @param {Function} fn        - The adapter method to wrap: (...args) => Promise
 * @param {object|null} manifest - Parsed agentbox.toml (may be null)
 * @returns {Function}         - Wrapped function
 */
function wrapWithPrivacyFilter(slot, methodName, fn, manifest) {
  _bootstrapCounters();

  const WRITE_OPS = new Set(['store', 'write', 'create', 'publish', 'append', 'emit']);
  const isWriteOp = WRITE_OPS.has(methodName);

  return async function privacyFilteredDispatch(...args) {
    const policy = _slotPolicy(slot, manifest);

    // Pass-through: not a write, or policy is off, or OPF_MODE=off
    if (!isWriteOp || policy === 'off') {
      return fn(...args);
    }

    // Extract text from the arguments (handles both object and positional conventions)
    const text = _extractText(args);

    let finalArgs = args;

    try {
      const { redactedText } = await _callOpf(text, slot, methodName);
      finalArgs = _substituteRedacted(args, redactedText);
    } catch (opfErr) {
      if (policy === 'strict') {
        opfFailClosedTotal.labels(slot).inc();
        process.stderr.write(JSON.stringify({
          event: 'opf_fail_closed',
          slot,
          method: methodName,
          error: opfErr.message,
          ts: new Date().toISOString(),
        }) + '\n');
        throw new AdapterWriteRejected(
          slot,
          `OPF sidecar unreachable and policy=strict: ${opfErr.message}`,
        );
      }

      // soft: fail-open
      opfFailOpenTotal.labels(slot).inc();
      process.stderr.write(JSON.stringify({
        event: 'opf_fail_open',
        slot,
        method: methodName,
        error: opfErr.message,
        ts: new Date().toISOString(),
      }) + '\n');
      // continue with original args
    }

    return fn(...finalArgs);
  };
}

module.exports = {
  wrapWithPrivacyFilter,
  assertPrivacyFilterApplied,
  AdapterWriteRejected,
  PRIVACY_FILTER_APPLIED_KEY,
  DEFAULT_POLICY,
};
