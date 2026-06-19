'use strict';

/**
 * lib/headroom-mcp-tools.js -- MCP tool definitions for headroom CCR
 * (Compress-Cache-Retrieve) operations.
 *
 * Exports tool descriptors and a dispatcher function that can be registered
 * with any MCP server. Thin wrappers around the headroom.js loader module
 * which itself wraps the headroom-napi native addon.
 *
 * Tools:
 *   headroom_retrieve  — retrieve an original payload from the CCR cache
 *   headroom_stats     — get compression statistics
 *   headroom_compress  — manually compress a payload
 *
 * All tools return graceful errors if the compression subsystem is not
 * available (native addon missing, compression disabled in manifest, etc.).
 *
 * @see ADR-034  @see PRD-016  @see crates/headroom-napi/src/lib.rs
 */

let headroom = null;
let loadError = null;

try {
  headroom = require('./headroom');
} catch (err) {
  loadError = err.message || 'headroom module not available';
}

// ── tool definitions ────────────────────────────────────────────────────────

const HEADROOM_RETRIEVE_TOOL = {
  name: 'headroom_retrieve',
  description:
    'Retrieve an original payload from the CCR (Compress-Cache-Retrieve) cache ' +
    'by its BLAKE3 hash. Returns the decompressed content and size, or an error ' +
    'if the entry has expired or was evicted.',
  inputSchema: {
    type: 'object',
    properties: {
      hash: {
        type: 'string',
        description: 'BLAKE3 hash prefix (24 hex chars) of the stored content',
      },
    },
    required: ['hash'],
    additionalProperties: false,
  },
};

const HEADROOM_STATS_TOOL = {
  name: 'headroom_stats',
  description:
    'Get compression statistics from the CCR store: entry count, bytes stored, ' +
    'hit/miss counts, and hit rate.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
};

const HEADROOM_COMPRESS_TOOL = {
  name: 'headroom_compress',
  description:
    'Manually compress a payload using headroom content-aware compression. ' +
    'Auto-detects content type (JSON array, log output, unified diff) and ' +
    'applies the appropriate compressor. Originals are stored in the CCR cache ' +
    'for later retrieval.',
  inputSchema: {
    type: 'object',
    properties: {
      content: {
        type: 'string',
        description: 'The payload to compress',
      },
      content_type: {
        type: 'string',
        enum: ['json_array', 'log_output', 'unified_diff', 'auto'],
        description: 'Content type hint. Default: auto-detect.',
      },
    },
    required: ['content'],
    additionalProperties: false,
  },
};

const TOOLS = [
  HEADROOM_RETRIEVE_TOOL,
  HEADROOM_STATS_TOOL,
  HEADROOM_COMPRESS_TOOL,
];

// ── tool handlers ───────────────────────────────────────────────────────────

function unavailableError() {
  return {
    error: 'compression_unavailable',
    message: loadError || 'headroom compression subsystem is not loaded',
  };
}

/**
 * Handle a headroom MCP tool call.
 *
 * @param {string} name  - Tool name
 * @param {object} args  - Tool arguments
 * @returns {object} Result payload (JSON-serialisable)
 */
function handleTool(name, args) {
  if (!headroom) {
    return unavailableError();
  }

  switch (name) {
    case 'headroom_retrieve': {
      const hash = args.hash;
      if (!hash || typeof hash !== 'string') {
        return { error: 'validation_error', message: 'hash must be a non-empty string' };
      }
      try {
        const result = headroom.ccrRetrieve(hash);
        if (result == null) {
          return { error: 'expired', message: `No CCR entry found for hash ${hash}` };
        }
        // result is a Buffer from the N-API layer
        const content = Buffer.isBuffer(result) ? result.toString('utf-8') : String(result);
        return { content, size_bytes: Buffer.byteLength(content, 'utf-8') };
      } catch (err) {
        return { error: 'retrieve_failed', message: err.message || String(err) };
      }
    }

    case 'headroom_stats': {
      try {
        const stats = headroom.ccrStats();
        if (!stats) {
          return { error: 'stats_unavailable', message: 'CCR store is not initialised' };
        }
        const hitCount = Number(stats.hitCount || stats.hit_count || 0);
        const missCount = Number(stats.missCount || stats.miss_count || 0);
        const total = hitCount + missCount;
        return {
          entries: Number(stats.entries || 0),
          bytes_stored: Number(stats.bytesStored || stats.bytes_stored || 0),
          hit_count: hitCount,
          miss_count: missCount,
          hit_rate: total > 0 ? hitCount / total : 0,
        };
      } catch (err) {
        return { error: 'stats_failed', message: err.message || String(err) };
      }
    }

    case 'headroom_compress': {
      const content = args.content;
      if (!content || typeof content !== 'string') {
        return { error: 'validation_error', message: 'content must be a non-empty string' };
      }
      try {
        const contentType = args.content_type || 'auto';
        let detected = contentType;
        let result;

        if (contentType === 'auto') {
          const detection = headroom.detectContentType(content);
          detected = (detection && (detection.contentType || detection.content_type)) || 'unknown';
        }

        // Route to the appropriate compressor based on content type
        switch (detected) {
          case 'json_array':
            result = headroom.smartCrush(content);
            break;
          case 'log_output':
            result = headroom.compressLog(content);
            break;
          case 'unified_diff':
            result = headroom.compressDiff(content);
            break;
          default:
            // For unknown/code/prose types, attempt smart_crush as a general
            // compressor; it handles non-JSON gracefully.
            result = headroom.smartCrush(content);
            break;
        }

        if (!result) {
          return { error: 'compress_unavailable', message: 'Compression addon is not loaded' };
        }

        // Normalise CCR entries to string hashes for the caller
        const ccrEntries = (result.ccrEntries || result.ccr_entries || []).map(
          (e) => (typeof e === 'string' ? e : e.hash)
        );

        return {
          compressed: result.compressed,
          ratio: result.ratio,
          ccr_entries: ccrEntries,
        };
      } catch (err) {
        return { error: 'compress_failed', message: err.message || String(err) };
      }
    }

    default:
      return { error: 'unknown_tool', message: `Tool ${name} not found` };
  }
}

module.exports = {
  TOOLS,
  HEADROOM_RETRIEVE_TOOL,
  HEADROOM_STATS_TOOL,
  HEADROOM_COMPRESS_TOOL,
  handleTool,
};
