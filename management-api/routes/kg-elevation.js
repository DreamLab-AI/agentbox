'use strict';

/**
 * /v1/kg-elevation — WS6 personal-KG → proposal extractor (PRD-014 Seam D / D2).
 *
 * Reads the personal knowledge graph THROUGH THE MEMORY ADAPTER SLOT
 * (fastify.adapters.memory — never a hardcoded backend; ADR-005), scores
 * entries for elevation candidacy via lib/kg-proposal-extractor, and for each
 * high-value candidate:
 *
 *   - emits an agent_action LINK notification (the visible beam from the
 *     personal node to its shared-ontology target) through the canonical
 *     agentEventPublisher — picked up by /v1/agent-events/stream and pushed to
 *     the host substrate; and
 *   - returns the GOVERNED `/ontology-agent/propose` descriptor (Whelk →
 *     human approval → PR). This route NEVER POSTs to the ungoverned
 *     /api/ontology/load backdoor; it only surfaces the governed request the
 *     operator (or the ontology bridge) then executes.
 *
 * Gated by agentbox.toml [sovereign_mesh].kg_elevation (default off). Off → 503.
 * Adapter discipline: if the memory slot is off/placeholder the route returns
 * 503 — it does not silently fall back to a different store.
 *
 * @see lib/kg-proposal-extractor.js
 * @see mcp/servers/ontology-propose.js (the governed proposal contract)
 */

const { agentEventPublisher, AgentActionType } = require('../utils/agent-event-publisher');
const { verifyAgentEventRequest } = require('../lib/agent-event-auth');
const { extractProposals, ExtractError } = require('../lib/kg-proposal-extractor');

/** u32 string hash — identical to the agent-events surface. */
function hashString(str) {
  let hash = 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function kgElevationEnabled(manifest) {
  const sm = (manifest && manifest.sovereign_mesh) || {};
  return sm.kg_elevation === true;
}

function memoryUsable(mem) {
  return !!(mem && mem._implName !== 'off' && mem._implName !== 'placeholder');
}

module.exports = async function kgElevationRoutes(fastify, options) {
  const { logger, manifest } = options;

  fastify.post('/v1/kg-elevation/scan', {
    schema: {
      tags: ['agent-events'],
      description:
        'Scan the personal knowledge graph (via the memory adapter) for elevation ' +
        'candidates, emit an agent_action LINK per candidate, and return the ' +
        'governed ontology-propose descriptors (WS6).',
      body: {
        type: 'object',
        properties: {
          namespace: { type: 'string', default: 'personal-context' },
          query: { type: 'string', description: 'Optional text filter; omit to list the namespace' },
          min_score: { type: 'number', minimum: 0, maximum: 1, default: 0.6 },
          limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          emit: { type: 'boolean', default: true, description: 'Emit agent_action LINK beams' },
        },
      },
      response: {
        200: { type: 'object', additionalProperties: true },
        503: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    if (!kgElevationEnabled(manifest)) {
      return reply.code(503).send({
        error: 'kg-elevation-disabled',
        message: 'Personal-KG elevation is gated off. Set [sovereign_mesh].kg_elevation = true in agentbox.toml.',
      });
    }

    const auth = verifyAgentEventRequest(request);
    if (!auth.ok) {
      return reply.code(auth.status).send({ success: false, error: auth.error });
    }

    const {
      namespace = 'personal-context',
      query,
      min_score = 0.6,
      limit = 20,
      emit: doEmit = true,
    } = request.body || {};

    const mem = fastify.adapters && fastify.adapters.memory;
    if (!memoryUsable(mem)) {
      return reply.code(503).send({
        error: 'no-memory-adapter',
        message: 'The memory adapter slot is off; cannot read the personal knowledge graph.',
      });
    }

    // Read the personal KG THROUGH THE ADAPTER. search() when a filter is
    // given, list()+retrieve() otherwise — both are part of the memory
    // adapter contract, so this works for external-pg and embedded-ruvector
    // alike without knowing which backend is wired.
    let entries = [];
    try {
      if (query) {
        const res = await mem.search(query, { namespace, limit });
        entries = (res && res.results) || [];
      } else {
        const listed = await mem.list(namespace);
        const keys = (listed && (listed.keys || listed.items)) || [];
        const slice = keys.slice(0, limit);
        entries = await Promise.all(slice.map((k) => mem.retrieve(k, namespace)));
        entries = entries.filter(Boolean);
      }
    } catch (err) {
      logger.error({ err: err.message }, 'kg-elevation: adapter read failed');
      return reply.code(502).send({ error: 'adapter-read-failed', message: err.message });
    }

    let result;
    try {
      result = extractProposals(entries, {
        minScore: min_score,
        limit,
        // Identity scope: the verified pubkey when authenticated, else operator env.
        ownerPubkey: auth.pubkey || process.env.AGENTBOX_X_ONLY_PUBKEY_HEX || process.env.AGENTBOX_PUBKEY,
        env: process.env,
      });
    } catch (err) {
      if (err instanceof ExtractError) {
        return reply.code(400).send({ error: 'extract-failed', message: err.message });
      }
      throw err;
    }

    const emitted = [];
    if (doEmit) {
      for (const p of result.proposals) {
        const emitPayload = {
          source_agent_id: hashString(p.emit.source_agent_id),
          target_node_id: hashString(p.emit.target_node_id),
          action_type: p.emit.action_type, // LINK
          duration_ms: p.emit.duration_ms,
          metadata: p.emit.metadata,
        };
        if (p.emit.target_urn) emitPayload.target_urn = p.emit.target_urn;
        // Source attribution: verified DID when present, else env default.
        if (auth.did) {
          emitPayload.source_urn = auth.did;
          emitPayload.pubkey = auth.pubkey;
        }
        const event = agentEventPublisher.emitAgentAction(emitPayload);
        emitted.push({
          event_id: event.id,
          notification: agentEventPublisher.createMcpNotification(event),
        });
      }
    }

    logger.debug(
      `kg-elevation: scanned ${result.scanned}, accepted ${result.accepted}, emitted ${emitted.length} LINK beams`
    );

    return reply.send({
      success: true,
      scanned: result.scanned,
      accepted: result.accepted,
      action_type: AgentActionType.LINK,
      proposals: result.proposals.map((p, i) => ({
        proposal_urn: p.proposal_urn,
        target_urn: p.target_urn,
        term: p.candidate.term,
        domain: p.candidate.domain,
        score: p.candidate.score,
        reasons: p.candidate.reasons,
        propose_request: p.propose_request, // governed path — execute via the ontology bridge
        event_id: emitted[i] ? emitted[i].event_id : null,
      })),
      emitted_events: emitted.length,
    });
  });
};
