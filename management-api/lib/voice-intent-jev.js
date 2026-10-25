'use strict';

/**
 * lib/voice-intent-jev — the Jev option for operator voice intents (AB-12-S1-01).
 *
 * `lib/voice-intent#parseIntent` is a closed regex grammar: a verb family plus regex-captured
 * operands, or the inert read-only `query` fallback for anything it does not recognise. This
 * module adds an OPT-IN second opinion (`AGENTBOX_JEV_VOICE_INTENT=1`) that runs in
 * `routes/voice-intent.js` only AFTER speaker authentication, the mandate checks and the
 * target-principal validation, so unauthenticated text never leaves the process.
 *
 * What it does, in one request:
 *   • Choice `family`: which allowed command family the transcript asks for (the grammar's
 *     own families plus `unclear`), reported as an annotation;
 *   • Noul `verb_ok` (recognised, state-changing intents only): does the transcript really
 *     ask for the parsed verb on the parsed subject?
 * What it never does: choose a verb for an unrecognised utterance (that stays the inert
 * `query`; a suggested family is an annotation), extract or rewrite the subject (operands stay
 * regex-captured), pick a target (the scene-selected `actor_did` is validated by existing code),
 * authenticate, authorise, sign or dispatch. Its only power over the outcome is to ABSTAIN: a
 * recognised mutating intent whose `verb_ok` is below `AGENTBOX_JEV_VOICE_VETO_BELOW`, or whose
 * family is `unclear` at `AGENTBOX_JEV_VOICE_UNCLEAR_AT` or above, is held for clarification
 * instead of being dispatched. Both thresholds default to "never" (0 and 1.01).
 *
 * Local-only: a transcript is the operator's private speech, so the cloud and an undeclared
 * proxy are refused (`AGENTBOX_SYSTEM_ONE_BACKEND_LOCAL=1` required). Any miss — flag off, no
 * local endpoint, transport error, timeout, non-2xx, unparseable body, an answer outside the
 * offered set — resolves `null` and the route behaves exactly as before. Never throws.
 *
 * Not delivered here: choosing the INTENDED SESSION. At HEAD the bridge has a single
 * coordinator (`config/tab0-bridge/server.mjs` pins one AoE session id) and the route's target
 * is the caller-supplied `actor_did`; there is no multi-session choice to refine.
 */

const path = require('path');
const { RULES } = require('./voice-intent');

const FLAG = 'AGENTBOX_JEV_VOICE_INTENT';
const QUESTION_SET = 'voice-intent-jev/1';
const UNCLEAR = 'unclear';

const FAMILY_DESCRIPTIONS = Object.freeze({
  link: 'Connect two named things together (link, connect, relate, associate, join).',
  transform: 'Rewrite, convert or summarise one named thing.',
  delete: 'Remove, erase or forget a named thing.',
  update: 'Change, edit, rename or amend a named thing.',
  create: 'Create, add or record a new thing.',
  query: 'Look something up or ask for information, changing nothing.',
});

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

function families() {
  return RULES.map((r) => r.name);
}

/** The request: a Choice MAP over the grammar's families plus `unclear`, and for state-changing parses one Noul. */
function buildRequest(intent) {
  const criteria = {};
  for (const name of families()) criteria[name] = FAMILY_DESCRIPTIONS[name] || name;
  criteria[UNCLEAR] = 'The transcript is ambiguous, incomplete, or does not clearly ask for any one of the other commands.';
  const questions = {
    family: {
      type: 'choice',
      instructions: 'Which one command does the operator\'s `transcript` ask for? Choose `unclear` unless one command is plain.',
      criteria,
    },
  };
  const state = { transcript: intent.transcript, allowed_commands: families() };
  if (intent.recognised && intent.action_type !== 0) {
    state.parsed = { verb: intent.verb, subject: intent.subject, object: intent.object };
    questions.verb_ok = {
      type: 'noul',
      instructions: 'Does `transcript` plainly ask for the command `parsed.verb` to be applied to `parsed.subject` ' +
        '(and `parsed.object` when it is present), rather than some other command or a different subject?',
    };
  }
  return { state, questions };
}

/**
 * Interpret one parsed intent. Resolves `null` on any miss, else
 * `{ set, family, confidence, verbOk, agrees, clarify }`. `opts`: `env`, `fetchImpl`, `log`, `adapter`.
 */
async function interpret(intent, opts = {}) {
  const env = opts.env || process.env;
  const on = String(env[FLAG] ?? '').trim().toLowerCase();
  if (!['1', 'true', 'yes', 'on'].includes(on)) return null;
  const jev = opts.adapter || loadAdapter();
  if (!jev || !intent || typeof intent.transcript !== 'string') return null;
  const endpoint = jev.resolveEndpoint(env, { localOnly: true });
  if (!endpoint.ok) { jev.logFallback('ab-12', endpoint.reason, opts.log); return null; }
  const { state, questions } = buildRequest(intent);
  const out = await jev.ask(endpoint, state, questions, {
    fetchImpl: opts.fetchImpl, timeoutMs: Math.floor(num(env.AGENTBOX_JEV_VOICE_TIMEOUT_MS, 3000)) || 3000, retries: 0,
  });
  if (!out.ok) { jev.logFallback('ab-12', out.reason, opts.log); return null; }
  const fam = jev.readChoice(out.answers.family, [...families(), UNCLEAR]);
  const verbOk = questions.verb_ok ? jev.readNoul(out.answers.verb_ok) : null;
  if (!fam || (questions.verb_ok && verbOk === null)) { jev.logFallback('ab-12', 'malformed', opts.log); return null; }

  const vetoBelow = num(env.AGENTBOX_JEV_VOICE_VETO_BELOW, 0);
  const unclearAt = num(env.AGENTBOX_JEV_VOICE_UNCLEAR_AT, 1.01);
  const mutating = intent.recognised && intent.action_type !== 0;
  const lowVerb = mutating && verbOk !== null && verbOk < vetoBelow;
  const unclear = mutating && fam.choice === UNCLEAR && fam.confidence !== null && fam.confidence >= unclearAt;
  return {
    set: QUESTION_SET,
    family: fam.choice,
    confidence: fam.confidence,
    verbOk,
    agrees: fam.choice === intent.verb,
    clarify: lowVerb || unclear,
  };
}

module.exports = { FLAG, QUESTION_SET, UNCLEAR, FAMILY_DESCRIPTIONS, buildRequest, interpret, loadAdapter };
