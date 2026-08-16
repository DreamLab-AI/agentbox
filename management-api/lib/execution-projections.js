'use strict';

/**
 * execution-projections — ADR-057 D3. Everything that is not the journal is an
 * idempotent projection keyed by its source sequence watermark: transcript /
 * history, live UI, the NIP-59 mirror feed, the kind-30840 digest input, the
 * cost ledger, OpenTelemetry spans, session search.
 *
 * Two invariants hold for every projection here:
 *   1. Idempotent replay — applying an envelope whose seq is at or below the
 *      per-session watermark changes nothing. Rebuilds from the same journal
 *      version produce the same semantic result.
 *   2. No manufacture — a projection can only reflect events that exist in the
 *      journal. It can never synthesise a completed assistant message or a tool
 *      result that was not journalled (the acceptance property of ADR-057).
 *
 * Projection failure never rolls back the journal; a projector that throws on
 * one event simply does not advance its watermark for that session.
 *
 * @see ADR-057 §D3
 */

/**
 * Base class: watermark-keyed idempotent fold over journal envelopes.
 * Subclasses implement `_reduce(state, envelope)`.
 */
class Projection {
  constructor() {
    this._watermark = new Map(); // session_urn -> highest applied seq
  }

  /** Reset to empty so a rebuild starts clean. */
  reset() {
    this._watermark = new Map();
    this._init();
  }

  /** @protected — subclasses initialise their derived state store here. */
  _init() {}

  /**
   * Apply one envelope. Returns true if it advanced the projection, false if it
   * was a duplicate/old event (idempotent no-op).
   */
  apply(envelope) {
    if (!envelope || !envelope.session_urn || !Number.isInteger(envelope.seq)) return false;
    const mark = this._watermark.get(envelope.session_urn);
    if (mark !== undefined && envelope.seq <= mark) return false; // already folded in
    this._reduce(envelope);
    this._watermark.set(envelope.session_urn, envelope.seq);
    return true;
  }

  /** Rebuild from an ordered (or unordered) set of envelopes. */
  rebuild(envelopes) {
    this.reset();
    const ordered = Array.from(envelopes || []).sort(_bySessionThenSeq);
    for (const env of ordered) this.apply(env);
    return this;
  }

  /** Watermark for a session (or -1 if nothing applied). */
  watermark(sessionUrn) {
    const m = this._watermark.get(sessionUrn);
    return m === undefined ? -1 : m;
  }

  /** @protected */
  _reduce(_envelope) { throw new Error('Projection._reduce must be implemented'); }
}

/**
 * Transcript / history projection. Only authoritative, completed facts become
 * transcript entries — an `assistant.chunk` is deliberately ignored, so an
 * interrupted stream never appears as a message.
 */
class TranscriptProjection extends Projection {
  constructor() { super(); this._init(); }

  _init() { this._bySession = new Map(); }

  _reduce(env) {
    const list = this._bySession.get(env.session_urn) || [];
    switch (env.type) {
      case 'input.claimed':
        list.push({ seq: env.seq, role: 'user', text: env.payload.text || '', turn: env.turn });
        break;
      case 'assistant.completed':
        list.push({ seq: env.seq, role: 'assistant', text: env.payload.text || '', turn: env.turn });
        break;
      case 'tool.completed':
        list.push({
          seq: env.seq,
          role: 'tool',
          tool: env.payload.tool || env.payload.capability || null,
          ok: env.payload.ok !== false,
          turn: env.turn,
        });
        break;
      default:
        return; // non-transcript events (chunks, lifecycle) are not history
    }
    this._bySession.set(env.session_urn, list);
  }

  transcript(sessionUrn) {
    return (this._bySession.get(sessionUrn) || []).slice();
  }
}

/**
 * Cost ledger projection. Sums usage from authoritative `assistant.completed`
 * events only. Never charges for an incomplete stream.
 */
class CostLedgerProjection extends Projection {
  constructor() { super(); this._init(); }

  _init() { this._totals = new Map(); }

  _reduce(env) {
    if (env.type !== 'assistant.completed') return;
    const usage = env.payload.usage || {};
    const t = this._totals.get(env.session_urn) || { input_tokens: 0, output_tokens: 0, messages: 0 };
    t.input_tokens += Number(usage.input_tokens) || 0;
    t.output_tokens += Number(usage.output_tokens) || 0;
    t.messages += 1;
    this._totals.set(env.session_urn, t);
  }

  total(sessionUrn) {
    return this._totals.get(sessionUrn) || { input_tokens: 0, output_tokens: 0, messages: 0 };
  }
}

function _bySessionThenSeq(a, b) {
  if (a.session_urn < b.session_urn) return -1;
  if (a.session_urn > b.session_urn) return 1;
  return a.seq - b.seq;
}

module.exports = { Projection, TranscriptProjection, CostLedgerProjection };
