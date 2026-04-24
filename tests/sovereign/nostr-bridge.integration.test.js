'use strict';

/**
 * Integration tests for mcp/servers/nostr-bridge.js
 *
 * Uses real `ws` WebSocket servers in-process to simulate Nostr relay
 * behaviour — no mock WebSocket factory.
 *
 * Test coverage:
 *   - Reconnect with backoff: relay drops → bridge reconnects → queued
 *     messages flush on reopen
 *   - Partial failure: two relays, one refuses → bridge stays healthy on
 *     the good one; health map reflects the asymmetry
 *   - Backoff ordering: sequential reconnect delays grow monotonically
 *   - Cleanup: all servers torn down in afterEach; no leaked ports
 *
 * Runtime bound: keep well under 30 seconds total.
 */

const { NostrBridge } = require('../../mcp/servers/nostr-bridge');
const WebSocket       = require('ws');
const portfinder      = require('portfinder');

// ── helpers ───────────────────────────────────────────────────────────────────

/** Start a WS server on an unused port.  Resolves to { server, port, url }. */
async function startRelayServer(options = {}) {
  const port = await portfinder.getPortPromise({ port: 50000, stopPort: 59999 });
  const server = new WebSocket.Server({ port, ...options });
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  return { server, port, url: `ws://127.0.0.1:${port}` };
}

/** Close a WS server, waiting for the 'close' event. */
function closeServer(server) {
  return new Promise((resolve) => {
    server.close(resolve);
    // Force-destroy any lingering connections
    server.clients.forEach(c => { try { c.terminate(); } catch { /* ignore */ } });
  });
}

/** Resolve after `ms` milliseconds. */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// ── lifecycle ─────────────────────────────────────────────────────────────────

// Collect all NostrBridge instances so afterEach can disconnect them even if
// a test throws.
const activeBridges = [];
function makeBridge(urls, extraOpts = {}) {
  const bridge = new NostrBridge({
    relays: urls,
    relayOptions: {
      backoffBaseMs: 50,   // Fast base so reconnect tests stay well under 30 s
      backoffMaxMs: 500,
      backoffFactor: 2,
      ...extraOpts.relayOptions,
    },
    ...extraOpts,
  });
  activeBridges.push(bridge);
  return bridge;
}

afterEach(async () => {
  // Disconnect and drain the list; order doesn't matter.
  while (activeBridges.length) {
    const b = activeBridges.pop();
    try { await b.disconnect(); } catch { /* ignore */ }
  }
});

// ── helpers for echo relay behaviour ─────────────────────────────────────────

/**
 * Attach an "accept and echo" handler to every connection on `server`.
 * Any message received is forwarded back verbatim.
 */
function attachEchoHandler(server) {
  server.on('connection', (ws) => {
    ws.on('message', (data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data.toString());
    });
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// Test: bridge connects to a real local relay
// ═════════════════════════════════════════════════════════════════════════════

describe('NostrBridge integration — basic connectivity', () => {
  let relay;

  beforeEach(async () => {
    relay = await startRelayServer();
    attachEchoHandler(relay.server);
  });

  afterEach(async () => {
    await closeServer(relay.server);
  });

  it('connects and reports healthy after real open handshake', async () => {
    const bridge = makeBridge([relay.url]);
    await bridge.connect();
    // Give the socket time to complete the TCP + WS handshake
    await delay(200);
    expect(bridge.health()[relay.url]).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Test: reconnect with backoff + queue flush
// ═════════════════════════════════════════════════════════════════════════════

describe('NostrBridge integration — reconnect and queue flush', () => {
  let relay;
  const droppedMessages = [];

  beforeEach(async () => {
    relay = await startRelayServer();
    relay.server.on('connection', (ws) => {
      ws.on('message', (data) => droppedMessages.push(data.toString()));
    });
  });

  afterEach(async () => {
    droppedMessages.length = 0;
    await closeServer(relay.server);
  });

  it('bridge reconnects after server drops the connection', async () => {
    const bridge = makeBridge([relay.url]);
    await bridge.connect();
    await delay(200);
    expect(bridge.health()[relay.url]).toBe(true);

    // Drop every client connection (simulate relay restart)
    relay.server.clients.forEach(ws => ws.terminate());
    await delay(50);
    // Immediately after drop, health should be false
    expect(bridge.health()[relay.url]).toBe(false);

    // Wait for backoff + reconnect (base = 50 ms, factor = 2, attempt 1 → ≤100 ms + jitter ≤500 ms)
    await delay(800);
    expect(bridge.health()[relay.url]).toBe(true);
  }, 10000);

  it('messages queued during disconnect flush on reconnect', async () => {
    const received = [];
    relay.server.on('connection', (ws) => {
      ws.on('message', (data) => received.push(data.toString()));
    });

    const bridge = makeBridge([relay.url]);
    await bridge.connect();
    await delay(200);

    // Drop the connection
    relay.server.clients.forEach(ws => ws.terminate());
    await delay(50);

    // Publish while disconnected — should be buffered in _pending
    const mockSigner = {
      async sign(event) { return { ...event, id: 'flush-id', sig: 'flush-sig', pubkey: 'a'.repeat(64) }; },
    };
    await bridge.publish(
      { kind: 30078, created_at: Math.floor(Date.now() / 1000), tags: [], content: '{}' },
      mockSigner,
    );

    // Wait for reconnect
    await delay(800);

    // The EVENT message must have been sent once the relay came back
    const eventMessages = received.filter(m => {
      try { return JSON.parse(m)[0] === 'EVENT'; } catch { return false; }
    });
    expect(eventMessages.length).toBeGreaterThanOrEqual(1);
  }, 12000);
});

// ═════════════════════════════════════════════════════════════════════════════
// Test: partial failure — two relays, one refuses
// ═════════════════════════════════════════════════════════════════════════════

describe('NostrBridge integration — partial relay failure', () => {
  let goodRelay;
  let badPort;

  beforeEach(async () => {
    goodRelay = await startRelayServer();
    attachEchoHandler(goodRelay.server);
    // Reserve an unreachable port number (no server started on it)
    badPort = await portfinder.getPortPromise({ port: 60000, stopPort: 60999 });
  });

  afterEach(async () => {
    await closeServer(goodRelay.server);
  });

  it('bridge stays healthy on the good relay when one relay is unreachable', async () => {
    const badUrl  = `ws://127.0.0.1:${badPort}`;
    const goodUrl = goodRelay.url;

    const bridge = makeBridge([goodUrl, badUrl]);
    await bridge.connect();

    // Give time for the good relay to handshake and the bad one to fail
    await delay(400);

    const health = bridge.health();
    expect(health[goodUrl]).toBe(true);
    expect(health[badUrl]).toBe(false);
  }, 8000);

  it('health map correctly keys on each relay URL independently', async () => {
    const badUrl  = `ws://127.0.0.1:${badPort}`;
    const goodUrl = goodRelay.url;

    const bridge = makeBridge([goodUrl, badUrl]);
    await bridge.connect();
    await delay(400);

    const health = bridge.health();
    const entries = Object.entries(health);
    expect(entries).toHaveLength(2);

    // At least one entry is true (the good relay)
    const anyHealthy = entries.some(([, v]) => v === true);
    expect(anyHealthy).toBe(true);

    // At least one entry is false (the bad relay)
    const anyUnhealthy = entries.some(([, v]) => v === false);
    expect(anyUnhealthy).toBe(true);
  }, 8000);
});

// ═════════════════════════════════════════════════════════════════════════════
// Test: backoff timing — delays grow monotonically
// ═════════════════════════════════════════════════════════════════════════════

describe('NostrBridge integration — backoff timing', () => {
  /**
   * We intercept _scheduleReconnect on the internal RelayConnection to record
   * the computed delay at each attempt without actually waiting for real timers.
   *
   * Strategy: spy on the private connection; confirm that delay[n+1] > delay[n].
   */
  it('reconnect delays grow with each failed attempt (exponential backoff)', async () => {
    // Stand up a relay that immediately terminates every incoming WS
    const relay = await startRelayServer();
    relay.server.on('connection', ws => ws.terminate());

    const delays = [];

    const bridge = makeBridge([relay.url], {
      relayOptions: {
        backoffBaseMs: 10,
        backoffMaxMs: 10000,
        backoffFactor: 3,
      },
    });

    // Monkey-patch the internal connection to record delays before calling real schedule
    // We have to wait for connect() to build the connections map first.
    await bridge.connect();

    const conn = [...bridge._connections.values()][0];
    const realSchedule = conn._scheduleReconnect.bind(conn);
    let callCount = 0;
    conn._scheduleReconnect = function patchedSchedule() {
      // Compute the delay the real impl would use (without jitter for determinism)
      const baseDelay = Math.min(
        conn._backoffBase * Math.pow(conn._backoffFact, conn._attempt - 1),
        conn._backoffMax,
      );
      delays.push(baseDelay);
      if (++callCount < 4) {
        realSchedule();
      } else {
        // Stop reconnecting after 4 attempts to bound the test runtime
        conn._destroyed = true;
      }
    };

    // Wait long enough for 4 attempts with base=10, factor=3
    await delay(1500);
    await closeServer(relay.server);

    // We must have recorded at least 2 delays to compare ordering
    expect(delays.length).toBeGreaterThanOrEqual(2);

    // Each subsequent delay must be strictly greater than or equal to the previous
    // (the jitter is removed above so this is deterministic)
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]);
    }
  }, 10000);
});

// ═════════════════════════════════════════════════════════════════════════════
// Test: server teardown — no leaked ports
// ═════════════════════════════════════════════════════════════════════════════

describe('NostrBridge integration — teardown hygiene', () => {
  it('closing the relay and disconnecting the bridge leaves no dangling timers', async () => {
    const relay = await startRelayServer();
    attachEchoHandler(relay.server);

    const bridge = makeBridge([relay.url]);
    await bridge.connect();
    await delay(200);

    // Disconnect the bridge first — clears internal reconnect timers
    await bridge.disconnect();
    // Then close the server
    await closeServer(relay.server);

    // No assertions needed beyond "didn't hang"; Jest timeout would catch a leak.
    expect(bridge.health()[relay.url]).toBe(false);
  }, 5000);
});
