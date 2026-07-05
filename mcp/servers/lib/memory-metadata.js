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
 */

const VALID_TYPES = new Set(['episodic', 'semantic']);

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

module.exports = { buildMetadata, VALID_TYPES };
