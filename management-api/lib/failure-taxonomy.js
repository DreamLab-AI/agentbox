'use strict';

/**
 * lib/failure-taxonomy — the single canonical definition of the MAST 14-mode
 * failure taxonomy (REC-5, PRD-019 / ADR-037 D1 / DDD-017 §MastFailureMode).
 *
 * MAST — the Multi-Agent System failure Taxonomy of Cemri et al., "Why Do
 * Multi-Agent LLM Systems Fail?" (2025) — names 14 fine-grained failure modes
 * across three categories. This module defines those 14 modes ONCE and exposes a
 * classifier that maps a structured failure context to a mode, or to the honest
 * `unmapped` sentinel when the available signal cannot resolve one. It is a pure,
 * dependency-free value object: no pg, no fs, no env, no transport. It is a field
 * on the two envelopes that already flow (the trajectory step result and the
 * agent-events envelope) and the route error returns — never a standalone service
 * (ADR-037 D1, rejected alternative 1).
 *
 * Honesty rule (ADR-037 D1, rejected alternative 3): a binary success/failure
 * grade cannot distinguish 14 modes. `classify()` maps only where the caller
 * supplies genuine signal (an explicit mode, a symbolic reason, or a
 * high-precision stderr pattern) and returns `unmapped` otherwise. It never
 * fabricates a mode to look precise, and it never drops a failure — every failure
 * carries a tag, `unmapped` at worst, with the human text preserved as detail.
 *
 * Attribution: taxonomy from Cemri, Pan, Yang, et al., "Why Do Multi-Agent LLM
 * Systems Fail?" (arXiv:2503.13657, 2025). Mode ids and names track the paper's
 * three-category structure verbatim.
 */

/** The honest sentinel: a failure the current signal cannot resolve to a mode. */
const UNMAPPED = 'unmapped';

// ── The 14 MAST modes, defined once (id ↔ paper's FM-x.y numbering) ─────────────
const CATEGORIES = Object.freeze({
  'spec':          { code: 1, name: 'Specification & System Design' },
  'inter-agent':   { code: 2, name: 'Inter-Agent Misalignment' },
  'verification':  { code: 3, name: 'Task Verification & Termination' },
});

const MODES = Object.freeze([
  // Category 1 — Specification & System Design Failures
  { id: 'FM-1.1', name: 'Disobey Task Specification',        category: 'spec' },
  { id: 'FM-1.2', name: 'Disobey Role Specification',        category: 'spec' },
  { id: 'FM-1.3', name: 'Step Repetition',                   category: 'spec' },
  { id: 'FM-1.4', name: 'Loss of Conversation History',      category: 'spec' },
  { id: 'FM-1.5', name: 'Unaware of Termination Conditions', category: 'spec' },
  // Category 2 — Inter-Agent Misalignment
  { id: 'FM-2.1', name: 'Conversation Reset',                category: 'inter-agent' },
  { id: 'FM-2.2', name: 'Fail to Ask for Clarification',     category: 'inter-agent' },
  { id: 'FM-2.3', name: 'Task Derailment',                   category: 'inter-agent' },
  { id: 'FM-2.4', name: 'Information Withholding',           category: 'inter-agent' },
  { id: 'FM-2.5', name: "Ignored Other Agent's Input",       category: 'inter-agent' },
  { id: 'FM-2.6', name: 'Reasoning-Action Mismatch',         category: 'inter-agent' },
  // Category 3 — Task Verification & Termination
  { id: 'FM-3.1', name: 'Premature Termination',             category: 'verification' },
  { id: 'FM-3.2', name: 'No or Incomplete Verification',     category: 'verification' },
  { id: 'FM-3.3', name: 'Incorrect Verification',            category: 'verification' },
]);

const MODE_BY_ID = Object.freeze(
  MODES.reduce((acc, m) => { acc[m.id] = m; return acc; }, {})
);
const MODE_IDS = Object.freeze(MODES.map((m) => m.id));

/** Is `id` one of the 14 canonical MAST mode ids (the `unmapped` sentinel is not a mode)? */
function isMode(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(MODE_BY_ID, id);
}

/** Is `tag` an acceptable failure tag — a mode id OR the `unmapped` sentinel? */
function isTag(tag) {
  return tag === UNMAPPED || isMode(tag);
}

// ── Symbolic reasons a caller that KNOWS the failure passes in ──────────────────
// These are the honest, unambiguous mappings: a caller with real context (a route
// handler that saw an identity mismatch, an orchestrator that saw a subagent stop
// early) names the reason and gets the mode. Everything else falls through to the
// stderr heuristics and then to `unmapped`.
const REASON = Object.freeze({
  TASK_SPEC_VIOLATION:     'TASK_SPEC_VIOLATION',      // → FM-1.1
  ROLE_VIOLATION:          'ROLE_VIOLATION',           // → FM-1.2
  IDENTITY_MISMATCH:       'IDENTITY_MISMATCH',        // → FM-1.2
  STEP_REPETITION:         'STEP_REPETITION',          // → FM-1.3
  CONTEXT_LOSS:            'CONTEXT_LOSS',             // → FM-1.4
  UNAWARE_TERMINATION:     'UNAWARE_TERMINATION',      // → FM-1.5
  CONVERSATION_RESET:      'CONVERSATION_RESET',       // → FM-2.1
  NO_CLARIFICATION:        'NO_CLARIFICATION',         // → FM-2.2
  TASK_DERAILMENT:         'TASK_DERAILMENT',          // → FM-2.3
  INFORMATION_WITHHOLDING: 'INFORMATION_WITHHOLDING',  // → FM-2.4
  IGNORED_AGENT_INPUT:     'IGNORED_AGENT_INPUT',      // → FM-2.5
  REASONING_ACTION_MISMATCH:'REASONING_ACTION_MISMATCH',// → FM-2.6
  PREMATURE_TERMINATION:   'PREMATURE_TERMINATION',    // → FM-3.1
  INCOMPLETE_VERIFICATION: 'INCOMPLETE_VERIFICATION',  // → FM-3.2
  INCORRECT_VERIFICATION:  'INCORRECT_VERIFICATION',   // → FM-3.3
});

const REASON_TO_MODE = Object.freeze({
  TASK_SPEC_VIOLATION:      'FM-1.1',
  ROLE_VIOLATION:           'FM-1.2',
  IDENTITY_MISMATCH:        'FM-1.2',
  STEP_REPETITION:          'FM-1.3',
  CONTEXT_LOSS:             'FM-1.4',
  UNAWARE_TERMINATION:      'FM-1.5',
  CONVERSATION_RESET:       'FM-2.1',
  NO_CLARIFICATION:         'FM-2.2',
  TASK_DERAILMENT:          'FM-2.3',
  INFORMATION_WITHHOLDING:  'FM-2.4',
  IGNORED_AGENT_INPUT:      'FM-2.5',
  REASONING_ACTION_MISMATCH:'FM-2.6',
  PREMATURE_TERMINATION:    'FM-3.1',
  INCOMPLETE_VERIFICATION:  'FM-3.2',
  INCORRECT_VERIFICATION:   'FM-3.3',
});

// ── High-precision stderr heuristics (conservative — ambiguous → unmapped) ──────
// Deliberately tiny. Each pattern maps only where the text is genuinely
// indicative of the mode; a generic non-zero exit stays `unmapped` because the
// binary grade cannot honestly resolve which of 14 modes it was.
const STDERR_HEURISTICS = [
  // An agent acting outside its authorised role (permission/authorisation denied).
  { re: /\b(permission denied|not permitted|unauthori[sz]ed|forbidden|access denied)\b/i, mode: 'FM-1.2' },
  // Context/history exhausted — the conversation history was lost/truncated.
  { re: /\b(context (?:length|window|limit)[^.]{0,24}exceed|maximum context length|context overflow)\b/i, mode: 'FM-1.4' },
];

/**
 * Map a structured failure context to a MAST mode id, or `unmapped`.
 *
 * Priority (highest-confidence signal first):
 *   1. context.mode      — a caller that already resolved a mode id passes it through.
 *   2. context.reason    — a symbolic REASON.* the caller named (unambiguous).
 *   3. stderr heuristics — a small, high-precision pattern set.
 *   4. `unmapped`        — the honest default when the signal cannot resolve a mode.
 *
 * @param {object} [context]
 * @param {string} [context.mode]    a mode id to pass through (validated)
 * @param {string} [context.reason]  a REASON.* symbolic reason
 * @param {string} [context.stderr]  stderr / error text to heuristically match
 * @param {string} [context.signal]  the grader signal (unused for mapping today; reserved)
 * @param {string} [context.action]  the low-cardinality action pattern (reserved)
 * @returns {string} a mode id ('FM-x.y') or the `unmapped` sentinel
 */
function classify(context) {
  const ctx = (context && typeof context === 'object') ? context : {};

  if (isMode(ctx.mode)) return ctx.mode;

  if (typeof ctx.reason === 'string' && REASON_TO_MODE[ctx.reason]) {
    return REASON_TO_MODE[ctx.reason];
  }

  const text = typeof ctx.stderr === 'string' ? ctx.stderr : '';
  if (text) {
    for (const h of STDERR_HEURISTICS) {
      if (h.re.test(text)) return h.mode;
    }
  }

  return UNMAPPED;
}

/**
 * Tag a failure for an envelope: `{ failure_mode, failure_detail }`. The mode is
 * always present (`unmapped` at worst); the human text is preserved as detail so
 * the taxonomy tag REPLACES the free-text error at the wire without discarding it.
 *
 * @param {object} [context]  same shape as classify(); plus context.detail/error
 *   supply the human text to preserve.
 * @returns {{ failure_mode: string, failure_detail: string|null }}
 */
function tagFailure(context) {
  const ctx = (context && typeof context === 'object') ? context : {};
  const failure_mode = classify(ctx);
  let detail = ctx.detail;
  if (detail == null) detail = ctx.stderr;
  if (detail == null) detail = ctx.error;
  let failure_detail = null;
  if (detail != null) {
    failure_detail = String(detail);
    if (failure_detail.length > 2000) failure_detail = failure_detail.slice(0, 2000) + '…';
  }
  return { failure_mode, failure_detail };
}

module.exports = {
  UNMAPPED,
  CATEGORIES,
  MODES,
  MODE_BY_ID,
  MODE_IDS,
  REASON,
  isMode,
  isTag,
  classify,
  tagFailure,
};
