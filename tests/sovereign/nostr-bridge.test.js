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

const VALID_PUBKEY  = 'a'.repeat(64); // 32-byte hex pubkey placeholder
const VALID_PRIVKEY = 'b'.repeat(64); // 32-byte hex privkey placeholder

// Track verifyEvent call args for assertion
let lastVerifyEventArg = null;
let verifyEventResult  = true;

jest.mock('nostr-tools', () => ({
  verifyEvent(event) {
    lastVerifyEventArg = event;
    return verifyEventResult;
  },
  finalizeEvent(unsignedEvent, _privKeyBytes) {
    // Return a minimal signed event shape
    return {
      ...unsignedEvent,
      id:     'mock-event-id',
      pubkey: VALID_PUBKEY,
      sig:    'mock-sig',
    };
  },
  getPublicKey(_privKeyBytes) {
    return VALID_PUBKEY;
  },
}));

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
    pubkey:     VALID_PUBKEY,
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
    verifyEventResult  = true;
    lastVerifyEventArg = null;
  });

  it('accepts a structurally valid, in-window event with matching method and URL', () => {
    const header = makeNip98Token();
    const result = NostrBridge.verifyNip98(header, 'GET', 'http://localhost/v1/test');
    expect(result.valid).toBe(true);
    expect(result.pubkey).toBe(VALID_PUBKEY);
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
    verifyEventResult = false;
    const header = makeNip98Token();
    const result = NostrBridge.verifyNip98(header, 'GET', 'http://localhost/v1/test');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/invalid Schnorr signature/);
  });

  it('calls verifyEvent with the decoded event', () => {
    const header = makeNip98Token();
    NostrBridge.verifyNip98(header, 'GET', 'http://localhost/v1/test');
    expect(lastVerifyEventArg).toBeTruthy();
    expect(lastVerifyEventArg.kind).toBe(kinds.AUTH);
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
        return { ...event, id: 'test-id', pubkey: VALID_PUBKEY, sig: 'test-sig' };
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
      pubkey:     VALID_PUBKEY,
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
      pubkey:     VALID_PUBKEY,
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
      kind: kinds.AGENT_STATE, created_at: 0, pubkey: VALID_PUBKEY,
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
      kind: kinds.AGENT_STATE, created_at: 0, pubkey: VALID_PUBKEY,
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
