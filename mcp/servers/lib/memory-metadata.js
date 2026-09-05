'use strict';
/**
 * memory-metadata.js — typed metadata construction for memory_store (PRD-018 D3,
 * gate RUVECTOR_TYPED_METADATA). Turns the advertised-but-dropped
 * {importance, tags, memory_type, ttl_seconds} options into the `metadata` jsonb
 * the sidecar carries, computing `expires_at` from `ttl_seconds` so the episodic
 * TTL sweep (D3, gate RUVECTOR_EPISODIC_TTL_SWEEP) has something to sweep.
 *
 * Callers gate on RUVECTOR_TYPED_METADATA before invoking; with the gate off the
 * memory_store path must keep writing the literal '{}' (byte-identical to today).
 *
 * ADR-2014 closeout (2026-09-05) — TTL is a VISIBILITY deadline for BOTH memory
 * types, not an episodic-only cleanup hint. `expiredPredicate()` below is the one
 * SQL fragment every read path (retrieve / list / vector search / ILIKE fallback /
 * hybrid) uses to deny expired rows the instant `expires_at` passes, and the sweep
 * uses its negation to delete them. The two properties are therefore separable and
 * both defined: visibility ends at `expires_at`; deletion happens on the next
 * sweep. A malformed `expires_at` is treated as ABSENT (never as expired) so a
 * corrupt metadata value can neither hide nor destroy a row.
 */

const VALID_TYPES = new Set(['episodic', 'semantic']);

// Both memory types participate in TTL (ADR-2014 closeout). Retained as an
// explicit list so a future third type must opt in deliberately.
const TTL_TYPES = Object.freeze(['episodic', 'semantic']);

/**
 * SQL boolean that is TRUE when a row is STILL VISIBLE (not expired).
 * CASE guarantees the ordering of the malformed-value guard before the cast —
 * a bare `AND (metadata->>'expires_at')::timestamptz > now()` can be evaluated
 * against a non-timestamp string and abort the whole query.
 *
 * @param {string} [col='metadata'] the metadata column expression
 * @returns {string} a SQL predicate fragment (no parameters)
 */
function notExpiredPredicate(col = 'metadata') {
  return `(CASE
             WHEN (${col}->>'expires_at') IS NULL THEN true
             WHEN (${col}->>'expires_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN true
             ELSE (${col}->>'expires_at')::timestamptz > now()
           END)`;
}

/**
 * SQL boolean that is TRUE when a row HAS EXPIRED — the sweep's delete predicate.
 * Exactly the negation of notExpiredPredicate for well-formed values; a malformed
 * or absent `expires_at` is never expired.
 *
 * @param {string} [col='metadata']
 * @returns {string}
 */
function expiredPredicate(col = 'metadata') {
  return `(CASE
             WHEN (${col}->>'expires_at') IS NULL THEN false
             WHEN (${col}->>'expires_at') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN false
             ELSE (${col}->>'expires_at')::timestamptz <= now()
           END)`;
}

/**
 * Build the metadata object from typed store options.
 * @param {object} [opts]
 * @param {number} [opts.importance] — 0..1 relevance weight (clamped)
 * @param {string[]} [opts.tags] — free-text tags
 * @param {string} [opts.memory_type] — 'episodic' | 'semantic' (default 'semantic')
 * @param {number} [opts.ttl_seconds] — positive seconds → metadata.expires_at (ISO)
 * @returns {object} the metadata jsonb payload
 */
function buildMetadata(opts = {}) {
  const md = {};

  if (opts.importance !== undefined && opts.importance !== null) {
    const imp = Number(opts.importance);
    if (Number.isFinite(imp)) md.importance = Math.min(1, Math.max(0, imp));
  }

  if (Array.isArray(opts.tags)) {
    const tags = opts.tags
      .filter((t) => typeof t === 'string' && t.trim())
      .map((t) => t.trim());
    if (tags.length) md.tags = tags;
  }

  md.memory_type = VALID_TYPES.has(opts.memory_type) ? opts.memory_type : 'semantic';

  if (opts.ttl_seconds !== undefined && opts.ttl_seconds !== null) {
    const ttl = Number(opts.ttl_seconds);
    if (Number.isFinite(ttl) && ttl > 0) {
      md.ttl_seconds = Math.floor(ttl);
      md.expires_at = new Date(Date.now() + Math.floor(ttl) * 1000).toISOString();
    }
  }

  return md;
}

module.exports = { buildMetadata, VALID_TYPES, TTL_TYPES, notExpiredPredicate, expiredPredicate };
