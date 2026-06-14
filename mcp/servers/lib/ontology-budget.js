'use strict';
// ontology-budget.js — model-tier token governor for the ontology augmentation
// binding (PRD-020 / ADR-116). Pure, dependency-free, synchronous.
//
// The structural overflow guarantee lives HERE: every channel routes its
// serialised subgraph through clampToBudget() before it can reach a model
// context. The cap is a hard ceiling per tier — an override may only LOWER it,
// never raise it (closes the "discretionary budget" adversarial finding).
//
// full:true (page-body drill-down) is forbidden below `sonnet` and, where
// allowed, the body is chunked to <= the tier budget (closes the 93k-token leak).

/** Per-tier defaults. Aligned to ADR-026 routing + ADR-116 budgets. */
const TIERS = Object.freeze({
  booster: { maxTokens: 80,   depth: 0, mode: 'menu',   allowFull: false },
  haiku:   { maxTokens: 500,  depth: 0, mode: 'menu',   allowFull: false },
  sonnet:  { maxTokens: 2000, depth: 1, mode: 'expand', allowFull: true  },
  opus:    { maxTokens: 6000, depth: 2, mode: 'expand', allowFull: true  },
});

const DEFAULT_TIER = 'sonnet';
const TRUNCATION_MARK = '\n# … [truncated: token budget reached]';

/** Resolve a tier name to its frozen config; unknown → DEFAULT_TIER. */
function tierConfig(tier) {
  return TIERS[tier] || TIERS[DEFAULT_TIER];
}

/**
 * Cheap, deterministic token estimate. ~4 chars/token is the standard
 * heuristic; we round UP so the governor errs toward under-filling, never over.
 */
function estimateTokens(str) {
  if (!str) return 0;
  return Math.ceil(String(str).length / 4);
}

/**
 * Resolve the effective hard ceiling for a (tier, override) pair.
 * Override may only lower the tier ceiling. A non-positive/absent override
 * yields the tier default. The result is never above the tier max.
 */
function resolveBudget(tier, maxTokensOverride) {
  const cfg = tierConfig(tier);
  if (typeof maxTokensOverride === 'number' && maxTokensOverride > 0) {
    return Math.min(maxTokensOverride, cfg.maxTokens);
  }
  return cfg.maxTokens;
}

/**
 * Whether a full:true (page-body) drill-down is permitted at this tier.
 * Forbidden below sonnet by construction.
 */
function isFullAllowed(tier) {
  return tierConfig(tier).allowFull === true;
}

/**
 * Clamp serialised text to the resolved budget for (tier, override).
 * Truncates on a line boundary where possible so the emitted Turtle stays
 * parseable-ish, then appends a truncation marker.
 *
 * @returns {{text:string, tokens:number, truncated:boolean, budget:number}}
 */
function clampToBudget(text, tier, maxTokensOverride) {
  const budget = resolveBudget(tier, maxTokensOverride);
  const src = text == null ? '' : String(text);
  const tokens = estimateTokens(src);
  if (tokens <= budget) {
    return { text: src, tokens, truncated: false, budget };
  }
  // Reserve room for the truncation marker within the budget.
  const markTokens = estimateTokens(TRUNCATION_MARK);
  const charBudget = Math.max(0, (budget - markTokens) * 4);
  let cut = src.slice(0, charBudget);
  const lastNl = cut.lastIndexOf('\n');
  if (lastNl > charBudget * 0.5) cut = cut.slice(0, lastNl); // prefer a line boundary
  const out = cut + TRUNCATION_MARK;
  return { text: out, tokens: estimateTokens(out), truncated: true, budget };
}

/**
 * The breadcrumb cap for the synchronous PUSH channel. A single line, hard
 * ceiling 80 tokens, clamped LOCALLY (never trusting a network response).
 */
function clampBreadcrumb(line) {
  const { text, truncated } = clampToBudget(line, 'booster');
  // Breadcrumb must be a single line; collapse any newlines a serialiser left.
  return { line: text.replace(/\n+/g, ' ').trim(), truncated };
}

module.exports = {
  TIERS,
  DEFAULT_TIER,
  tierConfig,
  estimateTokens,
  resolveBudget,
  isFullAllowed,
  clampToBudget,
  clampBreadcrumb,
};
