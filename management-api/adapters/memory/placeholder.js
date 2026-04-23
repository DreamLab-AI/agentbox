'use strict';

/**
 * Placeholder stub for the memory adapter slot.
 * Exists solely so contract tests can assert method-shape compliance.
 */
class MemoryAdapterPlaceholder {
  constructor() {
    this.CONTRACT_VERSION = '1.0.0';
    this.enabled = false;
  }

  async store(_key, _value, _namespace) { throw new AdapterDisabled('memory'); }
  async search(_query, _opts) { throw new AdapterDisabled('memory'); }
  async retrieve(_key, _namespace) { throw new AdapterDisabled('memory'); }
  async del(_key, _namespace) { throw new AdapterDisabled('memory'); }
}

class AdapterDisabled extends Error {
  constructor(slot) {
    super(`Adapter '${slot}' is disabled`);
    this.name = 'AdapterDisabled';
    this.slot = slot;
  }
}

module.exports = { MemoryAdapterPlaceholder, AdapterDisabled };
