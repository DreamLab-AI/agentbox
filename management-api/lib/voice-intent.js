'use strict';

/**
 * lib/voice-intent — WS7, voice→actor binding (PRD-014 Seam B / B3, producer side).
 *
 * Turns a plain-text voice TRANSCRIPT into a deterministic agent INTENT and the
 * corresponding agent-action descriptor that the route emits through the
 * canonical `agentEventPublisher` (utils/agent-event-publisher.js →
 * `notifications/agent_action`). The STT engine is out of scope: this module
 * accepts transcript text and produces structure. No ML, no probabilistic
 * classifier — a small, honest, deterministic grammar of imperative verbs.
 *
 * The companion `default-intent-spec.js` (WS9) handles the *signed inbound
 * Nostr* intent path; this is the *local voice* path. Both converge on the
 * same wire: a verb mapped to an `action_type` (QUERY=0 … TRANSFORM=5) and an
 * action emitted under a provable `did:nostr` source.
 *
 * Identity (B4): the acting agent's `source_urn` is its own `did:nostr` from
 * the environment (`AGENTBOX_DID` / `AGENTBOX_URN`). The transcript is the
 * stimulus, not the signer — a transcript cannot assert an identity it does not
 * hold. When no DID is configured the descriptor still validates and the
 * publisher renders `source_urn: null` (Phase-1 optional attribution).
 *
 * Pure + synchronous: returns descriptors `{ intent, action }`. The route
 * (routes/voice-intent.js) performs the adapter dispatch + publish so this
 * module is unit-testable without a live server.
 *
 * @see PRD-014 §4.1
 * @see utils/agent-event-publisher.js (createMcpNotification — the canonical wire)
 * @see mcp/nostr-bridge/default-intent-spec.js (WS9, the signed-inbound sibling)
 */

const { AgentActionType } = require('../utils/agent-event-publisher');

class IntentError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IntentError';
  }
}

/**
 * Deterministic verb grammar. Each rule maps a recognised imperative phrasing
 * to one of the six wire action_types. Order matters: the first matching rule
 * wins, so more specific multi-argument verbs (link) precede single-argument
 * verbs (create/query). Every pattern captures the operands it needs.
 *
 * The grammar is closed and honest — an utterance that matches nothing yields
 * an `unknown` intent (action_type QUERY, the read-only default) rather than a
 * guessed mutation, so a misheard transcript never deletes or rewrites a node.
 */
const RULES = Object.freeze([
  {
    name: 'link',
    action: AgentActionType.LINK,
    // "link X to Y", "connect X with Y", "relate X and Y"
    re: /\b(?:link|connect|relate|associate|join)\s+(.+?)\s+(?:to|with|and|into)\s+(.+?)\s*$/i,
    operands: (m) => ({ subject: clean(m[1]), object: clean(m[2]) }),
  },
  {
    name: 'transform',
    action: AgentActionType.TRANSFORM,
    // "transform X", "convert X", "summarise X", "rewrite X"
    re: /\b(?:transform|convert|summari[sz]e|rewrite|reformat|distil|distill)\s+(.+?)\s*$/i,
    operands: (m) => ({ subject: clean(m[1]) }),
  },
  {
    name: 'delete',
    action: AgentActionType.DELETE,
    // "delete X", "remove X", "forget X", "drop X"
    re: /\b(?:delete|remove|forget|drop|erase)\s+(?:the\s+)?(?:node|concept|note|entry)?\s*(?:about\s+|on\s+|for\s+|named\s+|called\s+)?(.+?)\s*$/i,
    operands: (m) => ({ subject: clean(m[1]) }),
  },
  {
    name: 'update',
    action: AgentActionType.UPDATE,
    // "update X", "change X", "set X to ...", "edit X", "rename X"
    re: /\b(?:update|change|edit|modify|set|rename|amend)\s+(?:the\s+)?(?:node|concept|note|entry)?\s*(?:about\s+|on\s+|for\s+|named\s+|called\s+)?(.+?)\s*$/i,
    operands: (m) => ({ subject: clean(m[1]) }),
  },
  {
    name: 'create',
    action: AgentActionType.CREATE,
    // "create a node about X", "add a concept for X", "make a note on X", "new node X"
    re: /\b(?:create|add|make|new|note|record)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:node|concept|note|entry|item)?\s*(?:about\s+|on\s+|for\s+|named\s+|called\s+|that\s+says\s+)?(.+?)\s*$/i,
    operands: (m) => ({ subject: clean(m[1]) }),
  },
  {
    name: 'query',
    action: AgentActionType.QUERY,
    // "find X", "show X", "what is X", "look up X", "search for X"
    re: /\b(?:find|show|search|look\s+up|lookup|query|get|what\s+is|who\s+is|where\s+is|tell\s+me\s+about)\s+(?:for\s+|the\s+)?(.+?)\s*$/i,
    operands: (m) => ({ subject: clean(m[1]) }),
  },
]);

function clean(s) {
  return String(s || '')
    .trim()
    .replace(/[\s.,;:!?]+$/u, '') // strip trailing punctuation a transcript tends to carry
    .replace(/\s+/gu, ' ');
}

/**
 * Parse a transcript into a structured intent. Always returns an intent object
 * (never throws on unrecognised text — that path yields the read-only `query`
 * fallback so a misheard utterance is inert, B3 fail-safe).
 *
 * @param {string} transcript
 * @returns {{ verb:string, action_type:number, subject:(string|null), object:(string|null), recognised:boolean, transcript:string }}
 */
function parseIntent(transcript) {
  if (typeof transcript !== 'string' || transcript.trim() === '') {
    throw new IntentError('transcript must be a non-empty string');
  }
  const text = transcript.trim();
  for (const rule of RULES) {
    const m = text.match(rule.re);
    if (m) {
      const ops = rule.operands(m);
      if (!ops.subject) continue; // matched the verb but captured nothing useful
      return {
        verb: rule.name,
        action_type: rule.action,
        subject: ops.subject,
        object: ops.object || null,
        recognised: true,
        transcript: text,
      };
    }
  }
  // Honest fallback: an unrecognised utterance is treated as a read-only query
  // over the whole transcript. Never a silent mutation.
  return {
    verb: 'query',
    action_type: AgentActionType.QUERY,
    subject: clean(text),
    object: null,
    recognised: false,
    transcript: text,
  };
}

/**
 * Resolve the acting agent's identity from the environment (B4). The transcript
 * is a stimulus and can never assert identity; attribution is the operator's
 * configured did:nostr or null (Phase-1 optional attribution).
 *
 * @param {object} [env]
 * @returns {{ source_urn:(string|null), pubkey:(string|null) }}
 */
function resolveActorIdentity(env = process.env) {
  const did = env.AGENTBOX_DID || env.AGENTBOX_URN || null;
  const m = typeof did === 'string' ? did.match(/^did:nostr:([0-9a-f]{64})$/) : null;
  return { source_urn: did || null, pubkey: m ? m[1] : (env.AGENTBOX_X_ONLY_PUBKEY_HEX || null) };
}

/**
 * Build the agent-action emit payload for a parsed intent. The route passes
 * this straight to `agentEventPublisher.emitAgentAction(...)`, which stamps the
 * canonical wire envelope. String IDs are left as strings on purpose — the
 * emit route hashes them to u32 (hashString) exactly as the rest of the
 * agent-events surface does, so we never duplicate that hashing here.
 *
 * @param {object} intent  - output of parseIntent
 * @param {object} [opts]
 * @param {string} [opts.actorRef]   - logical actor/agent name (becomes source_agent_id seed)
 * @param {object} [opts.env]
 * @returns {{ intent:object, emit:object }}
 */
function buildActionFromIntent(intent, opts = {}) {
  if (!intent || typeof intent.action_type !== 'number') {
    throw new IntentError('buildActionFromIntent requires a parsed intent');
  }
  const env = opts.env || process.env;
  const { source_urn, pubkey } = resolveActorIdentity(env);
  const actorRef = opts.actorRef || env.AGENTBOX_INTENT_ACTOR || 'voice-actor';

  // The target node id is seeded from the intent subject so the same concept
  // lights the same node across utterances. The emit route hashes the string.
  const targetSeed = intent.subject || intent.transcript;

  const metadata = {
    origin: 'voice-transcript',
    verb: intent.verb,
    recognised: intent.recognised,
    subject: intent.subject,
    transcript: intent.transcript,
  };
  if (intent.object) metadata.object = intent.object;

  const emit = {
    source_agent_id: actorRef,
    target_node_id: targetSeed,
    action_type: intent.action_type,
    duration_ms: opts.duration_ms || 200,
    metadata,
  };
  // B4: only stamp identity when we actually hold one; otherwise leave the
  // fields absent so the publisher renders null rather than a forged value.
  if (source_urn) emit.source_urn = source_urn;
  if (pubkey) emit.pubkey = pubkey;

  return { intent, emit };
}

/**
 * One-shot convenience: transcript → { intent, emit }. Used by the route and
 * by tests so the full producer is exercised through one entry point.
 */
function transcriptToAction(transcript, opts = {}) {
  const intent = parseIntent(transcript);
  return buildActionFromIntent(intent, opts);
}

module.exports = {
  IntentError,
  RULES,
  parseIntent,
  resolveActorIdentity,
  buildActionFromIntent,
  transcriptToAction,
};
