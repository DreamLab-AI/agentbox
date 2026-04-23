'use strict';

/**
 * Canonical contract versions for each adapter slot.
 *
 * These values mirror what the management-api publishes at GET /v1/meta
 * (see ADR-005 §Contract versioning).  Bump MAJOR here when the interface
 * changes in a breaking way; every implementation class must be updated
 * to match before CI turns green again.
 *
 * Format: MAJOR.MINOR.PATCH  (strict semver, no pre-release suffix)
 */
const EXPECTED_CONTRACT_VERSIONS = {
  beads:        '1.0.0',
  pods:         '1.0.0',
  memory:       '1.0.0',
  events:       '1.0.0',
  orchestrator: '1.0.0',
};

/** Semver regex (no build metadata) used by shared-assertions.js */
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

/**
 * SLO table mirrored from ADR-005 §Service-level objectives.
 * Stored here so performance test cases can import a single source of truth.
 */
const SLO = {
  beads: {
    write: { p95Ms: 200, throughputFloor: 50, errorCeiling: 0.005 },
    read:  { p95Ms: 100, throughputFloor: 200, errorCeiling: 0.005 },
  },
  pods: {
    write: { p95Ms: 300, throughputFloor: 20, errorCeiling: 0.01 },
    read:  { p95Ms: 150, throughputFloor: 100, errorCeiling: 0.005 },
  },
  memory: {
    store:  { p95Ms: 500, throughputFloor: 10, errorCeiling: 0.01 },
    search: { p95Ms: 250, throughputFloor: 50, errorCeiling: 0.005 },
  },
  events: {
    dispatch: { p95Ms: 50, throughputFloor: 500, errorCeiling: 0.001 },
  },
  orchestrator: {
    spawnAgent:  { p95Ms: 2000, throughputFloor: 2,  errorCeiling: 0.02 },
    streamEvent: { p95Ms: 20,   throughputFloor: null, errorCeiling: 0.005 },
  },
};

module.exports = { EXPECTED_CONTRACT_VERSIONS, SEMVER_RE, SLO };
