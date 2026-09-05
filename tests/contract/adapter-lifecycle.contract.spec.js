'use strict';

/**
 * ADR-2004 acceptance — adapter connect lifecycle.
 *
 * The estate review reproduced three holes in the previous inline connect
 * phase, each covered here against the ACTUAL lifecycle module:
 *
 *   L1  a single aggregate 10 s race, so a never-settling connect() left the
 *       slot holding its original adapter in an unknown state while startup
 *       continued and dispatch stayed reachable;
 *   L2  a failed `off` replacement was swallowed, leaving the degraded original
 *       wired and still receiving dispatch;
 *   L3  no per-slot readiness — a slot caught by the aggregate timeout had no
 *       health value set at all.
 *
 * No real adapter, sidecar, persistence or network is involved: every adapter
 * here is a local fake whose connect() resolves, rejects or never settles.
 *
 * Run: npx jest tests/contract/adapter-lifecycle.contract.spec.js --testEnvironment node
 *      (jest provides the `test` global; assertions use node:assert/strict)
 */

const assert = require('node:assert/strict');

const {
  connectAdapters, connectTimeoutFor, quarantineAdapter, toLegacyHealth,
  AdapterQuarantined, DEFAULT_CONNECT_TIMEOUT_MS,
} = require('../../management-api/adapters/lifecycle');

const SLOTS = ['beads', 'pods', 'memory', 'events', 'orchestrator'];

/**
 * A fake adapter whose connect() behaviour is scripted.
 *
 * @param {object} opts
 * @param {'resolve'|'reject'|'hang'|'late-resolve'|'late-reject'|'none'} opts.connect
 * @param {number} [opts.delayMs]
 */
function fakeAdapter({ connect = 'resolve', delayMs = 0, impl = 'fake' } = {}) {
  const a = {
    _implName: impl,
    calls: [],
    async store(...args) { this.calls.push(['store', ...args]); return { ok: true }; },
    async write(...args) { this.calls.push(['write', ...args]); return { ok: true }; },
    async disconnect() { this.calls.push(['disconnect']); },
  };
  if (connect === 'none') return a;
  a.connect = () => {
    if (connect === 'resolve') return delayMs ? new Promise((r) => setTimeout(r, delayMs)) : Promise.resolve();
    if (connect === 'reject') return Promise.reject(new Error('sidecar refused the connection'));
    if (connect === 'hang') return new Promise(() => {});
    if (connect === 'late-resolve') return new Promise((r) => setTimeout(r, delayMs || 200));
    if (connect === 'late-reject') return new Promise((_, rej) => setTimeout(() => rej(new Error('late failure')), delayMs || 200));
    return Promise.resolve();
  };
  return a;
}

/** Build an all-slots adapter map, overriding named slots. */
function adapterMap(overrides = {}) {
  const m = {};
  for (const slot of SLOTS) m[slot] = overrides[slot] || fakeAdapter({ connect: 'resolve', impl: `${slot}-impl` });
  return m;
}

const fastManifest = (ms = 60) => ({ adapters: { connect_timeout_ms: ms } });
const offAdapter = () => ({ _implName: 'off', async store() { const e = new Error('AdapterDisabled'); e.name = 'AdapterDisabled'; throw e; } });

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

test('every slot connecting cleanly reports ready and healthy', async () => {
  const adapters = adapterMap();
  const { readiness, healthy } = await connectAdapters({
    slots: SLOTS, adapters, manifest: fastManifest(), resolveOff: offAdapter,
  });
  assert.equal(healthy, true);
  for (const slot of SLOTS) {
    assert.equal(readiness[slot].state, 'ready', `${slot} should be ready`);
    assert.equal(readiness[slot].failureMode, null);
  }
  assert.deepEqual(toLegacyHealth(readiness), {
    beads: 'healthy', pods: 'healthy', memory: 'healthy', events: 'healthy', orchestrator: 'healthy',
  });
});

test('a slot with no connect() hook is reported without pretending it connected', async () => {
  const adapters = adapterMap({ events: fakeAdapter({ connect: 'none' }) });
  const { readiness } = await connectAdapters({
    slots: SLOTS, adapters, manifest: fastManifest(), resolveOff: offAdapter,
  });
  assert.equal(readiness.events.state, 'ready');
  assert.match(readiness.events.reason, /no connect\(\) hook/);
});

// ---------------------------------------------------------------------------
// L1 — never-settling connect
// ---------------------------------------------------------------------------

test('L1: a never-settling connect fails its own slot rather than continuing ambiguously', async () => {
  const hung = fakeAdapter({ connect: 'hang', impl: 'hung-impl' });
  const adapters = adapterMap({ memory: hung });
  const { readiness, healthy } = await connectAdapters({
    slots: SLOTS, adapters, manifest: fastManifest(50), resolveOff: offAdapter,
  });
  assert.equal(healthy, false);
  assert.equal(readiness.memory.state, 'disabled');
  assert.equal(readiness.memory.failureMode, 'timeout');
  assert.equal(readiness.memory.timeoutMs, 50);
  assert.match(readiness.memory.reason, /did not settle within 50 ms/);
  // Other slots are unaffected — the deadline is per slot.
  assert.equal(readiness.beads.state, 'ready');
});

test('L1: the hung adapter is withdrawn from dispatch, not merely marked degraded', async () => {
  const hung = fakeAdapter({ connect: 'hang' });
  const adapters = adapterMap({ memory: hung });
  await connectAdapters({ slots: SLOTS, adapters, manifest: fastManifest(50), resolveOff: offAdapter });

  await assert.rejects(() => hung.store('k', 'v'), AdapterQuarantined);
  await assert.rejects(() => hung.write('k', 'v'), AdapterQuarantined);
  assert.equal(hung.calls.length, 0, 'no dispatch reached the adapter');
  // The slot itself now holds the replacement, so callers get AdapterDisabled.
  assert.equal(adapters.memory._implName, 'off');
});

test('L1: disconnect survives quarantine so shutdown can still release resources', async () => {
  const hung = fakeAdapter({ connect: 'hang' });
  const adapters = adapterMap({ memory: hung });
  await connectAdapters({ slots: SLOTS, adapters, manifest: fastManifest(50), resolveOff: offAdapter });
  await hung.disconnect();
  assert.deepEqual(hung.calls, [['disconnect']]);
});

test('L1: a connect that settles LATE is recorded and the slot stays withdrawn', async () => {
  const late = fakeAdapter({ connect: 'late-resolve', delayMs: 120 });
  const adapters = adapterMap({ memory: late });
  const { readiness } = await connectAdapters({
    slots: SLOTS, adapters, manifest: fastManifest(40), resolveOff: offAdapter,
  });
  assert.equal(readiness.memory.failureMode, 'timeout');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(readiness.memory.lateSettle, 'resolved', 'the late settle is observed and recorded');
  assert.notEqual(readiness.memory.state, 'ready', 'but the slot is never re-armed');
  await assert.rejects(() => late.store('k', 'v'), AdapterQuarantined);
});

test('L1: a LATE REJECTION is captured and does not become an unhandled rejection', async () => {
  const late = fakeAdapter({ connect: 'late-reject', delayMs: 120 });
  const adapters = adapterMap({ events: late });
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    const { readiness } = await connectAdapters({
      slots: SLOTS, adapters, manifest: fastManifest(40), resolveOff: offAdapter,
    });
    assert.equal(readiness.events.failureMode, 'timeout');
    await new Promise((r) => setTimeout(r, 250));
    assert.equal(readiness.events.lateSettle, 'rejected');
    assert.equal(unhandled.length, 0, 'the abandoned connect promise was handled at the source');
  } finally { process.off('unhandledRejection', onUnhandled); }
});

test('L1: a slow but in-time connect succeeds', async () => {
  const slow = fakeAdapter({ connect: 'resolve', delayMs: 30 });
  const adapters = adapterMap({ pods: slow });
  const { readiness } = await connectAdapters({
    slots: SLOTS, adapters, manifest: fastManifest(200), resolveOff: offAdapter,
  });
  assert.equal(readiness.pods.state, 'ready');
});

test('L1: per-slot deadlines run concurrently — total time is the slowest slot, not the sum', async () => {
  const adapters = adapterMap({
    beads: fakeAdapter({ connect: 'hang' }),
    pods: fakeAdapter({ connect: 'hang' }),
    memory: fakeAdapter({ connect: 'hang' }),
    events: fakeAdapter({ connect: 'hang' }),
  });
  const t0 = Date.now();
  await connectAdapters({ slots: SLOTS, adapters, manifest: fastManifest(80), resolveOff: offAdapter });
  const elapsed = Date.now() - t0;
  assert.ok(elapsed < 250, `four 80 ms deadlines ran concurrently (elapsed ${elapsed} ms)`);
});

// ---------------------------------------------------------------------------
// Explicit rejection
// ---------------------------------------------------------------------------

test('an explicit connect rejection disables the slot and quarantines the original', async () => {
  const bad = fakeAdapter({ connect: 'reject' });
  const adapters = adapterMap({ beads: bad });
  const { readiness } = await connectAdapters({
    slots: SLOTS, adapters, manifest: fastManifest(), resolveOff: offAdapter,
  });
  assert.equal(readiness.beads.state, 'disabled');
  assert.equal(readiness.beads.failureMode, 'rejected');
  assert.match(readiness.beads.reason, /sidecar refused/);
  await assert.rejects(() => bad.store('k'), AdapterQuarantined);
  assert.equal(adapters.beads._implName, 'off');
});

// ---------------------------------------------------------------------------
// L2 — failed replacement
// ---------------------------------------------------------------------------

test('L2: a failed off-replacement never leaves the degraded original wired', async () => {
  const bad = fakeAdapter({ connect: 'reject', impl: 'broken' });
  const adapters = adapterMap({ memory: bad });
  const errors = [];
  const { readiness, healthy } = await connectAdapters({
    slots: SLOTS,
    adapters,
    manifest: fastManifest(),
    logger: { error: (o, m) => errors.push(m), warn() {}, info() {} },
    resolveOff: () => { throw new Error('off implementation is missing'); },
  });
  assert.equal(healthy, false);
  assert.equal(readiness.memory.state, 'unavailable');
  assert.equal(readiness.memory.failureMode, 'replacement-failed');
  assert.match(readiness.memory.replacementError, /off implementation is missing/);
  assert.ok(errors.some((m) => /QUARANTINED/.test(m)), 'the failure is logged at error level, not swallowed');
  // The original is still in the slot, but it can no longer be dispatched into.
  assert.equal(adapters.memory, bad);
  await assert.rejects(() => adapters.memory.store('k', 'v'), AdapterQuarantined);
});

test('L2: a resolveOff that returns nothing is treated as a replacement failure', async () => {
  const bad = fakeAdapter({ connect: 'reject' });
  const adapters = adapterMap({ events: bad });
  const { readiness } = await connectAdapters({
    slots: SLOTS, adapters, manifest: fastManifest(), resolveOff: () => undefined,
  });
  assert.equal(readiness.events.state, 'unavailable');
  assert.equal(readiness.events.failureMode, 'replacement-failed');
});

// ---------------------------------------------------------------------------
// Fail-closed slots
// ---------------------------------------------------------------------------

test('the orchestrator slot is fatal on an explicit rejection', async () => {
  const adapters = adapterMap({ orchestrator: fakeAdapter({ connect: 'reject' }) });
  const fatals = [];
  await connectAdapters({
    slots: SLOTS, adapters, manifest: fastManifest(), resolveOff: offAdapter,
    onFatal: (slot, record) => fatals.push([slot, record.failureMode]),
  });
  assert.deepEqual(fatals, [['orchestrator', 'rejected']]);
});

test('the orchestrator slot is EQUALLY fatal on a never-settling connect', async () => {
  const adapters = adapterMap({ orchestrator: fakeAdapter({ connect: 'hang' }) });
  const fatals = [];
  const { readiness } = await connectAdapters({
    slots: SLOTS, adapters, manifest: fastManifest(50), resolveOff: offAdapter,
    onFatal: (slot, record) => fatals.push([slot, record.failureMode]),
  });
  assert.deepEqual(fatals, [['orchestrator', 'timeout']],
    'an orchestrator that never connects is operationally identical to one that refused');
  assert.equal(readiness.orchestrator.state, 'unavailable');
});

test('a fail-closed slot is never silently replaced with off', async () => {
  const bad = fakeAdapter({ connect: 'reject' });
  const adapters = adapterMap({ orchestrator: bad });
  await connectAdapters({
    slots: SLOTS, adapters, manifest: fastManifest(), resolveOff: offAdapter, onFatal: () => {},
  });
  assert.equal(adapters.orchestrator, bad);
  await assert.rejects(() => adapters.orchestrator.store('k'), AdapterQuarantined);
});

// ---------------------------------------------------------------------------
// Timeout policy resolution
// ---------------------------------------------------------------------------

test('the connect deadline is load-bearing and configurable per slot', () => {
  assert.equal(connectTimeoutFor('memory', null), DEFAULT_CONNECT_TIMEOUT_MS);
  assert.equal(connectTimeoutFor('memory', { adapters: {} }), DEFAULT_CONNECT_TIMEOUT_MS);
  assert.equal(connectTimeoutFor('memory', { adapters: { connect_timeout_ms: 2500 } }), 2500);
  assert.equal(connectTimeoutFor('memory', { adapters: { connect_timeout_ms: { memory: 700, default: 3000 } } }), 700);
  assert.equal(connectTimeoutFor('pods', { adapters: { connect_timeout_ms: { memory: 700, default: 3000 } } }), 3000);
  // A nonsensical value falls back to the default rather than failing every slot.
  assert.equal(connectTimeoutFor('memory', { adapters: { connect_timeout_ms: 0 } }), DEFAULT_CONNECT_TIMEOUT_MS);
  assert.equal(connectTimeoutFor('memory', { adapters: { connect_timeout_ms: -5 } }), DEFAULT_CONNECT_TIMEOUT_MS);
  assert.equal(connectTimeoutFor('memory', { adapters: { connect_timeout_ms: 'soon' } }), DEFAULT_CONNECT_TIMEOUT_MS);
});

// ---------------------------------------------------------------------------
// Quarantine mechanics
// ---------------------------------------------------------------------------

test('quarantine covers inherited prototype methods and leaves private helpers alone', async () => {
  class Base { async write() { return 'wrote'; } async _helper() { return 'private'; } }
  class Impl extends Base { async store() { return 'stored'; } async disconnect() { return 'closed'; } }
  const a = new Impl();
  quarantineAdapter(a, 'pods', 'test');
  await assert.rejects(() => a.store(), AdapterQuarantined);
  await assert.rejects(() => a.write(), AdapterQuarantined);
  assert.equal(await a._helper(), 'private');
  assert.equal(await a.disconnect(), 'closed');
  assert.equal(a._quarantined, true);
});

test('the legacy health view keeps the healthy/degraded/off vocabulary', () => {
  const readiness = {
    beads: { state: 'ready' }, pods: { state: 'off' }, memory: { state: 'disabled' },
    events: { state: 'unavailable' }, orchestrator: { state: 'ready' },
  };
  assert.deepEqual(toLegacyHealth(readiness), {
    beads: 'healthy', pods: 'off', memory: 'degraded', events: 'degraded', orchestrator: 'healthy',
  });
});
