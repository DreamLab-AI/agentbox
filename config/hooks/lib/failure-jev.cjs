'use strict';

/**
 * failure-jev.cjs — the Jev option for the MAST failure taxonomy (AB-03-S1-01).
 *
 * `management-api/lib/failure-taxonomy.js#classify` maps a failure by an explicit mode, a
 * symbolic reason, or two tiny stderr heuristics, and otherwise returns the honest
 * `unmapped`. This module is the ONLY thing that may turn an `unmapped` into a mode, and
 * only when `AGENTBOX_JEV_FAILURE_TAXONOMY=1` and a LOCAL judge is declared.
 *
 *   • Exact mappings win: anything `classify()` already resolved is returned untouched and
 *     no request is built.
 *   • Local-only: the error text is redacted tool output and may carry private material, so
 *     the cloud and the shared proxy are refused unless the endpoint is declared local
 *     (`AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL=1`); see jev-option.cjs.
 *   • It annotates a tag and nothing else. The raw failure text is preserved by the caller,
 *     and a failed operation is never turned into a success (this module never sees, and
 *     cannot change, the outcome).
 *   • Accept nothing by default: a Choice is taken only when its confidence AND the Noul's
 *     support reach thresholds, both defaulting to 1.01 (unreachable) until fitted on labelled
 *     data. Anything else — flag off, no endpoint, transport error, timeout, malformed answer,
 *     a mode outside the offered set, low confidence — returns the base tag unchanged.
 *   • Bounded: at most `AGENTBOX_JEV_FAILURE_MAX_CALLS` (default 3) requests per process, so a
 *     Stop hook with many failures cannot spend its budget on the judge.
 */

const jev = require('./jev-option.cjs');

const FLAG = 'AGENTBOX_JEV_FAILURE_TAXONOMY';
const QUESTION_SET = 'failure-taxonomy-jev/1';
const UNMAPPED = 'unmapped';

/** One-line definitions of the 14 MAST modes (Cemri et al. 2025), keyed by the taxonomy's ids. */
const MODE_DEFINITIONS = Object.freeze({
  'FM-1.1': 'The agent disobeys an explicit constraint or requirement of the task it was given.',
  'FM-1.2': 'The agent acts outside, or fails to keep to, the role or authority it was assigned (including being denied for it).',
  'FM-1.3': 'The agent repeats a step it has already done without making progress.',
  'FM-1.4': 'The agent loses earlier conversation or context and acts as if it had not happened (including a context window overflow).',
  'FM-1.5': 'The agent does not know or does not recognise when the task should stop.',
  'FM-2.1': 'The conversation is reset or restarted unexpectedly, discarding the work so far.',
  'FM-2.2': 'The agent needed clarification, did not ask for it, and proceeded on a guess.',
  'FM-2.3': 'The agent drifts away from the task into unrelated work.',
  'FM-2.4': 'The agent has information another agent needs and does not share it.',
  'FM-2.5': "The agent ignores or contradicts another agent's input.",
  'FM-2.6': 'What the agent says it will do differs from what it actually does.',
  'FM-3.1': 'The task is ended before its objectives are met.',
  'FM-3.2': 'The result is accepted without any, or with insufficient, verification.',
  'FM-3.3': 'A verification step ran but reached the wrong conclusion or checked the wrong thing.',
});
const UNMAPPED_RUBRIC =
  'None of the modes is clearly indicated: the text shows an environmental or tool error (missing file, ' +
  'network, syntax, exit status) or is too thin to attribute to an agent failure mode. Choose this when in doubt.';

/** Per-process call budget, so a hook with many failures stays inside its deadline. */
let spent = 0;
function resetBudget() { spent = 0; }

function num(v, dflt) {
  const n = Number.parseFloat(String(v ?? ''));
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

function settings(env) {
  return {
    enabled: jev.enabled(env, FLAG),
    minConfidence: num(env.AGENTBOX_JEV_FAILURE_MIN_CONFIDENCE, 1.01),
    minSupport: num(env.AGENTBOX_JEV_FAILURE_MIN_SUPPORT, 1.01),
    maxCalls: Math.max(0, Math.floor(num(env.AGENTBOX_JEV_FAILURE_MAX_CALLS, 3))),
    timeoutMs: Math.max(250, Math.floor(num(env.AGENTBOX_JEV_FAILURE_TIMEOUT_MS, 3000))),
  };
}

/** The request for one failure: a Choice over the mode ids plus `unmapped`, and a support Noul. */
function buildQuestions(taxonomy) {
  const criteria = {};
  for (const m of taxonomy.MODES) criteria[m.id] = `${m.name}: ${MODE_DEFINITIONS[m.id] || m.name}`;
  criteria[UNMAPPED] = UNMAPPED_RUBRIC;
  return {
    mode: jev.choiceQuestion(
      'Which failure mode of an LLM agent system, if any, does `error_text` show? `operation` is the kind of tool call ' +
      'that failed. Choose a mode only when the text itself indicates it; choose `unmapped` for an ordinary tool or ' +
      'environment error or when the text is too thin to tell.', criteria),
    supported: jev.noulQuestion(
      'Does `error_text` contain explicit evidence that an agent, rather than only a tool or the environment, failed to ' +
      'follow its task, its role, its history, or a verification step?'),
  };
}

/**
 * Refine one failure's tag. Resolves `{ mode, jev }` where `mode` is the base tag unless a
 * confident, supported mode was returned; `jev.reason` names why the base was kept. Never rejects.
 *
 * `ctx` is `{ stderr, action }` (already redacted by the caller); `base` is `classify(ctx)`.
 */
async function refine(taxonomy, ctx, base, { env = process.env, fetchImpl, log } = {}) {
  const keep = (reason) => ({ mode: base, jev: { set: QUESTION_SET, reason } });
  const s = settings(env);
  if (!s.enabled) return { mode: base };
  if (base !== UNMAPPED) return { mode: base };            // exact reason / heuristic mappings win
  const text = typeof ctx.stderr === 'string' ? ctx.stderr.trim() : '';
  if (!text) return { mode: base };                       // nothing to judge
  if (spent >= s.maxCalls) return keep('budget');
  const endpoint = jev.resolveEndpoint(env, { localOnly: true });
  if (!endpoint.ok) { jev.logFallback('ab-03', endpoint.reason, log); return keep(endpoint.reason); }
  spent += 1;
  const out = await jev.ask(endpoint, { error_text: text, operation: String(ctx.action || '').slice(0, 200) },
    buildQuestions(taxonomy), { fetchImpl, timeoutMs: s.timeoutMs, retries: 0 });
  if (!out.ok) { jev.logFallback('ab-03', out.reason, log); return keep(out.reason); }
  const allowed = [...taxonomy.MODE_IDS, UNMAPPED];
  const pick = jev.readChoice(out.answers.mode, allowed);
  const support = jev.readNoul(out.answers.supported);
  if (!pick || support === null) { jev.logFallback('ab-03', 'malformed', log); return keep('malformed'); }
  if (pick.choice === UNMAPPED) return keep('unmapped');
  if (pick.confidence === null || pick.confidence < s.minConfidence || support < s.minSupport) {
    jev.logFallback('ab-03', 'low-confidence', log);
    return { mode: base, jev: { set: QUESTION_SET, reason: 'low-confidence', suggested: pick.choice, confidence: pick.confidence, support } };
  }
  return { mode: pick.choice, jev: { set: QUESTION_SET, confidence: pick.confidence, support } };
}

module.exports = { FLAG, QUESTION_SET, MODE_DEFINITIONS, UNMAPPED_RUBRIC, buildQuestions, refine, resetBudget };
