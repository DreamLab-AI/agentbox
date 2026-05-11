'use strict';

/**
 * Linked-Data surface input validator — P2-10 hardening.
 *
 * Centralised pre-encode validation for all surface payloads. Runs inside
 * LinkedDataEncoder.dispatch() and encodeStandalone() *before* the surface
 * encode() function is called. Rejects:
 *
 *   1. Non-object / null / array payloads (surfaces expect a plain object).
 *   2. Payloads whose serialised size exceeds the configurable byte limit
 *      (default 1 MB). This prevents memory exhaustion from oversized input.
 *   3. Payloads carrying an @context that references IRIs not in the pinned
 *      catalogue (when the resolver operates in fail-closed mode).
 *   4. Payloads with string values exceeding a per-value length cap to
 *      prevent individual field abuse.
 *   5. Payloads nested beyond a reasonable depth (default 32 levels).
 *
 * Error classes are exported so callers can pattern-match on rejection type.
 */

// ── Limits ──────────────────────────────────────────────────────────────────

const DEFAULT_MAX_PAYLOAD_BYTES = 1 * 1024 * 1024;      // 1 MB
const DEFAULT_MAX_STRING_LENGTH = 256 * 1024;            // 256 KB per string value
const DEFAULT_MAX_DEPTH         = 32;
const DEFAULT_MAX_KEYS          = 1000;

// ── Error classes ───────────────────────────────────────────────────────────

class InputValidationError extends Error {
  /**
   * @param {string} code - machine-readable code (e.g. 'PAYLOAD_NOT_OBJECT')
   * @param {string} message - human-readable description
   * @param {string} [surface] - surface id that was targeted
   */
  constructor(code, message, surface) {
    super(message);
    this.name = 'InputValidationError';
    this.code = code;
    this.surface = surface || null;
  }
}

class PayloadTooLargeError extends InputValidationError {
  constructor(byteLength, limit, surface) {
    super(
      'PAYLOAD_TOO_LARGE',
      `Payload size ${byteLength} bytes exceeds limit of ${limit} bytes`,
      surface,
    );
    this.byteLength = byteLength;
    this.limit = limit;
  }
}

// ── Validation functions ────────────────────────────────────────────────────

/**
 * Validate a surface payload before encode(). Throws InputValidationError
 * on any violation.
 *
 * @param {*} payload - the raw payload to validate
 * @param {object} opts
 * @param {string} [opts.surfaceId] - surface id for error reporting
 * @param {object} [opts.resolver] - ContextResolver instance (for @context checks)
 * @param {number} [opts.maxPayloadBytes] - override for the byte-size limit
 * @param {number} [opts.maxStringLength] - override for per-string-value limit
 * @param {number} [opts.maxDepth] - override for nesting depth limit
 * @param {number} [opts.maxKeys] - override for total key count
 */
function validatePayload(payload, opts = {}) {
  const surfaceId       = opts.surfaceId || null;
  const maxPayloadBytes = opts.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  const maxStringLength = opts.maxStringLength ?? DEFAULT_MAX_STRING_LENGTH;
  const maxDepth        = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxKeys         = opts.maxKeys ?? DEFAULT_MAX_KEYS;
  const resolver        = opts.resolver || null;

  // ── 1. Type check ──────────────────────────────────────────────────────
  if (payload === null || payload === undefined) {
    throw new InputValidationError(
      'PAYLOAD_REQUIRED',
      'Surface payload must be a non-null object',
      surfaceId,
    );
  }

  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new InputValidationError(
      'PAYLOAD_NOT_OBJECT',
      `Surface payload must be a plain object, got ${Array.isArray(payload) ? 'array' : typeof payload}`,
      surfaceId,
    );
  }

  // ── 2. Size check ─────────────────────────────────────────────────────
  // JSON.stringify is the cheapest way to measure the serialised footprint
  // without pulling in a streaming sizer. For payloads near the limit this
  // is O(n) in payload size, which is acceptable since encode() would do
  // at least as much work.
  let serialised;
  try {
    serialised = JSON.stringify(payload);
  } catch (err) {
    throw new InputValidationError(
      'PAYLOAD_NOT_SERIALISABLE',
      `Payload cannot be serialised to JSON: ${err.message}`,
      surfaceId,
    );
  }

  const byteLength = Buffer.byteLength(serialised, 'utf8');
  if (byteLength > maxPayloadBytes) {
    throw new PayloadTooLargeError(byteLength, maxPayloadBytes, surfaceId);
  }

  // ── 3. Structural checks (depth, key count, string length) ────────────
  _walkStructure(payload, {
    surfaceId,
    maxDepth,
    maxKeys,
    maxStringLength,
    currentDepth: 0,
    keyCount: { value: 0 },
  });

  // ── 4. @context validation ────────────────────────────────────────────
  if (resolver && payload['@context']) {
    _validateContext(payload['@context'], resolver, surfaceId);
  }
}

/**
 * Recursively walk the payload to enforce depth, key count, and string
 * length constraints.
 */
function _walkStructure(value, ctx) {
  if (value === null || value === undefined) return;

  if (ctx.currentDepth > ctx.maxDepth) {
    throw new InputValidationError(
      'PAYLOAD_TOO_DEEP',
      `Payload nesting depth exceeds limit of ${ctx.maxDepth}`,
      ctx.surfaceId,
    );
  }

  if (typeof value === 'string') {
    if (value.length > ctx.maxStringLength) {
      throw new InputValidationError(
        'STRING_TOO_LONG',
        `String value length ${value.length} exceeds limit of ${ctx.maxStringLength}`,
        ctx.surfaceId,
      );
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      _walkStructure(item, {
        ...ctx,
        currentDepth: ctx.currentDepth + 1,
      });
    }
    return;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    ctx.keyCount.value += keys.length;
    if (ctx.keyCount.value > ctx.maxKeys) {
      throw new InputValidationError(
        'TOO_MANY_KEYS',
        `Total key count ${ctx.keyCount.value} exceeds limit of ${ctx.maxKeys}`,
        ctx.surfaceId,
      );
    }
    for (const k of keys) {
      _walkStructure(value[k], {
        ...ctx,
        currentDepth: ctx.currentDepth + 1,
      });
    }
  }
}

/**
 * Validate that @context IRIs (when present) are resolvable by the
 * pinned catalogue. Only applies when the resolver is in fail-closed mode
 * and the payload explicitly sets @context.
 */
function _validateContext(contextValue, resolver, surfaceId) {
  const contexts = Array.isArray(contextValue) ? contextValue : [contextValue];

  for (const ctx of contexts) {
    if (typeof ctx === 'string') {
      // String context = IRI reference. Check the catalogue.
      const resolved = resolver.tryResolve(ctx);
      if (!resolved) {
        throw new InputValidationError(
          'UNKNOWN_CONTEXT_IRI',
          `@context IRI '${ctx}' is not in the pinned catalogue`,
          surfaceId,
        );
      }
    } else if (ctx !== null && typeof ctx === 'object') {
      // Inline context object — allowed, but check nested IRI references
      // within @import if present.
      if (typeof ctx['@import'] === 'string') {
        const resolved = resolver.tryResolve(ctx['@import']);
        if (!resolved) {
          throw new InputValidationError(
            'UNKNOWN_CONTEXT_IRI',
            `@context @import IRI '${ctx['@import']}' is not in the pinned catalogue`,
            surfaceId,
          );
        }
      }
    } else if (ctx !== null) {
      throw new InputValidationError(
        'INVALID_CONTEXT_TYPE',
        `@context entries must be strings or objects, got ${typeof ctx}`,
        surfaceId,
      );
    }
  }
}

module.exports = {
  validatePayload,
  InputValidationError,
  PayloadTooLargeError,
  DEFAULT_MAX_PAYLOAD_BYTES,
  DEFAULT_MAX_STRING_LENGTH,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_KEYS,
};
