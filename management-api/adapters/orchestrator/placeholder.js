'use strict';

/**
 * Placeholder stub for the orchestrator adapter slot.
 * Exists solely so contract tests can assert method-shape compliance.
 */
class OrchestratorAdapterPlaceholder {
  constructor() {
    this.CONTRACT_VERSION = '1.0.0';
    this.enabled = false;
  }

  async spawnAgent(_spec) { throw new AdapterDisabled('orchestrator'); }
  async streamEvent(_agentId, _handler) { throw new AdapterDisabled('orchestrator'); }
  async listAgents() { throw new AdapterDisabled('orchestrator'); }
  async terminateAgent(_agentId) { throw new AdapterDisabled('orchestrator'); }
}

class AdapterDisabled extends Error {
  constructor(slot) {
    super(`Adapter '${slot}' is disabled`);
    this.name = 'AdapterDisabled';
    this.slot = slot;
  }
}

module.exports = { OrchestratorAdapterPlaceholder, AdapterDisabled };
