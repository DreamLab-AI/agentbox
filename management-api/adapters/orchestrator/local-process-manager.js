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

const fs = require('fs');
const path = require('path');
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
   * Handle an inbound governance decision (ACTION_RESPONSE, kind 31403).
   *
   * If a running agent matches the case reference, the decision is written
   * to that agent's stdin as a JSON line. Otherwise it is persisted to the
   * pod governance directory for later pickup.
   *
   * @param {object} event - Nostr event (kind 31403)
   * @returns {{ dispatched: boolean, target: string, event_id: string }}
   */
  async handleGovernanceDecision(event) {
    if (!event || !event.id) throw new Error('event with id is required');

    let parsed;
    try {
      parsed = typeof event.content === 'string' ? JSON.parse(event.content) : event.content;
    } catch (_) {
      parsed = { raw: event.content };
    }

    const caseId   = parsed.case_id || null;
    const outcome  = parsed.outcome || null;
    const reason   = parsed.reason || null;
    const decidedAt = new Date().toISOString();
    const decidingPubkey = event.pubkey
      || process.env.AGENTBOX_X_ONLY_PUBKEY_HEX
      || process.env.AGENTBOX_PUBKEY
      || '0'.repeat(64);

    // ── PROV-O provenance URN minting ────────────────────────────────
    // activity and receipt are content-addressed + owner-scoped kinds
    // (ADR-013), so we pass payload (not localId).
    let activityUrn = null;
    let receiptUrn = null;
    try {
      activityUrn = uris.mint({
        kind: 'activity',
        pubkey: decidingPubkey,
        payload: {
          type: 'governance-decision',
          case_id: caseId,
          event_id: event.id,
          outcome,
          decided_at: decidedAt,
        },
      });
      receiptUrn = uris.mint({
        kind: 'receipt',
        pubkey: decidingPubkey,
        payload: {
          type: 'governance-receipt',
          case_id: caseId,
          event_id: event.id,
          outcome,
          decided_by: decidingPubkey,
          decided_at: decidedAt,
        },
      });
    } catch (_) {
      // URN minting failure is non-fatal; provenance degrades gracefully.
    }

    // Locate the d tag or e tag reference from the original ActionRequest.
    const tags   = event.tags || [];
    const dTag   = (tags.find(t => t[0] === 'd') || [])[1] || null;
    const eTag   = (tags.find(t => t[0] === 'e') || [])[1] || null;
    const refId  = dTag || eTag;

    // Search running agents for a match on the reference id.
    let matchedEntry = null;
    if (refId) {
      for (const entry of this._agents.values()) {
        if (entry.agentId === refId || entry.status === 'running') {
          // Prefer exact agentId match; fall back to first running agent
          // whose spec contains a matching case reference.
          if (entry.agentId === refId) {
            matchedEntry = entry;
            break;
          }
        }
      }
    }

    const decision = {
      type:         'governance_decision',
      event_id:     event.id,
      case_id:      caseId,
      outcome,
      reason,
      decided_by:   event.pubkey,
      decided_at:   event.created_at,
      activity_urn: activityUrn,
      receipt_urn:  receiptUrn,
    };

    if (matchedEntry && matchedEntry.proc && matchedEntry.proc.stdin) {
      try {
        matchedEntry.proc.stdin.write(JSON.stringify(decision) + '\n');
      } catch (_) {
        // stdin may have closed; fall through to file persistence.
        matchedEntry = null;
      }
    }

    // ── Provenance record persistence ────────────────────────────────
    // Write a PROV-O-aligned provenance record to the pod's governance
    // provenance directory, separate from the raw decision event.
    const provenanceRecord = {
      activity_urn: activityUrn,
      receipt_urn:  receiptUrn,
      case_id:      caseId,
      event_id:     event.id,
      decision:     outcome,
      decided_by:   event.pubkey || 'unknown',
      decided_at:   decidedAt,
      agent_did:    `did:nostr:${decidingPubkey}`,
      source_event_ids: {
        request:  eTag || null,
        response: event.id,
      },
    };

    const npub = process.env.AGENTBOX_NPUB || '';
    const podRoot = process.env.SOLID_POD_ROOT || '/var/lib/solid';
    if (npub) {
      try {
        const provDir = path.join(podRoot, 'pods', npub, 'provenance', 'governance');
        fs.mkdirSync(provDir, { recursive: true });
        const target = path.join(provDir, `${encodeURIComponent(caseId || event.id)}.json`);
        const tmp = path.join(provDir, `.${event.id}.${process.pid}.tmp`);
        fs.writeFileSync(tmp, JSON.stringify(provenanceRecord, null, 2), 'utf8');
        fs.renameSync(tmp, target);
      } catch (_) {
        // Best-effort provenance persistence.
      }
    }

    // Emit lifecycle event if we have a matched agent with handlers.
    if (matchedEntry) {
      for (const h of matchedEntry.handlers) {
        try {
          h({
            ts:      decidedAt,
            agentId: matchedEntry.agentId,
            kind:    'governance-decision',
            payload: { event_id: event.id, case_id: caseId, outcome, activity_urn: activityUrn, receipt_urn: receiptUrn },
          });
        } catch (_) {}
      }
      return { dispatched: true, target: matchedEntry.agentId, event_id: event.id, activity_urn: activityUrn, receipt_urn: receiptUrn };
    }

    // No matching running agent — persist to the governance decisions directory.
    const pubkey = process.env.AGENTBOX_PUBKEY || null;
    let govDir;
    if (pubkey) {
      const npubFallback = `npub-${pubkey.slice(0, 16)}`;
      govDir = path.join(process.cwd(), 'pods', npubFallback, 'events', 'governance', 'decisions');
    } else {
      govDir = path.join(process.cwd(), 'governance', 'decisions');
    }

    try {
      fs.mkdirSync(govDir, { recursive: true });
      const target = path.join(govDir, `${event.id}.json`);
      const tmp = path.join(govDir, `.${event.id}.${process.pid}.tmp`);
      fs.writeFileSync(tmp, JSON.stringify(decision, null, 2));
      fs.renameSync(tmp, target);
    } catch (_) {
      // Best-effort persistence; the relay-consumer already wrote the raw event.
    }

    return { dispatched: true, target: 'file', event_id: event.id, activity_urn: activityUrn, receipt_urn: receiptUrn };
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
