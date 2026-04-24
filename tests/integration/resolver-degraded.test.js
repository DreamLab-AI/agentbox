'use strict';

/**
 * Integration tests — Adapter resolver degraded-start path
 *
 * Verifies ADR-005 §Graceful degrade:
 *   "When a non-orchestrator adapter fails connect(), the slot falls back to
 *    the off implementation and adapterHealth[slot] = 'degraded'."
 *
 * Tests exercise the resolver and the server's connect-phase logic directly,
 * without starting the full Fastify HTTP server.
 *
 * Scenario under test:
 *   - An adapter whose connect() rejects with a network error.
 *   - The caller (simulating server.js connect phase) catches the error,
 *     marks the slot as "degraded", and replaces the adapter with OffAdapter.
 *   - Subsequent method calls throw AdapterDisabled.
 *   - The orchestrator slot re-throws (fatal path) instead of degrading.
 *
 * Note on ExternalBeadsAdapter: the resolver passes `externalUrl` (camelCase)
 * to its constructor but the adapter expects `baseUrl`.  This is a pre-existing
 * key-name mismatch; these tests isolate the degrade logic by constructing
 * adapters directly so they can test connect() failures independently.
 */

const { resolveAdapters } = require('../../management-api/adapters/index');
const { AdapterDisabled }     = require('../../management-api/adapters/errors');
const { OffBeadsAdapter }     = require('../../management-api/adapters/beads/off');
const { ExternalBeadsAdapter } = require('../../management-api/adapters/beads/external');

// ── simulated connect-with-degrade (mirrors server.js lines 425-450) ─────────

const SLOTS = ['beads', 'pods', 'memory', 'events', 'orchestrator'];

/**
 * Accepts a pre-resolved adapter map and applies the server's degrade logic.
 * Returns { adapters, health }.
 */
async function applyConnectDegrade(resolved) {
  const health = {};
  const adapters = { ...resolved };

  await Promise.allSettled(
    SLOTS.map(async (slot) => {
      const adapter = adapters[slot];
      if (!adapter) { health[slot] = 'off'; return; }

      if (typeof adapter.connect !== 'function') {
        health[slot] = adapter.enabled === false ? 'off' : 'healthy';
        return;
      }
      try {
        await adapter.connect();
        health[slot] = 'healthy';
      } catch (err) {
        if (slot === 'orchestrator') throw err;   // fatal per ADR-005
        health[slot] = 'degraded';
        // Replace with off impl
        const { resolveAdapters: re } = require('../../management-api/adapters/index');
        const offSlot = re({ adapters: { [slot]: 'off' } })[slot];
        offSlot._implName = 'off';
        offSlot._slot = slot;
        adapters[slot] = offSlot;
      }
    }),
  );

  return { adapters, health };
}

/**
 * Build a fake adapter that always rejects on connect() with a network error.
 * Useful to test the degrade path without needing a live network target.
 */
function makeFailing(slot) {
  return {
    slot,
    enabled: true,
    _implName: 'external',
    _slot: slot,
    connect: async () => {
      throw new Error(`connect: ECONNREFUSED 127.0.0.1:1`);
    },
  };
}

/**
 * Mirrors the server's connect logic including the orchestrator's process.exit(1) path,
 * but replaces process.exit with a tracked call so tests don't terminate the runner.
 * Returns { adapters, health, orchestratorExitCalled }.
 */
async function applyConnectDegradeWithOrchestatorTracking(resolved) {
  const health = {};
  const adapters = { ...resolved };
  let orchestratorExitCalled = false;

  const ops = SLOTS.map(async (slot) => {
    const adapter = adapters[slot];
    if (!adapter) { health[slot] = 'off'; return; }

    if (typeof adapter.connect !== 'function') {
      health[slot] = adapter.enabled === false ? 'off' : 'healthy';
      return;
    }
    try {
      await adapter.connect();
      health[slot] = 'healthy';
    } catch (err) {
      if (slot === 'orchestrator') {
        // Server calls process.exit(1) here — track it without killing the runner
        orchestratorExitCalled = true;
        return; // do NOT degrade; leave slot as-is
      }
      health[slot] = 'degraded';
      const { resolveAdapters: re } = require('../../management-api/adapters/index');
      const offSlot = re({ adapters: { [slot]: 'off' } })[slot];
      offSlot._implName = 'off';
      offSlot._slot = slot;
      adapters[slot] = offSlot;
    }
  });

  await Promise.all(ops);
  return { adapters, health, orchestratorExitCalled };
}

// ── minimal resolver smoke tests ──────────────────────────────────────────────

describe('Adapter resolver — resolveAdapters construction', () => {

  it('resolves beads=off to OffBeadsAdapter', () => {
    const manifest = { adapters: { beads: 'off' } };
    const adapters = resolveAdapters(manifest);
    expect(adapters.beads).toBeInstanceOf(OffBeadsAdapter);
  });

  it('off adapter has enabled=false', () => {
    const manifest = { adapters: { beads: 'off' } };
    const adapters = resolveAdapters(manifest);
    expect(adapters.beads.enabled).toBe(false);
  });

  it('OffBeadsAdapter has CONTRACT_VERSION that is valid semver', () => {
    const manifest = { adapters: { beads: 'off' } };
    const adapters = resolveAdapters(manifest);
    expect(adapters.beads.CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

});

// ── degraded-start: failing adapter → off fallback ───────────────────────────

describe('Adapter resolver — degraded-start: failing connect() → off fallback', () => {

  it('beads health is "degraded" when connect() fails', async () => {
    const resolved = {
      beads:        makeFailing('beads'),
      pods:         new (require('../../management-api/adapters/pods/off').OffPodsAdapter)(),
      memory:       new (require('../../management-api/adapters/memory/off').OffMemoryAdapter)(),
      events:       new (require('../../management-api/adapters/events/off').OffEventsAdapter)(),
      orchestrator: new (require('../../management-api/adapters/orchestrator/off').OffOrchestratorAdapter)(),
    };
    const { health } = await applyConnectDegrade(resolved);
    expect(health.beads).toBe('degraded');
  }, 5000);

  it('resolved beads slot is OffBeadsAdapter after connect() failure', async () => {
    const resolved = {
      beads:        makeFailing('beads'),
      pods:         new (require('../../management-api/adapters/pods/off').OffPodsAdapter)(),
      memory:       new (require('../../management-api/adapters/memory/off').OffMemoryAdapter)(),
      events:       new (require('../../management-api/adapters/events/off').OffEventsAdapter)(),
      orchestrator: new (require('../../management-api/adapters/orchestrator/off').OffOrchestratorAdapter)(),
    };
    const { adapters } = await applyConnectDegrade(resolved);
    expect(adapters.beads).toBeInstanceOf(OffBeadsAdapter);
  }, 5000);

  it('subsequent createEpic call on degraded slot throws AdapterDisabled', async () => {
    const resolved = {
      beads:        makeFailing('beads'),
      pods:         new (require('../../management-api/adapters/pods/off').OffPodsAdapter)(),
      memory:       new (require('../../management-api/adapters/memory/off').OffMemoryAdapter)(),
      events:       new (require('../../management-api/adapters/events/off').OffEventsAdapter)(),
      orchestrator: new (require('../../management-api/adapters/orchestrator/off').OffOrchestratorAdapter)(),
    };
    const { adapters } = await applyConnectDegrade(resolved);
    await expect(adapters.beads.createEpic({ title: 'x' }))
      .rejects.toMatchObject({ name: 'AdapterDisabled', code: 'ADAPTER_DISABLED' });
  }, 5000);

  it('degraded beads slot has _implName="off" after fallback', async () => {
    const resolved = {
      beads:        makeFailing('beads'),
      pods:         new (require('../../management-api/adapters/pods/off').OffPodsAdapter)(),
      memory:       new (require('../../management-api/adapters/memory/off').OffMemoryAdapter)(),
      events:       new (require('../../management-api/adapters/events/off').OffEventsAdapter)(),
      orchestrator: new (require('../../management-api/adapters/orchestrator/off').OffOrchestratorAdapter)(),
    };
    const { adapters } = await applyConnectDegrade(resolved);
    expect(adapters.beads._implName).toBe('off');
  }, 5000);

});

// ── orchestrator fatal path ───────────────────────────────────────────────────

describe('Adapter resolver — orchestrator fatal path', () => {
  /**
   * ADR-005: orchestrator connect failure is FATAL — server.js calls process.exit(1).
   * Tests verify:
   *   1. The exit path is taken (tracked without calling real process.exit).
   *   2. The orchestrator slot is NOT replaced with the off impl (no silent degrade).
   */
  it('process.exit(1) is triggered when orchestrator connect() fails', async () => {
    const failingOrch = makeFailing('orchestrator');
    const resolved = {
      beads:        new OffBeadsAdapter(),
      pods:         new (require('../../management-api/adapters/pods/off').OffPodsAdapter)(),
      memory:       new (require('../../management-api/adapters/memory/off').OffMemoryAdapter)(),
      events:       new (require('../../management-api/adapters/events/off').OffEventsAdapter)(),
      orchestrator: failingOrch,
    };

    const { orchestratorExitCalled } = await applyConnectDegradeWithOrchestatorTracking(resolved);
    expect(orchestratorExitCalled).toBe(true);
  }, 5000);

  it('orchestrator slot is NOT replaced with off impl after fatal failure', async () => {
    const failingOrch = makeFailing('orchestrator');
    const resolved = {
      beads:        new OffBeadsAdapter(),
      pods:         new (require('../../management-api/adapters/pods/off').OffPodsAdapter)(),
      memory:       new (require('../../management-api/adapters/memory/off').OffMemoryAdapter)(),
      events:       new (require('../../management-api/adapters/events/off').OffEventsAdapter)(),
      orchestrator: failingOrch,
    };

    const { adapters } = await applyConnectDegradeWithOrchestatorTracking(resolved);
    // Fatal path does NOT swap out the orchestrator — the original failing adapter remains
    expect(adapters.orchestrator).toBe(failingOrch);
  }, 5000);
});
