'use strict';
/**
 * ruvector-gates.js — the single source of truth for PRD-018 / ADR-036 feature
 * gates on the governed memory MCP path.
 *
 * The entrypoint injects these env vars into the generated `.mcp.json` env from
 * `agentbox.toml` (`[integrations.ruvector_external]` + `[memory_learning]`).
 * Boolean gates are ON **iff** the env value is exactly the string '1' or 'true'
 * (DDD-016 D6, PRD-018 metric 1: with no gate set, behaviour is byte-identical
 * to today). Integer gates carry documented defaults.
 *
 * Keep this list in lock-step with the agentbox.toml manifest keys; the exact
 * env names are the contract and must not drift.
 */

function boolGate(name) {
  const v = process.env[name];
  return v === '1' || v === 'true';
}

function intGate(name, def) {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

// Boolean feature gates (default OFF → today's behaviour).
const gates = {
  typedMetadata:   () => boolGate('RUVECTOR_TYPED_METADATA'),
  hybridSearch:    () => boolGate('RUVECTOR_HYBRID_SEARCH'),
  metadataGin:     () => boolGate('RUVECTOR_METADATA_GIN'),
  healthTool:      () => boolGate('RUVECTOR_HEALTH_TOOL'),
  episodicTtlSweep:() => boolGate('RUVECTOR_EPISODIC_TTL_SWEEP'),
  memoryOrient:    () => boolGate('RUVECTOR_MEMORY_ORIENT'),
  // ADR-2082: forward swarm/agent/task/coordination tools to a filtered ruflo
  // child. Orchestration-only; memory_* never crosses (DENIED_PREFIXES).
  orchestrationProxy: () => boolGate('RUVECTOR_ORCHESTRATION_PROXY'),
  learningEnabled: () => boolGate('RUVECTOR_MEMORY_LEARNING_ENABLED'),
  recordTrajectories: () => boolGate('RUVECTOR_RECORD_TRAJECTORIES'),
  feedRetrieval:   () => boolGate('RUVECTOR_FEED_RETRIEVAL'),
  feedRouting:     () => boolGate('RUVECTOR_FEED_ROUTING'),
  // ADMIN write override (existing convention; used by delete/sweep + protected ns).
  adminWrite:      () => process.env.RUVECTOR_ADMIN_WRITE === 'true',
};

// ── ADR-2017 producer-before-consumer admission (closeout 2026-09-05) ────────
//
// THE INVARIANT, chosen and stated: producer-before-consumer means a QUALIFIED
// RETAINED CORPUS, not merely active capture.
//
// Neither of the two obvious readings survives on its own. "Active capture" is
// too strong — stopping the recorder does not erase the aggregates it already
// produced, and forbidding their reuse would discard a corpus that is still
// perfectly valid. "Any retained corpus" is too weak — that is exactly the
// degenerate state the review found, where a consumer scores against whatever
// happens to be in the table with nobody having decided it is fit to use.
//
// So a consumer is admitted iff:
//   1. the master learning gate is on (an off master admits nothing), AND
//   2. the consumer's own gate is on, AND
//   3. EITHER the producer is currently capturing (RUVECTOR_RECORD_TRAJECTORIES),
//      OR an operator has explicitly accepted the retained corpus by naming a
//      receipt in RUVECTOR_RETAINED_CORPUS_ACCEPTED — and that corpus is fresher
//      than RUVECTOR_RETAINED_CORPUS_MAX_AGE_DAYS.
//
// Condition 3's second branch is the provenance/freshness binding the ADR asks
// for: an operator says WHICH corpus they accepted, and the runtime checks that
// the corpus is not stale before letting it move a score. An environment
// override cannot skip it — there is no boolean that means "trust me".
//
// This helper is the SINGLE admission decision. The validator enforces the same
// invariant statically (E066/W066) and the runtime consumers call this before
// applying any effect, so an env override on a running process is caught too.
const RETAINED_CORPUS_DEFAULT_MAX_AGE_DAYS = 30;

function retainedCorpusMaxAgeDays() {
  return Math.max(1, intGate('RUVECTOR_RETAINED_CORPUS_MAX_AGE_DAYS', RETAINED_CORPUS_DEFAULT_MAX_AGE_DAYS));
}

/**
 * Decide whether a learning consumer may take effect right now.
 *
 * @param {'feed_retrieval'|'feed_routing'} which
 * @param {object} [obs]  observed corpus state, when the caller has it
 * @param {string|Date|null} [obs.corpusLastUpdated] newest aggregate timestamp
 * @param {number} [obs.corpusSize] number of retained aggregates
 * @returns {{admitted:boolean, reason:string, receipt?:string, max_age_days?:number, corpus_age_days?:number|null}}
 */
function consumerAdmission(which, obs = {}) {
  const gateOn = which === 'feed_routing' ? gates.feedRouting() : gates.feedRetrieval();
  if (!gateOn) return { admitted: false, reason: 'consumer-gate-off' };
  if (!gates.learningEnabled()) {
    // The master gate is the outer boundary; a consumer gate left on behind an
    // off master must not act (the review's master-off/consumer-on case).
    return { admitted: false, reason: 'master-learning-off' };
  }
  if (gates.recordTrajectories()) return { admitted: true, reason: 'active-capture' };

  const receipt = String(process.env.RUVECTOR_RETAINED_CORPUS_ACCEPTED || '').trim();
  if (!receipt) {
    return {
      admitted: false,
      reason: 'producer-off-and-retained-corpus-not-accepted',
    };
  }
  const maxAgeDays = retainedCorpusMaxAgeDays();
  let ageDays = null;
  if (obs.corpusLastUpdated) {
    const t = obs.corpusLastUpdated instanceof Date
      ? obs.corpusLastUpdated.getTime()
      : Date.parse(String(obs.corpusLastUpdated));
    if (Number.isFinite(t)) ageDays = (Date.now() - t) / 86400000;
  }
  // Emptiness is diagnosed first: an empty corpus is also undateable, and
  // "there is nothing here" is the more useful answer than "I cannot date it".
  if (obs.corpusSize !== undefined && !(Number(obs.corpusSize) > 0)) {
    return { admitted: false, reason: 'retained-corpus-empty', receipt, max_age_days: maxAgeDays };
  }
  if (ageDays === null) {
    // An accepted corpus we cannot date is not a fresh corpus. Refuse rather
    // than assume — an unmeasurable corpus is the same risk as a stale one.
    return { admitted: false, reason: 'retained-corpus-freshness-unknown', receipt, max_age_days: maxAgeDays };
  }
  if (ageDays > maxAgeDays) {
    return { admitted: false, reason: 'retained-corpus-stale', receipt, max_age_days: maxAgeDays, corpus_age_days: ageDays };
  }
  return { admitted: true, reason: 'retained-corpus-accepted', receipt, max_age_days: maxAgeDays, corpus_age_days: ageDays };
}

// Integer tunables (documented defaults).
const params = {
  // Clamp to sane minimums so a forced/misconfigured 0 cannot cause a
  // division-by-zero downstream (recency half-life divides; sample count floors at 0).
  aggregateMinSamples: () => Math.max(0, intGate('RUVECTOR_AGGREGATE_MIN_SAMPLES', 20)),
  recencyHalfLifeDays: () => Math.max(1, intGate('RUVECTOR_RECENCY_HALF_LIFE_DAYS', 14)),
};

module.exports = { boolGate, intGate, gates, params, consumerAdmission, retainedCorpusMaxAgeDays, RETAINED_CORPUS_DEFAULT_MAX_AGE_DAYS };
