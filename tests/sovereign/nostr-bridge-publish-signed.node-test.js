'use strict';

/**
 * AB-11 — NostrBridge.publishSigned: publish an ALREADY-SIGNED event and learn,
 * per relay, whether the relay answered OK. (`publish` signs internally and is
 * fire-and-forget, so it cannot say whether a revocation reached the relay.)
 *
 *   node --test tests/sovereign/nostr-bridge-publish-signed.node-test.js
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');

const REPO = path.resolve(__dirname, '../..');
const req = createRequire(path.join(REPO, 'mcp/servers/package.json'));
const { WebSocketServer } = req('ws');
const { NostrBridge } = require('../../mcp/servers/nostr-bridge');

const EVENT = { id: 'e'.repeat(64), pubkey: 'a'.repeat(64), created_at: 1, kind: 30078, tags: [], content: '', sig: 's'.repeat(128) };

/** A relay whose per-EVENT behaviour the test scripts. */
function relay(onEvent) {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' }, () => {
      const received = [];
      wss.on('connection', (ws) => {
        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg[0] === 'EVENT') { received.push(msg[1]); onEvent(ws, msg[1], received.length); }
        });
      });
      resolve({ url: `ws://127.0.0.1:${wss.address().port}`, received, close: () => wss.close() });
    });
  });
}

async function withBridge(urls, fn) {
  const bridge = new NostrBridge({ relays: urls, subRefreshIntervalMs: 0 });
  await bridge.connect();
  try { return await fn(bridge); } finally { await bridge.disconnect(); }
}

test('reports ok:true per relay that answers OK true', async () => {
  const r = await relay((ws, ev) => ws.send(JSON.stringify(['OK', ev.id, true, ''])));
  try {
    await withBridge([r.url], async (b) => {
      const res = await b.publishSigned(EVENT, { timeoutMs: 3000 });
      assert.deepEqual(res[r.url], { ok: true, message: '' });
      assert.equal(r.received.length, 1);
    });
  } finally { r.close(); }
});

test('a relay that rejects is ok:false with its reason; another relay can still accept', async () => {
  const bad = await relay((ws, ev) => ws.send(JSON.stringify(['OK', ev.id, false, 'blocked: not allowed'])));
  const good = await relay((ws, ev) => ws.send(JSON.stringify(['OK', ev.id, true, ''])));
  try {
    await withBridge([bad.url, good.url], async (b) => {
      const res = await b.publishSigned(EVENT, { timeoutMs: 3000 });
      assert.equal(res[bad.url].ok, false);
      assert.match(res[bad.url].message, /blocked/);
      assert.equal(res[good.url].ok, true);
    });
  } finally { bad.close(); good.close(); }
});

test('no OK within the timeout is ok:false (timeout), never a hang', async () => {
  const silent = await relay(() => {});
  try {
    await withBridge([silent.url], async (b) => {
      const t0 = Date.now();
      const res = await b.publishSigned(EVENT, { timeoutMs: 300 });
      assert.equal(res[silent.url].ok, false);
      assert.match(res[silent.url].message, /timeout/);
      assert.ok(Date.now() - t0 < 3000);
    });
  } finally { silent.close(); }
});

test('an unreachable relay is ok:false and does not block the others', async () => {
  const good = await relay((ws, ev) => ws.send(JSON.stringify(['OK', ev.id, true, ''])));
  try {
    await withBridge(['ws://127.0.0.1:1', good.url], async (b) => {
      const res = await b.publishSigned(EVENT, { timeoutMs: 600 });
      assert.equal(res['ws://127.0.0.1:1'].ok, false);
      assert.equal(res[good.url].ok, true);
    });
  } finally { good.close(); }
});

test('only the named relays are awaited when `relays` is given', async () => {
  const a = await relay((ws, ev) => ws.send(JSON.stringify(['OK', ev.id, true, ''])));
  const silent = await relay(() => {});
  try {
    await withBridge([a.url, silent.url], async (b) => {
      const res = await b.publishSigned(EVENT, { timeoutMs: 300, relays: [a.url] });
      assert.deepEqual(Object.keys(res), [a.url]);
      assert.equal(res[a.url].ok, true);
    });
  } finally { a.close(); silent.close(); }
});

test('auth-required is retried once after the NIP-42 handshake, then reported', async () => {
  let n = 0;
  const r = await relay((ws, ev) => {
    n += 1;
    ws.send(JSON.stringify(n === 1 ? ['OK', ev.id, false, 'auth-required: authenticate first'] : ['OK', ev.id, true, '']));
  });
  try {
    await withBridge([r.url], async (b) => {
      b.setAuthSigner({ async sign(e) { return { ...e, id: 'x'.repeat(64), pubkey: 'a'.repeat(64), sig: 's'.repeat(128) }; } });
      const res = await b.publishSigned(EVENT, { timeoutMs: 4000, authRetryDelayMs: 50 });
      assert.equal(res[r.url].ok, true);
      assert.equal(r.received.length, 2);
    });
  } finally { r.close(); }
});

test('rejects a malformed event instead of sending it', async () => {
  const r = await relay((ws, ev) => ws.send(JSON.stringify(['OK', ev.id, true, ''])));
  try {
    await withBridge([r.url], async (b) => {
      await assert.rejects(() => b.publishSigned({ kind: 30078 }), /signed event/);
      assert.equal(r.received.length, 0);
    });
  } finally { r.close(); }
});
