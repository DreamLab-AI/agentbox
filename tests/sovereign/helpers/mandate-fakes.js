'use strict';

/**
 * Test doubles for the AB-11 mandate lifecycle: an in-memory pod that stores
 * ACL sidecars (and can fail on cue), a fake pod-owner signer, and a fake relay
 * publisher. Pure objects, no real crypto: the real Schnorr + real pod paths
 * are covered by the node:test suites.
 */

const { SignerUnavailable } = require('../../../management-api/lib/mandate-signer');

const OWNER = 'a'.repeat(64);

function b64(obj) { return Buffer.from(JSON.stringify(obj)).toString('base64'); }

/** In-memory solid pod: sidecars by path, a call log, cue-able failures, optional latency. */
function fakePod({ latencyMs = 0, onRequest } = {}) {
  const files = new Map();
  const calls = [];
  const failures = [];
  const pod = {
    files, calls,
    /** Fail the next `times` requests matching `match` (method or path substring) with `status`. */
    fail(match, status, times = 1) { failures.push({ match, status, times }); },
    clearFailures() { failures.length = 0; },
    async fetchFn(url, init = {}) {
      const method = (init.method || 'GET').toUpperCase();
      const path = new URL(url).pathname;
      calls.push({ method, path, auth: (init.headers || {}).Authorization });
      if (onRequest) await onRequest({ method, path });
      if (latencyMs) await new Promise((r) => setTimeout(r, latencyMs));
      const f = failures.find((x) => x.times > 0 && (x.match === method || path.includes(x.match)));
      if (f) { f.times -= 1; return new Response('boom', { status: f.status }); }
      if (method === 'PUT') { const had = files.has(path); files.set(path, String(init.body)); return new Response(null, { status: had ? 204 : 201 }); }
      if (method === 'DELETE') { const had = files.delete(path); return new Response(null, { status: had ? 204 : 404 }); }
      if (method === 'GET') return files.has(path) ? new Response(files.get(path), { status: 200 }) : new Response('nf', { status: 404 });
      return new Response(null, { status: 405 });
    },
    methods() { return calls.map((c) => c.method); },
  };
  return pod;
}

/** A pod-owner signer. `pubkey` can be changed to simulate a key that is not the issuer. */
function fakeSigner({ pubkey = OWNER, source = 'sovereign', failSign = false } = {}) {
  const s = {
    source, pubkey, signed: [],
    failSign,
    async nip98(method, url, body) {
      return `Nostr ${b64({ kind: 27235, pubkey: s.pubkey, tags: [['u', url], ['method', method]], body: body || null })}`;
    },
    async signEvent(unsigned) {
      if (s.failSign) throw new Error('signer died');
      const ev = { ...unsigned, id: `${s.signed.length}`.padStart(64, 'e'), pubkey: s.pubkey, sig: 's'.repeat(128) };
      s.signed.push(ev);
      return ev;
    },
  };
  return s;
}

/** Scripted relay publisher: ok by default; set `down` to fail. */
function fakePublisher() {
  const p = {
    events: [], down: false, calls: 0,
    async publish(ev) {
      p.calls += 1;
      if (p.down) return { ok: false, reason: 'relay down', results: { 'ws://127.0.0.1:7777': { ok: false, message: 'timeout' } } };
      p.events.push(ev);
      return { ok: true, results: { 'ws://127.0.0.1:7777': { ok: true, message: '' } } };
    },
  };
  return p;
}

/** Assemble the `deps` the lifecycle accepts. */
function makeDeps({ pod = fakePod(), signer = fakeSigner(), publisher = fakePublisher(), now, emitted = [] } = {}) {
  let clock = now || 1_800_000_000;
  const deps = {
    pod, signer, publisher, emitted,
    resolveSigner: async () => {
      if (!deps.signer) throw new SignerUnavailable('no signer');
      return deps.signer;
    },
    podEndpoints: () => ({ connectBase: 'http://127.0.0.1:8484', signedBase: 'https://pods.example' }),
    fetchFn: (...a) => pod.fetchFn(...a),
    spaceReplays: false,
    publisher,
    now: () => clock,
    tick: (s = 1) => { clock += s; },
    emit: (e) => emitted.push(e),
  };
  return deps;
}

const logger = { debug() {}, info() {}, warn() {}, error() {} };

module.exports = { OWNER, fakePod, fakeSigner, fakePublisher, makeDeps, logger, b64 };
