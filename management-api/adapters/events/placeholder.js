'use strict';

/**
 * Placeholder stub for the events adapter slot.
 * Exists solely so contract tests can assert method-shape compliance.
 */
class EventsAdapterPlaceholder {
  constructor() {
    this.CONTRACT_VERSION = '1.0.0';
    this.enabled = false;
  }

  async dispatch(_event) { throw new AdapterDisabled('events'); }
  async subscribe(_filter, _handler) { throw new AdapterDisabled('events'); }
  async unsubscribe(_subscriptionId) { throw new AdapterDisabled('events'); }
}

class AdapterDisabled extends Error {
  constructor(slot) {
    super(`Adapter '${slot}' is disabled`);
    this.name = 'AdapterDisabled';
    this.slot = slot;
  }
}

module.exports = { EventsAdapterPlaceholder, AdapterDisabled };
