'use strict';

/**
 * memory-jev-rerank — the Jev option for model-facing memory search (AB-20-S1-01).
 *
 * The embedding search stays exactly as it is: 384-dim bge vectors, HNSW cosine, the
 * wildcard-namespace exclusions and TTL predicates all run first and are the only source of
 * candidates. This module takes the shortlist those paths already returned and, when
 * `AGENTBOX_JEV_MEMORY_RERANK=1`, asks a Jev judge two things in ONE request:
 *   • Score, per candidate: how directly does this memory answer the query? (3 levels)
 *   • Noul, once: does any listed memory answer the query at all?
 * The candidates are then reordered by the Score, stably. Nothing is added, dropped or
 * rewritten, `score` stays the cosine so the `min_score` floor still means cosine, and the
 * Noul is an annotation only (a no-answer verdict never removes a row).
 *
 * Privacy: local-only only on request. With `AGENTBOX_JEV_MEMORY_LOCAL_ONLY=1` (default 0) the cloud
 * and an undeclared proxy are refused (`AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL=1` or an explicit local
 * endpoint is required); set it if memory holds private namespaces. Each value is sent as a snippet of at most `SNIPPET_CHARS` characters.
 *
 * Fallback (all return the input untouched, byte for byte): flag off, no local endpoint,
 * fewer than two rows, a degraded (non-vector) result, transport error or timeout, a non-2xx
 * status, an unparseable body, any missing or out-of-range Score answer, or a best Score below
 * `AGENTBOX_JEV_MEMORY_MIN_RELEVANCE` (default 0.5: a judge that finds nothing relevant has no
 * order to offer). Never throws. The threshold is unfitted; see the evaluation on the
 * opportunity page.
 */

const path = require('path');
const memoryTools = require('./memory-tools');

const FLAG = 'AGENTBOX_JEV_MEMORY_RERANK';
const QUESTION_SET = 'memory-rerank-jev/1';
const SNIPPET_CHARS = 400;
const MAX_POOL = 20;
const RELEVANCE_LEVELS = [
  'Unrelated: the memory is about something else.',
  'Related but insufficient: the memory is on the topic but does not answer the query.',
  'Directly answers the query.',
];

/** The shared adapter lives with the hooks; resolve it as the other out-of-tree hosts do. Null means unavailable. */
function loadAdapter() {
  for (const c of [
    path.resolve(__dirname, '..', '..', '..', 'config', 'hooks', 'lib', 'jev-option.cjs'),
    '/opt/agentbox/config/hooks/lib/jev-option.cjs',
  ]) {
    try { return require(c); } catch { /* next */ }
  }
  return null;
}

function num(v, dflt) {
  const n = Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

function enabled(env) {
  const v = String(env[FLAG] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * How many candidates to fetch. ALWAYS `limit` unless the operator opts into overfetch with an
 * explicit `AGENTBOX_JEV_MEMORY_POOL` (capped at 20): a larger pool changes the query itself, so
 * the shaped output of a fallback (counts below the cosine floor, hints, the ANN top-k, the
 * attention block) is no longer equal to the pre-change output. By default the judge reorders
 * only the rows the search already returned, and a fallback is byte-identical.
 */
function poolFor(limit, env = process.env) {
  if (!enabled(env)) return limit;
  const pool = Math.floor(num(env.AGENTBOX_JEV_MEMORY_POOL, 0));
  return pool > limit ? Math.min(MAX_POOL, pool) : limit;
}

/** The judge's request: state is the query and the candidates; one Score per candidate, one Noul overall. */
function buildRequest(query, rows) {
  const memories = {};
  const questions = {};
  rows.forEach((r, i) => {
    memories[`m${i}`] = memoryTools.cutSnippet(memoryTools.snippetSource(r.value), SNIPPET_CHARS);
    questions[`rel_${i}`] = {
      type: 'score',
      instructions: `How directly does memory \`m${i}\` in \`memories\` answer \`query\`?`,
      criteria: RELEVANCE_LEVELS,
    };
  });
  questions.answered = {
    type: 'noul',
    instructions: 'Does at least one memory in `memories` answer `query`, rather than merely sharing its topic?',
  };
  return { state: { query, memories }, questions };
}

/**
 * Reorder `res.results` by the judge's relevance. Resolves the original `res` object unchanged on
 * any miss, or a copy with the reordered rows, `_reranked` and (when the Noul read) `no_answer_p`.
 *
 * `opts` is for tests: `env`, `fetchImpl`, `log`, `adapter`.
 */
async function rerank(query, res, opts = {}) {
  const env = opts.env || process.env;
  if (!enabled(env)) return res;
  const jev = opts.adapter || loadAdapter();
  const miss = (reason) => { if (jev) jev.logFallback('ab-20', reason, opts.log); return res; };
  if (!jev) return res;
  if (!res || res.success !== true || !Array.isArray(res.results) || res.results.length < 2 || res.degraded) return res;
  const endpoint = jev.resolveEndpoint(env, { localOnly: jev.enabled(env, 'AGENTBOX_JEV_MEMORY_LOCAL_ONLY') });
  if (!endpoint.ok) return miss(endpoint.reason);

  const pool = res.results.slice(0, MAX_POOL);
  const { state, questions } = buildRequest(String(query || ''), pool);
  const out = await jev.ask(endpoint, state, questions, {
    fetchImpl: opts.fetchImpl, timeoutMs: Math.floor(num(env.AGENTBOX_JEV_MEMORY_TIMEOUT_MS, 3000)) || 3000, retries: 0,
  });
  if (!out.ok) return miss(out.reason);

  const rel = pool.map((_, i) => jev.readScore(out.answers[`rel_${i}`], RELEVANCE_LEVELS.length));
  if (rel.some((v) => v === null)) return miss('malformed');
  if (Math.max(...rel) < num(env.AGENTBOX_JEV_MEMORY_MIN_RELEVANCE, 0.5)) return miss('low-confidence');

  const order = pool.map((r, i) => ({ r, i, v: rel[i] })).sort((a, b) => b.v - a.v || a.i - b.i);
  const answered = jev.readNoul(out.answers.answered);
  const next = {
    ...res,
    results: [...order.map((o) => o.r), ...res.results.slice(pool.length)],
    _reranked: { method: 'jev', set: QUESTION_SET, reordered: order.filter((o, k) => o.i !== k).length },
  };
  if (answered !== null) next._reranked.no_answer_p = Number((1 - answered).toFixed(4));
  return next;
}

module.exports = { FLAG, QUESTION_SET, SNIPPET_CHARS, RELEVANCE_LEVELS, poolFor, buildRequest, rerank, loadAdapter };
