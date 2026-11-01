'use strict';

/**
 * A degraded adapter slot never accepts a write and discards it. The events slot's
 * `off` stand-in used to no-op dispatch(), so an events config error (or connect
 * failure) made the authority journal report records as journalled while they went
 * nowhere. The lifecycle's degraded replacement now refuses with an error.
 *
 * Also pins the external-adapter config key: slotConfig passes `baseUrl`, the one
 * key every external adapter reads.
 */

const { resolveAdapters, SLOTS, slotConfig } = require('../../management-api/adapters/index');
const { connectAdapters } = require('../../management-api/adapters/lifecycle');
const { buildAuthorityJournal } = require('../../management-api/lib/authority-journal');

const resolveOff = (slot) => resolveAdapters({ adapters: { [slot]: 'off' } })[slot];
const quietLog = { info() {}, warn() {}, error() {} };

describe('degraded slots refuse writes', () => {
  test('events config error: the stand-in rejects dispatch and the journal reports not journalled', async () => {
    // external events with no federation.external_url -> constructor throws -> ConfigFailedAdapter
    const manifest = { adapters: { events: 'external' } };
    const adapters = resolveAdapters(manifest);
    const { readiness } = await connectAdapters({ slots: SLOTS, adapters, manifest, resolveOff, logger: quietLog });
    expect(readiness.events.state).toBe('disabled');
    await expect(adapters.events.dispatch({ kind: 'authority.deny', payload: {} })).rejects.toThrow(/disabled/i);
    const journal = buildAuthorityJournal({ eventsAdapter: adapters.events, publisher: null });
    const out = await journal.append({ stage: 'gate', reason: 'denied' });
    expect(out.journalled).toBe(false);
  });

  test('events connect failure: same refusal', async () => {
    const adapters = resolveAdapters({ adapters: { events: 'off' } });
    adapters.events = { _implName: 'local-jsonl', async connect() { throw new Error('disk gone'); }, async dispatch() { return { ok: true }; } };
    await connectAdapters({ slots: ['events'], adapters, manifest: {}, resolveOff, logger: quietLog });
    await expect(adapters.events.dispatch({ kind: 'k' })).rejects.toThrow(/disabled/i);
  });

  test('a slot configured off (not degraded) still no-ops dispatch, per ADR-005', async () => {
    const off = resolveOff('events');
    await expect(off.dispatch({ kind: 'k' })).resolves.toBeNull();
  });

  test.each(SLOTS.filter((s) => s !== 'orchestrator'))('%s: a degraded replacement throws on every public method', async (slot) => {
    const adapters = resolveAdapters({ adapters: { [slot]: 'off' } });
    adapters[slot] = { _implName: 'x', async connect() { throw new Error('down'); } };
    await connectAdapters({ slots: [slot], adapters, manifest: {}, resolveOff, logger: quietLog });
    const a = adapters[slot];
    const names = new Set();
    for (let p = Object.getPrototypeOf(a); p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
      for (const n of Object.getOwnPropertyNames(p)) names.add(n);
    }
    for (const n of names) {
      if (n === 'constructor' || n === 'connect' || n === 'disconnect' || n.startsWith('_') || typeof a[n] !== 'function') continue;
      let threw = false;
      try { await a[n]({}); } catch { threw = true; }
      expect([slot, n, threw]).toEqual([slot, n, true]);
    }
  });
});

describe('external adapters take one config key: baseUrl', () => {
  const fed = { federation: { external_url: 'https://host.example/agentbox' } };
  test('slotConfig passes baseUrl for beads, events, pods', () => {
    for (const slot of ['beads', 'events', 'pods']) {
      const cfg = slotConfig(slot, 'external', fed);
      expect(cfg.baseUrl).toBe('https://host.example/agentbox');
      expect(cfg).not.toHaveProperty('externalUrl');
    }
  });
  test('external adapters construct from the resolved config and stay ready', async () => {
    const manifest = { ...fed, adapters: { beads: 'external', events: 'external', pods: 'external' } };
    const adapters = resolveAdapters(manifest);
    for (const slot of ['beads', 'events', 'pods']) expect(adapters[slot]._implName).toBe('external');
    for (const slot of ['beads', 'events', 'pods']) expect(adapters[slot]._configError).toBeUndefined();
  });
  test('the events adapter reads baseUrl and rejects a missing one', () => {
    const { ExternalEventsAdapter } = require('../../management-api/adapters/events/external');
    expect(() => new ExternalEventsAdapter({})).toThrow(/baseUrl/);
    expect(() => new ExternalEventsAdapter({ baseUrl: 'http://x/e' })).not.toThrow();
  });
});
