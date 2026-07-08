'use strict';

/**
 * REC-3 (PRD-019 / ADR-037) — the CTC emitter WIRE.
 *
 * The prior state: the trajectory-recorder CAPTURED a step's token_count and the
 * chain handoff_id, but NO code path forwarded them into a real emitAgentAction
 * call, so the agent-events envelope never carried them and `CANARY-AB-CTC` could
 * not fire even live. These tests lock the forwarding path end to end:
 *
 *   1. the pure mapper `trajectory-util.ctcEmitBodyFromStep` turns a captured step
 *      into the emit body carrying token_count + handoff_id (null when no signal);
 *   2. that body, POSTed to the real POST /v1/agent-events/emit route, produces an
 *      agent-events envelope (what VisionClaw's LivenessHarness observes) that
 *      CARRIES token_count and handoff_id — the wire the defect said was dead.
 */

const util = require('../../config/hooks/lib/trajectory-util.cjs');
const { agentEventPublisher } = require('../../management-api/utils/agent-event-publisher');
const Fastify = require('../../management-api/node_modules/fastify');
const agentEventsRoutes = require('../../management-api/routes/agent-events');

describe('REC-3 — ctcEmitBodyFromStep (the deterministic core of the forwarding path)', () => {
  test('maps a step bearing a token burden + chain id into an emit body', () => {
    const step = {
      action: 'git commit [args:0 flags:1]',
      outcome: { success: true, quality: 1 },
      durationMs: 42,
      tokenCount: 1234,
    };
    const body = util.ctcEmitBodyFromStep(step, { handoffId: 'urn:agentbox:activity:chain-7', sessionId: 'sess-1' });
    expect(body).not.toBeNull();
    expect(body.token_count).toBe(1234);
    expect(body.handoff_id).toBe('urn:agentbox:activity:chain-7');
    expect(body.action_type).toBe(5); // TRANSFORM
    expect(typeof body.source_agent_id).toBe('string');
    expect(body.metadata.outcome).toBe('success');
  });

  test('a step with NO CTC signal (no token burden, no chain id) maps to null — byte-compatible', () => {
    const step = { action: 'ls', outcome: { success: true }, tokenCount: null };
    expect(util.ctcEmitBodyFromStep(step, {})).toBeNull();
  });

  test('a chain id alone still emits (a single-agent chain of one is correlatable)', () => {
    const step = { action: 'ls', outcome: { success: true }, tokenCount: null };
    const body = util.ctcEmitBodyFromStep(step, { handoffId: 'urn:agentbox:trajectory:abc', sessionId: 's' });
    expect(body).not.toBeNull();
    expect(body.handoff_id).toBe('urn:agentbox:trajectory:abc');
    expect(body.token_count).toBeUndefined();
  });
});

describe('REC-3 — END TO END: a trajectory step reaches the agent-events envelope', () => {
  let app;
  let prevAuth;

  beforeAll(async () => {
    prevAuth = process.env.AGENTBOX_AGENT_EVENT_AUTH;
    process.env.AGENTBOX_AGENT_EVENT_AUTH = 'off'; // default posture: the recorder POSTs unauthenticated
    app = Fastify({ logger: false });
    await app.register(agentEventsRoutes, {
      logger: { info() {}, debug() {}, warn() {}, error() {} },
      metrics: {},
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    if (prevAuth === undefined) delete process.env.AGENTBOX_AGENT_EVENT_AUTH;
    else process.env.AGENTBOX_AGENT_EVENT_AUTH = prevAuth;
  });

  test('the mapped step, POSTed to /v1/agent-events/emit, yields an envelope carrying token_count + handoff_id', async () => {
    const seen = [];
    const unsub = agentEventPublisher.subscribe((ev) => seen.push(ev));

    const step = { action: 'cargo build [args:0 flags:1]', outcome: { success: true }, durationMs: 88, tokenCount: 4096 };
    const body = util.ctcEmitBodyFromStep(step, { handoffId: 'urn:agentbox:activity:dag-42', sessionId: 'sess-e2e' });

    const res = await app.inject({ method: 'POST', url: '/v1/agent-events/emit', payload: body });
    expect(res.statusCode).toBe(200);

    // The publisher-built envelope carries the trajectory step's CTC fields.
    const emitted = seen[seen.length - 1];
    expect(emitted.token_count).toBe(4096);
    expect(emitted.handoff_id).toBe('urn:agentbox:activity:dag-42');

    // ...and so does the on-the-wire MCP notification the LivenessHarness reads.
    const n = agentEventPublisher.createMcpNotification(emitted);
    expect(n.params.event.token_count).toBe(4096);
    expect(n.params.event.handoff_id).toBe('urn:agentbox:activity:dag-42');

    unsub();
  });
});
