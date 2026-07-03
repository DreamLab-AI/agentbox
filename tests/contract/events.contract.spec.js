'use strict';

/**
 * Contract test suite — events adapter slot
 *
 * M2: real implementations. Promoted assertions marked [M2].
 *
 * See ADR-005 §Contract test harness and §Service-level objectives.
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const { assertMethodShape, assertContractVersion, assertOffClassThrows, measureP95 } =
  require('./fixtures/shared-assertions');
const { AdapterDisabled } = require('../../management-api/adapters/errors');

const { LocalJsonlEventsAdapter } = require('../../management-api/adapters/events/local-jsonl');
const { ExternalEventsAdapter }   = require('../../management-api/adapters/events/external');
const { OffEventsAdapter }        = require('../../management-api/adapters/events/off');

const REQUIRED_METHODS = ['dispatch', 'subscribe', 'unsubscribe'];

// Off-class spec per ADR-005: dispatch is a no-op (not error) for off; subscribe/unsubscribe throw.
const OFF_THROWING_METHODS = ['subscribe', 'unsubscribe'];

// Fetch stub for external adapter
function makeOkFetch() {
  return async () => ({ ok: true, status: 200, text: async () => '{}', json: async () => ({}) });
}

const IMPLS = [
  {
    label: 'local-jsonl',
    makeAdapter: () => {
      const written = [];
      const appendFn = (_filePath, line) => written.push(line);
      const a = new LocalJsonlEventsAdapter({ appendFn });
      a.__written = written;
      return a;
    },
    isReal: true,
  },
  {
    label: 'external',
    makeAdapter: () => new ExternalEventsAdapter({ url: 'http://fake-sink/events', fetchFn: makeOkFetch() }),
    isReal: true, // real dispatch path (fetch-stubbed)
  },
  {
    label: 'off',
    makeAdapter: () => new OffEventsAdapter(),
    isReal: false,
  },
];

for (const { label, makeAdapter, isReal } of IMPLS) {
  describe(`events :: ${label}`, () => {

    let adapter;
    beforeEach(() => { adapter = makeAdapter(); });

    it('exposes all required interface methods', () => {
      assertMethodShape(adapter, REQUIRED_METHODS);
    });

    it('reports a CONTRACT_VERSION that is valid semver', () => {
      expect(adapter.CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('CONTRACT_VERSION matches the canonical fixture value', () => {
      assertContractVersion(adapter, 'events');
    });

    // off-class: only subscribe/unsubscribe throw; dispatch is a no-op
    if (label === 'off') {
      it('raises AdapterDisabled on subscribe and unsubscribe', async () => {
        await assertOffClassThrows(adapter, OFF_THROWING_METHODS, AdapterDisabled);
      });

      it('[M2] dispatch is a no-op and does not throw for off adapter', async () => {
        const result = await adapter.dispatch({ kind: 'test' });
        expect(result).toBeNull();
      });
    }

    // Promoted behavioural assertions (M2)
    if (isReal) {
      it('[M2] dispatch writes a valid JSONL line with ts, kind, and payload', async () => {
        const start = Date.now();
        const result = await adapter.dispatch({ kind: 'spawn', payload: { agent: 'a1' }, session_id: 'sess-1' });
        expect(Date.now() - start).toBeLessThan(1000);
        expect(result).toHaveProperty('ts');
        expect(result).toHaveProperty('kind', 'spawn');

        if (adapter.__written) {
          const line = JSON.parse(adapter.__written[0]);
          expect(line).toHaveProperty('ts');
          expect(line).toHaveProperty('kind', 'spawn');
          expect(line.payload).toEqual({ agent: 'a1' });
          expect(line.session_id).toBe('sess-1');
        }
      });

      it('[M2] subscribe calls handler for each subsequent matching dispatch', async () => {
        const received = [];
        const subId = await adapter.subscribe({ kind: 'test.event' }, ev => received.push(ev));
        expect(typeof subId).toBe('string');

        // Only local-jsonl has in-process subscriber delivery
        if (label === 'local-jsonl') {
          await adapter.dispatch({ kind: 'test.event', payload: { x: 1 } });
          await adapter.dispatch({ kind: 'other.event', payload: { x: 2 } });
          expect(received).toHaveLength(1);
          expect(received[0].kind).toBe('test.event');
        }
      });

      it('[M2] unsubscribe stops delivering events to the handler', async () => {
        const received = [];
        const subId = await adapter.subscribe(null, ev => received.push(ev));

        if (label === 'local-jsonl') {
          await adapter.dispatch({ kind: 'before' });
          await adapter.unsubscribe(subId);
          await adapter.dispatch({ kind: 'after' });
          expect(received).toHaveLength(1);
          expect(received[0].kind).toBe('before');
        } else {
          await adapter.unsubscribe(subId);
        }
      });
    }

    // Promoted typed-error and additional behavioural assertions (M2)
    if (isReal) {
      it('[M2] dispatch throws a typed ValidationError when event.kind is missing', async () => {
        await expect(adapter.dispatch({ payload: { x: 1 } })).rejects.toMatchObject({
          name: 'ValidationError',
          code: 'VALIDATION_ERROR',
        });
      });

      it('[M2] unsubscribe with an unknown id throws a typed NotFound', async () => {
        await expect(adapter.unsubscribe('no-such-subscription-id')).rejects.toMatchObject({
          name: 'NotFound',
          code: 'NOT_FOUND',
        });
      });

      it('[M2] dispatch returns ts and kind on success', async () => {
        const result = await adapter.dispatch({ kind: 'agent.heartbeat' });
        expect(result).toHaveProperty('ts');
        expect(result).toHaveProperty('kind', 'agent.heartbeat');
      });

      it('[M2] subscribe returns a string subscription id', async () => {
        const id = await adapter.subscribe(null, () => {});
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
      });

      it('[M2] unsubscribe on a valid id resolves without error', async () => {
        const id = await adapter.subscribe(null, () => {});
        await expect(adapter.unsubscribe(id)).resolves.toBeFalsy();
      });
    }

    // --- Service-level objectives (ADR-005 §SLO) ---
    // The 50 ms budget covers the synchronous fs.appendFileSync in the real
    // write path. Measured here against a real temp-dir-backed local-jsonl
    // adapter (no appendFn override) so fs.appendFileSync is genuinely
    // exercised. This is the sequential in-process floor for the 500 req/s SLO;
    // the full concurrent figure is measured by the nightly k6 harness.
    if (label === 'local-jsonl') {
      it('[SLO] dispatch p95 latency is under 50 ms (real fs.appendFileSync floor for the 500 req/s SLO)', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentbox-events-slo-'));
        const fsAdapter = new LocalJsonlEventsAdapter({ eventsDir: dir });
        try {
          const p95 = await measureP95((i) =>
            fsAdapter.dispatch({ kind: 'slo.probe', payload: { i }, session_id: 'slo' }));
          expect(p95).toBeLessThan(50);
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      });
    } else if (label === 'external') {
      // The external adapter's SLO is an HTTP round-trip to a live event sink;
      // its real p95 requires that sink + k6, which the fetch-stub cannot model.
      it.todo('dispatch p95 at load — external adapter SLO requires a live HTTP event sink and the nightly k6 harness (fetch-stub latency is not representative)');
    }
  });
}
