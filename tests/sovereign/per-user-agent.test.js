'use strict';

/**
 * Unit tests for management-api/lib/per-user-agent — the Per-User Agent Fabric
 * (PUAF) prototype (ADR-028). Covers the PURE / mockable parts (no network):
 *   - resolveBinding (specificity + tie-break + no-match)
 *   - loadPodIdentity fallback chain (404→404→default; 200 on private)
 *   - buildSystemPrompt assembly (identity + memory + rules, ordered)
 *   - nip98Token shape (kind 27235, u+method tags, payload only when body)
 *   - heartbeat HEARTBEAT_OK suppression vs action (mock llm)
 *
 * The bridge, the LLM, and fetch are fully mocked; no key material, no sockets.
 */

const puaf = require('../../management-api/lib/per-user-agent');

const {
  PerUserAgent,
  resolveBinding,
  nip98Token,
  loadPodIdentity,
  buildSystemPrompt,
  DEFAULT_SOUL,
  OPERATING_RULES,
  HEARTBEAT_OK,
} = puaf;

// ── A deterministic mock signer (no real crypto, no key material) ────────────
function mockSigner(pubkey = 'a'.repeat(64)) {
  return {
    pubkey,
    skBytes: new Uint8Array(32),
    sign(unsigned) {
      // Echo the unsigned event back as a "signed" event with a fake id/sig.
      return { ...unsigned, pubkey, id: 'f'.repeat(64), sig: '0'.repeat(128) };
    },
  };
}

// ── resolveBinding ───────────────────────────────────────────────────────────

describe('resolveBinding', () => {
  const bindings = [
    { match: { channel: 'nostr' }, agentId: 'concierge' },
    { match: { channel: 'nostr', peer: 'carol' }, agentId: 'carol-agent' },
    { match: { channel: 'nostr', peer: 'carol', accountId: 'acct1' }, agentId: 'carol-acct1' },
  ];

  test('most-specific match wins (all 3 fields)', () => {
    const msg = { channel: 'nostr', peer: 'carol', accountId: 'acct1' };
    expect(resolveBinding(bindings, msg, 'main')).toBe('carol-acct1');
  });

  test('falls to the 2-field binding when accountId differs', () => {
    const msg = { channel: 'nostr', peer: 'carol', accountId: 'other' };
    expect(resolveBinding(bindings, msg, 'main')).toBe('carol-agent');
  });

  test('falls to the 1-field binding when peer differs', () => {
    const msg = { channel: 'nostr', peer: 'dave' };
    expect(resolveBinding(bindings, msg, 'main')).toBe('concierge');
  });

  test('no match → defaultAgentId', () => {
    expect(resolveBinding(bindings, { channel: 'telegram' }, 'main')).toBe('main');
    expect(resolveBinding(bindings, { channel: 'telegram' })).toBe('main'); // default default
  });

  test('tie on specificity breaks by list order (first wins)', () => {
    const tied = [
      { match: { peer: 'carol' }, agentId: 'first' },
      { match: { channel: 'nostr' }, agentId: 'second' },
    ];
    // both are 1-field and both match → first in list wins
    expect(resolveBinding(tied, { channel: 'nostr', peer: 'carol' }, 'main')).toBe('first');
  });

  test('empty/garbage inputs → default', () => {
    expect(resolveBinding([], { channel: 'nostr' }, 'main')).toBe('main');
    expect(resolveBinding(null, { channel: 'nostr' }, 'main')).toBe('main');
    expect(resolveBinding([{ match: {}, agentId: 'x' }], { channel: 'nostr' }, 'main')).toBe('main');
  });
});

// ── nip98Token ───────────────────────────────────────────────────────────────

describe('nip98Token', () => {
  function decode(header) {
    expect(header.startsWith('Nostr ')).toBe(true);
    const b64 = header.slice('Nostr '.length);
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  }

  test('kind 27235 with u + method tags, no payload when bodiless', async () => {
    const header = await nip98Token(mockSigner(), 'https://pod.example/pods/x/inbox/', 'GET');
    const ev = decode(header);
    expect(ev.kind).toBe(27235);
    const u = ev.tags.find((t) => t[0] === 'u');
    const method = ev.tags.find((t) => t[0] === 'method');
    expect(u[1]).toBe('https://pod.example/pods/x/inbox/');
    expect(method[1]).toBe('GET');
    expect(ev.tags.find((t) => t[0] === 'payload')).toBeUndefined();
  });

  test('payload tag present (sha256hex) when a body is supplied', async () => {
    const body = JSON.stringify({ hello: 'world' });
    const header = await nip98Token(mockSigner(), 'https://pod.example/x', 'POST', body);
    const ev = decode(header);
    const payload = ev.tags.find((t) => t[0] === 'payload');
    expect(payload).toBeDefined();
    const expected = require('crypto').createHash('sha256').update(Buffer.from(body, 'utf8')).digest('hex');
    expect(payload[1]).toBe(expected);
    expect(ev.tags.find((t) => t[0] === 'method')[1]).toBe('POST');
  });

  test('query string is stripped from the u tag', async () => {
    const header = await nip98Token(mockSigner(), 'https://pod.example/x?a=1&b=2', 'GET');
    const ev = decode(header);
    expect(ev.tags.find((t) => t[0] === 'u')[1]).toBe('https://pod.example/x');
  });
});

// ── loadPodIdentity ──────────────────────────────────────────────────────────

describe('loadPodIdentity', () => {
  const podBase = 'https://pod.example';
  const pubkey = 'c'.repeat(64);

  function res(status, text) {
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  }

  test('404 on private → 404 on public → DEFAULT_SOUL', async () => {
    const fetchImpl = jest.fn(async () => res(404, ''));
    const out = await loadPodIdentity({ podBase, pubkey, signer: mockSigner(), fetchImpl });
    expect(out.source).toBe('default');
    expect(out.identity).toBe(DEFAULT_SOUL);
  });

  test('200 on private SOUL.md → source private, identity from pod', async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (url.includes('/private/agent/SOUL.md')) return res(200, '# Carol Soul\nBe helpful.');
      return res(404, '');
    });
    const out = await loadPodIdentity({ podBase, pubkey, signer: mockSigner(), fetchImpl });
    expect(out.source).toBe('private');
    expect(out.identity).toContain('Carol Soul');
  });

  test('SOUL (private) + USER (public) concatenate, SOUL first', async () => {
    const fetchImpl = jest.fn(async (url) => {
      if (url.includes('/private/agent/SOUL.md')) return res(200, 'SOULTEXT');
      if (url.includes('/public/agent/USER.md')) return res(200, 'USERTEXT');
      return res(404, '');
    });
    const out = await loadPodIdentity({ podBase, pubkey, signer: mockSigner(), fetchImpl });
    expect(out.source).toBe('private');
    expect(out.identity.indexOf('SOULTEXT')).toBeLessThan(out.identity.indexOf('USERTEXT'));
  });

  test('fail-open: a throwing fetch → default', async () => {
    const fetchImpl = jest.fn(async () => { throw new Error('network down'); });
    const out = await loadPodIdentity({ podBase, pubkey, signer: mockSigner(), fetchImpl });
    expect(out.source).toBe('default');
    expect(out.identity).toBe(DEFAULT_SOUL);
  });
});

// ── recallMemory (auth header shape + namespace + fail-open) ─────────────────

describe('recallMemory', () => {
  const { recallMemory } = puaf;
  const pubkey = 'd7cf'.repeat(16); // 64 hex

  function okJson(results) {
    return { ok: true, status: 200, json: async () => ({ results }) };
  }

  test('POSTs to /v1/memory/search with a Bearer token and the user:<pubkey>:agent namespace', async () => {
    let captured = null;
    const fetchImpl = jest.fn(async (url, opts) => {
      captured = { url, opts };
      return okJson([{ key: 'fav', value: 'vinyl nights' }]);
    });
    const out = await recallMemory({
      pubkey, query: 'event preferences', fetchImpl,
      baseUrl: 'http://127.0.0.1:9090', token: 'SECRET_KEY', limit: 5,
    });
    expect(captured.url).toBe('http://127.0.0.1:9090/v1/memory/search');
    expect(captured.opts.method).toBe('POST');
    // Bearer is the shape the management-api hybrid auth hook accepts.
    expect(captured.opts.headers.authorization).toBe('Bearer SECRET_KEY');
    expect(captured.opts.headers['content-type']).toBe('application/json');
    const body = JSON.parse(captured.opts.body);
    expect(body.namespace).toBe(`user:${pubkey}:agent`);
    expect(body.query).toBe('event preferences');
    expect(body.limit).toBe(5);
    expect(out).toEqual([{ key: 'fav', value: 'vinyl nights' }]);
  });

  test('default base URL is the live management-api port 9090 (not 9600)', async () => {
    const fetchImpl = jest.fn(async () => okJson([]));
    const saved = process.env.MANAGEMENT_API_URL;
    delete process.env.MANAGEMENT_API_URL;
    try {
      await recallMemory({ pubkey, query: 'x', fetchImpl, token: 'k' });
    } finally {
      if (saved !== undefined) process.env.MANAGEMENT_API_URL = saved;
    }
    // First call is the search; an empty result then triggers the namespace
    // list fallback (second call) — both on 9090.
    expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:9090/v1/memory/search');
    expect(fetchImpl.mock.calls[1][0]).toContain('http://127.0.0.1:9090/v1/memory?namespace=');
  });

  test('no token → no authorization header (let the hook 401 explicitly)', async () => {
    let captured = null;
    const fetchImpl = jest.fn(async (url, opts) => { captured = opts; return okJson([]); });
    const saved = process.env.MANAGEMENT_API_KEY;
    delete process.env.MANAGEMENT_API_KEY;
    try {
      await recallMemory({ pubkey, query: 'x', fetchImpl, baseUrl: 'http://h' });
    } finally {
      if (saved !== undefined) process.env.MANAGEMENT_API_KEY = saved;
    }
    expect(captured.headers.authorization).toBeUndefined();
  });

  test('accepts {items:[...]} as well as {results:[...]}', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ items: [{ key: 'k', value: 'v' }] }) }));
    const out = await recallMemory({ pubkey, query: 'x', fetchImpl, token: 'k' });
    expect(out).toEqual([{ key: 'k', value: 'v' }]);
  });

  test('fail-open: non-ok response → []', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    const out = await recallMemory({ pubkey, query: 'x', fetchImpl, token: 'k' });
    expect(out).toEqual([]);
  });

  test('fail-open: a throwing fetch → []', async () => {
    const fetchImpl = jest.fn(async () => { throw new Error('down'); });
    const out = await recallMemory({ pubkey, query: 'x', fetchImpl, token: 'k' });
    expect(out).toEqual([]);
  });

  test('empty query or missing pubkey → [] (no fetch)', async () => {
    const fetchImpl = jest.fn();
    expect(await recallMemory({ pubkey, query: '   ', fetchImpl, token: 'k' })).toEqual([]);
    expect(await recallMemory({ pubkey: '', query: 'x', fetchImpl, token: 'k' })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ── _think wiring (identity source + memory hits flow into the prompt) ───────

describe('PerUserAgent._think wiring', () => {
  test('recalled memory flows into the system prompt; logs identity source + hit count', async () => {
    const infoLogs = [];
    const logger = { info: (obj, msg) => infoLogs.push({ obj, msg }), warn() {}, error() {}, debug() {} };

    let capturedSystem = null;
    const llm = jest.fn(async (_userText, opts) => { capturedSystem = opts.system; return 'ok'; });

    const bridge = { subscribe: jest.fn(() => 's'), unsubscribe: jest.fn(), publish: jest.fn(), setAuthSigner: jest.fn() };
    const agent = new PerUserAgent({
      userPubkey: 'e'.repeat(64),
      agentSigner: mockSigner(),
      podBase: 'https://pod.example',
      bridge,
      // identity fetch: private SOUL 200 → source 'private'
      fetchImpl: jest.fn(async (url) => {
        if (url.includes('/private/agent/SOUL.md')) return { ok: true, status: 200, text: async () => 'CAROL_SOUL' };
        return { ok: false, status: 404, text: async () => '' };
      }),
      // memory fetch: two hits
      memoryFetch: jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ results: [
        { key: 'fav', value: 'vinyl nights' },
        { key: 'tz', value: 'Europe/London' },
      ] }) })),
      llm,
      logger,
    });

    const reply = await agent._think('what are my evening plans?');
    expect(reply).toBe('ok');
    // Memory + identity made it into the prompt the LLM actually saw.
    expect(capturedSystem).toContain('CAROL_SOUL');
    expect(capturedSystem).toContain('RELEVANT MEMORY:');
    expect(capturedSystem).toContain('vinyl nights');
    // Think-time observability logs.
    const idLog = infoLogs.find((l) => l.msg === '[puaf] identity loaded');
    const memLog = infoLogs.find((l) => l.msg === '[puaf] memory recalled');
    expect(idLog && idLog.obj.source).toBe('private');
    expect(memLog && memLog.obj.hits).toBe(2);
  });
});

// ── buildSystemPrompt ────────────────────────────────────────────────────────

describe('buildSystemPrompt', () => {
  test('assembles identity, then RELEVANT MEMORY, then operating rules — ordered', () => {
    const identity = 'IDENTITY_BLOCK';
    const memories = [
      { key: 'fav-coffee', value: 'flat white' },
      { key: 'tz', value: 'Europe/London' },
    ];
    const prompt = buildSystemPrompt({ identity, memories, userPubkey: 'd'.repeat(64) });

    const iIdentity = prompt.indexOf('IDENTITY_BLOCK');
    const iMemory = prompt.indexOf('RELEVANT MEMORY:');
    const iRules = prompt.indexOf('OPERATING RULES');

    expect(iIdentity).toBeGreaterThanOrEqual(0);
    expect(iMemory).toBeGreaterThan(iIdentity);
    expect(iRules).toBeGreaterThan(iMemory);

    expect(prompt).toContain('flat white');
    expect(prompt).toContain('Europe/London');
    expect(prompt).toContain('Never reveal'); // a hard rule
  });

  test('no memory block when there are no memories; default identity fallback', () => {
    const prompt = buildSystemPrompt({ identity: '', memories: [] });
    expect(prompt).toContain(DEFAULT_SOUL.split('\n')[0]);
    expect(prompt).not.toContain('RELEVANT MEMORY:');
    expect(prompt).toContain(OPERATING_RULES.split('\n')[0]);
  });

  test('non-string memory values are JSON-stringified into the block', () => {
    const prompt = buildSystemPrompt({ identity: 'X', memories: [{ key: 'k', value: { a: 1 } }] });
    expect(prompt).toContain('RELEVANT MEMORY:');
    expect(prompt).toContain('{"a":1}');
  });
});

// ── heartbeat (HEARTBEAT_OK suppression vs action) ───────────────────────────

describe('PerUserAgent.heartbeat', () => {
  function makeAgent({ llm, fetchImpl, podBase = 'https://pod.example' }) {
    const bridge = {
      subscribe: jest.fn(() => 'sub-1'),
      unsubscribe: jest.fn(),
      publish: jest.fn(async (ev) => ev),
      setAuthSigner: jest.fn(),
    };
    const agent = new PerUserAgent({
      userPubkey: 'e'.repeat(64),
      agentSigner: mockSigner(),
      podBase,
      bridge,
      fetchImpl,
      memoryFetch: async () => ({ ok: false, json: async () => ({}) }), // recall → []
      llm,
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    });
    return { agent, bridge };
  }

  // An inbox listing fetch that returns two items; identity/memory fetches 404.
  function inboxFetch(items) {
    return jest.fn(async (url) => {
      if (url.includes('/inbox/')) {
        return { ok: true, status: 200, json: async () => ({ contains: items }) };
      }
      // SOUL/USER identity fetches → 404 (default identity)
      return { ok: false, status: 404, text: async () => '' };
    });
  }

  test('HEARTBEAT_OK is suppressed — no DM published', async () => {
    const llm = jest.fn(async () => HEARTBEAT_OK);
    const fetchImpl = inboxFetch([{ url: 'https://pod.example/pods/e/inbox/item-1' }]);
    const { agent, bridge } = makeAgent({ llm, fetchImpl });

    const result = await agent.heartbeat();
    expect(result.processed).toBe(1);
    expect(result.acted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(bridge.publish).not.toHaveBeenCalled();
  });

  test('non-OK reply → the owner is DM\'d (the agent acts)', async () => {
    const llm = jest.fn(async () => 'Your landlord emailed about the lease renewal — reply by Friday.');
    const fetchImpl = inboxFetch([{ url: 'https://pod.example/pods/e/inbox/item-2' }]);
    const { agent } = makeAgent({ llm, fetchImpl });
    // Spy on the DM send so we assert "acts on the owner" without driving the
    // real NIP-59 gift-wrap (which needs real key material).
    const sendSpy = jest.spyOn(agent, '_sendDm').mockResolvedValue(undefined);

    const result = await agent.heartbeat();
    expect(result.processed).toBe(1);
    expect(result.acted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0][0]).toBe('e'.repeat(64)); // DM'd to the owner
    expect(sendSpy.mock.calls[0][1]).toContain('landlord');
  });

  test('dedup: the same inbox item is not processed twice across ticks', async () => {
    const llm = jest.fn(async () => HEARTBEAT_OK);
    const fetchImpl = inboxFetch([{ url: 'https://pod.example/pods/e/inbox/item-3' }]);
    const { agent } = makeAgent({ llm, fetchImpl });

    const first = await agent.heartbeat();
    const second = await agent.heartbeat();
    expect(first.processed).toBe(1);
    expect(second.processed).toBe(0); // already seen → deduped
  });

  test('fail-open: a throwing inbox fetch yields a zero-result summary, no crash', async () => {
    const llm = jest.fn(async () => HEARTBEAT_OK);
    const fetchImpl = jest.fn(async () => { throw new Error('pod unreachable'); });
    const { agent } = makeAgent({ llm, fetchImpl });

    const result = await agent.heartbeat();
    expect(result.processed).toBe(0);
    expect(result.errors).toBeGreaterThanOrEqual(0);
  });
});

// ── _parseInboxListing (defensive shapes) ────────────────────────────────────

describe('_parseInboxListing', () => {
  const { _parseInboxListing } = puaf;
  test('accepts a bare array of strings', () => {
    const items = _parseInboxListing(['a.json', 'b.json'], 'https://pod.example/pods/x/inbox/');
    expect(items).toHaveLength(2);
    expect(items[0].url).toContain('a.json');
  });
  test('accepts {contains:[...]}', () => {
    const items = _parseInboxListing({ contains: [{ id: 'https://x/1' }] }, 'https://x/');
    expect(items[0].url).toBe('https://x/1');
  });
  test('accepts ldp:contains', () => {
    const items = _parseInboxListing({ 'ldp:contains': ['1.json'] }, 'https://x/inbox/');
    expect(items[0].url).toContain('1.json');
  });
  test('unknown shape → empty array', () => {
    expect(_parseInboxListing({ foo: 'bar' })).toEqual([]);
    expect(_parseInboxListing(null)).toEqual([]);
  });
});
