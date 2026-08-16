'use strict';

/**
 * execution-coverage — assembles the /v1/system coverage block for the three
 * DeepSeek-Harness-derived subsystems (ADR-057 journal, ADR-058 capability
 * scope, ADR-059 action pipeline).
 *
 * Honesty rule shared by all three ADRs: `complete` coverage is a MEASURED
 * claim, never inferred from the mere existence of code. This module reports the
 * DECLARED contract (vocabulary, stages, effect types, policy classes) plus any
 * LIVE snapshot handed in from a running instance. When no live instance is
 * wired, `status` is `declared` so an operator can see the slice is present but
 * not yet the authoritative runtime path.
 *
 * @see ADR-057 §D5 / verification step 5
 * @see ADR-058 §D3
 * @see ADR-059 §D5 / verification step 5
 */

const { VOCABULARY, SCHEMA_ID } = require('./execution-journal');
const { EFFECT_TYPES, TRUST_CLASSES } = require('./capability-scope');
const { STAGES, SIDE_EFFECT_CLASSES, APPROVAL_REQUIRED } = require('./agent-action-pipeline');

/**
 * @param {object} [live]
 * @param {object} [live.journal]    - result of ExecutionJournal#coverage()
 * @param {object} [live.capability] - { tree_hash, active_effects } from a CapabilityScope
 * @param {object} [live.pipeline]   - result of AgentActionPipeline#coverage()
 * @returns {object} the /v1/system `execution` block
 */
function buildExecutionCoverage(live = {}) {
  return {
    journal: {
      adr: 'ADR-057',
      schema: SCHEMA_ID,
      status: live.journal ? 'live' : 'declared',
      vocabulary: VOCABULARY,
      // Per-harness proven-event coverage is a measured claim; until a harness
      // mapper proves an event it stays absent, never assumed.
      harness_coverage: (live.journal && live.journal.harness_coverage) || {},
      sessions: (live.journal && live.journal.sessions) || {},
      mode: (live.journal && live.journal.mode) || null,
    },
    capabilities: {
      adr: 'ADR-058',
      status: live.capability ? 'live' : 'declared',
      effect_types: EFFECT_TYPES,
      trust_classes: TRUST_CLASSES,
      tree_hash: (live.capability && live.capability.tree_hash) || null,
      active_effects: (live.capability && live.capability.active_effects) || 0,
    },
    action_pipeline: {
      adr: 'ADR-059',
      status: live.pipeline ? 'live' : 'declared',
      stages: STAGES,
      side_effect_classes: SIDE_EFFECT_CLASSES,
      approval_required: Array.from(APPROVAL_REQUIRED),
      // Per-action-class enforcement coverage (D5) — measured, not inferred.
      class_coverage: (live.pipeline && live.pipeline.class_coverage) || {},
      guards: (live.pipeline && live.pipeline.guards) || [],
    },
  };
}

module.exports = { buildExecutionCoverage };
