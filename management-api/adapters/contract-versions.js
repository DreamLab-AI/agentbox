/**
 * Adapter contract versions per ADR-005 §Contract versioning.
 * Bump the relevant version string whenever the contract for that
 * adapter slot changes in a breaking or additive way.
 */
module.exports = {
  // 1.1.0: additive — addDependency() + dependency-aware getReady() (bead_deps work-DAG)
  beads: '1.1.0',
  pods: '1.0.0',
  memory: '1.0.0',
  events: '1.0.0',
  orchestrator: '1.0.0'
};
