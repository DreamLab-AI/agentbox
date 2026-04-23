'use strict';

/**
 * orchestrator/off — disabled adapter. Every method throws AdapterDisabled.
 *
 * @see ADR-005 §The adapter interface — off-class behaviour
 * @see PRD-001 §Capabilities and adapters
 */

const { BaseAdapter } = require('../base');
const { AdapterDisabled } = require('../errors');
const CONTRACT_VERSIONS = require('../contract-versions');

class OffOrchestratorAdapter extends BaseAdapter {
  constructor() {
    super('orchestrator', 'off', CONTRACT_VERSIONS.orchestrator);
  }

  async spawnAgent()      { throw new AdapterDisabled('orchestrator'); }
  async streamEvent()     { throw new AdapterDisabled('orchestrator'); }
  async listAgents()      { throw new AdapterDisabled('orchestrator'); }
  async terminateAgent()  { throw new AdapterDisabled('orchestrator'); }
}

module.exports = { OffOrchestratorAdapter, AdapterDisabled };
