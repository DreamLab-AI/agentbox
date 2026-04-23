'use strict';

/**
 * BaseAdapter — abstract base class for all adapter slot implementations.
 *
 * Every concrete implementation must:
 *   - Call super(slot, impl, contractVersion) from its constructor
 *   - Expose the CONTRACT_VERSION property set here
 *   - Implement all methods mandated by its slot interface
 *
 * @see ADR-005 §The adapter interface
 * @see PRD-001 §Capabilities and adapters
 */
class BaseAdapter {
  /**
   * @param {string} slot            - Adapter slot name (beads|pods|memory|events|orchestrator)
   * @param {string} impl            - Implementation name (local-sqlite|external|off|…)
   * @param {string} contractVersion - Semver string matching contract-versions.js for this slot
   */
  constructor(slot, impl, contractVersion) {
    if (!slot) throw new Error('BaseAdapter: slot is required');
    if (!impl) throw new Error('BaseAdapter: impl is required');
    if (!contractVersion) throw new Error('BaseAdapter: contractVersion is required');
    this.slot = slot;
    this.impl = impl;
    this.CONTRACT_VERSION = contractVersion;
    this.enabled = impl !== 'off';
  }
}

module.exports = { BaseAdapter };
