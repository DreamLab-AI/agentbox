'use strict';

/**
 * orchestrator/stdio-bridge — exposes a stdio spawn channel for external callers.
 *
 * In federated mode, agent spawns are delegated over stdio JSON-RPC or the
 * /v1/agent-events HTTP stream. This adapter wraps that protocol.
 *
 * @see ADR-005 §orchestrator slot, §Manifest contract (E003)
 * @see PRD-001 §Capabilities and adapters
 */

const { randomUUID } = require('crypto');
const { BaseAdapter } = require('../base');
const { NotFound, SpawnError } = require('../errors');
const CONTRACT_VERSIONS = require('../contract-versions');

class StdioBridgeOrchestratorAdapter extends BaseAdapter {
  /**
   * @param {object} [opts]
   * @param {object} [opts.stdio] - { write(line): void } — defaults to process.stdout
   * @param {string} [opts.eventsUrl] - HTTP streaming endpoint for streamEvent
   * @param {Function} [opts.fetchFn]
   */
  constructor(opts = {}) {
    super('orchestrator', 'stdio-bridge', CONTRACT_VERSIONS.orchestrator);
    this._stdio = opts.stdio || { write: (l) => process.stdout.write(l + '\n') };
    this._eventsUrl = opts.eventsUrl || null;
    this._fetch = opts.fetchFn || ((...a) => fetch(...a));
    this._agents = new Map();
  }

  async spawnAgent(spec = {}) {
    if (!spec.command) throw new SpawnError('spec.command is required');
    const agentId = randomUUID();
    const msg = { jsonrpc: '2.0', method: 'agent.spawn', id: agentId, params: spec };
    try {
      this._stdio.write(JSON.stringify(msg));
    } catch (err) {
      throw new SpawnError(`stdio write failed: ${err.message}`);
    }
    this._agents.set(agentId, { agentId, status: 'running', spec, handlers: [] });
    return { agentId, status: 'running' };
  }

  async streamEvent(agentId, handler) {
    if (!agentId) throw new Error('agentId is required');
    if (typeof handler !== 'function') throw new Error('handler must be a function');
    const entry = this._agents.get(agentId);
    if (!entry) throw new NotFound('agent', agentId);
    entry.handlers.push(handler);
    return { agentId, subscribed: true };
  }

  async listAgents() {
    const agents = [];
    for (const { agentId, status } of this._agents.values()) {
      agents.push({ agentId, status });
    }
    return { agents };
  }

  async terminateAgent(agentId) {
    if (!agentId) throw new Error('agentId is required');
    const entry = this._agents.get(agentId);
    if (!entry) throw new NotFound('agent', agentId);
    const msg = { jsonrpc: '2.0', method: 'agent.terminate', id: randomUUID(), params: { agentId } };
    this._stdio.write(JSON.stringify(msg));
    entry.status = 'terminated';
    return { agentId, status: 'terminated' };
  }
}

module.exports = { StdioBridgeOrchestratorAdapter };
