/**
 * ADR-014 / ADR-059 Phase 2-3 — agent-event-ws-subscriber tests.
 *
 * Uses jest (configured in agentbox/management-api/package.json).
 * Mocks `ws` so we never open a real socket. Inbound payloads are pushed
 * into the simulated socket via `mockWs.emit('message', ...)`.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const EventEmitter = require('events');

// ---------------------------------------------------------------------------
// Mock the `ws` module BEFORE requiring the subject under test.
// ---------------------------------------------------------------------------

class MockWebSocket extends EventEmitter {
  constructor(url, protocols) {
    super();
    this.url = url;
    this.protocols = protocols;
    this.protocol = Array.isArray(protocols) ? protocols[0] : protocols;
    this.sent = [];
    MockWebSocket.instances.push(this);
    // Defer 'open' until next tick so callers can attach listeners.
    setImmediate(() => this.emit('open'));
  }
  send(data) {
    this.sent.push(data);
  }
  close() {
    this.emit('close');
  }
}
MockWebSocket.instances = [];

jest.mock('ws', () => MockWebSocket);

const {
  AgentEventWsSubscriber,
  SUBPROTOCOL,
} = require('../utils/agent-event-ws-subscriber');
const { agentEventPublisher } = require('../utils/agent-event-publisher');

// Silence the subscriber's logger in tests.
const silentLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

beforeEach(() => {
  MockWebSocket.instances = [];
  // Strip publisher subscribers carried over from prior tests.
  agentEventPublisher.removeAllListeners();
  agentEventPublisher.subscribers = new Set();
});

// ---------------------------------------------------------------------------
// 1. No-op when AGENTBOX_HOST_WS_URL unset
// ---------------------------------------------------------------------------

describe('AgentEventWsSubscriber.start', () => {
  test('is a no-op when no URL is configured', async () => {
    const prev = process.env.AGENTBOX_HOST_WS_URL;
    delete process.env.AGENTBOX_HOST_WS_URL;

    const sub = new AgentEventWsSubscriber({ logger: silentLogger });
    await sub.start();
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(sub.connected).toBe(false);

    if (prev !== undefined) process.env.AGENTBOX_HOST_WS_URL = prev;
  });

  test('connects with the canonical subprotocol when URL is set', async () => {
    const sub = new AgentEventWsSubscriber({
      url: 'ws://localhost:9999/wss/agent-events',
      logger: silentLogger,
      persistInbound: false,
    });
    await sub.start();
    // Allow the deferred 'open' to fire.
    await new Promise((r) => setImmediate(r));

    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0];
    expect(ws.protocols).toEqual([SUBPROTOCOL]);
    expect(sub.connected).toBe(true);
    sub.stop();
  });
});

// ---------------------------------------------------------------------------
// 2. Reconnect backoff (exponential + cap)
// ---------------------------------------------------------------------------

describe('AgentEventWsSubscriber reconnect backoff', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('schedules exponential reconnect with a 30s ceiling', async () => {
    const sub = new AgentEventWsSubscriber({
      url: 'ws://localhost:9999/wss/agent-events',
      logger: silentLogger,
      persistInbound: false,
    });
    await sub.start();
    // Flush microtasks so the initial socket exists.
    await Promise.resolve();
    jest.runOnlyPendingTimers(); // fires the deferred 'open'

    // Force a close to schedule reconnect attempt 1 (~2000 ms).
    MockWebSocket.instances[0].emit('close');
    expect(sub.reconnectAttempt).toBe(1);

    // Drain the timer queue, observe new instance is created on next tick.
    jest.advanceTimersByTime(2_500);
    await Promise.resolve();
    jest.runOnlyPendingTimers(); // 'open' for instance 2
    expect(MockWebSocket.instances.length).toBeGreaterThanOrEqual(2);

    // Close again, attempt 2 → ~4000 ms.
    MockWebSocket.instances[1].emit('close');
    expect(sub.reconnectAttempt).toBe(2);

    // Many failures in a row should clamp to 30s.
    for (let i = 0; i < 10; i++) {
      jest.advanceTimersByTime(35_000);
      await Promise.resolve();
      jest.runOnlyPendingTimers();
      const lastIdx = MockWebSocket.instances.length - 1;
      if (MockWebSocket.instances[lastIdx]) {
        MockWebSocket.instances[lastIdx].emit('close');
      }
    }
    expect(sub.reconnectAttempt).toBeGreaterThan(2);

    sub.stop();
  });
});

// ---------------------------------------------------------------------------
// 3. Inbound user_interaction → JSONL persistence
// ---------------------------------------------------------------------------

describe('AgentEventWsSubscriber JSONL persistence', () => {
  test('appends inbound user_interaction events to the JSONL file', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-events-jsonl-'));
    const jsonlPath = path.join(tmpDir, 'inbound.jsonl');

    const sub = new AgentEventWsSubscriber({
      url: 'ws://localhost:9999/wss/agent-events',
      logger: silentLogger,
      jsonlPath,
      persistInbound: true,
    });
    await sub.start();
    await new Promise((r) => setImmediate(r));

    const ws = MockWebSocket.instances[0];
    const event = {
      version: 1,
      type: 'user_interaction',
      kind: 'focus',
      session_id: 'sess-1',
      target_node_id: 4242,
      duration_ms: 1500,
      timestamp: 1714312345678,
    };
    ws.emit('message', JSON.stringify(event));

    // Persistence is synchronous (appendFileSync), so the file is ready now.
    const lines = fs.readFileSync(jsonlPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const persisted = JSON.parse(lines[0]);
    expect(persisted.kind).toBe('focus');
    expect(persisted.direction).toBe('inbound');
    expect(persisted.target_node_id).toBe(4242);

    sub.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('skips persistence when persistInbound is false', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-events-jsonl-'));
    const jsonlPath = path.join(tmpDir, 'inbound.jsonl');

    const sub = new AgentEventWsSubscriber({
      url: 'ws://localhost:9999/wss/agent-events',
      logger: silentLogger,
      jsonlPath,
      persistInbound: false,
    });
    await sub.start();
    await new Promise((r) => setImmediate(r));

    MockWebSocket.instances[0].emit(
      'message',
      JSON.stringify({ type: 'user_interaction', kind: 'focus' })
    );
    expect(fs.existsSync(jsonlPath)).toBe(false);

    sub.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// 4. subscribeInbound filter spec — kind / target_urn_prefix / session_pubkey
// ---------------------------------------------------------------------------

describe('AgentEventWsSubscriber.subscribeInbound', () => {
  test('filters by kind', () => {
    const seen = [];
    const off = AgentEventWsSubscriber.subscribeInbound(
      { kind: 'focus' },
      (e) => seen.push(e)
    );

    agentEventPublisher.subscribers.forEach((cb) =>
      cb({ direction: 'inbound', kind: 'focus', target_urn: 'urn:x' })
    );
    agentEventPublisher.subscribers.forEach((cb) =>
      cb({ direction: 'inbound', kind: 'hover', target_urn: 'urn:x' })
    );
    expect(seen.map((e) => e.kind)).toEqual(['focus']);
    off();
  });

  test('filters by target_urn_prefix', () => {
    const seen = [];
    AgentEventWsSubscriber.subscribeInbound(
      { target_urn_prefix: 'urn:visionclaw:kg:' },
      (e) => seen.push(e)
    );
    agentEventPublisher.subscribers.forEach((cb) =>
      cb({ direction: 'inbound', kind: 'focus', target_urn: 'urn:visionclaw:kg:npub1xyz:abc' })
    );
    agentEventPublisher.subscribers.forEach((cb) =>
      cb({ direction: 'inbound', kind: 'focus', target_urn: 'urn:agentbox:bead:scope:hash' })
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].target_urn).toMatch(/^urn:visionclaw:kg:/);
  });

  test('filters by session_pubkey', () => {
    const seen = [];
    AgentEventWsSubscriber.subscribeInbound(
      { session_pubkey: 'pk-alice' },
      (e) => seen.push(e)
    );
    agentEventPublisher.subscribers.forEach((cb) =>
      cb({ direction: 'inbound', session_pubkey: 'pk-alice' })
    );
    agentEventPublisher.subscribers.forEach((cb) =>
      cb({ direction: 'inbound', session_pubkey: 'pk-bob' })
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].session_pubkey).toBe('pk-alice');
  });

  test('drops outbound events even with matching filter', () => {
    const seen = [];
    AgentEventWsSubscriber.subscribeInbound({ kind: 'focus' }, (e) => seen.push(e));
    agentEventPublisher.subscribers.forEach((cb) =>
      cb({ direction: 'outbound', kind: 'focus' })
    );
    expect(seen).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Outbound forwarding from publisher → ws.send
// ---------------------------------------------------------------------------

describe('AgentEventWsSubscriber outbound forwarding', () => {
  test('emitAgentAction → ws.send when connected', async () => {
    const sub = new AgentEventWsSubscriber({
      url: 'ws://localhost:9999/wss/agent-events',
      logger: silentLogger,
      persistInbound: false,
    });
    await sub.start();
    await new Promise((r) => setImmediate(r));

    const evt = agentEventPublisher.emitAgentAction({
      source_agent_id: 1,
      target_node_id: 2,
      action_type: 0,
      duration_ms: 100,
    });

    const ws = MockWebSocket.instances[0];
    expect(ws.sent).toHaveLength(1);
    const sent = JSON.parse(ws.sent[0]);
    expect(sent.type).toBe('agent_action');
    expect(sent.version).toBe(3);
    expect(sent.direction).toBe('outbound');
    expect(sent.id).toBe(evt.id);

    sub.stop();
  });

  test('inbound-tagged events are NOT echoed back over WS', async () => {
    const sub = new AgentEventWsSubscriber({
      url: 'ws://localhost:9999/wss/agent-events',
      logger: silentLogger,
      persistInbound: false,
    });
    await sub.start();
    await new Promise((r) => setImmediate(r));

    // Simulate an inbound event arriving and being re-published.
    const ws = MockWebSocket.instances[0];
    ws.emit(
      'message',
      JSON.stringify({ type: 'user_interaction', kind: 'focus', session_id: 's' })
    );

    // ws.sent should remain empty — inbound events do NOT echo.
    expect(ws.sent).toHaveLength(0);

    sub.stop();
  });

  test('forwarding silently drops when not connected', async () => {
    const sub = new AgentEventWsSubscriber({
      url: 'ws://localhost:9999/wss/agent-events',
      logger: silentLogger,
      persistInbound: false,
    });
    await sub.start();
    await new Promise((r) => setImmediate(r));
    // Simulate disconnect.
    MockWebSocket.instances[0].emit('close');
    expect(sub.connected).toBe(false);

    // Emit while disconnected — must not throw.
    expect(() =>
      agentEventPublisher.emitAgentAction({
        source_agent_id: 1,
        target_node_id: 2,
        action_type: 0,
        duration_ms: 100,
      })
    ).not.toThrow();

    sub.stop();
  });
});
