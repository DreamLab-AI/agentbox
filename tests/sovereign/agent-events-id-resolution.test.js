'use strict';

/**
 * REC-9 (PRD-019 §REC-9 / ADR-037 D5) — GET /v1/agent-events honours ?id=<urn>.
 *
 * The provenance resolver 307-redirects /v1/uri/<urn> → /v1/agent-events?id=<urn>
 * (uri-resolver.js, activity/event kind). Before this fix the route IGNORED the
 * id query parameter and returned an arbitrary recent-events window, so a
 * mirrored turn's urn:agentbox:activity reference resolved to nothing — the
 * item's own falsification clause ("does not resolve to a real execution/action
 * receipt") held empirically. These cases lock:
 *
 *   1. a stored event carrying a known urn is returned for ?id=<urn>, urn intact
 *      (the provenance field survives serialization, not a stripped stub);
 *   2. an unknown urn/id → 404 with a clear body (honest miss, never a window);
 *   3. no id → the original recent-events window (regression lock);
 *   4. a bare numeric event id resolves the same envelope.
 *
 * The real agent-event-publisher singleton runs (NOT mocked); the route reads
 * the same in-memory event store it always has.
 */

const Fastify = require('../../management-api/node_modules/fastify');
const agentEventsRoutes = require('../../management-api/routes/agent-events');
const { agentEventPublisher } = require('../../management-api/utils/agent-event-publisher');

async function makeApp() {
  const app = Fastify({ logger: false });
  await app.register(agentEventsRoutes, {
    logger: { info() {}, debug() {}, warn() {}, error() {} },
    metrics: {},
  });
  await app.ready();
  return app;
}

const KNOWN_URN = `urn:agentbox:activity:${'a'.repeat(64)}:sha256-12-cafebabe0011`;

describe('REC-9 — GET /v1/agent-events resolves ?id=<urn> to its own record', () => {
  let app;
  beforeAll(async () => { app = await makeApp(); });
  afterAll(async () => { await app.close(); });

  test('FALSIFICATION 2: a stored event with a known urn is returned for ?id=<urn>, urn intact', async () => {
    const emitted = agentEventPublisher.emitAgentAction({
      source_agent_id: 101, target_node_id: 202, action_type: 'query',
      source_urn: KNOWN_URN, metadata: { note: 'rec9-known' },
    });

    const res = await app.inject({
      method: 'GET', url: `/v1/agent-events?id=${encodeURIComponent(KNOWN_URN)}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(1);
    expect(body.id).toBe(KNOWN_URN);
    expect(body.events).toHaveLength(1);
    expect(body.events[0].id).toBe(emitted.id);
    // The provenance field survives the response serializer — the reference
    // resolves to the very record that carries it, not a stripped stub.
    expect(body.events[0].source_urn).toBe(KNOWN_URN);
    expect(body.events[0].action_type_name).toBe('query');
  });

  test('FALSIFICATION 2 (miss): an unknown urn → 404 with a clear body, never a window', async () => {
    const missing = `urn:agentbox:activity:${'b'.repeat(64)}:sha256-12-000000000000`;
    const res = await app.inject({
      method: 'GET', url: `/v1/agent-events?id=${encodeURIComponent(missing)}`,
    });

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.error).toBe('not-found');
    expect(body.id).toBe(missing);
    expect(body.count).toBe(0);
    expect(body.events).toBeUndefined(); // no recent-events window leaked on a miss
  });

  test('REGRESSION: no id → the recent-events window (original behaviour, id echoes null)', async () => {
    agentEventPublisher.emitAgentAction({ source_agent_id: 1, target_node_id: 2, action_type: 'update' });
    agentEventPublisher.emitAgentAction({ source_agent_id: 3, target_node_id: 4, action_type: 'create' });

    const res = await app.inject({ method: 'GET', url: '/v1/agent-events?limit=50' });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.count).toBe(body.events.length);
    expect(body.count).toBeGreaterThanOrEqual(2); // a window, not a single record
    expect(body.id).toBeNull();
  });

  test('a bare numeric event id resolves the same envelope', async () => {
    const emitted = agentEventPublisher.emitAgentAction({
      source_agent_id: 55, target_node_id: 66, action_type: 'link',
      metadata: { note: 'rec9-numeric' },
    });

    const res = await app.inject({ method: 'GET', url: `/v1/agent-events?id=${emitted.id}` });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(1);
    expect(body.id).toBe(String(emitted.id));
    expect(body.events[0].id).toBe(emitted.id);
    expect(body.events[0].source_agent_id).toBe(55);
  });
});
