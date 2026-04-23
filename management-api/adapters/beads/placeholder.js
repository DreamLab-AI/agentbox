'use strict';

/**
 * Placeholder stub for the beads adapter slot.
 * Exists solely so contract tests can assert method-shape compliance.
 * Replace with a real implementation in the relevant impl file.
 */
class BeadsAdapterPlaceholder {
  constructor() {
    this.CONTRACT_VERSION = '1.0.0';
    this.enabled = false;
  }

  async createEpic(_opts) { throw new AdapterDisabled('beads'); }
  async createChild(_opts) { throw new AdapterDisabled('beads'); }
  async claim(_id, _actor) { throw new AdapterDisabled('beads'); }
  async close(_id, _outcome) { throw new AdapterDisabled('beads'); }
  async getReady(_filter) { throw new AdapterDisabled('beads'); }
  async show(_id) { throw new AdapterDisabled('beads'); }
}

class AdapterDisabled extends Error {
  constructor(slot) {
    super(`Adapter '${slot}' is disabled`);
    this.name = 'AdapterDisabled';
    this.slot = slot;
  }
}

module.exports = { BeadsAdapterPlaceholder, AdapterDisabled };
