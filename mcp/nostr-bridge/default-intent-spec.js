'use strict';

/**
 * Default intentSpec for the relay consumer (PRD-014 Seam B / B3).
 *
 * When the operator gates intent dispatch on, an inbound *agent-intent* event
 * (kinds 38000-38099 — e.g. a voice-origin ActionRequest minted in VisionClaw)
 * must deterministically spawn/dispatch to the **addressed actor** instead of
 * only leaving a marker file for a poller. This module builds the
 * `(event, context) => spawnSpec` function the consumer calls.
 *
 * Provability (B4 on the intent path): the relay consumer has already
 * Schnorr-verified the event signature (DDD-003 I01) before this runs, so the
 * acting agent's identity is `did:nostr:<event.pubkey>` — provable, not
 * caller-asserted. The spec stamps that DID into the spawn env so the
 * responder inherits a verified `source_urn` it cannot forge.
 *
 * Addressing convention (no new Nostr primitives):
 *   - `['actor', <ref>]`  — explicit agent template/role name (preferred)
 *   - `['a', <k:pubkey:dtag>]` — NIP-33 addressable coordinate; the `dtag`
 *     component names the target panel/actor
 *   - else the recipient npub (the pod owner) is the actor
 *
 * Fail-safe: when no command is resolvable (`AGENTBOX_INTENT_COMMAND` unset
 * and none injected), `buildDefaultIntentSpec` returns `null`. The consumer
 * then runs its marker-only path exactly as before — zero behavioural change
 * until the operator opts in.
 *
 * @see PRD-014 §4.1  @see relay-consumer.js _isAgentIntent
 */

function tagValue(event, key) {
  const tags = Array.isArray(event && event.tags) ? event.tags : [];
  const tag = tags.find((t) => Array.isArray(t) && t[0] === key);
  return tag ? tag[1] : null;
}

/**
 * Resolve the addressed actor reference from the event, in precedence order.
 * @returns {string} actor ref (never empty — falls back to recipient npub)
 */
function resolveActorRef(event, context) {
  const explicit = tagValue(event, 'actor');
  if (explicit) return explicit;
  const coord = tagValue(event, 'a');
  if (coord) {
    const parts = String(coord).split(':');
    // NIP-33 coordinate is <kind>:<pubkey>:<dtag>; the dtag names the actor.
    if (parts.length >= 3 && parts[2]) return parts[2];
    return coord;
  }
  return (context && context.recipient_npub) || '';
}

/**
 * @param {object} [deps]
 * @param {object} [deps.env]   - Environment override (defaults to process.env).
 * @returns {(null|function(object, object): object)} intentSpec or null when off.
 */
function buildDefaultIntentSpec(deps = {}) {
  const env = deps.env || process.env;
  const command = env.AGENTBOX_INTENT_COMMAND;
  if (!command) return null;

  const extraArgs = (env.AGENTBOX_INTENT_ARGS || '')
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const cwd = env.AGENTBOX_INTENT_CWD || undefined;

  return function defaultIntentSpec(event, context) {
    const actorRef = resolveActorRef(event, context);
    const sourceDid = event && event.pubkey ? `did:nostr:${event.pubkey}` : null;
    const spec = {
      command,
      args: [...extraArgs, actorRef].filter(Boolean),
      env: {
        AGENTBOX_INTENT_ACTOR: actorRef,
        AGENTBOX_INTENT_KIND: String((context && context.intent_kind) || (event && event.kind) || ''),
        AGENTBOX_INTENT_CONTENT: (event && event.content) || '',
        // Verified, unforgeable attribution — the responder must emit actions
        // under this DID, never one it asserts itself (B4).
        AGENTBOX_INTENT_SOURCE_URN: sourceDid || '',
      },
    };
    if (cwd) spec.cwd = cwd;
    return spec;
  };
}

module.exports = { buildDefaultIntentSpec, resolveActorRef };
