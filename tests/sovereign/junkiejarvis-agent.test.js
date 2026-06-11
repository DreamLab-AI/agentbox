'use strict';

/**
 * Unit tests for management-api/lib/junkiejarvis-agent — JunkieJarvis, the
 * DreamLab forum agent. Covers the PURE parts (no network):
 *   - mention/addressing detection (kind-42 p-tag + @junkiejarvis)
 *   - create_event directive parsing + normalisation
 *   - reply truncation + detail detection
 *   - kind-31923 calendar event building (tag shapes mirror the seed script)
 *   - the end-to-end _think() brain with a mocked LLM + a mocked bridge
 *
 * The relay bridge and the LLM are fully mocked; no key material and no sockets
 * are touched.
 */

const jj = require('../../management-api/lib/junkiejarvis-agent');

const {
  JunkieJarvisAgent,
  startJunkieJarvis,
  isChannelMention,
  channelRootTag,
  channelZone,
  parseDirective,
  normaliseEventDirective,
  truncateReply,
  wantsDetail,
  buildCalendarEvent,
  SYSTEM_PROMPT,
  CANNED_APOLOGY,
  JUNKIEJARVIS_PUBKEY,
  kinds,
} = jj;

const ASKER = 'a'.repeat(64);

// ── mention detection ────────────────────────────────────────────────────────

describe('isChannelMention', () => {
  test('p-tag pointing at JunkieJarvis → mention', () => {
    const ev = { kind: 42, content: 'hello there', tags: [['p', JUNKIEJARVIS_PUBKEY]] };
    expect(isChannelMention(ev)).toBe(true);
  });

  test('@junkiejarvis in content → mention', () => {
    const ev = { kind: 42, content: 'hey @junkiejarvis can you book a room', tags: [] };
    expect(isChannelMention(ev)).toBe(true);
  });

  test('@junkiejarvisbot (substring) does NOT match — word boundary', () => {
    const ev = { kind: 42, content: 'talking about @junkiejarvisbot things', tags: [] };
    expect(isChannelMention(ev)).toBe(false);
  });

  test('unrelated kind-42 message → not a mention', () => {
    const ev = { kind: 42, content: 'just chatting', tags: [['p', 'b'.repeat(64)]] };
    expect(isChannelMention(ev)).toBe(false);
  });

  test('wrong kind → never a mention', () => {
    const ev = { kind: 1, content: '@junkiejarvis', tags: [] };
    expect(isChannelMention(ev)).toBe(false);
  });

  test('case-insensitive @JunkieJarvis', () => {
    const ev = { kind: 42, content: 'Hi @JunkieJarvis!', tags: [] };
    expect(isChannelMention(ev)).toBe(true);
  });
});

describe('channelRootTag / channelZone', () => {
  test('prefers the explicit root marker', () => {
    const ev = { tags: [
      ['e', 'reply-id', 'wss://r', 'reply'],
      ['e', 'root-id', 'wss://r', 'root'],
    ] };
    expect(channelRootTag(ev)).toEqual({ id: 'root-id', relay: 'wss://r', marker: 'root' });
  });

  test('falls back to first e-tag when no root marker', () => {
    const ev = { tags: [['e', 'chan-id', 'wss://r']] };
    expect(channelRootTag(ev).id).toBe('chan-id');
  });

  test('no e-tags → null', () => {
    expect(channelRootTag({ tags: [] })).toBeNull();
  });

  test('reads the section/zone tag', () => {
    expect(channelZone({ tags: [['section', 'family']] })).toBe('family');
    expect(channelZone({ tags: [] })).toBeNull();
  });
});

// ── directive parsing ────────────────────────────────────────────────────────

describe('parseDirective', () => {
  test('first-line create_event directive split from the reply body', () => {
    const start = 1800000000;
    const text = `{"tool":"create_event","title":"Vinyl Night","start":${start},"end":${start + 7200},"zone":"friends","venue":"dreamlab"}\nBooked Vinyl Night for Friday.`;
    const { directive, reply } = parseDirective(text);
    expect(directive).toMatchObject({ tool: 'create_event', title: 'Vinyl Night', zone: 'friends' });
    expect(reply).toBe('Booked Vinyl Night for Friday.');
  });

  test('leading blank lines before the directive are tolerated', () => {
    const text = `\n\n{"tool":"create_event","title":"X","start":1,"end":2,"zone":"public","venue":null}\nok`;
    const { directive, reply } = parseDirective(text);
    expect(directive.tool).toBe('create_event');
    expect(reply).toBe('ok');
  });

  test('plain reply with no directive', () => {
    const { directive, reply } = parseDirective('The events page lists everything coming up.');
    expect(directive).toBeNull();
    expect(reply).toBe('The events page lists everything coming up.');
  });

  test('malformed JSON first line → treated as plain reply', () => {
    const text = '{"tool":"create_event", oops not json\nrest';
    const { directive, reply } = parseDirective(text);
    expect(directive).toBeNull();
    expect(reply).toBe(text.trim());
  });

  test('JSON object that is not a create_event tool → no directive', () => {
    const { directive, reply } = parseDirective('{"tool":"something_else","x":1}\nbody');
    expect(directive).toBeNull();
    expect(reply).toContain('something_else');
  });

  test('empty input', () => {
    expect(parseDirective('')).toEqual({ directive: null, reply: '' });
    expect(parseDirective(undefined)).toEqual({ directive: null, reply: '' });
  });
});

describe('normaliseEventDirective', () => {
  test('valid spec passes through', () => {
    const spec = normaliseEventDirective({ tool: 'create_event', title: 'Reunion', start: 1000, end: 5000, zone: 'family', venue: 'fairfield' });
    expect(spec).toEqual({ title: 'Reunion', start: 1000, end: 5000, zone: 'family', venue: 'fairfield' });
  });

  test('missing end → start + 3600', () => {
    const spec = normaliseEventDirective({ title: 'X', start: 1000, zone: 'friends' });
    expect(spec.end).toBe(4600);
  });

  test('end <= start → repaired to start + 3600', () => {
    const spec = normaliseEventDirective({ title: 'X', start: 1000, end: 500, zone: 'friends' });
    expect(spec.end).toBe(4600);
  });

  test('invalid zone → defaults to friends', () => {
    const spec = normaliseEventDirective({ title: 'X', start: 1000, end: 2000, zone: 'vip' });
    expect(spec.zone).toBe('friends');
  });

  test('invalid venue → null', () => {
    const spec = normaliseEventDirective({ title: 'X', start: 1000, end: 2000, zone: 'friends', venue: 'narnia' });
    expect(spec.venue).toBeNull();
  });

  test('no title → null', () => {
    expect(normaliseEventDirective({ start: 1000, end: 2000, zone: 'friends' })).toBeNull();
  });

  test('non-numeric start → null', () => {
    expect(normaliseEventDirective({ title: 'X', start: 'soon', zone: 'friends' })).toBeNull();
  });

  test('float timestamps are floored', () => {
    const spec = normaliseEventDirective({ title: 'X', start: 1000.9, end: 2000.9, zone: 'friends' });
    expect(spec.start).toBe(1000);
    expect(spec.end).toBe(2000);
  });
});

// ── truncation ───────────────────────────────────────────────────────────────

describe('truncateReply', () => {
  test('short text is unchanged', () => {
    expect(truncateReply('hello', 280)).toBe('hello');
  });

  test('over-cap text is truncated with an ellipsis', () => {
    const long = 'word '.repeat(100).trim(); // 499 chars
    const out = truncateReply(long, 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith('…')).toBe(true);
  });

  test('breaks on a word boundary when one is near the cap', () => {
    const out = truncateReply('the quick brown fox jumps over', 18);
    expect(out).not.toContain('jum'); // cut at a boundary, not mid-word
    expect(out.endsWith('…')).toBe(true);
  });

  test('default cap is 280', () => {
    const long = 'x'.repeat(400);
    expect(truncateReply(long).length).toBeLessThanOrEqual(280);
  });
});

describe('wantsDetail', () => {
  test('detects explicit detail requests', () => {
    expect(wantsDetail('explain in detail please')).toBe(true);
    expect(wantsDetail('give me the full details')).toBe(true);
    expect(wantsDetail('tell me everything about the zones')).toBe(true);
  });

  test('ordinary requests do not trigger detail', () => {
    expect(wantsDetail('what zones are there?')).toBe(false);
    expect(wantsDetail('book fairfield for saturday')).toBe(false);
  });
});

// ── calendar event building ──────────────────────────────────────────────────

describe('buildCalendarEvent', () => {
  test('produces kind-31923 with seed-script tag shapes', () => {
    const spec = { title: 'Vinyl Listening Night', start: 1800000000, end: 1800007200, zone: 'friends', venue: 'dreamlab' };
    const ev = buildCalendarEvent(spec, 1700000000);
    expect(ev.kind).toBe(31923);
    expect(ev.kind).toBe(kinds.CALENDAR_EVENT);
    expect(ev.created_at).toBe(1700000000);
    expect(ev.tags).toEqual([
      ['d', 'friends-vinyl-listening-night'],
      ['title', 'Vinyl Listening Night'],
      ['start', '1800000000'],
      ['end', '1800007200'],
      ['zone', 'friends'],
      ['venue', 'dreamlab'],
    ]);
  });

  test('omits the venue tag when venue is null', () => {
    const ev = buildCalendarEvent({ title: 'Family Dinner', start: 100, end: 200, zone: 'family', venue: null });
    expect(ev.tags.some((t) => t[0] === 'venue')).toBe(false);
    expect(ev.tags.find((t) => t[0] === 'd')[1]).toBe('family-family-dinner');
  });

  test('slug strips punctuation', () => {
    const ev = buildCalendarEvent({ title: 'Bob & Carol: Q3!', start: 1, end: 2, zone: 'business', venue: null });
    expect(ev.tags.find((t) => t[0] === 'd')[1]).toBe('business-bob--carol-q3');
  });
});

// ── personality prompt sanity ────────────────────────────────────────────────

describe('SYSTEM_PROMPT', () => {
  test('self-identifies as JunkieJarvis and encodes the hard rules', () => {
    expect(SYSTEM_PROMPT).toMatch(/You are JunkieJarvis/);
    expect(SYSTEM_PROMPT).toMatch(/under 280 characters/i);
    expect(SYSTEM_PROMPT).toMatch(/ask john/i);
    expect(SYSTEM_PROMPT).toMatch(/create_event/);
    expect(SYSTEM_PROMPT).toMatch(/Never reveal/i);
    expect(SYSTEM_PROMPT).toMatch(/fairfield/);
    expect(SYSTEM_PROMPT).toMatch(/dreamlab/);
  });
});

// ── JunkieJarvisAgent brain (mocked bridge + LLM) ───────────────────────────

function makeBridge() {
  const published = [];
  const subs = [];
  return {
    published,
    subs,
    subscribe(filter, handler) { subs.push({ filter, handler }); return `sub-${subs.length}`; },
    unsubscribe() {},
    async publish(unsigned, signer) {
      const signed = signer && typeof signer.sign === 'function' ? signer.sign(unsigned) : unsigned;
      published.push(signed);
      return signed;
    },
  };
}

const fakeSigner = {
  // echo a deterministic "signed" event (adds id/sig markers without nostr-tools)
  sign: (ev) => ({ ...ev, id: 'signed-' + (ev.kind), sig: 'x', pubkey: JUNKIEJARVIS_PUBKEY }),
  skBytes: new Uint8Array(32),
  pubkey: JUNKIEJARVIS_PUBKEY,
};

const silentLogger = { info() {}, warn() {}, error() {}, debug() {} };

describe('JunkieJarvisAgent._think', () => {
  test('plain question → truncated reply, no calendar event', async () => {
    const bridge = makeBridge();
    const agent = new JunkieJarvisAgent({
      bridge,
      signer: fakeSigner,
      logger: silentLogger,
      llm: async () => 'The forum has four zones: Landing, Friends, Family, Business.',
    });
    const reply = await agent._think('what zones are there?', { zone: null });
    expect(reply).toMatch(/four zones/);
    expect(bridge.published.length).toBe(0);
  });

  test('create_event directive → publishes kind-31923 and appends confirmation', async () => {
    const bridge = makeBridge();
    const start = 1800000000;
    const agent = new JunkieJarvisAgent({
      bridge,
      signer: fakeSigner,
      logger: silentLogger,
      llm: async () => `{"tool":"create_event","title":"Reunion","start":${start},"end":${start + 7200},"zone":"family","venue":"fairfield"}\nAll set.`,
    });
    const reply = await agent._think('book fairfield for the family reunion', { zone: null });
    expect(bridge.published.length).toBe(1);
    const ev = bridge.published[0];
    expect(ev.kind).toBe(31923);
    expect(ev.tags.find((t) => t[0] === 'zone')[1]).toBe('family');
    expect(ev.tags.find((t) => t[0] === 'venue')[1]).toBe('fairfield');
    expect(reply).toMatch(/All set\./);
    expect(reply).toMatch(/Reunion/);
  });

  test('channel zone overrides the directive zone for write-gating', async () => {
    const bridge = makeBridge();
    const start = 1800000000;
    const agent = new JunkieJarvisAgent({
      bridge,
      signer: fakeSigner,
      logger: silentLogger,
      llm: async () => `{"tool":"create_event","title":"X","start":${start},"end":${start + 60},"zone":"friends","venue":null}\nok`,
    });
    await agent._think('create it', { zone: 'business' });
    expect(bridge.published[0].tags.find((t) => t[0] === 'zone')[1]).toBe('business');
  });

  test('LLM failure surfaces the canned apology (fail-open)', async () => {
    const bridge = makeBridge();
    const agent = new JunkieJarvisAgent({
      bridge,
      signer: fakeSigner,
      logger: silentLogger,
      llm: async () => { throw new Error('llm down'); },
    });
    const reply = await agent._think('hi', { zone: null });
    expect(reply).toBe(CANNED_APOLOGY);
    expect(bridge.published.length).toBe(0);
  });

  test('detail request lifts the truncation cap', async () => {
    const bridge = makeBridge();
    const longAnswer = 'word '.repeat(120).trim(); // ~599 chars
    const agent = new JunkieJarvisAgent({
      bridge,
      signer: fakeSigner,
      logger: silentLogger,
      maxReply: 280,
      llm: async () => longAnswer,
    });
    const reply = await agent._think('explain in detail how zones work', { zone: null });
    expect(reply.length).toBeGreaterThan(280);
  });
});

describe('JunkieJarvisAgent dedup + ignore', () => {
  test('dedup returns true on a repeat id', () => {
    const agent = new JunkieJarvisAgent({ bridge: makeBridge(), signer: fakeSigner, logger: silentLogger, llm: async () => '' });
    expect(agent._dedup('evt-1')).toBe(false);
    expect(agent._dedup('evt-1')).toBe(true);
  });

  test('dedup cap evicts the oldest id', () => {
    const agent = new JunkieJarvisAgent({ bridge: makeBridge(), signer: fakeSigner, logger: silentLogger, llm: async () => '', dedupCap: 2 });
    agent._dedup('a'); agent._dedup('b'); agent._dedup('c'); // evicts 'a'
    expect(agent._dedup('a')).toBe(false); // 'a' is fresh again
    expect(agent._dedup('c')).toBe(true);
  });

  test('JunkieJarvis always ignores its own pubkey', () => {
    const agent = new JunkieJarvisAgent({ bridge: makeBridge(), signer: fakeSigner, logger: silentLogger, llm: async () => '' });
    expect(agent._shouldIgnore(JUNKIEJARVIS_PUBKEY)).toBe(true);
    expect(agent._shouldIgnore(ASKER)).toBe(false);
  });

  test('JUNKIEJARVIS_IGNORE_PUBKEYS list is honoured', () => {
    const bot = 'c'.repeat(64);
    const agent = new JunkieJarvisAgent({ bridge: makeBridge(), signer: fakeSigner, logger: silentLogger, llm: async () => '', ignorePubkeys: [bot] });
    expect(agent._shouldIgnore(bot)).toBe(true);
  });

  test('start() registers two subscriptions (DM + channel)', () => {
    const bridge = makeBridge();
    const agent = new JunkieJarvisAgent({ bridge, signer: fakeSigner, logger: silentLogger, llm: async () => '' });
    agent.start();
    expect(bridge.subs.length).toBe(2);
    expect(bridge.subs[0].filter.kinds).toEqual([kinds.GIFT_WRAP]);
    expect(bridge.subs[0].filter['#p']).toEqual([JUNKIEJARVIS_PUBKEY]);
    expect(bridge.subs[1].filter.kinds).toEqual([kinds.CHANNEL_MESSAGE]);
  });
});

describe('JunkieJarvisAgent channel reply threading', () => {
  test('reply preserves the root e-tag and p-tags the asker', async () => {
    const bridge = makeBridge();
    const agent = new JunkieJarvisAgent({
      bridge,
      signer: fakeSigner,
      logger: silentLogger,
      llm: async () => 'Sure, the events page has it.',
    });
    const srcEvent = {
      kind: 42,
      id: 'msg-1',
      pubkey: ASKER,
      content: '@junkiejarvis where is the events page?',
      tags: [['e', 'channel-root', 'wss://r', 'root'], ['section', 'friends']],
    };
    await agent._handleChannel(srcEvent);
    expect(bridge.published.length).toBe(1);
    const reply = bridge.published[0];
    expect(reply.kind).toBe(42);
    expect(reply.tags).toContainEqual(['e', 'channel-root', 'wss://r', 'root']);
    expect(reply.tags).toContainEqual(['p', ASKER]);
    expect(reply.tags).toContainEqual(['section', 'friends']);
  });

  test('ignores a channel message from itself', async () => {
    const bridge = makeBridge();
    const agent = new JunkieJarvisAgent({ bridge, signer: fakeSigner, logger: silentLogger, llm: async () => 'x' });
    const selfEvent = { kind: 42, id: 'self-1', pubkey: JUNKIEJARVIS_PUBKEY, content: '@junkiejarvis ping', tags: [] };
    await agent._handleChannel(selfEvent);
    expect(bridge.published.length).toBe(0);
  });

  test('ignores a non-mention channel message', async () => {
    const bridge = makeBridge();
    const agent = new JunkieJarvisAgent({ bridge, signer: fakeSigner, logger: silentLogger, llm: async () => 'x' });
    const ev = { kind: 42, id: 'm', pubkey: ASKER, content: 'just chatting amongst ourselves', tags: [] };
    await agent._handleChannel(ev);
    expect(bridge.published.length).toBe(0);
  });
});

describe('startJunkieJarvis gating', () => {
  const saved = {};
  const KEYS = ['JUNKIEJARVIS_ENABLED', 'JUNKIEJARVIS_PRIVKEY_HEX', 'CONCIERGE_PRIVKEY_HEX'];
  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    for (const k of KEYS) delete process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  });

  // Inject a signer factory so the gating logic is tested WITHOUT pulling in
  // nostr-tools' ESM crypto (which jest's CJS transform cannot load). It mirrors
  // signerFromHex's hex validation: a malformed key still yields null.
  const fakeFactory = (hex) => (/^[0-9a-f]{64}$/i.test((hex || '').trim())
    ? { sign: (e) => e, skBytes: new Uint8Array(32), pubkey: 'd'.repeat(64) }
    : null);

  test('disabled by default → returns null, no throw', () => {
    expect(startJunkieJarvis({ bridge: makeBridge(), logger: silentLogger, signerFactory: fakeFactory })).toBeNull();
  });

  test('enabled but no privkey → null (fail-open, warns)', () => {
    process.env.JUNKIEJARVIS_ENABLED = 'true';
    expect(startJunkieJarvis({ bridge: makeBridge(), logger: silentLogger, signerFactory: fakeFactory })).toBeNull();
  });

  test('enabled with a bad privkey → null', () => {
    process.env.JUNKIEJARVIS_ENABLED = 'true';
    process.env.JUNKIEJARVIS_PRIVKEY_HEX = 'nothex';
    expect(startJunkieJarvis({ bridge: makeBridge(), logger: silentLogger, signerFactory: fakeFactory })).toBeNull();
  });

  test('enabled with a valid privkey → starts and subscribes', () => {
    process.env.JUNKIEJARVIS_ENABLED = 'true';
    process.env.JUNKIEJARVIS_PRIVKEY_HEX = '1'.repeat(64);
    const bridge = makeBridge();
    const agent = startJunkieJarvis({ bridge, logger: silentLogger, signerFactory: fakeFactory });
    expect(agent).toBeInstanceOf(JunkieJarvisAgent);
    expect(bridge.subs.length).toBe(2);
    agent.stop();
  });

  test('transition fallback: old CONCIERGE_PRIVKEY_HEX still works', () => {
    process.env.JUNKIEJARVIS_ENABLED = 'true';
    process.env.CONCIERGE_PRIVKEY_HEX = '2'.repeat(64);
    const bridge = makeBridge();
    const agent = startJunkieJarvis({ bridge, logger: silentLogger, signerFactory: fakeFactory });
    expect(agent).toBeInstanceOf(JunkieJarvisAgent);
    agent.stop();
  });
});
