'use strict';

/**
 * pods/off — disabled adapter. Every method throws AdapterDisabled.
 *
 * @see ADR-005 §The adapter interface — off-class behaviour
 * @see PRD-001 §Capabilities and adapters
 */

const { BaseAdapter } = require('../base');
const { AdapterDisabled } = require('../errors');
const CONTRACT_VERSIONS = require('../contract-versions');

class OffPodsAdapter extends BaseAdapter {
  constructor() {
    super('pods', 'off', CONTRACT_VERSIONS.pods);
  }

  async write()  { throw new AdapterDisabled('pods'); }
  async read()   { throw new AdapterDisabled('pods'); }
  async patch()  { throw new AdapterDisabled('pods'); }
  async del()    { throw new AdapterDisabled('pods'); }
  async list()   { throw new AdapterDisabled('pods'); }
}

module.exports = { OffPodsAdapter, AdapterDisabled };
