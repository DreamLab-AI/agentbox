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

const { BaseAdapter } = require('../base');
const { NotFound, SpawnError } = require('../errors');
const CONTRACT_VERSIONS = require('../contract-versions');
const uris = require('../../lib/uris');

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
    const agentId = uris.mint({ kind: 'agent', localId: `stdio-${Date.now().toString(36)}` });
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

  /**
   * Handle an inbound governance decision (ACTION_RESPONSE, kind 31403).
   *
   * Forwards the decision as a JSON-RPC notification over stdio so the
   * external orchestrator (e.g. VisionClaw BrokerActor) can act on it.
   *
   * @param {object} event - Nostr event (kind 31403)
   * @returns {{ dispatched: boolean, target: string, event_id: string }}
   */
  async handleGovernanceDecision(event) {
    if (!event || !event.id) throw new Error('event with id is required');

    const activityUrn = uris.mint({ kind: 'activity', localId: 'decision-' + event.id.slice(0, 12) });

    let parsed;
    try {
      parsed = typeof event.content === 'string' ? JSON.parse(event.content) : event.content;
    } catch (_) {
      parsed = { raw: event.content };
    }

    const caseId   = parsed.case_id || null;
    const outcome  = parsed.outcome || null;
    const reason   = parsed.reason || null;

    const notification = {
      jsonrpc: '2.0',
      method:  'governance.decision',
      params: {
        event_id:   event.id,
        case_id:    caseId,
        outcome,
        reason,
        decided_by: event.pubkey,
        decided_at: event.created_at,
        activity_urn: activityUrn,
      },
    };

    try {
      this._stdio.write(JSON.stringify(notification));
    } catch (err) {
      throw new Error(`stdio write failed for governance decision: ${err.message}`);
    }

    return { dispatched: true, target: 'stdio', event_id: event.id };
  }

  async terminateAgent(agentId) {
    if (!agentId) throw new Error('agentId is required');
    const entry = this._agents.get(agentId);
    if (!entry) throw new NotFound('agent', agentId);
    const msg = { jsonrpc: '2.0', method: 'agent.terminate', id: uris.mint({ kind: 'event', pubkey: process.env.AGENTBOX_PUBKEY || '0'.repeat(64), payload: { method: 'agent.terminate', agentId } }), params: { agentId } };
    this._stdio.write(JSON.stringify(msg));
    entry.status = 'terminated';
    return { agentId, status: 'terminated' };
  }
}

module.exports = { StdioBridgeOrchestratorAdapter };
