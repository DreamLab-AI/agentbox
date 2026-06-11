'use strict';

/**
 * Broker Bridge — G6, PRD-013 §Broker Review Surface.
 *
 * Bridges the VisionClaw BrokerActor REST API into the agentbox
 * management API so the enrichment-review-pane (S12) can operate
 * without cross-origin calls to the host substrate. The bridge adds
 * three capabilities the raw broker REST does not provide:
 *
 *   1. Content enrichment — each case is enriched with source_content,
 *      proposed_enrichment, and provenance fields read from the local
 *      git clone or the pod.
 *
 *   2. Write-back orchestration — on approve/promote decisions the
 *      bridge triggers the Write-Back Saga (G4) via POST /api/ingest/writeback
 *      so the reviewer does not need a separate step.
 *
 *   3. SSE relay — VisionClaw emits broker events over WebSocket;
 *      the bridge re-emits them as Server-Sent Events for the browser
 *      pane (avoids requiring the pane to manage a WS connection).
 *
 * Routes:
 *
 *   GET  /api/broker/bridge/inbox           — filtered + enriched inbox
 *   GET  /api/broker/bridge/cases/:id       — enriched single case
 *   POST /api/broker/bridge/cases/:id/decide — decision + write-back
 *   GET  /api/broker/bridge/events          — SSE relay of broker WS
 *
 * Configuration:
 *
 *   VISIONCLAW_API_URL   — base URL of VisionClaw REST (default: http://visionclaw_container:4000)
 *   VISIONCLAW_WS_URL    — WS URL for broker events (default: ws://visionclaw_container:4000)
 *   KNOWLEDGE_GIT_CLONE  — path to the git clone of the knowledge repo (default: /home/devuser/workspace/knowledge)
 *
 * Attribution
 * -----------
 * Judgment Broker: ADR-041. Enrichment pipeline: PRD-013 §G4/G6.
 * Write-Back Saga: PRD-013 §G4.
 */

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const uris = require('../lib/uris');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const VISIONCLAW_API = (process.env.VISIONCLAW_API_URL || 'http://visionclaw_container:4000').replace(/\/$/, '');
const VISIONCLAW_WS = (process.env.VISIONCLAW_WS_URL || 'ws://visionclaw_container:4000').replace(/\/$/, '');
const GIT_CLONE_ROOT = process.env.KNOWLEDGE_GIT_CLONE || '/home/devuser/workspace/knowledge';
const AGENTBOX_PUBKEY = process.env.AGENTBOX_X_ONLY_PUBKEY_HEX || process.env.AGENTBOX_PUBKEY || '0'.repeat(64);
const AGENTBOX_NPUB = process.env.AGENTBOX_NPUB || '';
const SOLID_POD_ROOT = process.env.SOLID_POD_ROOT || '/var/lib/solid';

// Categories that this bridge handles — the enrichment-review-pane only
// renders KnowledgeEnrichment cases.
const ENRICHMENT_CATEGORIES = new Set([
  'knowledge_enrichment',
  'KnowledgeEnrichment',
  'enrichment',
]);

// Decisions that trigger the write-back saga.
const WRITEBACK_DECISIONS = new Set(['approve', 'promote']);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Proxy-fetch a VisionClaw REST endpoint. Returns the parsed JSON body
 * or throws with a descriptive message on failure.
 */
async function _vcFetch(urlPath, options = {}) {
  const url = `${VISIONCLAW_API}${urlPath}`;
  const headers = {
    Accept: 'application/json',
    ...options.headers,
  };
  // VisionClaw gates service-to-service mutations (e.g. enrichment-proposal
  // decisions) on this shared key; without it those POSTs return 401.
  if (process.env.VISIONCLAW_AGENT_KEY) {
    headers['X-Agent-Key'] = process.env.VISIONCLAW_AGENT_KEY;
  }
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  let resp;
  try {
    resp = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    });
  } catch (fetchErr) {
    // FIX 9: Suppress internal URL from error messages exposed to callers.
    const err = new Error(`VisionClaw unreachable: ${fetchErr.message}`);
    err.statusCode = 502;
    throw err;
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    const err = new Error(`VisionClaw returned ${resp.status}`);
    err.statusCode = resp.status;
    throw err;
  }

  return resp.json();
}

/**
 * Try to read a file from the git clone. Returns the content as a string
 * or null if the file does not exist or is not readable.
 */
async function _readSourceFile(filePath) {
  if (!filePath) return null;
  // Normalise: strip leading slashes; prevent traversal.
  const safe = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
  const full = path.join(GIT_CLONE_ROOT, safe);
  if (!full.startsWith(path.resolve(GIT_CLONE_ROOT))) return null;
  // FIX 7: Block access to .git/ internal directories.
  if (full.includes(`${path.sep}.git${path.sep}`) || full.endsWith(`${path.sep}.git`)) {
    return null;
  }
  try {
    return await fs.promises.readFile(full, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Enrich a single broker case with source content and provenance.
 * Mutates the case object in place and returns it.
 */
async function _enrichCase(brokerCase) {
  const meta = brokerCase.metadata || brokerCase.case_metadata || {};

  // Source file path — PRD-013 enrichment_proposal_handler stores as target_path.
  const sourceRef = meta.target_path || meta.source_file || meta.source_path || meta.file_path || '';
  const sourceContent = await _readSourceFile(sourceRef);
  if (sourceContent !== null) {
    brokerCase.source_content = sourceContent;
  }

  // Proposed enrichment content — PRD-013 stores under `content` key.
  if (!brokerCase.proposed_enrichment && meta.content) {
    brokerCase.proposed_enrichment = meta.content;
  }
  if (!brokerCase.proposed_enrichment && meta.proposed_enrichment) {
    brokerCase.proposed_enrichment = meta.proposed_enrichment;
  }
  if (!brokerCase.proposed_enrichment && meta.enrichment_payload) {
    brokerCase.proposed_enrichment = meta.enrichment_payload;
  }

  // Provenance trailer
  if (!brokerCase.provenance && meta.provenance) {
    brokerCase.provenance = meta.provenance;
  }
  if (!brokerCase.provenance) {
    brokerCase.provenance = {
      proposed_by: meta.proposed_by || meta.agent_did || null,
      reasoning_summary: meta.reasoning_summary || null,
      reasoning_hash: meta.reasoning_hash || null,
      agent_identity: meta.agent_identity || meta.agent_did || null,
      broker_did: meta.broker_did || null,
    };
  }

  // Enrichment type classification
  if (!brokerCase.enrichment_type && meta.enrichment_type) {
    brokerCase.enrichment_type = meta.enrichment_type;
  }

  return brokerCase;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

async function brokerBridgeRoutes(fastify, options) {
  const { logger } = options;

  // ------------------------------------------------------------------
  // GET /api/broker/bridge/inbox
  // ------------------------------------------------------------------
  fastify.get('/api/broker/bridge/inbox', {
    schema: {
      description: 'List knowledge-enrichment broker cases (filtered + enriched)',
      tags: ['broker-bridge'],
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 50, minimum: 1, maximum: 200 },
          offset: { type: 'integer', default: 0, minimum: 0 },
          status: { type: 'string', enum: ['pending', 'claimed', 'decided', 'all'], default: 'pending' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            cases: { type: 'array' },
            total: { type: 'integer' },
            filtered_total: { type: 'integer' },
            timestamp: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { limit, offset, status } = request.query;

    let inbox;
    try {
      inbox = await _vcFetch('/api/broker/inbox');
    } catch (err) {
      logger.error({ err: err.message }, 'broker-bridge: inbox fetch failed');
      return reply.code(err.statusCode || 502).send({
        error: 'upstream-error',
        message: `Failed to fetch broker inbox: ${err.message}`,
      });
    }

    // The VisionClaw inbox returns { cases: [...], total: N }
    let cases = inbox.cases || inbox.items || [];
    if (!Array.isArray(cases)) cases = [];
    const totalUpstream = cases.length;

    // Filter to enrichment categories only
    cases = cases.filter((c) => {
      const cat = c.category || c.case_category || '';
      return ENRICHMENT_CATEGORIES.has(cat);
    });

    // Filter by status
    if (status && status !== 'all') {
      cases = cases.filter((c) => (c.status || 'pending') === status);
    }

    const filteredTotal = cases.length;

    // Paginate
    cases = cases.slice(offset, offset + limit);

    // Enrich each case with source content (best-effort, non-blocking)
    const enriched = await Promise.all(
      cases.map((c) => _enrichCase(c).catch((err) => {
        logger.warn({ err: err.message, caseId: c.id }, 'broker-bridge: case enrichment failed');
        return c;
      })),
    );

    return {
      cases: enriched,
      total: totalUpstream,
      filtered_total: filteredTotal,
      timestamp: new Date().toISOString(),
    };
  });

  // ------------------------------------------------------------------
  // GET /api/broker/bridge/cases/:id
  // ------------------------------------------------------------------
  fastify.get('/api/broker/bridge/cases/:id', {
    schema: {
      description: 'Get a single broker case with enriched content and provenance',
      tags: ['broker-bridge'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
      response: {
        200: { type: 'object' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;

    let brokerCase;
    try {
      brokerCase = await _vcFetch(`/api/broker/cases/${encodeURIComponent(id)}`);
    } catch (err) {
      logger.error({ err: err.message, caseId: id }, 'broker-bridge: case fetch failed');
      return reply.code(err.statusCode || 502).send({
        error: 'upstream-error',
        message: `Failed to fetch case ${id}: ${err.message}`,
      });
    }

    try {
      await _enrichCase(brokerCase);
    } catch (err) {
      logger.warn({ err: err.message, caseId: id }, 'broker-bridge: case enrichment failed (returning raw)');
    }

    return brokerCase;
  });

  // ------------------------------------------------------------------
  // POST /api/broker/bridge/cases/:id/decide
  // ------------------------------------------------------------------
  fastify.post('/api/broker/bridge/cases/:id/decide', {
    schema: {
      description: 'Submit a decision and optionally trigger write-back',
      tags: ['broker-bridge'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
      body: {
        type: 'object',
        required: ['decision'],
        properties: {
          decision: {
            type: 'string',
            enum: ['approve', 'reject', 'amend', 'delegate', 'promote', 'precedent'],
          },
          note: { type: 'string' },
          case_id: { type: 'string' },
          timestamp: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            decision: { type: 'string' },
            writeback_triggered: { type: 'boolean' },
            writeback_result: { type: 'object' },
            activity_urn: { type: 'string' },
            receipt_urn: { type: 'string' },
          },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    const { decision, note, timestamp } = request.body;

    // 1. Proxy the decision to VisionClaw's enrichment-proposals decide endpoint.
    // The BrokerActor triggers the WriteBackSaga internally for approved
    // KnowledgeEnrichment cases, so no separate writeback call is needed.
    let decisionResult;
    try {
      decisionResult = await _vcFetch(`/api/enrichment-proposals/${encodeURIComponent(id)}/decide`, {
        method: 'POST',
        body: {
          outcome: decision,
          broker_pubkey: request.auth?.pubkey || 'unknown',
          reasoning: note || '',
        },
      });
    } catch (err) {
      logger.error({ err: err.message, caseId: id, decision }, 'broker-bridge: decision proxy failed');
      return reply.code(err.statusCode || 502).send({
        error: 'upstream-error',
        message: `Failed to submit decision: ${err.message}`,
      });
    }

    // Write-back is triggered internally by the BrokerActor for approved
    // KnowledgeEnrichment cases. We report whether the decision was accepted.
    const writebackTriggered = WRITEBACK_DECISIONS.has(decision);
    let writebackResult = writebackTriggered ? { status: 'triggered-internally' } : null;

    // ── PROV-O provenance recording ──────────────────────────────────
    // Mint activity + receipt URNs linking the governance decision to the
    // agent action.  Both kinds are content-addressed and owner-scoped in
    // the canonical URI grammar (ADR-013).
    const decidingPubkey = request.headers['x-agent-pubkey'] || AGENTBOX_PUBKEY;
    const decidedAt = new Date().toISOString();

    const activityPayload = {
      type: 'governance-decision',
      case_id: id,
      decision,
      decided_at: decidedAt,
    };
    const receiptPayload = {
      type: 'governance-receipt',
      case_id: id,
      decision,
      decided_by: request.body.decided_by || 'unknown',
      decided_at: decidedAt,
    };

    let activity_urn, receipt_urn;
    try {
      activity_urn = uris.mint({ kind: 'activity', pubkey: decidingPubkey, payload: activityPayload });
      receipt_urn = uris.mint({ kind: 'receipt', pubkey: decidingPubkey, payload: receiptPayload });
    } catch (mintErr) {
      logger.warn({ err: mintErr.message, caseId: id }, 'broker-bridge: provenance URN minting failed (non-fatal)');
      activity_urn = null;
      receipt_urn = null;
    }

    // Persist provenance record to the pod filesystem.
    if (activity_urn && AGENTBOX_NPUB) {
      const provenanceRecord = {
        activity_urn,
        receipt_urn,
        case_id: id,
        decision,
        decided_by: request.body.decided_by || 'unknown',
        decided_at: decidedAt,
        agent_did: `did:nostr:${decidingPubkey}`,
        source_event_ids: {
          request: request.body.request_event_id || null,
          response: request.body.response_event_id || null,
        },
      };

      try {
        const provDir = path.join(SOLID_POD_ROOT, 'pods', AGENTBOX_NPUB, 'provenance', 'governance');
        fs.mkdirSync(provDir, { recursive: true });
        fs.writeFileSync(
          path.join(provDir, `${encodeURIComponent(id)}.json`),
          JSON.stringify(provenanceRecord, null, 2),
          'utf8',
        );
        logger.info({ caseId: id, activity_urn, receipt_urn }, 'broker-bridge: governance provenance recorded');
      } catch (writeErr) {
        logger.warn({ err: writeErr.message, caseId: id }, 'broker-bridge: provenance write failed (non-fatal)');
      }
    }

    return {
      success: true,
      decision,
      case_id: id,
      upstream_result: decisionResult,
      writeback_triggered: writebackTriggered,
      writeback_result: writebackResult,
      activity_urn: activity_urn || undefined,
      receipt_urn: receipt_urn || undefined,
    };
  });

  // ------------------------------------------------------------------
  // GET /api/broker/bridge/events — SSE relay
  // ------------------------------------------------------------------

  // Track active SSE connections for graceful shutdown
  const sseConnections = new Set();
  const MAX_SSE_CONNECTIONS = parseInt(process.env.MAX_SSE_CONNECTIONS, 10) || 100;
  let brokerWs = null;
  let wsReconnectTimer = null;
  let wsReconnectAttempt = 0;
  const WS_RECONNECT_INITIAL_MS = 1000;
  const WS_RECONNECT_MAX_MS = 30000;

  /**
   * Broadcast an SSE event to all connected pane clients.
   */
  function _broadcastSSE(eventType, data) {
    const safeEventType = String(eventType).replace(/[^a-zA-Z0-9:_-]/g, '');
    const payload = `event: ${safeEventType}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of sseConnections) {
      try {
        res.raw.write(payload);
      } catch {
        sseConnections.delete(res);
      }
    }
  }

  /**
   * Connect (or reconnect) to VisionClaw's broker WebSocket. Events
   * received are re-broadcast as SSE to all connected pane clients.
   */
  function _connectBrokerWs() {
    if (brokerWs) {
      try { brokerWs.close(); } catch { /* ignore */ }
    }

    const wsUrl = `${VISIONCLAW_WS}/wss/broker-events`;

    try {
      brokerWs = new WebSocket(wsUrl, {
        headers: { Accept: 'application/json' },
        handshakeTimeout: 5000,
      });
    } catch (err) {
      logger.warn({ err: err.message }, 'broker-bridge: WS connect failed (will retry)');
      _scheduleReconnect();
      return;
    }

    brokerWs.on('open', () => {
      logger.info({ url: wsUrl }, 'broker-bridge: broker WS connected');
      wsReconnectAttempt = 0;
    });

    brokerWs.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        const eventType = msg.type || msg.event || 'broker:update';
        _broadcastSSE(eventType, msg);
      } catch (err) {
        logger.debug({ err: err.message }, 'broker-bridge: WS message parse failed');
      }
    });

    brokerWs.on('close', (code, reason) => {
      logger.info({ code, reason: reason?.toString() }, 'broker-bridge: broker WS closed');
      brokerWs = null;
      if (sseConnections.size > 0) {
        _scheduleReconnect();
      }
    });

    brokerWs.on('error', (err) => {
      logger.warn({ err: err.message }, 'broker-bridge: broker WS error');
      // 'close' event fires after 'error', reconnect handled there
    });
  }

  function _scheduleReconnect() {
    if (wsReconnectTimer) return;
    wsReconnectAttempt += 1;
    const delay = Math.min(
      WS_RECONNECT_INITIAL_MS * Math.pow(2, wsReconnectAttempt - 1),
      WS_RECONNECT_MAX_MS,
    );
    logger.debug({ attempt: wsReconnectAttempt, delayMs: delay }, 'broker-bridge: scheduling WS reconnect');
    wsReconnectTimer = setTimeout(() => {
      wsReconnectTimer = null;
      if (sseConnections.size > 0) {
        _connectBrokerWs();
      }
    }, delay);
  }

  fastify.get('/api/broker/bridge/events', {
    schema: {
      description: 'SSE stream of broker events (bridges VisionClaw WS → SSE)',
      tags: ['broker-bridge'],
      response: {
        200: {
          type: 'string',
          description: 'text/event-stream',
        },
      },
    },
  }, async (request, reply) => {
    // FIX 4: Enforce SSE connection cap to prevent resource exhaustion.
    if (sseConnections.size >= MAX_SSE_CONNECTIONS) {
      return reply.code(503).send({ error: 'too-many-connections', message: 'SSE connection limit reached' });
    }

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send an initial heartbeat so the client knows the connection is live
    reply.raw.write(`event: connected\ndata: ${JSON.stringify({
      type: 'connected',
      source: 'broker-bridge',
      timestamp: new Date().toISOString(),
    })}\n\n`);

    sseConnections.add(reply);

    // Start the WS connection to VisionClaw if not already connected
    if (!brokerWs || brokerWs.readyState !== WebSocket.OPEN) {
      _connectBrokerWs();
    }

    // Keep-alive: send a comment line every 30s to prevent proxy timeouts
    const keepAlive = setInterval(() => {
      try {
        reply.raw.write(': keepalive\n\n');
      } catch {
        clearInterval(keepAlive);
        sseConnections.delete(reply);
      }
    }, 30000);

    // Clean up on client disconnect
    request.raw.on('close', () => {
      clearInterval(keepAlive);
      sseConnections.delete(reply);
      logger.debug('broker-bridge: SSE client disconnected');

      // If no SSE clients remain, close the WS to save resources
      if (sseConnections.size === 0 && brokerWs) {
        try { brokerWs.close(); } catch { /* ignore */ }
        brokerWs = null;
        if (wsReconnectTimer) {
          clearTimeout(wsReconnectTimer);
          wsReconnectTimer = null;
        }
      }
    });

    // Do not call reply.send() — the SSE stream stays open
    return reply;
  });

  // ------------------------------------------------------------------
  // GET /api/broker/bridge/cases/:id/history
  // ------------------------------------------------------------------
  fastify.get('/api/broker/bridge/cases/:id/history', {
    schema: {
      description: 'Get decision history for a broker case',
      tags: ['broker-bridge'],
      params: {
        type: 'object',
        required: ['id'],
        properties: {
          id: { type: 'string' },
        },
      },
      response: {
        200: { type: 'object' },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params;
    try {
      const history = await _vcFetch(`/api/broker/cases/${encodeURIComponent(id)}/history`);
      return history;
    } catch (err) {
      logger.error({ err: err.message, caseId: id }, 'broker-bridge: history fetch failed');
      return reply.code(err.statusCode || 502).send({
        error: 'upstream-error',
        message: `Failed to fetch history for case ${id}: ${err.message}`,
      });
    }
  });

  // ------------------------------------------------------------------
  // Cleanup on server close
  // ------------------------------------------------------------------
  fastify.addHook('onClose', async () => {
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
    if (brokerWs) {
      try { brokerWs.close(); } catch { /* ignore */ }
      brokerWs = null;
    }
    for (const res of sseConnections) {
      try { res.raw.end(); } catch { /* ignore */ }
    }
    sseConnections.clear();
  });
}

module.exports = brokerBridgeRoutes;
