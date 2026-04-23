'use strict';

/**
 * memory/off — disabled adapter. Every method throws AdapterDisabled.
 *
 * @see ADR-005 §The adapter interface — off-class behaviour
 * @see PRD-001 §Capabilities and adapters
 */

const { BaseAdapter } = require('../base');
const { AdapterDisabled } = require('../errors');
const CONTRACT_VERSIONS = require('../contract-versions');

class OffMemoryAdapter extends BaseAdapter {
  constructor() {
    super('memory', 'off', CONTRACT_VERSIONS.memory);
  }

  async store()    { throw new AdapterDisabled('memory'); }
  async search()   { throw new AdapterDisabled('memory'); }
  async retrieve() { throw new AdapterDisabled('memory'); }
  async del()      { throw new AdapterDisabled('memory'); }
  async list()     { throw new AdapterDisabled('memory'); }
}

module.exports = { OffMemoryAdapter, AdapterDisabled };
