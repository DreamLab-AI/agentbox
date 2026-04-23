'use strict';

/**
 * Contract test suite — memory adapter slot
 *
 * Parameterised over embedded-ruvector, external-pg, off implementation classes.
 * M1: placeholder stubs give ≥1 real passing assertion per impl.
 *
 * See ADR-005 §Contract test harness and §Service-level objectives.
 */

const { assertMethodShape, assertContractVersion, assertOffClassThrows } =
  require('./fixtures/shared-assertions');

const { MemoryAdapterPlaceholder: EmbeddedStub, AdapterDisabled } =
  require('../../management-api/adapters/memory/placeholder');
const { MemoryAdapterPlaceholder: ExternalPgStub } =
  require('../../management-api/adapters/memory/placeholder');
const { MemoryAdapterPlaceholder: OffStub, AdapterDisabled: OffAdapterDisabled } =
  require('../../management-api/adapters/memory/placeholder');

const REQUIRED_METHODS = ['store', 'search', 'retrieve', 'del'];

const IMPLS = [
  { label: 'embedded-ruvector', Factory: EmbeddedStub   },
  { label: 'external-pg',       Factory: ExternalPgStub  },
  { label: 'off',               Factory: OffStub          },
];

for (const { label, Factory } of IMPLS) {
  describe(`memory :: ${label}`, () => {

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
      assertContractVersion(adapter, 'memory');
    });

    // --- Pending: off-class discipline ---

    if (label === 'off') {
      it('raises AdapterDisabled on every method', async () => {
        await assertOffClassThrows(adapter, REQUIRED_METHODS, OffAdapterDisabled);
      });
    }

    // --- Pending: behavioural equivalence ---

    it.todo('store persists a value and returns the assigned key');
    it.todo('search returns ranked results for a semantic query');
    it.todo('retrieve returns the value previously stored under a key');
    it.todo('del removes the entry and retrieve subsequently returns null');

    // --- Pending: SLO compliance ---

    it.todo('store (with embedding) p95 latency is under 500 ms at 10 req/s');
    it.todo('search p95 latency is under 250 ms at 50 req/s');

    // --- Pending: error shape ---

    it.todo('retrieve returns null (not an error) for unknown keys');
    it.todo('search throws a typed EmbeddingError when the embedding model is unavailable');
  });
}
