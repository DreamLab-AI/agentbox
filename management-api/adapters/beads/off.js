'use strict';

/**
 * beads/off — disabled adapter. Every method throws AdapterDisabled.
 *
 * @see ADR-005 §The adapter interface — off-class behaviour
 * @see PRD-001 §Capabilities and adapters
 */

const { BaseAdapter } = require('../base');
const { AdapterDisabled } = require('../errors');
const CONTRACT_VERSIONS = require('../contract-versions');

class OffBeadsAdapter extends BaseAdapter {
  constructor() {
    super('beads', 'off', CONTRACT_VERSIONS.beads);
  }

  async createEpic()  { throw new AdapterDisabled('beads'); }
  async createChild() { throw new AdapterDisabled('beads'); }
  async claim()       { throw new AdapterDisabled('beads'); }
  async close()       { throw new AdapterDisabled('beads'); }
  async getReady()    { throw new AdapterDisabled('beads'); }
  async show()        { throw new AdapterDisabled('beads'); }
}

module.exports = { OffBeadsAdapter, AdapterDisabled };
