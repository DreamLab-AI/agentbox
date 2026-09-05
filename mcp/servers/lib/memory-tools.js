'use strict';
/**
 * memory-tools.js — single-source memory tool logic for the agentbox MCP
 * memory server (ruvector-mcp.cjs). The legacy ESM mcp-server.js consumer
 * has been removed.
 *
 * This is a CommonJS module by design: ruvector-mcp.cjs requires it
 * directly. Keep it CommonJS.
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

const crypto = require('crypto');
const { gates, boolGate } = require('./ruvector-gates');
const { buildMetadata, VALID_TYPES, notExpiredPredicate, expiredPredicate } = require('./memory-metadata');

// ── ADR-2014 searchable-write guarantee (closeout 2026-09-05) ───────────────
// The store no longer degrades silently when the embedding transport fails.
// Two behaviours, one of which is always in force:
//
//   FAIL-CLOSED (default)  embedding failure REJECTS the write. Nothing is
//                          persisted, the caller sees `success:false` with
//                          reason 'embedding-unavailable'. No unsearchable row
//                          is ever created behind the caller's back.
//
//   DURABLE REPAIR         RUVECTOR_EMBED_REPAIR=1|true opts in to an EXPLICIT
//                          pending state: the row is written with a NULL vector
//                          AND a metadata marker (embedding_state:'pending',
//                          embedding_pending_since/-_reason) so it is
//                          enumerable and repairable, and the caller is told
//                          (`repair_pending:true`, `searchable:false`).
//                          memRepairEmbeddings() drives it back to searchable.
//
// In BOTH cases a replacement never inherits the previous value's vector: the
// ON CONFLICT clause assigns EXCLUDED.embedding rather than
// COALESCE(EXCLUDED.embedding, memory_entries.embedding), so the stored vector
// is either this value's or explicitly NULL. Value and vector versions can
// therefore never disagree — the failure the review reproduced.
const EMBED_PREFIX_CHARS = 2000;   // the prefix actually handed to the embedder
function embedRepairMode() { return boolGate('RUVECTOR_EMBED_REPAIR'); }
function embedModelId() { return process.env.EMBEDDING_MODEL || 'bge-small-en-v1.5'; }
function sha12(v) { return crypto.createHash('sha256').update(String(v), 'utf8').digest('hex').slice(0, 12); }

// ── ADR-2014 TTL semantics (closeout 2026-09-05) ────────────────────────────
// TTL is a VISIBILITY deadline for BOTH memory types. Every read path below
// appends NOT_EXPIRED so an expired row stops being returned the moment
// `expires_at` passes — retrieve, list, vector search, the ILIKE fallback and
// (via memory-hybrid.js) hybrid search. Deletion is the separate, later act of
// the sweep, which now covers semantic rows too. With no `expires_at` present
// (the whole corpus when RUVECTOR_TYPED_METADATA is off) the predicate is a
// constant TRUE, so the gate-off read plans are unchanged.
const NOT_EXPIRED = notExpiredPredicate('metadata');
const EXPIRED = expiredPredicate('metadata');

// ── ADR-040 W-C (Phase-C) retrieval-consumer constants (BINDING map §1.2/§3) ──
// One fixed global SONA scope (D4 / I22): never per-namespace, dimension-tagged
// 384-dim; a future 1024-dim corpus mints a FRESH scope, never reuses this one.
const SONA_SCOPE = 'agentbox_memory';
const EMBED_DIM = 384;
// Attention re-rank tunables — fixed by the map: overfetch limit*ATT_OVERFETCH
// candidates by HNSW cosine, blend ALPHA on the rescaled attention term, keep
// the top `limit`. att = cos/√dim on L2-normalised (bge) embeddings, so att_norm
// = att*√dim is cosine-comparable (V2). All default-off — reads only fire when a
// queen-wired gate flips (baseline byte-identical until then).
const ATT_OVERFETCH = 4;
const ATT_ALPHA = 0.5;
const ATT_SQRT_DIM = Math.sqrt(EMBED_DIM);

// ── headroom compression (PRD-016 / ADR-034) ───────────────────────────────
// Compress search results before returning to agents. Fail-open: if the addon
// is absent or init fails, results pass through uncompressed.
let _headroom = null;
function _getHeadroom() {
  if (_headroom !== null) return _headroom;
  try {
    const h = require('/opt/agentbox/lib/headroom/headroom_napi.node');
    h.initCompression({ backend: 'memory', ttlMinutes: 30, maxEntries: 1000, targetRatio: 0.15 });
    _headroom = h;
  } catch { _headroom = false; }
  return _headroom;
}
function _compressResults(results) {
  if (!results || results.length < 3) return results;
  const h = _getHeadroom();
  if (!h) return results;
  try {
    const raw = JSON.stringify(results);
    const cr = h.smartCrush(raw, { targetRatio: 0.3 });
    if (cr && cr.ratio < 1.0) return JSON.parse(cr.compressed);
  } catch { /* fail-open */ }
  return results;
}

// ── protected namespaces ────────────────────────────────────────────────────
// Namespaces listed here reject writes from non-admin callers. Prevents
// agents from injecting synthetic records into governance-critical stores
// (e.g. precedent namespace poisoning via memory_store).
const PROTECTED_NAMESPACES = new Set(
  (process.env.RUVECTOR_PROTECTED_NAMESPACES || 'governance-precedents').split(',').map(s => s.trim()).filter(Boolean)
);
const ADMIN_WRITE_ENABLED = process.env.RUVECTOR_ADMIN_WRITE === 'true';

function checkProtectedNamespace(namespace) {
  if (ADMIN_WRITE_ENABLED) return null;
  if (PROTECTED_NAMESPACES.has(namespace)) {
    return { success: false, error: `namespace "${namespace}" is write-protected (IR2 mandate-at-grant)`, storage: 'none' };
  }
  return null;
}

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

  // ADR-040 D5 (R-C7): param_tuning stays RESERVED in Phase C. One-shot log the
  // first time an operator flips its gate — the auto-tuner is documented, never
  // run — so the on-state is observable without spamming every search.
  let _paramTuningNotified = false;

  async function memStore(key, value, namespace = 'default', options = {}) {
    const guard = checkProtectedNamespace(namespace);
    if (guard) return guard;
    if (!getPgOk() || !pool) return { success: false, error: 'pg unavailable', storage: 'none' };
    const id = entryId(namespace, key);
    const jsonValue = typeof value === 'object' ? JSON.stringify(value) : value;
    let pgValue;
    try { JSON.parse(jsonValue); pgValue = jsonValue; } catch { pgValue = JSON.stringify(jsonValue); }
    const embedText = typeof value === 'string' ? value : JSON.stringify(value);
    const embedInput = embedText.substring(0, EMBED_PREFIX_CHARS);
    let embeddingClause = 'NULL';
    let embedded = false;
    let embedFailure = null;
    const params = [id, namespace, key, pgValue, writeSourceType];
    if (await xinfEnsure()) {
      try {
        const emb = await getEmbedding(embedInput);
        params.push(vecToSql(emb));
        embeddingClause = `$6::ruvector(384)`;
        embedded = true;
      } catch (e) {
        embedFailure = (e && e.message) || String(e);
        log('WARN', `embedding generation failed for store: ${embedFailure}`);
      }
    } else {
      embedFailure = 'xinference unavailable';
    }

    // ADR-2014: no silent unsearchable write. Reject unless the operator has
    // explicitly opted into the durable repair state.
    const repairMode = embedRepairMode();
    if (!embedded && !repairMode) {
      log('WARN', `store REJECTED (ADR-2014 fail-closed) for ${namespace}/${key}: ${embedFailure}`);
      return {
        success: false,
        action: 'store',
        key,
        namespace,
        stored: false,
        embedded: false,
        error: `embedding unavailable — write rejected (ADR-2014 fail-closed): ${embedFailure}`,
        reason: 'embedding-unavailable',
        remedy: 'restore the embedding service, or set RUVECTOR_EMBED_REPAIR=true to accept an explicit, repairable pending write',
        storage: 'none',
      };
    }

    // PRD-018 D3 typed metadata (gate RUVECTOR_TYPED_METADATA). Gate OFF and a
    // successful embedding → exact pre-2014 behaviour: metadata literal '{}'
    // (byte-identical to today). Gate ON → honour {importance,tags,memory_type,
    // ttl_seconds}, computing expires_at, and persist/refresh the metadata jsonb.
    // A REPAIR-mode unembedded write always carries metadata regardless of the
    // gate: the pending marker is what makes the row enumerable and repairable,
    // so it is not optional.
    const typed = gates.typedMetadata();
    const needsMetadata = typed || !embedded;
    let metadata = null;
    if (needsMetadata) {
      metadata = typed ? buildMetadata(options || {}) : {};
      // Bind the stored value to the stored vector: a reader can tell whether
      // the vector was computed from THIS value (embed_digest over the exact
      // embedded prefix) or whether the row is awaiting repair.
      metadata.value_digest = sha12(embedText);
      metadata.embed_prefix_chars = EMBED_PREFIX_CHARS;
      if (embedded) {
        metadata.embedding_state = 'embedded';
        metadata.embed_digest = sha12(embedInput);
        metadata.embed_model = embedModelId();
      } else {
        metadata.embedding_state = 'pending';
        metadata.embedding_pending_since = new Date().toISOString();
        metadata.embedding_pending_reason = embedFailure;
      }
    }

    if (needsMetadata) {
      params.push(JSON.stringify(metadata));
      const metaClause = `$${params.length}::jsonb`;
      await pool.query(
        `INSERT INTO memory_entries (id, namespace, key, value, source_type, metadata, embedding)
         VALUES ($1, $2, $3, $4::jsonb, $5, ${metaClause}, ${embeddingClause})
         ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, metadata = EXCLUDED.metadata, embedding = EXCLUDED.embedding, updated_at = NOW()`,
        params,
      );
    } else {
      await pool.query(
        `INSERT INTO memory_entries (id, namespace, key, value, source_type, metadata, embedding)
         VALUES ($1, $2, $3, $4::jsonb, $5, '{}', ${embeddingClause})
         ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, embedding = EXCLUDED.embedding, updated_at = NOW()`,
        params,
      );
    }
    notifyMemoryFlash({ key, namespace, action: 'store' });
    const out = { success: true, action: 'store', key, namespace, stored: true, embedded, storage: 'ruvector-postgres' };
    if (typed) out.metadata = metadata;
    if (!embedded) {
      // Explicit durable repair state — never presented as a normal success.
      out.repair_pending = true;
      out.searchable = false;
      out.reason = 'embedding-unavailable';
      out.warning = `stored WITHOUT an embedding (${embedFailure}) — the row is invisible to semantic search until memory_repair_embeddings repairs it (RUVECTOR_EMBED_REPAIR is on)`;
    }
    return out;
  }

  // ── ADR-2014 durable repair (closeout 2026-09-05) ──────────────────────────
  // Drive pending rows back to searchable. Finds rows with a NULL vector,
  // re-embeds from the STORED value (so the repaired vector always matches the
  // stored value, never a stale one) and clears the pending marker. Idempotent
  // (`WHERE embedding IS NULL` guards the update) and bounded. `dry_run` reports
  // the pending census without touching anything — the "expose pending/
  // unsearchable rows" half of the acceptance condition.
  async function memRepairEmbeddings(opts = {}) {
    if (!getPgOk() || !pool) return { success: false, action: 'repair_embeddings', error: 'pg unavailable' };
    const namespace = opts.namespace && opts.namespace !== '*' ? String(opts.namespace) : null;
    const limit = Math.max(1, Math.min(1000, Number(opts.limit) || 100));
    const dryRun = opts.dry_run === true || opts.dryRun === true;

    const countParams = [];
    let countNs = '';
    if (namespace) { countParams.push(namespace); countNs = `AND namespace = $${countParams.length}`; }
    const pendingOf = async () => {
      const r = await pool.query(
        `SELECT count(*)::int AS n FROM memory_entries WHERE embedding IS NULL ${countNs}`,
        countParams,
      );
      return (r.rows[0] && Number(r.rows[0].n)) || 0;
    };

    const pendingBefore = await pendingOf();
    if (dryRun) {
      return {
        success: true, action: 'repair_embeddings', dry_run: true,
        namespace: namespace || '*', pending: pendingBefore, repaired: 0,
        storage: 'ruvector-postgres',
      };
    }
    if (!(await xinfEnsure())) {
      return {
        success: false, action: 'repair_embeddings', namespace: namespace || '*',
        error: 'xinference unavailable — repair cannot run', repaired: 0,
        pending: pendingBefore, storage: 'ruvector-postgres',
      };
    }

    const selParams = [limit];
    let selNs = '';
    if (namespace) { selParams.push(namespace); selNs = `AND namespace = $${selParams.length}`; }
    const res = await pool.query(
      `SELECT id, namespace, key, value FROM memory_entries
        WHERE embedding IS NULL ${selNs}
        ORDER BY updated_at ASC
        LIMIT $1`,
      selParams,
    );

    let repaired = 0;
    const failures = [];
    for (const row of res.rows) {
      const text = typeof row.value === 'string' ? row.value : JSON.stringify(row.value);
      const input = text.substring(0, EMBED_PREFIX_CHARS);
      try {
        const emb = await getEmbedding(input);
        const upd = await pool.query(
          `UPDATE memory_entries
              SET embedding = $2::ruvector(384),
                  metadata = (COALESCE(metadata, '{}'::jsonb)
                               - 'embedding_pending_since' - 'embedding_pending_reason')
                             || jsonb_build_object(
                                  'embedding_state', 'embedded',
                                  'value_digest',    $3::text,
                                  'embed_digest',    $4::text,
                                  'embed_model',     $5::text,
                                  'embed_prefix_chars', $6::int,
                                  'embedding_repaired_at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
                  updated_at = NOW()
            WHERE id = $1 AND embedding IS NULL`,
          [row.id, vecToSql(emb), sha12(text), sha12(input), embedModelId(), EMBED_PREFIX_CHARS],
        );
        if (upd.rowCount > 0) repaired++;
      } catch (e) {
        failures.push({ id: row.id, namespace: row.namespace, key: row.key, error: (e && e.message) || String(e) });
      }
    }

    const pendingAfter = await pendingOf();
    return {
      success: failures.length === 0,
      action: 'repair_embeddings',
      namespace: namespace || '*',
      scanned: res.rows.length,
      repaired,
      failed: failures.length,
      failures: failures.slice(0, 10),
      pending_before: pendingBefore,
      pending: pendingAfter,
      storage: 'ruvector-postgres',
    };
  }

  async function memRetrieve(key, namespace = 'default') {
    if (!getPgOk() || !pool) return { success: false, error: 'pg unavailable' };
    const res = await pool.query(
      `SELECT key, value, source_type FROM memory_entries
        WHERE namespace = $1 AND key = $2 AND ${NOT_EXPIRED}
        ORDER BY updated_at DESC LIMIT 1`,
      [namespace, key],
    );
    if (!res.rows.length) return { success: true, action: 'retrieve', key, namespace, value: null, found: false };
    notifyMemoryFlash({ key, namespace, action: 'retrieve' });
    return { success: true, action: 'retrieve', key, namespace, value: parseVal(res.rows[0].value), found: true, source_type: res.rows[0].source_type, storage: 'ruvector-postgres' };
  }

  async function memList(namespace = 'default', limit = 100) {
    if (!getPgOk() || !pool) return { success: false, error: 'pg unavailable' };
    const res = await pool.query(
      `SELECT key, value, source_type FROM memory_entries
        WHERE namespace = $1 AND ${NOT_EXPIRED}
        ORDER BY created_at DESC LIMIT $2`,
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
        let queryEmb = await getEmbedding(query.substring(0, 2000));

        // ── ADR-040 D4 — SONA apply (gate RUVECTOR_SONA_APPLY_ENABLED, §3.2) ──────
        // Pre-scoring transform of the QUERY embedding via ruvector_sona_apply,
        // applied ONCE before both the baseline and the attention SQL (both key off
        // the same $1 query vector). The extension is dimension-preserving and
        // fail-safe: it returns the input UNCHANGED when no weights are learned
        // (V4/V5) — so an unlearned engine is a guaranteed no-op and this needs no
        // application-level fallback beyond the try/catch. Fail-open: any error, or
        // a non-384 return (dim guard), keeps the raw query embedding. The gate
        // stays OFF until sona_health shows accumulation AND a harness PASS
        // (I14 / R-C2 / R-C9); landing this plumbing does not flip it.
        if (boolGate('RUVECTOR_SONA_APPLY_ENABLED')) {
          try {
            const r = await pool.query('SELECT ruvector_sona_apply($1, $2::real[]) AS v', [SONA_SCOPE, queryEmb]);
            const v = r.rows && r.rows[0] && r.rows[0].v;
            if (Array.isArray(v) && v.length === EMBED_DIM) queryEmb = v.map(Number); // transformed query
          } catch (e) { log('WARN', `sona_apply failed, using raw query: ${e.message}`); }
        }

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
            WHERE embedding IS NOT NULL AND ${NOT_EXPIRED} ${nsFilter} ${stFilter}
          )
          SELECT key, value, namespace, source_type,
                 1.0 - (embedding <=> $1::ruvector(384)) AS score
          FROM ns
          ORDER BY embedding <=> $1::ruvector(384)
          LIMIT $2` : `
          SELECT key, value, namespace, source_type,
                 1.0 - (embedding <=> $1::ruvector(384)) AS score
          FROM memory_entries
          WHERE embedding IS NOT NULL AND ${NOT_EXPIRED}
          ORDER BY embedding <=> $1::ruvector(384)
          LIMIT $2`;

        // ── ADR-040 D5 — param_tuning (gate RUVECTOR_PARAM_TUNING_ENABLED) RESERVED ──
        // Declared and designed, functionally reserved (§2 / R-C7). The src/learning
        // HNSW ef_search/probes auto-tuner is NOT wired into the hot path in Phase C;
        // baseline traversal is unchanged even when the gate is on. Verified reserved
        // signatures (V7), for the future integration:
        //   ruvector_enable_learning(table, config jsonb)
        //   ruvector_record_feedback(table, query_vector real[], relevant_ids bigint[], irrelevant_ids bigint[])
        //     — matches by EXACT query_vector equality vs the 10 most-recent trajectories
        //   ruvector_auto_tune(table, optimize_for), ruvector_learning_stats(table)
        // Unblock: (a) client-side exact-query-embedding cache; (b) the latency/recall
        // slice of the W-B harness; (c) recorded query-trajectory volume per scope.
        if (boolGate('RUVECTOR_PARAM_TUNING_ENABLED') && !_paramTuningNotified) {
          _paramTuningNotified = true;
          log('INFO', 'RUVECTOR_PARAM_TUNING_ENABLED ON but RESERVED (ADR-040 D5) — HNSW ef_search/probes auto-tuner not activated in Phase C; baseline traversal unchanged (see memSearch scaffold comment for the verified reserved signatures + unblock conditions).');
        }

        // ── ADR-040 D3 — attention re-rank (gate RUVECTOR_ATTENTION_RERANK, §1) ───
        // Overfetch limit*ATT_OVERFETCH candidates by HNSW cosine, blend the
        // rescaled attention term, re-sort, truncate to `limit`. Fail-open: ANY
        // error (missing function, cast failure, timeout) falls through to the
        // baseline cosine `sql` below — the guaranteed floor (§1.3). Result item
        // shape stays byte-identical and `score` stays the cosine value (§1.4);
        // only the ORDER of the returned rows may change, and only when the gate
        // is on. A/B attribution rides `_attention` (present ONLY when the gate is
        // on → gate-off output is byte-identical to Phase 0).
        if (boolGate('RUVECTOR_ATTENTION_RERANK')) {
          try {
            const attSql = (nsFilter || stFilter) ? `
              WITH ns AS MATERIALIZED (
                SELECT key, value, namespace, source_type, embedding
                FROM memory_entries
                WHERE embedding IS NOT NULL AND ${NOT_EXPIRED} ${nsFilter} ${stFilter}
              ),
              cand AS (
                SELECT key, value, namespace, source_type, embedding,
                       1.0 - (embedding <=> $1::ruvector(384)) AS cos
                FROM ns
                ORDER BY embedding <=> $1::ruvector(384)
                LIMIT $2 * ${ATT_OVERFETCH}
              ),
              q AS (SELECT translate($1::ruvector(384)::text,'[]','{}')::real[] AS qv)
              SELECT key, value, namespace, source_type, cos,
                     attention_score((SELECT qv FROM q), translate(embedding::text,'[]','{}')::real[]) AS att
              FROM cand` : `
              WITH cand AS (
                SELECT key, value, namespace, source_type, embedding,
                       1.0 - (embedding <=> $1::ruvector(384)) AS cos
                FROM memory_entries
                WHERE embedding IS NOT NULL AND ${NOT_EXPIRED}
                ORDER BY embedding <=> $1::ruvector(384)
                LIMIT $2 * ${ATT_OVERFETCH}
              ),
              q AS (SELECT translate($1::ruvector(384)::text,'[]','{}')::real[] AS qv)
              SELECT key, value, namespace, source_type, cos,
                     attention_score((SELECT qv FROM q), translate(embedding::text,'[]','{}')::real[]) AS att
              FROM cand`;

            const attRes = await pool.query(attSql, params);
            const cands = attRes.rows.map(r => ({
              key: r.key, value: parseVal(r.value), namespace: r.namespace,
              source_type: r.source_type, score: parseFloat(r.cos),
              _cos: parseFloat(r.cos), _att: parseFloat(r.att),
            }));
            // Pure-cosine order (desc) — the baseline top-k, for delta attribution.
            const cosineTop = cands.slice().sort((a, b) => b._cos - a._cos).slice(0, limit).map(c => c.key);
            // Blend the attention term back onto a cosine-comparable scale (V2) and
            // score it as the semantic term inside the hybrid — NOT on cos alone.
            for (const c of cands) c._final = (1 - ATT_ALPHA) * c._cos + ATT_ALPHA * (c._att * ATT_SQRT_DIM);
            const reranked = cands.slice().sort((a, b) => b._final - a._final).slice(0, limit);
            const rerankedTop = reranked.map(c => c.key);
            let reordered = 0;
            for (let i = 0; i < rerankedTop.length; i++) if (rerankedTop[i] !== cosineTop[i]) reordered++;
            const cosineSet = new Set(cosineTop);
            const enteredTopK = rerankedTop.filter(k => !cosineSet.has(k));
            // Strip internals — the returned item is byte-identical to baseline and
            // `score` stays the cosine value (never leak the blended internal).
            const results = reranked.map(({ _cos, _att, _final, ...rest }) => rest);
            notifyMemoryFlashBatch(results.slice(0, 5).map(r => ({ key: r.key, namespace: r.namespace || namespace, action: 'search' })));
            return {
              success: true, action: 'search', query, namespace,
              results: _compressResults(results), count: results.length,
              method: 'hnsw-xinference', storage: 'ruvector-postgres',
              _attention: {
                alpha: ATT_ALPHA, overfetch: ATT_OVERFETCH,
                candidates: cands.length, returned: results.length,
                reordered, entered_top_k: enteredTopK,
                baseline_top: cosineTop, reranked_top: rerankedTop,
                note: 'attention_score = cos/√dim is monotone-with-cosine on L2-normalised embeddings; reordered≈0 on a pure-cosine candidate set is a correct D3 result (ADR-040 R-C1), not a defect — the term earns its keep only once the candidate set carries a non-cosine axis (sona_apply / hybrid importance+recency).',
              },
            };
          } catch (attErr) {
            log('WARN', `attention_rerank failed, falling back to baseline cosine order: ${attErr.message}`);
          }
        }

        const res = await pool.query(sql, params);
        const results = res.rows.map(r => ({
          key: r.key, value: parseVal(r.value), namespace: r.namespace,
          source_type: r.source_type, score: parseFloat(r.score),
        }));
        notifyMemoryFlashBatch(results.slice(0, 5).map(r => ({ key: r.key, namespace: r.namespace || namespace, action: 'search' })));
        return { success: true, action: 'search', query, namespace, results: _compressResults(results), count: results.length, method: 'hnsw-xinference', storage: 'ruvector-postgres' };
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
         AND ${NOT_EXPIRED}
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
    return { success: true, action: 'search', query, namespace, results: _compressResults(results), count: results.length, method: 'ilike-fallback', degraded: true, warning: 'Semantic search unavailable — using text substring match. Check xinference service.', storage: 'ruvector-postgres' };
  }

  // ── delete + episodic TTL sweep (PRD-018 D3, gate RUVECTOR_EPISODIC_TTL_SWEEP)
  // Implements the previously-unimplemented delete case and honours the
  // typed-metadata TTL by sweeping expired episodic rows. Fail-closed on
  // PROTECTED_NAMESPACES unless RUVECTOR_ADMIN_WRITE=true (I-GOV).

  async function memDelete(key, namespace = 'default') {
    const guard = checkProtectedNamespace(namespace);
    if (guard) return { ...guard, action: 'delete' };
    if (!getPgOk() || !pool) return { success: false, error: 'pg unavailable' };
    const id = entryId(namespace, key);
    const res = await pool.query(`DELETE FROM memory_entries WHERE id = $1`, [id]);
    notifyMemoryFlash({ key, namespace, action: 'delete' });
    return { success: true, action: 'delete', key, namespace, deleted: res.rowCount, storage: 'ruvector-postgres' };
  }

  // ADR-2014 closeout: the sweep is the DELETION half of TTL and now covers
  // BOTH memory types (the review's finding was that a TTL-only write defaults
  // to `semantic` and was therefore never deleted, leaving an expiry timestamp
  // that nothing acted on). `types` narrows it back to one type deliberately;
  // an unrecognised type list is rejected rather than silently widened.
  // Visibility already ended at `expires_at` (see NOT_EXPIRED), so a missed
  // sweep delays erasure — it never resurrects an expired row.
  async function memSweepEpisodic(namespace = null, opts = {}) {
    if (!getPgOk() || !pool) return { success: false, error: 'pg unavailable' };
    const admin = ADMIN_WRITE_ENABLED;
    if (namespace && !admin && PROTECTED_NAMESPACES.has(namespace)) {
      return { success: false, action: 'sweep', namespace, error: `namespace "${namespace}" is write-protected`, swept: 0 };
    }
    let types = null;
    if (opts && Array.isArray(opts.types) && opts.types.length) {
      types = opts.types.filter((t) => VALID_TYPES.has(t));
      if (types.length !== opts.types.length) {
        return {
          success: false, action: 'sweep', namespace: namespace || '*', swept: 0,
          error: `unknown memory_type in types=[${opts.types.join(',')}] (valid: ${Array.from(VALID_TYPES).join(', ')})`,
        };
      }
    }
    const params = [];
    let typeClause = '';
    if (types) {
      params.push(types);
      // An absent memory_type reads as the documented default 'semantic'.
      typeClause = `AND COALESCE(metadata->>'memory_type', 'semantic') = ANY($${params.length})`;
    }
    let nsClause = '';
    if (namespace) { params.push(namespace); nsClause = `AND namespace = $${params.length}`; }
    let protClause = '';
    const protectedList = Array.from(PROTECTED_NAMESPACES);
    if (!admin && protectedList.length) { params.push(protectedList); protClause = `AND NOT (namespace = ANY($${params.length}))`; }
    const res = await pool.query(
      `DELETE FROM memory_entries
        WHERE ${EXPIRED}
          ${typeClause} ${nsClause} ${protClause}`,
      params,
    );
    return {
      success: true, action: 'sweep', namespace: namespace || '*',
      types: types || Array.from(VALID_TYPES),
      swept: res.rowCount, storage: 'ruvector-postgres',
    };
  }

  // ── ADR-040 D4 — SONA health (read-only diagnostics, §3.3) ──────────────────
  // Read-only sibling of memory_health over ruvector_sona_stats/_ewc_status for
  // the single global 'agentbox_memory' scope. Fail-open: ANY error → {available:
  // false} (never surfaces to break a caller). NO remediation. Surfaces alarm
  // fields (never auto-acts): trajectories_dropped climbing, buffer_success_rate
  // falling, and (R-C2) engine-not-accumulating (buffered==0 && stored==0 after
  // feeds → do NOT enable sona_apply). A cold read lazily creates a 256-dim
  // default engine (in-process only, no durable write); it is labelled
  // state:'cold'. The exposed engine hardcodes embedding_dim=256 (V5) — the
  // mismatch vs the 384-dim corpus is surfaced as an advisory, never acted on.
  async function memSonaHealth() {
    if (!getPgOk() || !pool) return { success: false, action: 'sona_health', available: false, error: 'pg unavailable' };
    try {
      const res = await pool.query(
        `SELECT ruvector_sona_stats($1)     AS stats,
                ruvector_sona_ewc_status($1) AS ewc`,
        [SONA_SCOPE],
      );
      const row = res.rows[0] || {};
      const stats = row.stats || {};
      const ewc = row.ewc || {};
      const num = (v) => (v === null || v === undefined ? null : (typeof v === 'number' ? v : Number(v)));
      const pick = (k) => num(stats[k] !== undefined ? stats[k] : ewc[k]);
      const trajectories_buffered = pick('trajectories_buffered');
      const patterns_stored = pick('patterns_stored');
      const embedding_dim = num(stats.embedding_dim);
      const cold = (trajectories_buffered === 0 || trajectories_buffered === null)
                && (patterns_stored === 0 || patterns_stored === null);
      const dimMismatch = embedding_dim !== null && embedding_dim !== EMBED_DIM;
      return {
        success: true,
        action: 'sona_health',
        available: true,
        scope: SONA_SCOPE,
        state: cold ? 'cold' : 'warming',
        ewc_tasks:            pick('ewc_tasks'),
        trajectories_buffered,
        trajectories_dropped: pick('trajectories_dropped'),
        patterns_stored,
        buffer_success_rate:  pick('buffer_success_rate'),
        embedding_dim,
        hidden_dim:           num(stats.hidden_dim),
        corpus_embedding_dim: EMBED_DIM,
        // Advisories — surface only, never auto-act (ADR-040 D4 read-only rule).
        advisories: {
          engine_not_accumulating: cold,         // R-C2: do NOT enable sona_apply while cold
          embedding_dim_mismatch:  dimMismatch,  // V5: exposed engine hardcodes 256 vs 384 corpus
          apply_safe_to_enable:    false,        // flip is harness-authorised only (I14 / R-C9)
        },
        storage: 'ruvector-postgres',
        checked_at: new Date().toISOString(),
      };
    } catch (err) {
      log('WARN', `sona_health check failed: ${err.message}`);
      return { success: false, action: 'sona_health', available: false, error: err.message };
    }
  }

  return { memStore, memRetrieve, memList, memSearch, memDelete, memSweepEpisodic, memRepairEmbeddings, memSonaHealth };
}

// ── delegating (in-memory / sqlite) backend ─────────────────────────────────
// Wraps an injected memoryStore singleton. Exposes only the raw primitives;
// callers keep their own response-shape assembly so observable output is
// unchanged. The store/retrieve return the bare value (caller-shaped),
// list/search return the raw entry arrays.

function createDelegatingBackend(deps) {
  const { memoryStore } = deps;

  async function memStore(key, value, namespace = 'default', options = {}) {
    const guard = checkProtectedNamespace(namespace);
    if (guard) return guard;
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
