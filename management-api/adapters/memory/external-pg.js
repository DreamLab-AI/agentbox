'use strict';

/**
 * memory/external-pg — PostgreSQL-backed vector memory adapter.
 *
 * Works with the ruvector-postgres shared schema:
 *
 *   memory_entries (id TEXT PK, namespace TEXT, key TEXT, value JSONB,
 *                   source_type TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, ...)
 *
 * Agentbox entries use source_type = 'agentbox' and id = 'agentbox:<namespace>:<key>'.
 * This makes them visible in the RuVector memory visualiser alongside claude-flow
 * entries while remaining distinguishable by source_type.
 *
 * @see ADR-005 §memory slot, §Manifest contract (E002)
 * @see PRD-001 §Capabilities and adapters
 */

const { BaseAdapter } = require('../base');
const CONTRACT_VERSIONS = require('../contract-versions');

// ADR-063: URN-traced memory entries
let urisMint = null;
try {
  const uris = require('../../lib/uris');
  urisMint = uris.mint;
} catch { /* uris.js not loadable — URN minting degrades to null */ }

const SOURCE_TYPE = 'agentbox';

function _entryId(namespace, key) {
  return `agentbox:${namespace}:${key}`;
}

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

  /** Verify the table exists (do not attempt to create — it is owned by ruvector). */
  async _ensureReady() {
    if (!this._ready) {
      this._ready = this._pool.query(
        `SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'memory_entries' LIMIT 1`
      ).then(res => {
        if (res.rowCount === 0) throw new Error('ExternalPgMemoryAdapter: memory_entries table not found');
      });
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
    const id = _entryId(namespace, key);
    const jsonValue = typeof value === 'string' ? JSON.stringify(value) : JSON.stringify(value);
    await this._pool.query(
      `INSERT INTO memory_entries (id, namespace, key, value, source_type, metadata)
       VALUES ($1, $2, $3, $4::jsonb, $5, '{}')
       ON CONFLICT (id) DO UPDATE
         SET value = EXCLUDED.value,
             updated_at = NOW()`,
      [id, namespace, key, jsonValue, SOURCE_TYPE]
    );
    return { key, namespace, stored_at: new Date().toISOString(), urn };
  }

  /**
   * Text-based search (ILIKE on value text) within agentbox-owned entries.
   */
  async search(query, opts = {}) {
    if (!query) throw new Error('query is required');
    await this._ensureReady();
    const namespace = opts.namespace || 'default';
    const limit = opts.limit || 10;
    const res = await this._pool.query(
      `SELECT key, value, namespace, created_at,
              (CASE WHEN value::text ILIKE $1 THEN 1.0 ELSE 0.5 END) AS score
       FROM memory_entries
       WHERE namespace = $2 AND source_type = $3 AND value::text ILIKE $1
       ORDER BY score DESC, created_at DESC
       LIMIT $4`,
      [`%${query}%`, namespace, SOURCE_TYPE, limit]
    );
    return {
      results: res.rows.map(r => {
        let val = r.value;
        if (typeof val === 'string') { try { val = JSON.parse(val); } catch { /* */ } }
        const entry = { key: r.key, value: val, score: parseFloat(r.score) };
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
      `SELECT key, value, namespace, created_at
       FROM memory_entries
       WHERE key = $1 AND namespace = $2 AND source_type = $3
       LIMIT 1`,
      [key, namespace, SOURCE_TYPE]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    let val = r.value;
    if (typeof val === 'string') { try { val = JSON.parse(val); } catch { /* */ } }
    let urn = null;
    if (urisMint) {
      try { urn = urisMint({ kind: 'memory', localId: `${r.namespace}.${r.key}` }); } catch { /* */ }
    }
    return { key: r.key, value: val, namespace: r.namespace, stored_at: r.created_at, urn };
  }

  /**
   * Delete an entry.
   */
  async del(key, namespace = 'default') {
    if (!key) throw new Error('key is required');
    await this._ensureReady();
    const res = await this._pool.query(
      `DELETE FROM memory_entries WHERE key = $1 AND namespace = $2 AND source_type = $3`,
      [key, namespace, SOURCE_TYPE]
    );
    return { deleted: res.rowCount > 0 };
  }

  /**
   * List keys in a namespace (agentbox entries only).
   */
  async list(namespace = 'default') {
    await this._ensureReady();
    const res = await this._pool.query(
      `SELECT key FROM memory_entries
       WHERE namespace = $1 AND source_type = $2
       ORDER BY created_at DESC`,
      [namespace, SOURCE_TYPE]
    );
    return { keys: res.rows.map(r => r.key) };
  }

  async end() {
    if (this._ownPool) await this._pool.end();
  }
}

module.exports = { ExternalPgMemoryAdapter };
