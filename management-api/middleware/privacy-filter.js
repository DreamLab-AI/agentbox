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

const crypto = require('node:crypto');
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
    opfMiddlewareOrderViolations,
    opfIdentifierPii,
    opfShapeErrors;

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
  // ADR-2005: personal data found in a field the filter screens but must not
  // rewrite (a key, URN or namespace). Distinct from a redaction, because the
  // write is rejected/flagged rather than silently altered.
  opfIdentifierPii = new promClient.Counter({
    name: 'opf_identifier_pii_total',
    help: 'Fields carrying personal data that the filter must not rewrite',
    labelNames: ['slot'],
  });
  // ADR-2005: the redactor's response could not be mapped back onto the fields
  // it was given, so no result was applied.
  opfShapeErrors = new promClient.Counter({
    name: 'opf_redaction_shape_errors_total',
    help: 'Redactor responses that could not be mapped back onto their fields',
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
 * ---------------------------------------------------------------------------
 * MUTATION COVERAGE AND FIELD ROLES — ADR-2005
 * ---------------------------------------------------------------------------
 *
 * The previous revision recognised six write names (store/write/create/publish/
 * append/emit) and sanitised only `args[0].value`. The estate review reproduced
 * the consequences: `createEpic` was not a write at all, so its title reached
 * the adapter unfiltered; `key` and `metadata` text passed through untouched on
 * a call that WAS filtered; and an object `value` came back as a JSON string,
 * so the adapter received a different type from the one the caller passed.
 *
 * WHAT COUNTS AS A MUTATION. An exact-name set plus a camelCase PREFIX rule, so
 * a method named `<verb><Noun>` (createEpic, storeSnapshot, publishDigest,
 * updateBead) is covered without having to enumerate every noun. Read methods
 * (get/list/query/search/fetch/read/resolve/health) are never mutations.
 *
 * FIELD ROLES. Every string reachable in the call's arguments is given one of
 * three roles, and the role decides what happens to it:
 *
 *   content       REDACTED in place. The redacted text replaces the original
 *                 leaf, so a string field stays a string and an object field
 *                 stays an object of the same shape — the type-preservation
 *                 requirement. Nested strings inside `metadata`, `labels` and
 *                 an object `value` are content leaves in their own right.
 *
 *   identifier    SCREENED, never rewritten. Rewriting a key or a URN would
 *                 silently change what the record is addressed by and break
 *                 every later read, so the filter does not do it. Instead the
 *                 identifier is sent for inspection and, if the redactor comes
 *                 back with it changed (i.e. it contained PII), the write is
 *                 REJECTED under a strict policy and allowed-with-a-counter
 *                 under a soft one. PII in a key is a fault to fix at the
 *                 caller, not something to paper over in the middleware.
 *
 *   unclassified  Any other string. SCREENED like an identifier — the default
 *                 is fail-closed on discovery rather than silent rewriting, so
 *                 a new payload field cannot quietly become an exfiltration
 *                 path just because nobody added it to the table below.
 *
 * ONE ROUND TRIP. All leaves of all roles travel in a single /redact call,
 * joined by a per-call random delimiter, and the response must split back into
 * exactly the same number of segments. A response that does not is a
 * RedactionShapeError, which is handled by the SAME policy branch as an
 * unreachable sidecar (strict → reject, soft → fail-open) rather than being
 * applied blindly.
 */

// Exact method names that mutate durable state.
const MUTATION_METHODS = new Set([
  'store', 'write', 'create', 'publish', 'append', 'emit', 'update', 'upsert',
  'put', 'patch', 'insert', 'add', 'post', 'send', 'delete', 'remove', 'destroy',
]);

// `<verb><Noun>` forms — createEpic, storeSnapshot, publishDigest, updateBead …
const MUTATION_PREFIXES = [
  'store', 'write', 'create', 'publish', 'append', 'emit', 'update', 'upsert',
  'put', 'patch', 'insert', 'add', 'post', 'send', 'delete', 'remove', 'destroy',
];

// Read verbs, listed so a future prefix addition cannot accidentally capture one.
const READ_PREFIXES = ['get', 'list', 'query', 'search', 'fetch', 'read', 'resolve', 'count', 'has', 'health', 'stat'];

/**
 * True when `methodName` mutates durable state and therefore must be filtered.
 *
 * @param {string} methodName
 * @returns {boolean}
 */
function isMutationMethod(methodName) {
  const name = String(methodName || '');
  if (MUTATION_METHODS.has(name)) return true;
  for (const p of READ_PREFIXES) {
    if (name.startsWith(p) && (name.length === p.length || /[A-Z_]/.test(name[p.length]))) return false;
  }
  for (const p of MUTATION_PREFIXES) {
    if (name.startsWith(p) && name.length > p.length && /[A-Z_]/.test(name[p.length])) return true;
  }
  return false;
}

// Field-name roles. Matching is on the leaf's OWN key, case-insensitively, at
// any depth — `metadata.note` is content because `note` is content, and it is
// also reached because `metadata` is content.
const CONTENT_FIELDS = new Set([
  'value', 'values', 'text', 'content', 'body', 'title', 'summary', 'description',
  'note', 'notes', 'message', 'comment', 'prompt', 'response', 'payload', 'data',
  'metadata', 'meta', 'labels', 'tags', 'context', 'detail', 'details', 'reason',
  'transcript', 'excerpt', 'snippet', 'question', 'answer',
]);
const IDENTIFIER_FIELDS = new Set([
  'key', 'id', 'uri', 'urn', 'url', 'namespace', 'ns', 'slot', 'name', 'type',
  'kind', 'collection', 'bucket', 'path', 'pubkey', 'did', 'epic', 'parent', 'ref',
]);

const MAX_LEAF_DEPTH = 8;

/**
 * Role for a field name, given the role inherited from its parent.
 * A string inside a content container is content even if its own key is not
 * listed — that is what makes `metadata: { note: "…" }` redactable.
 *
 * @param {string|number|null} key
 * @param {'content'|'identifier'|'unclassified'} inherited
 * @returns {'content'|'identifier'|'unclassified'}
 */
function roleFor(key, inherited) {
  if (inherited === 'content') return 'content';
  if (typeof key === 'number') return inherited;
  const k = String(key || '').toLowerCase();
  if (CONTENT_FIELDS.has(k)) return 'content';
  if (IDENTIFIER_FIELDS.has(k)) return 'identifier';
  return inherited === 'identifier' ? 'identifier' : 'unclassified';
}

/**
 * Walk a call's arguments and collect every non-empty string leaf with its
 * path and role. Cycles and over-deep structures are refused rather than
 * silently truncated: an un-walkable payload is reported to the policy branch.
 *
 * @param {Array} args
 * @param {string} methodName
 * @returns {{leaves: Array<{path: Array, role: string, text: string}>, truncated: boolean}}
 */
function collectLeaves(args, methodName) {
  const leaves = [];
  let truncated = false;
  const seen = new WeakSet();

  const walk = (node, path, inherited, depth) => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') {
      if (node !== '') leaves.push({ path, role: inherited, text: node });
      return;
    }
    if (typeof node !== 'object') return;              // numbers/booleans carry no free text
    if (depth >= MAX_LEAF_DEPTH) { truncated = true; return; }
    if (seen.has(node)) { truncated = true; return; }
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, [...path, i], inherited, depth + 1));
      return;
    }
    if (Buffer.isBuffer && Buffer.isBuffer(node)) return;
    for (const [k, v] of Object.entries(node)) {
      walk(v, [...path, k], roleFor(k, inherited), depth + 1);
    }
  };

  // Positional convention — fn(key, value, namespace) — has no field names, so
  // the roles come from the adapter interface's own argument order.
  const positional = _callConvention(args) === 'positional';
  args.forEach((arg, i) => {
    const inherited = positional
      ? (i === 1 ? 'content' : 'identifier')
      : (i === 0 ? 'unclassified' : 'identifier');
    walk(arg, [i], inherited, 0);
  });
  return { leaves, truncated, method: methodName };
}

/**
 * Copy-on-write setter: returns a new root with `path` replaced, sharing every
 * untouched subtree and preserving array-ness and prototypes so the adapter
 * receives the same types the caller passed.
 *
 * @param {*} root
 * @param {Array} path
 * @param {*} value
 * @returns {*}
 */
function setIn(root, path, value) {
  if (path.length === 0) return value;
  const [k, ...rest] = path;
  if (Array.isArray(root)) {
    const copy = root.slice();
    copy[k] = setIn(root[k], rest, value);
    return copy;
  }
  const copy = Object.assign(Object.create(Object.getPrototypeOf(root) || Object.prototype), root);
  copy[k] = setIn(root[k], rest, value);
  return copy;
}

/**
 * Rebuild the args array with the redacted text written back into every
 * `content` leaf. Identifier and unclassified leaves are left exactly as the
 * caller wrote them — they were screened, not rewritten.
 *
 * @param {Array} args
 * @param {Array} leaves    from collectLeaves()
 * @param {string[]} redacted  same length as `leaves`
 * @returns {Array}
 */
function applyRedactions(args, leaves, redacted) {
  let next = args.slice();
  leaves.forEach((leaf, i) => {
    if (leaf.role !== 'content') return;
    if (redacted[i] === leaf.text) return;
    const [argIndex, ...rest] = leaf.path;
    next[argIndex] = setIn(next[argIndex], rest, redacted[i]);
  });
  return next;
}

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
 * We distinguish by checking whether args[0] is a plain object (convention A)
 * or a string/primitive (convention B). The previous revision additionally
 * required a `value` property, so an object payload without one — the shape
 * `emit({type, data})` uses — was misread as positional and its text was never
 * extracted at all.
 *
 * @param {Array} args
 * @returns {'object'|'positional'}
 */
function _callConvention(args) {
  const first = args[0];
  if (first !== null && typeof first === 'object' && !Array.isArray(first)) return 'object';
  return 'positional';
}

/**
 * Raised when the redactor's response cannot be mapped back onto the fields it
 * was given. Treated exactly like an unreachable sidecar: the policy decides.
 */
class RedactionShapeError extends Error {
  constructor(detail) {
    super(`RedactionShapeError: ${detail}`);
    this.name = 'RedactionShapeError';
  }
}

/**
 * Raised (and converted to AdapterWriteRejected by the caller) when a field the
 * filter must not rewrite — a key, a URN, a namespace — came back from the
 * redactor changed, i.e. it contained PII.
 */
class IdentifierPiiDetected extends Error {
  constructor(slot, fields) {
    super(
      `IdentifierPiiDetected[${slot}]: personal data found in field(s) `
      + `${fields.join(', ')}, which the privacy filter must not rewrite because `
      + `doing so would silently change how the record is addressed. Remove the `
      + `personal data at the caller.`,
    );
    this.name = 'IdentifierPiiDetected';
    this.slot = slot;
    this.fields = fields;
  }
}

// Per-call delimiter: 16 random bytes, regenerated for every dispatch, so a
// payload cannot plausibly contain it and earlier content cannot predict it.
function _fieldDelimiter() {
  return `--OPF-FIELD-${crypto.randomBytes(16).toString('hex')}--`;
}

/**
 * Call the OPF sidecar once for every field of a dispatch.
 *
 * The fields are joined by a per-call random delimiter and the response must
 * split back into exactly the same number of segments; anything else is a
 * RedactionShapeError, which the policy branch handles like an unreachable
 * sidecar rather than applying a mangled result.
 *
 * @param {string[]} texts
 * @param {string} slot
 * @param {string} op
 * @returns {Promise<{redacted: string[], replacedCount: number}>}
 */
async function _callOpfFields(texts, slot, op) {
  const delimiter = _fieldDelimiter();
  const joined = texts.join(delimiter);
  const endpoint = `${_opfEndpoint()}/redact`;
  const body = JSON.stringify({ text: joined, slot });

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

  let data;
  try { data = await response.json(); }
  catch (e) { throw new RedactionShapeError(`response body is not JSON: ${e && e.message}`); }

  if (typeof data.text !== 'string') {
    throw new RedactionShapeError('response has no "text" string');
  }
  const parts = data.text.split(delimiter);
  if (parts.length !== texts.length) {
    throw new RedactionShapeError(
      `redactor returned ${parts.length} field(s) for ${texts.length} sent — the `
      + 'field delimiter did not survive redaction, so no result can be safely applied',
    );
  }

  const replacedCount = Array.isArray(data.replaced) ? data.replaced.length : 0;
  if (replacedCount > 0) {
    opfRedactionsTotal.labels(slot).inc(replacedCount);
  }
  return { redacted: parts, replacedCount };
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
 * Behaviour per policy (ADR-2005):
 *
 *   off     nothing is sent; the payload is marked as having traversed the
 *           layer and passed through unchanged.
 *   soft    the redactor is called; ANY failure — unreachable sidecar, HTTP
 *           error, unparseable response, a response whose fields cannot be
 *           mapped back, or personal data found in an identifier — allows the
 *           write with the ORIGINAL payload and increments opf_fail_open_total.
 *   strict  the same failures REJECT the write with AdapterWriteRejected and
 *           increment opf_fail_closed_total. The adapter is never called.
 *
 * In every case the value the adapter receives keeps the type the caller
 * passed: a string field stays a string, an object field stays an object of
 * the same shape with its string leaves redacted in place.
 *
 * @param {string} slot        - Adapter slot name
 * @param {string} methodName  - Adapter method name (for metrics)
 * @param {Function} fn        - The adapter method to wrap: (...args) => Promise
 * @param {object|null} manifest - Parsed agentbox.toml (may be null)
 * @returns {Function}         - Wrapped function
 */
function wrapWithPrivacyFilter(slot, methodName, fn, manifest) {
  _bootstrapCounters();

  const isMutation = isMutationMethod(methodName);

  return async function privacyFilteredDispatch(...args) {
    const policy = _slotPolicy(slot, manifest);

    // Pass-through: not a mutation, or policy is off, or OPF_MODE=off.
    // We still stamp the value so a downstream encoder sees that the privacy
    // layer was traversed on this dispatch (an intentional pass-through is
    // distinct from a layer bypass — DDD-004 §L08).
    if (!isMutation || policy === 'off') {
      _markValueArg(args);
      return fn(...args);
    }

    // Fail the dispatch through the policy branch rather than silently
    // allowing it: `reason` carries what went wrong, `fail` applies the policy.
    const fail = (reason, err) => {
      if (policy === 'strict') {
        opfFailClosedTotal.labels(slot).inc();
        process.stderr.write(JSON.stringify({
          event: 'opf_fail_closed', slot, method: methodName, error: reason,
          ts: new Date().toISOString(),
        }) + '\n');
        throw new AdapterWriteRejected(slot, reason);
      }
      opfFailOpenTotal.labels(slot).inc();
      process.stderr.write(JSON.stringify({
        event: 'opf_fail_open', slot, method: methodName, error: reason,
        ts: new Date().toISOString(),
      }) + '\n');
      return err;   // soft: caller continues with the original args
    };

    const { leaves, truncated } = collectLeaves(args, methodName);

    if (truncated) {
      // A cyclic or over-deep payload cannot be fully inspected, so the filter
      // cannot claim it redacted the payload. Under strict that is a rejection.
      fail('payload could not be fully traversed (cycle or depth limit) — redaction cannot be guaranteed');
    }

    if (leaves.length === 0) {
      _markValueArg(args);
      return fn(...args);
    }

    let finalArgs = args;
    try {
      const { redacted } = await _callOpfFields(leaves.map((l) => l.text), slot, methodName);

      // Identifier and unclassified fields are screened, never rewritten: a
      // change means the redactor found personal data in a field the filter
      // must not alter (see the FIELD ROLES note above).
      const dirty = leaves
        .map((l, i) => ({ l, i }))
        .filter(({ l, i }) => l.role !== 'content' && redacted[i] !== l.text)
        .map(({ l }) => l.path.join('.'));

      if (dirty.length) {
        _bootstrapCounters();
        opfIdentifierPii.labels(slot).inc(dirty.length);
        const err = new IdentifierPiiDetected(slot, dirty);
        fail(err.message, err);
      } else {
        finalArgs = applyRedactions(args, leaves, redacted);
      }
    } catch (opfErr) {
      if (opfErr instanceof AdapterWriteRejected) throw opfErr;
      if (opfErr instanceof RedactionShapeError) {
        _bootstrapCounters();
        opfShapeErrors.labels(slot).inc();
      }
      fail(opfErr.message, opfErr);
      // soft: continue with the original args
    }

    // Stamp the value the encoder will see as having traversed the privacy
    // layer on this dispatch (redacted, or soft-fail-open original).
    _markValueArg(finalArgs);
    return fn(...finalArgs);
  };
}

/**
 * Stamp the privacy marker onto every object the encoder might treat as the
 * payload: the container argument, its `value` when that is an object, and —
 * for the positional convention — the value at args[1]. Marking all of them
 * keeps the L08 assertion true whichever object the encoder inspects.
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
  RedactionShapeError,
  IdentifierPiiDetected,
  // ADR-2005 coverage surface: exported so the mutation set and the field-role
  // table can be asserted directly rather than inferred from behaviour.
  isMutationMethod,
  collectLeaves,
  applyRedactions,
  MUTATION_METHODS,
  CONTENT_FIELDS,
  IDENTIFIER_FIELDS,
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
