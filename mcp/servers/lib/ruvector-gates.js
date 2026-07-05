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
  learningEnabled: () => boolGate('RUVECTOR_MEMORY_LEARNING_ENABLED'),
  recordTrajectories: () => boolGate('RUVECTOR_RECORD_TRAJECTORIES'),
  feedRetrieval:   () => boolGate('RUVECTOR_FEED_RETRIEVAL'),
  feedRouting:     () => boolGate('RUVECTOR_FEED_ROUTING'),
  // ADMIN write override (existing convention; used by delete/sweep + protected ns).
  adminWrite:      () => process.env.RUVECTOR_ADMIN_WRITE === 'true',
};

// Integer tunables (documented defaults).
const params = {
  // Clamp to sane minimums so a forced/misconfigured 0 cannot cause a
  // division-by-zero downstream (recency half-life divides; sample count floors at 0).
  aggregateMinSamples: () => Math.max(0, intGate('RUVECTOR_AGGREGATE_MIN_SAMPLES', 20)),
  recencyHalfLifeDays: () => Math.max(1, intGate('RUVECTOR_RECENCY_HALF_LIFE_DAYS', 14)),
};

module.exports = { boolGate, intGate, gates, params };
