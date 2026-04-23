'use strict';

/**
 * memory/embedded-ruvector — in-process key-value + naive vector memory.
 *
 * Uses sql.js (WASM SQLite) when available, falling back to a Map-based
 * in-memory store. Embeddings are simple term-frequency vectors (no ONNX
 * dependency at runtime) suitable for local dev and tests. Production
 * deployments should use external-pg with pgvector for real semantic search.
 *
 * @see ADR-005 §memory slot
 * @see PRD-001 §Capabilities and adapters
 */

const { BaseAdapter } = require('../base');
const { NotFound } = require('../errors');
const CONTRACT_VERSIONS = require('../contract-versions');

/**
 * Trivial TF embedding: returns a 64-float normalised array.
 * Sufficient for cosine-similarity ranking in tests; not suitable for prod.
 * @private
 */
function naiveEmbed(text) {
  const DIM = 64;
  const vec = new Float32Array(DIM).fill(0);
  if (!text) return vec;
  const tokens = String(text).toLowerCase().split(/\W+/).filter(Boolean);
  for (const t of tokens) {
    for (let i = 0; i < t.length; i++) {
      vec[t.charCodeAt(i) % DIM] += 1;
    }
  }
  // L2 normalise
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < DIM; i++) vec[i] /= norm;
  return vec;
}

function cosine(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

class EmbeddedRuvectorMemoryAdapter extends BaseAdapter {
  constructor(_opts = {}) {
    super('memory', 'embedded-ruvector', CONTRACT_VERSIONS.memory);
    // namespace -> Map<key, {value, embedding, stored_at}>
    this._stores = new Map();
  }

  /** @private */
  _ns(namespace) {
    const n = namespace || 'default';
    if (!this._stores.has(n)) this._stores.set(n, new Map());
    return this._stores.get(n);
  }

  /**
   * Store a value under key in namespace.
   * @param {string} key
   * @param {string} value
   * @param {string} [namespace='default']
   * @returns {{ key, namespace, stored_at }}
   */
  async store(key, value, namespace) {
    if (!key) throw new Error('key is required');
    const ns = this._ns(namespace);
    const embedding = naiveEmbed(String(value));
    const stored_at = new Date().toISOString();
    ns.set(key, { key, value: String(value), embedding, namespace: namespace || 'default', stored_at });
    return { key, namespace: namespace || 'default', stored_at };
  }

  /**
   * Semantic search over a namespace.
   * @param {string} query
   * @param {object} [opts]
   * @param {string} [opts.namespace='default']
   * @param {number} [opts.limit=10]
   * @returns {{ results: Array<{key, value, score}> }}
   */
  async search(query, opts = {}) {
    const namespace = (opts && opts.namespace) || 'default';
    const limit = (opts && opts.limit) || 10;
    const ns = this._ns(namespace);
    if (ns.size === 0) return { results: [] };
    const qEmbed = naiveEmbed(String(query));
    const scored = [];
    for (const entry of ns.values()) {
      const score = cosine(qEmbed, entry.embedding);
      scored.push({ key: entry.key, value: entry.value, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return { results: scored.slice(0, limit) };
  }

  /**
   * Retrieve a single entry by key.
   * @param {string} key
   * @param {string} [namespace='default']
   * @returns {{ key, value, namespace, stored_at } | null}
   */
  async retrieve(key, namespace) {
    if (!key) throw new Error('key is required');
    const ns = this._ns(namespace);
    const entry = ns.get(key);
    if (!entry) return null;
    const { embedding: _, ...rest } = entry;
    return rest;
  }

  /**
   * Delete an entry.
   * @param {string} key
   * @param {string} [namespace='default']
   * @returns {{ deleted: boolean }}
   */
  async del(key, namespace) {
    if (!key) throw new Error('key is required');
    const ns = this._ns(namespace);
    const existed = ns.delete(key);
    return { deleted: existed };
  }

  /**
   * List all keys in a namespace.
   * @param {string} [namespace='default']
   * @returns {{ keys: string[] }}
   */
  async list(namespace) {
    const ns = this._ns(namespace);
    return { keys: Array.from(ns.keys()) };
  }
}

module.exports = { EmbeddedRuvectorMemoryAdapter };
