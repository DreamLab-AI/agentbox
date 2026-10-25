'use strict';
/**
 * consult-advice.js — the opt-in Jev option for AB-15-S1-01 ("decide when a
 * stronger consultant is worth asking").
 *
 * WHAT IT ADDS. One advisory tool, `consult_advice`, on every consultant MCP
 * server. Given the question the coordinator is about to put, the excerpt it
 * would send and the consultants it could reach, it asks System One two typed
 * questions in ONE request and returns an annotation:
 *
 *   route         Choice  none | specialist | deep_reasoning
 *   insufficiency Score   0..3 — how much the evidence already in hand falls
 *                         short of answering the question
 *
 * WHAT IT NEVER DOES. It does not perform, refuse, defer or re-route a consult.
 * `consult` (consultant-base `_handleConsult`) is untouched, so the budget caps
 * (`tree_search_coder` spend cap, AB-15.5), model availability (AB-15.11) and
 * the coordinator's own decision stay exact. The remaining budget and the
 * reachable-consultant list are computed by CODE and handed in; a `specialist`
 * or `deep_reasoning` option is not even offered when code says there is no
 * budget for it, so the model cannot recommend what cannot be afforded.
 *
 * OVERLAP. jev-checkpoints (ADR-2135, config/claude-plugins/jev-checkpoints/
 * hooks) already times the *in-session* advisor with a Jev judge. It never sees
 * the consultant MCP servers (consultant-base.js `_handleConsult`, :258), which
 * is the genuinely missing part this module covers.
 *
 * FLAG. `AGENTBOX_JEV_CONSULT_ADVICE=1` — off by default. Flag off: the tool is
 * not listed, no request is built, nothing leaves the process.
 * DATA CLASS. The question and excerpt are what the coordinator would send to a
 * cloud consultant anyway; they are length-clamped here. This route is NOT
 * local-only; set `AGENTBOX_JEV_CONSULT_LOCAL_ONLY=1` to require a declared
 * local endpoint for confidential work.
 */

const fs = require('fs');
const path = require('path');

const FLAG = 'AGENTBOX_JEV_CONSULT_ADVICE';
const ITEM = 'AB-15-S1-01';
/** Bump on any wording change: the version is logged and returned with every advice. */
const QUESTION_SET_VERSION = 'ab15-consult-advice/1';
const MAX_QUESTION_CHARS = 6000;
const MAX_EXCERPT_CHARS = 6000;
/** Interactive path: a hard deadline and no retry. */
const TIMEOUT_MS = 4000;

const ROUTES = Object.freeze(['none', 'specialist', 'deep_reasoning']);

const APP_ROOT = process.env.AGENTBOX_APP_ROOT || '/opt/agentbox';
let _jev;
/** The shared adapter lives in config/hooks/lib; resolve it for repo, packaged and baked layouts. */
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

function clamp(s, n) {
  const t = typeof s === 'string' ? s : '';
  return t.length > n ? t.slice(0, n) : t;
}

/** Offered options as decided by CODE: `none` always; paid options only with budget and a reachable target. */
function offeredRoutes({ remainingUsd, specialists, deepReasoning }) {
  const out = ['none'];
  const funded = typeof remainingUsd !== 'number' || remainingUsd > 0;
  if (funded && Array.isArray(specialists) && specialists.length) out.push('specialist');
  if (funded && deepReasoning === true) out.push('deep_reasoning');
  return out;
}

const ROUTE_CRITERIA = {
  none:
    'The question can be answered from the context already in hand, or is routine (a lookup, a ' +
    'single-file edit, a restatement). Asking any consultant would add cost without adding information.',
  specialist:
    'The question needs knowledge or a capability the context does not contain and a listed specialist ' +
    'consultant covers it (current web facts, a second model family for verification, a named domain).',
  deep_reasoning:
    'The question is a hard multi-step design, proof or debugging problem where the context is adequate ' +
    'but a slower, deeper reasoning pass is likely to change the answer.',
};

const INSUFFICIENCY_LEVELS = [
  'The context in hand fully answers the question.',
  'The context mostly answers it; a detail could be checked.',
  'The context leaves a material gap that changes the answer.',
  'The context is plainly missing what the question needs.',
];

/**
 * Build the request body parts. Pure; exported for the wire-shape test.
 * `criteria` is a MAP for Choice and an ORDERED list for Score (api-and-design.md).
 */
function buildRequest(input, offered) {
  const criteria = {};
  for (const r of offered) criteria[r] = ROUTE_CRITERIA[r];
  return {
    state: {
      question: clamp(input.question, MAX_QUESTION_CHARS),
      context_excerpt: clamp(input.context_excerpt, MAX_EXCERPT_CHARS),
      reachable_specialists: (input.specialists || []).map((s) => String(s)).slice(0, 12),
      remaining_budget_usd: typeof input.remainingUsd === 'number' ? input.remainingUsd : null,
    },
    questions: {
      route: {
        type: 'choice',
        instructions:
          'Which handling is justified for `question`, given `context_excerpt`, `reachable_specialists` and ' +
          '`remaining_budget_usd`? Prefer `none` unless the context genuinely lacks something a consultant ' +
          'would supply.',
        criteria,
      },
      insufficiency: {
        type: 'score',
        instructions:
          'How far does `context_excerpt` fall short of what `question` needs in order to be answered ' +
          'correctly? Judge the evidence in `context_excerpt` only, not how hard the topic is.',
        criteria: INSUFFICIENCY_LEVELS,
      },
    },
  };
}

/**
 * Ask for advice. Never throws. Resolves `{ ok: true, advice }` or `{ ok: false, reason }`.
 *
 * @param {object} input { question, context_excerpt, remainingUsd?, specialists?, deepReasoning? }
 * @param {object} [opts] { env, fetchImpl, sink, minConfidence }
 */
async function assess(input, opts = {}) {
  const env = opts.env || process.env;
  const jev = loadJev();
  const fail = (reason) => {
    if (jev) jev.logFallback(ITEM, reason, opts.sink);
    return { ok: false, reason };
  };
  if (!jev) return { ok: false, reason: 'no-adapter' };
  if (!jev.enabled(env, FLAG)) return { ok: false, reason: 'flag-off' };
  if (!input || typeof input.question !== 'string' || !input.question.trim()) return fail('malformed');

  const ep = jev.resolveEndpoint(env, { localOnly: jev.enabled(env, 'AGENTBOX_JEV_CONSULT_LOCAL_ONLY') });
  if (!ep.ok) return fail(ep.reason);

  const offered = offeredRoutes(input);
  const req = buildRequest(input, offered);
  const res = await jev.ask(ep, req.state, req.questions, { fetchImpl: opts.fetchImpl, timeoutMs: TIMEOUT_MS, retries: 0 });
  if (!res.ok) return fail(res.reason);

  const route = jev.readChoice(res.answers.route, offered);
  const insuff = jev.readScore(res.answers.insufficiency, INSUFFICIENCY_LEVELS.length);
  if (!route || route.confidence === null || insuff === null) return fail('malformed');

  const min = typeof opts.minConfidence === 'number'
    ? opts.minConfidence
    : Number.parseFloat(env.AGENTBOX_JEV_CONSULT_MIN_CONFIDENCE || '0');
  if (route.confidence < (Number.isFinite(min) ? min : 0)) return fail('low-confidence');

  return {
    ok: true,
    advice: {
      route: route.choice,
      confidence: route.confidence,
      insufficiency: Math.round(insuff * 1000) / 1000,
      offered,
      question_set_version: QUESTION_SET_VERSION,
      model: res.model,
      advisory_only: true,
    },
  };
}

/** True when the flag is on, so consultant-base lists the tool. Never throws. */
function advisoryEnabled(env = process.env) {
  try {
    const jev = loadJev();
    return !!jev && jev.enabled(env, FLAG);
  } catch { return false; }
}

const TOOL_DEFINITION = Object.freeze({
  name: 'consult_advice',
  description:
    'ADVISORY ONLY (Jev option, AB-15-S1-01, off by default). Given the question and context you would send to a ' +
    'consultant, return a typed suggestion — none | specialist | deep_reasoning — with a confidence and an ' +
    'insufficiency score. It never performs, blocks or re-routes a consult and never changes a spend cap. ' +
    'Returns advice:null when Jev is unavailable, so the coordinator proceeds exactly as before.',
  inputSchema: {
    type: 'object',
    properties: {
      question:        { type: 'string', description: 'The question you are considering putting to a consultant.' },
      context_excerpt: { type: 'string', description: 'The context you would send with it.' },
      remaining_budget_usd: { type: 'number', description: 'Deterministic remaining spend, if known. At or below 0 no paid route is offered.' },
      specialists:     { type: 'array', items: { type: 'string' }, description: 'Consultant names reachable right now.' },
      deep_reasoning:  { type: 'boolean', description: 'Whether a deeper-reasoning route is available.' },
    },
    required: ['question'],
  },
});

module.exports = {
  FLAG, ITEM, QUESTION_SET_VERSION, ROUTES, TOOL_DEFINITION,
  offeredRoutes, buildRequest, assess, advisoryEnabled,
};
