'use strict';

/**
 * ADR-2071 Phase 1 — POST /v1/exec/record route contract.
 *
 * The route is the only way an out-of-process harness (the dream engine) may
 * write the execution journal, because the management API must stay the single
 * writer of the hash-chained events log. These tests wire the route to a REAL
 * LocalJsonlEventsAdapter on a scratch directory (disk, not an appendFn), then
 * verify the resulting files with the same audit-chain verifier that backs
 * GET /v1/system/audit-chain — acceptance clause (a), single-writer intact.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const Fastify = require('../../management-api/node_modules/fastify');
const execRecordRoutes = require('../../management-api/routes/exec-record');
const { LocalJsonlEventsAdapter } = require('../../management-api/adapters/events/local-jsonl');
const { ExecutionJournal } = require('../../management-api/lib/execution-journal');
const auditChain = require('../../management-api/lib/audit-chain');

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

function readEvents(dir) {
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort()
    .flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean))
    .map((l) => JSON.parse(l));
}

describe('POST /v1/exec/record (ADR-2071 Phase 1)', () => {
  let app;
  let eventsDir;

  async function build(plane) {
    const a = Fastify({ logger: false });
    await a.register(execRecordRoutes, { logger: silentLogger, getPlane: () => plane });
    await a.ready();
    return a;
  }

  beforeEach(async () => {
    eventsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-record-'));
    const journal = new ExecutionJournal({ eventsAdapter: new LocalJsonlEventsAdapter({ eventsDir }) });
    app = await build({ ready: true, reason: null, journal });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(eventsDir, { recursive: true, force: true });
  });

  const post = (body) => app.inject({ method: 'POST', url: '/v1/exec/record', payload: body });

  test('a called/completed pair lands under one session with contiguous seqs', async () => {
    const base = { session: '2026-09-30-VisionFlow-1759200000', harness: 'dream-engine', turn: 0 };
    const called = await post({ ...base, type: 'tool.called', step: 1, key: 'step-1-called',
      payload: { tool: 'annexe.ssh', op: 'retention-sweep' } });
    expect(called.statusCode).toBe(201);
    const c = called.json();
    expect(c.seq).toBe(0);
    expect(c.session_urn).toBe('urn:agentbox:meta:session-dream-engine-2026-09-30-VisionFlow-1759200000');

    const done = await post({ ...base, type: 'tool.completed', step: 1, key: 'step-1-completed',
      causation: c.event_id, payload: { tool: 'annexe.ssh', ok: true } });
    expect(done.statusCode).toBe(201);
    expect(done.json().seq).toBe(1);

    const rows = readEvents(eventsDir);
    expect(rows.map((r) => r.kind)).toEqual(['exec.tool.called', 'exec.tool.completed']);
    expect(rows.every((r) => r.payload.session_urn === c.session_urn)).toBe(true);
    expect(rows[1].payload.causation).toBe(c.event_id);
    expect(rows[0].payload.harness).toBe('dream-engine');
  });

  test('the events log verifies intact after many writes (single writer)', async () => {
    for (let i = 0; i < 12; i++) {
      const r = await post({ session: 'chain', harness: 'dream-engine', type: i % 2 ? 'tool.completed' : 'tool.called',
        step: Math.floor(i / 2), payload: { i } });
      expect(r.statusCode).toBe(201);
    }
    const files = fs.readdirSync(eventsDir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(eventsDir, f));
    const result = auditChain.verifyFiles(files);
    expect(result.ok).toBe(true);
  });

  test('a retried key is idempotent: same event, nothing appended', async () => {
    const body = { session: 's1', harness: 'dream-engine', type: 'tool.called', key: 'k-1', payload: {} };
    const first = (await post(body)).json();
    const again = (await post(body)).json();
    expect(again.duplicate).toBe(true);
    expect(again.event_id).toBe(first.event_id);
    expect(readEvents(eventsDir)).toHaveLength(1);
  });

  test('model-visibility types are refused (ADR-057 D2 stays internal)', async () => {
    for (const type of ['model.requested', 'assistant.completed', 'input.claimed']) {
      const r = await post({ session: 's', harness: 'dream-engine', type });
      expect(r.statusCode).toBe(400);
    }
    expect(readEvents(eventsDir)).toHaveLength(0);
  });

  test('malformed session or harness is refused before the journal', async () => {
    expect((await post({ session: 'a:b', harness: 'dream-engine', type: 'tool.called' })).statusCode).toBe(400);
    expect((await post({ session: 'ok', harness: 'Dream Engine', type: 'tool.called' })).statusCode).toBe(400);
    expect(readEvents(eventsDir)).toHaveLength(0);
    // Fastify's validator strips unknown top-level properties (removeAdditional)
    // rather than rejecting them; what matters is that they never reach the log.
    expect((await post({ session: 'ok', harness: 'dream-engine', type: 'tool.called', extra: 'x' })).statusCode).toBe(201);
    expect(JSON.stringify(readEvents(eventsDir))).not.toMatch(/"extra"/);
  });

  test('no live events adapter → 503, nothing recorded', async () => {
    const down = await build({ ready: false, reason: 'events adapter is not live (impl=off)', journal: null });
    const r = await down.inject({ method: 'POST', url: '/v1/exec/record',
      payload: { session: 's', harness: 'dream-engine', type: 'tool.called' } });
    expect(r.statusCode).toBe(503);
    expect(r.json().details).toMatch(/impl=off/);
    await down.close();
  });
});
