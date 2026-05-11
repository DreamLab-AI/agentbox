'use strict';

/**
 * orchestrator/local-process-manager — in-container process spawn + monitor.
 *
 * Uses Node child_process.spawn. Tracks running agents in memory.
 * Suitable for standalone mode.
 *
 * @see ADR-005 §orchestrator slot
 * @see PRD-001 §Capabilities and adapters
 */

const { spawn } = require('child_process');
const { BaseAdapter } = require('../base');
const { NotFound, SpawnError } = require('../errors');
const CONTRACT_VERSIONS = require('../contract-versions');
const uris = require('../../lib/uris');

class LocalProcessManagerOrchestratorAdapter extends BaseAdapter {
  /**
   * @param {object} [opts]
   * @param {Function} [opts.spawnFn] - Override child_process.spawn for tests
   */
  constructor(opts = {}) {
    super('orchestrator', 'local-process-manager', CONTRACT_VERSIONS.orchestrator);
    this._spawnFn = opts.spawnFn || spawn;
    this._agents = new Map(); // agentId -> { agentId, spec, status, proc, handlers[] }
  }

  /**
   * Spawn an agent process.
   * @param {object} spec
   * @param {string} spec.command      - Executable
   * @param {string[]} [spec.args=[]]
   * @param {object} [spec.env]        - Additional env vars
   * @param {string} [spec.cwd]
   * @returns {{ agentId, status, pid }}
   */
  async spawnAgent(spec = {}) {
    if (!spec.command) throw new SpawnError('spec.command is required');
    const agentId = uris.mint({ kind: 'agent', localId: `proc-${Date.now().toString(36)}` });
    let proc;
    try {
      proc = this._spawnFn(spec.command, spec.args || [], {
        env: { ...process.env, ...(spec.env || {}) },
        cwd: spec.cwd || process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      throw new SpawnError(`Failed to spawn '${spec.command}': ${err.message}`);
    }

    const entry = {
      agentId,
      spec,
      status: 'running',
      pid: proc.pid,
      proc,
      handlers: [],
    };
    this._agents.set(agentId, entry);

    const emit = (kind, payload) => {
      for (const h of entry.handlers) {
        try { h({ ts: new Date().toISOString(), agentId, kind, payload }); } catch (_) {}
      }
    };

    proc.stdout && proc.stdout.on('data', d => emit('stdout', { data: d.toString() }));
    proc.stderr && proc.stderr.on('data', d => emit('stderr', { data: d.toString() }));
    proc.on('exit', (code, signal) => {
      entry.status = 'terminated';
      emit('exit', { code, signal });
    });
    proc.on('error', err => {
      entry.status = 'error';
      emit('error', { message: err.message });
    });

    return { agentId, status: 'running', pid: proc.pid };
  }

  /**
   * Register a handler for lifecycle events from an agent.
   * @param {string} agentId
   * @param {Function} handler - Called with { ts, agentId, kind, payload }
   * @returns {{ agentId, subscribed: true }}
   */
  async streamEvent(agentId, handler) {
    if (!agentId) throw new Error('agentId is required');
    if (typeof handler !== 'function') throw new Error('handler must be a function');
    const entry = this._agents.get(agentId);
    if (!entry) throw new NotFound('agent', agentId);
    entry.handlers.push(handler);
    return { agentId, subscribed: true };
  }

  /**
   * List all known agents.
   * @returns {{ agents: Array<{agentId, status, pid}> }}
   */
  async listAgents() {
    const agents = [];
    for (const { agentId, status, pid } of this._agents.values()) {
      agents.push({ agentId, status, pid });
    }
    return { agents };
  }

  /**
   * Terminate an agent.
   * @param {string} agentId
   * @returns {{ agentId, status: 'terminated' }}
   */
  async terminateAgent(agentId) {
    if (!agentId) throw new Error('agentId is required');
    const entry = this._agents.get(agentId);
    if (!entry) throw new NotFound('agent', agentId);
    try { entry.proc.kill('SIGTERM'); } catch (_) {}
    entry.status = 'terminated';
    return { agentId, status: 'terminated' };
  }
}

module.exports = { LocalProcessManagerOrchestratorAdapter };
