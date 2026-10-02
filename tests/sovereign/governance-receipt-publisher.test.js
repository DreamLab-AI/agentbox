'use strict';

/**
 * governance-receipt-publisher — FR4.2 / EXP-AC-004, FR7.1 / EXP-AC-007.
 *
 * agentbox is the MUTATION OWNER: it is the only party that knows whether an
 * approved operation actually landed. `ApplicationReceiptStore` already records
 * that locally and durably. What was missing is the other half — telling the
 * HUMAN who approved it. Condition C2/C3 both fail while an approval's fate is
 * knowable only by reading agentbox's own state directory.
 *
 * This module mirrors each local receipt stage to the forum's receipts
 * endpoint, NIP-98 signed as the agent. A failed post is journalled and queued;
 * it is never silently dropped and never retried into a duplicate mutation
 * (the mutation already happened — only the record of it is being replayed).
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildReceiptPublisher, bootReceiptPublisher, APPLICATION_STAGES,
} = require('../../management-api/lib/governance-receipt-publisher');
const { RECEIPT_POST_FAILED_KIND } = require('../../management-api/lib/authority-journal');

const RESPONSE_ID = 'a'.repeat(64);
const MANIFEST = { sovereign_mesh: { relay: { forum_auth_api: 'https://forum.example/auth' } } };

function tmpOutbox() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'receipt-outbox-'));
}

function journalDouble() {
  const records = [];
  return { records, async append(r) { records.push(r); return { journalled: true, published: true }; } };
}

/** A fetch double recording calls and replaying a scripted sequence. */
function fetchDouble(responses) {
  const calls = [];
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      async text() { return next.body || ''; },
    };
  };
  impl.calls = calls;
  return impl;
}

function build(opts = {}) {
  return buildReceiptPublisher({
    manifest: MANIFEST,
    env: {},
    outboxDir: opts.outboxDir || tmpOutbox(),
    fetchImpl: opts.fetchImpl,
    nip98: opts.nip98 || (async () => 'Nostr dGVzdA=='),
    journal: opts.journal,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    agentDid: 'did:nostr:' + 'b'.repeat(64),
    ...opts.overrides,
  });
}

describe('stage vocabulary', () => {
  test('the four application stages are exactly the protocol ladder', () => {
    expect(APPLICATION_STAGES).toEqual(['consumer-received', 'applied', 'not-applied', 'applied-manually']);
  });
});

describe('posting a receipt', () => {
  test('POSTs the stage to the forum endpoint with a NIP-98 Authorization header', async () => {
    const fetchImpl = fetchDouble({ status: 202 });
    const publisher = build({ fetchImpl });
    const result = await publisher.post({ response_event_id: RESPONSE_ID, stage: 'consumer-received' });

    expect(result).toMatchObject({ ok: true, status: 202, queued: false });
    expect(fetchImpl.calls).toHaveLength(1);
    const { url, init } = fetchImpl.calls[0];
    expect(url).toBe(`https://forum.example/auth/api/governance/receipts/${RESPONSE_ID}/application`);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Nostr dGVzdA==');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ stage: 'consumer-received' });
  });

  test('carries acknowledgement, executed_by and evidence when supplied', async () => {
    const fetchImpl = fetchDouble({ status: 200 });
    const publisher = build({ fetchImpl });
    await publisher.post({
      response_event_id: RESPONSE_ID,
      stage: 'applied-manually',
      acknowledgement: { manual: true },
      executed_by: 'did:nostr:' + 'c'.repeat(64),
      evidence: 'ran the migration by hand at 02:10',
    });
    expect(JSON.parse(fetchImpl.calls[0].init.body)).toEqual({
      stage: 'applied-manually',
      acknowledgement: { manual: true },
      executed_by: 'did:nostr:' + 'c'.repeat(64),
      evidence: 'ran the migration by hand at 02:10',
    });
  });

  test('the NIP-98 token is bound to the exact method, url and body', async () => {
    const seen = [];
    const publisher = build({
      fetchImpl: fetchDouble({ status: 200 }),
      nip98: async (method, url, body) => { seen.push({ method, url, body }); return 'Nostr x'; },
    });
    await publisher.post({ response_event_id: RESPONSE_ID, stage: 'applied', acknowledgement: { writeback_committed: true } });
    expect(seen).toHaveLength(1);
    expect(seen[0].method).toBe('POST');
    expect(seen[0].url).toContain(`/receipts/${RESPONSE_ID}/application`);
    expect(JSON.parse(seen[0].body).stage).toBe('applied');
  });

  test('rejects a stage outside the ladder and an invalid response id', async () => {
    const publisher = build({ fetchImpl: fetchDouble({ status: 200 }) });
    await expect(publisher.post({ response_event_id: RESPONSE_ID, stage: 'nearly-applied' }))
      .rejects.toThrow(/stage/);
    await expect(publisher.post({ response_event_id: 'short', stage: 'applied' }))
      .rejects.toThrow(/response_event_id/);
  });
});

describe('failure handling — never silent, never dropped', () => {
  test('a network failure journals authority.receipt-post-failed and queues for retry', async () => {
    const outboxDir = tmpOutbox();
    const journal = journalDouble();
    const publisher = build({
      outboxDir, journal, fetchImpl: fetchDouble(new Error('ECONNREFUSED')),
    });
    const result = await publisher.post({ response_event_id: RESPONSE_ID, stage: 'applied', acknowledgement: { writeback_committed: true } });

    expect(result).toMatchObject({ ok: false, queued: true });
    expect(result.error).toMatch(/ECONNREFUSED/);

    expect(journal.records).toHaveLength(1);
    expect(journal.records[0]).toMatchObject({
      type: RECEIPT_POST_FAILED_KIND,
      response_event_id: RESPONSE_ID,
      stage: 'applied',
    });
    expect(journal.records[0].reason).toMatch(/ECONNREFUSED/);

    const queued = fs.readdirSync(outboxDir).filter(f => f.endsWith('.json'));
    expect(queued).toHaveLength(1);
    const entry = JSON.parse(fs.readFileSync(path.join(outboxDir, queued[0]), 'utf8'));
    expect(entry).toMatchObject({ status: 'pending', receipt: { response_event_id: RESPONSE_ID, stage: 'applied' } });
  });

  test('a 5xx is retryable — queued', async () => {
    const outboxDir = tmpOutbox();
    const publisher = build({ outboxDir, journal: journalDouble(), fetchImpl: fetchDouble({ status: 503, body: 'upstream' }) });
    const result = await publisher.post({ response_event_id: RESPONSE_ID, stage: 'applied', acknowledgement: { writeback_committed: true } });
    expect(result).toMatchObject({ ok: false, queued: true, status: 503 });
    expect(fs.readdirSync(outboxDir)).toHaveLength(1);
  });

  test('a 409 regression is TERMINAL — journalled, but never queued for retry', async () => {
    const outboxDir = tmpOutbox();
    const journal = journalDouble();
    const publisher = build({ outboxDir, journal, fetchImpl: fetchDouble({ status: 409, body: 'stage regression' }) });
    const result = await publisher.post({ response_event_id: RESPONSE_ID, stage: 'consumer-received' });

    expect(result).toMatchObject({ ok: false, queued: false, status: 409, regression: true });
    expect(journal.records).toHaveLength(1);
    expect(fs.readdirSync(outboxDir)).toHaveLength(0);
  });

  test('a 403 is TERMINAL — the receipt is not authorised, retrying cannot help', async () => {
    const outboxDir = tmpOutbox();
    const journal = journalDouble();
    const publisher = build({ outboxDir, journal, fetchImpl: fetchDouble({ status: 403, body: 'forbidden' }) });
    const result = await publisher.post({ response_event_id: RESPONSE_ID, stage: 'applied-manually' });

    expect(result).toMatchObject({ ok: false, queued: false, status: 403, unauthorised: true });
    expect(journal.records).toHaveLength(1);
    expect(fs.readdirSync(outboxDir)).toHaveLength(0);
  });

  test('an unconfigured forum endpoint queues rather than discarding the receipt', async () => {
    const outboxDir = tmpOutbox();
    const journal = journalDouble();
    const fetchImpl = fetchDouble({ status: 200 });
    const publisher = buildReceiptPublisher({
      manifest: {}, env: {}, outboxDir, journal, fetchImpl,
      nip98: async () => 'Nostr x',
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    const result = await publisher.post({ response_event_id: RESPONSE_ID, stage: 'applied', acknowledgement: { writeback_committed: true } });

    expect(result).toMatchObject({ ok: false, queued: true });
    expect(result.error).toMatch(/not configured/);
    expect(fetchImpl.calls).toHaveLength(0);
    expect(fs.readdirSync(outboxDir)).toHaveLength(1);
  });

  test('an unavailable NIP-98 signer queues rather than posting unsigned', async () => {
    const outboxDir = tmpOutbox();
    const fetchImpl = fetchDouble({ status: 200 });
    const publisher = build({ outboxDir, journal: journalDouble(), fetchImpl, nip98: async () => null });
    const result = await publisher.post({ response_event_id: RESPONSE_ID, stage: 'consumer-received' });

    expect(result).toMatchObject({ ok: false, queued: true });
    expect(fetchImpl.calls).toHaveLength(0);
    expect(result.error).toMatch(/NIP-98/);
  });

  test('the env var overrides the manifest base url', async () => {
    const fetchImpl = fetchDouble({ status: 200 });
    const publisher = buildReceiptPublisher({
      manifest: MANIFEST, env: { FORUM_AUTH_API: 'https://env.example/auth/' },
      outboxDir: tmpOutbox(), fetchImpl, nip98: async () => 'Nostr x',
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    await publisher.post({ response_event_id: RESPONSE_ID, stage: 'consumer-received' });
    expect(fetchImpl.calls[0].url).toBe(`https://env.example/auth/api/governance/receipts/${RESPONSE_ID}/application`);
  });
});

describe('the retry flusher', () => {
  test('a queued receipt is replayed and removed on success', async () => {
    const outboxDir = tmpOutbox();
    const publisher = build({ outboxDir, journal: journalDouble(), fetchImpl: fetchDouble(new Error('down')) });
    await publisher.post({ response_event_id: RESPONSE_ID, stage: 'applied', acknowledgement: { writeback_committed: true } });
    expect(fs.readdirSync(outboxDir)).toHaveLength(1);

    const ok = fetchDouble({ status: 200 });
    const retrier = build({ outboxDir, journal: journalDouble(), fetchImpl: ok });
    const summary = await retrier.flush();

    expect(summary).toMatchObject({ attempted: 1, posted: 1, remaining: 0 });
    expect(ok.calls).toHaveLength(1);
    expect(JSON.parse(ok.calls[0].init.body)).toMatchObject({ stage: 'applied' });
    expect(fs.readdirSync(outboxDir)).toHaveLength(0);
  });

  test('a still-failing receipt stays queued with its attempt history', async () => {
    const outboxDir = tmpOutbox();
    const publisher = build({ outboxDir, journal: journalDouble(), fetchImpl: fetchDouble(new Error('down')) });
    await publisher.post({ response_event_id: RESPONSE_ID, stage: 'not-applied' });

    const retrier = build({ outboxDir, journal: journalDouble(), fetchImpl: fetchDouble(new Error('still down')) });
    const summary = await retrier.flush();

    expect(summary).toMatchObject({ attempted: 1, posted: 0, remaining: 1 });
    const file = fs.readdirSync(outboxDir)[0];
    const entry = JSON.parse(fs.readFileSync(path.join(outboxDir, file), 'utf8'));
    expect(entry.attempts.length).toBeGreaterThanOrEqual(1);
    expect(entry.attempts[entry.attempts.length - 1].error).toMatch(/still down/);
    expect(entry.status).toBe('pending');
  });

  test('a 409 on replay retires the entry — the forum already has a later stage', async () => {
    const outboxDir = tmpOutbox();
    const publisher = build({ outboxDir, journal: journalDouble(), fetchImpl: fetchDouble(new Error('down')) });
    await publisher.post({ response_event_id: RESPONSE_ID, stage: 'consumer-received' });

    const retrier = build({ outboxDir, journal: journalDouble(), fetchImpl: fetchDouble({ status: 409 }) });
    const summary = await retrier.flush();
    expect(summary).toMatchObject({ attempted: 1, posted: 0, retired: 1, remaining: 0 });
    expect(fs.readdirSync(outboxDir)).toHaveLength(0);
  });

  test('an exhausted entry is kept on disk as `failed`, never deleted', async () => {
    const outboxDir = tmpOutbox();
    const publisher = build({ outboxDir, journal: journalDouble(), fetchImpl: fetchDouble(new Error('down')), overrides: { maxAttempts: 2 } });
    await publisher.post({ response_event_id: RESPONSE_ID, stage: 'applied', acknowledgement: { writeback_committed: true } });

    const retrier = build({ outboxDir, journal: journalDouble(), fetchImpl: fetchDouble(new Error('down')), overrides: { maxAttempts: 2 } });
    await retrier.flush();
    const summary = await retrier.flush();

    expect(summary.remaining).toBe(0);
    expect(summary.exhausted).toBeGreaterThanOrEqual(1);
    const files = fs.readdirSync(outboxDir);
    expect(files).toHaveLength(1); // kept — a lost receipt is worse than a stale one
    expect(JSON.parse(fs.readFileSync(path.join(outboxDir, files[0]), 'utf8')).status).toBe('failed');
  });

  test('flushing an empty (or absent) outbox is a no-op', async () => {
    const publisher = build({ outboxDir: path.join(tmpOutbox(), 'not-created-yet'), journal: journalDouble(), fetchImpl: fetchDouble({ status: 200 }) });
    await expect(publisher.flush()).resolves.toMatchObject({ attempted: 0, posted: 0, remaining: 0 });
  });
});

// ADR-2087 §Consequences: "The publisher owns its own replay." Until this block
// nothing in production ever called flush() or start(), so a receipt queued by a
// forum outage (or by the governance-bridge MCP process, which shares the outbox
// directory) sat on disk forever — EXP-AC-007's "flushed later, never dropped"
// held only in tests that called flush() by hand.
describe('replay with no forum configured', () => {
  test('flush makes no attempt and spends none of the retry budget', async () => {
    const outboxDir = tmpOutbox();
    const unconfigured = buildReceiptPublisher({
      manifest: { sovereign_mesh: { relay: { forum_auth_api: '' } } }, env: {}, outboxDir,
      fetchImpl: fetchDouble({ status: 200 }), nip98: async () => 'Nostr dGVzdA==',
      journal: journalDouble(), logger: { debug() {}, info() {}, warn() {}, error() {} },
      maxAttempts: 2,
    });
    await unconfigured.post({ response_event_id: RESPONSE_ID, stage: 'applied', acknowledgement: { writeback_committed: true } });
    const file = path.join(outboxDir, fs.readdirSync(outboxDir)[0]);
    const before = JSON.parse(fs.readFileSync(file, 'utf8'));

    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const summary = await unconfigured.flush();
      expect(summary).toMatchObject({ attempted: 0, posted: 0, remaining: 1, skipped: 'not-configured' });
    }
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(after.status).toBe('pending'); // NOT parked as failed before the endpoint exists
    expect(after.attempts).toHaveLength(before.attempts.length);

    // Once the forum is configured the same entry is delivered.
    const ok = fetchDouble({ status: 202 });
    const configured = build({ outboxDir, journal: journalDouble(), fetchImpl: ok });
    await expect(configured.flush()).resolves.toMatchObject({ attempted: 1, posted: 1, remaining: 0 });
    expect(fs.readdirSync(outboxDir)).toHaveLength(0);
  });
});

describe('bootReceiptPublisher — the production replay loop', () => {
  const quiet = { debug() {}, info() {}, warn() {}, error() {} };

  function bootDeps(outboxDir, fetchImpl, extra = {}) {
    return {
      manifest: MANIFEST, env: {}, outboxDir, fetchImpl,
      nip98: async () => 'Nostr dGVzdA==', journal: journalDouble(), logger: quiet,
      ...extra,
    };
  }

  test('replays, at boot, a receipt another process queued', async () => {
    const outboxDir = tmpOutbox();
    // The governance-bridge MCP process queues into the same directory.
    const mcpSide = build({ outboxDir, fetchImpl: fetchDouble(new Error('forum down')) });
    await mcpSide.post({ response_event_id: RESPONSE_ID, stage: 'applied-manually',
      executed_by: 'did:nostr:' + 'c'.repeat(64), evidence: 'ran the migration by hand' });
    expect(fs.readdirSync(outboxDir)).toHaveLength(1);

    const ok = fetchDouble({ status: 202 });
    const { publisher, initialFlush } = bootReceiptPublisher(bootDeps(outboxDir, ok), { intervalMs: 3_600_000 });
    try {
      await expect(initialFlush).resolves.toMatchObject({ attempted: 1, posted: 1 });
      expect(JSON.parse(ok.calls[0].init.body)).toMatchObject({
        stage: 'applied-manually', executed_by: 'did:nostr:' + 'c'.repeat(64),
      });
      expect(fs.readdirSync(outboxDir)).toHaveLength(0);
    } finally {
      publisher.stop();
    }
  });

  test('keeps replaying on a timer until the forum answers', async () => {
    jest.useFakeTimers();
    const outboxDir = tmpOutbox();
    const fetchImpl = fetchDouble([new Error('down'), new Error('down'), { status: 202 }]);
    const { publisher, initialFlush } = bootReceiptPublisher(bootDeps(outboxDir, fetchImpl), { intervalMs: 1000 });
    try {
      await initialFlush; // nothing queued yet
      await publisher.post({ response_event_id: RESPONSE_ID, stage: 'not-applied' }); // 1st call: down
      expect(fs.readdirSync(outboxDir)).toHaveLength(1);

      await jest.advanceTimersByTimeAsync(1000); // 2nd call: down
      expect(fs.readdirSync(outboxDir)).toHaveLength(1);
      await jest.advanceTimersByTimeAsync(1000); // 3rd call: 202
      expect(fs.readdirSync(outboxDir)).toHaveLength(0);
      expect(fetchImpl.calls).toHaveLength(3);
    } finally {
      publisher.stop();
      jest.useRealTimers();
    }
  });

  test('a boot flush that throws is logged, never fatal, and the timer still runs', async () => {
    const errors = [];
    const outboxDir = tmpOutbox();
    fs.writeFileSync(path.join(outboxDir, 'x.json'), '{}');
    const { publisher, initialFlush } = bootReceiptPublisher(
      bootDeps(outboxDir, fetchDouble({ status: 202 }), {
        logger: { ...quiet, error: (o) => errors.push(o) },
      }),
      { intervalMs: 3_600_000, flushImpl: async () => { throw new Error('disk on fire'); } },
    );
    try {
      await expect(initialFlush).resolves.toMatchObject({ error: 'disk on fire' });
      expect(errors.some((o) => o && o.event === 'governance.receipt-replay-failed')).toBe(true);
      expect(publisher.running()).toBe(true);
    } finally {
      publisher.stop();
      expect(publisher.running()).toBe(false);
    }
  });

  test('a slow replay is never overlapped by the next tick', async () => {
    jest.useFakeTimers();
    let calls = 0;
    let release;
    const slow = () => { calls += 1; return new Promise((r) => { release = r; }); };
    const { publisher, initialFlush } = bootReceiptPublisher(
      bootDeps(tmpOutbox(), fetchDouble({ status: 202 })), { intervalMs: 1000, flushImpl: slow });
    try {
      await jest.advanceTimersByTimeAsync(3000); // three ticks while the boot flush hangs
      expect(calls).toBe(1);
      release({ attempted: 0 });
      await initialFlush;
      await jest.advanceTimersByTimeAsync(1000);
      expect(calls).toBe(2);
    } finally {
      publisher.stop();
      jest.useRealTimers();
    }
  });

  test('reports at boot whether a forum is configured', () => {
    const infos = [];
    const logger = { ...quiet, info: (o) => infos.push(o) };
    const { publisher } = bootReceiptPublisher(
      bootDeps(tmpOutbox(), fetchDouble({ status: 202 }), { manifest: {}, logger }), { intervalMs: 3_600_000 });
    publisher.stop();
    const boot = infos.find((o) => o && o.event === 'governance.receipt-replay.boot');
    expect(boot).toMatchObject({ configured: false });
  });
});

// The defect this guards was a missing CALL, not a wrong function: every unit
// above passed while production never replayed. server.js boots too much
// (relay, pods, adapters) to start under Jest, so the wiring is pinned at source.
describe('server.js wires the replay loop', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../management-api/server.js'), 'utf8');

  test('boots one publisher over the authority journal and shares it', () => {
    expect(src).toMatch(/bootReceiptPublisher\(\s*\{[^}]*journal:\s*authorityDenyJournal/);
    expect(src).toMatch(/app\.decorate\('governanceReceiptPublisher',/);
  });

  test('stops the replay timer on close', () => {
    expect(src).toMatch(/addHook\('onClose'[^\n]*\n?[^\n]*receiptPublisher\.stop\(\)/);
  });
});

// ADR-2087 goes `live` when "a receipt posts". The forum's receipt read is
// admin-NIP-98 only, so the activation check reads this line from the
// management-api log: it must be emitted at a level production actually logs.
describe('a delivered receipt leaves an info-level record', () => {
  test('governance.receipt-posted is logged at info with the stage and response id', async () => {
    const infos = [];
    const publisher = build({
      fetchImpl: fetchDouble({ status: 202 }),
      overrides: { logger: { debug() {}, info: (o) => infos.push(o), warn() {}, error() {} } },
    });
    await publisher.post({ response_event_id: RESPONSE_ID, stage: 'consumer-received' });
    expect(infos).toContainEqual(expect.objectContaining({
      event: 'governance.receipt-posted', stage: 'consumer-received', response_event_id: RESPONSE_ID, status: 202,
    }));
  });

  test('a replayed delivery is logged the same way', async () => {
    const outboxDir = tmpOutbox();
    await build({ outboxDir, fetchImpl: fetchDouble(new Error('down')) })
      .post({ response_event_id: RESPONSE_ID, stage: 'applied', acknowledgement: { writeback_committed: true } });
    const infos = [];
    const retrier = build({ outboxDir, fetchImpl: fetchDouble({ status: 200 }),
      overrides: { logger: { debug() {}, info: (o) => infos.push(o), warn() {}, error() {} } } });
    await retrier.flush();
    expect(infos).toContainEqual(expect.objectContaining({
      event: 'governance.receipt-posted', stage: 'applied', replay: true,
    }));
  });
});
