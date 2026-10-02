'use strict';

/**
 * ADR-2103 interim receipt (amended 2026-10-02): the sidestr producer is
 * healthy only while its tip is fresh. Supervisor RUNNING is not health — the
 * producer has sat RUNNING while wedged (invalid-tx retry loop, 23 Sep) and
 * while making nothing (25-29 Sep).
 *
 * Runner: node:test (`node --test tests/sovereign/sidechain-health.node-test.js`,
 * wired into management-api `npm run test:node`).
 *
 * The fixture cases always run. The loopback case starts a throwaway level-1
 * chain from the upstream `siding` checkout (SIDESTR_UPSTREAM, default
 * $WORKSPACE/sidestr/upstream) at 2 s blocks on a loopback port, with no
 * parent and no relays, then `kill -STOP`s it and asserts the probe goes red
 * within one interval. It is skipped, and says so, where the checkout is
 * absent (public CI). Its signer key lives in a temporary directory and is
 * never read by the test.
 */

const { describe, test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const Fastify = require('../../management-api/node_modules/fastify');
const { createTipProbe, judge, chainsFromManifest } = require('../../management-api/lib/sidechain-health');
const systemRoutes = require('../../management-api/routes/system');

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const NOW = 1790971672;

function fixtureStatus(over = {}) {
  return {
    chain: 'sidestr:dreamlab', parent: 'tbtc4', height: 942,
    hash: '11d6d76e66e63fd5e3bc329abc5df74ef79b503e6e3085a1affc4fd4bb2c14ce',
    time: NOW, coins: 63, mempool: 0, checkpoints: null, interval: 600, ...over,
  };
}

function fakeFetch(statusRef) {
  return async () => {
    if (statusRef.error) throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    return { ok: true, status: 200, json: async () => statusRef.value };
  };
}

describe('judge (pure)', () => {
  test('a fresh tip with an empty mempool is healthy', () => {
    const r = judge(fixtureStatus({ time: NOW - 300 }), { nowS: NOW });
    assert.equal(r.status, 'healthy');
    assert.equal(r.threshold_s, 1200);
    assert.equal(r.tip_age_s, 300);
  });

  test('a stale tip (older than 2 x 600 s) is unhealthy', () => {
    const r = judge(fixtureStatus({ time: NOW - 1201 }), { nowS: NOW });
    assert.equal(r.status, 'unhealthy');
    assert.match(r.reason, /tip 942 is 1201s old \(limit 1200s = 2 x 600s\)/);
  });

  test('exactly 2 x interval is still healthy (strictly older is stale)', () => {
    assert.equal(judge(fixtureStatus({ time: NOW - 1200 }), { nowS: NOW }).status, 'healthy');
  });

  test('the status route\'s own interval wins over the default', () => {
    const r = judge(fixtureStatus({ time: NOW - 5, interval: 2 }), { nowS: NOW });
    assert.equal(r.status, 'unhealthy');
    assert.equal(r.threshold_s, 4);
  });

  test('transactions waiting past 2 x 10 s with no block are unhealthy', () => {
    const r = judge(fixtureStatus({ time: NOW - 100, mempool: 1 }), { nowS: NOW, pendingSinceS: NOW - 21 });
    assert.equal(r.status, 'unhealthy');
    assert.match(r.reason, /1 transaction\(s\) waiting 21s with no block \(limit 20s/);
  });

  test('a transaction that just arrived against an old tip is not a false alarm', () => {
    const r = judge(fixtureStatus({ time: NOW - 500, mempool: 1 }), { nowS: NOW, pendingSinceS: NOW - 1 });
    assert.equal(r.status, 'healthy');
  });

  test('a stale tip is red even on a first reading with transactions waiting', () => {
    const r = judge(fixtureStatus({ time: NOW - 5000, mempool: 3 }), { nowS: NOW, pendingSinceS: NOW });
    assert.equal(r.status, 'unhealthy');
  });

  test('unreachable is unhealthy, never unknown', () => {
    const r = judge(null, { nowS: NOW, error: 'ECONNREFUSED' });
    assert.equal(r.status, 'unhealthy');
    assert.match(r.reason, /unreachable: ECONNREFUSED/);
    assert.equal(r.anchored, false);
  });

  test('a status with no tip fields is unhealthy', () => {
    assert.equal(judge({ chain: 'x' }, { nowS: NOW }).status, 'unhealthy');
  });

  test('anchored is false with checkpoints off, true only with a reported checkpoint', () => {
    assert.equal(judge(fixtureStatus(), { nowS: NOW }).anchored, false);
    const last = { height: 940, txid: 'ab'.repeat(32) };
    const r = judge(fixtureStatus({ checkpoints: { every: 10, count: 1, last } }), { nowS: NOW });
    assert.equal(r.anchored, true);
    assert.deepEqual(r.checkpoint, last);
  });
});

describe('createTipProbe (stateful)', () => {
  test('the pending clock starts at first sight and turns red after 2 x tx interval', async () => {
    let nowMs = NOW * 1000;
    const ref = { value: fixtureStatus({ time: NOW - 100, mempool: 2 }) };
    const probe = createTipProbe({ url: 'http://fixture/', fetch: fakeFetch(ref), now: () => nowMs, cacheMs: 0 });
    assert.equal((await probe.probe()).status, 'healthy');
    nowMs += 15_000;
    assert.equal((await probe.probe()).status, 'healthy');
    nowMs += 6_000;
    const red = await probe.probe();
    assert.equal(red.status, 'unhealthy');
    assert.equal(red.pending_s, 21);
    // A new block drains the mempool: green again, and the pending clock resets.
    ref.value = fixtureStatus({ time: Math.floor(nowMs / 1000), hash: 'cd'.repeat(32), height: 943 });
    assert.equal((await probe.probe()).status, 'healthy');
  });

  test('readings are cached for cacheMs', async () => {
    let calls = 0;
    const fetch = async () => { calls += 1; return { ok: true, json: async () => fixtureStatus() }; };
    const probe = createTipProbe({ url: 'http://fixture/', fetch, now: () => NOW * 1000, cacheMs: 5000 });
    await probe.probe(); await probe.probe(); await probe.probe();
    assert.equal(calls, 1);
  });

  test('a non-2xx answer is unhealthy', async () => {
    const fetch = async () => ({ ok: false, status: 502, json: async () => ({}) });
    const probe = createTipProbe({ url: 'http://fixture/', fetch, now: () => NOW * 1000, cacheMs: 0 });
    const r = await probe.probe();
    assert.equal(r.status, 'unhealthy');
    assert.match(r.reason, /http_502/);
  });
});

describe('/v1/system carries the probe', () => {
  async function build(statusRef, enabled = true) {
    const app = Fastify();
    const tipProbe = createTipProbe({ url: 'http://fixture/', fetch: fakeFetch(statusRef), now: () => NOW * 1000, cacheMs: 0 });
    const tipProbes = enabled ? { sidechain: tipProbe } : {};
    await app.register(systemRoutes, { logger, manifest: { sidechain: { enabled } }, adapters: null, tipProbes });
    await app.ready();
    return app;
  }

  test('a stale tip marks the sidechain module and the top-level health block', async () => {
    const app = await build({ value: fixtureStatus({ time: NOW - 1300 }) });
    const body = (await app.inject({ method: 'GET', url: '/v1/system' })).json();
    const mod = body.modules.find((m) => m.id === 'sidechain');
    assert.equal(mod.state, 'on');
    assert.equal(mod.health.status, 'unhealthy');
    assert.equal(mod.health.anchored, false);
    assert.deepEqual(body.health, { ok: false, probed: ['sidechain'], unhealthy: ['sidechain'] });
    await app.close();
  });

  test('a fresh tip reports ok', async () => {
    const app = await build({ value: fixtureStatus({ time: NOW - 10 }) });
    const body = (await app.inject({ method: 'GET', url: '/v1/system' })).json();
    assert.equal(body.health.ok, true);
    assert.equal(body.modules.find((m) => m.id === 'sidechain').health.status, 'healthy');
    await app.close();
  });

  test('sidechain off: no probe, no health claim', async () => {
    const app = await build({ value: fixtureStatus() }, false);
    const body = (await app.inject({ method: 'GET', url: '/v1/system' })).json();
    const mod = body.modules.find((m) => m.id === 'sidechain');
    assert.equal(mod.state, 'off');
    assert.equal(mod.health, undefined);
    assert.deepEqual(body.health, { ok: true, probed: [], unhealthy: [] });
    await app.close();
  });
});

describe('chainsFromManifest', () => {
  test('sidechain off: no chain is probed, whatever the sub-tables say', () => {
    assert.deepEqual(chainsFromManifest({ sidechain: { enabled: false, 'dreamlab-txbt4': { enabled: true, port: 3451 } } }), []);
  });

  test('the base chain, plus each enabled sub-table on its own port and interval', () => {
    const c = chainsFromManifest({ sidechain: { enabled: true, mirror: true,
      'dreamlab-txbt4': { enabled: true, port: 3451, interval: 300 }, other: { enabled: false, port: 3452 } } });
    assert.deepEqual(c.map((x) => [x.id, x.chain, x.url, x.idleIntervalS]), [
      ['sidechain', 'sidestr:dreamlab', 'http://127.0.0.1:3450/', 600],
      ['sidechain-dreamlab-txbt4', 'sidestr:dreamlab-txbt4', 'http://127.0.0.1:3451/', 300],
    ]);
  });

  test('the second chain\'s catalogue entry carries its probe on /v1/system', async () => {
    const app = Fastify();
    const fresh = createTipProbe({ url: 'http://a/', fetch: fakeFetch({ value: fixtureStatus({ time: NOW - 10 }) }), now: () => NOW * 1000, cacheMs: 0 });
    const stale = createTipProbe({ url: 'http://b/', fetch: fakeFetch({ value: fixtureStatus({ time: NOW - 5000 }) }), now: () => NOW * 1000, cacheMs: 0 });
    await app.register(systemRoutes, { logger, manifest: { sidechain: { enabled: true, 'dreamlab-txbt4': { enabled: true } } }, adapters: null,
      tipProbes: { sidechain: fresh, 'sidechain-dreamlab-txbt4': stale } });
    await app.ready();
    const body = (await app.inject({ method: 'GET', url: '/v1/system' })).json();
    assert.equal(body.modules.find((m) => m.id === 'sidechain-dreamlab-txbt4').health.status, 'unhealthy');
    assert.deepEqual(body.health.unhealthy, ['sidechain-dreamlab-txbt4']);
    await app.close();
  });
});

// ── Loopback siding: kill -STOP turns the probe red within the interval ─────
const UP = process.env.SIDESTR_UPSTREAM || path.join(process.env.WORKSPACE || path.join(os.homedir(), 'workspace'), 'sidestr', 'upstream');
const SIDING = path.join(UP, 'spec', 'siding', 'bin', 'siding.mjs');
const haveUpstream = fs.existsSync(SIDING) && fs.existsSync(path.join(UP, 'schema')) && fs.existsSync(path.join(UP, 'blaketestnode'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('loopback siding at 2 s blocks', { skip: haveUpstream ? false : `no upstream siding checkout at ${UP}` }, () => {
  let dir; let child;
  after(() => {
    if (child && child.exitCode === null) {
      try { process.kill(child.pid, 'SIGCONT'); } catch (_) { /* gone */ }
      child.kill('SIGKILL');
    }
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  test('green while producing; red within one interval of kill -STOP', { timeout: 60_000 }, async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'siding-probe-'));
    const env = { ...process.env, SCHEMA: path.join(UP, 'schema'), BLAKETESTNODE: path.join(UP, 'blaketestnode') };
    const doc = path.join(dir, 'chain.json');
    const made = spawnSync(process.execPath, [SIDING, 'new', '--name', 'probetest', '--prefix', 'prb', '--parent', 'tbtc4',
      '--out', doc, '--key-file', path.join(dir, 'signer.key'), '--dir', path.join(dir, 'd')], { env, encoding: 'utf8', timeout: 30_000 });
    assert.equal(made.status, 0, `siding new failed: ${made.stderr}`);
    const port = 39000 + Math.floor(Math.random() * 900);
    child = spawn(process.execPath, [SIDING, 'produce', '--chain', doc, '--dir', path.join(dir, 'd'),
      '--key-file', path.join(dir, 'signer.key'), '--port', String(port), '--interval', '2', '--tx-interval', '1'],
    { env, stdio: 'ignore' });

    const probe = createTipProbe({ url: `http://127.0.0.1:${port}/`, cacheMs: 0, timeoutMs: 1000, txIntervalS: 1 });
    let green = null;
    for (let i = 0; i < 40 && !green; i += 1) {
      await sleep(500);
      const r = await probe.probe();
      if (r.status === 'healthy' && r.height >= 1) green = r;
    }
    assert.ok(green, 'the loopback producer never reported a fresh tip');
    assert.equal(green.threshold_s, 4, 'the probe reads the producer\'s own 2 s interval');
    assert.equal(green.anchored, false);

    process.kill(child.pid, 'SIGSTOP');
    const stoppedAt = Date.now();
    const red = await probe.probe();
    const elapsed = Date.now() - stoppedAt;
    assert.equal(red.status, 'unhealthy');
    assert.ok(elapsed <= 2000, `red after ${elapsed} ms, interval is 2000 ms`);
    assert.match(red.reason, /unreachable: timeout/);

    process.kill(child.pid, 'SIGCONT');
    let back = null;
    for (let i = 0; i < 20 && !back; i += 1) {
      await sleep(500);
      const r = await probe.probe();
      if (r.status === 'healthy') back = r;
    }
    assert.ok(back, 'the probe did not recover after SIGCONT');
  });
});
