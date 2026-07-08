'use strict';

/**
 * model-diversity — the anti-fox cross-model verification seam (REC-8,
 * PRD-019 / ADR-037 D4).
 *
 * This is a THIN wrapper over the ADR-011 named-consultant contract, not a
 * router. ADR-011 settled that consultants are *named and explicitly invoked*,
 * never anonymous backends a cost-rewriting router silently switches between;
 * that decision is an input here, not reopened. All this module does is answer
 * one question the anti-fox rule (meta-PRD Quality Gate 3) forces:
 *
 *   "A change was produced by model family X. Which NAMED consultant, from a
 *    DIFFERENT family, should verify the closure?"
 *
 * It is pure config + selection logic:
 *   - a fixed registry mapping each ADR-011 consultant to its model family,
 *   - a resolver that maps a producer's model id (or bare family token) to a
 *     family,
 *   - a selector that returns a consultant whose family ≠ the producer's, and
 *     null (an honest shortfall) when no different-family consultant is
 *     available — it NEVER falls back to a same-family verifier,
 *   - a verification record the caller stamps on the dispatch so the producing
 *     family is recorded against the check (AC3).
 *
 * The five consultants and their families are fixed by ADR-011; the family
 * registry lives here as config-as-code (not a new agentbox.toml key, so the
 * manifest schema is untouched and no E016 UnknownManifestKey is introduced).
 *
 * @see docs/reference/adr/ADR-011-consultation-mcps.md  (named consultants)
 * @see docs/reference/adr/ADR-037-gap-close-agentbox-decisions.md §D4
 * @see docs/reference/prd/PRD-019-gap-close-agentbox.md  §REC-8
 */

// ── Config: consultant → model family (ADR-011's five named consultants) ─────
const FAMILY_BY_CONSULTANT = Object.freeze({
  codex:       'openai',      // OpenAI GPT / Codex
  antigravity: 'google',      // Google Gemini
  zai:         'zhipu',       // Z.AI / GLM (Zhipu AI)
  perplexity:  'perplexity',  // Perplexity Sonar
  deepseek:    'deepseek',    // DeepSeek
});

// The canonical stable order the selector considers candidates in, so an
// unbiased "first different-family consultant" pick is deterministic and
// testable. Mirrors the ADR-011 README table order.
const CONSULTANT_ORDER = Object.freeze(['codex', 'antigravity', 'zai', 'perplexity', 'deepseek']);

// The set of families the registry knows a consultant for — the ONLY families
// a verification can actually be dispatched to.
const CONSULTANT_FAMILIES = Object.freeze(
  Array.from(new Set(Object.values(FAMILY_BY_CONSULTANT)))
);

// ── Producer-side model-id → family rules ────────────────────────────────────
// The producer of a change is frequently the coordinator itself (Claude) or one
// of the consultants; the family is resolved from whatever model id the caller
// reports. Prefix rules first, then substring fallbacks for vendor-prefixed ids
// (e.g. "openai/gpt-5.5", "us.anthropic.claude-…" Bedrock ids).
const MODEL_PREFIX_RULES = Object.freeze([
  [/^(?:gpt|o[1-4]|codex|chatgpt)/, 'openai'],
  [/^gemini/,                       'google'],
  [/^(?:glm|zhipu)/,                'zhipu'],
  [/^sonar/,                        'perplexity'],
  [/^deepseek/,                     'deepseek'],
  [/^(?:claude|opus|sonnet|haiku)/, 'anthropic'],
  [/^grok/,                         'xai'],
  [/^(?:code)?llama/,               'meta'],
  [/^(?:mistral|mixtral|codestral|magistral)/, 'mistral'],
  [/^qwen/,                         'qwen'],
  [/^command/,                      'cohere'],
]);

const SUBSTRING_RULES = Object.freeze([
  ['anthropic', 'anthropic'],
  ['claude',    'anthropic'],
  ['gpt',       'openai'],
  ['gemini',    'google'],
  ['deepseek',  'deepseek'],
  ['sonar',     'perplexity'],
  ['glm',       'zhipu'],
]);

// Bare family tokens the resolver accepts as-is (the ADR-037 D4 input is "the
// producer's model family", which a caller may already hold as a token).
const KNOWN_FAMILIES = Object.freeze(new Set([
  'openai', 'google', 'zhipu', 'perplexity', 'deepseek',
  'anthropic', 'xai', 'meta', 'mistral', 'qwen', 'cohere', 'unknown',
]));

/**
 * Resolve a model family from either a consultant name, a bare family token, or
 * a concrete model id. Returns a lowercase family token, or 'unknown' when the
 * input is unrecognisable (an unknown producer family is, by construction,
 * different from every known consultant family — so selection still proceeds
 * safely).
 *
 * @param {string} nameOrModel
 * @returns {string} family token
 */
function familyOf(nameOrModel) {
  if (nameOrModel == null) return 'unknown';
  const raw = String(nameOrModel).trim();
  if (!raw) return 'unknown';

  // A named consultant → its registered family.
  if (Object.prototype.hasOwnProperty.call(FAMILY_BY_CONSULTANT, raw)) {
    return FAMILY_BY_CONSULTANT[raw];
  }

  const lower = raw.toLowerCase();

  // Already a bare family token.
  if (KNOWN_FAMILIES.has(lower)) return lower;

  // Vendor-prefixed ids: take the segment after the last '/' or the last '.'
  // that precedes a known model token (handles "openai/gpt-5.5" and Bedrock
  // "us.anthropic.claude-…").
  const tail = lower.includes('/') ? lower.slice(lower.lastIndexOf('/') + 1) : lower;

  for (const [re, fam] of MODEL_PREFIX_RULES) {
    if (re.test(tail)) return fam;
  }
  for (const [needle, fam] of SUBSTRING_RULES) {
    if (lower.includes(needle)) return fam;
  }
  return 'unknown';
}

/** True iff two families are both resolvable AND identical. */
function sameFamily(a, b) {
  const fa = familyOf(a);
  const fb = familyOf(b);
  return fa !== 'unknown' && fa === fb;
}

/**
 * True iff a verifier of `verifierFamily` is a valid anti-fox check of a change
 * produced by `producerFamily`: the two families must differ (an 'unknown'
 * producer differs from every known consultant family, so it is diverse).
 */
function isDiverse(producerFamily, verifierFamily) {
  const p = familyOf(producerFamily);
  const v = familyOf(verifierFamily);
  if (v === 'unknown') return false; // a verifier we cannot place is not a proof of diversity
  return p !== v;
}

/**
 * Select a NAMED consultant from a family different to the producer's.
 *
 * @param {object}   opts
 * @param {string}   opts.producerFamily        the producing model family or model id (ADR-037 D4 input)
 * @param {string[]} [opts.candidates]          consultant names to choose among (default: all five)
 * @param {string[]} [opts.exclude]             consultant names to exclude (e.g. unhealthy/disabled)
 * @param {string}   [opts.prefer]              a preferred consultant; honoured only if it is different-family
 * @returns {{consultant:string, family:string, producer_family:string,
 *            candidates_considered:string[], reason:string} | null}
 *          the dispatch selection, or null when NO different-family consultant
 *          is available (honest shortfall — never a same-family fallback).
 */
function selectVerifier(opts = {}) {
  const producer_family = familyOf(opts.producerFamily);
  const exclude = new Set(opts.exclude || []);
  const pool = (Array.isArray(opts.candidates) && opts.candidates.length
    ? opts.candidates
    : CONSULTANT_ORDER
  ).filter((name) => Object.prototype.hasOwnProperty.call(FAMILY_BY_CONSULTANT, name) && !exclude.has(name));

  // Preserve the canonical order for deterministic selection.
  const ordered = CONSULTANT_ORDER.filter((n) => pool.includes(n));
  const diverse = ordered.filter((name) => isDiverse(producer_family, FAMILY_BY_CONSULTANT[name]));

  if (diverse.length === 0) {
    return null;
  }

  let chosen;
  if (opts.prefer && diverse.includes(opts.prefer)) {
    chosen = opts.prefer;
  } else {
    chosen = diverse[0];
  }

  return {
    consultant: chosen,
    family: FAMILY_BY_CONSULTANT[chosen],
    producer_family,
    candidates_considered: ordered,
    reason: opts.prefer && chosen === opts.prefer
      ? 'preferred different-family consultant'
      : 'first different-family consultant in canonical order',
  };
}

/**
 * Build the verification record stamped on the dispatch so the producing family
 * is recorded against the check (AC3). `anti_fox_ok` is the mechanical Quality
 * Gate 3 assertion: the verifier's family must differ from the producer's.
 *
 * @param {object} opts
 * @param {string} opts.producerFamily   producing family or model id
 * @param {string} opts.verifier         verifying consultant name (or its family/model)
 * @param {string} [opts.task]           short task label ('closure-verification' by default)
 * @returns {{kind:string, task:string, producer_family:string,
 *            verifier:string, verifier_family:string, anti_fox_ok:boolean, at:string}}
 */
function verificationRecord(opts = {}) {
  const producer_family = familyOf(opts.producerFamily);
  const verifier_family = familyOf(opts.verifier);
  return {
    kind: 'anti-fox-verification',
    task: opts.task || 'closure-verification',
    producer_family,
    verifier: opts.verifier || null,
    verifier_family,
    anti_fox_ok: isDiverse(producer_family, verifier_family),
    at: new Date().toISOString(),
  };
}

module.exports = {
  FAMILY_BY_CONSULTANT,
  CONSULTANT_ORDER,
  CONSULTANT_FAMILIES,
  familyOf,
  sameFamily,
  isDiverse,
  selectVerifier,
  verificationRecord,
};
