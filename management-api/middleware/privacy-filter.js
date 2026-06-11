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
 * Middleware-order assertion (DDD-004 §L08 — per-dispatch, not module-load):
 *   The privacy filter stamps every payload it has actually redacted (or
 *   deliberately passed through under an `off`/`soft`-bypass policy) by
 *   registering the live payload object in a module-level WeakSet
 *   (`_redactedPayloads`) AND writing a non-enumerable Symbol marker on it.
 *   `assertPrivacyFilterApplied(payload, slot)` then verifies that THIS
 *   specific payload carries the marker. A payload that reaches the encoder
 *   without having passed through wrapWithPrivacyFilter (e.g. a route calling
 *   adapter.write() directly, finding O2) is unmarked, so the assertion fires
 *   a MiddlewareOrderViolation, increments `opf_middleware_order_violations_total`,
 *   and — for fail-closed slots (pods/memory, ADR-008 §Fail-mode) — throws.
 *
 *   The marker is a Symbol (non-enumerable) plus an external WeakSet, so it
 *   never appears in JSON.stringify output and cannot leak into encoded
 *   JSON-LD. It is per-payload, so it cannot be globally forged once the
 *   module is loaded — the original O3 defect.
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

// Per-dispatch marker (DDD-004 §L08). This replaces the old module-load
// `global[...] = true` sentinel, which was always true after boot and so
// could never detect a bypass (finding O3).
//
// `PRIVACY_FILTER_APPLIED_KEY` is a non-enumerable Symbol stamped on each
// payload object the filter has processed. `_redactedPayloads` is a parallel
// WeakSet for payload types that cannot carry a property (or to keep the
// check robust against shallow-clone). Both are per-payload, so a payload
// that never went through the filter is unmarked even though the module is
// loaded process-wide.
const PRIVACY_FILTER_APPLIED_KEY = Symbol('agentbox.privacyFilterApplied');
const _redactedPayloads = new WeakSet();

// Slots whose privacy posture is fail-closed (ADR-008 §Fail-mode semantics).
// A middleware-order violation on these slots throws; on others it is logged
// and counted (fail-open), preserving the per-slot posture already documented.
const FAIL_CLOSED_SLOTS = new Set(['pods', 'memory']);

/**
 * Stamp a payload as having passed through the privacy filter on THIS
 * dispatch. The mark is invisible to JSON serialisation:
 *   - the Symbol property is non-enumerable, so JSON.stringify ignores it;
 *   - the WeakSet is external to the object entirely.
 *
 * @param {*} payload - the (possibly redacted) value object that will travel
 *                      onward to the encoder/adapter
 */
function _markPrivacyApplied(payload) {
  if (payload === null || (typeof payload !== 'object' && typeof payload !== 'function')) {
    return; // primitives carry no marker; encoder treats them as out-of-scope
  }
  try {
    _redactedPayloads.add(payload);
    Object.defineProperty(payload, PRIVACY_FILTER_APPLIED_KEY, {
      value: true,
      enumerable: false,
      configurable: true,
      writable: false,
    });
  } catch {
    // Frozen/sealed payloads still get the WeakSet entry above; ignore.
  }
}

/**
 * True iff `payload` carries the per-dispatch privacy marker.
 * @param {*} payload
 * @returns {boolean}
 */
function _hasPrivacyMark(payload) {
  if (payload === null || (typeof payload !== 'object' && typeof payload !== 'function')) {
    return false;
  }
  return _redactedPayloads.has(payload) || payload[PRIVACY_FILTER_APPLIED_KEY] === true;
}

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

class MiddlewareOrderViolation extends Error {
  constructor(slot, payloadType) {
    super(
      `MiddlewareOrderViolation[${slot}]: JSON-LD encoder invoked for a ` +
      `payload (${payloadType}) that did not pass through the privacy filter ` +
      `on this dispatch. Canonical order: observability → privacy → encoder ` +
      `(DDD-004 §L08). Route the payload through wrapWithPrivacyFilter before ` +
      `encoding.`,
    );
    this.name = 'MiddlewareOrderViolation';
    this.slot = slot;
    this.statusCode = 500;
  }
}

/**
 * Assert that THIS payload passed privacy redaction before reaching the
 * JSON-LD encoder. This is a per-dispatch check (DDD-004 §L08), not a
 * module-load sentinel: the payload itself must carry the marker stamped by
 * wrapWithPrivacyFilter on this dispatch.
 *
 * On a miss:
 *   - emits MiddlewareOrderViolation to stderr,
 *   - increments opf_middleware_order_violations_total{slot}, and
 *   - throws for fail-closed slots (pods/memory) per ADR-008 §Fail-mode;
 *     logs-and-continues (fail-open) for the rest, matching the per-slot
 *     posture already in force for OPF failures.
 *
 * @param {*}      payload - the value object about to be encoded
 * @param {string} slot
 * @param {object|null} logger  - optional pino-compatible logger
 * @throws {MiddlewareOrderViolation} for fail-closed slots when unmarked
 */
function assertPrivacyFilterApplied(payload, slot, logger) {
  if (_opfMode() === 'off') return; // nothing to assert when filter is off
  if (_hasPrivacyMark(payload)) return;

  const payloadType = payload === null ? 'null' : typeof payload;
  const msg = `MiddlewareOrderViolation: JSON-LD encoder invoked for slot="${slot}" with a payload that did not pass the privacy filter on this dispatch (per-dispatch L08 check). Canonical order: observability → privacy → encoder.`;
  process.stderr.write(JSON.stringify({
    event: 'MiddlewareOrderViolation',
    slot,
    payloadType,
    ts: new Date().toISOString(),
    msg,
  }) + '\n');
  (logger && logger.error) && logger.error({ event: 'MiddlewareOrderViolation', slot, payloadType });

  _bootstrapCounters();
  opfMiddlewareOrderViolations.labels(slot).inc();

  if (FAIL_CLOSED_SLOTS.has(slot)) {
    throw new MiddlewareOrderViolation(slot, payloadType);
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

    // Pass-through: not a write, or policy is off, or OPF_MODE=off.
    // We still stamp the value so a downstream encoder sees that the privacy
    // layer was traversed on this dispatch (an intentional pass-through is
    // distinct from a layer bypass — DDD-004 §L08).
    if (!isWriteOp || policy === 'off') {
      _markValueArg(args);
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

    // Stamp the value the encoder will see as having traversed the privacy
    // layer on this dispatch (redacted, or soft-fail-open original).
    _markValueArg(finalArgs);
    return fn(...finalArgs);
  };
}

/**
 * Stamp the privacy marker onto the value object inside a write call's args,
 * matching the call convention. For the object convention the encoder's
 * payload is args[0]; for the positional convention it is the value at
 * args[1]. Both the container and (if an object) the value itself are
 * marked so the encoder sees the mark regardless of which object it treats
 * as the payload.
 *
 * @param {Array} args - the args array about to be passed to the adapter fn
 */
function _markValueArg(args) {
  if (_callConvention(args) === 'object') {
    _markPrivacyApplied(args[0]);
    if (args[0] && typeof args[0].value === 'object') _markPrivacyApplied(args[0].value);
    return;
  }
  _markPrivacyApplied(args[1]);
}

module.exports = {
  wrapWithPrivacyFilter,
  assertPrivacyFilterApplied,
  AdapterWriteRejected,
  MiddlewareOrderViolation,
  PRIVACY_FILTER_APPLIED_KEY,
  DEFAULT_POLICY,
  FAIL_CLOSED_SLOTS,
  // Exposed for tests/encoder so a correctly-ordered caller that already ran
  // redaction out-of-band can stamp the payload it hands to the encoder.
  _markPrivacyApplied,
  _hasPrivacyMark,
  // Test helper: current value of opf_middleware_order_violations_total{slot}
  // on whatever register the counter was created against. Avoids the test
  // needing to resolve prom-client from a different node_modules root.
  // prom-client 15's Counter.get() is async, so this returns a Promise.
  async _violationCount(slot) {
    if (!_countersBootstrapped) return 0;
    const snapshot = await opfMiddlewareOrderViolations.get();
    const vals = (snapshot && snapshot.values) || [];
    const hit = vals.find((v) => v.labels && v.labels.slot === slot);
    return hit ? hit.value : 0;
  },
};
