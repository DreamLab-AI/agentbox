'use strict';

/**
 * execution-journal — ADR-057, the one canonical append-only agent execution
 * journal, plus the "model-visible means journalled" provenance invariant and
 * the projection base that every derived view (transcript, cost, mirror,
 * digest, spans, search) is rebuilt from.
 *
 * The journal is NOT a sixth adapter slot and NOT a new database (ADR-057 D1).
 * It rides the ADR-005 `events` adapter: every AgentExecutionEvent is dispatched
 * through the injected events adapter, so it inherits that slot's ADR-039 hash
 * chain, ADR-008 privacy filter, ADR-012 JSON-LD encoding and observability.
 *
 * Two sequence spaces coexist and must not be conflated:
 *   - the events adapter's own global chain `seq` (tamper evidence), and
 *   - this journal's per-session `seq` (execution ordering / the D1 unique key).
 * `session_urn + seq` is the journal key; it is contiguous from 0 and assigned
 * here, never by the caller.
 *
 *   D1  append-only envelope, canonical vocabulary, compensating corrections
 *   D2  model-visible input must cite journal seqs (strict rejects; compat degrades)
 *   D3  everything else is an idempotent, watermark-keyed projection
 *   D4  durable facts only; live control (queues, handles, cancellation) stays live
 *   D5  per-adapter rollout with an audited, measured coverage matrix
 *
 * @see ADR-057 §Decision
 * @see ADR-005 §events slot
 * @see docs/reference/adr/ADR-057-replayable-agent-execution-journal.md
 */

const crypto = require('crypto');
const uris = require('./uris');

const SCHEMA_ID = 'agentbox.exec-event/1';

/**
 * Canonical minimum vocabulary (ADR-057 D1). A consumer may depend only on
 * these types; harness extensions ride payload.ext.<harness>.
 */
const VOCABULARY = Object.freeze([
  'turn.started',
  'input.claimed',
  'input.rejected',
  'step.started',
  'model.requested',
  'assistant.chunk',
  'assistant.completed',
  'model.failed',
  'tool.called',
  'tool.approval',
  'tool.completed',
  'step.completed',
  'turn.stopping',
  'turn.completed',
  'turn.cancelled',
]);
const VOCABULARY_SET = new Set(VOCABULARY);

const PRIVACY_CLASSES = new Set(['public', 'internal', 'sensitive', 'secret']);

/** Modes for the D2 provenance assertion. */
const MODE_STRICT = 'strict';
const MODE_COMPAT = 'compatibility';

class JournalError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'JournalError';
    this.code = code || 'journal_error';
  }
}

/** Thrown by D2 in strict mode when a model request cites nothing traceable. */
class UntraceableModelRequest extends JournalError {
  constructor(untraceable) {
    super(
      `model request has ${untraceable.length} untraceable item(s); every message and injected context item must cite ≥1 journal seq (ADR-057 D2)`,
      'untraceable_model_request',
    );
    this.name = 'UntraceableModelRequest';
    this.untraceable = untraceable;
  }
}

class ExecutionJournal {
  /**
   * @param {object} opts
   * @param {{dispatch: Function}} opts.eventsAdapter - resolved ADR-005 events adapter
   * @param {string} [opts.mode='strict'] - D2 enforcement: 'strict' | 'compatibility'
   * @param {() => string} [opts.now] - clock override (tests); returns ISO-8601
   */
  constructor({ eventsAdapter, mode = MODE_STRICT, now } = {}) {
    if (!eventsAdapter || typeof eventsAdapter.dispatch !== 'function') {
      throw new JournalError('ExecutionJournal requires an events adapter with dispatch()', 'no_adapter');
    }
    this._events = eventsAdapter;
    this._mode = mode === MODE_COMPAT ? MODE_COMPAT : MODE_STRICT;
    this._now = typeof now === 'function' ? now : () => new Date().toISOString();
    // Per-session monotonic state and idempotency ledger (in-process; rebuilt
    // from the journal via hydrate() after a restart).
    this._nextSeq = new Map(); // session_urn -> next seq
    this._seenIds = new Map(); // session_urn -> Map(event_id -> envelope)
  }

  get mode() { return this._mode; }

  /** Next per-session seq without consuming it (for provenance range checks). */
  _peekSeq(sessionUrn) {
    return this._nextSeq.get(sessionUrn) || 0;
  }

  /**
   * Append one AgentExecutionEvent. Assigns the per-session seq, mints an
   * event_id when absent, validates against the canonical envelope, and
   * dispatches through the events adapter. Idempotent on event_id: a retry with
   * the same (session_urn, event_id) returns the original envelope and appends
   * nothing (ADR-057 D1).
   *
   * @param {object} event
   * @param {string} event.session_urn
   * @param {string} event.type          - one of VOCABULARY
   * @param {string} event.harness
   * @param {string} event.agent_did
   * @param {number} event.turn
   * @param {number} [event.step]
   * @param {object} [event.payload]
   * @param {string} [event.event_id]     - supply for cross-retry idempotency
   * @param {string} [event.privacy_class='internal']
   * @param {string} [event.correlation]
   * @param {string} [event.causation]
   * @returns {Promise<{envelope: object, duplicate: boolean}>}
   */
  async append(event) {
    const e = event || {};
    if (!e.session_urn) throw new JournalError('session_urn is required', 'bad_event');
    if (!VOCABULARY_SET.has(e.type)) {
      throw new JournalError(`unknown event type: ${e.type}`, 'bad_type');
    }
    const privacyClass = e.privacy_class || 'internal';
    if (!PRIVACY_CLASSES.has(privacyClass)) {
      throw new JournalError(`invalid privacy_class: ${privacyClass}`, 'bad_privacy_class');
    }

    // Idempotency: a supplied event_id that we have already committed for this
    // session returns the original envelope, no re-append.
    if (e.event_id) {
      const seen = this._seenIds.get(e.session_urn);
      const prior = seen && seen.get(e.event_id);
      if (prior) return { envelope: prior, duplicate: true };
    }

    const seq = this._peekSeq(e.session_urn);
    const eventId = e.event_id || _mintEventId(e.agent_did, { session_urn: e.session_urn, seq, type: e.type });

    const envelope = {
      schema: SCHEMA_ID,
      event_id: eventId,
      session_urn: e.session_urn,
      seq,
      occurred_at: e.occurred_at || this._now(),
      harness: e.harness || 'unknown',
      agent_did: e.agent_did || null,
      turn: Number.isInteger(e.turn) ? e.turn : 0,
      type: e.type,
      payload: e.payload || {},
      privacy_class: privacyClass,
    };
    if (Number.isInteger(e.step)) envelope.step = e.step;
    if (e.correlation) envelope.correlation = e.correlation;
    if (e.causation) envelope.causation = e.causation;

    // Dispatch through the events adapter. The journal event's `kind` namespaces
    // it in the shared events log; session_urn threads it to the audit chain.
    await this._events.dispatch({
      kind: `exec.${e.type}`,
      session_id: e.session_urn,
      execution_id: eventId,
      payload: envelope,
    });

    // Commit local monotonic + idempotency state only after a successful append.
    this._nextSeq.set(e.session_urn, seq + 1);
    let seen = this._seenIds.get(e.session_urn);
    if (!seen) { seen = new Map(); this._seenIds.set(e.session_urn, seen); }
    seen.set(eventId, envelope);

    return { envelope, duplicate: false };
  }

  /**
   * ADR-057 D2 — "model-visible means journalled". Every message and injected
   * context item in a model request must cite one or more journal seqs that
   * exist for this session. Secrets may be cited as a redacted, hash-bound
   * receipt; the invariant is reconstructable provenance, not disclosure.
   *
   * In strict mode an untraceable request throws before the model is called.
   * In compatibility mode it appends an explicit degraded `model.requested`
   * event and returns { ok:false, degraded:true }.
   *
   * @param {object} request
   * @param {string} request.session_urn
   * @param {Array<{cites?: number[]}>} [request.messages]
   * @param {Array<{cites?: number[]}>} [request.context]
   * @param {object} [opts]
   * @param {string} [opts.mode] - override the instance mode for this call
   * @returns {Promise<{ok: boolean, degraded: boolean, untraceable: Array}>}
   */
  async assertModelRequestTraceable(request, opts = {}) {
    const mode = opts.mode || this._mode;
    const sessionUrn = request && request.session_urn;
    if (!sessionUrn) throw new JournalError('session_urn is required', 'bad_request');
    const ceiling = this._peekSeq(sessionUrn); // valid seqs are [0, ceiling)

    const items = []
      .concat((request.messages || []).map((m, i) => ({ kind: 'message', index: i, cites: m.cites })))
      .concat((request.context || []).map((c, i) => ({ kind: 'context', index: i, cites: c.cites })));

    const untraceable = [];
    for (const item of items) {
      const cites = Array.isArray(item.cites) ? item.cites : [];
      const valid = cites.length > 0 && cites.every((s) => Number.isInteger(s) && s >= 0 && s < ceiling);
      if (!valid) untraceable.push({ kind: item.kind, index: item.index, cites });
    }

    if (untraceable.length === 0) return { ok: true, degraded: false, untraceable: [] };

    if (mode === MODE_STRICT) throw new UntraceableModelRequest(untraceable);

    // Compatibility mode: record the degradation explicitly so coverage is honest.
    await this.append({
      session_urn: sessionUrn,
      type: 'model.requested',
      harness: request.harness,
      agent_did: request.agent_did,
      turn: Number.isInteger(request.turn) ? request.turn : 0,
      step: request.step,
      privacy_class: 'internal',
      payload: { degraded: true, reason: 'untraceable_provenance', untraceable },
    });
    return { ok: false, degraded: true, untraceable };
  }

  /**
   * Assemble an authoritative `assistant.completed` message from previously
   * journalled `assistant.chunk` events (ADR-057 D2). The completed message
   * carries usage and the source chunk seqs, so an interrupted stream can never
   * be promoted to a successful assistant message.
   *
   * @param {object} args
   * @param {string} args.session_urn
   * @param {number} args.turn
   * @param {number} [args.step]
   * @param {number[]} args.chunk_seqs  - seqs of the assistant.chunk events
   * @param {string} args.text          - assembled text
   * @param {object} [args.usage]
   * @param {string} [args.harness]
   * @param {string} [args.agent_did]
   * @returns {Promise<{envelope: object, duplicate: boolean}>}
   */
  async completeAssistant(args) {
    const chunkSeqs = Array.isArray(args.chunk_seqs) ? args.chunk_seqs : [];
    const ceiling = this._peekSeq(args.session_urn);
    const dangling = chunkSeqs.filter((s) => !(Number.isInteger(s) && s >= 0 && s < ceiling));
    if (dangling.length > 0) {
      throw new JournalError(
        `assistant.completed cites chunk seqs not in the journal: ${dangling.join(',')}`,
        'dangling_chunk_ref',
      );
    }
    return this.append({
      session_urn: args.session_urn,
      type: 'assistant.completed',
      harness: args.harness,
      agent_did: args.agent_did,
      turn: args.turn,
      step: args.step,
      privacy_class: args.privacy_class || 'internal',
      payload: { text: args.text || '', usage: args.usage || {}, source_chunks: chunkSeqs },
    });
  }

  /**
   * Rebuild per-session monotonic + idempotency state from already-persisted
   * envelopes (crash-tail recovery, ADR-057 verification step 2). Idempotent:
   * re-hydrating the same events is a no-op.
   *
   * @param {Iterable<object>} envelopes - AgentExecutionEvent envelopes in any order
   */
  hydrate(envelopes) {
    for (const env of envelopes || []) {
      if (!env || !env.session_urn || !Number.isInteger(env.seq)) continue;
      const next = (this._nextSeq.get(env.session_urn) || 0);
      if (env.seq + 1 > next) this._nextSeq.set(env.session_urn, env.seq + 1);
      if (env.event_id) {
        let seen = this._seenIds.get(env.session_urn);
        if (!seen) { seen = new Map(); this._seenIds.set(env.session_urn, seen); }
        if (!seen.has(env.event_id)) seen.set(env.event_id, env);
      }
    }
  }

  /** Coverage snapshot for /v1/system (ADR-057 verification step 5). */
  coverage() {
    const sessions = {};
    for (const [urn, next] of this._nextSeq.entries()) {
      sessions[urn] = { last_seq: next - 1, event_count: next };
    }
    return {
      schema: SCHEMA_ID,
      mode: this._mode,
      vocabulary: VOCABULARY.slice(),
      sessions,
    };
  }
}

/** did:nostr:<hex> -> hex, else undefined (unscoped event urn). */
function _didToPubkey(did) {
  if (typeof did !== 'string') return undefined;
  const m = did.match(/^did:nostr:([0-9a-f]{64})$/);
  return m ? m[1] : undefined;
}

/**
 * Mint a stable event_id through uris.js (repo rule: no ad-hoc URNs). When the
 * acting identity is known we mint a scope-bearing, content-addressed
 * `urn:agentbox:event`; when it is absent (e.g. a system-level lifecycle event)
 * we fall back to an unscoped, content-addressed `urn:agentbox:meta`. The
 * (session_urn, seq) pair is unique, so the meta slug never collides.
 */
function _mintEventId(agentDid, { session_urn, seq, type }) {
  const pubkey = _didToPubkey(agentDid);
  if (pubkey) {
    return uris.mint({ kind: 'event', pubkey, payload: { session_urn, seq, type } });
  }
  const slug = 'exec-' + crypto.createHash('sha256')
    .update(`${session_urn}|${seq}|${type}`).digest('hex').slice(0, 16);
  return uris.mint({ kind: 'meta', localId: slug });
}

module.exports = {
  ExecutionJournal,
  JournalError,
  UntraceableModelRequest,
  VOCABULARY,
  SCHEMA_ID,
  MODE_STRICT,
  MODE_COMPAT,
};
