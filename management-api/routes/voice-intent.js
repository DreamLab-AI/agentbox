'use strict';

/**
 * /v1/voice-intent — WS7 voice→actor binding (PRD-014 Seam B / B3, producer).
 *
 * Accepts a plain-text voice TRANSCRIPT (the STT engine is out of scope), maps
 * it to a deterministic agent intent via lib/voice-intent, and DISPATCHES a
 * signed governed intent toward a scene-selected target principal:
 *
 *   1. it publishes a signed kind-31402 ActionRequest (the ACSP producer,
 *      lib/agent-control-surface) TARGETING the `actor_did` — the scene-selected
 *      principal the command is aimed at, verified as a did:nostr and distinct
 *      from the authenticated SPEAKER (`auth.did`); and
 *   2. it emits the canonical `notifications/agent_action` beam through the
 *      shared `agentEventPublisher`, so the action also renders as a coloured
 *      beam on the host substrate (unchanged from the prior producer).
 *
 * GATE (COM-15 / ADR-037 D7). The producer is NO LONGER gated behind the blanket
 * `[sovereign_mesh].voice_intent = false` flag that returned 503. It is un-gated
 * behind a MANDATE: a request carrying a valid, active, signed mandate
 * (lib/mandate) that authorises the speaker to act is ACCEPTED and dispatches;
 * a request with no mandate — or an invalid/inactive one — is DECLINED. The
 * mandate keeps the producer real (it dispatches) while keeping it governed
 * (only a mandated speaker may drive it), matching the escalation posture REC-6
 * establishes. The ACSP 31402 signing loop is owned by nostr-rust-forum; this
 * producer only MINTS and dispatches the request, it does not sign the decision.
 *
 * Auth: the global onRequest hook protects this route. When agent-event auth is
 * on (AGENTBOX_AGENT_EVENT_AUTH=nip98) the verified did:nostr is the SPEAKER
 * principal; the mandate's grantee (`record.agent`) must match it. The speaker
 * (`auth.did`) and the target (`actor_did`) are recorded as DISTINCT principals
 * (DDD-017 invariant 6) — conflating them is a closure defect.
 *
 * @see lib/voice-intent.js          (transcript → intent)
 * @see lib/mandate.js               (the un-gating credential)
 * @see lib/agent-control-surface.js (the 31402 ActionRequest producer)
 * @see routes/agent-events.js       (the publisher subscription + hashString convention)
 */

const { agentEventPublisher, AgentActionType } = require('../utils/agent-event-publisher');
const { verifyAgentEventRequest, reconcileSourceUrn } = require('../lib/agent-event-auth');
const { transcriptToAction } = require('../lib/voice-intent');
const mandateLib = require('../lib/mandate');
const acs = require('../lib/agent-control-surface');

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

/**
 * Default mandate-event signature verifier. A mandate is signed by the ISSUING
 * user; verifying its Schnorr signature is consuming an authenticity guarantee,
 * not re-signing anything. Lazy-require nostr-tools; if it cannot be loaded the
 * verifier returns false → fail-closed (an unverifiable mandate does not un-gate).
 */
function defaultVerifyMandateEvent(event) {
  try {
    const { verifyEvent } = require('nostr-tools');
    return verifyEvent(event) === true;
  } catch {
    return false;
  }
}

module.exports = async function voiceIntentRoutes(fastify, options) {
  const { logger, manifest } = options;

  // The signed-31402 dispatcher. Injected for testability; production wires a
  // thin closure over an already-connected NostrBridge + signer (server.js). When
  // absent, an otherwise-valid request is declined 503 (fail-closed, never a
  // silent success). Mirrors lib/authority's publishActionRequest injection.
  const dispatchActionRequest = options.dispatchActionRequest || null;
  const verifyMandateEvent = options.verifyMandateEvent || defaultVerifyMandateEvent;

  fastify.post('/v1/voice-intent', {
    schema: {
      tags: ['agent-events'],
      description:
        'Bind a voice transcript to an agent intent and dispatch a signed 31402 ' +
        'toward the scene-selected actor_did (WS7). Un-gated behind a mandate. ' +
        'The STT engine is out of scope — pass transcript text.',
      body: {
        // Only `transcript` is schema-required; `actor_did` and `mandate` are
        // validated in the handler so their absence yields a GOVERNED response
        // (403 mandate-required / 400 actor_did-invalid), not a bare schema 400.
        type: 'object',
        required: ['transcript'],
        properties: {
          transcript: { type: 'string', minLength: 1, description: 'Plain-text STT output' },
          actor: { type: 'string', description: 'Logical actor/agent display label (optional, additive to actor_did)' },
          actor_did: {
            type: 'string',
            description: 'Scene-selected TARGET principal (did:nostr), distinct from the authenticated speaker',
          },
          mandate: {
            type: 'object',
            additionalProperties: true,
            description: 'Signed mandate event (kind-30078) authorising the speaker to dispatch — the un-gating credential',
          },
          duration_ms: { type: 'integer', minimum: 0, default: 200 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            dispatched: { type: 'boolean' },
            speaker_did: { type: ['string', 'null'] },
            actor_did: { type: 'string' },
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
            dispatch: {
              type: 'object',
              properties: {
                request_event_id: { type: 'string' },
                kind: { type: 'integer' },
                target_did: { type: 'string' },
                panel_id: { type: 'string' },
              },
            },
            notification: { type: 'object', additionalProperties: true },
          },
        },
        400: { type: 'object', properties: { success: { type: 'boolean' }, error: { type: 'string' }, message: { type: 'string' } } },
        403: { type: 'object', properties: { success: { type: 'boolean' }, error: { type: 'string' }, message: { type: 'string' } } },
        503: { type: 'object', properties: { success: { type: 'boolean' }, error: { type: 'string' }, message: { type: 'string' } } },
      },
    },
  }, async (request, reply) => {
    // B4: per-agent did:nostr verification of the SPEAKER (gated; off → did null).
    const auth = verifyAgentEventRequest(request);
    if (!auth.ok) {
      return reply.code(auth.status).send({ success: false, error: auth.error });
    }

    const { transcript, actor, actor_did, mandate, duration_ms } = request.body;

    // ── Un-gate behind mandate (COM-15 / ADR-037 D7) ────────────────────────────
    // No mandate → decline. This REPLACES the blanket voice_intent=false 503.
    if (!mandate || typeof mandate !== 'object') {
      return reply.code(403).send({
        success: false, error: 'mandate-required',
        message: 'A signed, active mandate is required to dispatch a voice intent.',
      });
    }
    let mandateRecord;
    try {
      mandateRecord = mandateLib.recordFromSignedMandate(mandate);
    } catch (err) {
      return reply.code(403).send({ success: false, error: 'mandate-invalid', message: err.message });
    }
    if (!verifyMandateEvent(mandate)) {
      return reply.code(403).send({
        success: false, error: 'mandate-unverified',
        message: 'The mandate event signature did not verify.',
      });
    }
    if (!mandateLib.isMandateActive(mandateRecord)) {
      return reply.code(403).send({
        success: false, error: 'mandate-inactive',
        message: 'The mandate is revoked or expired.',
      });
    }
    // When the speaker is authenticated, the mandate must grant THAT speaker
    // (the grantee `agent` is the principal authorised to act). Reconcile the
    // same way source_urn is reconciled against the verified identity.
    if (auth.did) {
      const rec = reconcileSourceUrn(mandateRecord.agent, auth.did);
      if (!rec.ok) {
        return reply.code(403).send({
          success: false, error: 'mandate-speaker-mismatch',
          message: `mandate grants '${mandateRecord.agent}', not the authenticated speaker '${auth.did}'`,
        });
      }
    }
    // The acting SPEAKER principal: the verified identity, or (auth off) the
    // mandate's grantee. Recorded distinctly from the target actor below.
    const speakerDid = auth.did || mandateRecord.agent;

    // ── Validate the TARGET principal (actor_did) — a verified did:nostr ─────────
    const actorPubkey = mandateLib.normalisePubkey(actor_did);
    if (!actorPubkey) {
      return reply.code(400).send({
        success: false, error: 'actor_did-invalid',
        message: 'actor_did must be a did:nostr:<hex> or 64-char hex pubkey.',
      });
    }
    const actorDid = `did:nostr:${actorPubkey}`;

    // ── Map the transcript to a deterministic intent ────────────────────────────
    let built;
    try {
      built = transcriptToAction(transcript, { actorRef: actor, duration_ms });
    } catch (err) {
      return reply.code(400).send({ success: false, error: 'bad-transcript', message: err.message });
    }
    const { intent, emit } = built;

    // ── Dispatch the signed 31402 toward the actor (COM-15 AC3) ──────────────────
    if (!dispatchActionRequest) {
      return reply.code(503).send({
        success: false, error: 'dispatch-unavailable',
        message: 'No signed-31402 dispatcher is wired (sovereign bridge + signer required).',
      });
    }
    const panelId = `urn:agentbox:voice-intent:${actorPubkey.slice(0, 16)}:${Date.now()}`;
    const unsigned = acs.buildActionRequest({
      panelId,
      priority: 'high',
      category: 'voice-intent',
      subjectKind: 'actor',
      subjectId: actorPubkey,
      title: `Voice intent → ${intent.verb}`,
      reasoning: `Speaker ${speakerDid} directs "${intent.verb}" at actor ${actorDid}.`,
      fields: {
        intent_verb: intent.verb,
        action_type: intent.action_type,
        subject: intent.subject || null,
        object: intent.object || null,
        recognised: intent.recognised,
        speaker_did: speakerDid,
        actor_did: actorDid,
        transcript: intent.transcript || String(transcript),
      },
      // Address the request to the target principal (NIP `p` tag) so the actor
      // and the forum can route/verify the intended recipient.
      extraTags: [['p', actorPubkey]],
    });

    let signedRequest;
    try {
      signedRequest = await dispatchActionRequest(unsigned);
    } catch (err) {
      logger.warn({ event: 'voice-intent.dispatch-failed', err: err.message },
        'signed-31402 dispatch failed — declining (fail-closed)');
      return reply.code(503).send({
        success: false, error: 'dispatch-failed', message: err.message,
      });
    }
    if (!signedRequest || typeof signedRequest.id !== 'string') {
      return reply.code(503).send({
        success: false, error: 'dispatch-unsigned',
        message: 'Dispatcher did not return a signed event with an id.',
      });
    }

    // ── Beam parity: also emit the canonical agent_action envelope ──────────────
    // (unchanged behaviour; carries the verified speaker identity as source).
    const emitPayload = {
      source_agent_id: hashString(emit.source_agent_id),
      target_node_id: hashString(actorPubkey),
      action_type: emit.action_type,
      duration_ms: emit.duration_ms,
      metadata: { ...emit.metadata, actor_did: actorDid, dispatch_request_id: signedRequest.id },
      source_urn: speakerDid,
      target_urn: actorDid,
      pubkey: auth.pubkey || (emit.pubkey || undefined),
    };
    const event = agentEventPublisher.emitAgentAction(emitPayload);
    const notification = agentEventPublisher.createMcpNotification(event);

    logger.debug(
      `voice-intent: "${intent.transcript}" → ${intent.verb} — dispatched 31402 ${signedRequest.id} ` +
      `speaker=${speakerDid} actor=${actorDid} event=${event.id}`
    );

    // ── Dispatch evidence (COM-15 AC3/AC4) ──────────────────────────────────────
    return reply.send({
      success: true,
      dispatched: true,
      speaker_did: speakerDid,
      actor_did: actorDid,
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
      dispatch: {
        request_event_id: signedRequest.id,
        kind: acs.kinds.ACTION_REQUEST,
        target_did: actorDid,
        panel_id: panelId,
      },
      notification,
    });
  });
};
