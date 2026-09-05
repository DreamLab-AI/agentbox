'use strict';

/**
 * ADR-2026 provenance-consumer closeout (2026-09-05) — durable reference
 * resolution beyond the 1,000-event in-memory window.
 *
 * The estate review's isolated route probe established three facts:
 *   1. a reference minted before any producer record returned 404;
 *   2. after injecting two matching events, only the SECOND was returned —
 *      two decisions sharing a session reference could not both be seen;
 *   3. after 1,000 unrelated events the reference returned 404 again, because
 *      the ring buffer had evicted it and there was no durable-store fallback.
 *
 * (2) and (3) are the closeout conditions. These tests reproduce the eviction
 * precondition, show the archive resolving through it, and cover the restart
 * case — an empty in-memory buffer with the archive intact, which is exactly
 * what a new publisher process presents to the resolver.
 *
 * One app and one archive directory for the whole file: repeatedly resetting the
 * module graph leaves Fastify/WebSocket handles open and hangs the runner.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// The archive directory must be set BEFORE the publisher module is first
// required, because the archive singleton resolves its path at construction.
const ARCHIVE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'adr2026-prov-'));
process.env.AGENTBOX_EVENT_ARCHIVE_DIR = ARCHIVE_DIR;
delete process.env.AGENTBOX_EVENT_ARCHIVE;

const Fastify = require('../../management-api/node_modules/fastify');
const agentEventsRoutes = require('../../management-api/routes/agent-events');
const { agentEventPublisher } = require('../../management-api/utils/agent-event-publisher');
const { AgentEventArchive, agentEventArchive } = require('../../management-api/utils/agent-event-archive');

const SCOPE = 'd'.repeat(64);
const urn = (local) => `urn:agentbox:activity:${SCOPE}:sha256-12-${local}`;

let app;

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(agentEventsRoutes, {
    logger: { info() {}, debug() {}, warn() {}, error() {} },
    metrics: {},
  });
  await app.ready();
});

afterAll(async () => {
  if (app) await app.close();
  fs.rmSync(ARCHIVE_DIR, { recursive: true, force: true });
  delete process.env.AGENTBOX_EVENT_ARCHIVE_DIR;
});

function emit(activityUrn, extra = {}) {
  return agentEventPublisher.emitAgentAction({
    source_agent_id: 1, target_node_id: 2, action_type: 5, duration_ms: 1,
    activity_urn: activityUrn, ...extra,
  });
}

async function resolve(ref) {
  const res = await app.inject({ method: 'GET', url: `/v1/agent-events?id=${encodeURIComponent(ref)}` });
  return { code: res.statusCode, body: JSON.parse(res.body) };
}

describe('ADR-2026 — a mirrored reference survives ring-buffer eviction', () => {
  test('the archive is active, so an evicted reference is still resolvable', () => {
    expect(agentEventArchive.enabled).toBe(true);
    expect(agentEventArchive.status().dir).toBe(ARCHIVE_DIR);
  });

  test('MULTIPLE decisions under one session reference return the ORDERED history', async () => {
    const ref = urn('history00001');
    emit(ref, { metadata: { decision: 'first' } });
    emit(ref, { metadata: { decision: 'second' } });
    emit(ref, { metadata: { decision: 'third' } });

    const r = await resolve(ref);
    expect(r.code).toBe(200);
    // The review's finding was that only the newest was returned, silently
    // substituting one decision for another.
    expect(r.body.count).toBe(3);
    expect(r.body.events.map((e) => e.metadata.decision)).toEqual(['first', 'second', 'third']);
    expect(r.body.history_complete).toBe(true);
  });

  test('the reproduced case: an evicted reference no longer 404s', async () => {
    const ref = urn('evicted00001');
    emit(ref, { metadata: { decision: 'the escalation' } });

    // Overflow the ring buffer exactly as the review's probe did.
    const cap = agentEventPublisher.maxBufferSize || 1000;
    for (let i = 0; i < cap + 5; i++) emit(urn(`noise${String(i).padStart(7, '0')}`));

    // Precondition: the in-memory buffer has genuinely evicted it.
    const inMem = agentEventPublisher.getRecentEvents(cap).filter((e) => e.activity_urn === ref);
    expect(inMem.length).toBe(0);

    const r = await resolve(ref);
    expect(r.code).toBe(200);
    expect(r.body.source).toMatch(/archive/);
    expect(r.body.history_complete).toBe(true);
    expect(r.body.events[0].metadata.decision).toBe('the escalation');
  }, 60000);

  test('the RESTART case: an empty in-memory buffer still resolves from the archive', async () => {
    const ref = urn('restart00001');
    emit(ref, { metadata: { decision: 'before-restart' } });

    // A new publisher process presents exactly this to the resolver: an empty
    // buffer with the durable archive intact.
    const saved = agentEventPublisher.eventBuffer;
    agentEventPublisher.eventBuffer = [];
    try {
      const r = await resolve(ref);
      expect(r.code).toBe(200);
      expect(r.body.source).toBe('archive');
      expect(r.body.events[0].metadata.decision).toBe('before-restart');
    } finally {
      agentEventPublisher.eventBuffer = saved;
    }
  });

  test('a reference that never existed is an HONEST 404 naming what was searched', async () => {
    const r = await resolve(urn('neverexisted'));
    expect(r.code).toBe(404);
    expect(r.body.reason).toMatch(/durable archive/);
    expect(r.body.source).toBe('memory+archive');
  });

  test('a CTC chain reference now resolves (the lookup matched no chain id before)', async () => {
    agentEventPublisher.emitAgentAction({
      source_agent_id: 1, target_node_id: 2, action_type: 5,
      handoff_id: 'chain-abc-123',
      metadata: { kind: 'trajectory-step' },
    });
    const r = await resolve('chain-abc-123');
    expect(r.code).toBe(200);
    expect(r.body.count).toBeGreaterThanOrEqual(1);
  });
});

describe('ADR-2026 — the archive is bounded, honest and fail-open', () => {
  test('rotation drops the oldest generation rather than growing without bound', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr2026-arch-'));
    try {
      const a = new AgentEventArchive({ dir, maxBytes: 512, generations: 3, enabled: true });
      const ref = urn('rotation0001');
      for (let i = 0; i < 400; i++) a.append({ id: i, activity_urn: ref, padding: 'x'.repeat(64) });
      const st = a.status();
      expect(st.files).toBeLessThanOrEqual(3);
      expect(st.bytes).toBeLessThan(512 * 3 + 4096);
      // It still resolves what it retains, and says it searched.
      const found = a.find((e) => e.activity_urn === ref, 10);
      expect(found.searched).toBe(true);
      expect(found.events.length).toBeGreaterThan(0);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  test('an unwritable directory disables the archive and REPORTS it, never throwing', () => {
    // A regular FILE used as the parent directory: mkdir fails with ENOTDIR
    // immediately. (A path under /proc was the obvious choice, but mkdir blocks
    // there in this container, which would hang the runner rather than test it.)
    const blocker = path.join(ARCHIVE_DIR, 'not-a-directory');
    fs.writeFileSync(blocker, 'x');
    const a = new AgentEventArchive({ dir: path.join(blocker, 'archive'), enabled: true });
    expect(a.append({ id: 1 })).toBe(false);
    expect(a.enabled).toBe(false);
    expect(a.status().last_error).toMatch(/cannot create/);
    // A disabled archive reports that it was NOT searched, so a caller can tell
    // "expired" from "never existed" from "we could not look".
    expect(a.find(() => true).searched).toBe(false);
  });

  test('a disabled archive is explicitly disabled, not silently absent', () => {
    const a = new AgentEventArchive({ dir: ARCHIVE_DIR, enabled: false });
    expect(a.append({ id: 1 })).toBe(false);
    expect(a.find(() => true).error).toMatch(/disabled/);
  });
});
