'use strict';

/**
 * lib/approval-review-jev — the Jev option for the pending-approvals listing (AB-14-S1-01).
 *
 * `GET /v1/approvals` lists the open kind-31402 ActionRequests the authority gate is blocking
 * on. Each carries a title, a priority, the authority class, the task properties, the exact
 * operation and the requester's `reasoning`. With `AGENTBOX_JEV_APPROVAL_REVIEW=1` this module
 * adds an ADVISORY `review_aid` to each listed request so a reviewer can see, before reading
 * the whole card, which obligations the rationale does not address and how urgent it looks:
 *   • one Noul per obligation (purpose, scope, impact), each carrying its full meaning in its
 *     instructions, because question ids are not shown to the model;
 *   • one Score for review urgency (3 levels), normalised to [0, 1].
 * Evidence is the request's own `reasoning`, `operation` and `task_properties`.
 *
 * What it never does: approve, reject, defer, sign, change an authority class or task
 * property, bind or replace the operation receipt, reorder, drop or hide a request, or touch
 * `POST /v1/approvals/:id/decide`. The human decision gate is exactly the one it was.
 *
 * Local-only only on request: with `AGENTBOX_JEV_APPROVAL_LOCAL_ONLY=1` (default 0) the cloud and an
 * undeclared proxy are refused (`AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL=1` required). Fallback is
 * per request and total: flag off, no local endpoint, a transport error, timeout, non-2xx,
 * unparseable body or any missing/out-of-range answer leaves that request exactly as listed,
 * and when nothing was annotated the SAME array object is returned. Never throws.
 */

const path = require('path');

const FLAG = 'AGENTBOX_JEV_APPROVAL_REVIEW';
const QUESTION_SET = 'approval-review-jev/1';
const MAX_ITEMS = 10;
const URGENCY_LEVELS = [
  'Routine: bounded, reversible, and well explained.',
  'Needs attention: some part of the action or its justification is unclear or consequential.',
  'Urgent review: high impact, hard to reverse, or the justification is missing for what is being done.',
];

/** The obligations a rationale is checked against; instructions carry the whole meaning. */
const OBLIGATIONS = Object.freeze([
  {
    id: 'purpose',
    instructions: 'Does `rationale` say why this specific action is needed now, rather than only restating what the action does?',
  },
  {
    id: 'scope',
    instructions: 'Do `rationale` and `operation` together make clear exactly which resource, target or scope the action affects?',
  },
  {
    id: 'impact',
    instructions: 'Does `rationale` address how reversible the action is or what happens if it is wrong, consistent with `task_properties`?',
  },
]);

function loadAdapter() {
  for (const c of [
    path.resolve(__dirname, '..', '..', 'config', 'hooks', 'lib', 'jev-option.cjs'),
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

/** The state and questions for one pending request. */
function buildRequest(item) {
  const fields = (item && item.content && item.content.fields) || {};
  const state = {
    action: item.title || null,
    authority_class: fields.authority_class || null,
    rationale: (item.content && item.content.reasoning) || '',
    operation: fields.operation === undefined ? null : fields.operation,
    task_properties: fields.task_properties === undefined ? null : fields.task_properties,
  };
  const questions = {};
  for (const o of OBLIGATIONS) questions[`ob_${o.id}`] = { type: 'noul', instructions: o.instructions };
  questions.urgency = {
    type: 'score',
    instructions: 'How urgently does this approval request need careful human review, given `action`, `authority_class`, ' +
      '`operation`, `task_properties` and how well `rationale` justifies them?',
    criteria: URGENCY_LEVELS,
  };
  return { state, questions };
}

/** Judge one request. Resolves a `review_aid` or null. */
async function judge(jev, endpoint, item, opts, env) {
  const { state, questions } = buildRequest(item);
  const out = await jev.ask(endpoint, state, questions, {
    fetchImpl: opts.fetchImpl, timeoutMs: Math.floor(num(env.AGENTBOX_JEV_APPROVAL_TIMEOUT_MS, 3000)) || 3000, retries: 0,
  });
  if (!out.ok) { jev.logFallback('ab-14', out.reason, opts.log); return null; }
  const addressed = {};
  for (const o of OBLIGATIONS) {
    const p = jev.readNoul(out.answers[`ob_${o.id}`]);
    if (p === null) { jev.logFallback('ab-14', 'malformed', opts.log); return null; }
    addressed[o.id] = Number(p.toFixed(4));
  }
  const urgency = jev.readScore(out.answers.urgency, URGENCY_LEVELS.length);
  if (urgency === null) { jev.logFallback('ab-14', 'malformed', opts.log); return null; }
  const at = num(env.AGENTBOX_JEV_APPROVAL_ADDRESSED_AT, 0.5);
  return {
    set: QUESTION_SET,
    advisory: true,
    addressed,
    unaddressed: OBLIGATIONS.filter((o) => addressed[o.id] < at).map((o) => o.id),
    urgency: Number(urgency.toFixed(4)),
  };
}

/**
 * Annotate a `listPending()` array. Resolves the SAME array when nothing was annotated, else a
 * new array in the same order whose annotated entries are copies with an added `review_aid`.
 * `opts`: `env`, `fetchImpl`, `log`, `adapter`.
 */
async function annotate(items, opts = {}) {
  const env = opts.env || process.env;
  const on = String(env[FLAG] ?? '').trim().toLowerCase();
  if (!['1', 'true', 'yes', 'on'].includes(on)) return items;
  if (!Array.isArray(items) || !items.length) return items;
  const jev = opts.adapter || loadAdapter();
  if (!jev) return items;
  const endpoint = jev.resolveEndpoint(env, { localOnly: jev.enabled(env, 'AGENTBOX_JEV_APPROVAL_LOCAL_ONLY') });
  if (!endpoint.ok) { jev.logFallback('ab-14', endpoint.reason, opts.log); return items; }
  const aids = await Promise.all(items.map(async (it, i) => {
    if (i >= MAX_ITEMS || !it || typeof it !== 'object') return null;
    try { return await judge(jev, endpoint, it, opts, env); } catch { return null; }
  }));
  if (!aids.some(Boolean)) return items;
  return items.map((it, i) => (aids[i] ? { ...it, review_aid: aids[i] } : it));
}

module.exports = { FLAG, QUESTION_SET, OBLIGATIONS, URGENCY_LEVELS, MAX_ITEMS, buildRequest, annotate, loadAdapter };
