'use strict';

/**
 * lib/headroom.js -- Context compression bridge (PRD-016, ADR-034).
 *
 * Loads the headroom N-API native addon (Rust-built, Nix-installed at
 * /opt/agentbox/lib/headroom/headroom_napi.node) and exposes a
 * fail-open compression API for adapter dispatch middleware.
 *
 * Design:
 *   - Fail-open: when the native addon is absent or compression.enabled
 *     is false in the manifest, compress() returns the input unchanged.
 *   - Slot gating: each adapter slot (memory, pods, beads, orchestrator)
 *     must be enabled in [compression.slots] before compression fires.
 *   - Events slot: ALWAYS returns input unchanged regardless of manifest
 *     config — the audit trail must never be compressed (hard-coded).
 *   - Lazy loading: the addon is loaded on first call, not at require()
 *     time, so management-api startup is unaffected when the addon is
 *     not installed.
 *
 * @see agentbox.toml [compression]
 * @see /opt/agentbox/lib/headroom/headroom_napi.node
 */

const { loadManifest } = require('../adapters/manifest-loader');

const ADDON_PATH = '/opt/agentbox/lib/headroom/headroom_napi.node';

// Sentinel values: null = not yet attempted, false = unavailable, object = loaded
let _native = null;
let _config = null;
let _initialised = false;

// ── Lazy addon loader ──────────────────────────────────────────────────────

/**
 * Attempt to load the native addon. Returns the addon module on success,
 * or false when the addon is not installed. Cached after first call.
 */
function _loadNative() {
  if (_native !== null) return _native;
  try {
    _native = require(ADDON_PATH);
  } catch (_err) {
    _native = false;
  }
  return _native;
}

// ── Manifest config reader ─────────────────────────────────────────────────

/**
 * Read the [compression] section from the manifest. Returns a normalised
 * config object with safe defaults for every field.
 */
function _readManifestConfig() {
  if (_config !== null) return _config;

  let manifest;
  try {
    manifest = loadManifest();
  } catch (_err) {
    manifest = {};
  }

  const raw = manifest.compression || {};
  const slots = raw.slots || {};
  const algorithms = raw.algorithms || {};

  _config = {
    enabled:       raw.enabled === true,
    backend:       raw.backend || 'memory',
    ttl_minutes:   typeof raw.ttl_minutes === 'number' ? raw.ttl_minutes : 30,
    max_entries:   typeof raw.max_entries === 'number' ? raw.max_entries : 1000,
    target_ratio:  typeof raw.target_ratio === 'number' ? raw.target_ratio : 0.15,
    slots: {
      memory:       slots.memory === true,
      pods:         slots.pods === true,
      events:       false, // hard-coded: audit trail is never compressed
      beads:        slots.beads === true,
      orchestrator: slots.orchestrator === true,
    },
    algorithms: {
      smart_crusher:  algorithms.smart_crusher !== false,
      log_compressor: algorithms.log_compressor !== false,
      diff_compressor: algorithms.diff_compressor !== false,
    },
  };

  return _config;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns true when the native addon is loadable AND compression is
 * enabled in the manifest.
 */
function isAvailable() {
  const addon = _loadNative();
  if (!addon) return false;
  const cfg = _readManifestConfig();
  return cfg.enabled;
}

/**
 * Initialise the compression backend. Must be called once before
 * compress/retrieve. Safe to call multiple times (idempotent).
 *
 * @param {object} [overrides] - Override manifest config values
 * @param {string} [overrides.backend]
 * @param {number} [overrides.ttl_minutes]
 * @param {number} [overrides.max_entries]
 * @param {number} [overrides.target_ratio]
 * @param {object} [overrides.logger] - Pino-compatible logger
 * @returns {{ ok: boolean, reason?: string }}
 */
function init(overrides) {
  if (_initialised) return { ok: true };

  const addon = _loadNative();
  if (!addon) {
    return { ok: false, reason: 'native addon not available' };
  }

  const cfg = _readManifestConfig();
  if (!cfg.enabled) {
    return { ok: false, reason: 'compression.enabled is false in manifest' };
  }

  const initCfg = {
    backend:      (overrides && overrides.backend) || cfg.backend,
    ttlMinutes:   (overrides && overrides.ttl_minutes) || cfg.ttl_minutes,
    maxEntries:   (overrides && overrides.max_entries) || cfg.max_entries,
    targetRatio:  (overrides && overrides.target_ratio) || cfg.target_ratio,
  };

  const log = (overrides && overrides.logger) || null;

  try {
    addon.initCompression(initCfg);
    _initialised = true;
    if (log) {
      log.info({ event: 'headroom.init', config: initCfg }, 'Headroom compression initialised');
    }
    return { ok: true };
  } catch (err) {
    if (log) {
      log.warn({ event: 'headroom.init-failed', err: err.message }, 'Headroom init failed — compression disabled');
    }
    return { ok: false, reason: err.message };
  }
}

/**
 * Detect the content type for routing to the appropriate compressor.
 * Returns one of: 'json_array', 'diff', 'log', 'text'.
 */
function _detectContentType(content) {
  if (typeof content !== 'string') return 'text';
  const trimmed = content.trimStart();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return 'json_array';
    } catch (_) { /* not valid JSON array */ }
  }
  if (trimmed.startsWith('---') || trimmed.startsWith('+++') || trimmed.startsWith('diff ')) {
    return 'diff';
  }
  // Log-like content: lines with timestamps or repeated structure
  const lines = trimmed.split('\n');
  if (lines.length > 3) {
    const timestampPattern = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;
    const timestampHits = lines.slice(0, 5).filter(l => timestampPattern.test(l)).length;
    if (timestampHits >= 2) return 'log';
  }
  return 'text';
}

/**
 * Compress content for a given adapter slot.
 *
 * Fail-open: returns the input unchanged when compression is unavailable,
 * disabled, or the slot is not enabled for compression.
 *
 * @param {string} content - The content to compress
 * @param {string} slot - Adapter slot name (memory, pods, beads, events, orchestrator)
 * @param {object} [opts]
 * @param {object} [opts.logger] - Pino-compatible logger
 * @returns {{ content: string, compressed: boolean, ratio: number|null, contentType: string|null, ccrEntries: number|null }}
 */
function compress(content, slot, opts) {
  const passthrough = {
    content,
    compressed: false,
    ratio: null,
    contentType: null,
    ccrEntries: null,
  };

  // Hard gate: events slot is NEVER compressed
  if (slot === 'events') return passthrough;

  // Check availability and initialisation
  if (!isAvailable() || !_initialised) return passthrough;

  // Check slot gating
  const cfg = _readManifestConfig();
  if (!cfg.slots[slot]) return passthrough;

  const addon = _loadNative();
  if (!addon) return passthrough;

  const log = (opts && opts.logger) || null;
  const contentType = _detectContentType(content);

  try {
    let result;
    switch (contentType) {
      case 'json_array':
        if (cfg.algorithms.smart_crusher && typeof addon.smartCrush === 'function') {
          result = addon.smartCrush(content, { targetRatio: cfg.target_ratio });
        }
        break;
      case 'diff':
        if (cfg.algorithms.diff_compressor && typeof addon.compressDiff === 'function') {
          result = addon.compressDiff(content, { contextRatio: 3.0 });
        }
        break;
      case 'log':
        if (cfg.algorithms.log_compressor && typeof addon.compressLog === 'function') {
          result = addon.compressLog(content, { preserveErrors: true });
        }
        break;
      default:
        // No generic compressor for unknown content types — return passthrough
        break;
    }

    // If no result or compression was not beneficial, return original
    if (!result || !result.compressed) return passthrough;

    const ratio = result.ratio != null
      ? result.ratio
      : (content.length > 0 ? result.compressed.length / content.length : 1);

    // Only use compressed output if it actually saves space
    if (ratio >= 1.0) return passthrough;

    if (log) {
      log.info({
        event: 'headroom.compress',
        slot,
        contentType,
        originalLen: content.length,
        compressedLen: result.compressed.length,
        ratio: Math.round(ratio * 1000) / 1000,
        ccrEntries: result.ccrEntries || result.ccr_entries || null,
      }, 'Content compressed');
    }

    return {
      content: result.compressed,
      compressed: true,
      ratio,
      contentType,
      ccrEntries: result.ccrEntries || result.ccr_entries || null,
    };
  } catch (err) {
    // Fail-open: log and return original
    if (log) {
      log.warn({ event: 'headroom.compress-error', slot, contentType, err: err.message }, 'Compression failed — returning original');
    }
    return passthrough;
  }
}

/**
 * Retrieve original content from the CCR (Content-aware Compression
 * Registry) store by content hash.
 *
 * @param {string} hash - Content hash from a previous compress() result
 * @returns {string|null} Original content, or null if not found / unavailable
 */
function retrieve(hash) {
  if (!isAvailable() || !_initialised) return null;

  const addon = _loadNative();
  if (!addon || typeof addon.ccrRetrieve !== 'function') return null;

  try {
    const result = addon.ccrRetrieve(hash);
    return result || null;
  } catch (_err) {
    return null;
  }
}

/**
 * Return CCR store statistics.
 *
 * @returns {{ available: boolean, entries: number|null, capacity: number|null, hitRate: number|null, memoryBytes: number|null }}
 */
function stats() {
  const unavailable = {
    available: false,
    entries: null,
    capacity: null,
    hitRate: null,
    memoryBytes: null,
  };

  if (!isAvailable() || !_initialised) return unavailable;

  const addon = _loadNative();
  if (!addon || typeof addon.ccrStats !== 'function') return unavailable;

  try {
    const raw = addon.ccrStats();
    const hitCount = Number(raw.hitCount || raw.hit_count || 0);
    const missCount = Number(raw.missCount || raw.miss_count || 0);
    const total = hitCount + missCount;
    const bytesStored = raw.bytesStored != null ? raw.bytesStored : raw.bytes_stored;
    return {
      available: true,
      entries:     raw.entries != null ? Number(raw.entries) : null,
      capacity:    null, // not tracked by the native addon
      hitRate:     total > 0 ? hitCount / total : null,
      memoryBytes: bytesStored != null ? Number(bytesStored) : null,
    };
  } catch (_err) {
    return unavailable;
  }
}

/**
 * Detect the content type of a string via the native addon.
 * Returns { content_type: string, confidence: number } or null if unavailable.
 */
function detectContentType(content) {
  const addon = _loadNative();
  if (!addon || typeof addon.detectContentType !== 'function') return null;
  try {
    return addon.detectContentType(content);
  } catch (_err) {
    return null;
  }
}

/**
 * Smart-crush a JSON array string via the native addon.
 * Returns CompressResult or null if unavailable.
 */
function smartCrush(content, options) {
  const addon = _loadNative();
  if (!addon || typeof addon.smartCrush !== 'function') return null;
  return addon.smartCrush(content, options || null);
}

/**
 * Compress log output via the native addon.
 * Returns CompressResult or null if unavailable.
 */
function compressLog(content, options) {
  const addon = _loadNative();
  if (!addon || typeof addon.compressLog !== 'function') return null;
  return addon.compressLog(content, options || null);
}

/**
 * Compress a unified diff via the native addon.
 * Returns CompressResult or null if unavailable.
 */
function compressDiff(content, options) {
  const addon = _loadNative();
  if (!addon || typeof addon.compressDiff !== 'function') return null;
  return addon.compressDiff(content, options || null);
}

/**
 * Retrieve original content from the CCR store by hash.
 * Alias for retrieve() — provides the camelCase name expected by MCP tools.
 */
function ccrRetrieve(hash) {
  return retrieve(hash);
}

/**
 * Return CCR store statistics from the native addon.
 * Returns the raw CcrStoreStats object (entries, bytes_stored, hit_count, miss_count).
 */
function ccrStats() {
  const addon = _loadNative();
  if (!addon || typeof addon.ccrStats !== 'function') return null;
  try {
    return addon.ccrStats();
  } catch (_err) {
    return null;
  }
}

module.exports = {
  isAvailable, init, compress, retrieve, stats,
  detectContentType, smartCrush, compressLog, compressDiff,
  ccrRetrieve, ccrStats,
};
