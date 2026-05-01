'use strict';

/**
 * memory/external-pg — PostgreSQL-backed vector memory adapter.
 *
 * Compatible with ruvector-postgres (pgvector extension) and plain pg.
 * Requires the `memory_entries` table to exist; creates it if absent.
 *
 * @see ADR-005 §memory slot, §Manifest contract (E002)
 * @see PRD-001 §Capabilities and adapters
 */

const { BaseAdapter } = require('../base');
const { EmbeddingError } = require('../errors');
const CONTRACT_VERSIONS = require('../contract-versions');

// ADR-063: URN-traced memory entries
let urisMint = null;
try {
  const uris = require('../../lib/uris');
  urisMint = uris.mint;
} catch { /* uris.js not loadable — URN minting degrades to null */ }

const CREATE_TABLE = `
  CREATE TABLE IF NOT EXISTS memory_entries (
    key        TEXT        NOT NULL,
    namespace  TEXT        NOT NULL DEFAULT 'default',
    value      TEXT        NOT NULL,
    stored_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (key, namespace)
  );
`;

class ExternalPgMemoryAdapter extends BaseAdapter {
  /**
   * @param {object} opts
   * @param {string|object} opts.conninfo  - pg connection string or Pool/Client instance
   * @param {Function} [opts.ClientClass]  - Override pg.Pool for tests
   */
  constructor(opts = {}) {
    super('memory', 'external-pg', CONTRACT_VERSIONS.memory);
    if (!opts.conninfo && !opts.client) {
      throw new Error('ExternalPgMemoryAdapter: conninfo or client is required');
    }
    if (opts.client) {
      this._pool = opts.client;
      this._ownPool = false;
    } else {
      const PgPool = (opts.ClientClass) || require('pg').Pool;
      this._pool = new PgPool(
        typeof opts.conninfo === 'string'
          ? { connectionString: opts.conninfo }
          : opts.conninfo
      );
      this._ownPool = true;
    }
    this._ready = null;
  }

  /** Lazy schema init */
  async _ensureReady() {
    if (!this._ready) {
      this._ready = this._pool.query(CREATE_TABLE);
    }
    return this._ready;
  }

  /**
   * Store a value.
   * @param {string} key
   * @param {string} value
   * @param {string} [namespace='default']
   */
  async store(key, value, namespace = 'default') {
    if (!key) throw new Error('key is required');
    await this._ensureReady();
    let urn = null;
    if (urisMint) {
      try { urn = urisMint({ kind: 'memory', localId: `${namespace}.${key}` }); } catch { /* */ }
    }
    await this._pool.query(
      `INSERT INTO memory_entries (key, namespace, value, stored_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key, namespace) DO UPDATE SET value = EXCLUDED.value, stored_at = NOW()`,
      [key, namespace, String(value)]
    );
    return { key, namespace, stored_at: new Date().toISOString(), urn };
  }

  /**
   * Text-based search (ILIKE) — full pgvector search requires embeddings pipeline.
   * @param {string} query
   * @param {object} [opts]
   * @param {string} [opts.namespace='default']
   * @param {number} [opts.limit=10]
   */
  async search(query, opts = {}) {
    if (!query) throw new Error('query is required');
    await this._ensureReady();
    const namespace = opts.namespace || 'default';
    const limit = opts.limit || 10;
    const res = await this._pool.query(
      `SELECT key, value, namespace, stored_at,
              (CASE WHEN value ILIKE $1 THEN 1.0 ELSE 0.5 END) AS score
       FROM memory_entries
       WHERE namespace = $2 AND value ILIKE $1
       ORDER BY score DESC, stored_at DESC
       LIMIT $3`,
      [`%${query}%`, namespace, limit]
    );
    return {
      results: res.rows.map(r => {
        const entry = { key: r.key, value: r.value, score: parseFloat(r.score) };
        if (urisMint) {
          try { entry.urn = urisMint({ kind: 'memory', localId: `${namespace}.${r.key}` }); } catch { /* */ }
        }
        return entry;
      }),
    };
  }

  /**
   * Retrieve a single entry by key.
   */
  async retrieve(key, namespace = 'default') {
    if (!key) throw new Error('key is required');
    await this._ensureReady();
    const res = await this._pool.query(
      `SELECT key, value, namespace, stored_at FROM memory_entries WHERE key = $1 AND namespace = $2`,
      [key, namespace]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    let urn = null;
    if (urisMint) {
      try { urn = urisMint({ kind: 'memory', localId: `${r.namespace}.${r.key}` }); } catch { /* */ }
    }
    return { key: r.key, value: r.value, namespace: r.namespace, stored_at: r.stored_at, urn };
  }

  /**
   * Delete an entry.
   */
  async del(key, namespace = 'default') {
    if (!key) throw new Error('key is required');
    await this._ensureReady();
    const res = await this._pool.query(
      `DELETE FROM memory_entries WHERE key = $1 AND namespace = $2`,
      [key, namespace]
    );
    return { deleted: res.rowCount > 0 };
  }

  /**
   * List keys in a namespace.
   */
  async list(namespace = 'default') {
    await this._ensureReady();
    const res = await this._pool.query(
      `SELECT key FROM memory_entries WHERE namespace = $1 ORDER BY stored_at DESC`,
      [namespace]
    );
    return { keys: res.rows.map(r => r.key) };
  }

  async end() {
    if (this._ownPool) await this._pool.end();
  }
}

module.exports = { ExternalPgMemoryAdapter };
