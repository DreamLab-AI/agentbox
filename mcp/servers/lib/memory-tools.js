'use strict';
/**
 * memory-tools.js — single-source memory tool logic shared by the two agentbox
 * MCP servers (ruvector-mcp.cjs and mcp-server.js).
 *
 * This is a CommonJS module by design: ruvector-mcp.cjs requires it directly,
 * and the ESM mcp-server.js consumes it via createRequire(). Keep it CommonJS.
 *
 * `createMemoryTools({ backend })` returns an object with four async methods:
 *   memStore(key, value, namespace)
 *   memRetrieve(key, namespace)
 *   memList(namespace, limit)
 *   memSearch(query, namespace, limit, sourceType)
 *
 * Backends (selected by `adapters.memory`, see scripts/start-agentbox.sh):
 *
 *   'external-pg'      — the ADR-015 mandated path. pgvector + xinference
 *                        embeddings + HNSW + memory-flash-notifier. The
 *                        response shapes here are LOAD-BEARING and must remain
 *                        byte-for-byte equivalent to the original inline
 *                        implementation in ruvector-mcp.cjs.
 *
 *   'embedded-ruvector'/'in-memory'/'sqlite' — a delegating backend that wraps
 *                        an injected memoryStore singleton. It exposes the raw
 *                        store/retrieve/list/search primitives only; the calling
 *                        server keeps its own response-shape assembly (pod +
 *                        URN annotation), so its observable output is unchanged.
 */

// ── external-pg backend ─────────────────────────────────────────────────────
// Verbatim extraction of the pgvector/xinference/HNSW memory logic that lived
// inline in ruvector-mcp.cjs. Dependencies are injected so the module never
// owns the pool, the embedding transport, or the notifier — the entry point
// wires those exactly as before.

function createExternalPgBackend(deps) {
  const {
    pool,
    getPgOk,
    getEmbedding,
    xinfEnsure,
    vecToSql,
    entryId,
    parseVal,
    notifyMemoryFlash,
    notifyMemoryFlashBatch,
    log,
    writeSourceType,
  } = deps;

  async function memStore(key, value, namespace = 'default') {
    if (!getPgOk() || !pool) return { success: false, error: 'pg unavailable', storage: 'none' };
    const id = entryId(namespace, key);
    const jsonValue = typeof value === 'object' ? JSON.stringify(value) : value;
    let pgValue;
    try { JSON.parse(jsonValue); pgValue = jsonValue; } catch { pgValue = JSON.stringify(jsonValue); }
    const embedText = typeof value === 'string' ? value : JSON.stringify(value);
    let embeddingClause = 'NULL';
    const params = [id, namespace, key, pgValue, writeSourceType];
    if (await xinfEnsure()) {
      try {
        const emb = await getEmbedding(embedText.substring(0, 2000));
        params.push(vecToSql(emb));
        embeddingClause = `$6::ruvector(384)`;
      } catch (e) { log('WARN', `embedding generation failed for store: ${e.message}`); }
    }
    await pool.query(
      `INSERT INTO memory_entries (id, namespace, key, value, source_type, metadata, embedding)
       VALUES ($1, $2, $3, $4::jsonb, $5, '{}', ${embeddingClause})
       ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, embedding = COALESCE(EXCLUDED.embedding, memory_entries.embedding), updated_at = NOW()`,
      params,
    );
    notifyMemoryFlash({ key, namespace, action: 'store' });
    return { success: true, action: 'store', key, namespace, stored: true, embedded: params.length > 5, storage: 'ruvector-postgres' };
  }

  async function memRetrieve(key, namespace = 'default') {
    if (!getPgOk() || !pool) return { success: false, error: 'pg unavailable' };
    const res = await pool.query(
      `SELECT key, value, source_type FROM memory_entries WHERE namespace = $1 AND key = $2 ORDER BY updated_at DESC LIMIT 1`,
      [namespace, key],
    );
    if (!res.rows.length) return { success: true, action: 'retrieve', key, namespace, value: null, found: false };
    notifyMemoryFlash({ key, namespace, action: 'retrieve' });
    return { success: true, action: 'retrieve', key, namespace, value: parseVal(res.rows[0].value), found: true, source_type: res.rows[0].source_type, storage: 'ruvector-postgres' };
  }

  async function memList(namespace = 'default', limit = 100) {
    if (!getPgOk() || !pool) return { success: false, error: 'pg unavailable' };
    const res = await pool.query(
      `SELECT key, value, source_type FROM memory_entries WHERE namespace = $1 ORDER BY created_at DESC LIMIT $2`,
      [namespace, limit],
    );
    const entries = res.rows.map(r => ({ key: r.key, value: parseVal(r.value), source_type: r.source_type }));
    return { success: true, action: 'list', namespace, entries, count: entries.length, storage: 'ruvector-postgres' };
  }

  async function memSearch(query, namespace = 'default', limit = 10, sourceType = null) {
    if (!getPgOk() || !pool) return { success: false, error: 'pg unavailable' };
    const st = sourceType && sourceType !== '*' ? sourceType : null;

    // Try HNSW vector search via xinference embedding
    if (await xinfEnsure()) {
      try {
        const queryEmb = await getEmbedding(query.substring(0, 2000));
        const queryVec = vecToSql(queryEmb);
        let paramIdx = 3;
        const params = [queryVec, limit];
        let nsFilter = '';
        let stFilter = '';
        if (namespace !== '*') { nsFilter = `AND namespace = $${paramIdx++}`; params.push(namespace); }
        if (st) { stFilter = `AND source_type = $${paramIdx++}`; params.push(st); }

        // ruvector 0.3.0's HNSW scan post-filters its candidate set without
        // iterating: a WHERE clause on a kNN query silently returns 0 rows
        // when the namespace's rows aren't among the index's top candidates
        // (with 2M+ vectors, a 271-row namespace never is). The ef_search
        // GUCs are no-ops in this extension version. For filtered searches,
        // select the subset via btree first (MATERIALIZED blocks the HNSW
        // plan) and rank exactly — small namespaces make this cheap and
        // recall is perfect. Unfiltered searches keep the fast HNSW path.
        const sql = (nsFilter || stFilter) ? `
          WITH ns AS MATERIALIZED (
            SELECT key, value, namespace, source_type, embedding
            FROM memory_entries
            WHERE embedding IS NOT NULL ${nsFilter} ${stFilter}
          )
          SELECT key, value, namespace, source_type,
                 1.0 - (embedding <=> $1::ruvector(384)) AS score
          FROM ns
          ORDER BY embedding <=> $1::ruvector(384)
          LIMIT $2` : `
          SELECT key, value, namespace, source_type,
                 1.0 - (embedding <=> $1::ruvector(384)) AS score
          FROM memory_entries
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> $1::ruvector(384)
          LIMIT $2`;

        const res = await pool.query(sql, params);
        const results = res.rows.map(r => ({
          key: r.key, value: parseVal(r.value), namespace: r.namespace,
          source_type: r.source_type, score: parseFloat(r.score),
        }));
        notifyMemoryFlashBatch(results.slice(0, 5).map(r => ({ key: r.key, namespace: r.namespace || namespace, action: 'search' })));
        return { success: true, action: 'search', query, namespace, results, count: results.length, method: 'hnsw-xinference', storage: 'ruvector-postgres' };
      } catch (vecErr) {
        log('WARN', `HNSW search failed: ${vecErr.message}`);
      }
    }

    // Fallback: ILIKE text search — this is DEGRADED, not normal
    log('WARN', 'DEGRADED: falling back to ILIKE text search — xinference unavailable or vector search failed. Semantic search is disabled. Check xinference container and XINFERENCE_ENDPOINT.');
    const fallback = await pool.query(
      `SELECT key, value, namespace, source_type, 0.5 AS score
       FROM memory_entries
       WHERE (namespace = $1 OR $1 = '*')
         AND ($3::text IS NULL OR source_type = $3)
         AND (key ILIKE $2 OR value::text ILIKE $2)
       ORDER BY created_at DESC LIMIT $4`,
      [namespace, `%${query}%`, st, limit],
    );
    const results = fallback.rows.map(r => ({
      key: r.key, value: parseVal(r.value), namespace: r.namespace,
      source_type: r.source_type, score: 0.5,
    }));
    notifyMemoryFlashBatch(results.slice(0, 5).map(r => ({ key: r.key, namespace: r.namespace || namespace, action: 'search' })));
    return { success: true, action: 'search', query, namespace, results, count: results.length, method: 'ilike-fallback', degraded: true, warning: 'Semantic search unavailable — using text substring match. Check xinference service.', storage: 'ruvector-postgres' };
  }

  return { memStore, memRetrieve, memList, memSearch };
}

// ── delegating (in-memory / sqlite) backend ─────────────────────────────────
// Wraps an injected memoryStore singleton. Exposes only the raw primitives;
// callers keep their own response-shape assembly so observable output is
// unchanged. The store/retrieve return the bare value (caller-shaped),
// list/search return the raw entry arrays.

function createDelegatingBackend(deps) {
  const { memoryStore } = deps;

  async function memStore(key, value, namespace = 'default', options = {}) {
    return memoryStore.store(key, value, { namespace, ...options });
  }
  async function memRetrieve(key, namespace = 'default', options = {}) {
    return memoryStore.retrieve(key, { namespace, ...options });
  }
  async function memList(namespace = 'default', limit = 100) {
    return memoryStore.list({ namespace, limit });
  }
  async function memSearch(query, namespace = 'default', limit = 50) {
    return memoryStore.search(query, { namespace, limit });
  }

  return { memStore, memRetrieve, memList, memSearch };
}

// ── factory ─────────────────────────────────────────────────────────────────

function createMemoryTools({ backend, deps }) {
  const sel = backend || process.env.AGENTBOX_MEMORY_ADAPTER || 'external-pg';
  switch (sel) {
    case 'external-pg':
      return createExternalPgBackend(deps);
    case 'embedded-ruvector':
    case 'in-memory':
    case 'sqlite':
    case 'off':
      return createDelegatingBackend(deps);
    default:
      throw new Error(`createMemoryTools: unknown backend "${sel}"`);
  }
}

module.exports = { createMemoryTools, createExternalPgBackend, createDelegatingBackend };
