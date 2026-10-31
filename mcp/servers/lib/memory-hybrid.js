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
 *     RANK FUSION (env RUVECTOR_HYBRID_FUSION=rrf, default 'blend' = the above):
 *     the namespace-scoped path instead fuses two RANK lists, the vector side
 *     (cosine order) and the FTS side (rows with a keyword match, ts_rank
 *     order), by reciprocal rank fusion, score = sum 1/(60 + rank). Raw scores
 *     from the two sides are never compared; rows are deduplicated by row id.
 *     The unscoped path has no FTS list (HYBRID GUARD) so it is unchanged.
 *     importance/recency are not rank signals under rrf (they stay in
 *     `components`), and the FEED_RETRIEVAL effectiveness bonus is WITHHELD under
 *     rrf: it is an absolute score delta (+0.1*wilson) that dwarfs the whole RRF
 *     score range (<= 2/61), so adding it would re-introduce raw-score mixing.
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

const { params: gateParams, gates, consumerAdmission } = require('./ruvector-gates');
const { notExpiredPredicate } = require('./memory-metadata');

// ADR-2014 closeout: TTL is a visibility deadline on every read path, hybrid
// included — otherwise an expired row denied by memSearch reappears here.
const NOT_EXPIRED = notExpiredPredicate('metadata');

const AGG_NAMESPACE = 'memory-learning-aggregates';

/** Standard RRF damping constant (Cormack et al. 2009). */
const RRF_K = 60;

/**
 * Reciprocal rank fusion over ranked lists. Pure and deterministic.
 *
 * Each list is an array of items in rank order (best first); an item is
 * identified by `item.id`. An item's fused score is the sum over the lists it
 * appears in of 1 / (k + rank), rank starting at 1. Raw scores are never read.
 * An id repeated within one list counts once, at its best (first) rank. Ties on
 * the fused score are broken by best single rank, then by id, so the output
 * order is stable. The returned items are the first-seen object for each id,
 * shallow-copied with `rrf` = { score, ranks: [rank-or-null per list] }.
 *
 * @param {Array<Array<{id: (string|number)}>>} lists ranked lists, best first
 * @param {{k?: number, limit?: number}} [opts]
 * @returns {Array<object>} fused items, best first
 */
function fuseRrf(lists, opts = {}) {
  const k = Number.isFinite(opts.k) && opts.k > 0 ? opts.k : RRF_K;
  const byId = new Map();
  (lists || []).forEach((list, li) => {
    let rank = 0;
    for (const item of list || []) {
      if (!item || item.id === undefined || item.id === null) continue;
      const id = String(item.id);
      let e = byId.get(id);
      if (!e) {
        e = { item, score: 0, ranks: new Array(lists.length).fill(null) };
        byId.set(id, e);
      }
      if (e.ranks[li] !== null) continue; // duplicate within a list: keep best rank
      rank += 1;
      e.ranks[li] = rank;
      e.score += 1 / (k + rank);
    }
  });
  const best = (e) => Math.min(...e.ranks.filter((r) => r !== null));
  const out = [...byId.entries()]
    .sort(([ia, a], [ib, b]) => (b.score - a.score) || (best(a) - best(b)) || (ia < ib ? -1 : ia > ib ? 1 : 0))
    .map(([, e]) => ({ ...e.item, rrf: { score: e.score, ranks: e.ranks } }));
  return Number.isFinite(opts.limit) && opts.limit > 0 ? out.slice(0, opts.limit) : out;
}

function createHybridTools(deps) {
  const { pool, getPgOk, getEmbedding, xinfEnsure, vecToSql, parseVal, log, memSearch } = deps;

  // ── effectiveness re-rank (gate RUVECTOR_FEED_RETRIEVAL) ────────────────────
  // One bounded read over the aggregates namespace; adds +0.1·wilson to any row
  // whose metadata tags intersect a high-effectiveness aggregate's action tag.
  // Fail-open: any error leaves the base ranking untouched.
  async function applyEffectivenessBonus(results) {
    // ADR-2017 (closeout 2026-09-05): the consumer gate ALONE no longer admits
    // the bonus. The review reproduced this helper raising a score from a
    // retained aggregate with recording off and the master gate off — because
    // the only check was `gates.feedRetrieval()`. Admission is now the shared
    // decision in ruvector-gates.consumerAdmission, which requires the master
    // gate plus either active capture or an explicitly accepted, fresh,
    // non-empty retained corpus. The corpus observation feeding that decision
    // comes from the SAME query that reads the aggregates, so freshness is
    // measured, not assumed.
    if (!results || !results.length) return results;
    const preflight = consumerAdmission('feed_retrieval');
    if (!preflight.admitted && preflight.reason !== 'retained-corpus-freshness-unknown') {
      // Every refusal except "I have not measured the corpus yet" is final
      // without touching the database.
      return results;
    }
    try {
      const aggRes = await pool.query(
        `SELECT metadata->'tags' AS tags,
                COALESCE((metadata->>'importance')::float, 0) AS wilson,
                updated_at
           FROM memory_entries
          WHERE namespace = $1 AND metadata ? 'tags' AND ${NOT_EXPIRED}
          ORDER BY (metadata->>'importance')::float DESC NULLS LAST
          LIMIT 500`,
        [AGG_NAMESPACE],
      );
      // Re-decide with the observed corpus: this is where a stale or empty
      // retained corpus is actually rejected.
      let newest = null;
      for (const row of aggRes.rows) {
        const t = row.updated_at instanceof Date ? row.updated_at.getTime() : Date.parse(String(row.updated_at || ''));
        if (Number.isFinite(t) && (newest === null || t > newest)) newest = t;
      }
      const admission = consumerAdmission('feed_retrieval', {
        corpusLastUpdated: newest === null ? null : new Date(newest),
        corpusSize: aggRes.rows.length,
      });
      if (!admission.admitted) {
        log('WARN', `feed_retrieval bonus NOT applied — ADR-2017 admission refused: ${admission.reason}`);
        for (const r of results) {
          r.components = r.components || {};
          r.components.effectiveness_bonus_withheld = admission.reason;
        }
        return results;
      }
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
          // Provenance: WHY this consumer was allowed to move the score.
          r.components.effectiveness_admission = admission.reason;
          if (admission.receipt) r.components.effectiveness_corpus_receipt = admission.receipt;
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
    // Fusion strategy; only the scoped path has two rank lists to fuse.
    const fusion = scoped ? gateParams.hybridFusion() : 'blend';

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
              WHERE embedding IS NOT NULL AND ${NOT_EXPIRED} AND namespace = $2 ${stClause} ${tagClause}
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
          if (fusion === 'rrf') {
            // Rank-list fusion: same scoped CTEs, but return the two candidate
            // RANK lists (vector side by cosine, FTS side by ts_rank) and
            // fuse in JS. The overfetch bounds each list; the final slice is
            // `limit`.
            const rp = p.slice(0, p.length - 2); // drop alpha + limit; keep qIdx/hlIdx
            rp.push(Math.min(2000, Math.max(limit * 5, 50))); const nIdx = rp.length;
            const rrfSql = `
              WITH scoped AS MATERIALIZED (
                SELECT id, key, value, namespace, source_type, metadata, embedding, updated_at
                FROM memory_entries
                WHERE embedding IS NOT NULL AND ${NOT_EXPIRED} AND namespace = $2 ${stClause} ${tagClause}
              ),
              scored AS (
                SELECT id, key, value, namespace, source_type, metadata,
                  (1.0 - (embedding <=> $1::ruvector(384)))::float AS vec_sim,
                  COALESCE((metadata->>'importance')::float, 0.5) AS importance,
                  power(0.5, GREATEST(EXTRACT(EPOCH FROM (now() - updated_at)), 0)/86400.0/$${hlIdx})::float AS recency,
                  ts_rank(to_tsvector('english', value::text),
                          websearch_to_tsquery('english', $${qIdx}))::float AS kw
                FROM scoped
              ),
              vec AS (
                SELECT 'vec' AS lst, row_number() OVER (ORDER BY vec_sim DESC, id) AS rnk, *
                FROM scored ORDER BY vec_sim DESC, id LIMIT $${nIdx}
              ),
              fts AS (
                SELECT 'fts' AS lst, row_number() OVER (ORDER BY kw DESC, id) AS rnk, *
                FROM scored WHERE kw > 0 ORDER BY kw DESC, id LIMIT $${nIdx}
              )
              SELECT * FROM vec UNION ALL SELECT * FROM fts`;
            const rr = await pool.query(rrfSql, rp);
            const toItem = (r) => ({
              id: r.id, key: r.key, value: parseVal(r.value), namespace: r.namespace,
              source_type: r.source_type, metadata: r.metadata || {},
              components: {
                vector: parseFloat(r.vec_sim), importance: parseFloat(r.importance),
                recency: parseFloat(r.recency), keyword: parseFloat(r.kw),
              },
            });
            const byRank = (lst) => rr.rows.filter((r) => r.lst === lst)
              .sort((a, b) => Number(a.rnk) - Number(b.rnk)).map(toItem);
            const fused = fuseRrf([byRank('vec'), byRank('fts')], { limit });
            res = {
              rows: fused.map((f) => ({
                id: f.id, key: f.key, value: f.value, namespace: f.namespace, source_type: f.source_type,
                metadata: f.metadata, score: f.rrf.score,
                vec_sim: f.components.vector, importance: f.components.importance,
                recency: f.components.recency, kw: f.components.keyword,
                _rrf: f.rrf,
              })),
            };
          } else {
            res = await pool.query(sql, p);
          }
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
              WHERE embedding IS NOT NULL AND ${NOT_EXPIRED} ${stClause} ${tagClause}
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
            ...(r._rrf ? { rrf: r._rrf } : {}),
          },
        }));

        // Effectiveness re-rank (gate RUVECTOR_FEED_RETRIEVAL); fail-open. Withheld
        // under rrf: an absolute score bonus must not be mixed into rank-fused scores.
        if (fusion === 'rrf' && results.length && gates.feedRetrieval()) {
          for (const r of results) r.components.effectiveness_bonus_withheld = 'rrf-fusion-is-rank-only';
        } else {
          results = await applyEffectivenessBonus(results);
        }
        // Re-sort — the bonus may have reordered rows (no-op when no bonus).
        results.sort((a, b) => b.score - a.score);
        if (results.length > limit) results = results.slice(0, limit);

        return {
          success: true, action: 'hybrid_search', query, namespace,
          results, count: results.length, alpha, scoped,
          method: scoped ? (fusion === 'rrf' ? 'hybrid-rrf' : 'hybrid-fusion') : 'hybrid-fusion-vectoronly',
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
    // ADR-2017: the aggregates bucket obeys the same admission decision as the
    // retrieval bonus. `feed_routing` alone is not sufficient. Freshness cannot
    // be pre-measured here (the bucket IS the read), so an accepted retained
    // corpus is admitted on the receipt and the bundle records which branch let
    // it through — the operator can always see why aggregates were surfaced.
    const routingAdmission = consumerAdmission('feed_routing', { corpusLastUpdated: null });
    const routing = routingAdmission.admitted ||
      (routingAdmission.reason === 'retained-corpus-freshness-unknown');
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
             WHERE embedding IS NOT NULL AND ${NOT_EXPIRED}
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
          WHERE namespace = '${AGG_NAMESPACE}' AND ${NOT_EXPIRED}
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
          WHERE namespace = ${nsP} AND ${NOT_EXPIRED} AND (metadata->>'memory_type') = 'episodic'
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
      if (!routing) {
        bundle.aggregates_note =
          `effectiveness aggregates omitted from orient bundle — ADR-2017 admission refused: ${routingAdmission.reason}`;
      } else {
        bundle.aggregates_admission = routingAdmission.reason === 'retained-corpus-freshness-unknown'
          ? 'retained-corpus-accepted' : routingAdmission.reason;
        if (routingAdmission.receipt) bundle.aggregates_corpus_receipt = routingAdmission.receipt;
      }
      return bundle;
    } catch (err) {
      log('WARN', `orient failed, returning empty bundle: ${err.message}`);
      return { ...empty, degraded: true, warning: err.message };
    }
  }

  return { memHybridSearch, memOrient, applyEffectivenessBonus };
}

module.exports = { createHybridTools, fuseRrf, RRF_K, AGG_NAMESPACE };
