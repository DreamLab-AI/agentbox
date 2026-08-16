'use strict';

/**
 * Contract test suite — ADR-057 replayable agent execution journal.
 *
 * The journal rides the REAL ADR-005 events adapter (LocalJsonlEventsAdapter
 * with an injected appendFn), so these tests also prove the integration seam,
 * not just the journal in isolation. Every appended envelope is validated
 * against the canonical JSON Schema that lives beside the events adapter.
 *
 * @see ADR-057 §Implementation and verification
 */

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const { LocalJsonlEventsAdapter } = require('../../management-api/adapters/events/local-jsonl');
const {
  ExecutionJournal, UntraceableModelRequest, JournalError, VOCABULARY, SCHEMA_ID, MODE_COMPAT,
} = require('../../management-api/lib/execution-journal');
const {
  TranscriptProjection, CostLedgerProjection,
} = require('../../management-api/lib/execution-projections');

const SCHEMA = JSON.parse(fs.readFileSync(
  path.join(__dirname, '../../management-api/adapters/events/agent-execution-event.schema.json'), 'utf8',
));

// Compile the schema once. addFormats is optional; tolerate its absence.
function makeValidator() {
  const ajv = new Ajv({ allErrors: true, strict: false });
  try { addFormats(ajv); } catch (_) { /* date-time format check is best-effort */ }
  return ajv.compile(SCHEMA);
}
const validateEnvelope = makeValidator();

// A journal wired to the real events adapter; captured[] collects every
// envelope the adapter actually persisted (proving "model-visible = journalled"
// is enforced at the store boundary, not only in memory).
function makeJournal(opts = {}) {
  const captured = [];
  const adapter = new LocalJsonlEventsAdapter({
    appendFn: (_file, line) => { captured.push(JSON.parse(line)); },
  });
  const journal = new ExecutionJournal({ eventsAdapter: adapter, now: () => '2026-08-16T00:00:00.000Z', ...opts });
  const envelopes = () => captured.map((rec) => rec.payload);
  return { journal, captured, envelopes };
}

const SESSION = 'urn:agentbox:meta:session-alpha';
const SESSION_B = 'urn:agentbox:meta:session-beta';
const DID = 'did:nostr:' + 'a'.repeat(64);

function baseEvent(over = {}) {
  return { session_urn: SESSION, harness: 'claude', agent_did: DID, turn: 0, type: 'turn.started', ...over };
}

describe('ADR-057 D1 — canonical append-only journal', () => {
  test('assigns per-session contiguous monotonic seq from 0', async () => {
    const { journal } = makeJournal();
    const a = await journal.append(baseEvent({ type: 'turn.started' }));
    const b = await journal.append(baseEvent({ type: 'input.claimed', payload: { text: 'hi' } }));
    const c = await journal.append(baseEvent({ type: 'step.started' }));
    expect([a, b, c].map((r) => r.envelope.seq)).toEqual([0, 1, 2]);
  });

  test('sequences are independent per session', async () => {
    const { journal } = makeJournal();
    await journal.append(baseEvent({ session_urn: SESSION, type: 'turn.started' }));
    const other = await journal.append(baseEvent({ session_urn: SESSION_B, type: 'turn.started' }));
    const back = await journal.append(baseEvent({ session_urn: SESSION, type: 'input.claimed' }));
    expect(other.envelope.seq).toBe(0);
    expect(back.envelope.seq).toBe(1);
  });

  test('every persisted envelope validates against the canonical JSON Schema', async () => {
    const { journal, envelopes } = makeJournal();
    await journal.append(baseEvent({ type: 'turn.started' }));
    await journal.append(baseEvent({ type: 'input.claimed', step: 0, payload: { text: 'x' }, privacy_class: 'sensitive' }));
    for (const env of envelopes()) {
      const ok = validateEnvelope(env);
      if (!ok) throw new Error('schema violation: ' + JSON.stringify(validateEnvelope.errors));
      expect(env.schema).toBe(SCHEMA_ID);
    }
  });

  test('idempotent on event_id — a retry appends nothing and returns the original', async () => {
    const { journal, captured } = makeJournal();
    const first = await journal.append(baseEvent({ type: 'tool.called', event_id: 'evt-retry-1', payload: { tool: 'Read' } }));
    const retry = await journal.append(baseEvent({ type: 'tool.called', event_id: 'evt-retry-1', payload: { tool: 'Read' } }));
    expect(retry.duplicate).toBe(true);
    expect(retry.envelope).toBe(first.envelope);
    expect(captured.length).toBe(1); // only one physical append
  });

  test('rejects an event type outside the canonical vocabulary', async () => {
    const { journal } = makeJournal();
    await expect(journal.append(baseEvent({ type: 'not.a.real.type' }))).rejects.toThrow(JournalError);
  });

  test('vocabulary is exactly the ADR-057 D1 minimum set', () => {
    expect(VOCABULARY).toContain('assistant.completed');
    expect(VOCABULARY).toContain('tool.approval');
    expect(VOCABULARY).toContain('turn.cancelled');
    expect(VOCABULARY.length).toBe(15);
  });
});

describe('ADR-057 D2 — model-visible means journalled', () => {
  test('strict mode rejects a request citing no journal seqs', async () => {
    const { journal } = makeJournal();
    await journal.append(baseEvent({ type: 'turn.started' }));
    await expect(journal.assertModelRequestTraceable({
      session_urn: SESSION,
      messages: [{ role: 'user', cites: [] }],
    })).rejects.toThrow(UntraceableModelRequest);
  });

  test('strict mode rejects a citation to a seq that does not exist yet', async () => {
    const { journal } = makeJournal();
    await journal.append(baseEvent({ type: 'turn.started' })); // seq 0 only
    await expect(journal.assertModelRequestTraceable({
      session_urn: SESSION,
      messages: [{ role: 'user', cites: [99] }],
    })).rejects.toThrow(UntraceableModelRequest);
  });

  test('passes when every message and context item cites an existing seq', async () => {
    const { journal } = makeJournal();
    await journal.append(baseEvent({ type: 'turn.started' }));      // 0
    await journal.append(baseEvent({ type: 'input.claimed' }));     // 1
    const res = await journal.assertModelRequestTraceable({
      session_urn: SESSION,
      messages: [{ role: 'user', cites: [1] }],
      context: [{ cites: [0, 1] }],
    });
    expect(res).toEqual({ ok: true, degraded: false, untraceable: [] });
  });

  test('compatibility mode records an explicit degraded event instead of throwing', async () => {
    const { journal, envelopes } = makeJournal({ mode: MODE_COMPAT });
    await journal.append(baseEvent({ type: 'turn.started' }));
    const res = await journal.assertModelRequestTraceable({ session_urn: SESSION, messages: [{ cites: [] }] });
    expect(res.degraded).toBe(true);
    const degraded = envelopes().find((e) => e.type === 'model.requested' && e.payload.degraded);
    expect(degraded).toBeTruthy();
    expect(degraded.payload.reason).toBe('untraceable_provenance');
  });

  test('assistant.completed cannot cite chunk seqs absent from the journal', async () => {
    const { journal } = makeJournal();
    await journal.append(baseEvent({ type: 'turn.started' }));
    await expect(journal.completeAssistant({
      session_urn: SESSION, turn: 0, chunk_seqs: [42], text: 'forged',
    })).rejects.toThrow(/not in the journal/);
  });

  test('assistant.completed carries usage and the real source chunk seqs', async () => {
    const { journal } = makeJournal();
    await journal.append(baseEvent({ type: 'turn.started' }));                 // 0
    const c1 = await journal.append(baseEvent({ type: 'assistant.chunk', payload: { delta: 'he' } }));  // 1
    const c2 = await journal.append(baseEvent({ type: 'assistant.chunk', payload: { delta: 'llo' } })); // 2
    const done = await journal.completeAssistant({
      session_urn: SESSION, turn: 0, text: 'hello',
      chunk_seqs: [c1.envelope.seq, c2.envelope.seq], usage: { input_tokens: 5, output_tokens: 2 },
    });
    expect(done.envelope.payload.source_chunks).toEqual([1, 2]);
    expect(done.envelope.payload.usage.output_tokens).toBe(2);
  });
});

describe('ADR-057 D3 — everything else is an idempotent projection', () => {
  async function seedSession(journal) {
    await journal.append(baseEvent({ type: 'turn.started' }));                                   // 0
    await journal.append(baseEvent({ type: 'input.claimed', payload: { text: 'ping' } }));       // 1
    await journal.append(baseEvent({ type: 'assistant.chunk', payload: { delta: 'po' } }));      // 2
    await journal.completeAssistant({ session_urn: SESSION, turn: 0, text: 'pong', chunk_seqs: [2], usage: { input_tokens: 3, output_tokens: 1 } }); // 3
    await journal.append(baseEvent({ type: 'tool.completed', payload: { tool: 'Read', ok: true } })); // 4
  }

  test('transcript rebuild is deterministic and never includes raw chunks', async () => {
    const { journal, envelopes } = makeJournal();
    await seedSession(journal);
    const proj = new TranscriptProjection().rebuild(envelopes());
    const t = proj.transcript(SESSION);
    expect(t.map((e) => e.role)).toEqual(['user', 'assistant', 'tool']); // no 'chunk' entry
    // Rebuilding again produces an identical result (same journal version).
    const again = new TranscriptProjection().rebuild(envelopes());
    expect(again.transcript(SESSION)).toEqual(t);
  });

  test('re-applying an already-folded event is a no-op (watermark idempotency)', async () => {
    const { journal, envelopes } = makeJournal();
    await seedSession(journal);
    const proj = new TranscriptProjection().rebuild(envelopes());
    const before = proj.transcript(SESSION);
    for (const env of envelopes()) proj.apply(env); // replay everything again
    expect(proj.transcript(SESSION)).toEqual(before);
  });

  test('acceptance: a projection cannot manufacture a completed response absent its journal event', async () => {
    const { journal, envelopes } = makeJournal();
    await journal.append(baseEvent({ type: 'turn.started' }));                              // 0
    await journal.append(baseEvent({ type: 'assistant.chunk', payload: { delta: 'partial' } })); // 1 — stream interrupted, no completed event
    const proj = new TranscriptProjection().rebuild(envelopes());
    expect(proj.transcript(SESSION).some((e) => e.role === 'assistant')).toBe(false);
  });

  test('cost ledger only bills authoritative assistant.completed usage', async () => {
    const { journal, envelopes } = makeJournal();
    await seedSession(journal);
    const ledger = new CostLedgerProjection().rebuild(envelopes());
    expect(ledger.total(SESSION)).toEqual({ input_tokens: 3, output_tokens: 1, messages: 1 });
  });
});

describe('ADR-057 D5 — crash-tail recovery + coverage', () => {
  test('hydrate rebuilds per-session seq so the next append continues monotonically', async () => {
    // First "process": append three events and capture the persisted envelopes.
    const first = makeJournal();
    await first.journal.append(baseEvent({ type: 'turn.started' }));
    await first.journal.append(baseEvent({ type: 'input.claimed' }));
    await first.journal.append(baseEvent({ type: 'assistant.chunk' }));
    const persisted = first.envelopes();

    // Second "process": a fresh journal recovers from the persisted tail.
    const restarted = makeJournal();
    restarted.journal.hydrate(persisted);
    const next = await restarted.journal.append(baseEvent({ type: 'assistant.completed', payload: { text: '', usage: {}, source_chunks: [] } }));
    expect(next.envelope.seq).toBe(3); // continues, does not reset to 0
  });

  test('coverage snapshot reports mode, vocabulary and per-session watermark', async () => {
    const { journal } = makeJournal();
    await journal.append(baseEvent({ type: 'turn.started' }));
    await journal.append(baseEvent({ type: 'input.claimed' }));
    const cov = journal.coverage();
    expect(cov.mode).toBe('strict');
    expect(cov.vocabulary.length).toBe(15);
    expect(cov.sessions[SESSION]).toEqual({ last_seq: 1, event_count: 2 });
  });
});
