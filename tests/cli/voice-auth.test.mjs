import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const source = readFileSync(new URL('../../voice/console/site/app.js', import.meta.url), 'utf8');
function client(signEvent = async event => event) {
  const sockets = [];
  const storage = new Map();
  const state = { textContent: '', classList: { add() {} } };
  const timers = new Map();
  let timer = 0;
  const context = vm.createContext({
    document: { getElementById: () => state, hidden: false },
    window: { nostr: { signEvent } }, location: { origin: 'https://voice.test', host: 'voice.test' },
    crypto: webcrypto, TextEncoder, AbortController, console,
    btoa: str => Buffer.from(str).toString('base64'),
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    setTimeout: fn => { timers.set(++timer, fn); return timer; },
    clearTimeout: id => timers.delete(id),
    WebSocket: class {
      constructor(url) { this.url = url; sockets.push(this); }
      close() { this.closed = true; this.onclose?.(); }
    },
  });
  vm.runInContext(source.slice(0, source.indexOf('// ── toast')), context);
  vm.runInContext(source.slice(source.indexOf('let feedWs ='), source.indexOf('// ── AoE session board')), context);
  return { context, sockets, storage, timers, run: code => vm.runInContext(code, context) };
}

test('active login uses cookie feed without invoking Podkey or a saved bearer', async () => {
  const c = client(() => { throw new Error('must not sign'); });
  c.storage.set('agentbox-bearer', 'old-token');
  await c.run('sessionActive = true; connectFeed()');
  assert.equal(c.sockets[0].url, 'wss://voice.test/feed');
});

test('superseded asynchronous signer cannot replace a newer cookie connection', async () => {
  let finish;
  const c = client(event => new Promise(resolve => { finish = () => resolve(event); }));
  const pending = c.run('connectFeed()');
  await c.run('sessionActive = true; reconnectFeed()');
  finish();
  await pending;
  assert.equal(c.sockets.length, 1);
  assert.equal(c.sockets[0].url, 'wss://voice.test/feed');
});

test('reconnect closes the previous socket without queuing another reconnect', async () => {
  const c = client();
  await c.run('sessionActive = true; connectFeed()');
  await c.run('reconnectFeed()');
  assert.equal(c.sockets.length, 2);
  assert.equal(c.sockets[0].closed, true);
  assert.equal(c.timers.size, 0);
});

test('cookie-less fallback uses the proxy bearer query carrier', async () => {
  const c = client();
  c.storage.set('agentbox-bearer', 'test-token');
  await c.run('connectFeed()');
  assert.equal(c.sockets[0].url, 'wss://voice.test/feed?access_token=test-token');
});

test('repeated signed requests include distinct nonces', async () => {
  const events = [];
  const c = client(async event => { events.push(event); return event; });
  await c.run("signNip98('GET', '/feed')");
  await c.run("signNip98('GET', '/feed')");
  assert.notEqual(events[0].tags.find(t => t[0] === 'nonce')[1], events[1].tags.find(t => t[0] === 'nonce')[1]);
});
