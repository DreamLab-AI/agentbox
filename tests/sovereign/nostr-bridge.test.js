'use strict';

/**
 * Unit tests for mcp/servers/nostr-bridge.js
 *
 * No live relay connections are made.  WebSocket is replaced with a mock
 * factory for all connection tests.
 *
 * Test coverage:
 *   - verifyNip98: valid event, expired event, wrong URL, bad signature,
 *                  missing header, wrong kind, wrong method
 *   - publish: fans out to all mocked relays
 *   - subscribe: routes mocked inbound events to handler callbacks
 *   - subscribe kind filtering: non-matching events are not delivered
 *   - unsubscribe: stops event delivery
 *   - connect / disconnect lifecycle
 *   - health() reflects connection state
 */

// ── Mock nostr-tools ──────────────────────────────────────────────────────────
// We mock nostr-tools at the module level so verifyNip98 and publish use
// controlled implementations without loading the real secp256k1 wasm.

const mockValidPubkey  = 'a'.repeat(64); // 32-byte hex pubkey placeholder
const VALID_PRIVKEY = 'b'.repeat(64); // 32-byte hex privkey placeholder

// Track verifyEvent call args for assertion
// `mock`-prefixed so jest permits referencing them inside the jest.mock factory.
let mockLastVerifyEventArg = null;
let mockVerifyEventResult  = true;

jest.mock('nostr-tools', () => ({
  verifyEvent(event) {
    mockLastVerifyEventArg = event;
    return mockVerifyEventResult;
  },
  finalizeEvent(unsignedEvent, _privKeyBytes) {
    // Return a minimal signed event shape
    return {
      ...unsignedEvent,
      id:     'mock-event-id',
      pubkey: mockValidPubkey,
      sig:    'mock-sig',
    };
  },
  getPublicKey(_privKeyBytes) {
    return mockValidPubkey;
  },
}), { virtual: true });

const { NostrBridge, kinds } = require('../../mcp/servers/nostr-bridge');

// ── Mock WebSocket factory ────────────────────────────────────────────────────

/**
 * Creates a mock WebSocket class and a handle map for test control.
 * Each instantiated socket is stored in handles[url].
 */
function makeMockWebSocketFactory() {
  const handles = {}; // url → MockWebSocket instance

  class MockWebSocket {
    constructor(url) {
      this.url        = url;
      this.readyState = 0; // CONNECTING
      this._listeners = {};
      this._sent      = [];
      handles[url]    = this;
    }

    on(event, fn) {
      this._listeners[event] = fn;
    }

    send(data) {
      if (this.readyState !== 1) return;
      this._sent.push(data);
    }

    close() {
      this.readyState = 3;
      if (this._listeners.close) this._listeners.close();
    }

    /** Test helper: simulate relay accepting the connection */
    simulateOpen() {
      this.readyState = 1;
      if (this._listeners.open) this._listeners.open();
    }

    /** Test helper: simulate an inbound relay message */
    simulateMessage(data) {
      const raw = typeof data === 'string' ? data : JSON.stringify(data);
      if (this._listeners.message) this._listeners.message(Buffer.from(raw));
    }
  }

  return { MockWebSocket, handles };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBridge(urls, extra = {}) {
  const { MockWebSocket, handles } = makeMockWebSocketFactory();
  const bridge = new NostrBridge({
    relays: urls,
    WebSocket: MockWebSocket,
    ...extra,
  });
  return { bridge, MockWebSocket, handles };
}

/**
 * Build a NIP-98 event base64 token.
 * Pass `overrides` to corrupt specific fields for negative tests.
 */
function makeNip98Token(overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const event = {
    kind:       kinds.AUTH,
    created_at: now,
    pubkey:     mockValidPubkey,
    tags:       [['u', 'http://localhost/v1/test'], ['method', 'GET']],
    content:    '',
    id:         'event-id',
    sig:        'valid-sig',
    ...overrides,
    // Allow deep override of tags
    ...(overrides.tags !== undefined ? { tags: overrides.tags } : {}),
  };
  return 'Nostr ' + Buffer.from(JSON.stringify(event)).toString('base64');
}

// ═════════════════════════════════════════════════════════════════════════════
// verifyNip98
// ═════════════════════════════════════════════════════════════════════════════

describe('NostrBridge.verifyNip98', () => {

  beforeEach(() => {
    mockVerifyEventResult  = true;
    mockLastVerifyEventArg = null;
    // Finding 4 replay defence keys on the event id; makeNip98Token() reuses a
    // fixed id across these independent assertions, so clear the cache between
    // them (the dedicated replay test below drives it deliberately).
    NostrBridge._resetReplayCache();
  });

  it('accepts a structurally valid, in-window event with matching method and URL', () => {
    const header = makeNip98Token();
    const result = NostrBridge.verifyNip98(header, 'GET', 'http://localhost/v1/test');
    expect(result.valid).toBe(true);
    expect(result.pubkey).toBe(mockValidPubkey);
    expect(result.error).toBeNull();
  });

  it('rejects an expired event (created_at > 60 s ago)', () => {
    const old = Math.floor(Date.now() / 1000) - 61;
    const header = makeNip98Token({ created_at: old });
    const result = NostrBridge.verifyNip98(header, 'GET', 'http://localhost/v1/test');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/60-second window/);
  });

  it('rejects a future event (created_at > 60 s ahead)', () => {
    const future = Math.floor(Date.now() / 1000) + 61;
    const header = makeNip98Token({ created_at: future });
    const result = NostrBridge.verifyNip98(header, 'GET', 'http://localhost/v1/test');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/60-second window/);
  });

  it('rejects when the u tag URL does not match the request URL', () => {
    const header = makeNip98Token({
      tags: [['u', 'http://localhost/v1/other'], ['method', 'GET']],
    });
    const result = NostrBridge.verifyNip98(header, 'GET', 'http://localhost/v1/test');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/url tag mismatch/);
  });

  it('rejects when the method tag does not match the request method', () => {
    const header = makeNip98Token({
      tags: [['u', 'http://localhost/v1/test'], ['method', 'POST']],
    });
    const result = NostrBridge.verifyNip98(header, 'GET', 'http://localhost/v1/test');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/method tag mismatch/);
  });

  it('rejects when verifyEvent returns false (bad signature)', () => {
    mockVerifyEventResult = false;
    const header = makeNip98Token();
    const result = NostrBridge.verifyNip98(header, 'GET', 'http://localhost/v1/test');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/invalid Schnorr signature/);
  });

  it('calls verifyEvent with the decoded event', () => {
    const header = makeNip98Token();
    NostrBridge.verifyNip98(header, 'GET', 'http://localhost/v1/test');
    expect(mockLastVerifyEventArg).toBeTruthy();
    expect(mockLastVerifyEventArg.kind).toBe(kinds.AUTH);
  });

  it('rejects when the Authorization header is missing', () => {
    const result = NostrBridge.verifyNip98('', 'GET', '/v1/test');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/missing or malformed/);
  });

  it('rejects a Bearer token (not a Nostr header)', () => {
    const result = NostrBridge.verifyNip98('Bearer abc123', 'GET', '/v1/test');
    expect(result.valid).toBe(false);
  });

  it('rejects malformed base64 payload', () => {
    const result = NostrBridge.verifyNip98('Nostr not-valid-base64!!!', 'GET', '/v1/test');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/base64 JSON/);
  });

  it('rejects wrong event kind', () => {
    const header = makeNip98Token({ kind: 1 });
    const result = NostrBridge.verifyNip98(header, 'GET', '/v1/test');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/expected kind 27235/);
  });

  it('accepts path-only URL when the u tag suffix-matches', () => {
    const header = makeNip98Token({
      tags: [['u', 'http://localhost/v1/test'], ['method', 'GET']],
    });
    // The u tag ends with the path — should still pass
    const result = NostrBridge.verifyNip98(header, 'GET', '/v1/test');
    expect(result.valid).toBe(true);
  });

  // ── Finding 4: request-body / payload-tag binding ────────────────────────
  const sha256hex = (s) => require('crypto').createHash('sha256').update(s).digest('hex');

  it('accepts a POST whose payload tag equals sha256(rawBody)', () => {
    const body = JSON.stringify({ decision: 'approve' });
    const header = makeNip98Token({
      id: 'payload-ok',
      tags: [['u', 'http://localhost/v1/x'], ['method', 'POST'], ['payload', sha256hex(body)]],
    });
    const result = NostrBridge.verifyNip98(header, 'POST', 'http://localhost/v1/x', body);
    expect(result.valid).toBe(true);
  });

  it('rejects a POST whose body was substituted under a captured header', () => {
    const signedBody = JSON.stringify({ decision: 'approve' });
    const tamperedBody = JSON.stringify({ decision: 'deny' });
    const header = makeNip98Token({
      id: 'payload-tamper',
      tags: [['u', 'http://localhost/v1/x'], ['method', 'POST'], ['payload', sha256hex(signedBody)]],
    });
    const result = NostrBridge.verifyNip98(header, 'POST', 'http://localhost/v1/x', tamperedBody);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/payload hash mismatch/);
  });

  it('rejects a POST that carries a body but no payload tag', () => {
    const body = JSON.stringify({ decision: 'approve' });
    const header = makeNip98Token({
      id: 'payload-missing',
      tags: [['u', 'http://localhost/v1/x'], ['method', 'POST']],
    });
    const result = NostrBridge.verifyNip98(header, 'POST', 'http://localhost/v1/x', body);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/missing payload tag/);
  });

  it('stays backward-compatible when no rawBody is supplied (3-arg call)', () => {
    const header = makeNip98Token({
      id: 'no-body-arg',
      tags: [['u', 'http://localhost/v1/x'], ['method', 'POST']],
    });
    const result = NostrBridge.verifyNip98(header, 'POST', 'http://localhost/v1/x');
    expect(result.valid).toBe(true);
  });

  // ── Finding 4: replay defence ────────────────────────────────────────────
  it('rejects a replayed event id inside the freshness window', () => {
    const header = makeNip98Token({
      id: 'replay-target',
      tags: [['u', 'http://localhost/v1/x'], ['method', 'GET']],
    });
    const first = NostrBridge.verifyNip98(header, 'GET', 'http://localhost/v1/x');
    expect(first.valid).toBe(true);
    const second = NostrBridge.verifyNip98(header, 'GET', 'http://localhost/v1/x');
    expect(second.valid).toBe(false);
    expect(second.error).toMatch(/replay/);
  });

  it('does not cache the id of an event that fails signature verification', () => {
    mockVerifyEventResult = false;
    const header = makeNip98Token({ id: 'bad-sig-id' });
    NostrBridge.verifyNip98(header, 'GET', 'http://localhost/v1/test'); // rejected at sig
    // A subsequent genuine event that happens to reuse the id is NOT a replay.
    mockVerifyEventResult = true;
    const ok = NostrBridge.verifyNip98(header, 'GET', 'http://localhost/v1/test');
    expect(ok.valid).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Connection lifecycle & health
// ═════════════════════════════════════════════════════════════════════════════

describe('NostrBridge connection lifecycle', () => {

  it('throws when constructed with no relays', () => {
    expect(() => new NostrBridge({ relays: [] })).toThrow(/at least one relay/);
  });

  it('connect() opens a WebSocket per relay', () => {
    const { bridge, handles } = makeBridge(['wss://relay1.test', 'wss://relay2.test']);
    bridge.connect();
    expect(handles['wss://relay1.test']).toBeDefined();
    expect(handles['wss://relay2.test']).toBeDefined();
  });

  it('health() returns false for relays not yet open', () => {
    const { bridge } = makeBridge(['wss://relay1.test']);
    bridge.connect();
    const h = bridge.health();
    expect(h['wss://relay1.test']).toBe(false);
  });

  it('health() returns true after simulated open', () => {
    const { bridge, handles } = makeBridge(['wss://relay1.test']);
    bridge.connect();
    handles['wss://relay1.test'].simulateOpen();
    expect(bridge.health()['wss://relay1.test']).toBe(true);
  });

  it('disconnect() closes all relay connections', () => {
    const { bridge, handles } = makeBridge(['wss://relay1.test', 'wss://relay2.test']);
    bridge.connect();
    handles['wss://relay1.test'].simulateOpen();
    handles['wss://relay2.test'].simulateOpen();
    bridge.disconnect();
    expect(bridge.health()['wss://relay1.test']).toBe(false);
    expect(bridge.health()['wss://relay2.test']).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Publish
// ═════════════════════════════════════════════════════════════════════════════

describe('NostrBridge.publish', () => {

  it('fans out the signed event to all connected relays', async () => {
    const urls = ['wss://relay1.test', 'wss://relay2.test', 'wss://relay3.test'];
    const { bridge, handles } = makeBridge(urls);
    bridge.connect();
    for (const url of urls) handles[url].simulateOpen();

    const mockSigner = {
      async sign(event) {
        return { ...event, id: 'test-id', pubkey: mockValidPubkey, sig: 'test-sig' };
      },
    };

    const unsigned = {
      kind: kinds.AGENT_STATE,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['d', 'agent-1']],
      content: JSON.stringify({ status: 'running' }),
    };

    const signed = await bridge.publish(unsigned, mockSigner);
    expect(signed.id).toBe('test-id');
    expect(signed.sig).toBe('test-sig');

    for (const url of urls) {
      const sentMessages = handles[url]._sent;
      expect(sentMessages).toHaveLength(1);
      const msg = JSON.parse(sentMessages[0]);
      expect(msg[0]).toBe('EVENT');
      expect(msg[1].id).toBe('test-id');
    }
  });

  it('throws when signer is not provided', async () => {
    const { bridge, handles } = makeBridge(['wss://relay1.test']);
    bridge.connect();
    handles['wss://relay1.test'].simulateOpen();
    await expect(bridge.publish({ kind: 1 }, null)).rejects.toThrow(/signer must have a sign/);
  });

  it('buffers EVENT message when relay is not yet open and sends on open', async () => {
    const { bridge, handles } = makeBridge(['wss://relay1.test']);
    bridge.connect();
    // Do NOT call simulateOpen yet

    const mockSigner = {
      async sign(event) { return { ...event, id: 'buf-id', sig: 'buf-sig' }; },
    };

    await bridge.publish({ kind: kinds.AGENT_STATE, created_at: 0, tags: [], content: '' }, mockSigner);
    expect(handles['wss://relay1.test']._sent).toHaveLength(0); // not yet open

    handles['wss://relay1.test'].simulateOpen(); // triggers flush
    expect(handles['wss://relay1.test']._sent).toHaveLength(1);
    expect(JSON.parse(handles['wss://relay1.test']._sent[0])[0]).toBe('EVENT');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Subscribe / unsubscribe
// ═════════════════════════════════════════════════════════════════════════════

describe('NostrBridge.subscribe', () => {

  it('sends REQ to all relays on subscribe', () => {
    const { bridge, handles } = makeBridge(['wss://relay1.test', 'wss://relay2.test']);
    bridge.connect();
    handles['wss://relay1.test'].simulateOpen();
    handles['wss://relay2.test'].simulateOpen();

    bridge.subscribe([kinds.AGENT_STATE], () => {});

    for (const url of ['wss://relay1.test', 'wss://relay2.test']) {
      const sent = handles[url]._sent;
      expect(sent).toHaveLength(1);
      const msg = JSON.parse(sent[0]);
      expect(msg[0]).toBe('REQ');
      expect(msg[2].kinds).toContain(kinds.AGENT_STATE);
    }
  });

  it('routes inbound EVENT messages to the registered handler', () => {
    const { bridge, handles } = makeBridge(['wss://relay1.test']);
    bridge.connect();
    handles['wss://relay1.test'].simulateOpen();

    const received = [];
    const subId = bridge.subscribe([kinds.AGENT_STATE], ev => received.push(ev));

    const event = {
      kind:       kinds.AGENT_STATE,
      created_at: Math.floor(Date.now() / 1000),
      pubkey:     mockValidPubkey,
      tags:       [['d', 'agent-1']],
      content:    '{}',
      id:         'ev1',
      sig:        'sig1',
    };

    handles['wss://relay1.test'].simulateMessage(['EVENT', subId, event]);
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe('ev1');
  });

  it('does not deliver events that do not match the kind filter', () => {
    const { bridge, handles } = makeBridge(['wss://relay1.test']);
    bridge.connect();
    handles['wss://relay1.test'].simulateOpen();

    const received = [];
    const subId = bridge.subscribe([kinds.AGENT_STATE], ev => received.push(ev));

    const wrongKindEvent = {
      kind:       1, // text note — not subscribed
      created_at: Math.floor(Date.now() / 1000),
      pubkey:     mockValidPubkey,
      tags:       [],
      content:    'hello',
      id:         'ev2',
      sig:        'sig2',
    };

    handles['wss://relay1.test'].simulateMessage(['EVENT', subId, wrongKindEvent]);
    expect(received).toHaveLength(0);
  });

  it('delivers to multiple independent subscriptions', () => {
    const { bridge, handles } = makeBridge(['wss://relay1.test']);
    bridge.connect();
    handles['wss://relay1.test'].simulateOpen();

    const received1 = [];
    const received2 = [];
    const subId1 = bridge.subscribe([kinds.AGENT_STATE], ev => received1.push(ev));
    const subId2 = bridge.subscribe([kinds.AGENT_STATE], ev => received2.push(ev));

    const event = {
      kind: kinds.AGENT_STATE, created_at: 0, pubkey: mockValidPubkey,
      tags: [], content: '{}', id: 'ev3', sig: 's3',
    };

    handles['wss://relay1.test'].simulateMessage(['EVENT', subId1, event]);
    handles['wss://relay1.test'].simulateMessage(['EVENT', subId2, event]);

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
  });
});

describe('NostrBridge.unsubscribe', () => {

  it('sends CLOSE to all relays and stops event delivery', () => {
    const { bridge, handles } = makeBridge(['wss://relay1.test']);
    bridge.connect();
    handles['wss://relay1.test'].simulateOpen();

    const received = [];
    const subId = bridge.subscribe([kinds.AGENT_STATE], ev => received.push(ev));

    // Clear the REQ message
    handles['wss://relay1.test']._sent = [];

    bridge.unsubscribe(subId);

    const sent = handles['wss://relay1.test']._sent;
    expect(sent).toHaveLength(1);
    const msg = JSON.parse(sent[0]);
    expect(msg[0]).toBe('CLOSE');
    expect(msg[1]).toBe(subId);

    // Subsequent messages for this subId must not fire the handler
    const event = {
      kind: kinds.AGENT_STATE, created_at: 0, pubkey: mockValidPubkey,
      tags: [], content: '{}', id: 'ev4', sig: 's4',
    };
    handles['wss://relay1.test'].simulateMessage(['EVENT', subId, event]);
    expect(received).toHaveLength(0);
  });

  it('is idempotent — calling unsubscribe twice does not throw', () => {
    const { bridge } = makeBridge(['wss://relay1.test']);
    bridge.connect();
    const subId = bridge.subscribe([kinds.AUTH], () => {});
    expect(() => {
      bridge.unsubscribe(subId);
      bridge.unsubscribe(subId);
    }).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Post-AUTH re-subscription: fresh wire ids (junkiejarvis-deafness regression)
// ═════════════════════════════════════════════════════════════════════════════
//
// Cloudflare Durable-Object relays do NOT resume live delivery when a KNOWN
// subId is re-REQ'd; only a CLOSE(old)+REQ(new-id) restarts push. The bridge
// must therefore ROTATE the wire subId on every post-AUTH replay while keeping
// the caller-facing subId stable, and re-route inbound EVENTs to the new id.

describe('NostrBridge post-AUTH re-subscription (fresh wire ids)', () => {
  const RELAY = 'wss://gated.test';
  const flush = () => new Promise((r) => setImmediate(r));
  let logSpy;

  beforeEach(() => { logSpy = jest.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => { logSpy.mockRestore(); });

  // Signer that stamps a distinct id per AUTH cycle so the OK-ack path can be
  // driven deterministically (no 1200 ms fallback-timer wait).
  function makeAuthSigner() {
    let n = 0;
    return { sign: async (ev) => ({ ...ev, id: `auth-${++n}`, sig: 's', pubkey: 'f'.repeat(64) }) };
  }

  const reqIds   = (h) => h._sent.map(JSON.parse).filter((m) => m[0] === 'REQ').map((m) => m[1]);
  const closeIds = (h) => h._sent.map(JSON.parse).filter((m) => m[0] === 'CLOSE').map((m) => m[1]);

  it('re-issues under a fresh id, CLOSEs the stale id, and re-routes EVENTs to the new id', async () => {
    const { bridge, handles } = makeBridge([RELAY]);
    bridge.setAuthSigner(makeAuthSigner());
    bridge.connect();
    const ws = handles[RELAY];
    ws.simulateOpen();

    const received = [];
    const stableId = bridge.subscribe([kinds.AGENT_STATE], (ev) => received.push(ev));
    expect(reqIds(ws)).toEqual([stableId]); // initial wire id == stable id

    // AUTH challenge → sign (async) → OK-ack fires the replay synchronously.
    ws.simulateMessage(['AUTH', 'challenge-1']);
    await flush();
    ws.simulateMessage(['OK', 'auth-1', true]);

    const afterReq = reqIds(ws);
    expect(afterReq).toHaveLength(2);
    const freshId = afterReq[1];
    expect(freshId).not.toBe(stableId);          // rotated
    expect(closeIds(ws)).toContain(stableId);    // old id released

    // Inbound EVENT under the FRESH wire id routes to the handler…
    const ev = {
      kind: kinds.AGENT_STATE, created_at: 0, pubkey: mockValidPubkey,
      tags: [], content: '{}', id: 'fresh-ev', sig: 's',
    };
    ws.simulateMessage(['EVENT', freshId, ev]);
    expect(received.map((e) => e.id)).toEqual(['fresh-ev']);

    // …and an EVENT under the now-stale id is dropped (relay would have CLOSEd it).
    ws.simulateMessage(['EVENT', stableId, { ...ev, id: 'stale-ev' }]);
    expect(received.map((e) => e.id)).toEqual(['fresh-ev']);

    bridge.disconnect();
  });

  it('rotates again on a second re-AUTH (reconnect): each cycle yields a NEW id', async () => {
    const { bridge, handles } = makeBridge([RELAY]);
    bridge.setAuthSigner(makeAuthSigner());
    bridge.connect();
    const ws = handles[RELAY];
    ws.simulateOpen();

    const received = [];
    const stableId = bridge.subscribe([kinds.AGENT_STATE], (ev) => received.push(ev));

    // First AUTH cycle.
    ws.simulateMessage(['AUTH', 'c1']);
    await flush();
    ws.simulateMessage(['OK', 'auth-1', true]);
    const firstFresh = reqIds(ws)[1];

    // Second AUTH cycle (models a reconnect that re-challenges the socket).
    ws.simulateMessage(['AUTH', 'c2']);
    await flush();
    ws.simulateMessage(['OK', 'auth-2', true]);
    const secondFresh = reqIds(ws)[2];

    expect(new Set([stableId, firstFresh, secondFresh]).size).toBe(3); // all distinct
    expect(closeIds(ws)).toEqual(expect.arrayContaining([stableId, firstFresh]));

    // Delivery follows the NEWEST id; the previous fresh id is now deaf.
    const base = { kind: kinds.AGENT_STATE, created_at: 0, pubkey: mockValidPubkey, tags: [], content: '{}', sig: 's' };
    ws.simulateMessage(['EVENT', secondFresh, { ...base, id: 'newest' }]);
    ws.simulateMessage(['EVENT', firstFresh,  { ...base, id: 'prev-stale' }]);
    expect(received.map((e) => e.id)).toEqual(['newest']);

    bridge.disconnect();
  });

  it('unsubscribe still works after a rotation and CLOSEs the CURRENT wire id', async () => {
    const { bridge, handles } = makeBridge([RELAY]);
    bridge.setAuthSigner(makeAuthSigner());
    bridge.connect();
    const ws = handles[RELAY];
    ws.simulateOpen();

    const received = [];
    const stableId = bridge.subscribe([kinds.AGENT_STATE], (ev) => received.push(ev));
    ws.simulateMessage(['AUTH', 'c1']);
    await flush();
    ws.simulateMessage(['OK', 'auth-1', true]);
    const freshId = reqIds(ws)[1];

    ws._sent = [];
    // Caller still holds the ORIGINAL stableId — unsubscribe must resolve it and
    // CLOSE the rotated wire id, not silently no-op.
    bridge.unsubscribe(stableId);
    expect(closeIds(ws)).toEqual([freshId]);

    // No further delivery under the fresh id after unsubscribe.
    ws.simulateMessage(['EVENT', freshId, { kind: kinds.AGENT_STATE, created_at: 0, pubkey: mockValidPubkey, tags: [], content: '{}', id: 'x', sig: 's' }]);
    expect(received).toHaveLength(0);

    bridge.disconnect();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Idle subscription keepalive (timer-based fresh-id refresh)
// ═════════════════════════════════════════════════════════════════════════════
//
// The CF Durable-Object relay stops pushing to an idle subscription ~20 s after
// its last REQ while the SOCKET stays warm (pings answered), so the post-AUTH
// replay above never fires again and the subscription goes deaf. The refresh
// must therefore also run from a timer against a healthy, never-reconnecting
// socket. (Root cause of junkiejarvis missing DMs ~20 s after startup.)

describe('NostrBridge idle subscription keepalive', () => {
  const RELAY = 'wss://gated.test';
  let logSpy;

  beforeEach(() => {
    jest.useFakeTimers();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.useRealTimers();
    logSpy.mockRestore();
  });

  const reqIds   = (h) => h._sent.map(JSON.parse).filter((m) => m[0] === 'REQ').map((m) => m[1]);
  const closeIds = (h) => h._sent.map(JSON.parse).filter((m) => m[0] === 'CLOSE').map((m) => m[1]);

  it('re-issues subscriptions under fresh ids on a HEALTHY socket, with no reconnect', () => {
    // Ping keepalive pushed out of the window: this test must prove the
    // SUBSCRIPTION refresh alone rotates ids — not a ping-death reconnect.
    const { bridge, handles } = makeBridge([RELAY], { pingIntervalMs: 3600000 });
    bridge.connect();
    const ws = handles[RELAY];
    ws.simulateOpen();

    const received = [];
    const stableId = bridge.subscribe([kinds.AGENT_STATE], (ev) => received.push(ev));
    expect(reqIds(ws)).toEqual([stableId]);

    jest.advanceTimersByTime(15000); // default subRefreshIntervalMs

    const reqs = reqIds(ws);
    expect(reqs).toHaveLength(2);
    const freshId = reqs[1];
    expect(freshId).not.toBe(stableId);          // rotated by the timer alone
    expect(closeIds(ws)).toEqual([stableId]);    // stale id released first

    // Delivery follows the fresh id; the pre-refresh id is deaf.
    const base = { kind: kinds.AGENT_STATE, created_at: 0, pubkey: mockValidPubkey, tags: [], content: '{}', sig: 's' };
    ws.simulateMessage(['EVENT', freshId,  { ...base, id: 'live' }]);
    ws.simulateMessage(['EVENT', stableId, { ...base, id: 'dead' }]);
    expect(received.map((e) => e.id)).toEqual(['live']);

    // Every tick rotates again — wire ids never repeat.
    jest.advanceTimersByTime(15000);
    expect(reqIds(ws)).toHaveLength(3);
    expect(new Set(reqIds(ws)).size).toBe(3);

    bridge.disconnect();
  });

  it('skips ticks while no connection is healthy and stops entirely on disconnect', () => {
    const { bridge, handles } = makeBridge([RELAY], { pingIntervalMs: 3600000 });
    bridge.connect();
    const ws = handles[RELAY];

    // Socket never opened → not healthy → ticks are no-ops (the REQ itself is
    // queued in the connection's pending buffer, so nothing hits the wire).
    const stableId = bridge.subscribe([kinds.AGENT_STATE], () => {});
    jest.advanceTimersByTime(45000);
    expect(ws._sent).toHaveLength(0);

    // Once the socket opens, the queued REQ flushes under the UNROTATED id
    // (skipped ticks must not have mutated wire ids)…
    ws.simulateOpen();
    expect(reqIds(ws)).toEqual([stableId]);

    // …and the next tick resumes rotation.
    jest.advanceTimersByTime(15000);
    expect(reqIds(ws)).toHaveLength(2);
    expect(reqIds(ws)[1]).not.toBe(stableId);

    // disconnect() clears the timer: no further refresh traffic.
    bridge.disconnect();
    const sentAfter = ws._sent.length;
    jest.advanceTimersByTime(60000);
    expect(ws._sent).toHaveLength(sentAfter);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// kinds constants
// ═════════════════════════════════════════════════════════════════════════════

describe('kinds constants', () => {
  const { kinds: k } = require('../../mcp/servers/nostr-bridge');

  it('AUTH is 27235', () => expect(k.AUTH).toBe(27235));
  it('AGENT_STATE is 30078', () => expect(k.AGENT_STATE).toBe(30078));
  it('BRIEF_REF is 30000', () => expect(k.BRIEF_REF).toBe(30000));
  it('BEAD_REF is 30001', () => expect(k.BEAD_REF).toBe(30001));
  it('NIP33_MIN is 30000', () => expect(k.NIP33_MIN).toBe(30000));
  it('NIP33_MAX is 39999', () => expect(k.NIP33_MAX).toBe(39999));
  it('is frozen', () => {
    expect(() => { k.AUTH = 0; }).toThrow();
  });
});
