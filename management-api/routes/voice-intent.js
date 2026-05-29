'use strict';

/**
 * /v1/voice-intent — WS7 voice→actor binding (PRD-014 Seam B / B3, producer).
 *
 * Accepts a plain-text voice TRANSCRIPT (the STT engine is out of scope), maps
 * it to a deterministic agent intent via lib/voice-intent, and dispatches the
 * corresponding agent action by emitting the canonical
 * `notifications/agent_action` envelope through the shared
 * `agentEventPublisher`. The agent-events WS route (/v1/agent-events/stream) is
 * already subscribed to that publisher, so the action is PUSHED to the host
 * substrate as a coloured beam without this route knowing about transports.
 *
 * Gated by agentbox.toml [sovereign_mesh].voice_intent (default off). When the
 * gate is off the route returns 503 — the surface exists but emits nothing,
 * matching the manifest-gating discipline (CLAUDE.md §Important Rules).
 *
 * Auth: the global onRequest hook protects this route. When agent-event auth is
 * on (AGENTBOX_AGENT_EVENT_AUTH=nip98) the verified did:nostr overrides any
 * env-default identity, exactly as /v1/agent-events/emit does — we reuse those
 * same helpers so attribution discipline (B4) is identical across producers.
 *
 * @see lib/voice-intent.js
 * @see routes/agent-events.js (the publisher subscription + hashString convention)
 */

const { agentEventPublisher, AgentActionType } = require('../utils/agent-event-publisher');
const { verifyAgentEventRequest, reconcileSourceUrn } = require('../lib/agent-event-auth');
const { transcriptToAction } = require('../lib/voice-intent');

/** Same u32 string hash the agent-events surface uses, kept consistent here. */
function hashString(str) {
  let hash = 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function voiceIntentEnabled(manifest) {
  const sm = (manifest && manifest.sovereign_mesh) || {};
  return sm.voice_intent === true;
}

module.exports = async function voiceIntentRoutes(fastify, options) {
  const { logger, manifest } = options;

  fastify.post('/v1/voice-intent', {
    schema: {
      tags: ['agent-events'],
      description:
        'Bind a voice transcript to an agent intent and emit the corresponding ' +
        'agent_action notification (WS7). The STT engine is out of scope — pass ' +
        'transcript text.',
      body: {
        type: 'object',
        required: ['transcript'],
        properties: {
          transcript: { type: 'string', minLength: 1, description: 'Plain-text STT output' },
          actor: { type: 'string', description: 'Logical actor/agent name (optional)' },
          duration_ms: { type: 'integer', minimum: 0, default: 200 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            event_id: { type: 'integer' },
            intent: {
              type: 'object',
              properties: {
                verb: { type: 'string' },
                action_type: { type: 'integer' },
                action_type_name: { type: 'string' },
                subject: { type: ['string', 'null'] },
                object: { type: ['string', 'null'] },
                recognised: { type: 'boolean' },
              },
            },
            notification: { type: 'object', additionalProperties: true },
          },
        },
        503: { type: 'object', properties: { error: { type: 'string' }, message: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    if (!voiceIntentEnabled(manifest)) {
      return reply.code(503).send({
        error: 'voice-intent-disabled',
        message: 'Voice→actor binding is gated off. Set [sovereign_mesh].voice_intent = true in agentbox.toml.',
      });
    }

    // B4: per-agent did:nostr verification (gated; off → no-op, identity null).
    const auth = verifyAgentEventRequest(request);
    if (!auth.ok) {
      return reply.code(auth.status).send({ success: false, error: auth.error });
    }

    const { transcript, actor, duration_ms } = request.body;

    let built;
    try {
      built = transcriptToAction(transcript, { actorRef: actor, duration_ms });
    } catch (err) {
      return reply.code(400).send({ error: 'bad-transcript', message: err.message });
    }
    const { intent, emit } = built;

    // When authenticated, the verified identity must own the action; reconcile
    // it against whatever the producer derived from the environment.
    const rec = reconcileSourceUrn(emit.source_urn || null, auth.did);
    if (!rec.ok) {
      return reply.code(rec.status).send({ success: false, error: rec.error });
    }

    const emitPayload = {
      source_agent_id: hashString(emit.source_agent_id),
      target_node_id: hashString(emit.target_node_id),
      action_type: emit.action_type,
      duration_ms: emit.duration_ms,
      metadata: emit.metadata,
    };
    if (auth.did) {
      emitPayload.source_urn = auth.did;
      emitPayload.pubkey = auth.pubkey;
    } else {
      if (emit.source_urn) emitPayload.source_urn = emit.source_urn;
      if (emit.pubkey) emitPayload.pubkey = emit.pubkey;
    }

    const event = agentEventPublisher.emitAgentAction(emitPayload);
    const notification = agentEventPublisher.createMcpNotification(event);

    logger.debug(
      `voice-intent: "${intent.transcript}" → ${intent.verb} (action_type ${intent.action_type}) → event ${event.id}`
    );

    return reply.send({
      success: true,
      event_id: event.id,
      intent: {
        verb: intent.verb,
        action_type: intent.action_type,
        action_type_name: Object.keys(AgentActionType).find(
          (k) => AgentActionType[k] === intent.action_type
        )?.toLowerCase() || 'query',
        subject: intent.subject,
        object: intent.object,
        recognised: intent.recognised,
      },
      notification,
    });
  });
};
