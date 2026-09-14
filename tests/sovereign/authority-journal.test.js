'use strict';

/**
 * authority-journal — FR4.4 / EXP-AC-004: "agentbox authority-gate denials are
 * appended to the execution journal as `authority.deny` records with stage and
 * reason, readable at `/v1/agent-events`."
 *
 * Two sinks, one record:
 *   * the ADR-005 events adapter, which supplies the ADR-039 hash chain — the
 *     tamper-evidence that makes a denial record worth anything;
 *   * the agent-event publisher, which is what `/v1/agent-events` actually
 *     reads (a ring buffer plus the ADR-2026 durable archive).
 */

const { buildAuthorityJournal, AUTHORITY_DENY_KIND } = require('../../management-api/lib/authority-journal');

function eventsAdapterDouble(opts = {}) {
  const dispatched = [];
  return {
    dispatched,
    async dispatch(event) {
      dispatched.push(event);
      if (opts.throws) throw new Error('events adapter down');
      return { ts: '2026-09-14T00:00:00.000Z', kind: event.kind };
    },
  };
}

function publisherDouble(opts = {}) {
  const emitted = [];
  return {
    emitted,
    emitAgentAction(event) {
      emitted.push(event);
      if (opts.throws) throw new Error('publisher down');
      return event;
    },
  };
}

const RECORD = {
  type: 'authority.deny',
  agent_did: 'did:nostr:' + 'a'.repeat(64),
  stage: 'await-decision',
  reason: 'no-signed-response',
  action_class: 'pod_delete',
  authority_class: 'zero-tolerance',
  operation_sha256: 'b'.repeat(64),
  task_properties: { verifiability: 'opaque', reversibility: 'irreversible', stakes: 'critical' },
  request_event_id: 'c'.repeat(64),
  response_event_id: null,
};

describe('buildAuthorityJournal', () => {
  test('dispatches a hash-chainable authority.deny event through the events adapter', async () => {
    const events = eventsAdapterDouble();
    const journal = buildAuthorityJournal({ eventsAdapter: events, publisher: publisherDouble() });
    const result = await journal.append(RECORD);

    expect(events.dispatched).toHaveLength(1);
    const dispatched = events.dispatched[0];
    expect(dispatched.kind).toBe(AUTHORITY_DENY_KIND);
    expect(AUTHORITY_DENY_KIND).toBe('authority.deny');
    expect(dispatched.payload).toMatchObject({
      type: 'authority.deny',
      stage: 'await-decision',
      reason: 'no-signed-response',
      action_class: 'pod_delete',
      agent_did: RECORD.agent_did,
      operation_sha256: RECORD.operation_sha256,
    });
    expect(dispatched.payload.occurred_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result.journalled).toBe(true);
  });

  test('emits to the agent-event publisher so /v1/agent-events shows the denial', async () => {
    const publisher = publisherDouble();
    const journal = buildAuthorityJournal({ eventsAdapter: eventsAdapterDouble(), publisher });
    const result = await journal.append(RECORD);
    expect(result.published).toBe(true);

    expect(publisher.emitted).toHaveLength(1);
    const emitted = publisher.emitted[0];
    expect(emitted.action_type).toBe('update');
    expect(emitted.outcome).toBe('failure');
    expect(emitted.authority_class).toBe('zero-tolerance');
    expect(emitted.metadata).toMatchObject({
      event: 'authority.deny', stage: 'await-decision', reason: 'no-signed-response',
      action_class: 'pod_delete', operation_sha256: RECORD.operation_sha256,
    });
    expect(emitted.metadata.task_properties).toEqual(RECORD.task_properties);
    expect(emitted.source_urn).toBe(RECORD.agent_did);
  });

  test('a stage or reason is mandatory — an unlabelled denial is not a record', async () => {
    const journal = buildAuthorityJournal({ eventsAdapter: eventsAdapterDouble(), publisher: publisherDouble() });
    await expect(journal.append({ ...RECORD, stage: undefined })).rejects.toThrow(/stage/);
    await expect(journal.append({ ...RECORD, reason: '' })).rejects.toThrow(/reason/);
  });

  test('a failing events adapter is reported, not swallowed, and the publisher still sees it', async () => {
    const events = eventsAdapterDouble({ throws: true });
    const publisher = publisherDouble();
    const errors = [];
    const journal = buildAuthorityJournal({
      eventsAdapter: events, publisher,
      logger: { warn: (o, m) => errors.push(m), error: (o, m) => errors.push(m), info() {}, debug() {} },
    });
    const result = await journal.append(RECORD);

    expect(result.journalled).toBe(false);
    expect(result.published).toBe(true);
    expect(result.error).toMatch(/events adapter down/);
    expect(publisher.emitted).toHaveLength(1);
    expect(errors.join(' ')).toMatch(/authority.deny/);
  });

  test('with no events adapter the record still reaches /v1/agent-events', async () => {
    const publisher = publisherDouble();
    const journal = buildAuthorityJournal({ eventsAdapter: null, publisher });
    const result = await journal.append(RECORD);
    expect(result.journalled).toBe(false);
    expect(result.published).toBe(true);
    expect(publisher.emitted).toHaveLength(1);
  });

  test('a failing publisher does not prevent the hash-chained append', async () => {
    const events = eventsAdapterDouble();
    const journal = buildAuthorityJournal({
      eventsAdapter: events, publisher: publisherDouble({ throws: true }),
      logger: { warn() {}, error() {}, info() {}, debug() {} },
    });
    const result = await journal.append(RECORD);
    expect(result.journalled).toBe(true);
    expect(result.published).toBe(false);
    expect(events.dispatched).toHaveLength(1);
  });

  test('both sinks failing surfaces an explicit unrecorded result — never a silent success', async () => {
    const journal = buildAuthorityJournal({
      eventsAdapter: eventsAdapterDouble({ throws: true }),
      publisher: publisherDouble({ throws: true }),
      logger: { warn() {}, error() {}, info() {}, debug() {} },
    });
    const result = await journal.append(RECORD);
    expect(result).toMatchObject({ journalled: false, published: false });
    expect(result.error).toBeTruthy();
  });
});

describe('FR4.2 — the same journal carries receipt-post failures', () => {
  const { RECEIPT_POST_FAILED_KIND } = require('../../management-api/lib/authority-journal');

  test('a receipt-post-failed record selects its own event kind', async () => {
    const events = eventsAdapterDouble();
    const publisher = publisherDouble();
    const journal = buildAuthorityJournal({ eventsAdapter: events, publisher });
    const result = await journal.append({
      type: RECEIPT_POST_FAILED_KIND,
      stage: 'applied',
      reason: 'fetch failed: ECONNREFUSED',
      response_event_id: 'f'.repeat(64),
    });

    expect(RECEIPT_POST_FAILED_KIND).toBe('authority.receipt-post-failed');
    expect(result).toMatchObject({ journalled: true, published: true, kind: RECEIPT_POST_FAILED_KIND });
    expect(events.dispatched[0].kind).toBe(RECEIPT_POST_FAILED_KIND);
    expect(events.dispatched[0].payload).toMatchObject({
      type: RECEIPT_POST_FAILED_KIND, stage: 'applied', response_event_id: 'f'.repeat(64),
    });
    expect(publisher.emitted[0].metadata.event).toBe(RECEIPT_POST_FAILED_KIND);
  });

  test('an unknown type falls back to authority.deny rather than minting a new kind', async () => {
    const events = eventsAdapterDouble();
    const journal = buildAuthorityJournal({ eventsAdapter: events, publisher: publisherDouble() });
    await journal.append({ ...RECORD, type: 'authority.something-invented' });
    expect(events.dispatched[0].kind).toBe(AUTHORITY_DENY_KIND);
  });
});
