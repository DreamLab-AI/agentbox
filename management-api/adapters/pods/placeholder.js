'use strict';

/**
 * Placeholder stub for the pods adapter slot.
 * Exists solely so contract tests can assert method-shape compliance.
 */
class PodsAdapterPlaceholder {
  constructor() {
    this.CONTRACT_VERSION = '1.0.0';
    this.enabled = false;
  }

  async write(_uri, _body, _contentType) { throw new AdapterDisabled('pods'); }
  async read(_uri) { throw new AdapterDisabled('pods'); }
  async patch(_uri, _patch) { throw new AdapterDisabled('pods'); }
  async del(_uri) { throw new AdapterDisabled('pods'); }
  async list(_container) { throw new AdapterDisabled('pods'); }
}

class AdapterDisabled extends Error {
  constructor(slot) {
    super(`Adapter '${slot}' is disabled`);
    this.name = 'AdapterDisabled';
    this.slot = slot;
  }
}

module.exports = { PodsAdapterPlaceholder, AdapterDisabled };
