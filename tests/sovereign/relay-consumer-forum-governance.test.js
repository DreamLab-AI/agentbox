'use strict';

/**
 * relay-consumer — forum governance ingress ([sovereign_mesh.forum_governance]).
 *
 * A forum admin's signed 31403 lives on the public forum relay and carries no
 * `p` tag for a local npub, so the loopback path never sees it. These tests
 * pin the extra subscription: off unless relay AND roster are set, a
 * persisted `since` cursor on every REQ, roster + signature + dedup checks at
 * the consumer, and the one-shot 31402 fetch the orchestrator falls back to.
 *
 * No sockets: the forum bridge is a recording double, and the loopback bridge
 * is swapped for one before start().
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { RelayConsumer } = require('../../mcp/nostr-bridge/relay-consumer');

const ADMIN = '1'.repeat(64);
const STRANGER = '2'.repeat(64);
const RELAY = 'wss://forum.example/relay';
const NOW_MS = 1_790_000_000_000;
const NOW_S = NOW_MS / 1000;

const quietLogger = { info() {}, warn() {}, error() {}, debug() {} };

/** A NostrBridge double that records subscriptions and lets a test feed them. */
function fakeBridge() {
  const subs = new Map();
  let n = 0;
  return {
    subs,
    unsubscribed: [],
    authSigner: null,
    connected: false,
    setAuthSigner(s) { this.authSigner = s; },
    connect() { this.connected = true; return Promise.resolve(); },
    disconnect() { this.connected = false; return Promise.resolve(); },
    subscribe(filter, handler, opts = {}) {
      const id = `sub-${++n}`;
      subs.set(id, { filter, handler, opts });
      return id;
    },
    unsubscribe(id) { this.unsubscribed.push(id); subs.delete(id); },
    /** The REQ filter the real bridge would put on the wire now. */
    wireFilter(id) {
      const s = subs.get(id);
      return s.opts.since ? { ...s.filter, since: s.opts.since() } : s.filter;
    },
  };
}

function decision(over = {}) {
  return {
    id: 'd'.repeat(64),
    pubkey: ADMIN,
    kind: 31403,
    created_at: NOW_S - 100,
    tags: [['d', 'ab'.repeat(32)], ['e', 'e'.repeat(64)]],
    content: JSON.stringify({ action: 'promote', iri: 'urn:ngm:class:knowledge-graph' }),
    sig: 's'.repeat(128),
    ...over,
  };
}

function makeConsumer({ dir, signers = [ADMIN], relayUrl = RELAY, verify = () => true, orchestrator } = {}) {
  const forum = fakeBridge();
  const orch = orchestrator || { calls: [], async handleGovernanceDecision(ev, opts) { this.calls.push({ ev, opts }); return {}; } };
  const consumer = new RelayConsumer({
    npubs: ['npub1local'],
    podRoot: dir,
    relayUrls: ['ws://127.0.0.1:1'],
    adapters: { orchestrator: orch },
    verifyEvent: verify,
    now: () => NOW_MS,
    logger: quietLogger,
    forumGovernance: {
      relayUrl,
      signers,
      stateFile: path.join(dir, 'state', 'cursor.json'),
      bridge: forum,
      authSigner: { sign: async (e) => e },
    },
  });
  // The loopback bridge is not under test; keep it off the network.
  consumer._bridge = fakeBridge();
  return { consumer, forum, orch };
}

const flush = () => new Promise((r) => setImmediate(r));

describe('RelayConsumer forum governance', () => {
  let dir;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'forum-gov-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const forumSub = (forum) => [...forum.subs.entries()].find(([, s]) => (s.filter.kinds || []).includes(31403));

  test('off unless BOTH the relay and a roster are set — no forum subscription at all', async () => {
    for (const cfg of [{ signers: [] }, { relayUrl: '' }, { signers: ['not-hex'] }]) {
      const { consumer, forum } = makeConsumer({ dir, ...cfg });
      await consumer.start();
      expect(forum.connected).toBe(false);
      expect(forum.subs.size).toBe(0);
      await consumer.stop();
    }
  });

  test('defaults read the env: relay + csv roster, malformed entries dropped', () => {
    const prev = { r: process.env.AGENTBOX_FORUM_GOVERNANCE_RELAY, s: process.env.AGENTBOX_FORUM_GOVERNANCE_SIGNERS };
    process.env.AGENTBOX_FORUM_GOVERNANCE_RELAY = RELAY;
    process.env.AGENTBOX_FORUM_GOVERNANCE_SIGNERS = ` ${ADMIN.toUpperCase()} ,junk,`;
    try {
      const c = new RelayConsumer({ npubs: ['npub1local'], podRoot: dir, relayUrls: ['ws://127.0.0.1:1'], logger: quietLogger });
      expect(c._forum.enabled).toBe(true);
      expect(c._forum.relayUrl).toBe(RELAY);
      expect([...c._forum.signers]).toEqual([ADMIN]);
      expect(c._forum.stateFile).toBe(path.join(dir, 'pods', 'npub1local', 'events', 'forum-governance', 'cursor.json'));
    } finally {
      for (const [k, v] of [['AGENTBOX_FORUM_GOVERNANCE_RELAY', prev.r], ['AGENTBOX_FORUM_GOVERNANCE_SIGNERS', prev.s]]) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  });

  test('first start subscribes {kinds:[31403], authors:roster} from a week back, after registering the NIP-42 signer', async () => {
    const { consumer, forum } = makeConsumer({ dir });
    await consumer.start();
    expect(forum.authSigner).not.toBeNull();
    expect(forum.connected).toBe(true);
    const [id] = forumSub(forum);
    expect(forum.wireFilter(id)).toEqual({
      kinds: [31403],
      authors: [ADMIN],
      since: NOW_S - 7 * 24 * 3600 - 60,
    });
    await consumer.stop();
  });

  test('the cursor is persisted, and a restart (and every re-issue) asks only from it', async () => {
    const first = makeConsumer({ dir });
    await first.consumer.start();
    const [id] = forumSub(first.forum);
    first.forum.subs.get(id).handler(decision({ created_at: NOW_S - 100 }), RELAY);
    await flush();

    const state = JSON.parse(fs.readFileSync(path.join(dir, 'state', 'cursor.json'), 'utf8'));
    expect(state.cursor).toBe(NOW_S - 100);
    expect(Object.keys(state.seen)).toEqual(['d'.repeat(64)]);
    // The live subscription's next refresh carries the advanced cursor.
    expect(first.forum.wireFilter(id).since).toBe(NOW_S - 160);
    await first.consumer.stop();

    const second = makeConsumer({ dir });
    await second.consumer.start();
    const [id2] = forumSub(second.forum);
    expect(second.forum.wireFilter(id2).since).toBe(NOW_S - 160);
    // The same decision re-delivered inside the slack window is NOT re-applied.
    second.forum.subs.get(id2).handler(decision({ created_at: NOW_S - 100 }), RELAY);
    await flush();
    expect(second.orch.calls).toHaveLength(0);
    expect(second.consumer.metrics().forum_governance_rejected_duplicate).toBe(1);
    await second.consumer.stop();
  });

  test('a roster decision is dispatched with no p tag, and with a request fetcher', async () => {
    const { consumer, forum, orch } = makeConsumer({ dir });
    await consumer.start();
    const [id] = forumSub(forum);
    forum.subs.get(id).handler(decision(), RELAY);
    await flush();
    expect(orch.calls).toHaveLength(1);
    expect(orch.calls[0].ev.id).toBe('d'.repeat(64));
    expect(typeof orch.calls[0].opts.fetchRequest).toBe('function');
    expect(consumer.metrics().forum_governance_accepted).toBe(1);
    // The durable record lands beside the other governance events.
    expect(fs.existsSync(path.join(dir, 'pods', 'npub1local', 'events', 'governance', `${'d'.repeat(64)}.json`))).toBe(true);
    await consumer.stop();
  });

  test('a non-roster author is dropped at the consumer even if the relay returns it', async () => {
    const { consumer, forum, orch } = makeConsumer({ dir });
    await consumer.start();
    const [id] = forumSub(forum);
    forum.subs.get(id).handler(decision({ pubkey: STRANGER }), RELAY);
    await flush();
    expect(orch.calls).toHaveLength(0);
    expect(consumer.metrics().forum_governance_rejected_author).toBe(1);
    expect(fs.existsSync(path.join(dir, 'state', 'cursor.json'))).toBe(false);
    await consumer.stop();
  });

  test('a bad signature is dropped before anything else', async () => {
    const { consumer, forum, orch } = makeConsumer({ dir, verify: () => false });
    await consumer.start();
    const [id] = forumSub(forum);
    forum.subs.get(id).handler(decision(), RELAY);
    await flush();
    expect(orch.calls).toHaveLength(0);
    expect(consumer.metrics().forum_governance_rejected_sig).toBe(1);
    await consumer.stop();
  });

  test('a future-dated decision cannot drag the cursor past now', async () => {
    const { consumer, forum } = makeConsumer({ dir });
    await consumer.start();
    const [id] = forumSub(forum);
    forum.subs.get(id).handler(decision({ created_at: NOW_S + 86400 }), RELAY);
    await flush();
    expect(consumer._forum.cursor).toBe(NOW_S);
    await consumer.stop();
  });

  test('the cursor is persisted only once the decision has been handled (a crash mid-apply re-delivers it)', async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const orchestrator = { async handleGovernanceDecision() { await gate; } };
    const { consumer, forum } = makeConsumer({ dir, orchestrator });
    await consumer.start();
    const [id] = forumSub(forum);
    forum.subs.get(id).handler(decision(), RELAY);
    await flush();
    expect(fs.existsSync(path.join(dir, 'state', 'cursor.json'))).toBe(false);
    release();
    await consumer._forum.chain;
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'state', 'cursor.json'), 'utf8')).cursor).toBe(NOW_S - 100);
    await consumer.stop();
  });

  test('decisions are applied one at a time', async () => {
    const order = [];
    let release;
    const gate = new Promise((r) => { release = r; });
    const orchestrator = {
      async handleGovernanceDecision(ev) {
        order.push(`start ${ev.id[0]}`);
        if (ev.id[0] === 'a') await gate;
        order.push(`end ${ev.id[0]}`);
      },
    };
    const { consumer, forum } = makeConsumer({ dir, orchestrator });
    await consumer.start();
    const [id] = forumSub(forum);
    forum.subs.get(id).handler(decision({ id: 'a'.repeat(64) }), RELAY);
    forum.subs.get(id).handler(decision({ id: 'b'.repeat(64) }), RELAY);
    await flush();
    expect(order).toEqual(['start a']);
    release();
    await consumer._forum.chain;
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
    await consumer.stop();
  });

  describe('_fetchForumRequest', () => {
    const REQ_ID = 'e'.repeat(64);
    const request = { id: REQ_ID, kind: 31402, pubkey: STRANGER, created_at: 1, tags: [['d', 'ab'.repeat(32)]], content: '{}', sig: 'x' };

    test('one {ids, kinds:[31402], limit:1} REQ, resolved with the verified event, then CLOSEd', async () => {
      const { consumer, forum } = makeConsumer({ dir });
      await consumer.start();
      const pending = consumer._fetchForumRequest(REQ_ID);
      const [fid, sub] = [...forum.subs.entries()].find(([, s]) => s.filter.ids);
      expect(sub.filter).toEqual({ ids: [REQ_ID], kinds: [31402], limit: 1 });
      expect(sub.opts.since).toBeUndefined();
      sub.handler({ ...request, id: 'f'.repeat(64) }); // not the id asked for
      sub.handler(request);
      await expect(pending).resolves.toEqual(request);
      expect(forum.unsubscribed).toContain(fid);
      await consumer.stop();
    });

    test('EOSE with nothing found resolves null and CLOSEs', async () => {
      const { consumer, forum } = makeConsumer({ dir });
      await consumer.start();
      const pending = consumer._fetchForumRequest(REQ_ID);
      const [fid, sub] = [...forum.subs.entries()].find(([, s]) => s.filter.ids);
      sub.opts.onEose(RELAY);
      await expect(pending).resolves.toBeNull();
      expect(forum.unsubscribed).toContain(fid);
      await consumer.stop();
    });

    test('an event whose signature fails is never returned', async () => {
      const { consumer, forum } = makeConsumer({ dir, verify: (e) => e.kind !== 31402 });
      await consumer.start();
      const pending = consumer._fetchForumRequest(REQ_ID);
      const [, sub] = [...forum.subs.entries()].find(([, s]) => s.filter.ids);
      sub.handler(request);
      sub.opts.onEose(RELAY);
      await expect(pending).resolves.toBeNull();
      await consumer.stop();
    });

    test('a malformed id issues no REQ', async () => {
      const { consumer, forum } = makeConsumer({ dir });
      await consumer.start();
      const before = forum.subs.size;
      await expect(consumer._fetchForumRequest('../../etc')).resolves.toBeNull();
      expect(forum.subs.size).toBe(before);
      await consumer.stop();
    });
  });
});
