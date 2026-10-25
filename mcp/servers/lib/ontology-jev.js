'use strict';
/**
 * ontology-jev.js — the opt-in Jev option for the ontology retrieval brain:
 *   AB-24-S1-01  Choose whether ontology grounding is relevant        (Choice + Noul)
 *   AB-24-S1-02  Rerank scaffold candidates under a fixed budget      (Score)
 *
 * WHERE. `createOntologyRetrieval().ask()` in ontology-retrieval.js is the agentbox half of
 * the AB-24 path (AB-24.3 Loom seed→expand, AB-24.4 cache key, AB-24.6 consumer). The Loom's
 * own `/v1/chat/completions` scaffold injection (loom-facade `routes/mod.rs`) lives in the
 * loom repository and is out of scope here; this module covers the in-process seam every
 * agentbox consumer uses (`ontology_ask`, the consultant PULL-A seam, the PUSH hook).
 *
 * WHAT IT ASKS, in ONE request over the candidates retrieval already produced:
 *   route     Choice  grounded | mixed | passthrough | clarify
 *   supports  Noul    do the candidates actually bear on `query`?
 *   c0..cN    Score   how directly useful is candidate i (4 levels) — one question per candidate
 *
 * AUTHORITY. Retrieval, the maturity/domain gate, generation identity, the cache-constraint
 * re-validation and the token clamp stay in code and run exactly as before. The model never
 * edits a source assertion and cannot introduce a candidate: it can only (a) annotate the
 * result, (b) PROPOSE a permutation of the SAME candidates and (c) suggest skipping injection.
 * (b) and (c) change what the budget clamp keeps or what is injected, so by default they are
 * SHADOW-ONLY (the proposal is recorded under `result.jev`, nothing is applied) until a
 * confidence threshold is explicitly configured after evaluation:
 *   AGENTBOX_JEV_ONTOLOGY_RERANK_APPLY_MIN_CONFIDENCE       (unset ⇒ never apply)
 *   AGENTBOX_JEV_ONTOLOGY_PASSTHROUGH_MIN_CONFIDENCE        (unset ⇒ never skip)
 * An explicit per-request `scaffold: false` (ADR-139) always wins: no request is built.
 *
 * FLAGS (off by default): AGENTBOX_JEV_ONTOLOGY_RELEVANCE=1, AGENTBOX_JEV_ONTOLOGY_RERANK=1.
 * DATA CLASS. Only candidate label, domain and a ≤280-char summary leave. A candidate marked
 * `public: false` stops the evaluation (fallback `private-candidate`).
 * `AGENTBOX_JEV_ONTOLOGY_LOCAL_ONLY=1` requires a declared-local endpoint.
 */

const fs = require('fs');
const path = require('path');

const ITEM = 'AB-24-S1-01/02';
const QUESTION_SET_VERSION = 'ab24-ontology-grounding/1';
const FLAG_RELEVANCE = 'AGENTBOX_JEV_ONTOLOGY_RELEVANCE';
const FLAG_RERANK = 'AGENTBOX_JEV_ONTOLOGY_RERANK';
/** Retrieval is on the critical path of a consult: tight deadline, no retry. */
const TIMEOUT_MS = 4000;
const MAX_CANDIDATES = 8;
const SUMMARY_CHARS = 280;
const ROUTES = Object.freeze(['grounded', 'mixed', 'passthrough', 'clarify']);

const ROUTE_CRITERIA = Object.freeze({
  grounded:
    'The question is about concepts the corpus covers and the candidates are on topic: injecting them helps. ' +
    'Not for a question that merely shares a word with a candidate.',
  mixed:
    'Part of the question is about corpus concepts and part is about something else: inject, but the rest needs no grounding.',
  passthrough:
    'The question is unrelated to the corpus domains (general chat, code unrelated to the ontology, small talk). ' +
    'Injecting the candidates would add noise and cost.',
  clarify:
    'The question is too ambiguous to tell whether the corpus applies; the asker should be asked what they mean.',
});
const USEFULNESS_LEVELS = Object.freeze([
  'Not useful: unrelated to answering the query, or only lexically similar.',
  'Marginal: background that would not change the answer.',
  'Useful: supplies a definition or relation the answer relies on.',
  'Essential: the answer is unsupported or wrong without this concept.',
]);

const APP_ROOT = process.env.AGENTBOX_APP_ROOT || '/opt/agentbox';
let _jev;
function loadJev() {
  if (_jev !== undefined) return _jev;
  const rel = 'config/hooks/lib/jev-option.cjs';
  for (const base of [path.resolve(__dirname, '../../..'), path.resolve(__dirname, '../../../..'), APP_ROOT]) {
    const p = path.join(base, rel);
    if (fs.existsSync(p)) { _jev = require(p); return _jev; }
  }
  _jev = null;
  return _jev;
}

function clamp(s, n) { const t = typeof s === 'string' ? s : ''; return t.length > n ? t.slice(0, n) : t; }
function numEnv(env, name) {
  const raw = env[name];
  if (raw === undefined || String(raw).trim() === '') return null;
  const v = Number.parseFloat(raw);
  return Number.isFinite(v) ? v : null;
}

/** Build the request parts for a set of candidates. Pure; exported for the wire-shape test. */
function buildRequest(query, seeds, { relevance, rerank }) {
  const cands = seeds.slice(0, MAX_CANDIDATES);
  const state = {
    query: clamp(query, 2000),
    candidates: cands.map((s) => ({
      label: clamp(s.label, 160),
      domain: s.domain || null,
      summary: clamp(s.summary, SUMMARY_CHARS) || null,
    })),
  };
  const questions = {};
  if (relevance) {
    questions.route = {
      type: 'choice',
      instructions:
        'Is ontology grounding relevant to `query`? `candidates` are the concepts a keyword search retrieved. ' +
        'Choose how the request should be handled; prefer `passthrough` when the candidates only share vocabulary with the query.',
      criteria: { ...ROUTE_CRITERIA },
    };
    questions.supports = {
      type: 'noul',
      instructions: 'Do the concepts in `candidates` genuinely bear on what `query` is asking, rather than merely sharing words with it?',
    };
  }
  if (rerank) {
    cands.forEach((c, i) => {
      questions[`c${i}`] = {
        type: 'score',
        instructions:
          `How directly useful is the concept at index ${i} of \`candidates\` (${clamp(c.label, 60)}) for answering \`query\`? ` +
          'Judge direct usefulness to the answer, not lexical proximity.',
        criteria: [...USEFULNESS_LEVELS],
      };
    });
  }
  return { state, questions, candidates: cands };
}

/**
 * Create the evaluator, or `null` when neither flag is on (the caller then runs the unchanged path).
 * @param {object} [opts] { env, fetchImpl, sink }
 */
function fromEnv(opts = {}) {
  const env = opts.env || process.env;
  const jev = loadJev();
  if (!jev) return null;
  const relevance = jev.enabled(env, FLAG_RELEVANCE);
  const rerank = jev.enabled(env, FLAG_RERANK);
  if (!relevance && !rerank) return null;
  const applyMin = numEnv(env, 'AGENTBOX_JEV_ONTOLOGY_RERANK_APPLY_MIN_CONFIDENCE');
  const skipMin = numEnv(env, 'AGENTBOX_JEV_ONTOLOGY_PASSTHROUGH_MIN_CONFIDENCE');
  /** Part of the retrieval cache key: a Jev-shaped body is never served to a caller without Jev. */
  const version = `${QUESTION_SET_VERSION};rel=${relevance ? 1 : 0};rr=${rerank ? 1 : 0};apply=${applyMin};skip=${skipMin}`;

  async function evaluate(query, seeds) {
    const fail = (reason) => { jev.logFallback(ITEM, reason, opts.sink); return { ok: false, reason }; };
    if (!Array.isArray(seeds) || !seeds.length) return { ok: false, reason: 'no-candidates' };
    if (seeds.slice(0, MAX_CANDIDATES).some((s) => s && s.public === false)) return fail('private-candidate');
    const ep = jev.resolveEndpoint(env, { localOnly: jev.enabled(env, 'AGENTBOX_JEV_ONTOLOGY_LOCAL_ONLY') });
    if (!ep.ok) return fail(ep.reason);
    const req = buildRequest(query, seeds, { relevance, rerank });
    const res = await jev.ask(ep, req.state, req.questions, { fetchImpl: opts.fetchImpl, timeoutMs: TIMEOUT_MS, retries: 0 });
    if (!res.ok) return fail(res.reason);

    const out = { ok: true, question_set_version: QUESTION_SET_VERSION, model: res.model };
    if (relevance) {
      const route = jev.readChoice(res.answers.route, ROUTES);
      const supports = jev.readNoul(res.answers.supports);
      if (!route || route.confidence === null || supports === null) return fail('malformed');
      out.relevance = { route: route.choice, confidence: route.confidence, supports };
    }
    if (rerank) {
      const scored = [];
      for (let i = 0; i < req.candidates.length; i++) {
        const a = res.answers[`c${i}`];
        const s = jev.readScore(a, USEFULNESS_LEVELS.length);
        const conf = a && typeof a.confidence === 'number' ? a.confidence : null;
        if (s === null || conf === null) return fail('malformed');
        scored.push({ i, s, conf });
      }
      const order = scored.slice().sort((x, y) => y.s - x.s || x.i - y.i).map((x) => x.i);
      out.rerank = {
        scores: scored.map((x) => Math.round(x.s * 1000) / 1000),
        min_confidence: Math.min(...scored.map((x) => x.conf)),
        proposed_order: order,
        applied: false,
      };
      // Apply only above an explicitly configured threshold, and never to a no-op permutation.
      const identity = order.every((v, k) => v === k);
      if (applyMin !== null && !identity && out.rerank.min_confidence >= applyMin) out.rerank.applied = true;
    }
    if (out.relevance && skipMin !== null && out.relevance.route === 'passthrough' && out.relevance.confidence >= skipMin) {
      out.skip = true;
    }
    return out;
  }

  /** Reorder `seeds` by `proposed_order` over the SAME objects; the tail beyond MAX_CANDIDATES keeps its place. */
  function permute(seeds, order) {
    const head = order.map((i) => seeds[i]);
    return [...head, ...seeds.slice(order.length)];
  }

  return { version, evaluate, permute, relevance, rerank };
}

module.exports = {
  ITEM, QUESTION_SET_VERSION, FLAG_RELEVANCE, FLAG_RERANK, ROUTES, MAX_CANDIDATES, USEFULNESS_LEVELS,
  buildRequest, fromEnv,
};
