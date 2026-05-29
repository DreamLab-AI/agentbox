'use strict';

/**
 * Contract test for lib/memory-flash-notifier — the RuVector-access → VisionClaw
 * beacon producer (PRD-014 Seam C). Guards the three invariants the visual
 * pipeline depends on: privacy (no value, namespace de-scoped), fail-open
 * (never throws, never blocks), and env-gating (silent unless a URL is set).
 *
 * The module reads env at require() time, so each gating scenario is exercised
 * in an isolated module registry via jest.isolateModules + a stubbed fetch.
 */

function loadWith(env, fetchImpl) {
  let captured = [];
  jest.isolateModules(() => {
    const saved = {};
    for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
    // Clear the disable knob unless the scenario sets it.
    if (!('VISIONCLAW_MEMORY_FLASH' in env)) delete process.env.VISIONCLAW_MEMORY_FLASH;
    global.fetch = fetchImpl || ((url, opts) => {
      captured.push({ url, body: JSON.parse(opts.body) });
      return Promise.resolve({ ok: true });
    });
    const mod = require('../../management-api/lib/memory-flash-notifier');
    loadWith._mod = mod;
    loadWith._captured = captured;
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  });
  return { mod: loadWith._mod, captured: loadWith._captured };
}

const flushAsync = () => new Promise((r) => setImmediate(r));

describe('memory-flash-notifier', () => {
  const origFetch = global.fetch;
  afterEach(() => { global.fetch = origFetch; });

  test('disabled (no URL) → no fetch, no throw', async () => {
    const { mod, captured } = loadWith({ VISIONCLAW_API_URL: '', VISIONCLAW_MEMORY_FLASH_URL: '' });
    expect(mod._isEnabled()).toBe(false);
    expect(() => mod.notifyMemoryFlash({ key: 'k', namespace: 'patterns' })).not.toThrow();
    await flushAsync();
    expect(captured.length).toBe(0);
  });

  test('VISIONCLAW_MEMORY_FLASH=off force-disables even with a URL', () => {
    const { mod } = loadWith({ VISIONCLAW_API_URL: 'http://vc:4000', VISIONCLAW_MEMORY_FLASH: 'off' });
    expect(mod._isEnabled()).toBe(false);
  });

  test('enabled → POSTs key + namespace + action only (never the value)', async () => {
    const { mod, captured } = loadWith({ VISIONCLAW_API_URL: 'http://vc:4000' });
    expect(mod._isEnabled()).toBe(true);
    mod.notifyMemoryFlash({ key: 'pattern-auth', namespace: 'patterns', action: 'store', value: 'SECRET' });
    await flushAsync();
    expect(captured.length).toBe(1);
    expect(captured[0].url).toBe('http://vc:4000/api/memory-flash');
    expect(captured[0].body).toEqual({ key: 'pattern-auth', namespace: 'patterns', action: 'store' });
    expect(JSON.stringify(captured[0].body)).not.toContain('SECRET');
  });

  test('strips the user:<pubkey>: scoping prefix to the logical namespace', () => {
    const { mod } = loadWith({ VISIONCLAW_API_URL: 'http://vc:4000' });
    const hex = 'a'.repeat(64);
    expect(mod._logicalNamespace(`user:${hex}:personal-context`)).toBe('personal-context');
    expect(mod._logicalNamespace('patterns')).toBe('patterns');
    expect(mod._logicalNamespace(undefined)).toBe('default');
  });

  test('missing key → no beacon', async () => {
    const { mod, captured } = loadWith({ VISIONCLAW_API_URL: 'http://vc:4000' });
    mod.notifyMemoryFlash({ namespace: 'patterns', action: 'store' });
    await flushAsync();
    expect(captured.length).toBe(0);
  });

  test('batch of >1 hits the /batch route; single collapses to /api/memory-flash', async () => {
    const { mod, captured } = loadWith({ VISIONCLAW_API_URL: 'http://vc:4000/' }); // trailing slash trimmed
    mod.notifyMemoryFlashBatch([
      { key: 'a', namespace: 'patterns', action: 'search' },
      { key: 'b', namespace: 'patterns', action: 'search' },
    ]);
    mod.notifyMemoryFlashBatch([{ key: 'solo', namespace: 'patterns', action: 'search' }]);
    await flushAsync();
    const batch = captured.find((c) => c.url.endsWith('/api/memory-flash/batch'));
    const single = captured.find((c) => c.url === 'http://vc:4000/api/memory-flash');
    expect(batch).toBeDefined();
    expect(batch.body.events).toHaveLength(2);
    expect(single).toBeDefined();
    expect(single.body.key).toBe('solo');
  });

  test('fail-open: a throwing fetch never rejects the caller', async () => {
    const { mod } = loadWith(
      { VISIONCLAW_API_URL: 'http://vc:4000' },
      () => Promise.reject(new Error('network down')),
    );
    expect(() => mod.notifyMemoryFlash({ key: 'k', namespace: 'patterns', action: 'store' })).not.toThrow();
    await flushAsync(); // unhandled rejection would surface here if not swallowed
  });
});
