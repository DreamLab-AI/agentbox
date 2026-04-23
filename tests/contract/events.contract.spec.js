'use strict';

/**
 * Contract test suite — events adapter slot
 *
 * Parameterised over local-jsonl, external, off implementation classes.
 * M1: placeholder stubs give ≥1 real passing assertion per impl.
 *
 * See ADR-005 §Contract test harness and §Service-level objectives.
 */

const { assertMethodShape, assertContractVersion, assertOffClassThrows } =
  require('./fixtures/shared-assertions');

const { EventsAdapterPlaceholder: LocalJsonlStub, AdapterDisabled } =
  require('../../management-api/adapters/events/placeholder');
const { EventsAdapterPlaceholder: ExternalStub } =
  require('../../management-api/adapters/events/placeholder');
const { EventsAdapterPlaceholder: OffStub, AdapterDisabled: OffAdapterDisabled } =
  require('../../management-api/adapters/events/placeholder');

const REQUIRED_METHODS = ['dispatch', 'subscribe', 'unsubscribe'];

const IMPLS = [
  { label: 'local-jsonl', Factory: LocalJsonlStub },
  { label: 'external',    Factory: ExternalStub    },
  { label: 'off',         Factory: OffStub          },
];

for (const { label, Factory } of IMPLS) {
  describe(`events :: ${label}`, () => {

    let adapter;
    beforeEach(() => { adapter = new Factory(); });

    // --- Passing assertions (M1) ---

    it('exposes all required interface methods', () => {
      assertMethodShape(adapter, REQUIRED_METHODS);
    });

    it('reports a CONTRACT_VERSION that is valid semver', () => {
      expect(adapter.CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('CONTRACT_VERSION matches the canonical fixture value', () => {
      assertContractVersion(adapter, 'events');
    });

    // --- Pending: off-class discipline ---

    if (label === 'off') {
      it('raises AdapterDisabled on every method', async () => {
        await assertOffClassThrows(adapter, REQUIRED_METHODS, OffAdapterDisabled);
      });
    }

    // --- Pending: behavioural equivalence ---

    it.todo('dispatch writes a valid JSONL line with ts, kind, and payload');
    it.todo('subscribe calls handler for each subsequent matching dispatch');
    it.todo('unsubscribe stops delivering events to the handler');

    // --- Pending: SLO compliance ---

    it.todo('dispatch p95 latency is under 50 ms at 500 req/s');

    // --- Pending: error shape ---

    it.todo('dispatch throws a typed ValidationError when event schema is invalid');
    it.todo('unsubscribe with unknown id throws a typed NotFound');
  });
}
