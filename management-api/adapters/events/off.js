'use strict';

/**
 * events/off — disabled adapter.
 *
 * Per ADR-005: dispatch is a no-op (not an error) for the off events adapter.
 * subscribe and unsubscribe throw AdapterDisabled.
 *
 * @see ADR-005 §The adapter interface — off-class behaviour
 * @see PRD-001 §Capabilities and adapters
 */

const { BaseAdapter } = require('../base');
const { AdapterDisabled } = require('../errors');
const CONTRACT_VERSIONS = require('../contract-versions');

class OffEventsAdapter extends BaseAdapter {
  constructor() {
    super('events', 'off', CONTRACT_VERSIONS.events);
  }

  // Per ADR-005: dispatch no-ops (does not throw) for the off events adapter.
  async dispatch(_event) { return null; }

  async subscribe()    { throw new AdapterDisabled('events'); }
  async unsubscribe()  { throw new AdapterDisabled('events'); }
}

module.exports = { OffEventsAdapter, AdapterDisabled };
