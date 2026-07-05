'use strict';
/**
 * memory-hybrid.js — DIY hybrid fusion + cold-start orient bundle for the
 * governed memory MCP server (PRD-018 D1/D3/D4, ADR-036, DDD-016).
 *
 *   memHybridSearch (gate RUVECTOR_HYBRID_SEARCH)
 *     Namespace-scoped fusion, verified live against ruvector 0.3.0. Ranking:
 *       composite = 0.6·cos_sim + 0.2·importance + 0.2·recency
 *       score     = ruvector_hybrid_score(1 − composite, ts_rank(kw), alpha)
 *     i.e. the extension's fusion helper blends the composite similarity
 *     (as a pseudo-distance) with builtin-FTS keyword relevance
 *     (`websearch_to_tsquery` over `value::text`). Recency is a half-life decay
 *     on `updated_at` (RUVECTOR_RECENCY_HALF_LIFE_DAYS, default 14).
 *
 *     HYBRID GUARD (ADR-036 D4): the FTS keyword blend runs an *unindexed*
 *     `ts_rank(to_tsvector(value::text))` over the scanned set. It is only run
 *     when the namespace scopes the scan to a small subset. When the namespace
 *     is absent or '*', the keyword term is dropped entirely and rows are ranked
 *     by composite (vector+importance+recency) only, over an HNSW candidate
 *     prefetch — never the full-corpus (2.06M-row) sequential scan.
 *
 *     TAG FILTER (ADR-036 D4): an optional `tags` array narrows the scan with
 *     `metadata @> {"tags":[…]}` (parameterised), a bitmap index scan once the
 *     gin(metadata jsonb_path_ops) index is built (`build-metadata-gin`).
 *
 *     EFFECTIVENESS RE-RANK (gate RUVECTOR_FEED_RETRIEVAL, ADR-036 D1 §feed):
 *     when on, one extra query reads the `memory-learning-aggregates` namespace;
 *     any result row whose `metadata.tags` intersect a high-effectiveness
 *     aggregate's `action:<pattern>` tag gets a bounded bonus of
 *       + 0.1 · wilson         (wilson = the aggregate's importance = its
 *                               Wilson-lower-bound success rate, ∈ [0,1])
 *     added to its score, then the set is re-sorted. FAIL-OPEN: any error in the
 *     aggregate read leaves the base ranking untouched (no bonus).
 *
 *     FAIL-OPEN base path: any error → degrade to the pure-vector search path
 *     (which itself degrades to ILIKE), so behaviour never regresses below today.
 *
 *   memOrient (gate RUVECTOR_MEMORY_ORIENT)
 *     Read-only OODA cold-start bundle in one round-trip: top-k semantic memories
 *     for the task string (HNSW), effectiveness aggregates from the
 *     'memory-learning-aggregates' namespace, and recent episodic entries for the
 *     session namespace. The aggregates bucket is populated ONLY when
 *     RUVECTOR_FEED_ROUTING is on (ADR-036 D1 §feed_routing); with the gate off
 *     the bucket is an empty array plus a note. FAIL-OPEN → empty bundle on error.
 *
 * Dependencies are injected (pool, embedding transport, helpers) so this module
 * owns no connection or transport — same discipline as memory-tools.js.
 */

const { params: gateParams, gates } = require('./ruvector-gates');

const AGG_NAMESPACE = 'memory-learning-aggregates';

function createHybridTools(deps) {
  const { pool, getPgOk, getEmbedding, xinfEnsure, vecToSql, parseVal, log, memSearch } = deps;

  // ── effectiveness re-rank (gate RUVECTOR_FEED_RETRIEVAL) ────────────────────
  // One bounded read over the aggregates namespace; adds +0.1·wilson to any row
  // whose metadata tags intersect a high-effectiveness aggregate's action tag.
  // Fail-open: any error leaves the base ranking untouched.
  async function applyEffectivenessBonus(results) {
    if (!gates.feedRetrieval() || !results || !results.length) return results;
    try {
      const aggRes = await pool.query(
        `SELECT metadata->'tags' AS tags,
                COALESCE((metadata->>'importance')::float, 0) AS wilson
           FROM memory_entries
          WHERE namespace = $1 AND metadata ? 'tags'
          ORDER BY (metadata->>'importance')::float DESC NULLS LAST
          LIMIT 500`,
        [AGG_NAMESPACE],
      );
      // tag → max wilson across aggregates carrying that action tag.
      const tagWilson = new Map();
      for (const row of aggRes.rows) {
        const w = parseFloat(row.wilson) || 0;
        if (w <= 0) continue;
        const tags = Array.isArray(row.tags) ? row.tags : [];
        for (const t of tags) {
          if (typeof t === 'string' && t.startsWith('action:')) {
            if (!tagWilson.has(t) || tagWilson.get(t) < w) tagWilson.set(t, w);
          }
        }
      }
      if (!tagWilson.size) return results;
      for (const r of results) {
        const rtags = r.metadata && Array.isArray(r.metadata.tags) ? r.metadata.tags : [];
        let best = 0;
        for (const t of rtags) { const w = tagWilson.get(t); if (w && w > best) best = w; }
        if (best > 0) {
          const bonus = 0.1 * best;
          r.score = (Number(r.score) || 0) + bonus;
          r.components = r.components || {};
          r.components.effectiveness_bonus = bonus;
        }
      }
    } catch (err) {
      log('WARN', `feed_retrieval re-rank skipped (fail-open): ${err.message}`);
    }
    return results;
  }

  async function memHybridSearch(query, namespace = 'default', limit = 10, opts = {}) {
    const alpha = Number.isFinite(opts.alpha) ? Math.min(1, Math.max(0, opts.alpha)) : 0.5;
    const halfLife = gateParams.recencyHalfLifeDays();
    const sourceType = opts.sourceType && opts.sourceType !== '*' ? opts.sourceType : null;
    const tags = Array.isArray(opts.tags)
      ? opts.tags.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim())
      : [];
    // HYBRID GUARD: FTS keyword blend only when the namespace scopes the scan.
    const scoped = !!(namespace && namespace !== '*');

    // Need an embedding + a live pool to fuse; otherwise degrade to memSearch.
    if (getPgOk() && pool && (await xinfEnsure())) {
      try {
        const queryVec = vecToSql(await getEmbedding(String(query).substring(0, 2000)));
        let res;

        if (scoped) {
          // ── namespace-scoped: full DIY fusion incl. FTS keyword blend ──
          const p = [queryVec, namespace];
          let stClause = '';
          if (sourceType) { p.push(sourceType); stClause = `AND source_type = $${p.length}`; }
          let tagClause = '';
          if (tags.length) { p.push(JSON.stringify({ tags })); tagClause = `AND metadata @> $${p.length}::jsonb`; }
          p.push(String(query || '')); const qIdx = p.length;   // FTS query text
          p.push(halfLife);            const hlIdx = p.length;   // recency half-life days
          p.push(alpha);               const aIdx = p.length;    // fusion alpha
          p.push(limit);               const lIdx = p.length;

          const sql = `
            WITH scoped AS MATERIALIZED (
              SELECT key, value, namespace, source_type, metadata, embedding, updated_at
              FROM memory_entries
              WHERE embedding IS NOT NULL AND namespace = $2 ${stClause} ${tagClause}
            ),
            scored AS (
              SELECT key, value, namespace, source_type, metadata,
                (1.0 - (embedding <=> $1::ruvector(384)))::float AS vec_sim,
                COALESCE((metadata->>'importance')::float, 0.5) AS importance,
                power(0.5, GREATEST(EXTRACT(EPOCH FROM (now() - updated_at)), 0)/86400.0/$${hlIdx})::float AS recency,
                ts_rank(to_tsvector('english', value::text),
                        websearch_to_tsquery('english', $${qIdx}))::float AS kw
              FROM scoped
            )
            SELECT key, value, namespace, source_type, metadata, vec_sim, importance, recency, kw,
              ruvector_hybrid_score(
                (1.0 - (0.6*vec_sim + 0.2*importance + 0.2*recency))::real,
                kw::real, $${aIdx}::real) AS score
            FROM scored
            ORDER BY score DESC
            LIMIT $${lIdx}`;
          res = await pool.query(sql, p);
        } else {
          // ── unscoped (namespace absent/'*'): vector+importance+recency only,
          // no FTS. HNSW candidate prefetch keeps this off the full-corpus seq
          // scan; optional source_type/tags narrow the candidate WHERE. ──
          const p = [queryVec];
          let stClause = '';
          if (sourceType) { p.push(sourceType); stClause = `AND source_type = $${p.length}`; }
          let tagClause = '';
          if (tags.length) { p.push(JSON.stringify({ tags })); tagClause = `AND metadata @> $${p.length}::jsonb`; }
          p.push(halfLife);  const hlIdx = p.length;
          const overfetch = Math.min(2000, Math.max(limit * 5, limit));
          p.push(overfetch); const ofIdx = p.length;
          p.push(limit);     const lIdx = p.length;

          const sql = `
            WITH cand AS (
              SELECT key, value, namespace, source_type, metadata,
                (1.0 - (embedding <=> $1::ruvector(384)))::float AS vec_sim,
                COALESCE((metadata->>'importance')::float, 0.5) AS importance,
                power(0.5, GREATEST(EXTRACT(EPOCH FROM (now() - updated_at)), 0)/86400.0/$${hlIdx})::float AS recency
              FROM memory_entries
              WHERE embedding IS NOT NULL ${stClause} ${tagClause}
              ORDER BY embedding <=> $1::ruvector(384)
              LIMIT $${ofIdx}
            )
            SELECT key, value, namespace, source_type, metadata, vec_sim, importance, recency,
              0.0::float AS kw,
              (0.6*vec_sim + 0.2*importance + 0.2*recency)::float AS score
            FROM cand
            ORDER BY score DESC
            LIMIT $${lIdx}`;
          res = await pool.query(sql, p);
        }

        let results = res.rows.map((r) => ({
          key: r.key, value: parseVal(r.value), namespace: r.namespace,
          source_type: r.source_type,
          metadata: r.metadata || {},
          score: parseFloat(r.score),
          components: {
            vector: parseFloat(r.vec_sim),
            importance: parseFloat(r.importance),
            recency: parseFloat(r.recency),
            keyword: parseFloat(r.kw),
          },
        }));

        // Effectiveness re-rank (gate RUVECTOR_FEED_RETRIEVAL); fail-open.
        results = await applyEffectivenessBonus(results);
        // Re-sort — the bonus may have reordered rows (no-op when no bonus).
        results.sort((a, b) => b.score - a.score);
        if (results.length > limit) results = results.slice(0, limit);

        return {
          success: true, action: 'hybrid_search', query, namespace,
          results, count: results.length, alpha, scoped,
          method: scoped ? 'hybrid-fusion' : 'hybrid-fusion-vectoronly',
          storage: 'ruvector-postgres',
        };
      } catch (err) {
        log('WARN', `hybrid search failed, degrading to vector search: ${err.message}`);
      }
    }

    // FAIL-OPEN: degrade to the existing pure-vector (then ILIKE) path.
    const fb = await memSearch(query, namespace, limit, sourceType);
    if (fb && fb.success) fb.degraded_from = 'hybrid_search';
    return fb;
  }

  async function memOrient(task, namespace = 'default', opts = {}) {
    const semLimit = Number.isFinite(opts.semanticLimit) ? opts.semanticLimit : 8;
    const aggLimit = Number.isFinite(opts.aggregateLimit) ? opts.aggregateLimit : 10;
    const epiLimit = Number.isFinite(opts.episodicLimit) ? opts.episodicLimit : 10;
    // Aggregates bucket only surfaces when routing feed is on (ADR-036 D1 §feed).
    const routing = gates.feedRouting();
    const empty = {
      success: true, action: 'orient', task, namespace,
      semantic: [], aggregates: [], episodic: [], storage: 'ruvector-postgres',
    };

    if (!getPgOk() || !pool) return { ...empty, degraded: true, warning: 'pg unavailable' };

    try {
      let semanticVec = null;
      if (await xinfEnsure()) {
        try { semanticVec = vecToSql(await getEmbedding(String(task).substring(0, 2000))); } catch { /* no vector → skip semantic bucket */ }
      }

      // Single CTE bundle. Semantic bucket only when we have a query vector.
      const semCte = semanticVec
        ? `sem AS (
             SELECT key, value, namespace, source_type,
                    (1.0 - (embedding <=> $1::ruvector(384)))::float AS score
             FROM memory_entries
             WHERE embedding IS NOT NULL
               AND (metadata->>'memory_type') IS DISTINCT FROM 'episodic'
             ORDER BY embedding <=> $1::ruvector(384)
             LIMIT $2
           )`
        : `sem AS (SELECT NULL::text AS key, NULL::jsonb AS value, NULL::text AS namespace, NULL::text AS source_type, NULL::float AS score WHERE false)`;

      const p = [];
      if (semanticVec) { p.push(semanticVec); p.push(semLimit); }

      // Aggregates CTE: real query only under feed_routing; otherwise a typed
      // no-op so the UNION shape stays constant and the bucket returns empty.
      let aggCte;
      if (routing) {
        p.push(aggLimit); const aggL = `$${p.length}`;
        aggCte = `agg AS (
          SELECT key, value FROM memory_entries
          WHERE namespace = '${AGG_NAMESPACE}'
          ORDER BY updated_at DESC LIMIT ${aggL}
        )`;
      } else {
        aggCte = `agg AS (SELECT NULL::text AS key, NULL::jsonb AS value WHERE false)`;
      }

      p.push(namespace); const nsP = `$${p.length}`;
      p.push(epiLimit);  const epiL = `$${p.length}`;

      const sql = `
        WITH ${semCte},
        ${aggCte},
        epi AS (
          SELECT key, value FROM memory_entries
          WHERE namespace = ${nsP} AND (metadata->>'memory_type') = 'episodic'
          ORDER BY updated_at DESC LIMIT ${epiL}
        )
        SELECT 'semantic' AS bucket, key, value, score::float AS score FROM sem
        UNION ALL SELECT 'aggregate' AS bucket, key, value, NULL::float FROM agg
        UNION ALL SELECT 'episodic' AS bucket, key, value, NULL::float FROM epi`;

      const res = await pool.query(sql, p);
      const bundle = { ...empty };
      for (const r of res.rows) {
        if (r.key === null) continue;
        const item = { key: r.key, value: parseVal(r.value) };
        if (r.bucket === 'semantic') { item.score = parseFloat(r.score); bundle.semantic.push(item); }
        else if (r.bucket === 'aggregate') bundle.aggregates.push(item);
        else bundle.episodic.push(item);
      }
      if (!routing) bundle.aggregates_note = 'feed_routing off — effectiveness aggregates omitted from orient bundle';
      return bundle;
    } catch (err) {
      log('WARN', `orient failed, returning empty bundle: ${err.message}`);
      return { ...empty, degraded: true, warning: err.message };
    }
  }

  return { memHybridSearch, memOrient };
}

module.exports = { createHybridTools, AGG_NAMESPACE };
